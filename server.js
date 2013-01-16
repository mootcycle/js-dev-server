#!/usr/local/bin/node

var http = require("http"),
    url = require("url"),
    path = require("path"),
    fs = require("fs"),
    cp = require('child_process'),
    port = process.argv[2] || 8888;

http.createServer(function(request, response) {

  var uri = url.parse(request.url).pathname,
      filename = path.join(process.cwd(), uri);

  fs.exists(filename, function(exists) {
    if(!exists) {
      response.writeHead(404, {"Content-Type": "text/plain"});
      response.write("404 Not Found:" + filename + "\n" + uri + "\n");
      response.end();
      return;
    }

	if (fs.statSync(filename).isDirectory()) filename += '/index.html';

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
  });
}).listen(parseInt(port, 10));


var watcher = cp.spawn('ruby', [path.resolve(__dirname, 'watch.rb'), process.cwd(), 'localhost:' + port]);

watcher.stdout.on('data', function (data) {
  console.log('Watcher: ' + data);
});

watcher.stderr.on('data', function (data) {
  console.log('Watcher error: ' + data);
});

cp.exec('open http://localhost:' + port + '/');

console.log("Static file server running at\n  => http://localhost:" + port + "/\nCTRL + C to shutdown");

