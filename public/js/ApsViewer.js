/////////////////////////////////////////////////////////////////////
// APS Viewer launcher
// Preserves full review context when switching views from Document Browser
/////////////////////////////////////////////////////////////////////

var viewer;
var fileName;
var currentViewerDocument = null;
var currentViewerModelInfo = null;
var viewerLoadDocumentNodePatched = false;
var skipNextViewContextRestore = false;

var PRESERVE_REVIEW_CONTEXT_ON_DOCUMENT_SWITCH = true;

var lastUserContextBeforeViewSwitch = null;
var lastUserContextCaptureTime = 0;
var pendingViewContextRestore = null;

function launchViewer(urn, name, modelInfo) {
  var options = {
    env: 'AutodeskProduction',
    getAccessToken: getApsToken
  };

  fileName = name;
  currentViewerModelInfo = modelInfo || {
    urn: urn,
    name: name
  };

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
        'Autodesk.DocumentBrowser',
        'RevitSwitchback',
        'AccIssuePins'
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

    installPreDocumentBrowserContextCapture();
    installViewerLoadEventsForContextRestore();
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

  skipNextViewContextRestore = true;

  viewer.loadDocumentNode(doc, defaultViewable).then(function (model) {
    dispatchViewerInstance(model, doc, defaultViewable, 'initial-load');
  }).catch(function (error) {
    console.error('Could not load default viewable:', error);
    document.getElementById('apsViewer').innerHTML = 'Could not load default viewable.';
  });
}

/////////////////////////////////////////////////////////////////////
// Capture full context before Document Browser changes view
/////////////////////////////////////////////////////////////////////

function installPreDocumentBrowserContextCapture() {
  var viewerContainer = document.getElementById('apsViewer');

  if (!viewerContainer) return;

  viewerContainer.addEventListener('pointerdown', function () {
    captureContextBeforePossibleViewSwitch('pointerdown');
  }, true);

  viewerContainer.addEventListener('mousedown', function () {
    captureContextBeforePossibleViewSwitch('mousedown');
  }, true);

  viewerContainer.addEventListener('click', function () {
    captureContextBeforePossibleViewSwitch('click');
  }, true);

  viewerContainer.addEventListener('keydown', function () {
    captureContextBeforePossibleViewSwitch('keydown');
  }, true);
}

function captureContextBeforePossibleViewSwitch(reason) {
  if (!viewer || !viewer.model || !viewer.navigation) return;

  var context = captureViewerReviewContext();

  if (!context) return;

  lastUserContextBeforeViewSwitch = context;
  lastUserContextCaptureTime = Date.now();

  console.log('[ApsViewer] Captured review context before possible view switch:', reason);
}

function getBestContextForViewSwitch() {
  var now = Date.now();

  if (
    lastUserContextBeforeViewSwitch &&
    lastUserContextCaptureTime &&
    now - lastUserContextCaptureTime < 8000
  ) {
    return lastUserContextBeforeViewSwitch;
  }

  return captureViewerReviewContext();
}

/////////////////////////////////////////////////////////////////////
// Patch loadDocumentNode
/////////////////////////////////////////////////////////////////////

