#!/usr/bin/env node
/*jshint multistr:true, supernew: true*/

var http = require('http'),
    url = require('url'),
    path = require('path'),
    fs = require('fs'),
    cp = require('child_process'),
    os = require('os'),
    program = require('commander'),
    WebSocket = require('ws'),
    cheerio = require('cheerio'),
    // Default config values.
    config = {
      configFile: '.js-dev-server',
      port: 8888,
      webSocketPort: 8889,
      watchDepth: 3,
      excludeStrings: '',
      bossAddress: '127.0.0.1',
      delay: '3',
      proxy: '',
      skipOpen: false,
      extensions: 'html,css,js',
      verbose: false,
      buildCommand: '',
      jitter: 500,
      watchDirectory: '.',
      serveDirectory: '.'
    };

program
  .version('0.1.0')
  .option('-c, --configFile [configFile]', 'Load options from a config file.')
  .option('-p, --port [port]', 'Specify a port number. (default: 8888)')
  .option('-k, --webSocketPort [webSocketPort]', 'Specify a port number for the web socket server. (default: 8889)')
  .option('-w, --watchDepth [watchDepth]', 'Specify how many directory levels deep to add watchers. There is a limit to the number of watchers node will allow. (default: 3)')
  .option('-s, --excludeStrings [excludeStrings]', 'Provide a comma separated list of strings used to exclude files/directories from being watched. (ex: node_modules,components')
  .option('-b, --bossAddress [bossAddress]', 'Specify the IP address from which the main development browser will connect from. (default: 127.0.0.1)')
  .option('-d, --delay [delay]', 'Specify the minimum number of seconds to throttle refresh commands. (default: 3)')
  .option('-x, --proxy [proxy]', 'Specify a web site to proxy. 404s will load from the proxied site.')
  .option('-o, --skipOpen [skipOpen]', 'If set, the browser will not automatically open a new tab for this server.')
  .option('-e, --extensions [extensions]', 'Specify extensions to track for refreshes; comma separated, no spaces. (default: html,css,js)')
  .option('-v, --verbose [verbose]', 'Print additional information about which files are watched/served.')
  .option('-u, --buildCommand [buildCommand]', 'Execute this command after a watched file changes; wait for it to complete before refreshing browsers.')
  .option('-j, --jitter [jitter]', 'The number of milliseconds to wait before initiating a rebuild/refresh. (default: 500)')
  .option('-W, --watchDirectory [watchDirectory]', 'The directory to watch for changes. (default: current working directory)')
  .option('-S, --serveDirectory [serveDirectory]', 'The directory to serve html files from. (default: current working directory)')
  .parse(process.argv);

// Make sure the verbose and config file values are checked before loading settings.
overrideConfig('configFile');
overrideConfig('verbose');

