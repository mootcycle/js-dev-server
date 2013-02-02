# js-dev-server

This is a really simple Mac dev server I'm trying out based on inspiration from
Paul Irish's "[Javascript Development Workflow of 2013](http://www.youtube.com/watch?v=f7AU2Ozu8eo)" talk. The idea is to give you a development http server with one package and minimal dependencies which will monitor files and trigger automatic refreshes for the relevant tabs in your browser. If you connect remote browsers with WebSocket support, they will also refresh when a file changes on the server.

## Installation

    $ npm install -g js-dev-server

## Usage

Just change to the your development directory and run:

    $ js-dev-server

Without arguments, this will start a server and open a tab in your default browser pointed at that directory. Any time an html, css, or js file is modified (as watched by a [fs.FSWatcher](http://nodejs.org/docs/v0.8.6/api/all.html#all_class_fs_fswatcher)), the server will trigger a refresh in all browser tabs pointed at your development server. If you point browsers on other machines on your local network at the dev server, they will also refresh and follow the navigation of your "boss" browser.

## Arguments

#### Port

    -p, --port

Changes the port the dev server runs on. Defaults to 8888.

#### WebSocket Port

    -wp, --webSocketPort

Changes the port the WebSocket server runs on. (This is for refreshing remote clients.) Defaults to 8889.

#### Watch Depth

    -w, --watchDepth

The search depth for file watchers. All files will be served regardless of depth, but only files within the depth number will be watched for automatic refresh. This is necessary because of per-process limits on open files that are enforced by the operating system.

#### Exclude Strings

    -s, --excludeStrings

A comma separated list of strings that will be matched against the full path of a file. If a match is found, that file will not have a watcher attached to it. This can be useful if you have a directory of components that you won't be modifying. Again, these files will still be served, just not watched for the browser refresh.

#### Boss Address

    -b, --bossAddress

Clients connecting from this address will trigger nagivation change events in all other clients.

#### Delay

    -d, --delay

Specifies the minimum amount of time to throttle the refresh calls from the dev server.

#### Proxy

    -x, --proxy

Allows you to proxy what would otherwise be 404 requests on your dev server to an external server. It's useful for overlaying your own file edits on top of an existing site.

#### Skip Open

    -o, --skipOpen

If set, the browser will not automatically open a new tab for this server.

#### Extensions

    -e, --extensions

A list of file extentions to point fs.FSWatcher instances at. You can specify multiple extensions as a single comma separated string. (ex: `js-dev-server -e html,css,js,jpg,png,txt`) Defaults to html,css,js.

#### Verbose

    -v, --verbose

This prints out additional information about which files are and are not being watched.

## Thanks:
[Paul Irish](https://twitter.com/paul_irish)

 [Ryan Florence](https://github.com/rpflorence) for [static_server.js](https://gist.github.com/701407).

[Brett Terpstra](https://github.com/ttscoff) for his [ruby watcher and AppleScript refresh scripts](http://brettterpstra.com/2011/03/07/watch-for-file-changes-and-refresh-your-browser-automatically/). These scripts gave me the initial version of js-dev-server, but now I've removed all AppleScript from the code.
