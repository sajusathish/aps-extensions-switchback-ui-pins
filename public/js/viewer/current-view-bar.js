// Shows floating view labels over the Autodesk Viewer.
// Keep this file focused on view names only; issue table UI belongs in Layout.js.
// It listens to viewer events and does not control issue table or ACC API logic.
(function () {
  var selectedIssue = null;
  var selectedIssueViewName = '';

  function isWeakViewName(value) {
    var name = String(value || '').trim();
    return !name || /^\(?\d+\)?$/.test(name) || /^unknown\b/i.test(name);
  }

  function formatWeakViewName(viewName, fileName) {
    var pageNumber = String(viewName || '').replace(/[()]/g, '').trim();

    if (fileName && pageNumber) return fileName + ' - page ' + pageNumber;
    if (fileName) return fileName;

    return '';
  }

  function getCurrentViewName(modelInfo) {
    var info = modelInfo || window.currentModelInfo || {};
    var activeView = info.activeView || window.currentModelInfo?.activeView || {};
    var linkedViewName =
      info.issueOpenedFromLinkedDocument?.viewableName ||
      window.currentModelInfo?.issueOpenedFromLinkedDocument?.viewableName ||
      '';
    var fileName = info.name || window.currentModelInfo?.name || '';
    var activeViewName = activeView.displayName || activeView.name || '';

    if (!isWeakViewName(activeViewName)) return activeViewName;
    if (!isWeakViewName(linkedViewName)) return linkedViewName;

    return formatWeakViewName(activeViewName || linkedViewName, fileName);
  }

  function getViewableName(viewable, fileName) {
    if (!viewable) return '';

    var viewName =
      viewable.displayName ||
      viewable.name ||
      viewable.viewName ||
      viewable.label ||
      viewable.data?.displayName ||
      viewable.data?.name ||
      viewable.data?.label ||
      '';

    if (!isWeakViewName(viewName)) return viewName;

    return formatWeakViewName(viewName, fileName);
  }

  function getIssueDocumentName(documentInfo) {
    if (!documentInfo) return '';

    return (
      documentInfo.name ||
      documentInfo.displayName ||
      documentInfo.fileName ||
      documentInfo.title ||
      documentInfo.documentName ||
      documentInfo.itemName ||
      documentInfo.versionName ||
      documentInfo.details?.name ||
      documentInfo.details?.displayName ||
      documentInfo.details?.fileName ||
      documentInfo.details?.title ||
      documentInfo.details?.documentName ||
      documentInfo.details?.itemName ||
      documentInfo.details?.versionName ||
      documentInfo.attributes?.displayName ||
      documentInfo.attributes?.name ||
      documentInfo.attributes?.fileName ||
      documentInfo.attributes?.title ||
      documentInfo.item?.attributes?.displayName ||
      documentInfo.item?.attributes?.name ||
      documentInfo.item?.attributes?.fileName ||
      documentInfo.version?.attributes?.displayName ||
      documentInfo.version?.attributes?.name ||
      documentInfo.version?.attributes?.fileName ||
      documentInfo.raw?.attributes?.displayName ||
      documentInfo.raw?.attributes?.name ||
      documentInfo.raw?.attributes?.fileName ||
      ''
    );
  }

  function getIssueKnownDocumentName(issue) {
    if (!issue) return '';

    return (
      issue.documentName ||
      issue.fileName ||
      issue.versionName ||
      issue.linkedDocumentName ||
      issue.attributes?.documentName ||
      issue.attributes?.fileName ||
      issue.attributes?.versionName ||
      issue.attributes?.linkedDocumentName ||
      ''
    );
  }

  function getIssueId(issue) {
    return String(
      issue?.id ||
      issue?.issueId ||
      issue?.attributes?.id ||
      issue?.attributes?.issueId ||
      ''
    );
  }

  function getCurrentModelViewName() {
    return getCurrentViewName(window.currentModelInfo || {});
  }

  function getIssueLinkedDocument(issue) {
    var linkedDocuments =
      issue?.linkedDocuments ||
      issue?.attributes?.linkedDocuments ||
      [];

    if (Array.isArray(linkedDocuments) && linkedDocuments.length > 0) {
      return linkedDocuments[0];
    }

    return null;
  }

  function getIssuePlacement(issue) {
    var placements =
      issue?.placements ||
      issue?.attributes?.placements ||
      [];

    if (Array.isArray(placements) && placements.length > 0) {
      return placements[0];
    }

    return issue?.placement || issue?.attributes?.placement || null;
  }

  function getIssueViewName(issue, weakViewFallbackName) {
    if (!issue) return '';

    var linkedDocument = getIssueLinkedDocument(issue);
    var linkedViewable =
      linkedDocument?.details?.viewable ||
      linkedDocument?.viewable ||
      null;
    var linkedFileName = getIssueDocumentName(linkedDocument) || getIssueKnownDocumentName(issue);
    var linkedViewName = getViewableName(linkedViewable, linkedFileName) || linkedFileName;

    if (!linkedViewName && linkedViewable && isWeakViewName(linkedViewable.name || linkedViewable.displayName)) {
      linkedViewName = weakViewFallbackName || '';
    }

    if (linkedViewName) return linkedViewName;

    var placement = getIssuePlacement(issue);
    var placementViewable =
      placement?.details?.viewable ||
      placement?.viewable ||
      null;
    var placementFileName = getIssueDocumentName(placement) || getIssueKnownDocumentName(issue);
    var placementViewName = getViewableName(placementViewable, placementFileName) || placementFileName;

    if (!placementViewName && placementViewable && isWeakViewName(placementViewable.name || placementViewable.displayName)) {
      placementViewName = weakViewFallbackName || '';
    }

    if (placementViewName) return placementViewName;

    return '';
  }

  function updateCurrentViewBar(modelInfo) {
    var viewBar = document.getElementById('currentViewBar');
    if (!viewBar) return;

    var viewName = getCurrentViewName(modelInfo || {});

    if (!viewName) {
      viewBar.hidden = true;
      viewBar.textContent = '';
      return;
    }

    viewBar.textContent = 'Current view: ' + viewName;
    viewBar.title = viewName;
    viewBar.hidden = false;
  }

  function updateIssueViewBar(issue) {
    var viewBar = document.getElementById('issueViewBar');
    if (!viewBar) return;

    var viewName = getIssueViewName(issue || selectedIssue, selectedIssueViewName);

    if (!viewName) {
      viewBar.hidden = true;
      viewBar.textContent = '';
      return;
    }

    viewBar.textContent = 'Issue view: ' + viewName;
    viewBar.title = 'View where the selected issue was created: ' + viewName;
    viewBar.hidden = false;
  }

  async function resolveIssueViewNameFromLinkedDocument(issue) {
    if (!issue || typeof window.getIssueLinkedViewDisplayName !== 'function') return;

    var issueId = getIssueId(issue);
    var resolvedName = await window.getIssueLinkedViewDisplayName(issue);

    if (getIssueId(selectedIssue) !== issueId || isWeakViewName(resolvedName)) {
      return;
    }

    selectedIssueViewName = resolvedName;
    updateIssueViewBar(selectedIssue);
  }

  document.addEventListener('viewerinstance', function (event) {
    updateCurrentViewBar(event.detail?.modelInfo || {});
    updateIssueViewBar(selectedIssue);
  });

  document.addEventListener('viewerdocumentviewchanged', function (event) {
    updateCurrentViewBar(event.detail?.modelInfo || {});
    updateIssueViewBar(selectedIssue);
  });

  document.addEventListener('accissueselected', function (event) {
    var previousIssueId = getIssueId(selectedIssue);
    selectedIssue = event.detail?.issue || null;
    var keepExistingName = previousIssueId && previousIssueId === getIssueId(selectedIssue);
    selectedIssueViewName = getIssueViewName(selectedIssue, keepExistingName ? selectedIssueViewName : '');
    updateIssueViewBar(selectedIssue);
    resolveIssueViewNameFromLinkedDocument(selectedIssue).catch(function (error) {
      console.warn('[Current View Bar] Could not resolve issue view name:', error);
    });
  });

  document.addEventListener('issueviewableloaded', function (event) {
    var issue = event.detail?.issue || selectedIssue;
    var viewable = event.detail?.viewable || null;
    var latest = event.detail?.latest || null;
    var viewName =
      viewable?.data?.displayName ||
      viewable?.data?.name ||
      latest?.displayName ||
      '';

    if (!isWeakViewName(viewName)) {
      selectedIssue = issue;
      selectedIssueViewName = viewName;
      updateIssueViewBar(selectedIssue);
    }
  });

  document.addEventListener('accissuesloaded', function (event) {
    var selectedIssueId = getIssueId(selectedIssue);
    var issues = event.detail?.issues || [];

    if (selectedIssueId && Array.isArray(issues)) {
      var refreshedIssue = issues.find(function (issue) {
        return getIssueId(issue) === selectedIssueId;
      });

      if (refreshedIssue) {
        selectedIssue = refreshedIssue;
        selectedIssueViewName = getIssueViewName(refreshedIssue, selectedIssueViewName);
      }
    }

    updateIssueViewBar(selectedIssue);
  });

  window.CurrentViewBar = {
    update: updateCurrentViewBar,
    updateIssueView: updateIssueViewBar
  };
})();
