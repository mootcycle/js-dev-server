#!/usr/bin/env node
/*jshint multistr:true, supernew: true*/

var http = require('http'),
    url = require('url'),
    path = require('path'),
    fs = require('fs'),
    cp = require('child_process'),
    program = require('commander'),
    WebSocket = require('ws');

program
  .version('0.0.5')
  .option('-p, --port [port]', 'Specify a port number. (default: 8888)', 8888)
  .option('-wp, --webSocketPort [webSocketPort]', 'Specify a port number for the web socket server. (default: 8889)', 8889)
  .option('-w, --watchDepth [watchDepth]', 'Specify how many directory levels deep to add watchers. There is a limit to the number of watchers node will allow. (default: 3)', 3)
  .option('-s, --excludeStrings [excludeStrings]', 'Provide a comma separated list of strings used to exclude files/directories from being watched. (ex: node_modules,components')
  .option('-b, --browsers [browsers]', 'Specify which browsers to refresh; comma separated, no spaces. (ex: chrome,safari)')
  .option('-d, --delay [delay]', 'Specify the minimum number of seconds to throttle refresh commands. (default: 3)', 3)
  .option('-x, --proxy [proxy]', 'Specify a web site to proxy. 404s will load from the proxied site.')
  .option('-o, --skipOpen [skipOpen]', 'If set, the browser will not automatically open a new tab for this server.')
  .option('-e, --extensions [extensions]', 'Specify extensions to track for refreshes; comma separated, no spaces. (default: html,css,js)', 'html,css,js')
  .option('-v, --verbose [verbose]', 'Print additional information about which files are watched/served.')
  .parse(process.argv);

var port = parseInt(program.port, 10) || 8888,
    wsPort = parseInt(program.webSocketPort, 10) || 8888,
    watchDepth = parseInt(program.watchDepth, 10) || 3,
    browsers = program.browsers ? program.browsers.split(',') : [],
    excludeStrings = program.excludeStrings ? program.excludeStrings.split(',') : [],
    proxySite = program.proxy ? url.parse(program.proxy) : null,
    openBrowser = !program.skipOpen,
    verbose = !!program.verbose,
    webFiles = {},
    throttleSeconds = parseInt(program.delay, 10) || 3,
    urlToMatchForRefresh = 'localhost:' + port,
    defaultBrowserCommand = 'defaults read com.apple.LaunchServices LSHandlers | grep -A 2 -B 2 "LSHandlerURLScheme = http;" | grep LSHandlerRoleAll',
    watcherArray = [],
    webSocketsArray = [],
    refreshCommands = {
    chrome: 'osascript <<ENDCOMMAND\n\
tell application "Google Chrome"\n\
  set windowList to every window\n\
  repeat with aWindow in windowList\n\
    set tabList to every tab of aWindow\n\
    repeat with atab in tabList\n\
      if (URL of atab contains "%site%") then\n\
        tell atab to reload\n\
      end if\n\
    end repeat\n\
  end repeat\n\
end tell\n\
ENDCOMMAND',
    safari: 'osascript <<ENDCOMMAND\n\
tell application "Safari"\n\
  set windowList to every window\n\
  repeat with aWindow in windowList\n\
    set tabList to every tab of aWindow\n\
    repeat with atab in tabList\n\
      if (URL of atab contains "%site%") then\n\
        tell atab to do javascript "window.location.reload()"\n\
      end if\n\
    end repeat\n\
  end repeat\n\
end tell\n\
ENDCOMMAND',
    // I can't find a better way to refresh tabs in firefox via command line
    // or AppleScript. Patches welcome. :-/
    firefox: 'osascript <<ENDCOMMAND\n\
tell application "Firefox" to activate\n\
tell application "System Events"\n\
  keystroke "r" using command down\n\
end tell\n\
ENDCOMMAND'
};

var injectedScript = '<script>\n\
(function() {\n\
  if (WebSocket) {\n\
    var refreshSocket = new WebSocket("ws://" + window.location.hostname + ":' + wsPort + '/js-dev-server-refresh");\n\
    refreshSocket.onmessage = function(event) {\n\
      if (event.data == "reload") {\n\
        window.location.reload();\n\
      }\n\
    };\n\
  }\n\
})();\n\
</script>';

program.extensions.split(',').forEach(
  function(ext) {
    this[ext] = true;
  }.bind(webFiles)
);


if (!browsers.length) {
  cp.exec(defaultBrowserCommand, function(error, stdout) {
    if (error) {
      console.log('Error executing default browser command: ' + error);
    } else {
      if (stdout.match('com.google.chrome')) {
        browsers.push('chrome');
      } else if (stdout.match('org.mozilla.firefox')) {
        browsers.push('firefox');
      } else if (stdout.match('com.apple.safari')) {
        browsers.push('safari');
      } else {
        console.log('Unknown default browser!');
      }

      if (browsers.length && openBrowser) {
        cp.exec('open http://localhost:' + port + '/');
      }
    }
  });
}

var throttledRefreshBrowser = (function(delay) {
  var minimumRefresh = delay * 1000;
  var execTime = 0;
  var trailingCall;

  function refresh() {
    execTime = +new Date + minimumRefresh;
    browsers.forEach(function(browser) {
      console.log('Sending refresh command to: ' + browser);
      cp.exec(refreshCommands[browser].replace('%site%', urlToMatchForRefresh));
    });

    var openSockets = [];
    webSocketsArray.forEach(function(ws) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('reload');
        openSockets.push(ws);
      } else {
        verboseLog('Found a dead websocket; removing it from the array. readyState: (' + ws.readyState + ')');
      }
    });

    webSocketsArray = openSockets;
  }

  return function() {
    var now = +new Date;

    if (now > execTime) {
      refresh();
    } else {
      if (trailingCall) {
        clearTimeout(trailingCall);
      }
      trailingCall = setTimeout(refresh, execTime - now);
    }
  };
})(throttleSeconds);

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

rebuildWatchers();

var localServer = http.createServer(function(request, response) {
  var uri = url.parse(request.url).pathname,
      filename = path.join(process.cwd(), uri),
      localBrower = request.connection.remoteAddress == '127.0.0.1' ? true : false;

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
        if(err) {
          response.writeHead(500, {'Content-Type': 'text/plain'});
          response.write(err + '\n');
          response.end();
          return;
        }

        if (localBrower || filename.split('.').reverse()[0] != 'html')  {
          // If the client is a local client, just send the default file.
          // Refreshes will be handled via AppleScript.

          response.writeHead(200);
          response.write(file, 'binary');
          response.end();
        } else {
          response.writeHead(200);
          var newFile = file.replace('</html>', injectedScript + '</html>');
          response.write(newFile, 'binary');
          response.end();
        }
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
});


if (browsers.length && openBrowser) {
  cp.exec('open http://localhost:' + port + '/');
}

console.log('Static file server running at\n  => http://localhost:' + port + '/\nCTRL + C to shutdown');




