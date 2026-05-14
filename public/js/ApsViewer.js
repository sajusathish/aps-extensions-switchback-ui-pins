/////////////////////////////////////////////////////////////////////
// APS Viewer launcher
// FINAL_CORRECT: keep ACC saved view restore and let AccIssuePins use corrected coordinates
// Issue navigator workflow:
// - Right-side issue table
// - Click issue
// - Resolve latest linked document version
// - Load correct linked viewable
// - Restore issue viewerState
// - Redraw issue pins
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

var issueNavigatorIssues = [];
var issueNavigatorSelectedIssueId = null;
var issueNavigatorBusy = false;

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
    window.openIssueInLatestViewable = openIssueInLatestViewable;

    installPreDocumentBrowserContextCapture();
    installViewerLoadEventsForContextRestore();
    patchLoadDocumentNodeForViewChanges();

    // Layout.js owns the right-pane issue table.
    // ApsViewer.js only exposes openIssueInLatestViewable(issue) for that table and the pin extension.

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
// Issue navigator panel
/////////////////////////////////////////////////////////////////////

function installIssueNavigatorEvents() {
  document.addEventListener('accissuesloaded', function (event) {
    issueNavigatorIssues = event.detail && Array.isArray(event.detail.issues)
      ? event.detail.issues
      : [];

    renderIssueNavigatorTable();
  });

  document.addEventListener('accissueselected', function (event) {
    var detail = event.detail || {};
    var issue = detail.issue || {};
    var summary = detail.summary || {};

    issueNavigatorSelectedIssueId =
      issue.id ||
      summary.id ||
      issue.issueId ||
      null;

    renderIssueNavigatorTable();
  });

  document.addEventListener('issueviewableloaded', function (event) {
    var issue = event.detail && event.detail.issue ? event.detail.issue : null;

    if (issue) {
      issueNavigatorSelectedIssueId = getIssueIdForNavigator(issue);
      renderIssueNavigatorTable();
    }
  });
}