// Attempt to read config files.
readConfigFile(process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'] + '/' + config.configFile);
readConfigFile(config.configFile);

// Override the rest of the settings if they've been passed in by the user.
for (var c in config) {
  overrideConfig(c);
}

// Perform processing on user inputs.
config.proxy = config.proxy ? url.parse(config.proxy) : null,
config.skipOpen = !!config.skipOpen;
config.verbose = !!config.verbose;
config.delay = parseInt(config.delay, 10) || 3;
config.jitter = parseInt(config.jitter, 10) || 500;

var watchedExtensions = {},
    excludeStringsArray = [],
    webClients = {},
    mostRecentlyVisited,
    buildFailStdout = '',
    watcherArray = [],
    webSocketsArray = [],
    injectionScript = '<script>' + fs.readFileSync(__dirname + '/injection-script.js').toString().replace('%WSPORT%', config.webSocketPort) + '</script>',
    controlDiv = fs.readFileSync(__dirname + '/control-div.html').toString(),
    buildFailHtml = fs.readFileSync(__dirname + '/build-failure.html').toString(),
    interfaces = os.networkInterfaces(),
    throttledRefreshBrowser = throttleizer(config.delay, config.jitter, refreshBrowsers),
    throttledNavigateBrowser = throttleizer(config.delay, config.jitter, navigateBrowsers),
    throttledRebuildWatchers = throttleizer(config.delay, config.jitter, rebuildWatchers);

config.extensions.split(',').forEach(
  function(ext) {
    this['.' + ext] = true;
  }.bind(watchedExtensions)
);
config.excludeStrings.split(',').forEach(
  function(str) {
    this.push(str);
  }.bind(excludeStringsArray)
);

function overrideConfig(key) {
  config[key] = program[key] || config[key];
}

function readConfigFile(configPath) {
  configPath = path.resolve(configPath);
  var file,
      loadConfig = {
        loadConfig: configPath
      };

  if (fs.existsSync(configPath)) {
    verboseLog('Loading values from: ' + path.resolve(configPath));
    try {
      file = JSON.parse(fs.readFileSync(configPath));
      for (var s in file) {
        config[s] = file[s];
      }
    } catch(err) {
      dumpErrors(err, loadConfig);
    }
  }
}

function throttleizer(delay, jitter, callback) {
  var minimumRefresh = delay * 1000;
  var execTime = 0;
  var timeoutCall;

  function wrappedCallback() {
    execTime = +new Date + minimumRefresh;
    callback();
  }

  return function() {
    var now = +new Date;

    if (timeoutCall) {
      clearTimeout(timeoutCall);
    }
    if (now > execTime) {
      timeoutCall = setTimeout(wrappedCallback, jitter);
    } else {
      timeoutCall = setTimeout(wrappedCallback, execTime - now);
    }
  };
}

function refreshBrowsers() {
  console.log('Refreshing browsers.');
  sendBrowserCommand({
    action: 'reload'
  }, {boss: true, remoteBrowsers: true});
}

function navigateBrowsers() {
  console.log('Navigating browsers to: ' + mostRecentlyVisited);
  sendBrowserCommand({
    action: 'navigate',
    url: mostRecentlyVisited
  }, {remoteBrowsers: true});
}

function updateRemoteBrowsers() {
  var list = [];
  for (var wc in webClients) {
    if (webClients[wc].readyState === WebSocket.OPEN && !webClients[wc]._socket.remoteAddress.match(config.bossAddress)) {
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
      if (targets.boss && ws._socket.remoteAddress.match(config.bossAddress)) {
        ws.send(JSON.stringify(cmd));
      }

      if (targets.remoteBrowsers && !ws._socket.remoteAddress.match(config.bossAddress)) {
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

function fileChangeFactory(filePath) {
  return function(evt) {
    if (evt == 'change') {
      verboseLog('File change event: ' + filePath);
      if (config.buildCommand) {
        closeWatchers();
        cp.exec(config.buildCommand, function(error, stdout) {
          verboseLog('Build output: \n' + stdout + '\n');

          if (error) {
            buildFailStdout = stdout.toString().replace('\n', '<br>\n');
            console.error('Build failed: \n' + error + '\n');
          } else {
            buildFailStdout = '';
            verboseLog('Build completed successfully.');
          }
          throttledRebuildWatchers();
          throttledRefreshBrowser();
        });
      } else {
        throttledRefreshBrowser();
      }
    } else {
      verboseLog('File rename event: ' + filePath);
      // Not sure I actually need to rebuild the watchers here, but I will.
      throttledRebuildWatchers();
      throttledRefreshBrowser();
    }
  };
}

function directoryChangeFactory(dirPath) {
  return function(evt, filename) {
    verboseLog('Directory change event at: ' + dirPath);
    // TODO: don't rescan the entire tree.
    throttledRebuildWatchers();
    throttledRefreshBrowser();
  };
}

function verboseLog(str) {
  if (config.verbose) {
    console.log(str);
  }
}

function dumpErrors(err, options) {
  switch (err.code) {
    case 'EMFILE':
      console.error('js-dev-server tried to open too many files at a directory depth of ' + options.depth + '.\nTry restricting the watch depth to ' + (options.depth - 1) + ' with the -w option or limiting the matching files with the -s option.');
      break;

    case 'EADDRINUSE':
      console.error('Port ' + options.port + ' is already in use. Try specifying another port using the -p argument.');
      break;

    default:
      if (options.fullPath) {
        console.error('Fullpath error occurred: (' + err.code + '): ' + err);
        console.error(JSON.stringify(options, null, 2));
      } else if (options.loadConfig) {
        console.error('Syntax error loading config file: ' + options.loadConfig);
        console.error('Is it valid JSON?');
      } else {
        console.error('An unhandled error occurred: (' + err.code + '): ' + err);
      }
      break;
  }

  process.exit();
}

function closeWatchers() {
  watcherArray.forEach(function(watcher) {
    watcher.close();
  });

  watcherArray.length = 0;
}

function rebuildWatchers() {
  console.log('Rebuilding file watchers.');
  
  closeWatchers();

  scanDirectory(config.watchDirectory);
}

function scanDirectory(scanPath, depth) {
  //watcherArray.push(fs.watch(scanPath, {}, directoryChangeFactory(scanPath)));
  depth = depth || 0;

  var list = fs.readdirSync(scanPath);
  list.forEach(function(file) {
    var fullPath = scanPath + '/' + file;

    var stat, exclude;

    try {
      try {
        stat = fs.statSync(fullPath);
      } catch (err) {
        stat = null;
      }
      if (stat) {
        if (stat.isDirectory()) {
          if (config.watchDepth >= depth) {
            verboseLog('At depth ' + depth + '; recursing into: ' + fullPath);

            scanDirectory(fullPath, depth + 1);
          } else {
            verboseLog('Reached maximum depth at: ' + fullPath);
          }
        } else {
          if (watchedExtensions[path.extname(file)]) {
            exclude = false;
            excludeStringsArray.forEach(function(str) {
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
      if (err.code == "ENOENT") {
        verboseLog('File not found error during refresh; delaying 1 second and rescanning.');
        setTimeout(function() {
          scanDirectory('.');
        }, 1000);
      } else {
        dumpErrors(err, {fullPath:fullPath, depth: depth});
      }
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

var localServer = http.createServer(function(request, response) {
  var uri = url.parse(request.url).pathname,
      startPath = path.join(process.cwd(), config.serveDirectory),
      filename = path.join(startPath, uri),
      bossBrowser = request.socket.remoteAddress.match(config.bossAddress) ? true : false,
      contentType,
      extension,
      $;

  if (buildFailStdout) {
    $ = cheerio.load(buildFailHtml.replace('%error%', buildFailStdout));
    $('body').append($(injectionScript));
    response.writeHead(500, {'Content-Type': 'text/html'});
    response.write($.html());
    response.end();
    return;
  }
  fs.exists(filename, function(exists) {
    if (!exists) {
      if (config.proxy) {
        var options = {
            host: config.proxy.hostname,
            port: config.proxy.port || 80,
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

        switch(extension) {
          case 'html':
            contentType = {'Content-Type': 'text/html'};
            $ = cheerio.load(file);
            $('body').append($(injectionScript));
            if (bossBrowser) {
              $('body').append($(controlDiv));
            }
            file = $.html();
            break;

          case 'js':
            contentType = {'Content-Type': 'application/javascript'};
            break;

          case 'css':
            contentType = {'Content-Type': 'text/css'};
            break;

          case 'appcache':
            contentType = {'Content-Type': 'text/cache-manifest'};
            break;
        }

        response.writeHead(200, contentType);
        response.write(file, 'binary');
        response.end();
      });
    }
  });
});

rebuildWatchers();

localServer.on('error', function(err) {
  dumpErrors(err, {port: config.port});
  this.close();
});
localServer.listen(parseInt(config.port, 10));

var wss = new WebSocket.Server({port: config.webSocketPort});
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

if (!config.skipOpen) {
  cp.exec('open http://localhost:' + config.port + '/');
  mostRecentlyVisited = 'http://localhost:' + config.port + '/';
}

console.log('Static file server running at:');
for (var iface in interfaces) {
  interfaces[iface].forEach(function(a) {
    if (a.family == 'IPv4') {
      console.log('(' + iface + ') => http://' + a.address + ':' + config.port);
    }
  });
}

console.log('CTRL + C to shutdown');

verboseLog('Running with options: ' + JSON.stringify(config, null, 2));