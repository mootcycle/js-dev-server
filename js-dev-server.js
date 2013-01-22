#!/usr/local/bin/node

var http = require("http"),
    url = require("url"),
    path = require("path"),
    fs = require("fs"),
    cp = require('child_process'),
    program = require('commander');

program
  .version('0.0.1')
  .option('-p, --port [port]', 'Specify a port number. (default: 8888)', 8888)
  .option('-b, --browsers [browsers]', 'Specify which browsers to refresh; comma separated without spaces. (ex: chrome,safari)')
  .option('-d, --delay [delay]', 'Specify the minimum number of seconds to throttle refresh commands. (default: 3)', 3)
  .option('-s, --shadow [shadow]', 'Specify a web site to shadow these files over top of.')
  .option('-o, --open [open]', 'Should the directory be opened in a browser window automatically. (default: true)', 'true')
  .parse(process.argv);

var port = parseInt(program.port, 10) || 8888,
    browsers = program.browsers ? program.browsers.split(',') : [],
    shadowSite = program.shadow ? url.parse(program.shadow) : null,
    open = program.open == 'true' ? true : false,
    mime = {
      "html": "text/html",
      "css": "text/css",
      "js": "application/javascript"
    },
    throttleSeconds = parseInt(program.delay, 10) || 3,
    urlToMatchForRefresh = 'localhost:' + port;
    defaultBrowserCommand = 'defaults read com.apple.LaunchServices LSHandlers | grep -A 2 -B 2 "LSHandlerURLScheme = http;" | grep LSHandlerRoleAll',
    watcherArray = [],
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

if (!browsers.length) {
  cp.exec(defaultBrowserCommand, function(error, stdout, stderr) {
    if (error) {
      console.log('Error: ' + error);
    } else {
      if (stdout.match('com.google.chrome')) {
        browsers.push('chrome');
      } else if (stdout.match('org.mozilla.firefox')) {
        browsers.push('firefox');
      } else if (stdout.match('com.apple.safari')) {
        browsers.push('safari');
      } else {
        throw new Error('Unknown default browser!');
      }
    }
  });
}

var throttledRefreshBrowser = (function(delay) {
  var minimumRefresh = delay * 1000;
  var execTime = 0;
  var trailingCall;

  function refresh() {
    execTime = +new Date() + minimumRefresh;
    browsers.forEach(function(browser) {
      console.log('Refreshing: ' + browser);
      cp.exec(refreshCommands[browser].replace('%site%', urlToMatchForRefresh));
    });
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
  }
})(throttleSeconds);

function getExtension(file) {
  var arr = file.split('.');
  return arr[arr.length - 1];
}

function fileChangeFactory(path) {
  return function(evt, filename) {
    if (evt == 'change') {
      console.log('file change event: ' + path);
      throttledRefreshBrowser();
    } else {
      console.log('file rename event: ' + path);
      rebuildWatchers();
    }
  }
}

function directoryChangeFactory(path) {
  return function(evt, filename) {
    console.log('directory changed: ' + path + ' event is ' + evt);
    rebuildWatchers();
  }
}

function rebuildWatchers() {
  watcherArray.forEach(function(watcher) {
    watcher.close();
  });

  watcherArray.length = 0;
  scanDirectory('.');
}

function scanDirectory(path) {
  watcherArray.push(fs.watch(path, {}, directoryChangeFactory(path)));
  console.log('watching directory: ' + path);

  var list = fs.readdirSync(path);
  list.forEach(function(file) {
    var fullPath = path + '/' + file;

    var stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (err) {
      stat = null;
    }
    if (stat) {
      if (stat.isDirectory()) {
        scanDirectory(fullPath);
      } else {
        if (mime[getExtension(file)]) {
          // Add a watcher to all web text files.
          watcherArray.push(fs.watch(fullPath, {}, fileChangeFactory(fullPath)));
          console.log('watching file: ' + fullPath);
        }
      }
    }
  });
}

rebuildWatchers();

http.createServer(function(request, response) {

  var uri = url.parse(request.url).pathname,
      filename = path.join(process.cwd(), uri);

  fs.exists(filename, function(exists) {
    if (!exists) {
      if (shadowSite) {
        var options = {
            host: shadowSite.hostname,
            port: shadowSite.port || 80,
            method: request.method,
            path: request.url,
            headers: request.headers,
            agent: request.agent
          };
          options.headers.host = options.host + ':' + options.port

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
        response.writeHead(404, {"Content-Type": "text/plain"});
        response.write("404 Not Found:" + filename + "\n" + uri + "\n");
        response.end();
        return;
      }
    } else {
      if (fs.statSync(filename).isDirectory()) {
        filename += '/index.html';
      }

      fs.readFile(filename, "binary", function(err, file) {
        if(err) {        
          response.writeHead(500, {"Content-Type": "text/plain"});
          response.write(err + "\n");
          response.end();
          return;
        }

        response.writeHead(200);
        response.write(file, "binary");
        response.end();
      });
    }
  });
}).listen(parseInt(port, 10));

if (open) {
  cp.exec('open http://localhost:' + port + '/');
}

console.log("Static file server running at\n  => http://localhost:" + port + "/\nCTRL + C to shutdown");




