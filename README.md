# js-dev-server

This is a simple javascript development server I'm trying out based on inspiration from
Paul Irish's "[Javascript Development Workflow of 2013](http://www.youtube.com/watch?v=f7AU2Ozu8eo)" talk. The idea is to give you a development http server which will monitor files and trigger automatic refreshes for the relevant tabs in your browser. Browsers must have WebSocket support for the automatic refresh and remote browser navigation to function properly. Now with [jsConsole](http://jsconsole.com/) support for all your remote browsers.

## Installation

    $ npm install -g js-dev-server

## Usage

Just change to the your development directory and run:

    $ js-dev-server

Without arguments, this will start a server and open a tab in your default browser pointed at that directory. Any time an html, css, or js file is modified (as watched by a [fs.FSWatcher](http://nodejs.org/docs/v0.8.6/api/all.html#all_class_fs_fswatcher)), the server will trigger a refresh in all browser tabs pointed at your development server. If you point browsers on other machines on your local network at the dev server, they will also refresh and follow the navigation of your "boss" browser. Show and hide the remote browsers pane on the "boss" browser with control-6; click on an IP to open a remote console to that browser.

## Arguments

#### Config File

    -c, --configFile

Allows you to specify a JSON config file for the js-dev-server. By default, js-dev-server will look for files named `.js-dev-server` in the working directory and then in the current user's home directory. When configuration settings conflict, the command line arguments take top priority, followed by the current working directory and then the home directory config file.

#### Port

    -p, --port

Changes the port the dev server runs on. Defaults to 8888.

#### WebSocket Port

    -k, --webSocketPort

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

#### Build Command

    -u, --buildCommand

If you have a build script for your project, you can specify a command to start the build. All file watching is disabled while the build is running, but will be rescanned afterwards. If your build script exits with a value other than 0, js-dev-server will notify you with an error page containing the output of the failed build.

#### Jitter

    -j, --jitter

If your text editor is like mine, it might touch a couple of files when you invoke a save command. If this is the case, you'll want js-dev-server to wait until all that activity is finished before it rescans and refreshes your pages. The jitter option allows you to specify how long to wait before a rescan/refresh will start. The default wait time is 500ms.

#### watchDirectory

    -W, --watchDirectory

The directory to watch for changes. (default: current working directory)

#### serveDirectory

    -S, --serveDirectory

The directory to serve html files from. (default: current working directory)

## Thanks:
[Paul Irish](https://twitter.com/paul_irish)

[Remy Sharp](https://twitter.com/rem) for [jsconsole](http://jsconsole.com) and [nodemon](https://github.com/remy/nodemon).

 [Ryan Florence](https://github.com/rpflorence) for [static_server.js](https://gist.github.com/701407).

[Brett Terpstra](https://github.com/ttscoff) for his [ruby watcher and AppleScript refresh scripts](http://brettterpstra.com/2011/03/07/watch-for-file-changes-and-refresh-your-browser-automatically/). These scripts gave me the initial version of js-dev-server, but now I've removed all AppleScript from the code.
