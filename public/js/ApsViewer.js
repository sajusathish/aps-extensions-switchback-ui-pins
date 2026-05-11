/////////////////////////////////////////////////////////////////////
// APS Viewer launcher
/////////////////////////////////////////////////////////////////////

var viewer;
var fileName;
var currentViewerDocument = null;
var currentViewerModelInfo = null;
var viewerLoadDocumentNodePatched = false;

function launchViewer(urn, name, modelInfo) {
  var options = {
    env: 'AutodeskProduction',
    getAccessToken: getApsToken
  };

  fileName = name;
  currentViewerModelInfo = modelInfo || { urn: urn, name: name };
  window.currentModelInfo = currentViewerModelInfo;

  Autodesk.Viewing.Initializer(options, function () {
    var viewerContainer = document.getElementById('apsViewer');

    if (!viewerContainer) {
      console.error('Viewer container #apsViewer was not found.');
      return;
    }

    if (viewer && typeof viewer.finish === 'function') {
      try {
        viewer.finish();
      } catch (error) {
        console.warn('Could not finish previous viewer instance:', error);
      }
    }

    viewerContainer.innerHTML = '';

    viewer = new Autodesk.Viewing.GuiViewer3D(viewerContainer, {
      extensions: [
        'Autodesk.DocumentBrowser'
      ]
    });

    var startedCode = viewer.start(null, null, null, null, {
      webglInitParams: {
        useWebGL2: false
      }
    });

    if (startedCode > 0) {
      viewerContainer.innerHTML = 'Viewer failed to start. Code: ' + startedCode;
      return;
    }

    window.viewer = viewer;

    patchLoadDocumentNodeForViewChanges();

    var documentId = urn.startsWith('urn:') ? urn : 'urn:' + urn;

    Autodesk.Viewing.Document.load(
      documentId,
      onDocumentLoadSuccess,
      onDocumentLoadFailure
    );
  });
}

function onDocumentLoadSuccess(doc) {
  currentViewerDocument = doc;
  window.currentDocument = doc;

  var defaultViewable = doc.getRoot().getDefaultGeometry();

  if (!defaultViewable) {
    document.getElementById('apsViewer').innerHTML = 'The model loaded, but no default geometry was found.';
    return;
  }

  loadDocumentBrowser();

  viewer.loadDocumentNode(doc, defaultViewable).then(function (model) {
    dispatchViewerInstance(model, doc, defaultViewable, 'initial-load');
  }).catch(function (error) {
    console.error('Could not load default viewable:', error);
    document.getElementById('apsViewer').innerHTML = 'Could not load default viewable.';
  });
}

function patchLoadDocumentNodeForViewChanges() {
  if (!viewer || viewerLoadDocumentNodePatched) return;

  if (typeof viewer.loadDocumentNode !== 'function') {
    console.warn('viewer.loadDocumentNode is not available to patch.');
    return;
  }

  var originalLoadDocumentNode = viewer.loadDocumentNode.bind(viewer);

  viewer.loadDocumentNode = function patchedLoadDocumentNode(doc, node, options) {
    var result = originalLoadDocumentNode(doc, node, options);

    Promise.resolve(result)
      .then(function (model) {
        currentViewerDocument = doc || currentViewerDocument;
        window.currentDocument = currentViewerDocument;

        dispatchViewerInstance(
          model,
          doc || currentViewerDocument,
          node,
          'document-view-changed'
        );

        window.setTimeout(function () {
          dispatchViewerViewChanged(model, doc || currentViewerDocument, node);
        }, 300);

        window.setTimeout(function () {
          dispatchViewerViewChanged(model, doc || currentViewerDocument, node);
        }, 900);
      })
      .catch(function (error) {
        console.warn('Patched loadDocumentNode failed:', error);
      });

    return result;
  };

  viewerLoadDocumentNodePatched = true;
}

function dispatchViewerInstance(model, doc, node, reason) {
  var activeView = getViewableInfo(node);

  var detail = {
    viewer: viewer,
    model: model || viewer.model || null,
    document: doc || currentViewerDocument || null,
    viewable: node || null,
    activeView: activeView,
    reason: reason || 'viewerinstance',
    modelInfo: {
      ...(window.currentModelInfo || currentViewerModelInfo || {}),
      activeView: activeView
    }
  };

  window.currentModelInfo = detail.modelInfo;

  var viewerInstance = new CustomEvent('viewerinstance', {
    detail: detail
  });

  document.dispatchEvent(viewerInstance);
}

function dispatchViewerViewChanged(model, doc, node) {
  var activeView = getViewableInfo(node);

  var event = new CustomEvent('viewerdocumentviewchanged', {
    detail: {
      viewer: viewer,
      model: model || viewer.model || null,
      document: doc || currentViewerDocument || null,
      viewable: node || null,
      activeView: activeView,
      modelInfo: {
        ...(window.currentModelInfo || currentViewerModelInfo || {}),
        activeView: activeView
      }
    }
  });

  document.dispatchEvent(event);
}

function getViewableInfo(node) {
  if (!node) {
    return {
      guid: null,
      name: null,
      role: null,
      type: null
    };
  }

  var data = node.data || {};

  return {
    guid: data.guid || data.viewableID || data.id || null,
    name: data.name || data.displayName || null,
    role: data.role || null,
    type: data.type || null
  };
}

function loadDocumentBrowser() {
  if (!viewer) return;

  if (viewer.getExtension('Autodesk.DocumentBrowser')) {
    console.log('Autodesk.DocumentBrowser already loaded.');
    return;
  }

  viewer.loadExtension('Autodesk.DocumentBrowser')
    .then(function () {
      console.log('Autodesk.DocumentBrowser loaded.');
    })
    .catch(function (error) {
      console.warn('Could not load Autodesk.DocumentBrowser:', error);
    });
}

function onDocumentLoadFailure(viewerErrorCode) {
  console.error('onDocumentLoadFailure() - errorCode:', viewerErrorCode);
  document.getElementById('apsViewer').innerHTML = 'Could not load model. Viewer error: ' + viewerErrorCode;
}

function getApsToken(callback) {
  fetch('/api/auth/token')
    .then(function (res) {
      if (!res.ok) {
        throw new Error('Could not get APS token. Please log in again.');
      }

      return res.json();
    })
    .then(function (data) {
      callback(data.access_token, data.expires_in);
    })
    .catch(function (err) {
      console.error(err);
      alert(err.message);
    });
}