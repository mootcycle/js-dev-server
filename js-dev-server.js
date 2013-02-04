#!/usr/bin/env node
/*jshint multistr:true, supernew: true*/

var http = require('http'),
    url = require('url'),
    path = require('path'),
    fs = require('fs'),
    cp = require('child_process'),
    program = require('commander'),
    WebSocket = require('ws'),
    cheerio = require('cheerio');

program
  .version('0.0.7')
  .option('-p, --port [port]', 'Specify a port number. (default: 8888)', 8888)
  .option('-wp, --webSocketPort [webSocketPort]', 'Specify a port number for the web socket server. (default: 8889)', 8889)
  .option('-w, --watchDepth [watchDepth]', 'Specify how many directory levels deep to add watchers. There is a limit to the number of watchers node will allow. (default: 3)', 3)
  .option('-s, --excludeStrings [excludeStrings]', 'Provide a comma separated list of strings used to exclude files/directories from being watched. (ex: node_modules,components')
  .option('-b, --bossAddress [bossAddress]', 'Specify the IP address from which the main development browser will connect from. (default: 127.0.0.1)', '127.0.0.1')
  .option('-d, --delay [delay]', 'Specify the minimum number of seconds to throttle refresh commands. (default: 3)', 3)
  .option('-x, --proxy [proxy]', 'Specify a web site to proxy. 404s will load from the proxied site.')
  .option('-o, --skipOpen [skipOpen]', 'If set, the browser will not automatically open a new tab for this server.')
  .option('-e, --extensions [extensions]', 'Specify extensions to track for refreshes; comma separated, no spaces. (default: html,css,js)', 'html,css,js')
  .option('-v, --verbose [verbose]', 'Print additional information about which files are watched/served.')
  .parse(process.argv);

var port = parseInt(program.port, 10) || 8888,
    wsPort = parseInt(program.webSocketPort, 10) || 8888,
    watchDepth = parseInt(program.watchDepth, 10) || 3,
    excludeStrings = program.excludeStrings ? program.excludeStrings.split(',') : [],
    bossAddress = program.bossAddress,
    proxySite = program.proxy ? url.parse(program.proxy) : null,
    openBrowser = !program.skipOpen,
    verbose = !!program.verbose,
    webFiles = {},
    webClients = {},
    throttleSeconds = parseInt(program.delay, 10) || 3,
    mostRecentlyVisited,
    watcherArray = [],
    webSocketsArray = [],
    injectionScript = '<script>' + fs.readFileSync(__dirname + '/injection-script.js').toString().replace('%WSPORT%', wsPort) + '</script>',
    controlDiv = fs.readFileSync(__dirname + '/control-div.html').toString();

program.extensions.split(',').forEach(
  function(ext) {
    this[ext] = true;
  }.bind(webFiles)
);


function throttleizer(delay, callback) {
  var minimumRefresh = delay * 1000;
  var execTime = 0;
  var trailingCall;

  function wrappedCallback() {
    execTime = +new Date + minimumRefresh;
    callback();
  }

  return function() {
    var now = +new Date;

    if (now > execTime) {
      wrappedCallback();
    } else {
      if (trailingCall) {
        clearTimeout(trailingCall);
      }
      trailingCall = setTimeout(wrappedCallback, execTime - now);
    }
  };
}

function refreshBrowsers() {
  sendBrowserCommand({
    action: 'reload'
  }, {boss: true, remoteBrowsers: true});
}

function navigateBrowsers() {
  sendBrowserCommand({
    action: 'navigate',
    url: mostRecentlyVisited
  }, {remoteBrowsers: true});
}

function updateRemoteBrowsers() {
  var list = [];
  for (var wc in webClients) {
    if (webClients[wc].readyState === WebSocket.OPEN && !webClients[wc]._socket.remoteAddress.match(bossAddress)) {
      list.push({
        name: webClients[wc]._socket.remoteAddress.toString(),
        jsid: wc
      });
    }
  }

  if (!list.length) {
    list.push({name: 'No remote connections.'});
  }

  sendBrowserCommand({
    action: 'browsers',
    browserList: list
  }, {boss: true});
}

function sendBrowserCommand(cmd, targets) {
  verboseLog('Sending browser command: ' + JSON.stringify(cmd));
  var openSockets = [];
  webSocketsArray.forEach(function(ws) {
    if (ws.readyState === WebSocket.OPEN) {
      if (targets.boss && ws._socket.remoteAddress.match(bossAddress)) {
        ws.send(JSON.stringify(cmd));
      }

      if (targets.remoteBrowsers && !ws._socket.remoteAddress.match(bossAddress)) {
        ws.send(JSON.stringify(cmd));
      }

      if (targets.specificBrowser && ws === webClients[targets.specificBrowser]) {
        ws.send(JSON.stringify(cmd));
      }

      openSockets.push(ws);
    } else {
      verboseLog('Found a dead websocket; removing it from the array. readyState: (' + ws.readyState + ')');
    }
  });

  webSocketsArray = openSockets;
}

var throttledRefreshBrowser = throttleizer(throttleSeconds, refreshBrowsers),
    throttledNavigateBrowser = throttleizer(throttleSeconds, navigateBrowsers);

function getExtension(file) {
  var arr = file.split('.');
  return arr[arr.length - 1];
}

function fileChangeFactory(path) {
  return function(evt, filename) {
    if (evt == 'change') {
      console.log('File change event: ' + path);
      throttledRefreshBrowser();
    } else {
      console.log('File rename event: ' + path);
      // Not sure I actually need to rebuild the watchers here, but I will.
      rebuildWatchers();
    }
  };
}

