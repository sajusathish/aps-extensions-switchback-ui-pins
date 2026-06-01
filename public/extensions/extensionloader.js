// Loads viewer extension CSS/JS files listed in public/extensions/config.json.
// Keep individual extension behavior inside each extension folder.
$(document).ready(function () {
  loadJson(initExtensionLoader);

  function initExtensionLoader(config) {
    var extensions = config.Extensions || [];

    extensions.forEach(function (extension) {
      var folderPath = 'extensions/' + extension.name + '/contents/';

      (extension.filestoload?.cssfiles || []).forEach(function (file) {
        loadCssOrScript(folderPath + file, 'css');
      });

      (extension.filestoload?.jsfiles || []).forEach(function (file) {
        loadCssOrScript(folderPath + file, 'js');
      });
    });

    document.addEventListener('loadextension', function (event) {
      if (!event.detail?.viewer || !event.detail?.extension) return;

      event.detail.viewer.loadExtension(event.detail.extension, event.detail.options || {});
    });

    document.addEventListener('unloadextension', function (event) {
      if (!event.detail?.viewer || !event.detail?.extension) return;

      event.detail.viewer.unloadExtension(event.detail.extension);
    });

    document.addEventListener('viewerinstance', function (event) {
      loadStartupExtensions(event.detail.viewer);
    });

    function loadStartupExtensions(viewer) {
      extensions.forEach(function (extension) {
        if (extension.loadonstartup === 'true') {
          var extensionId = extension.extensionId || extension.name;

          if (viewer.getExtension(extensionId)) return;

          viewer.loadExtension(extensionId, extension.options || {}).catch(function (error) {
            console.warn('Could not load startup extension:', extensionId, error);
          });
        }
      });
    }

    function loadCssOrScript(filename, filetype) {
      var tagName = filetype === 'js' ? 'script' : 'link';
      var existing = Array.from(document.getElementsByTagName(tagName)).some(function (element) {
        return element.getAttribute('src') === filename || element.getAttribute('href') === filename;
      });

      if (existing) return;

      var fileElement;

      if (filetype === 'js') {
        fileElement = document.createElement('script');
        fileElement.setAttribute('type', 'text/javascript');
        fileElement.setAttribute('src', filename);
      } else if (filetype === 'css') {
        fileElement = document.createElement('link');
        fileElement.setAttribute('rel', 'stylesheet');
        fileElement.setAttribute('type', 'text/css');
        fileElement.setAttribute('href', filename);
      }

      if (fileElement) {
        document.head.appendChild(fileElement);
      }
    }
  }

  function loadJson(callback) {
    var request = new XMLHttpRequest();
    request.overrideMimeType('application/json');
    request.open('GET', 'extensions/config.json', true);
    request.onreadystatechange = function () {
      if (request.readyState === 4 && request.status === 200) {
        callback(JSON.parse(request.responseText));
      }
    };
    request.send(null);
  }
});