function patchLoadDocumentNodeForViewChanges() {
  if (!viewer || viewerLoadDocumentNodePatched) return;

  if (typeof viewer.loadDocumentNode !== 'function') {
    console.warn('viewer.loadDocumentNode is not available to patch.');
    return;
  }

  var originalLoadDocumentNode = viewer.loadDocumentNode.bind(viewer);

  viewer.loadDocumentNode = function patchedLoadDocumentNode(doc, node, options) {
    var shouldSkipRestore = skipNextViewContextRestore;
    var contextBeforeSwitch = shouldSkipRestore ? null : getBestContextForViewSwitch();

    skipNextViewContextRestore = false;

    var result = originalLoadDocumentNode(doc, node, options);

    Promise.resolve(result)
      .then(function (model) {
        currentViewerDocument = doc || currentViewerDocument;
        window.currentDocument = currentViewerDocument;

        if (
          PRESERVE_REVIEW_CONTEXT_ON_DOCUMENT_SWITCH &&
          !shouldSkipRestore &&
          contextBeforeSwitch &&
          model &&
          !is2DModel(model)
        ) {
          pendingViewContextRestore = {
            context: contextBeforeSwitch,
            model: model,
            createdAt: Date.now(),
            reason: 'document-browser-load'
          };

          restoreContextWithRetries(contextBeforeSwitch, model, 'document-browser-load');
        }

        dispatchViewerInstance(
          model,
          doc || currentViewerDocument,
          node,
          shouldSkipRestore ? 'initial-load' : 'document-view-changed'
        );

        window.setTimeout(function () {
          dispatchViewerViewChanged(model, doc || currentViewerDocument, node);
        }, 300);

        window.setTimeout(function () {
          dispatchViewerViewChanged(model, doc || currentViewerDocument, node);
        }, 900);

        if (typeof window.accIssuePinsRedraw === 'function') {
          window.setTimeout(function () {
            window.accIssuePinsRedraw();
          }, 450);

          window.setTimeout(function () {
            window.accIssuePinsRedraw();
          }, 1000);

          window.setTimeout(function () {
            window.accIssuePinsRedraw();
          }, 1800);
        }
      })
      .catch(function (error) {
        console.warn('Patched loadDocumentNode failed:', error);
      });

    return result;
  };

  viewerLoadDocumentNodePatched = true;
}

/////////////////////////////////////////////////////////////////////
// Restore again after geometry/model events because DocumentBrowser can override late
/////////////////////////////////////////////////////////////////////

function installViewerLoadEventsForContextRestore() {
  if (!viewer || typeof viewer.addEventListener !== 'function') return;

  var restoreAfterEvent = function (event) {
    if (!pendingViewContextRestore) return;

    var age = Date.now() - pendingViewContextRestore.createdAt;

    if (age > 10000) {
      pendingViewContextRestore = null;
      return;
    }

    var activeModel = event?.model || viewer.model || pendingViewContextRestore.model;

    if (!activeModel || is2DModel(activeModel)) return;

    window.setTimeout(function () {
      restoreReviewContextToModel(
        pendingViewContextRestore.context,
        activeModel,
        'late-viewer-event'
      );

      if (typeof window.accIssuePinsRedraw === 'function') {
        window.accIssuePinsRedraw();
      }
    }, 150);
  };

  viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, restoreAfterEvent);
  viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, restoreAfterEvent);
  viewer.addEventListener(Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT, restoreAfterEvent);
}

function restoreContextWithRetries(context, model, reason) {
  var delays = [0, 100, 350, 700, 1200, 2000, 3200];

  delays.forEach(function (delay) {
    window.setTimeout(function () {
      restoreReviewContextToModel(context, model || viewer.model, reason + '-' + delay);

      if (typeof window.accIssuePinsRedraw === 'function') {
        window.accIssuePinsRedraw();
      }
    }, delay);
  });
}

/////////////////////////////////////////////////////////////////////
// Full review context capture
/////////////////////////////////////////////////////////////////////

function captureViewerReviewContext() {
  if (!viewer || !viewer.navigation) return null;

  try {
    var cameraContext = captureCameraContext();
    var sectionContext = captureSectionContext();

    if (!cameraContext) return null;

    return {
      camera: cameraContext,
      section: sectionContext,
      capturedAt: new Date().toISOString()
    };
  } catch (error) {
    console.warn('[ApsViewer] Could not capture viewer review context:', error);
    return null;
  }
}

