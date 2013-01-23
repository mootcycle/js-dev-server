# js-dev-server

This is a really simple Mac dev server I'm trying out based on inspiration from
Paul Irish's "[Javascript Development Workflow of 2013](http://www.youtube.com/watch?v=f7AU2Ozu8eo)" talk. The idea is to give you a development http server with one package and minimal dependencies which will monitor files and trigger automatic refreshes for the relevant tabs in your browser.

## Installation

    $ npm install -g js-dev-server

## Usage

Just change to the your development directory and run:

    $ js-dev-server

Without arguments, this will start a server and open a tab in your default browser pointed at that directory. Any time an html, css, or js file is modified (as watched by a [fs.FSWatcher](http://nodejs.org/docs/v0.8.6/api/all.html#all_class_fs_fswatcher)), the server will trigger a refresh in all browser tabs pointed at your development server. (Chrome and Safari work well at the moment. Firefox is a bit of a hack; I haven't found a good way to refresh specific tabs through AppleScript -- pull requests welcome. I'll have to look into Opera support soon.)

## Arguments

#### Port

    -p, --port

Changes the port the dev server runs on. Defaults to 8888.

#### Browsers

    -b, --browsers

Allows you to specify which browser refresh scripts to run. By default, the script will attempt to use your default browser as specified in com.apple.LaunchServices. You can specify multiple browsers as a single comma separated string. (ex: `js-dev-server -b chrome,safari`)

#### Delay

    -d, --delay

Specifies the minimum amount of time to throttle the refresh calls from the dev server.

#### Proxy

    -x, --proxy

Allows you to proxy what would otherwise be 404 requests on your dev server to an external server. It's useful for overlaying your own file edits on top of an existing site.

#### Open

    -o, --open

 Whether or not to open the url to the dev server in your default browser. Defaults to true.

#### Extensions

    -e, --extensions

A list of file extentions to point fs.FSWatcher instances at. You can specify multiple extensions as a single comma separated string. (ex: `js-dev-server -e html,css,js,jpg,png,txt`) Defaults to html,css,js.

## Thanks:
[Paul Irish](https://twitter.com/paul_irish)

 [Ryan Florence](https://github.com/rpflorence) for [static_server.js](https://gist.github.com/701407).

[Brett Terpstra](https://github.com/ttscoff) for his [ruby watcher and AppleScript refresh scripts](http://brettterpstra.com/2011/03/07/watch-for-file-changes-and-refresh-your-browser-automatically/).
