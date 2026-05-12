class AccIssuePinsExtension extends Autodesk.Viewing.Extension {
  constructor(viewer, options) {
    super(viewer, options);

    this.issuePins = [];
    this.issues = [];
    this.modelInfo = null;
    this.statusElement = null;

    this.selectedIssueId = null;
    this.selectedPin = null;

    this.activeFilters = null;

    this.cropWaitMs = 1200;
    this.cropSizeRatio = 0.02;
    this.cropMinSize = 1.0;
    this.cropMaxSizeRatio = 0.12;
    this.cropFitPadding = 1.35;

    this.sectionBoxSize = Number(localStorage.getItem('acc-issue-section-box-size') || 0);
    this.autoSectionEnabled = localStorage.getItem('acc-issue-auto-section-enabled') !== 'false';

    this.settingsPanel = null;
    this.settingsButton = null;
    this.toolbarGroup = null;

    this.redrawTimer = null;
    this.modelWatchTimer = null;
    this.updateAnimationFrame = null;
    this.lastModelSignature = null;

    this.loadDocumentNodePatched = false;
    this.originalLoadDocumentNode = null;

    this.onCameraChange = this.schedulePinUpdate.bind(this);
    this.onViewerInstance = this.handleViewerInstance.bind(this);
    this.onViewerDocumentViewChanged = this.handleViewerDocumentViewChanged.bind(this);
    this.onModelChanged = this.handleModelChanged.bind(this);
    this.onResize = this.schedulePinUpdate.bind(this);
    this.onIssueFiltersChanged = this.handleIssueFiltersChanged.bind(this);
  }

  load() {
    this.statusElement = document.getElementById('issuePinStatus');

    this.addViewerEvent(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChange);
    this.addViewerEvent(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, this.onModelChanged);
    this.addViewerEvent(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, this.onModelChanged);
    this.addViewerEvent(Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT, this.onModelChanged);
    this.addViewerEvent(Autodesk.Viewing.MODEL_ADDED_EVENT, this.onModelChanged);
    this.addViewerEvent(Autodesk.Viewing.MODEL_REMOVED_EVENT, this.onModelChanged);
    this.addViewerEvent(Autodesk.Viewing.CUTPLANES_CHANGE_EVENT, this.onCameraChange);
    this.addViewerEvent(Autodesk.Viewing.ISOLATE_EVENT, this.onCameraChange);
    this.addViewerEvent(Autodesk.Viewing.HIDE_EVENT, this.onCameraChange);
    this.addViewerEvent(Autodesk.Viewing.SHOW_EVENT, this.onCameraChange);
    this.addViewerEvent(Autodesk.Viewing.FIT_TO_VIEW_EVENT, this.onCameraChange);

    document.addEventListener('viewerinstance', this.onViewerInstance);
    document.addEventListener('viewerdocumentviewchanged', this.onViewerDocumentViewChanged);
    document.addEventListener('accissuefilterschanged', this.onIssueFiltersChanged);

    window.addEventListener('resize', this.onResize);

    this.patchLoadDocumentNode();
    this.startModelWatcher();

    this.injectSettingsStyles();
    this.createSettingsPanel();

    if (window.currentModelInfo?.projectId) {
      this.modelInfo = window.currentModelInfo;
      this.loadIssuesForCurrentModel();
    }

    window.accIssuePinsReload = () => this.loadIssuesForCurrentModel();
    window.accIssuePinsClearSection = () => this.clearSectionBox();
    window.accIssuePinsRedraw = () => this.scheduleRedrawPins('manual-redraw');

    console.log('AccIssuePins extension loaded.');
    return true;
  }

  unload() {
    this.clearPins();
    this.clearSectionBox();
    this.stopModelWatcher();
    this.restoreLoadDocumentNode();

    if (this.updateAnimationFrame) {
      cancelAnimationFrame(this.updateAnimationFrame);
      this.updateAnimationFrame = null;
    }

    if (this.redrawTimer) {
      clearTimeout(this.redrawTimer);
      this.redrawTimer = null;
    }

    this.removeViewerEvent(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChange);
    this.removeViewerEvent(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, this.onModelChanged);
    this.removeViewerEvent(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, this.onModelChanged);
    this.removeViewerEvent(Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT, this.onModelChanged);
    this.removeViewerEvent(Autodesk.Viewing.MODEL_ADDED_EVENT, this.onModelChanged);
    this.removeViewerEvent(Autodesk.Viewing.MODEL_REMOVED_EVENT, this.onModelChanged);
    this.removeViewerEvent(Autodesk.Viewing.CUTPLANES_CHANGE_EVENT, this.onCameraChange);
    this.removeViewerEvent(Autodesk.Viewing.ISOLATE_EVENT, this.onCameraChange);
    this.removeViewerEvent(Autodesk.Viewing.HIDE_EVENT, this.onCameraChange);
    this.removeViewerEvent(Autodesk.Viewing.SHOW_EVENT, this.onCameraChange);
    this.removeViewerEvent(Autodesk.Viewing.FIT_TO_VIEW_EVENT, this.onCameraChange);

    document.removeEventListener('viewerinstance', this.onViewerInstance);
    document.removeEventListener('viewerdocumentviewchanged', this.onViewerDocumentViewChanged);
    document.removeEventListener('accissuefilterschanged', this.onIssueFiltersChanged);

    window.removeEventListener('resize', this.onResize);

    if (this.settingsPanel) {
      this.settingsPanel.remove();
      this.settingsPanel = null;
    }

    if (this.toolbarGroup && this.settingsButton) {
      this.toolbarGroup.removeControl(this.settingsButton);
      this.settingsButton = null;
    }

    if (window.accIssuePinsReload) delete window.accIssuePinsReload;
    if (window.accIssuePinsClearSection) delete window.accIssuePinsClearSection;
    if (window.accIssuePinsRedraw) delete window.accIssuePinsRedraw;

    console.log('AccIssuePins extension unloaded.');
    return true;
  }

  addViewerEvent(eventName, handler) {
    if (!eventName || !this.viewer || typeof this.viewer.addEventListener !== 'function') return;
    this.viewer.addEventListener(eventName, handler);
  }

  removeViewerEvent(eventName, handler) {
    if (!eventName || !this.viewer || typeof this.viewer.removeEventListener !== 'function') return;
    this.viewer.removeEventListener(eventName, handler);
  }

  patchLoadDocumentNode() {
    if (this.loadDocumentNodePatched || !this.viewer || typeof this.viewer.loadDocumentNode !== 'function') return;

    this.originalLoadDocumentNode = this.viewer.loadDocumentNode.bind(this.viewer);

    this.viewer.loadDocumentNode = (...args) => {
      const result = this.originalLoadDocumentNode(...args);

      Promise.resolve(result)
        .then(() => {
          this.scheduleRedrawPins('loadDocumentNode');
        })
        .catch(() => {
          this.scheduleRedrawPins('loadDocumentNode-failed');
        });

      return result;
    };

    this.loadDocumentNodePatched = true;
  }

  restoreLoadDocumentNode() {
    if (!this.loadDocumentNodePatched || !this.originalLoadDocumentNode || !this.viewer) return;

    this.viewer.loadDocumentNode = this.originalLoadDocumentNode;
    this.originalLoadDocumentNode = null;
    this.loadDocumentNodePatched = false;
  }

  startModelWatcher() {
    this.stopModelWatcher();

    this.lastModelSignature = this.getActiveModelSignature();

    this.modelWatchTimer = window.setInterval(() => {
      const nextSignature = this.getActiveModelSignature();

      if (nextSignature !== this.lastModelSignature) {
        this.lastModelSignature = nextSignature;
        this.scheduleRedrawPins('model-watch');
      }
    }, 750);
  }

  stopModelWatcher() {
    if (this.modelWatchTimer) {
      window.clearInterval(this.modelWatchTimer);
      this.modelWatchTimer = null;
    }
  }

  getActiveModelSignature() {
    const model = this.viewer?.model;

    if (!model) return 'no-model';

    const data = model.getData?.() || {};
    const node = model.getDocumentNode?.() || null;

    const modelId = model.id ?? data.id ?? 'model';
    const urn = data.urn || '';
    const guid = node?.data?.guid || node?.data?.viewableID || '';
    const name = node?.data?.name || '';

    return `${modelId}|${urn}|${guid}|${name}`;
  }

  handleViewerInstance(event) {
    this.modelInfo = event.detail?.modelInfo || window.currentModelInfo || this.modelInfo;

    if (!this.issues || this.issues.length === 0) {
      this.loadIssuesForCurrentModel();
    } else {
      this.scheduleRedrawPins('viewerinstance');
    }
  }

  handleViewerDocumentViewChanged(event) {
    this.modelInfo = event.detail?.modelInfo || window.currentModelInfo || this.modelInfo;
    this.scheduleRedrawPins('viewerdocumentviewchanged');
  }

  handleModelChanged() {
    this.scheduleRedrawPins('viewer-model-event');
  }

  handleIssueFiltersChanged(event) {
    this.activeFilters = event.detail?.filters || null;
    this.drawPins();
  }

  scheduleRedrawPins(reason) {
    if (this.redrawTimer) {
      window.clearTimeout(this.redrawTimer);
    }

    this.redrawTimer = window.setTimeout(() => {
      this.redrawTimer = null;
      this.redrawPinsAfterViewChange(reason);
    }, 350);
  }

  redrawPinsAfterViewChange(reason) {
    if (!this.viewer?.model) {
      this.clearPins();
      this.setStatus('Issue pins: waiting for model after view change.');
      return;
    }

    if (!this.issues || this.issues.length === 0) {
      this.setStatus('Issue pins: no issues loaded for this project.');
      return;
    }

    const selectedIssueId = this.selectedIssueId;
    this.drawPins();

    if (selectedIssueId) {
      const selectedPin = this.issuePins.find(pin => this.getIssueId(pin.issue) === selectedIssueId);

      if (selectedPin) {
        this.selectedPin = selectedPin;
        selectedPin.element.classList.add('selected');
      }
    }

    this.schedulePinUpdate();

    console.log('Issue pins redrawn after view/model change:', reason);
  }

  schedulePinUpdate() {
    if (this.updateAnimationFrame) return;

    this.updateAnimationFrame = requestAnimationFrame(() => {
      this.updateAnimationFrame = null;
      this.updatePins();
    });
  }

  onToolbarCreated(toolbar) {
    this.createToolbarButton(toolbar);
  }

  createToolbarButton(toolbar) {
    if (this.settingsButton) return;

    this.toolbarGroup = toolbar.getControl('accIssuePinsToolbarGroup');

    if (!this.toolbarGroup) {
      this.toolbarGroup = new Autodesk.Viewing.UI.ControlGroup('accIssuePinsToolbarGroup');
      toolbar.addControl(this.toolbarGroup);
    }

    this.settingsButton = new Autodesk.Viewing.UI.Button('accIssuePinSettingsButton');
    this.settingsButton.setToolTip('Issue focus settings');

    this.settingsButton.onClick = () => {
      this.toggleSettingsPanel();
    };

    const icon = this.settingsButton.container.querySelector('.adsk-button-icon');

    if (icon) {
      icon.textContent = '⚙';
      icon.style.fontSize = '18px';
      icon.style.fontWeight = '700';
      icon.style.lineHeight = '24px';
      icon.style.textAlign = 'center';
      icon.style.color = '#ffffff';
    }

    this.toolbarGroup.addControl(this.settingsButton);
  }

  injectSettingsStyles() {
    if (document.getElementById('accIssuePinsRuntimeStyles')) return;

    const style = document.createElement('style');
    style.id = 'accIssuePinsRuntimeStyles';
    style.textContent = `
      .acc-issue-focus-settings-panel {
        position: absolute;
        right: 18px;
        bottom: 92px;
        z-index: 90;
        width: 280px;
        background: #ffffff;
        color: #1f2937;
        border-radius: 10px;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.25);
        font-family: Arial, sans-serif;
        overflow: hidden;
        display: none;
      }

      .acc-issue-focus-settings-panel.open {
        display: block;
      }

      .acc-issue-focus-settings-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 14px;
        border-bottom: 1px solid #e5e7eb;
        font-weight: 700;
      }

      .acc-issue-focus-settings-close {
        border: 0;
        background: transparent;
        font-size: 20px;
        line-height: 20px;
        cursor: pointer;
        color: #6b7280;
      }

      .acc-issue-focus-settings-body {
        padding: 12px 14px 14px;
      }

      .acc-issue-focus-settings-body label {
        display: block;
        font-size: 12px;
        color: #4b5563;
        margin-bottom: 6px;
      }

      .acc-issue-focus-settings-body input[type="number"] {
        width: 100%;
        height: 34px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 0 8px;
        margin-bottom: 10px;
        box-sizing: border-box;
      }

      .acc-issue-focus-settings-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        font-size: 12px;
        color: #374151;
      }

      .acc-issue-focus-settings-actions {
        display: flex;
        gap: 8px;
      }

      .acc-issue-focus-settings-actions button {
        flex: 1;
        height: 32px;
        border-radius: 6px;
        border: 1px solid #d1d5db;
        background: #f9fafb;
        cursor: pointer;
        font-size: 12px;
      }

      .acc-issue-focus-settings-actions button.primary {
        background: #2563eb;
        color: #ffffff;
        border-color: #2563eb;
      }

      .acc-issue-focus-settings-note {
        margin-top: 10px;
        font-size: 11px;
        color: #6b7280;
        line-height: 1.35;
      }

      .acc-issue-pin {
        position: absolute;
        z-index: 60;
        width: 26px;
        height: 26px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        border: 2px solid #ffffff;
        background: #f59e0b;
        color: #ffffff;
        font-size: 16px;
        font-weight: 800;
        line-height: 20px;
        text-align: center;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
        padding: 0;
        pointer-events: auto;
      }

      .acc-issue-pin:hover {
        background: #d97706;
        transform: translate(-50%, -50%) scale(1.12);
      }

      .acc-issue-pin.selected {
        background: #dc2626;
        border-color: #ffffff;
        box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.28), 0 2px 8px rgba(0, 0, 0, 0.35);
      }

      .acc-issue-pin.hidden-pin {
        display: none;
      }
    `;

    document.head.appendChild(style);
  }

  createSettingsPanel() {
    if (this.settingsPanel || !this.viewer?.container) return;

    const currentSizeText = this.sectionBoxSize > 0 ? this.sectionBoxSize : '';

    const panel = document.createElement('div');
    panel.className = 'acc-issue-focus-settings-panel';
    panel.innerHTML = `
      <div class="acc-issue-focus-settings-header">
        <span>Issue Focus Settings</span>
        <button class="acc-issue-focus-settings-close" type="button" title="Close">×</button>
      </div>

      <div class="acc-issue-focus-settings-body">
        <label for="accIssueSectionBoxSizeInput">Section box size</label>
        <input id="accIssueSectionBoxSizeInput" type="number" min="0" step="0.5" value="${currentSizeText}" placeholder="Auto" />

        <div class="acc-issue-focus-settings-row">
          <input id="accIssueAutoSectionCheckbox" type="checkbox" ${this.autoSectionEnabled ? 'checked' : ''} />
          <span>Apply section box when clicking issue pin</span>
        </div>

        <div class="acc-issue-focus-settings-actions">
          <button id="accIssueApplySectionSettings" class="primary" type="button">Apply</button>
          <button id="accIssueResetAutoSectionBox" type="button">Auto</button>
          <button id="accIssueClearSectionBox" type="button">Clear</button>
        </div>

        <div class="acc-issue-focus-settings-note">
          The section box is centred on the selected issue pin. Leave size empty or use 0 for automatic crop size.
        </div>
      </div>
    `;

    this.viewer.container.appendChild(panel);
    this.settingsPanel = panel;

    const closeButton = panel.querySelector('.acc-issue-focus-settings-close');
    const sizeInput = panel.querySelector('#accIssueSectionBoxSizeInput');
    const autoCheckbox = panel.querySelector('#accIssueAutoSectionCheckbox');
    const applyButton = panel.querySelector('#accIssueApplySectionSettings');
    const autoButton = panel.querySelector('#accIssueResetAutoSectionBox');
    const clearButton = panel.querySelector('#accIssueClearSectionBox');

    closeButton.addEventListener('click', () => {
      this.hideSettingsPanel();
    });

    applyButton.addEventListener('click', () => {
      const inputValue = String(sizeInput.value || '').trim();
      const nextSize = inputValue === '' ? 0 : Number(inputValue);

      if (Number.isFinite(nextSize) && nextSize >= 0) {
        this.sectionBoxSize = nextSize;
        localStorage.setItem('acc-issue-section-box-size', String(nextSize));
      }

      this.autoSectionEnabled = !!autoCheckbox.checked;
      localStorage.setItem('acc-issue-auto-section-enabled', String(this.autoSectionEnabled));

      if (this.selectedPin) {
        this.focusAndSectionIssue(this.selectedPin);
      }

      this.setStatus(
        this.sectionBoxSize > 0
          ? `Issue focus settings updated. Fixed section box size: ${this.sectionBoxSize}.`
          : 'Issue focus settings updated. Section box size: Auto.'
      );
    });

    autoButton.addEventListener('click', () => {
      this.sectionBoxSize = 0;
      sizeInput.value = '';
      localStorage.setItem('acc-issue-section-box-size', '0');

      if (this.selectedPin) {
        this.focusAndSectionIssue(this.selectedPin);
      }

      this.setStatus('Issue crop size reset to Auto.');
    });

    clearButton.addEventListener('click', () => {
      this.clearSectionBox();
      this.setStatus('Issue section box cleared.');
    });
  }

  toggleSettingsPanel() {
    if (!this.settingsPanel) {
      this.createSettingsPanel();
    }

    this.settingsPanel.classList.toggle('open');
  }

  hideSettingsPanel() {
    if (this.settingsPanel) {
      this.settingsPanel.classList.remove('open');
    }
  }

  setStatus(message) {
    if (this.statusElement) {
      this.statusElement.textContent = message;
    }

    console.log('[ACC Issue Pins]', message);
  }

  async loadIssuesForCurrentModel() {
    try {
      this.clearPins();

      const projectId = this.modelInfo?.projectId || window.currentModelInfo?.projectId;

      if (!projectId) {
        this.setStatus('Issue pins: no active ACC project.');
        return;
      }

      this.setStatus('Issue pins: loading issues...');

      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/issues`);
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error || body?.details?.developerMessage || body?.details || `Issue request failed: ${response.status}`);
      }

      this.issues = body?.data || [];

      document.dispatchEvent(new CustomEvent('accissuesloaded', {
        detail: {
          issues: this.issues
        }
      }));

      this.drawPins();
    } catch (error) {
      this.clearPins();
      this.setStatus('Issue pins failed: ' + error.message);
      console.error(error);
    }
  }

  removeAllPinDomElements() {
    if (!this.viewer?.container) return;

    this.viewer.container.querySelectorAll('.acc-issue-pin').forEach(element => {
      element.remove();
    });
  }

  clearPins() {
    this.issuePins.forEach(pin => {
      if (pin.element && pin.element.parentNode) {
        pin.element.remove();
      }
    });

    this.issuePins = [];
    this.selectedPin = null;

    this.removeAllPinDomElements();
  }

  getFilteredIssues() {
    if (!this.activeFilters) return this.issues || [];

    const filters = this.activeFilters;

    return (this.issues || []).filter(issue => {
      const status = this.normalise(this.getIssueStatus(issue));
      const category = this.normalise(this.getIssueCategory(issue));
      const type = this.normalise(this.getIssueType(issue));
      const location = this.normalise(this.getLocation(issue));
      const assignedTo = this.normalise(this.getAssignedTo(issue));

      if (filters.statuses && filters.statuses.length > 0) {
        const normalisedStatuses = filters.statuses.map(value => this.normalise(value));
        if (!normalisedStatuses.includes(status)) return false;
      } else {
        return false;
      }

      if (filters.category && category !== this.normalise(filters.category)) return false;
      if (filters.type && type !== this.normalise(filters.type)) return false;
      if (filters.location && location !== this.normalise(filters.location)) return false;
      if (filters.assignedTo && assignedTo !== this.normalise(filters.assignedTo)) return false;

      return true;
    });
  }

  drawPins() {
    this.clearPins();

    if (!this.viewer.model) {
      this.setStatus('Issue pins: model not loaded yet.');
      return;
    }

    const issuesToDraw = this.getFilteredIssues();

    let drawable = 0;
    let skipped = 0;

    issuesToDraw.forEach(issue => {
      const worldPoint = this.getBestWorldPoint(issue);

      if (!worldPoint) {
        skipped += 1;
        return;
      }

      const element = this.createPin(issue);
      this.viewer.container.appendChild(element);

      const pin = {
        issue,
        worldPoint,
        element
      };

      element.onclick = event => {
        event.stopPropagation();
        this.selectPin(pin);
      };

      if (this.selectedIssueId && this.getIssueId(issue) === this.selectedIssueId) {
        element.classList.add('selected');
        this.selectedPin = pin;
      }

      this.issuePins.push(pin);
      drawable += 1;
    });

    this.updatePins();

    this.setStatus(`Issue pins: ${drawable} shown, ${skipped} skipped, ${issuesToDraw.length} filtered, ${this.issues.length} total.`);

    document.dispatchEvent(new CustomEvent('accissuefilterresult', {
      detail: {
        visible: issuesToDraw.length,
        total: this.issues.length
      }
    }));
  }

  createPin(issue) {
    const element = document.createElement('button');
    element.className = 'acc-issue-pin';
    element.type = 'button';
    element.textContent = '!';
    element.setAttribute('aria-label', `Issue #${this.getIssueDisplayId(issue)}`);
    element.setAttribute('data-issue-id', this.getIssueId(issue) || '');
    element.title = `#${this.getIssueDisplayId(issue)} ${this.getIssueTitle(issue)}`;
    return element;
  }

  selectPin(pin) {
    this.selectedPin = pin;
    this.selectedIssueId = this.getIssueId(pin.issue);

    this.issuePins.forEach(existing => existing.element.classList.remove('selected'));
    pin.element.classList.add('selected');

    window.accIssuePinsSelectedIssue = {
      id: this.selectedIssueId,
      displayId: this.getIssueDisplayId(pin.issue),
      title: this.getIssueTitle(pin.issue),
      status: this.getIssueStatus(pin.issue),
      worldPoint: pin.worldPoint.toArray(),
      sectionBoxSize: this.sectionBoxSize,
      autoSectionEnabled: this.autoSectionEnabled
    };

    const viewerState = this.getIssueViewerState(pin.issue);

    if (viewerState) {
      this.restoreIssueViewportOnly(viewerState);

      setTimeout(() => {
        this.focusAndSectionIssue(pin);
      }, this.cropWaitMs);
    } else {
      this.focusAndSectionIssue(pin);
    }

    this.dispatchIssueSelected(pin);
    this.setStatus(`Selected issue #${this.getIssueDisplayId(pin.issue)}: ${this.getIssueTitle(pin.issue)}`);
  }

  restoreIssueViewportOnly(viewerState) {
    const viewport = this.getViewportFromViewerState(viewerState);

    if (!viewport || !this.viewer?.navigation) return false;

    const nav = this.viewer.navigation;

    try {
      const eye = this.vectorFromAny(viewport.eye || viewport.position || viewport.camera?.position);
      const target = this.vectorFromAny(viewport.target || viewport.pivotPoint || viewport.center);
      const up = this.vectorFromAny(viewport.up || viewport.worldUpVector || viewport.camera?.up);

      if (eye && target && typeof nav.setView === 'function') {
        nav.setView(
          new THREE.Vector3(eye.x, eye.y, eye.z),
          new THREE.Vector3(target.x, target.y, target.z)
        );
      } else if (target && typeof nav.setTarget === 'function') {
        nav.setTarget(new THREE.Vector3(target.x, target.y, target.z));
      }

      if (up && typeof nav.setCameraUpVector === 'function') {
        nav.setCameraUpVector(new THREE.Vector3(up.x, up.y, up.z));
      }

      if (viewport.projection) {
        if (String(viewport.projection).toLowerCase().includes('perspective') && typeof nav.toPerspective === 'function') {
          nav.toPerspective();
        }

        if (String(viewport.projection).toLowerCase().includes('orthographic') && typeof nav.toOrthographic === 'function') {
          nav.toOrthographic();
        }
      }

      if (viewport.fieldOfView && typeof nav.setVerticalFov === 'function') {
        nav.setVerticalFov(Number(viewport.fieldOfView), true);
      }

      if (this.viewer.impl && typeof this.viewer.impl.invalidate === 'function') {
        this.viewer.impl.invalidate(true, true, true);
      }

      this.schedulePinUpdate();
      return true;
    } catch (error) {
      console.warn('[ACC Issue Pins] Could not restore viewport only. Falling back to current view.', error);
      return false;
    }
  }

  getViewportFromViewerState(viewerState) {
    const parsed = this.parseJsonIfString(viewerState);

    return (
      parsed?.viewport ||
      parsed?.state?.viewport ||
      parsed?.viewerState?.viewport ||
      null
    );
  }

  async focusAndSectionIssue(pin) {
    if (!pin) return;

    let cropPoint = null;
    let cropSource = '';

    if (pin.worldPoint) {
      cropPoint = pin.worldPoint.clone
        ? pin.worldPoint.clone()
        : new THREE.Vector3(pin.worldPoint.x, pin.worldPoint.y, pin.worldPoint.z);

      cropSource = 'issue pin world point';
    }

    if (!cropPoint || !this.isFiniteVector(cropPoint)) {
      cropPoint = this.getNavigationTargetPoint();
      cropSource = 'viewer navigation target';
    }

    if (!cropPoint || !this.isFiniteVector(cropPoint)) {
      cropPoint = this.getViewerCenterHitPoint();
      cropSource = 'viewer center hit test';
    }

    if (!cropPoint || !this.isFiniteVector(cropPoint)) {
      cropPoint = this.getCurrentSelectionCenter();
      cropSource = 'current selection center';
    }

    if (!cropPoint) {
      this.setStatus('Could not determine issue crop point.');
      return;
    }

    if (this.autoSectionEnabled) {
      await this.applyCropAroundPoint(cropPoint, cropSource);
    } else {
      this.focusCameraOnPoint(cropPoint, this.getCropSize());
    }

    this.schedulePinUpdate();

    setTimeout(() => this.schedulePinUpdate(), 150);
    setTimeout(() => this.schedulePinUpdate(), 450);
  }

  async getSectionExtension() {
    let ext =
      (this.viewer.getExtension && this.viewer.getExtension('Autodesk.Section')) ||
      (this.viewer.getExtension && this.viewer.getExtension('Autodesk.Viewing.Section'));

    if (ext) return ext;

    try {
      ext = await this.viewer.loadExtension('Autodesk.Section');
      return ext;
    } catch (errorOne) {
      try {
        ext = await this.viewer.loadExtension('Autodesk.Viewing.Section');
        return ext;
      } catch (errorTwo) {
        console.warn('[ACC Issue Pins] Section extension could not be loaded.', errorOne, errorTwo);
        return null;
      }
    }
  }

  getModelBoundingBox() {
    const box = this.viewer.model && this.viewer.model.getBoundingBox
      ? this.viewer.model.getBoundingBox()
      : null;

    if (!box || (typeof box.isEmpty === 'function' && box.isEmpty())) {
      return null;
    }

    return box.clone ? box.clone() : new THREE.Box3(box.min.clone(), box.max.clone());
  }

  getCropSize() {
    if (this.sectionBoxSize && Number.isFinite(this.sectionBoxSize) && this.sectionBoxSize > 0) {
      return this.sectionBoxSize;
    }

    const modelBox = this.getModelBoundingBox();

    if (!modelBox) return this.cropMinSize;

    const size = new THREE.Vector3();
    modelBox.getSize(size);

    const diagonal = Math.max(size.length(), 1);
    const raw = Math.max(this.cropMinSize, diagonal * this.cropSizeRatio);
    const capped = Math.min(raw, diagonal * this.cropMaxSizeRatio);

    return capped;
  }

  makeBoxAroundPoint(point) {
    const cropSize = this.getCropSize();
    const half = cropSize / 2;

    return new THREE.Box3(
      new THREE.Vector3(point.x - half, point.y - half, point.z - half),
      new THREE.Vector3(point.x + half, point.y + half, point.z + half)
    );
  }

  makeFitBox(cropBox) {
    const center = new THREE.Vector3();
    cropBox.getCenter(center);

    const size = new THREE.Vector3();
    cropBox.getSize(size);
    size.multiplyScalar(this.cropFitPadding);

    const half = size.clone().multiplyScalar(0.5);

    return new THREE.Box3(
      center.clone().sub(half),
      center.clone().add(half)
    );
  }

  async applyCropAroundPoint(point, source) {
    if (!point || !this.viewer?.model) return false;

    const cropBox = this.makeBoxAroundPoint(point);
    const fitBox = this.makeFitBox(cropBox);

    try {
      if (this.viewer.navigation && typeof this.viewer.navigation.fitBounds === 'function') {
        this.viewer.navigation.fitBounds(false, fitBox);
      }
    } catch (error) {
      console.warn('[ACC Issue Pins] fitBounds failed. Continuing to section.', error);
    }

    const sectionExtension = await this.getSectionExtension();

    if (sectionExtension && typeof sectionExtension.setSectionBox === 'function') {
      sectionExtension.setSectionBox(cropBox);

      if (this.viewer.impl && typeof this.viewer.impl.invalidate === 'function') {
        this.viewer.impl.invalidate(true, true, true);
      }

      this.setStatus(`Issue crop applied from ${source}.`);
      return true;
    }

    if (sectionExtension && typeof sectionExtension.activate === 'function') {
      sectionExtension.activate('box');
      this.setCutPlanesFromBox(cropBox);
      this.setStatus('Issue crop applied using fallback cut planes.');
      return true;
    }

    this.setCutPlanesFromBox(cropBox);
    this.setStatus('Issue crop applied using viewer cut planes.');
    return true;
  }

  setCutPlanesFromBox(box) {
    const min = box.min;
    const max = box.max;

    const planes = [
      new THREE.Vector4(1, 0, 0, -min.x),
      new THREE.Vector4(-1, 0, 0, max.x),
      new THREE.Vector4(0, 1, 0, -min.y),
      new THREE.Vector4(0, -1, 0, max.y),
      new THREE.Vector4(0, 0, 1, -min.z),
      new THREE.Vector4(0, 0, -1, max.z)
    ];

    this.viewer.setCutPlanes(planes);

    if (this.viewer.impl && typeof this.viewer.impl.invalidate === 'function') {
      this.viewer.impl.invalidate(true, true, true);
    }
  }

  clearSectionBox() {
    if (!this.viewer) return;

    const sectionExtension =
      (this.viewer.getExtension && this.viewer.getExtension('Autodesk.Section')) ||
      (this.viewer.getExtension && this.viewer.getExtension('Autodesk.Viewing.Section'));

    if (sectionExtension) {
      if (typeof sectionExtension.clearSection === 'function') {
        sectionExtension.clearSection();
      } else if (typeof sectionExtension.deactivate === 'function') {
        sectionExtension.deactivate();
      }
    }

    if (typeof this.viewer.setCutPlanes === 'function') {
      this.viewer.setCutPlanes([]);
    }

    if (this.viewer.impl && typeof this.viewer.impl.invalidate === 'function') {
      this.viewer.impl.invalidate(true, true, true);
    }
  }

  focusCameraOnPoint(centerPoint, size) {
    if (!centerPoint || !this.viewer?.navigation) return;

    const half = Math.max(Number(size) || this.getCropSize(), 1) / 2;

    const bounds = new THREE.Box3(
      new THREE.Vector3(centerPoint.x - half, centerPoint.y - half, centerPoint.z - half),
      new THREE.Vector3(centerPoint.x + half, centerPoint.y + half, centerPoint.z + half)
    );

    const fitBox = this.makeFitBox(bounds);

    if (typeof this.viewer.navigation.fitBounds === 'function') {
      this.viewer.navigation.fitBounds(false, fitBox);
    } else {
      this.viewer.navigation.setTarget(centerPoint);
      this.viewer.fitToView();
    }

    setTimeout(() => {
      this.schedulePinUpdate();
    }, 250);
  }

  getViewerCenterHitPoint() {
    try {
      const container = this.viewer.container || (this.viewer.impl && this.viewer.impl.canvas && this.viewer.impl.canvas.parentElement);

      if (!container || typeof this.viewer.clientToWorld !== 'function') return null;

      const rect = container.getBoundingClientRect();
      const x = rect.width / 2;
      const y = rect.height / 2;

      const hit = this.viewer.clientToWorld(x, y, true);

      if (hit && hit.point) {
        return hit.point.clone ? hit.point.clone() : new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  getNavigationTargetPoint() {
    try {
      if (this.viewer.navigation && typeof this.viewer.navigation.getTarget === 'function') {
        const target = this.viewer.navigation.getTarget();

        if (
          target &&
          Number.isFinite(target.x) &&
          Number.isFinite(target.y) &&
          Number.isFinite(target.z)
        ) {
          return target.clone ? target.clone() : new THREE.Vector3(target.x, target.y, target.z);
        }
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  getCurrentSelectionCenter() {
    try {
      const selection = this.viewer.getSelection && this.viewer.getSelection();

      if (!selection || !selection.length) return null;

      const dbId = selection[0];
      const tree = this.viewer.model && this.viewer.model.getData && this.viewer.model.getData().instanceTree;
      const fragments = [];

      if (tree && typeof tree.enumNodeFragments === 'function') {
        tree.enumNodeFragments(dbId, fragmentId => fragments.push(fragmentId), true);
      }

      if (!fragments.length || !this.viewer.model.getFragmentList) return null;

      const fragmentList = this.viewer.model.getFragmentList();
      const box = new THREE.Box3();

      fragments.forEach((fragmentId, index) => {
        const fragmentBox = new THREE.Box3();
        fragmentList.getWorldBounds(fragmentId, fragmentBox);

        if (index === 0) {
          box.copy(fragmentBox);
        } else {
          box.union(fragmentBox);
        }
      });

      if (typeof box.isEmpty === 'function' && box.isEmpty()) return null;

      const center = new THREE.Vector3();
      box.getCenter(center);

      return center;
    } catch (error) {
      return null;
    }
  }

  dispatchIssueSelected(pin) {
    const issue = pin.issue || {};
    const detail = {
      issue,
      summary: {
        id: this.getIssueId(issue),
        displayId: this.getIssueDisplayId(issue),
        title: this.getIssueTitle(issue),
        status: this.getIssueStatus(issue),
        type: this.getIssueType(issue),
        category: this.getIssueCategory(issue),
        description: this.getIssueDescription(issue),
        assignedTo: this.getAssignedTo(issue),
        location: this.getLocation(issue),
        worldPoint: pin.worldPoint ? pin.worldPoint.toArray() : null,
        sectionBoxSize: this.sectionBoxSize
      }
    };

    document.dispatchEvent(new CustomEvent('accissueselected', { detail }));
  }

  updatePins() {
    if (!this.viewer || !this.viewer.model) return;

    const container = this.viewer.container;
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.issuePins.forEach(pin => {
      if (!pin.element || !pin.element.parentNode) return;

      const screen = this.viewer.worldToClient(pin.worldPoint);

      const isVisible =
        Number.isFinite(screen.x) &&
        Number.isFinite(screen.y) &&
        screen.x >= -120 &&
        screen.y >= -120 &&
        screen.x <= width + 120 &&
        screen.y <= height + 120;

      pin.element.style.left = `${screen.x}px`;
      pin.element.style.top = `${screen.y}px`;
      pin.element.classList.toggle('hidden-pin', !isVisible);
    });
  }

  getBestWorldPoint(issue) {
    const candidates = this.getWorldPointCandidates(issue);

    if (candidates.length === 0) return null;

    const bbox = this.viewer.model.getBoundingBox();
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const radius = Math.max(size.length(), 1);

    const scored = candidates
      .map(candidate => {
        const distance = candidate.point.distanceTo(center);
        const inside = bbox.containsPoint(candidate.point);
        const score = (inside ? 0 : radius) + distance + candidate.penalty;

        return {
          ...candidate,
          score,
          inside,
          distance
        };
      })
      .sort((a, b) => a.score - b.score);

    return scored[0]?.point || null;
  }

  getWorldPointCandidates(issue) {
    const candidates = [];
    const viewerState = this.getIssueViewerState(issue);
    const statePoint = this.getVectorFromViewerState(viewerState);

    if (statePoint) {
      candidates.push({
        source: 'viewerState',
        point: new THREE.Vector3(statePoint.x, statePoint.y, statePoint.z),
        penalty: 0
      });
    }

    const rawPosition = this.getIssueRawPosition(issue);

    if (!rawPosition) return candidates;

    const raw = new THREE.Vector3(rawPosition.x, rawPosition.y, rawPosition.z);

    candidates.push({
      source: 'raw',
      point: raw.clone(),
      penalty: 20
    });

    const modelData = this.viewer.model.getData() || {};
    const globalOffset = modelData.globalOffset || null;

    if (globalOffset) {
      const offset = new THREE.Vector3(
        globalOffset.x || 0,
        globalOffset.y || 0,
        globalOffset.z || 0
      );

      candidates.push({
        source: 'raw-minus-globalOffset',
        point: raw.clone().sub(offset),
        penalty: 2
      });

      candidates.push({
        source: 'raw-plus-globalOffset',
        point: raw.clone().add(offset),
        penalty: 40
      });
    }

    const placement = modelData.placementTransform || null;

    if (placement && typeof placement.clone === 'function') {
      candidates.push({
        source: 'placementTransform',
        point: raw.clone().applyMatrix4(placement),
        penalty: 5
      });
    }

    return candidates;
  }

  getIssueViewerState(issue) {
    const candidates = [
      issue?.viewerState,
      issue?.attributes?.viewerState,
      issue?.placement?.viewerState,
      issue?.placement?.details?.viewerState,
      issue?.placements?.[0]?.viewerState,
      issue?.placements?.[0]?.details?.viewerState,
      issue?.linkedDocuments?.[0]?.details?.viewerState,
      issue?.linkedDocuments?.[0]?.viewerState,
      issue?.details?.viewerState,
      issue?.pushpin?.viewerState
    ];

    for (const candidate of candidates) {
      const parsed = this.parseJsonIfString(candidate);
      if (parsed) return parsed;
    }

    return null;
  }

  getVectorFromViewerState(viewerState) {
    const viewport = viewerState?.viewport || viewerState?.state?.viewport || null;

    const candidates = [
      viewport?.pivotPoint,
      viewport?.target,
      viewport?.center,
      viewerState?.pivotPoint,
      viewerState?.target
    ];

    for (const candidate of candidates) {
      const vector = this.vectorFromAny(candidate);
      if (this.isFiniteVector(vector)) return vector;
    }

    return null;
  }

  getIssueRawPosition(issue) {
    const linkedDocument =
      issue?.linkedDocuments?.[0] ||
      issue?.attributes?.linkedDocuments?.[0] ||
      null;

    const candidates = [
      issue?.position,
      issue?.placement?.position,
      issue?.placement?.details?.position,
      issue?.placements?.[0]?.position,
      issue?.placements?.[0]?.details?.position,
      linkedDocument?.position,
      linkedDocument?.details?.position,
      linkedDocument?.details?.pushpinPosition,
      linkedDocument?.details?.viewerPosition,
      linkedDocument?.details?.point,
      linkedDocument?.details?.location,
      issue?.pushpin?.position,
      issue?.pushpinPosition
    ];

    for (const candidate of candidates) {
      const parsed = this.parseJsonIfString(candidate);
      const vector = this.vectorFromAny(parsed || candidate);
      if (this.isFiniteVector(vector)) return vector;
    }

    return null;
  }

  parseJsonIfString(value) {
    if (!value) return null;

    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }

    if (typeof value === 'object') return value;

    return null;
  }

  vectorFromAny(value) {
    if (!value) return null;

    if (Array.isArray(value) && value.length >= 3) {
      return {
        x: Number(value[0]),
        y: Number(value[1]),
        z: Number(value[2])
      };
    }

    if (typeof value === 'object') {
      const x = value.x ?? value.X ?? value[0];
      const y = value.y ?? value.Y ?? value[1];
      const z = value.z ?? value.Z ?? value[2];

      if (x !== undefined && y !== undefined && z !== undefined) {
        return {
          x: Number(x),
          y: Number(y),
          z: Number(z)
        };
      }
    }

    return null;
  }

  isFiniteVector(vector) {
    return !!vector && Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
  }

  normalise(value) {
    return String(value || '').trim().toLowerCase();
  }

  getIssueId(issue) {
    return issue?.id || issue?.issueId || issue?.attributes?.id || null;
  }

  getIssueStatus(issue) {
    return issue?.status || issue?.attributes?.status || 'Unknown';
  }

  getIssueCategory(issue) {
    return (
      issue?.categoryName ||
      issue?.category ||
      issue?.issueCategory ||
      issue?.attributes?.categoryName ||
      issue?.attributes?.category ||
      issue?.attributes?.issueCategory ||
      issue?.issueType?.category ||
      issue?.issueType?.categoryName ||
      ''
    );
  }

  getIssueType(issue) {
    const typeName =
      issue?.issueTypeName ||
      issue?.issueType?.title ||
      issue?.issueType?.name ||
      issue?.attributes?.issueTypeName ||
      issue?.attributes?.issueType ||
      issue?.type;

    const subtypeName =
      issue?.issueSubtypeName ||
      issue?.issueSubtype?.title ||
      issue?.issueSubtype?.name ||
      issue?.attributes?.issueSubtypeName ||
      issue?.attributes?.issueSubtype ||
      issue?.subtype;

    if (typeName && subtypeName) return `${typeName} / ${subtypeName}`;

    return typeName || subtypeName || 'Not specified';
  }

  getIssueDescription(issue) {
    return issue?.description || issue?.attributes?.description || issue?.details?.description || 'No description available.';
  }

  getAssignedTo(issue) {
    const assignedTo =
      issue?.assignedToDisplayName ||
      issue?.assignedToName ||
      issue?.assignedTo ||
      issue?.attributes?.assignedTo ||
      issue?.assignee ||
      null;

    if (!assignedTo) return 'Unassigned';
    if (typeof assignedTo === 'string') return assignedTo;

    return assignedTo.name || assignedTo.displayName || assignedTo.email || assignedTo.id || 'Assigned';
  }

  getLocation(issue) {
    return (
      issue?.locationName ||
      issue?.locationDetails ||
      issue?.location ||
      issue?.attributes?.locationName ||
      issue?.attributes?.locationDetails ||
      issue?.attributes?.location ||
      ''
    );
  }

  getIssueTitle(issue) {
    return issue?.title || issue?.attributes?.title || issue?.description || issue?.attributes?.description || 'Untitled issue';
  }

  getIssueDisplayId(issue) {
    return issue?.displayId || issue?.attributes?.displayId || issue?.issueId || '-';
  }
}

Autodesk.Viewing.theExtensionManager.registerExtension('AccIssuePins', AccIssuePinsExtension);