function captureCameraContext() {
  var nav = viewer.navigation;
  var camera = viewer.getCamera ? viewer.getCamera() : null;

  var eye =
    nav.getPosition && typeof nav.getPosition === 'function'
      ? nav.getPosition()
      : camera?.position;

  var target =
    nav.getTarget && typeof nav.getTarget === 'function'
      ? nav.getTarget()
      : null;

  var up = camera?.up || null;

  if (!eye || !target) return null;

  var eyeVector = toVector3(eye);
  var targetVector = toVector3(target);
  var upVector = up ? toVector3(up) : new THREE.Vector3(0, 0, 1);

  var direction = eyeVector.clone().sub(targetVector);
  var distance = direction.length();

  if (!Number.isFinite(distance) || distance <= 0) return null;

  direction.normalize();

  return {
    eye: eyeVector,
    target: targetVector,
    up: upVector,
    direction: direction,
    distance: distance,

    isPerspective: camera?.isPerspectiveCamera === true,
    isOrthographic: camera?.isOrthographicCamera === true,

    fov: camera?.fov || null,
    aspect: camera?.aspect || null,
    near: camera?.near || null,
    far: camera?.far || null,

    orthographic: camera?.isOrthographicCamera === true
      ? {
          left: camera.left,
          right: camera.right,
          top: camera.top,
          bottom: camera.bottom,
          zoom: camera.zoom || 1,
          scale: Math.abs(camera.top - camera.bottom)
        }
      : null
  };
}

function captureSectionContext() {
  var context = {
    cutPlanes: [],
    sectionBox: null,
    hadSection: false
  };

  try {
    var cutPlanes = getCurrentCutPlanes();

    if (cutPlanes && cutPlanes.length) {
      context.cutPlanes = cutPlanes.map(clonePlane);
      context.hadSection = true;
    }

    var sectionExtension =
      (viewer.getExtension && viewer.getExtension('Autodesk.Section')) ||
      (viewer.getExtension && viewer.getExtension('Autodesk.Viewing.Section'));

    if (sectionExtension) {
      var sectionBox = getSectionBoxFromExtension(sectionExtension);

      if (sectionBox) {
        context.sectionBox = cloneBox(sectionBox);
        context.hadSection = true;
      }
    }
  } catch (error) {
    console.warn('[ApsViewer] Could not capture section context:', error);
  }

  return context;
}

function getCurrentCutPlanes() {
  if (!viewer) return [];

  if (typeof viewer.getCutPlanes === 'function') {
    return viewer.getCutPlanes() || [];
  }

  if (viewer.impl && typeof viewer.impl.getCutPlanes === 'function') {
    return viewer.impl.getCutPlanes() || [];
  }

  if (viewer.impl && Array.isArray(viewer.impl.cutplanes)) {
    return viewer.impl.cutplanes || [];
  }

  return [];
}

function getSectionBoxFromExtension(sectionExtension) {
  if (!sectionExtension) return null;

  if (typeof sectionExtension.getSectionBox === 'function') {
    var box = sectionExtension.getSectionBox();
    if (box) return box;
  }

  if (sectionExtension.sectionBox) return sectionExtension.sectionBox;
  if (sectionExtension.box) return sectionExtension.box;
  if (sectionExtension._sectionBox) return sectionExtension._sectionBox;

  return null;
}

/////////////////////////////////////////////////////////////////////
// Full review context restore
/////////////////////////////////////////////////////////////////////

function restoreReviewContextToModel(context, model, reason) {
  if (!viewer || !viewer.navigation || !context || !model) return false;

  try {
    restoreCameraContextToModel(context.camera, model, reason);
    restoreSectionContext(context.section, reason);

    if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
      viewer.impl.invalidate(true, true, true);
    }

    console.log('[ApsViewer] Restored review context:', reason);
    return true;
  } catch (error) {
    console.warn('[ApsViewer] Could not restore review context:', error);
    return false;
  }
}

