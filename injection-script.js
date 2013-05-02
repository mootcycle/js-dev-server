(function() {
  if (typeof JSON != 'undefined' &&
      typeof WebSocket != 'undefined' &&
      typeof console != 'undefined' &&
      typeof Array.prototype.map != 'undefined') {
    var wsLocation = "ws://" + window.location.hostname + ":%WSPORT%/js-dev-server-refresh";

    document.addEventListener('keypress', function(evt) {
      if (evt.charCode == 54 && evt.ctrlKey) {
        var panel = document.getElementById('js-dev-server-outer');
        if (panel.style.display != 'block') {
          panel.style.display = 'block';
        } else {
          panel.style.display = 'none';
        }
      }
    });

    function openConnection() {
      var jsDevServerSocket = new WebSocket(wsLocation),
          jsid = jsConsoleId();

      function jsConsoleId() {
        var generateSomeHex = function () {
          return Math.floor((Math.random() * 0x10000)).toString(16);
        };

        return ['','','','','',''].map(generateSomeHex).join('-');
      }

      function generateClicker(remoteJsid) {
        return function() {
          jsDevServerSocket.send(JSON.stringify({
            action: 'jsConsole',
            jsid: remoteJsid
          }));

          window.open('http://jsconsole.com/?' + encodeURIComponent(':listen ' + remoteJsid), '_blank');
          window.focus();
        };
      }

      jsDevServerSocket.onopen = function() {
        jsDevServerSocket.send(JSON.stringify({
          action: 'register',
          jsid: jsid
        }));
      };

      jsDevServerSocket.onmessage = function(event) {
        var cmd = JSON.parse(event.data);
        switch(cmd.action) {
          case "reload":
            window.location.reload();
            break;
          case "navigate":
            window.location = cmd.url;
            break;
          case "browsers":
            var a, li, list = document.getElementById('js-dev-server-browser-list');
            if (list) {
              while(list.children.length > 0) {
                list.removeChild(list.children[0]);
              }

              for (var i=0;i<cmd.browserList.length;i++) {
                li = document.createElement('li');
                a = document.createElement('a');
                if (cmd.browserList[i].jsid) {
                  a.href = '#' + cmd.browserList[i].jsid;
                  a.onclick = generateClicker(cmd.browserList[i].jsid);
                }
                a.innerHTML = cmd.browserList[i].name;

                li.appendChild(a);
                list.appendChild(li);
              }
            }
            break;
          case "jsConsole":
            var s = document.createElement('script');
            s.src='http://jsconsole.com/remote.js?' + encodeURIComponent(cmd.jsid);
            document.body.appendChild(s);
            break;
          default:
            console.warn("jsDevServerSocket unknown action: " + cmd.action);
            break;
        }
      };

      jsDevServerSocket.onclose = function() {
        console.log("jsDevServerSocket connection lost -- will retry in 5 seconds.");
        
        setTimeout(function() {
          openConnection();
        }, 5000);
      };
    }
    openConnection();
  }
})();
