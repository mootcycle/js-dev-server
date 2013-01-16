# jsDevServer

This is a really simple hacky dev server I'm trying out based on inspiration
from Paul Irish's "Javascript Development Workflow of 2013" talk.

The concept is really simple. Just go to a directory you're working with and
invoke jsDevServer. It will open a basic web server (thanks to rpflorence for 
static_server.js (<https://gist.github.com/701407>)) for the files in that 
directory. (Default port 8888, but the first argument will change this.) Google 
Chrome will open a new tab to the server and a ruby script I got from
Brett Terpstra (<http://brettterpstra.com>) will watch that directory and
refresh your browser if any of the web related files change.

# Installation

None, just clone the repo. If you want, you can `chmod a+x server.js` and add a
soft link in `/usr/local/bin`. That's what I did.

