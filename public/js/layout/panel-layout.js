// Controls left/right panel collapse, resize handles, and viewer resize refresh.
// Do not put issue table rendering or ACC API calls here.
(function () {
  var MIN_VIEWER_WIDTH = 520;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getLayoutNumber(layout, name, fallback) {
    var value = getComputedStyle(layout).getPropertyValue(name);
    var number = parseFloat(value);

    return Number.isFinite(number) ? number : fallback;
  }

  function getPanelWidth(layout, name, fallback) {
    return getLayoutNumber(layout, name, fallback);
  }

  function getMaxLeftWidth(layout, viewportWidth) {
    var rightWidth = getPanelWidth(layout, '--right-width', 380);
    return Math.max(220, viewportWidth - rightWidth - MIN_VIEWER_WIDTH - 8);
  }

  function getMaxRightWidth(layout, viewportWidth) {
    var leftWidth = getPanelWidth(layout, '--left-width', 340);
    return Math.max(300, viewportWidth - leftWidth - MIN_VIEWER_WIDTH - 8);
  }

  function resizeViewerToLayout(reason) {
    var viewer = window.viewer;

    window.clearTimeout(resizeViewerToLayout.timer);

    if (viewer && typeof viewer.resize === 'function') {
      viewer.resize();
    }

    if (viewer?.impl && typeof viewer.impl.invalidate === 'function') {
      viewer.impl.invalidate(true, true, true);
    }

    if (typeof window.accIssuePinsRedraw === 'function') {
      window.accIssuePinsRedraw(reason || 'layout-resize');
    }

    resizeViewerToLayout.timer = window.setTimeout(function () {
      if (viewer && typeof viewer.resize === 'function') {
        viewer.resize();
      }

      if (viewer?.impl && typeof viewer.impl.invalidate === 'function') {
        viewer.impl.invalidate(true, true, true);
      }

      if (typeof window.accIssuePinsRedraw === 'function') {
        window.accIssuePinsRedraw((reason || 'layout-resize') + '-settled');
      }
    }, 120);
  }

  function initResizeGrip(gripId, side) {
    var grip = document.getElementById(gripId);
    var layout = document.getElementById('appLayout');

    if (!grip || !layout) return;

    grip.addEventListener('mousedown', function (event) {
      event.preventDefault();
      document.body.classList.add('resizing-panels');

      function onMouseMove(moveEvent) {
        var viewportWidth = window.innerWidth;

        if (side === 'left') {
          var leftWidth = clamp(moveEvent.clientX, 220, Math.min(viewportWidth * 0.85, getMaxLeftWidth(layout, viewportWidth)));
          layout.style.setProperty('--left-width', leftWidth + 'px');
          localStorage.setItem('acc-switchback-left-width', String(leftWidth));
          resizeViewerToLayout('left-panel-resize');
        }

        if (side === 'right') {
          var rightWidth = clamp(viewportWidth - moveEvent.clientX, 300, Math.min(viewportWidth * 0.85, getMaxRightWidth(layout, viewportWidth)));
          layout.style.setProperty('--right-width', rightWidth + 'px');
          localStorage.setItem('acc-switchback-right-width', String(rightWidth));
          resizeViewerToLayout('right-panel-resize');
        }
      }

      function onMouseUp() {
        document.body.classList.remove('resizing-panels');
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        resizeViewerToLayout(side + '-panel-resize-end');
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  function restoreWidths() {
    var layout = document.getElementById('appLayout');
    if (!layout) return;

    var leftWidth = localStorage.getItem('acc-switchback-left-width');
    var rightWidth = localStorage.getItem('acc-switchback-right-width');

    if (leftWidth) layout.style.setProperty('--left-width', leftWidth + 'px');
    if (rightWidth) layout.style.setProperty('--right-width', rightWidth + 'px');

    resizeViewerToLayout('restore-panel-widths');
  }

  function initViewerResizeObserver() {
    var viewerPanel = document.getElementById('viewerPanel');

    if (!viewerPanel || typeof ResizeObserver !== 'function') return;

    var resizeObserver = new ResizeObserver(function () {
      resizeViewerToLayout('viewer-panel-observer');
    });

    resizeObserver.observe(viewerPanel);
  }

  function initCollapseButtons() {
    var layout = document.getElementById('appLayout');
    if (!layout) return;

    var collapseLeft = document.getElementById('collapseLeftPanel');
    var expandLeft = document.getElementById('expandLeftPanel');
    var collapseRight = document.getElementById('collapseRightPanel');
    var expandRight = document.getElementById('expandRightPanel');

    if (collapseLeft) {
      collapseLeft.addEventListener('click', function (event) {
        event.preventDefault();
        layout.classList.add('left-collapsed');
        localStorage.setItem('acc-switchback-left-collapsed', 'true');
        resizeViewerToLayout('left-panel-collapsed');
      });
    }

    if (expandLeft) {
      expandLeft.addEventListener('click', function (event) {
        event.preventDefault();
        layout.classList.remove('left-collapsed');
        localStorage.setItem('acc-switchback-left-collapsed', 'false');
        resizeViewerToLayout('left-panel-expanded');
      });
    }

    if (collapseRight) {
      collapseRight.addEventListener('click', function (event) {
        event.preventDefault();
        layout.classList.add('right-collapsed');
        localStorage.setItem('acc-switchback-right-collapsed', 'true');
        resizeViewerToLayout('right-panel-collapsed');
      });
    }

    if (expandRight) {
      expandRight.addEventListener('click', function (event) {
        event.preventDefault();
        layout.classList.remove('right-collapsed');
        localStorage.setItem('acc-switchback-right-collapsed', 'false');
        resizeViewerToLayout('right-panel-expanded');
      });
    }

    if (localStorage.getItem('acc-switchback-left-collapsed') === 'true') {
      layout.classList.add('left-collapsed');
    }

    if (localStorage.getItem('acc-switchback-right-collapsed') === 'true') {
      layout.classList.add('right-collapsed');
    }

    resizeViewerToLayout('restore-panel-collapse-state');
  }

  function init() {
    restoreWidths();
    initResizeGrip('leftResizeGrip', 'left');
    initResizeGrip('rightResizeGrip', 'right');
    initViewerResizeObserver();
    initCollapseButtons();
  }

  window.PanelLayout = {
    init: init,
    resizeViewerToLayout: resizeViewerToLayout
  };
})();