function directoryChangeFactory(path) {
  return function(evt, filename) {
    console.log('Directory change event at: ' + path);
    // TODO: don't rescan the entire tree.
    rebuildWatchers();
  };
}

function verboseLog(str) {
  if (verbose) {
    console.log(str);
  }
}

function dumpErrors(err, options) {
  switch (err.code) {
    case 'EMFILE':
      console.log('js-dev-server tried to open too many files at a directory depth of ' + options.depth + '.\nTry restricting the watch depth to ' + (options.depth - 1) + ' with the -w option or limiting the matching files with the -s option.');
      break;

    case 'EADDRINUSE':
      console.log('Port ' + options.port + ' is already in use. Try specifying another port using the -p argument.');
      break;

    default:
      console.log('An unhandled error occurred: ' + err);
      break;
  }

  process.exit();
}

function rebuildWatchers() {
  watcherArray.forEach(function(watcher) {
    watcher.close();
  });

  watcherArray.length = 0;
  scanDirectory('.');
}

function scanDirectory(path, depth) {
  watcherArray.push(fs.watch(path, {}, directoryChangeFactory(path)));
  depth = depth || 0;

  var list = fs.readdirSync(path);
  list.forEach(function(file) {
    var fullPath = path + '/' + file;

    var stat, exclude;

    try {

    try {
      stat = fs.statSync(fullPath);
    } catch (err) {
      stat = null;
    }
    if (stat) {
      if (stat.isDirectory()) {
        if (watchDepth >= depth) {
          verboseLog('At depth ' + depth + '; recursing into: ' + fullPath);

          scanDirectory(fullPath, depth + 1);
        } else {
          verboseLog('Reached maximum depth at: ' + fullPath);
        }
      } else {
        if (webFiles[getExtension(file)]) {
          exclude = false;
          excludeStrings.forEach(function(str) {
            if (fullPath.match(str)) {
              exclude = true;
              verboseLog(fullPath + ' matched excludeString "' + str + '"; skipping.');
            }
          });

          if (!exclude) {
            verboseLog('watching: ' + fullPath);

            // Add a watcher to all web text files.
            watcherArray.push(fs.watch(fullPath, {}, fileChangeFactory(fullPath)));
          }
        }
      }
    }

    } catch(err) {
      dumpErrors(err, {fullPath:fullPath, depth: depth});
    }
  });
}

function receiveClientCommands(ws, cmd) {
  switch(cmd.action) {
    case 'register':
      verboseLog('Registering client: ' + cmd.jsid);
      webClients[cmd.jsid] = ws;
      updateRemoteBrowsers();
      break;

    case 'jsConsole':
      verboseLog('got a jsConsole command');
      verboseLog(JSON.stringify(cmd));

      sendBrowserCommand({
        action: 'jsConsole',
        jsid: cmd.jsid
      }, {specificBrowser: cmd.jsid});
      break;

    default:
      verboseLog('Unknown client command: ' + cmd.action);
      break;
  }
}

rebuildWatchers();

var localServer = http.createServer(function(request, response) {
  var uri = url.parse(request.url).pathname,
      filename = path.join(process.cwd(), uri),
      bossBrowser = request.socket.remoteAddress.match(bossAddress) ? true : false,
      extension,
      $;

  fs.exists(filename, function(exists) {
    if (!exists) {
      if (proxySite) {
        var options = {
            host: proxySite.hostname,
            port: proxySite.port || 80,
            method: request.method,
            path: request.url,
            headers: request.headers,
            agent: request.agent
          };
          options.headers.host = options.host + ':' + options.port;

          var proxy_request = http.request(options, function(proxy_response) {
              proxy_response.on('data', function (chunk) {
                response.write(chunk);
              });
              proxy_response.on('end', function () {
                response.end();
              });
          });

          proxy_request.on('error', function(e) {
            console.log('problem with request: ' + e.message);
          });

          proxy_request.end();
      } else {
        response.writeHead(404, {'Content-Type': 'text/plain'});
        response.write('404 Not Found:' + filename + '\n' + uri + '\n');
        response.end();
        return;
      }
    } else {
      if (fs.statSync(filename).isDirectory()) {
        filename += '/index.html';
      }

      fs.readFile(filename, 'binary', function(err, file) {
        if (err) {
          response.writeHead(500, {'Content-Type': 'text/plain'});
          response.write(err + '\n');
          response.end();
          return;
        }

        extension = filename.split('.').reverse()[0];

        if (bossBrowser && extension == 'html') {
          // Direct remote browsers to the new page.
          mostRecentlyVisited = request.url;
          verboseLog('Most recently visited page: ' + mostRecentlyVisited);
          throttledNavigateBrowser();
        }

        if (extension == 'html') {
          $ = cheerio.load(file);
          $('body').append($(injectionScript));
          if (bossBrowser) {
            $('body').append($(controlDiv));
          }
          file = $.html();
        }

        response.writeHead(200);
        response.write(file, 'binary');
        response.end();
      });
    }
  });
});

localServer.on('error', function(err) {
  dumpErrors(err, {port: port});
  this.close();
});
localServer.listen(parseInt(port, 10));

var wss = new WebSocket.Server({port: wsPort});
wss.on('connection', function(ws) {
  verboseLog('Got a WebSocket connection.');
  webSocketsArray.push(ws);

  ws.on('message', function(message) {
    receiveClientCommands(this, JSON.parse(message));
  });

  ws.on('close', function() {
    updateRemoteBrowsers();
  });
});


if (openBrowser) {
  cp.exec('open http://localhost:' + port + '/');
  mostRecentlyVisited = 'http://localhost:' + port + '/';
}

console.log('Static file server running at\n  => http://localhost:' + port + '/\nCTRL + C to shutdown');