function restoreCameraContextToModel(cameraContext, model, reason) {
  if (!cameraContext || !viewer || !viewer.navigation) return false;

  var nav = viewer.navigation;

  var target = chooseTargetForNewModel(cameraContext.target, model);
  var eye;

  var canUseExactTarget = cameraContext.target && target.distanceTo(cameraContext.target) < 0.0001;

  if (canUseExactTarget && cameraContext.eye) {
    eye = cameraContext.eye.clone();
  } else {
    var modelBox = getModelBoundingBox(model);

    if (!modelBox) return false;

    var modelSize = new THREE.Vector3();
    modelBox.getSize(modelSize);

    var modelDiagonal = Math.max(modelSize.length(), 1);
    var minDistance = modelDiagonal * 0.05;
    var maxDistance = modelDiagonal * 20.0;
    var distance = clamp(cameraContext.distance, minDistance, maxDistance);

    eye = target.clone().add(cameraContext.direction.clone().multiplyScalar(distance));
  }

  if (cameraContext.isPerspective && typeof nav.toPerspective === 'function') {
    nav.toPerspective();
  }

  if (cameraContext.isOrthographic && typeof nav.toOrthographic === 'function') {
    nav.toOrthographic();
  }

  if (typeof nav.setView === 'function') {
    nav.setView(eye, target);
  } else {
    if (typeof nav.setPosition === 'function') {
      nav.setPosition(eye);
    }

    if (typeof nav.setTarget === 'function') {
      nav.setTarget(target);
    }
  }

  if (cameraContext.up && typeof nav.setCameraUpVector === 'function') {
    nav.setCameraUpVector(cameraContext.up);
  }

  if (cameraContext.fov && typeof nav.setVerticalFov === 'function') {
    nav.setVerticalFov(Number(cameraContext.fov), true);
  }

  restoreCameraClipping(cameraContext);
  restoreOrthographicCameraScale(cameraContext);

  if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
    viewer.impl.invalidate(true, true, true);
  }

  return true;
}

function restoreCameraClipping(cameraContext) {
  try {
    var camera = viewer.getCamera ? viewer.getCamera() : null;

    if (!camera) return;

    if (Number.isFinite(cameraContext.near)) {
      camera.near = cameraContext.near;
    }

    if (Number.isFinite(cameraContext.far)) {
      camera.far = cameraContext.far;
    }

    if (typeof camera.updateProjectionMatrix === 'function') {
      camera.updateProjectionMatrix();
    }
  } catch (error) {
    console.warn('[ApsViewer] Could not restore camera clipping:', error);
  }
}

function restoreOrthographicCameraScale(cameraContext) {
  try {
    if (!cameraContext.orthographic) return;

    var camera = viewer.getCamera ? viewer.getCamera() : null;

    if (!camera || !camera.isOrthographicCamera) return;

    camera.left = cameraContext.orthographic.left;
    camera.right = cameraContext.orthographic.right;
    camera.top = cameraContext.orthographic.top;
    camera.bottom = cameraContext.orthographic.bottom;
    camera.zoom = cameraContext.orthographic.zoom || camera.zoom || 1;

    if (typeof camera.updateProjectionMatrix === 'function') {
      camera.updateProjectionMatrix();
    }
  } catch (error) {
    console.warn('[ApsViewer] Could not restore orthographic scale:', error);
  }
}

function restoreSectionContext(sectionContext, reason) {
  if (!viewer || !sectionContext) return;

  try {
    if (!sectionContext.hadSection) {
      clearViewerSectionOnly();
      return;
    }

    if (sectionContext.sectionBox) {
      setSectionBox(sectionContext.sectionBox);
      return;
    }

    if (sectionContext.cutPlanes && sectionContext.cutPlanes.length) {
      setCutPlanes(sectionContext.cutPlanes);
      return;
    }
  } catch (error) {
    console.warn('[ApsViewer] Could not restore section context:', error);
  }
}

function setSectionBox(sectionBox) {
  var sectionExtension =
    (viewer.getExtension && viewer.getExtension('Autodesk.Section')) ||
    (viewer.getExtension && viewer.getExtension('Autodesk.Viewing.Section'));

  if (sectionExtension && typeof sectionExtension.setSectionBox === 'function') {
    sectionExtension.setSectionBox(sectionBox);
  } else {
    var planes = makeCutPlanesFromBox(sectionBox);
    setCutPlanes(planes);
  }

  if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
    viewer.impl.invalidate(true, true, true);
  }
}

function setCutPlanes(cutPlanes) {
  var planes = (cutPlanes || []).map(clonePlane);

  if (typeof viewer.setCutPlanes === 'function') {
    viewer.setCutPlanes(planes);
  } else if (viewer.impl && typeof viewer.impl.setCutPlanes === 'function') {
    viewer.impl.setCutPlanes(planes);
  }

  if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
    viewer.impl.invalidate(true, true, true);
  }
}

