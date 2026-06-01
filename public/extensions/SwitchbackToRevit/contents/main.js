// Viewer extension responsible for creating the switchback JSON payload for Revit.
// Do not put OTP generation or issue table rendering code here.
class RevitSwitchbackExtension extends Autodesk.Viewing.Extension {
  constructor(viewer, options) {
    super(viewer, options);

    this.toolbarGroup = null;
    this.switchbackButton = null;
    this.statusElement = null;
    this.toastElement = null;
    this.toastTimer = null;
    this.buttonFeedbackTimer = null;

    this.defaultQuietMs = 500;
    this.defaultMaxWaitMs = 2500;

    this.onModelChanged = this.updateSwitchbackButtonState.bind(this);
  }

  load() {
    this.statusElement =
      document.getElementById('viewerActionStatus') ||
      document.getElementById('issuePinStatus') ||
      null;

    window.switchbackToRevitFromViewer = async () => {
      return await this.sendSwitchback();
    };

    this.addViewerModelEvents();

    return true;
  }

  unload() {
    if (this.toolbarGroup && this.switchbackButton) {
      this.toolbarGroup.removeControl(this.switchbackButton);
      this.switchbackButton = null;
    }

    if (window.switchbackToRevitFromViewer) {
      delete window.switchbackToRevitFromViewer;
    }

    this.removeViewerModelEvents();
    this.clearSwitchbackToast();
    window.clearTimeout(this.buttonFeedbackTimer);

    return true;
  }

  onToolbarCreated(toolbar) {
    this.createToolbarButton(toolbar);
  }

  createToolbarButton(toolbar) {
    if (this.switchbackButton) return;

    this.toolbarGroup = toolbar.getControl('revitSwitchbackToolbarGroup');

    if (!this.toolbarGroup) {
      this.toolbarGroup = new Autodesk.Viewing.UI.ControlGroup('revitSwitchbackToolbarGroup');
      toolbar.addControl(this.toolbarGroup);
    }

    this.switchbackButton = new Autodesk.Viewing.UI.Button('revitSwitchbackButton');
    this.switchbackButton.container.classList.add('switchback-to-revit-button');
    this.updateSwitchbackButtonState();

    this.switchbackButton.onClick = async () => {
      await this.sendSwitchback();
    };

    const icon = this.switchbackButton.container.querySelector('.adsk-button-icon');

    if (icon) {
      icon.textContent = '';
    }

    this.toolbarGroup.addControl(this.switchbackButton);
    this.updateSwitchbackButtonState();
  }

  addViewerModelEvents() {
    if (!this.viewer || typeof this.viewer.addEventListener !== 'function') return;

    [
      Autodesk.Viewing.GEOMETRY_LOADED_EVENT,
      Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT,
      Autodesk.Viewing.MODEL_ADDED_EVENT,
      Autodesk.Viewing.MODEL_REMOVED_EVENT
    ].forEach(eventName => {
      if (eventName) this.viewer.addEventListener(eventName, this.onModelChanged);
    });

    document.addEventListener('viewerdocumentviewchanged', this.onModelChanged);
  }

  removeViewerModelEvents() {
    if (this.viewer && typeof this.viewer.removeEventListener === 'function') {
      [
        Autodesk.Viewing.GEOMETRY_LOADED_EVENT,
        Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT,
        Autodesk.Viewing.MODEL_ADDED_EVENT,
        Autodesk.Viewing.MODEL_REMOVED_EVENT
      ].forEach(eventName => {
        if (eventName) this.viewer.removeEventListener(eventName, this.onModelChanged);
      });
    }

    document.removeEventListener('viewerdocumentviewchanged', this.onModelChanged);
  }

  updateSwitchbackButtonState() {
    if (!this.switchbackButton) return;

    const is2d = this.isCurrentModel2d();
    const tooltip = is2d
      ? "Can't switch back to 2D views/sheets"
      : 'Switchback current APS view to Revit';

    this.switchbackButton.setToolTip(tooltip);
    this.switchbackButton.container.title = tooltip;
    this.switchbackButton.container.setAttribute('aria-label', tooltip);
    this.switchbackButton.container.classList.toggle('switchback-to-revit-button-disabled', is2d);

    if (typeof this.switchbackButton.setState === 'function') {
      this.switchbackButton.setState(is2d
        ? Autodesk.Viewing.UI.Button.State.DISABLED
        : Autodesk.Viewing.UI.Button.State.INACTIVE);
    }
  }

