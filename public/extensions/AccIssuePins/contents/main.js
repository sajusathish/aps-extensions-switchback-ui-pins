// Viewer extension responsible for ACC issue pushpins, issue focus, and section boxes.
// Do not put issue table rendering or ACC REST route code here.
class AccIssuePinsExtension extends Autodesk.Viewing.Extension {
  constructor(viewer, options) {
    super(viewer, options);

    this.issuePins = [];
    this.issues = [];
    this.modelInfo = null;
    this.statusElement = null;

    this.selectedIssueId = null;
    this.visualSelectedIssueId = null;
    this.selectedPin = null;
    this.selectedPinKeepVisibleUntil = 0;
    this.selectionFocusToken = 0;
    this.pendingViewRefocusIssueId = null;
    this.pendingViewRefocusToken = 0;
    this.completedViewRefocusToken = 0;
    this.filterChangeToken = 0;
    this.suppressSelectedPinRefitUntil = 0;
    this.activeFilters = null;
    this.activeFilterIssueIds = null;
    this.issueOpenInProgress = false;

    this.cropWaitMs = 1200;
    this.cropSizeRatio = 0.02;
    this.cropMinSize = 1.0;
    this.cropMaxSizeRatio = 0.12;
    this.cropFitPadding = 1.35;

    this.sectionBoxSize = Number(localStorage.getItem('acc-issue-section-box-size') || 0);
    this.autoSectionEnabled = localStorage.getItem('acc-issue-auto-section-enabled') !== 'false';

    // Keep the current model unless the user asks to open the saved ACC issue view.
    this.openSavedViewOnIssueSelect = localStorage.getItem('acc-issue-open-saved-view-on-select') === 'true';

    this.settingsPanel = null;
    this.settingsButton = null;
    this.toolbarGroup = null;

    this.redrawTimer = null;
    this.modelWatchTimer = null;
    this.updateAnimationFrame = null;
    this.viewRefreshTimers = [];
    this.pinUpdateTimers = [];
    this.lastModelSignature = null;

    this.loadDocumentNodePatched = false;
    this.originalLoadDocumentNode = null;
    this.viewerInteractionListenersAdded = false;

    this.onCameraChange = this.handleCameraChange.bind(this);
    this.onViewerStateRestored = this.handleViewerStateRestored.bind(this);
    this.onViewerInteraction = this.handleViewerInteraction.bind(this);
    this.onViewerInstance = this.handleViewerInstance.bind(this);
    this.onViewerDocumentViewChanged = this.handleViewerDocumentViewChanged.bind(this);
    this.onModelChanged = this.handleModelChanged.bind(this);
    this.onResize = this.handleViewerInteraction.bind(this);
    this.onIssueFiltersChanged = this.handleIssueFiltersChanged.bind(this);
    this.onIssueTableSelect = this.handleIssueTableSelect.bind(this);
    this.onOpenSavedViewSettingChanged = this.handleOpenSavedViewSettingChanged.bind(this);
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
    this.addViewerEvent(Autodesk.Viewing.VIEWER_STATE_RESTORED_EVENT, this.onViewerStateRestored);
    this.addViewerEvent(Autodesk.Viewing.MODEL_TRANSFORM_CHANGED_EVENT, this.onModelChanged);
    this.addViewerEvent(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.onCameraChange);
    this.addViewerEvent(Autodesk.Viewing.NAVIGATION_MODE_CHANGED_EVENT, this.onCameraChange);
    this.addViewerEvent(Autodesk.Viewing.ISOLATE_EVENT, this.onCameraChange);
    this.addViewerEvent(Autodesk.Viewing.HIDE_EVENT, this.onCameraChange);
    this.addViewerEvent(Autodesk.Viewing.SHOW_EVENT, this.onCameraChange);
    this.addViewerEvent(Autodesk.Viewing.FIT_TO_VIEW_EVENT, this.onCameraChange);

    document.addEventListener('viewerinstance', this.onViewerInstance);
    document.addEventListener('viewerdocumentviewchanged', this.onViewerDocumentViewChanged);
    document.addEventListener('accissuefilterschanged', this.onIssueFiltersChanged);
    document.addEventListener('accissuetableselect', this.onIssueTableSelect);
    document.addEventListener('accissueopensavedviewsettingchanged', this.onOpenSavedViewSettingChanged);

    window.addEventListener('resize', this.onResize);
    this.addViewerInteractionListeners();

    this.patchLoadDocumentNode();
    this.startModelWatcher();

    this.injectSettingsStyles();
    this.createSettingsPanel();

    if (window.currentModelInfo?.projectId) {
      this.modelInfo = window.currentModelInfo;
      this.loadIssuesForCurrentModel();
    }

    window.accIssuePinsReload = options => this.loadIssuesForCurrentModel(options);
    window.accIssuePinsClearSection = () => this.clearSectionBox();
    window.accIssuePinsRedraw = () => this.scheduleRedrawPins('manual-redraw');

    // Keeps the currently loaded viewer context. This is the default/federated coordination behaviour.
    window.accIssuePinsSelectIssue = (issueId, options = {}) => this.selectIssueById(issueId, {
      ...options,
      openLinkedViewable: false,
      preserveCurrentView: true,
      source: options.source || 'external-select'
    });

    // Explicit action only: opens the issue's saved ACC linked viewable/context.
    window.accIssuePinsOpenSavedView = (issueId, options = {}) => this.selectIssueById(issueId, {
      ...options,
      openLinkedViewable: true,
      preserveSavedView: true,
      source: options.source || 'external-open-saved-view'
    });

    window.accIssuePinsOpenIssue = window.accIssuePinsOpenSavedView;

    window.accIssuePinsSetOpenSavedViewOnSelect = value => {
      this.setOpenSavedViewOnIssueSelect(value);
      this.setStatus(this.openSavedViewOnIssueSelect
        ? 'Issue selection mode: open saved ACC issue view.'
        : 'Issue selection mode: keep current viewer/federated view.');
      return this.openSavedViewOnIssueSelect;
    };

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

    this.clearViewRefreshTimers();
    this.clearPinUpdateTimers();

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
    this.removeViewerEvent(Autodesk.Viewing.VIEWER_STATE_RESTORED_EVENT, this.onViewerStateRestored);
    this.removeViewerEvent(Autodesk.Viewing.MODEL_TRANSFORM_CHANGED_EVENT, this.onModelChanged);
    this.removeViewerEvent(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.onCameraChange);
    this.removeViewerEvent(Autodesk.Viewing.NAVIGATION_MODE_CHANGED_EVENT, this.onCameraChange);
    this.removeViewerEvent(Autodesk.Viewing.ISOLATE_EVENT, this.onCameraChange);
    this.removeViewerEvent(Autodesk.Viewing.HIDE_EVENT, this.onCameraChange);
    this.removeViewerEvent(Autodesk.Viewing.SHOW_EVENT, this.onCameraChange);
    this.removeViewerEvent(Autodesk.Viewing.FIT_TO_VIEW_EVENT, this.onCameraChange);

    document.removeEventListener('viewerinstance', this.onViewerInstance);
    document.removeEventListener('viewerdocumentviewchanged', this.onViewerDocumentViewChanged);
    document.removeEventListener('accissuefilterschanged', this.onIssueFiltersChanged);
    document.removeEventListener('accissuetableselect', this.onIssueTableSelect);
    document.removeEventListener('accissueopensavedviewsettingchanged', this.onOpenSavedViewSettingChanged);

    window.removeEventListener('resize', this.onResize);
    this.removeViewerInteractionListeners();

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
    if (window.accIssuePinsSelectIssue) delete window.accIssuePinsSelectIssue;
    if (window.accIssuePinsOpenSavedView) delete window.accIssuePinsOpenSavedView;
    if (window.accIssuePinsOpenIssue) delete window.accIssuePinsOpenIssue;
    if (window.accIssuePinsSetOpenSavedViewOnSelect) delete window.accIssuePinsSetOpenSavedViewOnSelect;

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

  addViewerInteractionListeners() {
    const container = this.viewer?.container;
    if (!container || this.viewerInteractionListenersAdded) return;

    ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'touchstart', 'touchmove', 'touchend'].forEach(eventName => {
      container.addEventListener(eventName, this.onViewerInteraction, { passive: true });
    });

    this.viewerInteractionListenersAdded = true;
  }

  removeViewerInteractionListeners() {
    const container = this.viewer?.container;
    if (!container || !this.viewerInteractionListenersAdded) return;

    ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'touchstart', 'touchmove', 'touchend'].forEach(eventName => {
      container.removeEventListener(eventName, this.onViewerInteraction);
    });