function clearViewerSectionOnly() {
  var sectionExtension =
    (viewer.getExtension && viewer.getExtension('Autodesk.Section')) ||
    (viewer.getExtension && viewer.getExtension('Autodesk.Viewing.Section'));

  if (sectionExtension) {
    if (typeof sectionExtension.clearSection === 'function') {
      sectionExtension.clearSection();
    } else if (typeof sectionExtension.deactivate === 'function') {
      sectionExtension.deactivate();
    }
  }

  if (typeof viewer.setCutPlanes === 'function') {
    viewer.setCutPlanes([]);
  }

  if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
    viewer.impl.invalidate(true, true, true);
  }
}

function makeCutPlanesFromBox(box) {
  var min = box.min;
  var max = box.max;

  return [
    new THREE.Vector4(1, 0, 0, -min.x),
    new THREE.Vector4(-1, 0, 0, max.x),
    new THREE.Vector4(0, 1, 0, -min.y),
    new THREE.Vector4(0, -1, 0, max.y),
    new THREE.Vector4(0, 0, 1, -min.z),
    new THREE.Vector4(0, 0, -1, max.z)
  ];
}

/////////////////////////////////////////////////////////////////////
// Model/geometry helpers
/////////////////////////////////////////////////////////////////////

function chooseTargetForNewModel(previousTarget, model) {
  var modelBox = getModelBoundingBox(model);

  if (!modelBox) {
    return previousTarget ? previousTarget.clone() : new THREE.Vector3(0, 0, 0);
  }

  var expandedBox = modelBox.clone();
  var size = new THREE.Vector3();

  modelBox.getSize(size);

  var expansion = Math.max(size.length() * 0.05, 1);
  expandedBox.expandByScalar(expansion);

  if (previousTarget && expandedBox.containsPoint(previousTarget)) {
    return previousTarget.clone();
  }

  var center = new THREE.Vector3();
  modelBox.getCenter(center);

  return center;
}

function getModelBoundingBox(model) {
  if (!model || typeof model.getBoundingBox !== 'function') return null;

  var box = model.getBoundingBox();

  if (!box || (typeof box.isEmpty === 'function' && box.isEmpty())) {
    return null;
  }

  return box.clone ? box.clone() : new THREE.Box3(box.min.clone(), box.max.clone());
}

function is2DModel(model) {
  try {
    if (!model) return false;

    if (typeof model.is2d === 'function') {
      return model.is2d();
    }

    var data = model.getData ? model.getData() : null;

    return data?.is2d === true || data?.loadOptions?.is2d === true;
  } catch (error) {
    return false;
  }
}

function toVector3(value) {
  if (!value) return null;

  if (value.clone && typeof value.clone === 'function') {
    return value.clone();
  }

  if (Array.isArray(value) && value.length >= 3) {
    return new THREE.Vector3(Number(value[0]), Number(value[1]), Number(value[2]));
  }

  return new THREE.Vector3(Number(value.x), Number(value.y), Number(value.z));
}

function clonePlane(plane) {
  if (!plane) return null;

  if (plane.clone && typeof plane.clone === 'function') {
    return plane.clone();
  }

  if (Array.isArray(plane) && plane.length >= 4) {
    return new THREE.Vector4(
      Number(plane[0]),
      Number(plane[1]),
      Number(plane[2]),
      Number(plane[3])
    );
  }

  return new THREE.Vector4(
    Number(plane.x),
    Number(plane.y),
    Number(plane.z),
    Number(plane.w)
  );
}

function cloneBox(box) {
  if (!box) return null;

  if (box.clone && typeof box.clone === 'function') {
    return box.clone();
  }

  return new THREE.Box3(
    toVector3(box.min),
    toVector3(box.max)
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/////////////////////////////////////////////////////////////////////
// Dispatch events to other extensions
/////////////////////////////////////////////////////////////////////

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

/////////////////////////////////////////////////////////////////////
// Extensions and auth
/////////////////////////////////////////////////////////////////////

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