function installIssueNavigatorPanel() {
  injectIssueNavigatorStyles();

  var existing = document.getElementById('issueNavigatorPanel');
  if (existing) return existing;

  var rightPanel =
    document.getElementById('issueDetailsPanel') ||
    document.querySelector('.right-panel') ||
    document.querySelector('[data-panel="right"]');

  if (!rightPanel) {
    console.warn('[Issue Navigator] Could not find right panel. Falling back to appLayout.');
    rightPanel = document.getElementById('appLayout') || document.body;
  }

  var panel = document.createElement('div');
  panel.id = 'issueNavigatorPanel';
  panel.className = 'issue-navigator-panel';

  panel.innerHTML = `
    <div class="issue-navigator-header">
      <div>
        <div class="issue-navigator-title">Issues</div>
        <div id="issueNavigatorSubtitle" class="issue-navigator-subtitle">Waiting for issues...</div>
      </div>
      <button id="issueNavigatorRefreshButton" class="issue-navigator-refresh" type="button" title="Reload issues">↻</button>
    </div>

    <div class="issue-navigator-search-row">
      <input id="issueNavigatorSearchInput" class="issue-navigator-search" type="text" placeholder="Search by title, status, type, view..." />
    </div>

    <div id="issueNavigatorStatus" class="issue-navigator-status"></div>

    <div class="issue-navigator-table-wrap">
      <table class="issue-navigator-table">
        <thead>
          <tr>
            <th class="issue-col-id">#</th>
            <th class="issue-col-status">Status</th>
            <th>Issue</th>
            <th class="issue-col-view">View</th>
          </tr>
        </thead>
        <tbody id="issueNavigatorTableBody">
          <tr>
            <td colspan="4" class="issue-navigator-empty">No issues loaded.</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  if (rightPanel.id === 'issueDetailsPanel') {
    rightPanel.insertBefore(panel, rightPanel.firstChild);
  } else {
    rightPanel.appendChild(panel);
  }

  var refreshButton = document.getElementById('issueNavigatorRefreshButton');
  var searchInput = document.getElementById('issueNavigatorSearchInput');

  if (refreshButton) {
    refreshButton.addEventListener('click', function () {
      if (typeof window.accIssuePinsReload === 'function') {
        window.accIssuePinsReload();
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      renderIssueNavigatorTable();
    });
  }

  return panel;
}

function injectIssueNavigatorStyles() {
  if (document.getElementById('issueNavigatorRuntimeStyles')) return;

  var style = document.createElement('style');
  style.id = 'issueNavigatorRuntimeStyles';
  style.textContent = `
    .issue-navigator-panel {
      border-bottom: 1px solid #d9d9d9;
      background: #ffffff;
      color: #111827;
      font-family: Arial, sans-serif;
      max-height: 48vh;
      min-height: 260px;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
    }

    .issue-navigator-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px 8px;
      gap: 10px;
      border-bottom: 1px solid #e5e7eb;
      background: #ffffff;
    }

    .issue-navigator-title {
      font-size: 14px;
      font-weight: 700;
      line-height: 18px;
      color: #111827;
    }

    .issue-navigator-subtitle {
      font-size: 11px;
      color: #4b5563;
      margin-top: 2px;
    }

    .issue-navigator-refresh {
      width: 30px;
      height: 30px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: #f9fafb;
      color: #111827;
      cursor: pointer;
      font-size: 16px;
      line-height: 24px;
    }

    .issue-navigator-refresh:hover {
      background: #eef2ff;
      border-color: #93c5fd;
    }

    .issue-navigator-search-row {
      padding: 8px 12px;
      border-bottom: 1px solid #f0f0f0;
      background: #ffffff;
    }

    .issue-navigator-search {
      width: 100%;
      height: 32px;
      box-sizing: border-box;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 0 8px;
      font-size: 12px;
      color: #111827;
      background: #ffffff;
      outline: none;
    }

    .issue-navigator-search::placeholder {
      color: #6b7280;
    }

    .issue-navigator-search:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
    }

    .issue-navigator-status {
      display: none;
      padding: 7px 12px;
      font-size: 11px;
      color: #111827;
      background: #f3f4f6;
      border-bottom: 1px solid #e5e7eb;
    }

    .issue-navigator-status.visible {
      display: block;
    }

    .issue-navigator-table-wrap {
      overflow: auto;
      flex: 1;
      background: #ffffff;
    }

    .issue-navigator-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      color: #111827;
      background: #ffffff;
    }

    .issue-navigator-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #f9fafb;
      color: #374151;
      font-size: 11px;
      font-weight: 700;
      text-align: left;
      border-bottom: 1px solid #d1d5db;
      padding: 7px 8px;
      white-space: nowrap;
    }

    .issue-navigator-table td {
      border-bottom: 1px solid #f0f0f0;
      padding: 8px;
      vertical-align: top;
      color: #111827;
      background: transparent;
    }

    .issue-navigator-table tbody tr {
      cursor: pointer;
      background: #ffffff;
    }

    .issue-navigator-table tbody tr:hover {
      background: #f8fafc;
    }

    .issue-navigator-table tbody tr.selected {
      background: #eff6ff;
    }

    .issue-col-id {
      width: 42px;
      color: #111827;
      font-weight: 700;
    }

    .issue-col-status {
      width: 76px;
    }

    .issue-col-view {
      width: 116px;
    }

    .issue-status-pill {
      display: inline-block;
      max-width: 82px;
      border-radius: 999px;
      background: #e5e7eb;
      color: #111827;
      padding: 2px 7px;
      font-size: 10px;
      line-height: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .issue-row-title {
      font-weight: 700;
      color: #111827;
      line-height: 15px;
      max-height: 32px;
      overflow: hidden;
    }

    .issue-row-meta {
      margin-top: 3px;
      color: #4b5563;
      font-size: 10px;
      line-height: 13px;
    }

    .issue-row-view {
      color: #374151;
      font-size: 10px;
      line-height: 13px;
      max-height: 28px;
      overflow: hidden;
    }

    .issue-navigator-empty {
      padding: 16px 12px !important;
      color: #4b5563 !important;
      text-align: center;
      cursor: default;
    }
  `;

  document.head.appendChild(style);
}

function renderIssueNavigatorTable() {
  installIssueNavigatorPanel();

  var tableBody = document.getElementById('issueNavigatorTableBody');
  var subtitle = document.getElementById('issueNavigatorSubtitle');

  if (!tableBody) return;

  var query = '';
  var searchInput = document.getElementById('issueNavigatorSearchInput');

  if (searchInput) {
    query = String(searchInput.value || '').trim().toLowerCase();
  }

  var issues = issueNavigatorIssues || [];

  if (query) {
    issues = issues.filter(function (issue) {
      var searchText = [
        getIssueDisplayIdForNavigator(issue),
        getIssueTitleForNavigator(issue),
        getIssueStatusForNavigator(issue),
        getIssueTypeForNavigator(issue),
        getIssueViewNameForNavigator(issue),
        getIssueAssignedToForNavigator(issue)
      ].join(' ').toLowerCase();

      return searchText.indexOf(query) !== -1;
    });
  }

  if (subtitle) {
    subtitle.textContent = query
      ? issues.length + ' shown from ' + issueNavigatorIssues.length + ' issues'
      : issueNavigatorIssues.length + ' issues loaded';
  }

  if (!issues.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="4" class="issue-navigator-empty">No matching issues.</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = '';

  issues.forEach(function (issue) {
    var issueId = getIssueIdForNavigator(issue);
    var displayId = getIssueDisplayIdForNavigator(issue);
    var title = getIssueTitleForNavigator(issue);
    var status = getIssueStatusForNavigator(issue);
    var type = getIssueTypeForNavigator(issue);
    var viewName = getIssueViewNameForNavigator(issue);
    var assignedTo = getIssueAssignedToForNavigator(issue);

    var row = document.createElement('tr');

    if (issueId && issueId === issueNavigatorSelectedIssueId) {
      row.classList.add('selected');
    }

    row.innerHTML = `
      <td class="issue-col-id">${escapeHtml(displayId)}</td>
      <td class="issue-col-status"><span class="issue-status-pill">${escapeHtml(status)}</span></td>
      <td>
        <div class="issue-row-title">${escapeHtml(title)}</div>
        <div class="issue-row-meta">${escapeHtml(type)} · ${escapeHtml(assignedTo)}</div>
      </td>
      <td class="issue-col-view">
        <div class="issue-row-view">${escapeHtml(viewName)}</div>
      </td>
    `;

    row.addEventListener('click', function () {
      openIssueFromNavigator(issue);
    });

    tableBody.appendChild(row);
  });
}

async function openIssueFromNavigator(issue) {
  if (issueNavigatorBusy) return;

  issueNavigatorBusy = true;
  issueNavigatorSelectedIssueId = getIssueIdForNavigator(issue);
  renderIssueNavigatorTable();

  try {
    setIssueNavigatorStatus('Opening issue #' + getIssueDisplayIdForNavigator(issue) + '...');

    await openIssueInLatestViewable(issue);

    setIssueNavigatorStatus('Opened issue #' + getIssueDisplayIdForNavigator(issue) + '.');

    document.dispatchEvent(new CustomEvent('accissueselected', {
      detail: {
        issue: issue,
        summary: {
          id: getIssueIdForNavigator(issue),
          displayId: getIssueDisplayIdForNavigator(issue),
          title: getIssueTitleForNavigator(issue),
          status: getIssueStatusForNavigator(issue),
          type: getIssueTypeForNavigator(issue),
          assignedTo: getIssueAssignedToForNavigator(issue),
          location: getIssueLocationForNavigator(issue)
        }
      }
    }));
  } catch (error) {
    console.error(error);
    setIssueNavigatorStatus('Could not open issue: ' + error.message);
  } finally {
    issueNavigatorBusy = false;
    renderIssueNavigatorTable();
  }
}

function setIssueNavigatorStatus(message) {
  var status = document.getElementById('issueNavigatorStatus');

  if (status) {
    status.textContent = message || '';

    if (message) {
      status.classList.add('visible');
    } else {
      status.classList.remove('visible');
    }
  }

  var viewerStatus = document.getElementById('viewerActionStatus');

  if (viewerStatus && message) {
    viewerStatus.textContent = message;
  }
}

/////////////////////////////////////////////////////////////////////
// Open issue in latest linked viewable
/////////////////////////////////////////////////////////////////////

async function openIssueInLatestViewable(issue) {
  if (!viewer) {
    throw new Error('Viewer is not ready.');
  }

  var linkedDocument = getPrimaryLinkedDocument(issue);

  if (!linkedDocument) {
    throw new Error('Issue has no linked document.');
  }

  var projectId =
    window.currentModelInfo?.projectId ||
    currentViewerModelInfo?.projectId ||
    issue?.projectId ||
    issue?.attributes?.projectId ||
    null;

  if (!projectId) {
    throw new Error('Could not determine ACC projectId.');
  }

  var lineageUrn =
    linkedDocument.urn ||
    linkedDocument.lineageUrn ||
    issue?.placements?.[0]?.lineageUrn ||
    null;

  if (!lineageUrn) {
    throw new Error('Issue linked document does not include a lineage URN.');
  }

  var viewableGuid = getLinkedDocumentViewableGuid(linkedDocument);
  var viewableName = getLinkedDocumentViewableName(linkedDocument);
  var viewerState = getLinkedDocumentViewerState(linkedDocument);

  var latest = await resolveLatestVersionForLineage(projectId, lineageUrn);

  if (!latest || !latest.versionId || !latest.encodedUrn) {
    throw new Error('Could not resolve latest version for linked document.');
  }

  setIssueNavigatorStatus('Loading latest linked viewable...');

  var documentId = 'urn:' + latest.encodedUrn;
  var doc = await loadApsDocumentAsync(documentId);

  currentViewerDocument = doc;
  window.currentDocument = doc;

  loadDocumentBrowser();

  var viewable = findViewableInDocument(doc, viewableGuid, viewableName);

  if (!viewable) {
    viewable = doc.getRoot().getDefaultGeometry();
  }

  if (!viewable) {
    throw new Error('Could not find a viewable to load for this issue.');
  }

  skipNextViewContextRestore = true;

  var model = await viewer.loadDocumentNode(doc, viewable);

  var modelInfo = {
    ...(window.currentModelInfo || currentViewerModelInfo || {}),
    urn: latest.encodedUrn,
    name: latest.displayName || window.currentModelInfo?.name || currentViewerModelInfo?.name || 'Latest linked issue model',
    projectId: projectId,
    itemId: lineageUrn,
    versionId: latest.versionId,
    activeView: getViewableInfo(viewable),
    issueOpenedFromLinkedDocument: {
      issueId: getIssueIdForNavigator(issue),
      displayId: getIssueDisplayIdForNavigator(issue),
      lineageUrn: lineageUrn,
      latestVersionId: latest.versionId,
      viewableGuid: viewableGuid,
      viewableName: viewableName
    }
  };

  currentViewerModelInfo = modelInfo;
  window.currentModelInfo = modelInfo;

  dispatchViewerInstance(model, doc, viewable, 'issue-linked-viewable-loaded');

  await waitForViewerReadyAfterLoad();

  if (viewerState) {
    restoreIssueViewerState(viewerState);
  }

  window.currentIssueOpenedFromNavigator = issue;

  if (typeof window.accIssuePinsSelectIssue === 'function') {
    window.setTimeout(function () {
      window.accIssuePinsSelectIssue(getIssueIdForNavigator(issue), {
        preserveSavedView: true,
        source: 'openIssueInLatestViewable'
      });
    }, 350);
  }

  if (typeof window.accIssuePinsRedraw === 'function') {
    window.setTimeout(function () {
      window.accIssuePinsRedraw('issue-linked-viewable-250');
    }, 250);

    window.setTimeout(function () {
      window.accIssuePinsRedraw('issue-linked-viewable-900');
    }, 900);

    window.setTimeout(function () {
      window.accIssuePinsRedraw('issue-linked-viewable-1600');
    }, 1600);
  }

  document.dispatchEvent(new CustomEvent('issueviewableloaded', {
    detail: {
      issue: issue,
      linkedDocument: linkedDocument,
      latest: latest,
      document: doc,
      model: model,
      viewable: viewable
    }
  }));

  return {
    issue: issue,
    linkedDocument: linkedDocument,
    latest: latest,
    document: doc,
    model: model,
    viewable: viewable
  };
}

function getPrimaryLinkedDocument(issue) {
  var linkedDocuments =
    issue?.linkedDocuments ||
    issue?.attributes?.linkedDocuments ||
    [];

  if (Array.isArray(linkedDocuments) && linkedDocuments.length > 0) {
    return linkedDocuments[0];
  }

  return null;
}

function getLinkedDocumentViewableGuid(linkedDocument) {
  var viewable =
    linkedDocument?.details?.viewable ||
    linkedDocument?.viewable ||
    null;

  return (
    viewable?.guid ||
    viewable?.id ||
    viewable?.viewableId ||
    viewable?.viewableID ||
    null
  );
}

function getLinkedDocumentViewableName(linkedDocument) {
  var viewable =
    linkedDocument?.details?.viewable ||
    linkedDocument?.viewable ||
    null;

  return viewable?.name || viewable?.displayName || null;
}

function getLinkedDocumentViewerState(linkedDocument) {
  var viewerState =
    linkedDocument?.details?.viewerState ||
    linkedDocument?.viewerState ||
    null;

  if (!viewerState) return null;

  if (typeof viewerState === 'string') {
    try {
      return JSON.parse(viewerState);
    } catch {
      return null;
    }
  }

  return viewerState;
}

async function resolveLatestVersionForLineage(projectId, lineageUrn) {
  var accessToken = await getApsTokenPromise();

  var url =
    'https://developer.api.autodesk.com/data/v1/projects/' +
    encodeURIComponent(projectId) +
    '/items/' +
    encodeURIComponent(lineageUrn) +
    '/versions';

  var response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      Accept: 'application/vnd.api+json'
    }
  });

  var body = await response.json().catch(function () {
    return null;
  });

  if (!response.ok) {
    throw new Error(
      body?.errors?.[0]?.detail ||
      body?.errors?.[0]?.title ||
      body?.developerMessage ||
      'Could not get latest version from ACC.'
    );
  }

  var versions = Array.isArray(body?.data) ? body.data : [];

  if (!versions.length) {
    throw new Error('No versions found for linked document.');
  }

  versions.sort(function (a, b) {
    var aVersion = Number(a?.attributes?.versionNumber || 0);
    var bVersion = Number(b?.attributes?.versionNumber || 0);

    if (aVersion !== bVersion) return bVersion - aVersion;

    var aDate = new Date(a?.attributes?.lastModifiedTime || a?.attributes?.createTime || 0).getTime();
    var bDate = new Date(b?.attributes?.lastModifiedTime || b?.attributes?.createTime || 0).getTime();

    return bDate - aDate;
  });

  var latest = versions[0];
  var versionId = latest.id;

  return {
    itemId: lineageUrn,
    versionId: versionId,
    encodedUrn: encodeApsUrn(versionId),
    displayName:
      latest?.attributes?.displayName ||
      latest?.attributes?.name ||
      latest?.attributes?.fileName ||
      null,
    versionNumber: latest?.attributes?.versionNumber || null,
    raw: latest
  };
}

function encodeApsUrn(value) {
  var stringValue = String(value || '');
  var utf8 = unescape(encodeURIComponent(stringValue));
  return btoa(utf8).replace(/=/g, '');
}

function loadApsDocumentAsync(documentId) {
  return new Promise(function (resolve, reject) {
    Autodesk.Viewing.Document.load(
      documentId,
      function (doc) {
        resolve(doc);
      },
      function (errorCode, errorMessage) {
        reject(new Error(errorMessage || 'Could not load APS document. Viewer error: ' + errorCode));
      }
    );
  });
}

function findViewableInDocument(doc, viewableGuid, viewableName) {
  if (!doc || !doc.getRoot) return null;

  var root = doc.getRoot();
  var geometryNodes = [];

  try {
    geometryNodes = root.search({ type: 'geometry' }) || [];
  } catch {
    geometryNodes = [];
  }

  if (!geometryNodes.length && root.getDefaultGeometry) {
    var defaultGeometry = root.getDefaultGeometry();
    if (defaultGeometry) geometryNodes.push(defaultGeometry);
  }

  var wantedGuid = normaliseForCompare(viewableGuid);
  var wantedName = normaliseForCompare(viewableName);

  if (wantedGuid) {
    var byGuid = geometryNodes.find(function (node) {
      var data = node?.data || {};

      return [
        data.guid,
        data.viewableID,
        data.viewableId,
        data.id
      ].some(function (value) {
        return normaliseForCompare(value) === wantedGuid;
      });
    });

    if (byGuid) return byGuid;
  }

  if (wantedName) {
    var byName = geometryNodes.find(function (node) {
      var data = node?.data || {};

      return [
        data.name,
        data.displayName,
        data.label
      ].some(function (value) {
        return normaliseForCompare(value) === wantedName;
      });
    });

    if (byName) return byName;
  }

  return null;
}

function restoreIssueViewerState(viewerState) {
  if (!viewer || !viewerState) return false;

  try {
    var viewport =
      viewerState?.viewport ||
      viewerState?.state?.viewport ||
      null;

    if (viewport && viewer.navigation) {
      restoreViewportCamera(viewport);
    }

    // Important: do not call viewer.restoreState(viewerState) here.
    // ACC issue viewerState can contain renderOptions, objectSet, hidden/isolated
    // elements, selection and appearance settings. Restoring those changes the
    // user's current display style and can turn the model grey/black. For this
    // workflow we only restore the saved camera/viewport.
    if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
      viewer.impl.invalidate(true, true, true);
    }

    return true;
  } catch (error) {
    console.warn('[Issue Navigator] Could not restore issue viewport:', error);
    return false;
  }
}

function restoreViewportCamera(viewport) {
  if (!viewport || !viewer || !viewer.navigation) return false;

  var nav = viewer.navigation;

  var eye = vectorFromAnyForViewer(viewport.eye || viewport.position || viewport.camera?.position);

  // ACC issue target can be far from the actual pushpin.
  // Use pivotPoint first.
  var target = vectorFromAnyForViewer(viewport.pivotPoint || viewport.target || viewport.center);

  var up = vectorFromAnyForViewer(viewport.up || viewport.worldUpVector || viewport.camera?.up);

  if (viewport.projection) {
    var projection = String(viewport.projection).toLowerCase();

    if (projection.includes('perspective') && typeof nav.toPerspective === 'function') {
      nav.toPerspective();
    }

    if (projection.includes('orthographic') && typeof nav.toOrthographic === 'function') {
      nav.toOrthographic();
    }
  }

  if (eye && target && typeof nav.setView === 'function') {
    nav.setView(eye, target);
  } else {
    if (eye && typeof nav.setPosition === 'function') {
      nav.setPosition(eye);
    }

    if (target && typeof nav.setTarget === 'function') {
      nav.setTarget(target);
    }
  }

  if (target && typeof nav.setPivotPoint === 'function') {
    nav.setPivotPoint(target);
  }

  if (up && typeof nav.setCameraUpVector === 'function') {
    nav.setCameraUpVector(up);
  }

  if (viewport.fieldOfView && typeof nav.setVerticalFov === 'function') {
    nav.setVerticalFov(Number(viewport.fieldOfView), true);
  }

  return true;
}

function vectorFromAnyForViewer(value) {
  if (!value) return null;

  if (value.isVector3 && typeof value.clone === 'function') {
    return value.clone();
  }

  if (Array.isArray(value) && value.length >= 3) {
    return new THREE.Vector3(
      Number(value[0]),
      Number(value[1]),
      Number(value[2])
    );
  }

  if (typeof value === 'object') {
    var x = value.x ?? value.X ?? value[0];
    var y = value.y ?? value.Y ?? value[1];
    var z = value.z ?? value.Z ?? value[2];

    if (x !== undefined && y !== undefined && z !== undefined) {
      return new THREE.Vector3(Number(x), Number(y), Number(z));
    }
  }

  return null;
}

function waitForViewerReadyAfterLoad() {
  return new Promise(function (resolve) {
    window.setTimeout(resolve, 500);
  });
}

function getApsTokenPromise() {
  return new Promise(function (resolve, reject) {
    try {
      getApsToken(function (accessToken) {
        if (!accessToken) {
          reject(new Error('Could not get APS access token.'));
          return;
        }

        resolve(accessToken);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function normaliseForCompare(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[{}]/g, '');
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
            window.accIssuePinsRedraw('loadDocumentNode-450');
          }, 450);

          window.setTimeout(function () {
            window.accIssuePinsRedraw('loadDocumentNode-1000');
          }, 1000);

          window.setTimeout(function () {
            window.accIssuePinsRedraw('loadDocumentNode-1800');
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
        window.accIssuePinsRedraw('late-viewer-event');
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
        window.accIssuePinsRedraw(reason + '-' + delay);
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
// Issue navigator field helpers
/////////////////////////////////////////////////////////////////////

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getIssueIdForNavigator(issue) {
  return issue?.id || issue?.issueId || issue?.attributes?.id || null;
}

function getIssueDisplayIdForNavigator(issue) {
  return issue?.displayId || issue?.attributes?.displayId || issue?.issueId || '-';
}

function getIssueTitleForNavigator(issue) {
  return issue?.title || issue?.attributes?.title || issue?.description || issue?.attributes?.description || 'Untitled issue';
}

function getIssueStatusForNavigator(issue) {
  return issue?.status || issue?.attributes?.status || 'Unknown';
}

function getIssueTypeForNavigator(issue) {
  var typeName =
    issue?.issueTypeName ||
    issue?.issueType?.title ||
    issue?.issueType?.name ||
    issue?.attributes?.issueTypeName ||
    issue?.attributes?.issueType ||
    issue?.type ||
    '';

  var subtypeName =
    issue?.issueSubtypeName ||
    issue?.issueSubtype?.title ||
    issue?.issueSubtype?.name ||
    issue?.attributes?.issueSubtypeName ||
    issue?.attributes?.issueSubtype ||
    issue?.subtype ||
    '';

  if (typeName && subtypeName) return typeName + ' / ' + subtypeName;
  return typeName || subtypeName || 'Not specified';
}

function getIssueAssignedToForNavigator(issue) {
  var assignedTo =
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

function getIssueLocationForNavigator(issue) {
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

function getIssueViewNameForNavigator(issue) {
  var linkedDocument = getPrimaryLinkedDocument(issue);

  if (!linkedDocument) return '-';

  var viewable =
    linkedDocument?.details?.viewable ||
    linkedDocument?.viewable ||
    null;

  return (
    viewable?.name ||
    viewable?.displayName ||
    linkedDocument?.name ||
    linkedDocument?.displayName ||
    '-'
  );
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
      viewableId: null,
      name: null,
      role: null,
      type: null
    };
  }

  var data = node.data || {};

  return {
    guid: data.guid || data.viewableID || data.viewableId || data.id || null,
    viewableId: data.viewableID || data.viewableId || data.guid || data.id || null,
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