    this.viewerInteractionListenersAdded = false;
  }

  handleCameraChange() {
    this.schedulePinUpdateBurst([0, 80]);
  }

  handleViewerInteraction() {
    this.schedulePinUpdateBurst([0, 80, 200]);
  }

  handleViewerStateRestored() {
    this.scheduleViewRefresh('viewer-state-restored');
  }

  patchLoadDocumentNode() {
    if (this.loadDocumentNodePatched || !this.viewer || typeof this.viewer.loadDocumentNode !== 'function') return;

    this.originalLoadDocumentNode = this.viewer.loadDocumentNode.bind(this.viewer);

    this.viewer.loadDocumentNode = (...args) => {
      const result = this.originalLoadDocumentNode(...args);

      Promise.resolve(result)
        .then(() => {
          this.scheduleViewRefresh('loadDocumentNode');
        })
        .catch(() => {
          this.scheduleViewRefresh('loadDocumentNode-failed');
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
        this.scheduleViewRefresh('model-watch');
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
    const is2d = typeof model.is2d === 'function' ? model.is2d() : data.is2d === true;
    const globalOffset = data.globalOffset || {};
    const activeView = window.currentModelInfo?.activeView || this.modelInfo?.activeView || {};
    const activeViewKey = [
      activeView?.guid,
      activeView?.viewableId,
      activeView?.viewableID,
      activeView?.name
    ].filter(Boolean).join(':');

    return [
      modelId,
      urn,
      guid,
      name,
      is2d ? '2d' : '3d',
      Number(globalOffset.x || 0),
      Number(globalOffset.y || 0),
      Number(globalOffset.z || 0),
      activeViewKey
    ].join('|');
  }

  handleViewerInstance(event) {
    this.modelInfo = event.detail?.modelInfo || window.currentModelInfo || this.modelInfo;

    if (!this.issues || this.issues.length === 0) {
      this.loadIssuesForCurrentModel();
    } else {
      this.scheduleViewRefresh('viewerinstance');
    }
  }

  handleViewerDocumentViewChanged(event) {
    this.modelInfo = event.detail?.modelInfo || window.currentModelInfo || this.modelInfo;
    this.scheduleViewRefresh('viewerdocumentviewchanged');
  }

  handleModelChanged() {
    this.lastModelSignature = this.getActiveModelSignature();
    this.scheduleViewRefresh('viewer-model-event');
  }

  handleIssueFiltersChanged(event) {
    this.filterChangeToken += 1;
    this.suppressSelectedPinRefitUntil = Date.now() + 1000;
    this.selectedPinKeepVisibleUntil = 0;
    this.activeFilters = event.detail?.filters || null;
    this.activeFilterIssueIds = Array.isArray(event.detail?.issueIds)
      ? event.detail.issueIds.map(value => this.normaliseIdForCompare(value)).filter(Boolean)
      : null;

    if (this.selectedIssueId && !this.issuePassesActiveFilter(this.selectedIssueId)) {
      this.visualSelectedIssueId = null;
      this.selectedPin = null;
      this.pendingViewRefocusIssueId = null;
    }

    this.drawPins();
  }

  issuePassesActiveFilter(issueId) {
    if (!Array.isArray(this.activeFilterIssueIds)) return true;

    return this.activeFilterIssueIds.includes(this.normaliseIdForCompare(issueId));
  }

  setOpenSavedViewOnIssueSelect(value) {
    this.openSavedViewOnIssueSelect = value === true;
    localStorage.setItem('acc-issue-open-saved-view-on-select', String(this.openSavedViewOnIssueSelect));

    const checkbox = this.settingsPanel?.querySelector?.('#accIssueOpenSavedViewCheckbox');
    if (checkbox) {
      checkbox.checked = this.openSavedViewOnIssueSelect;
    }

    return this.openSavedViewOnIssueSelect;
  }

  handleOpenSavedViewSettingChanged(event) {
    if (typeof event.detail?.openSavedViewOnIssueSelect !== 'boolean') return;
    this.setOpenSavedViewOnIssueSelect(event.detail.openSavedViewOnIssueSelect);
  }

  handleIssueTableSelect(event) {
    const issueId = event.detail?.issueId;
    if (!issueId) return;

    const hasOpenSavedViewOverride = Object.prototype.hasOwnProperty.call(event.detail || {}, 'openSavedView');
    const openSavedView = hasOpenSavedViewOverride
      ? event.detail.openSavedView === true
      : this.openSavedViewOnIssueSelect === true;

    this.selectIssueById(issueId, {
      openLinkedViewable: openSavedView,
      preserveSavedView: openSavedView,
      preserveCurrentView: !openSavedView,
      source: openSavedView ? 'issue-table-open-saved-view' : 'issue-table-current-view'
    });
  }

  async selectIssueById(issueId, options = {}) {
    const normalisedIssueId = this.normaliseIdForCompare(issueId);
    if (!normalisedIssueId) return false;

    const issue = this.findIssueById(normalisedIssueId);

    if (!issue) {
      this.setStatus(`Issue ${issueId} was not found in the loaded issue list.`);
      return false;
    }

    this.selectedIssueId = this.getIssueId(issue);
    this.dispatchIssueSelectedFromIssue(issue, null);

    if (!this.issuePassesActiveFilter(this.selectedIssueId)) {
      this.visualSelectedIssueId = null;
      this.selectedPin = null;
      this.applySelectedPinStyle();
      this.setStatus(`Issue #${this.getIssueDisplayId(issue)} is selected, but it is hidden by the current quick filters.`);
      return true;
    }

    const switchedIssueViewable = await this.openDifferentIssueViewableIfNeeded(issue, issueId, options);
    if (switchedIssueViewable) return true;

    const shouldOpenLinkedViewable = options.openLinkedViewable === true;
    const canOpenLinkedViewable = typeof window.openIssueInLatestViewable === 'function';

    if (shouldOpenLinkedViewable && canOpenLinkedViewable && !this.issueOpenInProgress) {
      this.issueOpenInProgress = true;

      try {
        this.setStatus(`Opening issue #${this.getIssueDisplayId(issue)} in its saved ACC view...`);
        await window.openIssueInLatestViewable(issue);

        this.selectedIssueId = this.getIssueId(issue);
        this.drawPins();

        window.setTimeout(() => {
          this.selectIssueById(issueId, {
            openLinkedViewable: false,
            preserveSavedView: true,
            preserveCurrentView: false,
            source: 'post-linked-viewable-load'
          });
        }, 450);

        window.setTimeout(() => {
          this.selectIssueById(issueId, {
            openLinkedViewable: false,
            preserveSavedView: true,
            preserveCurrentView: false,
            source: 'post-linked-viewable-load-late'
          });
        }, 1200);

        return true;
      } catch (error) {
        console.warn('[ACC Issue Pins] Could not open linked viewable for issue. Falling back to current view.', error);
        this.setStatus(`Could not open saved view for issue #${this.getIssueDisplayId(issue)}. Trying current viewer view.`);
        options = {
          ...options,
          openLinkedViewable: false,
          preserveSavedView: false,
          preserveCurrentView: true,
          source: 'saved-view-fallback-current-view'
        };
      } finally {
        this.issueOpenInProgress = false;
      }
    }

    const pin = this.findPinByIssueId(normalisedIssueId);

    if (pin) {
      this.finishPinSelection(pin, options);
      return true;
    }

    this.drawPins();

    const redrawnPin = this.findPinByIssueId(normalisedIssueId);

    if (redrawnPin) {
      this.finishPinSelection(redrawnPin, options);
      return true;
    }

    this.dispatchIssueSelectedFromIssue(issue, null);
    this.setStatus(`Issue #${this.getIssueDisplayId(issue)} selected, but no drawable pushpin was found in the current view.`);
    return false;
  }

  findIssueById(issueId) {
    const wanted = this.normaliseIdForCompare(issueId);

    return (this.issues || []).find(issue => {
      return this.normaliseIdForCompare(this.getIssueId(issue)) === wanted;
    }) || null;
  }

  findPinByIssueId(issueId) {
    const wanted = this.normaliseIdForCompare(issueId);

    return this.issuePins.find(item => {
      return this.normaliseIdForCompare(this.getIssueId(item.issue)) === wanted;
    }) || null;
  }

  normaliseIdForCompare(value) {
    return String(value || '').trim().toLowerCase();
  }

  async openDifferentIssueViewableIfNeeded(issue, issueId, options = {}) {
    if (options.openLinkedViewable === true) return false;
    if (options.preserveCurrentView !== true) return false;

    const viewable = this.getIssuePreferredViewableByType(issue);
    if (!viewable) return false;
    if (this.issueViewableIsActive(viewable)) return false;

    const viewName = await this.resolveIssueViewableDisplayNameForPrompt(issue, viewable);
    const is2dIssueView = this.is2dViewable(viewable);

    if (is2dIssueView) {
      const message =
        'This is a issue on a 2D view, are you sure you want to navigate to the view : ' +
        viewName +
        ' ?';

      const confirmed = window.confirm(message);
      if (!confirmed) {
        this.setStatus(`Issue #${this.getIssueDisplayId(issue)} selected. 2D view switch cancelled.`);
        return true;
      }
    }

    this.setStatus(`Opening issue view: ${viewName}`);

    const loadedInCurrentDocument = await this.ensureIssueViewableLoaded(issue, viewable);
    if (loadedInCurrentDocument) {
      window.setTimeout(() => {
        this.selectIssueById(issueId, {
          openLinkedViewable: false,
          preserveSavedView: true,
          preserveCurrentView: false,
          source: 'issue-view-switch'
        });
      }, 450);

      return true;
    }

    if (typeof window.openIssueInLatestViewable === 'function' && !this.issueOpenInProgress) {
      this.issueOpenInProgress = true;

      try {
        await window.openIssueInLatestViewable(issue);

        window.setTimeout(() => {
          this.selectIssueById(issueId, {
            openLinkedViewable: false,
            preserveSavedView: true,
            preserveCurrentView: false,
            source: 'linked-issue-view-switch'
          });
        }, 450);
      } catch (error) {
        console.warn('[ACC Issue Pins] Could not open issue view.', error);
        this.setStatus(`Could not open the issue view for issue #${this.getIssueDisplayId(issue)}.`);
      } finally {
        this.issueOpenInProgress = false;
      }

      return true;
    }

    this.setStatus(`Could not find the issue view for issue #${this.getIssueDisplayId(issue)} in the loaded document.`);
    return true;
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

  scheduleViewRefresh(reason) {
    if (this.selectedIssueId && this.issuePassesActiveFilter(this.selectedIssueId)) {
      this.pendingViewRefocusIssueId = this.selectedIssueId;
      this.pendingViewRefocusToken += 1;
    }

    this.scheduleRedrawPins(reason);
    this.clearViewRefreshTimers();

    [900, 1800].forEach(delay => {
      const timer = window.setTimeout(() => {
        this.viewRefreshTimers = this.viewRefreshTimers.filter(item => item !== timer);
        this.redrawPinsAfterViewChange(`${reason}:${delay}`);
      }, delay);

      this.viewRefreshTimers.push(timer);
    });
  }

  clearViewRefreshTimers() {
    this.viewRefreshTimers.forEach(timer => window.clearTimeout(timer));
    this.viewRefreshTimers = [];
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
      const selectedPin = this.findPinByIssueId(selectedIssueId);

      if (selectedPin) {
        this.applySelectedPinStyle();
        this.refocusSelectedIssueAfterViewChange(selectedPin, reason);
      }
    }

    this.schedulePinUpdate();

  }

  refocusSelectedIssueAfterViewChange(pin, reason) {
    if (!pin || !this.pendingViewRefocusIssueId) return;

    const refocusToken = this.pendingViewRefocusToken;
    if (this.completedViewRefocusToken === refocusToken) return;

    const selectedId = this.normaliseIdForCompare(this.selectedIssueId);
    const pendingId = this.normaliseIdForCompare(this.pendingViewRefocusIssueId);
    const pinId = this.normaliseIdForCompare(this.getIssueId(pin.issue));

    if (!selectedId || selectedId !== pendingId || pinId !== selectedId) return;
    if (!this.issuePassesActiveFilter(this.selectedIssueId)) return;

    window.setTimeout(() => {
      if (this.pendingViewRefocusToken !== refocusToken) return;
      if (this.completedViewRefocusToken === refocusToken) return;
      if (this.normaliseIdForCompare(this.selectedIssueId) !== selectedId) return;

      const currentPin = this.findPinByIssueId(selectedId);
      if (!currentPin) return;

      this.completedViewRefocusToken = refocusToken;
      this.finishPinSelection(currentPin, {
        preserveCurrentView: true,
        source: 'view-change-refocus:' + (reason || 'viewer-view-change')
      });
    }, 120);
  }

  schedulePinUpdate() {
    if (this.updateAnimationFrame) return;

    this.updateAnimationFrame = requestAnimationFrame(() => {
      this.updateAnimationFrame = null;
      this.updatePins();
    });
  }

  schedulePinUpdateBurst(delays) {
    this.clearPinUpdateTimers();

    (delays || [0]).forEach(delay => {
      if (!delay) {
        this.schedulePinUpdate();
        return;
      }

      const timer = window.setTimeout(() => {
        this.pinUpdateTimers = this.pinUpdateTimers.filter(item => item !== timer);
        this.schedulePinUpdate();
      }, delay);

      this.pinUpdateTimers.push(timer);
    });
  }

  clearPinUpdateTimers() {
    this.pinUpdateTimers.forEach(timer => window.clearTimeout(timer));
    this.pinUpdateTimers = [];
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
    this.settingsButton.container.classList.add('acc-issue-pin-settings-button');

    this.settingsButton.onClick = () => {
      this.toggleSettingsPanel();
    };

    const icon = this.settingsButton.container.querySelector('.adsk-button-icon');

    if (icon) {
      icon.textContent = '';
    }

    this.toolbarGroup.addControl(this.settingsButton);
  }

  injectSettingsStyles() {
    // Styles are loaded from contents/main.css by the extension loader.
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
          <span>Apply section box when selecting an issue</span>
        </div>

        <div class="acc-issue-focus-settings-row">
          <input id="accIssueOpenSavedViewCheckbox" type="checkbox" ${this.openSavedViewOnIssueSelect ? 'checked' : ''} />
          <span>Open saved ACC issue view on selection</span>
        </div>

        <div class="acc-issue-focus-settings-actions">
          <button id="accIssueApplySectionSettings" class="primary" type="button">Apply</button>
          <button id="accIssueResetAutoSectionBox" type="button">Auto</button>
          <button id="accIssueClearSectionBox" type="button">Clear</button>
        </div>

        <div class="acc-issue-focus-settings-note">
          Selection keeps the current coordination/federated view unless this setting is enabled.
        </div>
      </div>
    `;

    this.viewer.container.appendChild(panel);
    this.settingsPanel = panel;

    const closeButton = panel.querySelector('.acc-issue-focus-settings-close');
    const sizeInput = panel.querySelector('#accIssueSectionBoxSizeInput');
    const autoCheckbox = panel.querySelector('#accIssueAutoSectionCheckbox');
    const openSavedViewCheckbox = panel.querySelector('#accIssueOpenSavedViewCheckbox');
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

      this.setOpenSavedViewOnIssueSelect(!!openSavedViewCheckbox.checked);
      document.dispatchEvent(new CustomEvent('accissueopensavedviewsettingchanged', {
        detail: {
          openSavedViewOnIssueSelect: this.openSavedViewOnIssueSelect
        }
      }));

      if (this.selectedPin) {
        this.focusAndSectionIssue(this.selectedPin);
      }

      const modeText = this.openSavedViewOnIssueSelect
        ? 'Selection mode: open saved ACC issue view.'
        : 'Selection mode: keep current viewer/federated view.';

      this.setStatus(
        (this.sectionBoxSize > 0
          ? `Issue focus settings updated. Fixed section box size: ${this.sectionBoxSize}. `
          : 'Issue focus settings updated. Section box size: Auto. ') + modeText
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
      const cleared = this.clearSectionBox();
      this.setStatus(cleared === false
        ? '2D view: no section box to clear.'
        : 'Issue section box cleared.');
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
  }

  async loadIssuesForCurrentModel(options = {}) {
    try {
      this.clearPins();

      const projectId = this.modelInfo?.projectId || window.currentModelInfo?.projectId;

      if (!projectId) {
        this.setStatus('Issue pins: no active ACC project.');
        return;
      }

      this.setStatus('Issue pins: loading issues...');

      const accountId =
        this.modelInfo?.hubId ||
        this.modelInfo?.accountId ||
        window.currentModelInfo?.hubId ||
        window.currentModelInfo?.accountId ||
        '';

      const query = accountId
        ? `?accountId=${encodeURIComponent(accountId)}`
        : '';

      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/issues${query}`);
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error || body?.details?.developerMessage || body?.details || `Issue request failed: ${response.status}`);
      }

      this.issues = body?.data || [];

      document.dispatchEvent(new CustomEvent('accissuesloaded', {
        detail: {
          issues: this.issues,
          refreshIssueSettings: options.refreshIssueSettings === true
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
    if (Array.isArray(this.activeFilterIssueIds)) {
      const idSet = new Set(this.activeFilterIssueIds);

      return (this.issues || []).filter(issue => {
        return idSet.has(this.normaliseIdForCompare(this.getIssueId(issue)));
      });
    }

    if (!this.activeFilters) return this.issues || [];

    const filters = this.activeFilters;

    return (this.issues || []).filter(issue => {
      const status = this.normaliseStatusFilter(this.getIssueStatus(issue));
      const category = this.normalise(this.getIssueCategory(issue));
      const type = this.normalise(this.getIssueType(issue));
      const location = this.normalise(this.getLocation(issue));
      const assignedTo = this.normalise(this.getAssignedTo(issue));

      if (filters.statuses && filters.statuses.length > 0) {
        const normalisedStatuses = filters.statuses.map(value => this.normaliseStatusFilter(value));
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

      if (this.selectedIssueId && this.normaliseIdForCompare(this.getIssueId(issue)) === this.normaliseIdForCompare(this.selectedIssueId)) {
        this.selectedPin = pin;
      }

      this.issuePins.push(pin);
      drawable += 1;
    });

    this.updatePins();
    this.applySelectedPinStyle();

    this.setStatus(`Issue pins: ${drawable} shown, ${skipped} skipped, ${issuesToDraw.length} filtered, ${this.issues.length} total.`);

    document.dispatchEvent(new CustomEvent('accissuefilterresult', {
      detail: {
        visible: issuesToDraw.length,
        shown: drawable,
        skipped,
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
    if (!pin || !pin.issue) return;

    const issueId = this.getIssueId(pin.issue);

    if (this.openSavedViewOnIssueSelect && issueId) {
      this.selectIssueById(issueId, {
        openLinkedViewable: true,
        preserveSavedView: true,
        preserveCurrentView: false,
        source: 'pin-open-saved-view'
      });
      return;
    }

    // Keep the current view and focus the selected issue coordinate.
    this.finishPinSelection(pin, {
      preserveCurrentView: true,
      source: 'pin-current-view'
    });
  }

  finishPinSelection(pin, options = {}) {
    const refreshedPin = this.findPinByIssueId(this.getIssueId(pin.issue)) || pin;
    this.selectedIssueId = this.getIssueId(refreshedPin.issue);
    const selectionFocusToken = this.selectionFocusToken + 1;
    this.selectionFocusToken = selectionFocusToken;

    if (this.normaliseIdForCompare(this.visualSelectedIssueId) !== this.normaliseIdForCompare(this.selectedIssueId)) {
      this.clearSelectedPinStyle(selectionFocusToken);
    }

    const modelData = this.viewer?.model?.getData?.() || {};
    const globalOffset = modelData.globalOffset || null;

    window.accIssuePinsSelectedIssue = {
      id: this.selectedIssueId,
      displayId: this.getIssueDisplayId(refreshedPin.issue),
      title: this.getIssueTitle(refreshedPin.issue),
      status: this.getIssueStatus(refreshedPin.issue),
      worldPoint: refreshedPin.worldPoint.toArray(),
      globalOffset: globalOffset
        ? {
            x: Number(globalOffset.x || 0),
            y: Number(globalOffset.y || 0),
            z: Number(globalOffset.z || 0)
          }
        : null,
      sectionBoxSize: this.sectionBoxSize,
      autoSectionEnabled: this.autoSectionEnabled
    };

    const viewerState = this.getIssueViewerState(refreshedPin.issue);
    const preserveSavedView = options && options.preserveSavedView === true;
    const preserveCurrentView = options && options.preserveCurrentView === true;
    const selectedIssueIdAtStart = this.selectedIssueId;

    this.focusPinBeforeShowingSelection(refreshedPin, {
      preserveCurrentView,
      preserveSavedView,
      viewerState
    }).then(() => {
      this.showSelectedPinAfterFocus(refreshedPin, selectedIssueIdAtStart, selectionFocusToken);
    });

    this.dispatchIssueSelected(refreshedPin);

    const selectedMessage = `Selected issue #${this.getIssueDisplayId(refreshedPin.issue)}: ${this.getIssueTitle(refreshedPin.issue)}`;
    this.setStatus(this.isCurrentModel2d()
      ? `${selectedMessage}. 2D view: section box skipped.`
      : selectedMessage);
  }

  clearSelectedPinStyle(selectionFocusToken) {
    if (selectionFocusToken && selectionFocusToken !== this.selectionFocusToken) return;

    this.visualSelectedIssueId = null;
    this.selectedPin = null;

    this.issuePins.forEach(pin => {
      pin.element.classList.remove('selected');
    });
  }

  focusPinBeforeShowingSelection(pin, options = {}) {
    const filterChangeTokenAtStart = this.filterChangeToken;
    const focusIfFilterStillMatches = () => {
      if (filterChangeTokenAtStart !== this.filterChangeToken) return false;
      if (!this.issuePassesActiveFilter(this.getIssueId(pin.issue))) return false;

      return this.focusAndSectionIssue(pin, { fitCamera: true });
    };

    if (options.preserveCurrentView) {
      // Keep the current viewable; only the issue crop changes.
      return Promise.resolve(focusIfFilterStillMatches());
    }

    if (options.preserveSavedView) {
      this.schedulePinUpdate();

      return new Promise(resolve => {
        setTimeout(() => {
          this.schedulePinUpdate();
        }, 250);

        setTimeout(() => {
          Promise.resolve(focusIfFilterStillMatches()).then(resolve);
        }, this.cropWaitMs);
      });
    }

    if (options.viewerState) {
      this.restoreIssueViewportOnly(options.viewerState);

      return new Promise(resolve => {
        setTimeout(() => {
          Promise.resolve(focusIfFilterStillMatches()).then(resolve);
        }, this.cropWaitMs);
      });
    }

    return Promise.resolve(focusIfFilterStillMatches());
  }

  showSelectedPinAfterFocus(pin, selectedIssueIdAtStart, selectionFocusToken) {
    if (selectionFocusToken !== this.selectionFocusToken) {
      return;
    }

    if (this.normaliseIdForCompare(this.selectedIssueId) !== this.normaliseIdForCompare(selectedIssueIdAtStart)) {
      return;
    }

    const currentPin = this.findPinByIssueId(selectedIssueIdAtStart) || pin;

    this.visualSelectedIssueId = selectedIssueIdAtStart;
    this.selectedPin = currentPin;
    this.keepSelectedPinVisible(currentPin);
    this.updatePins();
    this.applySelectedPinStyle();
    this.forceSelectedPinElementRed(selectedIssueIdAtStart);
    this.schedulePinUpdateBurst([0, 120, 300, 700, 1200]);

    [150, 450, 900, 1400].forEach(delay => {
      window.setTimeout(() => {
        if (selectionFocusToken !== this.selectionFocusToken) return;

        this.visualSelectedIssueId = selectedIssueIdAtStart;
        this.applySelectedPinStyle();
        this.forceSelectedPinElementRed(selectedIssueIdAtStart);
      }, delay);
    });
  }

  applySelectedPinStyle() {
    this.restoreSelectedIssueFromUiIfNeeded();

    const selectedId = this.normaliseIdForCompare(this.visualSelectedIssueId);

    this.selectedPin = null;

    this.issuePins.forEach(pin => {
      const isSelected = selectedId && this.normaliseIdForCompare(this.getIssueId(pin.issue)) === selectedId;

      pin.element.classList.toggle('selected', isSelected);

      if (isSelected) {
        this.selectedPin = pin;
        pin.element.classList.remove('hidden-pin');
        pin.element.style.zIndex = '3';
      } else {
        pin.element.style.zIndex = '';
      }
    });
  }

  restoreSelectedIssueFromUiIfNeeded() {
    if (this.selectedIssueId || this.visualSelectedIssueId) return;

    const activeRow = document.querySelector('#issueTableBody tr.active[data-issue-id]');
    const activeIssueId =
      activeRow?.getAttribute('data-issue-id') ||
      window.accIssuePinsSelectedIssue?.id ||
      '';

    if (!activeIssueId) return;

    this.selectedIssueId = activeIssueId;
    this.visualSelectedIssueId = activeIssueId;
  }

  forceSelectedPinElementRed(issueId) {
    this.restoreSelectedIssueFromUiIfNeeded();

    const selectedId = this.normaliseIdForCompare(issueId || this.visualSelectedIssueId);
    if (!selectedId || !this.viewer?.container) return;

    this.viewer.container.querySelectorAll('.acc-issue-pin').forEach(element => {
      const elementIssueId = this.normaliseIdForCompare(element.getAttribute('data-issue-id') || '');
      const isSelected = elementIssueId === selectedId;

      element.classList.toggle('selected', isSelected);

      if (isSelected) {
        element.classList.remove('hidden-pin');
        element.style.zIndex = '3';
      } else {
        element.style.zIndex = '';
      }
    });
  }

  isSelectedPin(pin) {
    if (!pin || !this.selectedIssueId) return false;

    return this.normaliseIdForCompare(this.getIssueId(pin.issue)) === this.normaliseIdForCompare(this.selectedIssueId);
  }

  isKeepingSelectedPinVisible(pin) {
    return this.isSelectedPin(pin) && Date.now() < this.selectedPinKeepVisibleUntil;
  }

  keepSelectedPinVisible(pin) {
    if (!pin || !this.isSelectedPin(pin)) return;

    this.selectedPinKeepVisibleUntil = Date.now() + 2600;
    this.schedulePinUpdateBurst([0, 120, 300, 650, 1100, 1800, 2600]);

    [350, 900, 1500].forEach(delay => {
      window.setTimeout(() => {
        this.refitIfSelectedPinIsOutsideView(pin);
      }, delay);
    });
  }

  refitIfSelectedPinIsOutsideView(pin) {
    if (!this.isKeepingSelectedPinVisible(pin) || !pin.worldPoint || !this.viewer?.container) return;
    if (!this.issuePassesActiveFilter(this.getIssueId(pin.issue))) return;
    if (Date.now() < this.suppressSelectedPinRefitUntil) return;

    const screen = this.worldToClientSafe(pin.worldPoint);
    const width = this.viewer.container.clientWidth;
    const height = this.viewer.container.clientHeight;

    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return;

    const outsideView =
      screen.x < 24 ||
      screen.y < 24 ||
      screen.x > width - 24 ||
      screen.y > height - 24;

    if (!outsideView) return;

    if (this.isCurrentModel2d()) {
      this.focus2dIssuePin(pin, { fitCamera: true });
    } else {
      this.focusCameraOnPoint(pin.worldPoint, this.getCropSize());
    }

    this.schedulePinUpdateBurst([0, 120, 320]);
  }

  ensureIssueViewableLoaded(issue, targetViewable = null) {
    const viewable = targetViewable || this.getIssuePreferredViewable(issue);
    const doc = window.currentDocument;
    if (!viewable || !doc?.getRoot || !this.viewer?.model) return Promise.resolve(false);

    const activeKeys = this.getCurrentViewableKeys();
    const issueKeys = this.getIssueViewableKeys(viewable);
    if (issueKeys.some(key => activeKeys.has(key))) return Promise.resolve(false);

    const targetNode = this.findViewableNode(doc.getRoot(), issueKeys);
    if (!targetNode) return Promise.resolve(false);

    return Promise.resolve(this.viewer.loadDocumentNode(doc, targetNode))
      .then(() => {
        this.updateCurrentViewInfoFromNode(targetNode);
        this.drawPins();
        return true;
      })
      .catch(() => false);
  }

  updateCurrentViewInfoFromNode(node) {
    const data = node?.data || {};
    const activeView = {
      id: data.id || data.guid || data.viewableID || data.viewableId || null,
      guid: data.guid || data.viewableID || data.viewableId || data.id || null,
      viewableId: data.viewableID || data.viewableId || data.guid || data.id || null,
      name: data.name || data.displayName || data.label || null,
      displayName: data.displayName || data.name || data.label || null,
      is3D: data.is3D,
      is2D: data.is2D || data.is2d
    };

    window.currentModelInfo = {
      ...(window.currentModelInfo || {}),
      activeView,
      viewable: node || null
    };
    this.modelInfo = window.currentModelInfo;

    document.dispatchEvent(new CustomEvent('viewerdocumentviewchanged', {
      detail: {
        modelInfo: window.currentModelInfo,
        viewable: node
      }
    }));
  }

  getIssuePreferredViewable(issue) {
    const linked = this.rankLinkedDocumentsForCurrentView(issue?.linkedDocuments || issue?.attributes?.linkedDocuments || []);
    if (this.getLinkedDocumentViewable(linked[0])) return this.getLinkedDocumentViewable(linked[0]);

    const placements = this.rankPlacementsForCurrentView(issue?.placements || issue?.attributes?.placements || []);
    return this.getPlacementViewable(placements[0]);
  }

  getIssuePreferredViewableByType(issue) {
    const viewables = this.getIssueViewables(issue);
    if (!viewables.length) return null;

    const want2d = !this.isCurrentModel2d();
    const matchingType = viewables.find(viewable => this.is2dViewable(viewable) === want2d);

    return matchingType || viewables[0];
  }

  getIssue2dViewable(issue) {
    return this.getIssueViewables(issue).find(viewable => this.is2dViewable(viewable)) || null;
  }

  getIssueViewables(issue) {
    const linkedDocuments = Array.isArray(issue?.linkedDocuments)
      ? issue.linkedDocuments
      : Array.isArray(issue?.attributes?.linkedDocuments)
        ? issue.attributes.linkedDocuments
        : [];
    const placements = Array.isArray(issue?.placements)
      ? issue.placements
      : Array.isArray(issue?.attributes?.placements)
        ? issue.attributes.placements
        : [];
    const viewables = [
      ...linkedDocuments.map(linkedDocument => this.getLinkedDocumentViewable(linkedDocument)),
      ...placements.map(placement => this.getPlacementViewable(placement)),
      this.getPlacementViewable(issue?.placement || issue?.attributes?.placement)
    ].filter(Boolean);

    return viewables;
  }

  is2dViewable(viewable) {
    if (!viewable) return false;
    const typeText = String(
      viewable.role ||
      viewable.type ||
      viewable.viewType ||
      viewable.data?.role ||
      viewable.data?.type ||
      viewable.data?.viewType ||
      ''
    ).toLowerCase();

    return viewable.is3D === false ||
      viewable.is2D === true ||
      viewable.is2d === true ||
      viewable.data?.is3D === false ||
      viewable.data?.is2D === true ||
      viewable.data?.is2d === true ||
      typeText === '2d' ||
      typeText === 'sheet' ||
      typeText.includes('2d');
  }

  issueViewableIsActive(viewable) {
    const activeKeys = this.getCurrentViewableKeys();
    return this.getIssueViewableKeys(viewable).some(key => activeKeys.has(key));
  }

  getIssueViewableKeys(viewable) {
    return [
      viewable?.id,
      viewable?.guid,
      viewable?.viewableId,
      viewable?.viewableID,
      viewable?.name,
      viewable?.displayName,
      viewable?.data?.id,
      viewable?.data?.guid,
      viewable?.data?.viewableId,
      viewable?.data?.viewableID,
      viewable?.data?.name,
      viewable?.data?.displayName
    ].map(value => this.normaliseViewableKey(value)).filter(Boolean);
  }

  resolveIssueViewableDisplayName(issue, viewable) {
    const nodeName = this.getLoadedDocumentViewableName(viewable);
    if (nodeName) return nodeName;

    return this.getIssueViewableDisplayName(issue, viewable);
  }

  async resolveIssueViewableDisplayNameForPrompt(issue, viewable) {
    let viewName = this.resolveIssueViewableDisplayName(issue, viewable);

    if (!this.isMissingIssueViewName(viewName)) {
      return viewName;
    }

    if (typeof window.getIssueLinkedViewDisplayName !== 'function') {
      return viewName;
    }

    const resolvedName = await window.getIssueLinkedViewDisplayName(issue);
    return this.isMissingIssueViewName(resolvedName) ? viewName : resolvedName;
  }

  getLoadedDocumentViewableName(viewable) {
    const doc = window.currentDocument;
    if (!doc?.getRoot || !viewable) return '';

    const node = this.findViewableNode(doc.getRoot(), this.getIssueViewableKeys(viewable));
    const data = node?.data || {};
    const name = data.displayName || data.name || data.label || data.title || '';

    return this.isWeakViewName(name) ? '' : name;
  }

  getIssueViewableDisplayName(issue, viewable) {
    const viewName = viewable?.displayName ||
      viewable?.name ||
      viewable?.label ||
      viewable?.title ||
      viewable?.viewName ||
      viewable?.data?.displayName ||
      viewable?.data?.name ||
      viewable?.data?.label ||
      viewable?.data?.title ||
      viewable?.data?.viewName ||
      '';
    const documentName = this.getIssueDocumentDisplayName(issue);

    if (!this.isWeakViewName(viewName)) return viewName;
    if (documentName && viewName) return `${documentName} - page ${String(viewName).replace(/[()]/g, '').trim()}`;
    if (documentName) return documentName;

    return 'unknown 2D view';
  }

  getIssueDocumentDisplayName(issue) {
    const linked = issue?.linkedDocuments?.[0] || issue?.attributes?.linkedDocuments?.[0] || {};
    const placement = issue?.placements?.[0] || issue?.attributes?.placements?.[0] || issue?.placement || {};

    return linked.displayName ||
      linked.name ||
      linked.fileName ||
      linked.title ||
      linked.documentName ||
      linked.itemName ||
      linked.versionName ||
      linked.details?.displayName ||
      linked.details?.name ||
      linked.details?.fileName ||
      linked.details?.title ||
      linked.details?.documentName ||
      linked.details?.itemName ||
      linked.details?.versionName ||
      linked.attributes?.displayName ||
      linked.attributes?.name ||
      linked.attributes?.fileName ||
      linked.attributes?.title ||
      linked.attributes?.documentName ||
      linked.attributes?.itemName ||
      linked.attributes?.versionName ||
      linked.item?.attributes?.displayName ||
      linked.item?.attributes?.name ||
      linked.item?.attributes?.fileName ||
      linked.version?.attributes?.displayName ||
      linked.version?.attributes?.name ||
      linked.version?.attributes?.fileName ||
      linked.raw?.attributes?.displayName ||
      linked.raw?.attributes?.name ||
      linked.raw?.attributes?.fileName ||
      placement.displayName ||
      placement.name ||
      placement.fileName ||
      placement.title ||
      placement.documentName ||
      placement.itemName ||
      placement.versionName ||
      placement.details?.displayName ||
      placement.details?.name ||
      placement.details?.fileName ||
      placement.details?.title ||
      placement.details?.documentName ||
      placement.details?.itemName ||
      placement.details?.versionName ||
      placement.attributes?.displayName ||
      placement.attributes?.name ||
      placement.attributes?.fileName ||
      placement.attributes?.title ||
      placement.attributes?.documentName ||
      placement.attributes?.itemName ||
      placement.attributes?.versionName ||
      placement.item?.attributes?.displayName ||
      placement.item?.attributes?.name ||
      placement.item?.attributes?.fileName ||
      placement.version?.attributes?.displayName ||
      placement.version?.attributes?.name ||
      placement.version?.attributes?.fileName ||
      placement.raw?.attributes?.displayName ||
      placement.raw?.attributes?.name ||
      placement.raw?.attributes?.fileName ||
      '';
  }

  isWeakViewName(value) {
    const name = String(value || '').trim();
    return !name || /^\(?\d+\)?$/.test(name);
  }

  isMissingIssueViewName(value) {
    const name = String(value || '').trim();
    return !name || /^unknown\b/i.test(name) || this.isWeakViewName(name);
  }

  findViewableNode(root, issueKeys) {
    const queue = [root];
    while (queue.length) {
      const node = queue.shift();
      const data = node?.data || {};
      const keys = [data.guid, data.viewableID, data.id, data.name].map(v => this.normaliseViewableKey(v)).filter(Boolean);
      if (keys.some(key => issueKeys.includes(key))) return node;
      (node?.children || []).forEach(child => queue.push(child));
    }
    return null;
  }

  restoreIssueViewportOnly(viewerState) {
    const viewport = this.getViewportFromViewerState(viewerState);

    if (!viewport || !this.viewer?.navigation) return false;

    const nav = this.viewer.navigation;

    try {
      const eye = this.vectorFromAny(
        viewport.eye ||
        viewport.position ||
        viewport.camera?.position
      );

      const target = this.vectorFromAny(
        viewport.pivotPoint ||
        viewport.target ||
        viewport.center
      );

      const up = this.vectorFromAny(
        viewport.up ||
        viewport.worldUpVector ||
        viewport.camera?.up
      );

      const eyeVector = eye
        ? new THREE.Vector3(Number(eye.x), Number(eye.y), Number(eye.z))
        : null;

      const targetVector = target
        ? new THREE.Vector3(Number(target.x), Number(target.y), Number(target.z))
        : null;

      const upVector = up
        ? new THREE.Vector3(Number(up.x), Number(up.y), Number(up.z))
        : null;

      if (viewport.projection) {
        const projection = String(viewport.projection).toLowerCase();

        if (projection.includes('perspective') && typeof nav.toPerspective === 'function') {
          nav.toPerspective();
        }

        if (projection.includes('orthographic') && typeof nav.toOrthographic === 'function') {
          nav.toOrthographic();
        }
      }

      if (eyeVector && targetVector && typeof nav.setView === 'function') {
        nav.setView(eyeVector, targetVector);
      } else {
        if (eyeVector && typeof nav.setPosition === 'function') {
          nav.setPosition(eyeVector);
        }

        if (targetVector && typeof nav.setTarget === 'function') {
          nav.setTarget(targetVector);
        }
      }

      if (targetVector && typeof nav.setPivotPoint === 'function') {
        nav.setPivotPoint(targetVector);
      }

      if (upVector && typeof nav.setCameraUpVector === 'function') {
        nav.setCameraUpVector(upVector);
      }

      if (viewport.fieldOfView && typeof nav.setVerticalFov === 'function') {
        nav.setVerticalFov(Number(viewport.fieldOfView), true);
      }

      if (
        viewport.orthographicHeight &&
        this.viewer.getCamera &&
        this.viewer.getCamera()?.isOrthographicCamera
      ) {
        const camera = this.viewer.getCamera();
        const aspect = Number(viewport.aspectRatio || camera.aspect || 1.3333333333);
        const height = Number(viewport.orthographicHeight);
        const width = height * aspect;

        camera.left = -width / 2;
        camera.right = width / 2;
        camera.top = height / 2;
        camera.bottom = -height / 2;

        if (typeof camera.updateProjectionMatrix === 'function') {
          camera.updateProjectionMatrix();
        }
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

  async focusAndSectionIssue(pin, options = {}) {
    if (!pin) return;
    if (!this.issuePassesActiveFilter(this.getIssueId(pin.issue))) return;

    if (this.isCurrentModel2d()) {
      this.focus2dIssuePin(pin, options);
      return;
    }

    const fitCamera = options.fitCamera !== false;

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
      await this.applyCropAroundPoint(cropPoint, cropSource, { fitCamera });
    } else if (fitCamera) {
      this.focusCameraOnPoint(cropPoint, this.getCropSize());
    }

    this.keepSelectedPinVisible(pin);
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

  fitCameraToBox(box) {
    if (!box || !this.viewer?.navigation || typeof this.viewer.navigation.fitBounds !== 'function') {
      return false;
    }

    try {
      this.viewer.navigation.fitBounds(false, box);
      return true;
    } catch (error) {
      console.warn('[ACC Issue Pins] fitBounds failed.', error);
      return false;
    }
  }

  async applyCropAroundPoint(point, source, options = {}) {
    if (!point || !this.viewer?.model) return false;

    if (this.isCurrentModel2d()) {
      this.setStatus('Issue selected on a 2D view. Section box is only available in 3D views.');
      return false;
    }

    const cropBox = this.makeBoxAroundPoint(point);
    const fitBox = this.makeFitBox(cropBox);

    if (options.fitCamera !== false) {
      this.fitCameraToBox(fitBox);
    }

    const sectionExtension = await this.getSectionExtension();

    if (sectionExtension && typeof sectionExtension.setSectionBox === 'function') {
      sectionExtension.setSectionBox(cropBox);

      if (this.viewer.impl && typeof this.viewer.impl.invalidate === 'function') {
        this.viewer.impl.invalidate(true, true, true);
      }

      if (options.fitCamera !== false) {
        this.fitCameraToBox(fitBox);
        setTimeout(() => this.fitCameraToBox(fitBox), 250);
      }

      this.setStatus(`Issue crop applied from ${source}.`);
      return true;
    }

    if (sectionExtension && typeof sectionExtension.activate === 'function') {
      sectionExtension.activate('box');
      this.setCutPlanesFromBox(cropBox);
      if (options.fitCamera !== false) {
        this.fitCameraToBox(fitBox);
        setTimeout(() => this.fitCameraToBox(fitBox), 250);
      }
      this.setStatus('Issue crop applied using fallback cut planes.');
      return true;
    }

    this.setCutPlanesFromBox(cropBox);
    if (options.fitCamera !== false) {
      this.fitCameraToBox(fitBox);
      setTimeout(() => this.fitCameraToBox(fitBox), 250);
    }
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

    if (this.isCurrentModel2d()) {
      this.setStatus('2D view: no section box to clear.');
      return false;
    }

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

    return true;
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

  focus2dIssuePin(pin, options = {}) {
    if (!pin?.worldPoint || !this.viewer?.navigation) return;

    const point = pin.worldPoint.clone
      ? pin.worldPoint.clone()
      : new THREE.Vector3(pin.worldPoint.x, pin.worldPoint.y, pin.worldPoint.z || 0);

    try {
      if (options.fitCamera !== false && typeof this.viewer.navigation.fitBounds === 'function') {
        const focusSize = this.get2dFocusSize();
        const half = focusSize / 2;
        const bounds = new THREE.Box3(
          new THREE.Vector3(point.x - half, point.y - half, point.z - 0.01),
          new THREE.Vector3(point.x + half, point.y + half, point.z + 0.01)
        );

        this.viewer.navigation.fitBounds(false, bounds);
      } else {
        if (typeof this.viewer.navigation.setPivotPoint === 'function') {
          this.viewer.navigation.setPivotPoint(point);
        }

        if (typeof this.viewer.navigation.setTarget === 'function') {
          this.viewer.navigation.setTarget(point);
        }
      }

      if (this.viewer.impl && typeof this.viewer.impl.invalidate === 'function') {
        this.viewer.impl.invalidate(true, true, true);
      }
    } catch (error) {
      console.warn('[ACC Issue Pins] Could not focus 2D issue pin:', error);
    }

    this.schedulePinUpdate();
    setTimeout(() => this.schedulePinUpdate(), 250);
  }

  get2dFocusSize() {
    const modelBox = this.getModelBoundingBox();
    if (!modelBox) return Math.max(this.getCropSize(), 1);

    const size = new THREE.Vector3();
    modelBox.getSize(size);

    const sheetSize = Math.max(size.x || 0, size.y || 0, 1);
    return Math.max(sheetSize * 0.006, Math.min(sheetSize * 0.025, sheetSize * 0.015));
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
    const worldPoint = pin.worldPoint ? pin.worldPoint.toArray() : null;
    this.dispatchIssueSelectedFromIssue(issue, worldPoint);
  }

  dispatchIssueSelectedFromIssue(issue, worldPoint) {
    const safeIssue = issue || {};
    const detail = {
      issue: safeIssue,
      summary: {
        id: this.getIssueId(safeIssue),
        displayId: this.getIssueDisplayId(safeIssue),
        title: this.getIssueTitle(safeIssue),
        status: this.getIssueStatus(safeIssue),
        type: this.getIssueType(safeIssue),
        category: this.getIssueCategory(safeIssue),
        description: this.getIssueDescription(safeIssue),
        assignedTo: this.getAssignedTo(safeIssue),
        location: this.getLocation(safeIssue),
        worldPoint: worldPoint || null,
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

      const screen = this.worldToClientSafe(pin.worldPoint);
      const keepSelectedVisible = this.isKeepingSelectedPinVisible(pin);

      if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
        pin.element.classList.toggle('hidden-pin', !keepSelectedVisible);
        return;
      }

      const isVisible =
        screen.x >= -120 &&
        screen.y >= -120 &&
        screen.x <= width + 120 &&
        screen.y <= height + 120;

      const x = keepSelectedVisible
        ? Math.max(16, Math.min(width - 16, screen.x))
        : screen.x;
      const y = keepSelectedVisible
        ? Math.max(16, Math.min(height - 16, screen.y))
        : screen.y;

      pin.element.style.left = `${x}px`;
      pin.element.style.top = `${y}px`;
      pin.element.classList.toggle('hidden-pin', !(isVisible || keepSelectedVisible));
    });

    this.applySelectedPinStyle();
    this.forceSelectedPinElementRed();
  }

  worldToClientSafe(point) {
    try {
      if (!point || typeof this.viewer?.worldToClient !== 'function') return null;
      return this.viewer.worldToClient(point);
    } catch {
      return null;
    }
  }

  getBestWorldPoint(issue) {
    const rawPoint = this.getPrimaryAccPushpinPoint(issue);

    if (!rawPoint || !this.isFiniteVector(rawPoint)) {
      const pivotFallback = this.getIssuePivotPoint(issue);

      if (pivotFallback && this.isFiniteVector(pivotFallback)) {
        const pivotPoint = new THREE.Vector3(pivotFallback.x, pivotFallback.y, pivotFallback.z);

        return pivotPoint;
      }

      return null;
    }

    const candidates = this.getPointCandidatesForCurrentModel(issue, rawPoint);
    const best = this.chooseBestPointCandidate(candidates);

    if (!best) return null;

    return best.point;
  }

  getPointCandidatesForCurrentModel(issue, rawPoint) {
    const modelData = this.viewer?.model?.getData?.() || {};
    const globalOffset = modelData.globalOffset || { x: 0, y: 0, z: 0 };

    const offset = new THREE.Vector3(
      Number(globalOffset.x || 0),
      Number(globalOffset.y || 0),
      Number(globalOffset.z || 0)
    );

    const raw = rawPoint.clone
      ? rawPoint.clone()
      : new THREE.Vector3(Number(rawPoint.x), Number(rawPoint.y), Number(rawPoint.z));

    if (this.isCurrentModel2d()) {
      const candidates = [];
      const sheetPoints = this.get2dSheetPointCandidates(raw);

      sheetPoints.forEach(candidate => candidates.push(candidate));

      candidates.push(
        {
          name: 'Raw 2D viewer position',
          point: new THREE.Vector3(raw.x, raw.y, Number.isFinite(raw.z) ? raw.z : 0),
          priority: 10
        },
        {
          name: 'Raw 2D viewer position at Z 0',
          point: new THREE.Vector3(raw.x, raw.y, 0),
          priority: 20
        },
        {
          name: 'Raw - current model globalOffset',
          point: raw.clone().sub(offset),
          priority: 90
        }
      );

      return candidates.sort((a, b) => a.priority - b.priority);
    }

    const candidates = [];

    const issueOffset = this.getIssueGlobalOffset(issue);

    if (issueOffset) {
      const issueGlobal = raw.clone().add(issueOffset);
      const localFromIssueOffset = issueGlobal.sub(offset);

      candidates.push({
        name: 'Raw + issue globalOffset - current model globalOffset',
        point: localFromIssueOffset,
        priority: 5
      });
    }

    const localFromCurrentOffset = raw.clone().sub(offset);

    candidates.push(
      {
        name: 'Raw - current model globalOffset',
        point: localFromCurrentOffset,
        priority: 10
      },
      {
        name: 'Raw ACC position',
        point: raw.clone(),
        priority: 20
      },
      {
        name: 'Raw - Z globalOffset only',
        point: new THREE.Vector3(raw.x, raw.y, raw.z - offset.z),
        priority: 30
      },
      {
        name: 'Raw + current model globalOffset',
        point: raw.clone().add(offset),
        priority: 90
      },
      {
        name: 'Raw + Z globalOffset only',
        point: new THREE.Vector3(raw.x, raw.y, raw.z + offset.z),
        priority: 100
      }
    );

    return candidates.sort((a, b) => a.priority - b.priority);
  }

  chooseBestPointCandidate(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    if (!this.isCurrentModel2d()) {
      return candidates[0];
    }

    return candidates
      .map(candidate => ({
        ...candidate,
        placementScore: this.getPointPlacementScore(candidate.point)
      }))
      .sort((a, b) => {
        if (b.placementScore !== a.placementScore) {
          return b.placementScore - a.placementScore;
        }

        return a.priority - b.priority;
      })[0];
  }

  getPointPlacementScore(point) {
    if (!this.isFiniteVector(point)) return -1000;

    let score = 0;

    const box = this.getModelBoundingBox();

    if (box) {
      const size = new THREE.Vector3();
      box.getSize(size);

      const diagonal = Math.max(size.length(), 1);

      if (box.containsPoint(point)) {
        score += 100;
      } else {
        const expandedBox = box.clone();
        expandedBox.expandByScalar(Math.max(diagonal * 0.05, 1));

        if (expandedBox.containsPoint(point)) {
          score += 60;
        } else {
          const nearestPoint = this.clampPointToBox(point, box);
          const distance = point.distanceTo(nearestPoint);

          if (Number.isFinite(distance)) {
            score -= Math.min(80, (distance / diagonal) * 40);
          }
        }
      }
    }

    score += this.getPointVisibilityScore(point) * 10;

    return score;
  }

  getIssueGlobalOffset(issue) {
    const linkedDocuments = this.rankLinkedDocumentsForCurrentView(
      issue?.linkedDocuments || issue?.attributes?.linkedDocuments || []
    );
    const placements = this.rankPlacementsForCurrentView(
      issue?.placements || issue?.attributes?.placements || []
    );

    const candidates = [
      issue?.viewerState?.globalOffset,
      issue?.attributes?.viewerState?.globalOffset,
      issue?.placement?.viewerState?.globalOffset,
      issue?.placement?.details?.viewerState?.globalOffset,
      ...placements.flatMap(placement => [
        placement?.viewerState?.globalOffset,
        placement?.details?.viewerState?.globalOffset
      ]),
      ...linkedDocuments.flatMap(linkedDocument => [
        linkedDocument?.details?.viewerState?.globalOffset,
        linkedDocument?.viewerState?.globalOffset
      ]),
      issue?.details?.viewerState?.globalOffset,
      issue?.pushpin?.viewerState?.globalOffset
    ];

    for (const candidate of candidates) {
      const vector = this.vectorFromAny(candidate);

      if (this.isFiniteVector(vector)) {
        return new THREE.Vector3(vector.x, vector.y, vector.z);
      }
    }

    return null;
  }

  get2dSheetPointCandidates(raw) {
    if (!this.isNormalised2dPoint(raw)) return [];

    const box = this.getModelBoundingBox();
    if (!box) return [];

    const size = new THREE.Vector3();
    box.getSize(size);

    const x = box.min.x + raw.x * size.x;
    const yFromTop = box.max.y - raw.y * size.y;
    const yFromBottom = box.min.y + raw.y * size.y;
    const z = Number.isFinite(box.min.z) ? box.min.z : 0;

    return [
      {
        name: 'Normalised 2D sheet position',
        point: new THREE.Vector3(x, yFromTop, z),
        priority: 1
      },
      {
        name: 'Normalised 2D sheet position, bottom origin',
        point: new THREE.Vector3(x, yFromBottom, z),
        priority: 2
      }
    ];
  }

  isNormalised2dPoint(point) {
    return (
      point &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x >= 0 &&
      point.x <= 1 &&
      point.y >= 0 &&
      point.y <= 1
    );
  }

  getPointVisibilityScore(point) {
    if (!point || typeof this.viewer?.worldToClient !== 'function') return 0;

    try {
      const screen = this.worldToClientSafe(point);
      if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return 0;

      const container = this.viewer.container;
      const width = container?.clientWidth || 0;
      const height = container?.clientHeight || 0;

      const onScreen =
        screen.x >= -120 &&
        screen.y >= -120 &&
        screen.x <= width + 120 &&
        screen.y <= height + 120;

      return onScreen ? 2 : 1;
    } catch {
      return 0;
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

  clampPointToBox(point, box) {
    const x = Math.max(box.min.x, Math.min(box.max.x, point.x));
    const y = Math.max(box.min.y, Math.min(box.max.y, point.y));
    const z = Math.max(box.min.z, Math.min(box.max.z, point.z));

    return new THREE.Vector3(x, y, z);
  }

  getPrimaryAccPushpinPoint(issue) {
    const linkedDocuments =
      issue?.linkedDocuments ||
      issue?.attributes?.linkedDocuments ||
      [];

    const preferredLinkedDocuments = this.rankLinkedDocumentsForCurrentView(linkedDocuments);

    for (const linkedDocument of preferredLinkedDocuments) {
      const details = linkedDocument?.details || {};
      const viewable = this.getLinkedDocumentViewable(linkedDocument);

      const position =
        details?.position ||
        details?.pushpinPosition ||
        details?.viewerPosition ||
        details?.point ||
        linkedDocument?.position ||
        null;

      const vector = this.vectorFromAny(
        this.parseJsonIfString(position) || position,
        this.canUse2dPoint(viewable)
      );

      if (this.isFiniteVector(vector)) {
        return new THREE.Vector3(vector.x, vector.y, vector.z);
      }
    }

    const placements =
      issue?.placements ||
      issue?.attributes?.placements ||
      [];

    const preferredPlacements = this.rankPlacementsForCurrentView(placements);

    for (const placement of preferredPlacements) {
      const details = placement?.details || {};
      const viewable = this.getPlacementViewable(placement);

      const position =
        details?.position ||
        details?.pushpinPosition ||
        details?.viewerPosition ||
        details?.point ||
        placement?.position ||
        null;

      const vector = this.vectorFromAny(
        this.parseJsonIfString(position) || position,
        this.canUse2dPoint(viewable)
      );

      if (this.isFiniteVector(vector)) {
        return new THREE.Vector3(vector.x, vector.y, vector.z);
      }
    }

    const directCandidates = [
      issue?.placement?.details?.position,
      issue?.placement?.details?.pushpinPosition,
      issue?.placement?.details?.viewerPosition,
      issue?.placement?.details?.point,
      issue?.placement?.position,
      issue?.pushpin?.position,
      issue?.pushpinPosition,
      issue?.position
    ];

    for (const candidate of directCandidates) {
      const vector = this.vectorFromAny(
        this.parseJsonIfString(candidate) || candidate,
        this.isCurrentModel2d()
      );

      if (this.isFiniteVector(vector)) {
        return new THREE.Vector3(vector.x, vector.y, vector.z);
      }
    }

    return null;
  }

  rankLinkedDocumentsForCurrentView(linkedDocuments) {
    const ordered = Array.isArray(linkedDocuments) ? [...linkedDocuments] : [];
    const currentKeys = this.getCurrentViewableKeys();

    return ordered.sort((a, b) => this.scoreViewableMatch(this.getLinkedDocumentViewable(b), currentKeys) - this.scoreViewableMatch(this.getLinkedDocumentViewable(a), currentKeys));
  }

  rankPlacementsForCurrentView(placements) {
    const ordered = Array.isArray(placements) ? [...placements] : [];
    const currentKeys = this.getCurrentViewableKeys();

    return ordered.sort((a, b) => this.scoreViewableMatch(this.getPlacementViewable(b), currentKeys) - this.scoreViewableMatch(this.getPlacementViewable(a), currentKeys));
  }

  getLinkedDocumentViewable(linkedDocument) {
    return linkedDocument?.details?.viewable || linkedDocument?.viewable || null;
  }

  getPlacementViewable(placement) {
    return placement?.details?.viewable || placement?.viewable || null;
  }

  canUse2dPoint(viewable) {
    return this.isCurrentModel2d() || viewable?.is3D === false;
  }

  getCurrentViewableKeys() {
    const model = this.viewer?.model;
    const node = model?.getDocumentNode?.();
    const data = model?.getData?.() || {};
    const activeView = window.currentModelInfo?.activeView || this.modelInfo?.activeView || {};

    return new Set([
      this.normaliseViewableKey(node?.data?.id),
      this.normaliseViewableKey(node?.data?.guid),
      this.normaliseViewableKey(node?.data?.viewableID),
      this.normaliseViewableKey(node?.data?.viewableId),
      this.normaliseViewableKey(node?.data?.name),
      this.normaliseViewableKey(data?.id),
      this.normaliseViewableKey(data?.guid),
      this.normaliseViewableKey(data?.viewableID),
      this.normaliseViewableKey(data?.viewableId),
      this.normaliseViewableKey(data?.name),
      this.normaliseViewableKey(activeView?.id),
      this.normaliseViewableKey(activeView?.guid),
      this.normaliseViewableKey(activeView?.viewableId),
      this.normaliseViewableKey(activeView?.viewableID),
      this.normaliseViewableKey(activeView?.name)
    ].filter(Boolean));
  }

  normaliseViewableKey(value) {
    return String(value || '').trim().toLowerCase();
  }

  scoreViewableMatch(viewable, currentKeys) {
    if (!viewable || !currentKeys || currentKeys.size === 0) return 0;

    const keys = [
      this.normaliseViewableKey(viewable.id),
      this.normaliseViewableKey(viewable.viewableId),
      this.normaliseViewableKey(viewable.viewableID),
      this.normaliseViewableKey(viewable.guid),
      this.normaliseViewableKey(viewable.name),
      this.normaliseViewableKey(viewable.displayName),
      this.normaliseViewableKey(viewable.data?.id),
      this.normaliseViewableKey(viewable.data?.viewableId),
      this.normaliseViewableKey(viewable.data?.viewableID),
      this.normaliseViewableKey(viewable.data?.guid),
      this.normaliseViewableKey(viewable.data?.name),
      this.normaliseViewableKey(viewable.data?.displayName)
    ].filter(Boolean);

    return keys.some(key => currentKeys.has(key)) ? 1 : 0;
  }

  getIssuePivotPoint(issue) {
    const viewerState = this.getIssueViewerState(issue);
    const viewport = viewerState?.viewport || viewerState?.state?.viewport || null;

    const candidates = [
      viewport?.pivotPoint,
      viewport?.center,
      viewerState?.pivotPoint,
      viewerState?.target,
      viewport?.target
    ];

    for (const candidate of candidates) {
      const vector = this.vectorFromAny(candidate);

      if (this.isFiniteVector(vector)) {
        return new THREE.Vector3(vector.x, vector.y, vector.z);
      }
    }

    return null;
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

  vectorFromAny(value, allowMissingZ = false) {
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

      if (x !== undefined && y !== undefined && (z !== undefined || allowMissingZ)) {
        return {
          x: Number(x),
          y: Number(y),
          z: z === undefined ? 0 : Number(z)
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

  normaliseStatusFilter(value) {
    return this.normalise(value).replace(/_/g, ' ');
  }

  normaliseGuid(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[{}]/g, '');
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
