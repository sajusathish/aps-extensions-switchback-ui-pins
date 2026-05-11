class SwitchbackToRevitExtension extends Autodesk.Viewing.Extension {
  constructor(viewer, options) {
    super(viewer, options);
    this.group = null;
    this.button = null;
    this.toastTimer = null;
  }

  load() {
    if (this.viewer.toolbar) {
      this.createToolbarButton();
    } else {
      this.viewer.addEventListener(Autodesk.Viewing.TOOLBAR_CREATED_EVENT, () => {
        this.createToolbarButton();
      });
    }

    window.switchbackToRevitFromViewer = () => this.sendSwitchback();
    console.log('SwitchbackToRevit extension loaded.');
    return true;
  }

  unload() {
    if (this.group && this.button) {
      this.group.removeControl(this.button);
    }

    if (window.switchbackToRevitFromViewer) {
      delete window.switchbackToRevitFromViewer;
    }

    this.button = null;
    this.group = null;
    console.log('SwitchbackToRevit extension unloaded.');
    return true;
  }

  createToolbarButton() {
    if (this.button) return;

    this.group = this.viewer.toolbar.getControl('switchback-toolbar-group');

    if (!this.group) {
      this.group = new Autodesk.Viewing.UI.ControlGroup('switchback-toolbar-group');
      this.viewer.toolbar.addControl(this.group);
    }

    this.button = new Autodesk.Viewing.UI.Button('switchback-to-revit-button');
    this.button.setToolTip('Switchback current view to Revit');
    this.button.addClass('switchback-to-revit-button');

    this.button.onClick = async () => {
      await this.sendSwitchback();
    };

    this.group.addControl(this.button);
  }

  getCameraPayload() {
    const camera = this.viewer.getCamera();
    const target = this.viewer.navigation.getTarget();

    return {
      position: camera.position.toArray(),
      target: target.toArray(),
      up: camera.up.toArray(),
      isPerspective: camera.isPerspectiveCamera,
      fov: camera.fov,
      aspect: camera.aspect,
      near: camera.near,
      far: camera.far
    };
  }

  getModelPayload() {
    const model = this.viewer.model;

    if (!model) return null;

    return {
      urn: model.getData()?.urn || null,
      guid: model.getDocumentNode()?.data?.guid || null,
      name: window.currentModelInfo?.name || null,
      source: window.currentModelInfo || null,
      globalOffset: model.getData()?.globalOffset || null
    };
  }

  async sendSwitchback() {
    try {
      if (!this.viewer.model) {
        throw new Error('Load a model first.');
      }

      const payload = {
        type: 'ACC_VIEW_SWITCHBACK_TO_REVIT',
        source: 'aps-extensions-boilerplate',
        sentAtUtc: new Date().toISOString(),
        model: this.getModelPayload(),
        selectedIssue: window.accIssuePinsSelectedIssue || null,
        viewerState: this.viewer.getState({ viewport: true, objectSet: true }),
        camera: this.getCameraPayload()
      };

      const response = await fetch('/api/switchback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || 'Switchback request failed.');
      }

      const message = `Switchback JSON written to ${result.filePath}`;
      this.showToast(message);
      document.dispatchEvent(new CustomEvent('switchbackcomplete', { detail: { message, payload: result.payload || payload } }));
      console.log('Switchback payload:', result.payload || payload);
    } catch (error) {
      this.showToast(error.message, true);
      document.dispatchEvent(new CustomEvent('switchbackcomplete', { detail: { message: error.message, error: true } }));
      console.error(error);
    }
  }

  showToast(message, isError = false) {
    const container = this.viewer.container;

    if (!container) {
      alert(message);
      return;
    }

    let toast = container.querySelector('.viewer-switchback-toast');

    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'viewer-switchback-toast';
      container.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.background = isError ? 'rgba(127, 29, 29, 0.94)' : 'rgba(17, 24, 39, 0.94)';
    toast.style.display = 'block';

    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      toast.style.display = 'none';
    }, 4500);
  }
}

Autodesk.Viewing.theExtensionManager.registerExtension('SwitchbackToRevit', SwitchbackToRevitExtension);
