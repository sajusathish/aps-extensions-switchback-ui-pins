/////////////////////////////////////////////////////////////////////
// Extension loader for APS Viewer extensions
/////////////////////////////////////////////////////////////////////

$(document).ready(function () {
  loadJSON(init);

  function init(config) {
    var Extensions = config.Extensions || [];
    var loaderconfig = { Viewer: null };

    Extensions.forEach(function (element) {
      var path = 'extensions/' + element.name + '/contents/';
      (element.filestoload?.cssfiles || []).forEach(function (file) {
        loadjscssfile(path + file, 'css');
      });
      (element.filestoload?.jsfiles || []).forEach(function (file) {
        loadjscssfile(path + file, 'js');
      });
    });

    document.addEventListener('loadextension', function (e) {
      if (!e.detail?.viewer || !e.detail?.extension) return;
      loaderconfig.Viewer = e.detail.viewer;
      e.detail.viewer.loadExtension(e.detail.extension, e.detail.options || {});
    });

    document.addEventListener('unloadextension', function (e) {
      if (!e.detail?.viewer || !e.detail?.extension) return;
      e.detail.viewer.unloadExtension(e.detail.extension);
    });

    document.addEventListener('viewerinstance', function (e) {
      loaderconfig.Viewer = e.detail.viewer;
      loadStartupExtensions(loaderconfig.Viewer);
    });

    function loadStartupExtensions(viewer) {
      Extensions.forEach(function (element) {
        if (element.loadonstartup === 'true') {
          viewer.loadExtension(element.name, element.options || {}).catch(function (error) {
            console.warn('Could not load startup extension:', element.name, error);
          });
        }
      });
    }

    function loadjscssfile(filename, filetype) {
      var existing = Array.from(document.getElementsByTagName(filetype === 'js' ? 'script' : 'link')).some(function (el) {
        return el.getAttribute('src') === filename || el.getAttribute('href') === filename;
      });

      if (existing) return;

      var fileref;

      if (filetype === 'js') {
        fileref = document.createElement('script');
        fileref.setAttribute('type', 'text/javascript');
        fileref.setAttribute('src', filename);
      } else if (filetype === 'css') {
        fileref = document.createElement('link');
        fileref.setAttribute('rel', 'stylesheet');
        fileref.setAttribute('type', 'text/css');
        fileref.setAttribute('href', filename);
      }

      if (fileref) {
        document.getElementsByTagName('head')[0].appendChild(fileref);
      }
    }
  }

  function loadJSON(callback) {
    var xobj = new XMLHttpRequest();
    xobj.overrideMimeType('application/json');
    xobj.open('GET', 'extensions/config.json', true);
    xobj.onreadystatechange = function () {
      if (xobj.readyState == 4 && xobj.status == '200') {
        callback(JSON.parse(xobj.responseText));
      }
    };
    xobj.send(null);
  }
});