  isCurrentModel2d() {
    try {
      const model = this.viewer?.model;
      if (!model) return false;

      if (typeof model.is2d === 'function') {
        return model.is2d() === true;
      }

      const data = model.getData?.() || {};
      return data.is2d === true || data.loadOptions?.is2d === true;
    } catch {
      return false;
    }
  }

  setStatus(message) {
    if (this.statusElement) {
      this.statusElement.textContent = message;
    }

  }

  showSwitchbackToast(message, timeoutMs = 8000, type = 'info') {
    const parent = this.viewer?.container || document.body;

    if (!this.toastElement) {
      this.toastElement = document.createElement('div');
      this.toastElement.className = 'viewer-switchback-toast switchback-to-revit-toast';
      parent.appendChild(this.toastElement);
    }

    this.toastElement.textContent = message;
    this.toastElement.classList.toggle('failed', type === 'failed');
    this.toastElement.classList.add('visible');

    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.clearSwitchbackToast();
    }, timeoutMs);
  }

  clearSwitchbackToast() {
    window.clearTimeout(this.toastTimer);
    this.toastTimer = null;

    if (this.toastElement && this.toastElement.parentNode) {
      this.toastElement.parentNode.removeChild(this.toastElement);
    }

    this.toastElement = null;
  }

  showButtonFeedback() {
    if (!this.switchbackButton?.container) return;

    this.switchbackButton.container.classList.add('switchback-to-revit-button-working');

    window.clearTimeout(this.buttonFeedbackTimer);
    this.buttonFeedbackTimer = window.setTimeout(() => {
      this.switchbackButton?.container?.classList.remove('switchback-to-revit-button-working');
    }, 700);
  }

  async sendSwitchback() {
    try {
      if (!this.viewer || !this.viewer.model) {
        throw new Error('Load a model first before using Switchback.');
      }

      if (this.isCurrentModel2d()) {
        throw new Error("Can't switch back to 2D views/sheets.");
      }

      this.showButtonFeedback();
      this.showSwitchbackToast('Aligning view with the synced Revit session');
      this.setStatus('Aligning view with the synced Revit session');

      await this.waitForViewerCameraToSettle(
        this.viewer,
        this.defaultQuietMs,
        this.defaultMaxWaitMs
      );

      const payload = this.createSwitchbackPayload();

      this.setStatus('Aligning view with the synced Revit session');

      const response = await fetch('/api/switchback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error || body?.details || `Switchback failed: ${response.status}`);
      }

      const message = 'Aligning view with the synced Revit session';

      this.setStatus(message);

      document.dispatchEvent(new CustomEvent('switchbackcomplete', {
        detail: {
          ok: true,
          message,
          payload,
          response: body
        }
      }));

      return {
        ok: true,
        payload,
        response: body
      };
    } catch (error) {
      this.setStatus('Switchback failed: ' + error.message);
      this.showSwitchbackToast('Switchback failed: ' + error.message, 10000, 'failed');

      document.dispatchEvent(new CustomEvent('switchbackcomplete', {
        detail: {
          ok: false,
          message: error.message
        }
      }));

      console.error(error);

      return {
        ok: false,
        error: error.message
      };
    }
  }

  async switchbackToRevit() {
    return await this.sendSwitchback();
  }

  waitForViewerCameraToSettle(viewer, quietMs, maxWaitMs) {
    return new Promise(resolve => {
      if (!viewer || typeof viewer.addEventListener !== 'function') {
        window.setTimeout(resolve, quietMs || 500);
        return;
      }

      let lastCameraChange = Date.now();

      function onCameraChange() {
        lastCameraChange = Date.now();
      }

      viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, onCameraChange);

      const start = Date.now();

      const timer = window.setInterval(() => {
        const now = Date.now();
        const quietEnough = now - lastCameraChange >= quietMs;
        const timedOut = now - start >= maxWaitMs;

        if (quietEnough || timedOut) {
          window.clearInterval(timer);
          viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, onCameraChange);

          window.setTimeout(resolve, 75);
        }
      }, 75);
    });
  }

  createSwitchbackPayload() {
    const viewer = this.viewer;
    const model = viewer.model;
    const modelData = model.getData ? model.getData() || {} : {};
    const documentNode = model.getDocumentNode ? model.getDocumentNode() : null;
    const nodeData = documentNode?.data || {};

    const viewerState = this.getViewerStateSafe();
    const viewport = this.getViewportSafe(viewerState);

    const camera = this.getCameraPayload();
    const navigation = this.getNavigationPayload();
    const modelPayload = this.getModelPayload(model, modelData, nodeData);
    const sectionPayload = this.getSectionPayload();
    const selectionPayload = this.getSelectionPayload();
    const revitCamera = this.getConvertedRevitCamera(camera, modelPayload.globalOffset);
    const revitViewport = this.getConvertedRevitViewport(viewport, modelPayload.globalOffset);

    return {
      type: 'ACC_VIEW_SWITCHBACK_TO_REVIT',
      source: 'aps-extensions-boilerplate',
      schemaVersion: '2.0',
      sentAtUtc: new Date().toISOString(),

      notes: {
        purpose: 'Viewer-state switchback. Not tied to ACC issues.',
        dynamoCoordinateRule: 'Use revitCamera if available. Otherwise use viewerState.viewport/camera and add model.globalOffset to eye and target.',
        elementSafeMode: true,
        issueIndependent: true,
        sectionRule: 'Only apply Revit section box if section.hasSection is true. If false, do not touch Revit elements.'
      },

      model: modelPayload,

      viewerState: viewerState,
      viewport: viewport,

      camera: camera,
      revitCamera: revitCamera,
      revitViewport: revitViewport,

      navigation: navigation,
      section: sectionPayload,
      selection: selectionPayload,

      currentModelInfo: window.currentModelInfo || null,

      selectedIssue: window.accIssuePinsSelectedIssue || null,

      switchbackAuthorisation: this.getSwitchbackAuthorisationPayload()
    };
  }

  getSwitchbackAuthorisationPayload() {
    try {
      if (typeof window.getAccSwitchbackAuthPayload === 'function') {
        const payload = window.getAccSwitchbackAuthPayload();

        if (payload && payload.otp) {
          return payload;
        }
      }

      const storageKey = 'acc-switchback-revit-otp';
      const existing = localStorage.getItem(storageKey);

      if (existing) {
        const parsed = JSON.parse(existing);

        if (parsed && parsed.otp) {
          return {
            otp: String(parsed.otp),
            createdAtUtc: parsed.createdAtUtc || null,
            expiresAtUtc: parsed.expiresAtUtc || null,
            source: parsed.source || 'web-viewer',
            purpose: parsed.purpose || 'authorise-revit-switchback-instance',
            fallbackSource: 'switchback-extension-local-storage'
          };
        }
      }

      return {
        otp: null,
        createdAtUtc: null,
        expiresAtUtc: null,
        source: 'web-viewer',
        purpose: 'authorise-revit-switchback-instance',
        fallbackSource: 'switchback-extension-no-otp',
        warning: 'No Revit OTP has been generated. Click Connect to my Revit instance in the right panel before switchback.'
      };
    } catch (error) {
      console.warn('[Revit Switchback] Could not read switchback authorisation OTP:', error);

      return {
        otp: null,
        createdAtUtc: null,
        expiresAtUtc: null,
        source: 'web-viewer',
        purpose: 'authorise-revit-switchback-instance',
        fallbackSource: 'switchback-extension-error',
        error: error.message
      };
    }
  }

  getViewerStateSafe() {
    try {
      if (!this.viewer || typeof this.viewer.getState !== 'function') {
        return null;
      }

      return this.viewer.getState();
    } catch (error) {
      console.warn('[Revit Switchback] Could not read viewer state:', error);
      return null;
    }
  }

  getViewportSafe(viewerState) {
    return (
      viewerState?.viewport ||
      viewerState?.state?.viewport ||
      null
    );
  }

  getCameraPayload() {
    const viewer = this.viewer;
    const camera = viewer.getCamera ? viewer.getCamera() : null;
    const nav = viewer.navigation;

    const position =
      nav && typeof nav.getPosition === 'function'
        ? nav.getPosition()
        : camera?.position || null;

    const target =
      nav && typeof nav.getTarget === 'function'
        ? nav.getTarget()
        : null;

    const up = camera?.up || null;

    const worldUp =
      nav && typeof nav.getWorldUpVector === 'function'
        ? nav.getWorldUpVector()
        : null;

    const positionVector = this.toVector3(position);
    const targetVector = this.toVector3(target);
    const upVector = this.toVector3(up);
    const worldUpVector = this.toVector3(worldUp);

    let direction = null;
    let distanceToTarget = null;

    if (positionVector && targetVector) {
      direction = positionVector.clone().sub(targetVector);
      distanceToTarget = direction.length();

      if (distanceToTarget > 0) {
        direction.normalize();
      }
    }

    const orthographicHeight = this.getOrthographicHeight(camera);

    return {
      position: this.vectorToArray(positionVector),
      eye: this.vectorToArray(positionVector),
      target: this.vectorToArray(targetVector),
      up: this.vectorToArray(upVector),
      worldUp: this.vectorToArray(worldUpVector),

      directionFromTargetToEye: this.vectorToArray(direction),
      distanceToTarget: this.numberOrNull(distanceToTarget),

      isPerspective: camera?.isPerspectiveCamera === true,
      isOrthographic: camera?.isOrthographicCamera === true,

      projection: camera?.isOrthographicCamera
        ? 'orthographic'
        : camera?.isPerspectiveCamera
          ? 'perspective'
          : null,

      fov: this.numberOrNull(camera?.fov),
      aspect: this.numberOrNull(camera?.aspect),
      near: this.numberOrNull(camera?.near),
      far: this.numberOrNull(camera?.far),

      orthographic: camera?.isOrthographicCamera
        ? {
            left: this.numberOrNull(camera.left),
            right: this.numberOrNull(camera.right),
            top: this.numberOrNull(camera.top),
            bottom: this.numberOrNull(camera.bottom),
            zoom: this.numberOrNull(camera.zoom),
            orthographicHeight: this.numberOrNull(orthographicHeight)
          }
        : null
    };
  }

  getNavigationPayload() {
    const nav = this.viewer.navigation;

    if (!nav) return null;

    let pivotPoint = null;
    let position = null;
    let target = null;
    let worldUp = null;

    try {
      position = typeof nav.getPosition === 'function' ? nav.getPosition() : null;
    } catch {}

    try {
      target = typeof nav.getTarget === 'function' ? nav.getTarget() : null;
    } catch {}

    try {
      pivotPoint = typeof nav.getPivotPoint === 'function' ? nav.getPivotPoint() : null;
    } catch {}

    try {
      worldUp = typeof nav.getWorldUpVector === 'function' ? nav.getWorldUpVector() : null;
    } catch {}

    return {
      position: this.vectorToArray(position),
      target: this.vectorToArray(target),
      pivotPoint: this.vectorToArray(pivotPoint),
      worldUp: this.vectorToArray(worldUp)
    };
  }

  getModelPayload(model, modelData, nodeData) {
    const globalOffset = this.toVector3(modelData.globalOffset);
    const boundingBox = this.getModelBoundingBox(model);

    const currentModelInfo = window.currentModelInfo || {};

    return {
      urn: modelData.urn || currentModelInfo.urn || null,
      guid: nodeData.guid || nodeData.viewableID || currentModelInfo.activeView?.guid || null,
      name: currentModelInfo.name || nodeData.name || nodeData.displayName || null,

      source: currentModelInfo || null,

      activeView: currentModelInfo.activeView || {
        guid: nodeData.guid || nodeData.viewableID || null,
        name: nodeData.name || nodeData.displayName || null,
        role: nodeData.role || null,
        type: nodeData.type || null
      },

      globalOffset: this.vectorToObject(globalOffset) || {
        x: 0,
        y: 0,
        z: 0
      },

      boundingBox: boundingBox
        ? {
            min: this.vectorToArray(boundingBox.min),
            max: this.vectorToArray(boundingBox.max),
            center: this.vectorToArray(boundingBox.getCenter(new THREE.Vector3())),
            size: this.vectorToArray(boundingBox.getSize(new THREE.Vector3()))
          }
        : null,

      data: {
        modelId: model.id ?? null,
        is2d: typeof model.is2d === 'function' ? model.is2d() : modelData.is2d === true
      }
    };
  }

  getSelectionPayload() {
    try {
      const dbIds = this.viewer.getSelection ? this.viewer.getSelection() : [];

      return {
        dbIds: Array.isArray(dbIds) ? dbIds.slice() : [],
        count: Array.isArray(dbIds) ? dbIds.length : 0
      };
    } catch {
      return {
        dbIds: [],
        count: 0
      };
    }
  }

  getSectionPayload() {
    const cutPlanes = this.getCurrentCutPlanes();
    const sectionBox = this.getSectionBoxIfAvailable();

    return {
      hasSection: !!sectionBox || cutPlanes.length > 0,
      sectionBox: sectionBox
        ? {
            min: this.vectorToArray(sectionBox.min),
            max: this.vectorToArray(sectionBox.max),
            center: this.vectorToArray(sectionBox.getCenter(new THREE.Vector3())),
            size: this.vectorToArray(sectionBox.getSize(new THREE.Vector3()))
          }
        : null,
      cutPlanes: cutPlanes.map(plane => this.planeToArray(plane)).filter(Boolean),
      note: sectionBox || cutPlanes.length > 0
        ? 'Section/cut data captured from viewer.'
        : 'No section/cut data found. Treat section box as off in Revit.'
    };
  }

  getCurrentCutPlanes() {
    try {
      if (this.viewer && typeof this.viewer.getCutPlanes === 'function') {
        const planes = this.viewer.getCutPlanes();
        return Array.isArray(planes) ? planes : [];
      }

      if (this.viewer?.impl && typeof this.viewer.impl.getCutPlanes === 'function') {
        const planes = this.viewer.impl.getCutPlanes();
        return Array.isArray(planes) ? planes : [];
      }

      if (this.viewer?.impl && Array.isArray(this.viewer.impl.cutplanes)) {
        return this.viewer.impl.cutplanes;
      }
    } catch (error) {
      console.warn('[Revit Switchback] Could not read cut planes:', error);
    }

    return [];
  }

  getSectionBoxIfAvailable() {
    try {
      const sectionExtension =
        (this.viewer.getExtension && this.viewer.getExtension('Autodesk.Section')) ||
        (this.viewer.getExtension && this.viewer.getExtension('Autodesk.Viewing.Section'));

      if (!sectionExtension) return null;

      if (typeof sectionExtension.getSectionBox === 'function') {
        const box = sectionExtension.getSectionBox();

        if (box && box.min && box.max) {
          return box.clone ? box.clone() : new THREE.Box3(this.toVector3(box.min), this.toVector3(box.max));
        }
      }

      const possibleBoxes = [
        sectionExtension.sectionBox,
        sectionExtension._sectionBox,
        sectionExtension.box,
        sectionExtension._box
      ];

      for (const possibleBox of possibleBoxes) {
        if (possibleBox && possibleBox.min && possibleBox.max) {
          return possibleBox.clone
            ? possibleBox.clone()
            : new THREE.Box3(this.toVector3(possibleBox.min), this.toVector3(possibleBox.max));
        }
      }
    } catch (error) {
      console.warn('[Revit Switchback] Could not read section box:', error);
    }

    return null;
  }

  getConvertedRevitCamera(camera, globalOffsetObject) {
    const offset = this.toVector3(globalOffsetObject) || new THREE.Vector3(0, 0, 0);
    const eye = this.toVector3(camera.eye || camera.position);
    const target = this.toVector3(camera.target);
    const up = this.toVector3(camera.up);

    if (!eye || !target) {
      return null;
    }

    const revitEye = eye.clone().add(offset);
    const revitTarget = target.clone().add(offset);

    return {
      conversion: 'APS viewer point + model.globalOffset',
      eye: this.vectorToArray(revitEye),
      position: this.vectorToArray(revitEye),
      target: this.vectorToArray(revitTarget),
      up: this.vectorToArray(up),
      projection: camera.projection,
      isPerspective: camera.isPerspective,
      isOrthographic: camera.isOrthographic,
      fov: camera.fov,
      aspect: camera.aspect,
      near: camera.near,
      far: camera.far,
      orthographic: camera.orthographic
    };
  }

  getConvertedRevitViewport(viewport, globalOffsetObject) {
    if (!viewport) return null;

    const offset = this.toVector3(globalOffsetObject) || new THREE.Vector3(0, 0, 0);
    const eye = this.toVector3(viewport.eye || viewport.position);
    const target = this.toVector3(viewport.target || viewport.pivotPoint || viewport.center);
    const up = this.toVector3(viewport.up || viewport.worldUpVector);

    return {
      conversion: 'APS viewer viewport point + model.globalOffset',
      eye: eye ? this.vectorToArray(eye.clone().add(offset)) : null,
      target: target ? this.vectorToArray(target.clone().add(offset)) : null,
      up: this.vectorToArray(up),
      projection: viewport.projection || null,
      isOrthographic: viewport.isOrthographic === true,
      orthographicHeight: this.numberOrNull(viewport.orthographicHeight),
      distanceToOrbit: this.numberOrNull(viewport.distanceToOrbit),
      aspectRatio: this.numberOrNull(viewport.aspectRatio),
      rawApsEye: this.vectorToArray(eye),
      rawApsTarget: this.vectorToArray(target)
    };
  }

  getModelBoundingBox(model) {
    try {
      if (!model || typeof model.getBoundingBox !== 'function') return null;

      const box = model.getBoundingBox();

      if (!box || (typeof box.isEmpty === 'function' && box.isEmpty())) {
        return null;
      }

      return box.clone ? box.clone() : new THREE.Box3(box.min.clone(), box.max.clone());
    } catch {
      return null;
    }
  }

  getOrthographicHeight(camera) {
    try {
      if (!camera || !camera.isOrthographicCamera) return null;

      if (
        Number.isFinite(camera.top) &&
        Number.isFinite(camera.bottom)
      ) {
        return Math.abs(camera.top - camera.bottom);
      }
    } catch {}

    return null;
  }

  toVector3(value) {
    if (!value) return null;

    if (value.isVector3 && typeof value.clone === 'function') {
      return value.clone();
    }

    if (typeof value.clone === 'function' && value.x !== undefined && value.y !== undefined && value.z !== undefined) {
      return value.clone();
    }

    if (Array.isArray(value) && value.length >= 3) {
      return new THREE.Vector3(Number(value[0]), Number(value[1]), Number(value[2]));
    }

    if (typeof value === 'object') {
      const x = value.x ?? value.X ?? value[0];
      const y = value.y ?? value.Y ?? value[1];
      const z = value.z ?? value.Z ?? value[2];

      if (x !== undefined && y !== undefined && z !== undefined) {
        return new THREE.Vector3(Number(x), Number(y), Number(z));
      }
    }

    return null;
  }

  vectorToArray(value) {
    const vector = this.toVector3(value);

    if (!vector) return null;

    return [
      Number(vector.x),
      Number(vector.y),
      Number(vector.z)
    ];
  }

  vectorToObject(value) {
    const vector = this.toVector3(value);

    if (!vector) return null;

    return {
      x: Number(vector.x),
      y: Number(vector.y),
      z: Number(vector.z)
    };
  }

  planeToArray(plane) {
    if (!plane) return null;

    if (Array.isArray(plane) && plane.length >= 4) {
      return [
        Number(plane[0]),
        Number(plane[1]),
        Number(plane[2]),
        Number(plane[3])
      ];
    }

    const x = plane.x ?? plane.X ?? plane[0];
    const y = plane.y ?? plane.Y ?? plane[1];
    const z = plane.z ?? plane.Z ?? plane[2];
    const w = plane.w ?? plane.W ?? plane[3];

    if (x === undefined || y === undefined || z === undefined || w === undefined) {
      return null;
    }

    return [
      Number(x),
      Number(y),
      Number(z),
      Number(w)
    ];
  }

  numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
}

Autodesk.Viewing.theExtensionManager.registerExtension('RevitSwitchback', RevitSwitchbackExtension);
