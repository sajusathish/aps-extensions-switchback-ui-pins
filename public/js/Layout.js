// Coordinates the right-side issue UI: filters, issue table, issue details, and panel buttons.
// Do not put Autodesk Viewer loading code here; use ApsViewer.js for viewer behavior.
(function () {
  var currentIssueDetail = null;
  var loadedIssues = [];
  var selectedIssueTableId = null;
  var issueSettingsCache = null;
  var issueSettingsCacheKey = '';
  var activeIssueEditField = null;
  var currentIssueTab = 'details';
  var currentIssueComments = [];
  var currentIssueFilters = {
    category: '',
    type: '',
    statuses: ['draft', 'open', 'pending', 'in review', 'closed'],
    assignedTo: ''
  };
  var issueTableBaseColumns = [
    { key: 'displayId', label: 'ID', type: 'text', placeholder: 'Issue ID contains' },
    { key: 'title', label: 'Title', type: 'text', placeholder: 'Title contains' },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'assignedTo', label: 'Assigned to', type: 'values', searchable: true },
    { key: 'dueDate', label: 'Due date', type: 'date' },
    { key: 'createdBy', label: 'Created by', type: 'values', searchable: true }
  ];
  var issueTableCustomColumnIds = [];
  var issueTableColumnWidths = {};
  var issueTableColumnOrder = [];
  var issueTableColumnOrderKey = '';
  var issueTablePopoutWindow = null;
  var issueTableState = {
    sortKey: '',
    sortDirection: 'asc',
    filters: {},
    textFilters: {},
    dateFilters: {},
    numberFilters: {},
    openColumnKey: '',
    searchText: '',
    customColumnMenuOpen: false,
    resizingColumn: null,
    draggingColumn: null
  };
  var escapeHtml = window.HtmlUtils.escapeHtml;
  var escapeAttribute = window.HtmlUtils.escapeAttribute;
  var setElementText = window.HtmlUtils.setElementText;
  var isRawAutodeskId = window.TextUtils.isRawAutodeskId;
  var text = window.TextUtils.text;
  var getDisplayName = window.TextUtils.getDisplayName;
  var normalise = window.TextUtils.normalise;
  var uniqueValues = window.TextUtils.uniqueValues;
  var getInitials = window.TextUtils.getInitials;
  var stripProjectPrefix = window.TextUtils.stripProjectPrefix;
  var cleanRoleName = window.TextUtils.cleanRoleName;
  var cleanAssigneeName = window.TextUtils.cleanAssigneeName;
  var formatDate = window.DateUtils.formatDate;
  var formatIssueDate = window.DateUtils.formatIssueDate;
  var toDateInputValue = window.DateUtils.toDateInputValue;
  var formatRelativeTime = window.DateUtils.formatRelativeTime;

  function setStatus(text) {
    var status = document.getElementById('viewerActionStatus');
    if (status) status.textContent = text;
  }

  function isPlaceholderName(value) {
    var clean = normalise(value);

    return !clean ||
      clean === '-' ||
      clean === 'user' ||
      clean === 'unknown' ||
      clean === 'unknown user' ||
      clean === 'unresolved user' ||
      isRawAutodeskId(String(value || ''));
  }

  function getIssueId(issue, summary) {
    return (
      summary?.id ||
      issue?.id ||
      issue?.issueId ||
      issue?.attributes?.id ||
      null
    );
  }

  function getIssueDisplayId(issue, summary) {
    return (
      summary?.displayId ||
      issue?.displayId ||
      issue?.attributes?.displayId ||
      issue?.issueId ||
      '-'
    );
  }

  function getIssueTitle(issue, summary) {
    return (
      summary?.title ||
      issue?.title ||
      issue?.attributes?.title ||
      issue?.description ||
      issue?.attributes?.description ||
      'Untitled issue'
    );
  }

  function getIssueStatus(issue, summary) {
    return (
      summary?.status ||
      issue?.status ||
      issue?.attributes?.status ||
      'Unknown'
    );
  }

  function getIssueCategory(issue) {
    return (
      issue?.category ||
      issue?.categoryName ||
      issue?.issueCategory ||
      issue?.attributes?.category ||
      issue?.attributes?.categoryName ||
      issue?.issueType?.category ||
      issue?.issueType?.categoryName ||
      ''
    );
  }

  function getIssueType(issue, summary) {
    if (summary?.type) return summary.type;

    var typeName =
      issue?.issueType?.title ||
      issue?.issueType?.name ||
      issue?.issueTypeName ||
      issue?.attributes?.issueType ||
      issue?.type ||
      null;

    var subtypeName =
      issue?.issueSubtype?.title ||
      issue?.issueSubtype?.name ||
      issue?.issueSubtypeName ||
      issue?.attributes?.issueSubtype ||
      issue?.subtype ||
      null;

    if (typeName && subtypeName) {
      return getDisplayName(typeName, 'Type') + ' / ' + getDisplayName(subtypeName, 'Subtype');
    }

    return getDisplayName(typeName || subtypeName, 'Not specified');
  }

  function getIssueDescription(issue, summary) {
    return (
      summary?.description ||
      issue?.description ||
      issue?.attributes?.description ||
      issue?.details?.description ||
      'No description available.'
    );
  }

  function getAssignedToType(issue) {
    return (
      issue?.assignedToType ||
      issue?.attributes?.assignedToType ||
      issue?.assigneeType ||
      ''
    );
  }

  function getAssignedTo(issue, summary) {
    var assignedType = String(getAssignedToType(issue) || '').toLowerCase();

    var assignedValue =
      summary?.assignedTo ||
      issue?.assignedToDisplayName ||
      issue?.assignedToName ||
      issue?.assigneeDisplayName ||
      issue?.assigneeName ||
      issue?.assignedTo ||
      issue?.attributes?.assignedToDisplayName ||
      issue?.attributes?.assignedToName ||
      issue?.attributes?.assignedTo ||
      issue?.assignee ||
      null;

    if (!assignedValue) return 'Unassigned';

    var fallback = 'Assigned';

    if (assignedType.includes('user')) fallback = 'Unresolved user';
    if (assignedType.includes('company')) fallback = 'Unresolved company';
    if (assignedType.includes('role')) fallback = 'Unresolved role';

    return cleanAssigneeName(getDisplayName(assignedValue, fallback), assignedType);
  }

  function getAssigneeOptionName(assignee) {
    return cleanAssigneeName(assignee?.name || assignee?.label || assignee?.id || '', assignee?.type);
  }

  function getIssueSnapshotUrn(issue) {
    return (
      issue?.snapshotUrn ||
      issue?.attributes?.snapshotUrn ||
      issue?.snapshot?.urn ||
      issue?.attributes?.snapshot?.urn ||
      ''
    );
  }

  function getIssueSnapshotDataUrl(issue) {
    var snapshot = String(getIssueSnapshotUrn(issue) || '').trim();

    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(snapshot)) {
      return snapshot;
    }

    if (!snapshot || snapshot.startsWith('urn:') || snapshot.startsWith('http')) {
      return '';
    }

    var clean = snapshot.replace(/\s/g, '');
    var imageType = '';

    if (clean.startsWith('/9j/')) imageType = 'jpeg';
    if (clean.startsWith('iVBOR')) imageType = 'png';
    if (clean.startsWith('R0lGOD')) imageType = 'gif';
    if (clean.startsWith('UklGR')) imageType = 'webp';

    if (!imageType || !/^[A-Za-z0-9+/=_-]{80,}$/.test(clean)) {
      return '';
    }

    return 'data:image/' + imageType + ';base64,' + clean.replace(/-/g, '+').replace(/_/g, '/');
  }

  function getOpenedBy(issue) {
    var value =
      issue?.openedByDisplayName ||
      issue?.openedByName ||
      issue?.createdByDisplayName ||
      issue?.createdByName ||
      issue?.openedBy ||
      issue?.createdBy ||
      issue?.attributes?.openedBy ||
      issue?.attributes?.createdBy ||
      null;

    return getDisplayName(value, 'Unresolved user');
  }

  function getUpdatedBy(issue) {
    var value =
      issue?.updatedByDisplayName ||
      issue?.updatedByName ||
      issue?.updatedBy ||
      issue?.attributes?.updatedBy ||
      null;

    return getDisplayName(value, 'Unresolved user');
  }

  function getDueDate(issue) {
    return issue?.dueDate || issue?.attributes?.dueDate || issue?.details?.dueDate || '';
  }

  function getStartDate(issue) {
    return issue?.startDate || issue?.attributes?.startDate || issue?.details?.startDate || '';
  }

  function getCreatedAt(issue) {
    return issue?.createdAt || issue?.openedAt || issue?.attributes?.createdAt || issue?.attributes?.openedAt || '';
  }

  function getUpdatedAt(issue) {
    return issue?.updatedAt || issue?.attributes?.updatedAt || '';
  }

  function getRootCause(issue) {
    var value =
      issue?.rootCause?.name ||
      issue?.rootCause?.title ||
      issue?.rootCauseName ||
      issue?.attributes?.rootCauseName ||
      issue?.rootCause ||
      issue?.rootCauseId ||
      '';

    return getDisplayName(value, '-');
  }

  function statusClass(status) {
    var value = String(status || '').toLowerCase();

    if (value.includes('closed')) return 'closed';
    if (value.includes('pending')) return 'pending';
    if (value.includes('review')) return 'in-review';
    if (value.includes('answered')) return 'answered';
    if (value.includes('void')) return 'void';
    if (value.includes('draft')) return 'draft';

    return 'open';
  }

  function getIssueTableColumn(key) {
    return getIssueTableColumns().find(function (column) {
      return column.key === key;
    }) || null;
  }

  function getIssueTableColumns() {
    var customColumns = getSelectedCustomAttributeDefinitions().map(function (definition) {
      return {
        key: getCustomAttributeColumnKey(definition.id),
        label: definition.title,
        type: getCustomAttributeTableType(definition),
        searchable: true,
        customAttributeId: definition.id,
        placeholder: definition.title + ' contains'
      };
    });

    return applyIssueTableColumnOrder(issueTableBaseColumns.concat(customColumns));
  }

  function getIssueTableColumnOrderStorageKey() {
    return 'acc-issue-table-column-order:' + (getCurrentProjectId() || 'default');
  }

  function ensureIssueTableColumnOrderLoaded() {
    var key = getIssueTableColumnOrderStorageKey();
    if (issueTableColumnOrderKey === key) return;

    issueTableColumnOrderKey = key;

    try {
      var storedOrder = JSON.parse(localStorage.getItem(key) || '[]');
      issueTableColumnOrder = Array.isArray(storedOrder)
        ? storedOrder.map(String)
        : [];
    } catch (error) {
      issueTableColumnOrder = [];
    }
  }

  function saveIssueTableColumnOrder() {
    ensureIssueTableColumnOrderLoaded();
    localStorage.setItem(issueTableColumnOrderKey, JSON.stringify(issueTableColumnOrder));
  }

  function applyIssueTableColumnOrder(columns) {
    ensureIssueTableColumnOrderLoaded();

    if (!issueTableColumnOrder.length) return columns;

    var columnsByKey = {};
    var orderedColumns = [];

    columns.forEach(function (column) {
      columnsByKey[column.key] = column;
    });

    issueTableColumnOrder.forEach(function (columnKey) {
      if (!columnsByKey[columnKey]) return;

      orderedColumns.push(columnsByKey[columnKey]);
      delete columnsByKey[columnKey];
    });

    columns.forEach(function (column) {
      if (columnsByKey[column.key]) orderedColumns.push(column);
    });

    return orderedColumns;
  }

  function moveIssueTableColumn(draggedColumnKey, targetColumnKey, placeAfterTarget) {
    if (!draggedColumnKey || !targetColumnKey || draggedColumnKey === targetColumnKey) return false;

    var columnKeys = getIssueTableColumns().map(function (column) {
      return column.key;
    });
    var draggedIndex = columnKeys.indexOf(draggedColumnKey);
    var targetIndex = columnKeys.indexOf(targetColumnKey);

    if (draggedIndex === -1 || targetIndex === -1) return false;

    columnKeys.splice(draggedIndex, 1);
    targetIndex = columnKeys.indexOf(targetColumnKey);
    columnKeys.splice(placeAfterTarget ? targetIndex + 1 : targetIndex, 0, draggedColumnKey);

    issueTableColumnOrder = columnKeys;
    saveIssueTableColumnOrder();

    return true;
  }

  function getIssueTableColumnWidthKey(columnKey) {
    return 'acc-issue-table-column-width:' + (getCurrentProjectId() || 'default') + ':' + columnKey;
  }

  function getIssueTableColumnWidth(columnKey) {
    if (issueTableColumnWidths[columnKey]) {
      return issueTableColumnWidths[columnKey];
    }

    var storedWidth = Number(localStorage.getItem(getIssueTableColumnWidthKey(columnKey)) || 0);
    if (Number.isFinite(storedWidth) && storedWidth > 0) {
      issueTableColumnWidths[columnKey] = storedWidth;
      return storedWidth;
    }

    return null;
  }

  function getPreferredIssueTableColumnWidth(column) {
    if (!column) return 140;
    if (column.key === 'displayId') return 78;
    if (column.key === 'title') return 290;
    if (column.key === 'status') return 96;
    if (column.key === 'assignedTo') return 190;
    if (column.key === 'dueDate') return 126;
    if (column.key === 'createdBy') return 170;
    if (column.type === 'date') return 126;
    if (column.type === 'number') return 120;
    return 165;
  }

  function getMinimumIssueTableColumnWidth(column) {
    if (!column) return 96;
    if (column.key === 'displayId') return 72;
    if (column.key === 'title') return 210;
    if (column.key === 'status') return 86;
    if (column.key === 'assignedTo') return 145;
    if (column.key === 'dueDate') return 112;
    if (column.key === 'createdBy') return 135;
    if (column.type === 'date') return 112;
    if (column.type === 'number') return 96;
    return 125;
  }

  function getIssueTableRenderColumnWidths(columns, targetDocument) {
    var widths = {};

    if (!isIssueTablePopoutDocument(targetDocument)) {
      columns.forEach(function (column) {
        widths[column.key] = getIssueTableColumnWidth(column.key);
      });
      return widths;
    }

    var wrapper = targetDocument.querySelector('.issueTableWrapper');
    var availableWidth = Math.max(720, (wrapper?.clientWidth || targetDocument.defaultView?.innerWidth || 980) - 2);
    var preferredWidths = {};
    var minimumWidths = {};
    var preferredTotal = 0;
    var minimumTotal = 0;

    columns.forEach(function (column) {
      var preferred = getIssueTableColumnWidth(column.key) || getPreferredIssueTableColumnWidth(column);
      var minimum = Math.min(preferred, getMinimumIssueTableColumnWidth(column));

      preferredWidths[column.key] = preferred;
      minimumWidths[column.key] = minimum;
      preferredTotal += preferred;
      minimumTotal += minimum;
    });

    if (preferredTotal <= availableWidth) {
      return preferredWidths;
    }

    if (minimumTotal >= availableWidth) {
      return minimumWidths;
    }

    var shrinkableTotal = preferredTotal - minimumTotal;
    var shrinkAmount = preferredTotal - availableWidth;

    columns.forEach(function (column) {
      var preferred = preferredWidths[column.key];
      var minimum = minimumWidths[column.key];
      var columnShrink = shrinkableTotal > 0
        ? ((preferred - minimum) / shrinkableTotal) * shrinkAmount
        : 0;

      widths[column.key] = Math.round(preferred - columnShrink);
    });

    return widths;
  }

  function isIssueTablePopoutDocument(targetDocument) {
    return Boolean(targetDocument?.body?.classList?.contains('issueTablePopoutBody'));
  }

  function setIssueTableRenderedWidth(targetDocument, widths) {
    if (!targetDocument) return;

    var table = targetDocument.querySelector('.issueTable');
    if (!table) return;

    var totalWidth = Object.keys(widths).reduce(function (sum, key) {
      return sum + (Number(widths[key]) || 0);
    }, 0);

    if (isIssueTablePopoutDocument(targetDocument)) {
      table.style.width = totalWidth + 'px';
      table.style.minWidth = '100%';
    } else {
      table.style.width = '';
      table.style.minWidth = '';
    }
  }

  function setIssueTableColumnWidth(columnKey, width) {
    var cleanWidth = Math.max(56, Math.round(Number(width) || 0));

    issueTableColumnWidths[columnKey] = cleanWidth;
    localStorage.setItem(getIssueTableColumnWidthKey(columnKey), String(cleanWidth));
  }

  function clearIssueTableColumnWidths() {
    issueTableColumnWidths = {};
  }

  function refreshIssuesFromAcc() {
    setStatus('Refreshing issues from ACC/Forma...');

    if (typeof window.accIssuePinsReload === 'function') {
      var result = window.accIssuePinsReload({ refreshIssueSettings: true });

      if (result && typeof result.then === 'function') {
        result.then(function () {
          setStatus('Issues refreshed from ACC/Forma.');
        }).catch(function (error) {
          setStatus('Issue refresh failed: ' + error.message);
        });
      }

      return;
    }

    setStatus('Load a model first. Issue refresh is not ready yet.');
  }

  function getCustomAttributeColumnKey(attributeDefinitionId) {
    return 'customAttribute:' + String(attributeDefinitionId || '');
  }

  function getCustomAttributeIdFromColumnKey(key) {
    return String(key || '').startsWith('customAttribute:')
      ? String(key).substring('customAttribute:'.length)
      : '';
  }

  function getSelectedCustomAttributeDefinitions() {
    var definitions = issueSettingsCache?.customAttributeDefinitions || [];

    return issueTableCustomColumnIds.map(function (definitionId) {
      return getCustomAttributeDefinition(issueSettingsCache, definitionId);
    }).filter(function (definition) {
      return definition && definitions.some(function (item) {
        return String(item.id) === String(definition.id);
      });
    });
  }

  function getIssueTableCustomColumnsStorageKey() {
    return 'acc-issue-table-custom-columns:' + (getCurrentProjectId() || 'default');
  }

  function loadIssueTableCustomColumnIds() {
    try {
      var raw = localStorage.getItem(getIssueTableCustomColumnsStorageKey());
      var ids = JSON.parse(raw || '[]');

      issueTableCustomColumnIds = Array.isArray(ids)
        ? ids.map(String)
        : [];
    } catch (error) {
      issueTableCustomColumnIds = [];
    }
  }

  function saveIssueTableCustomColumnIds() {
    localStorage.setItem(
      getIssueTableCustomColumnsStorageKey(),
      JSON.stringify(issueTableCustomColumnIds)
    );
  }

  function setIssueTableCustomColumn(attributeDefinitionId, visible) {
    var id = String(attributeDefinitionId || '');
    if (!id) return;

    if (visible && issueTableCustomColumnIds.indexOf(id) === -1) {
      issueTableCustomColumnIds.push(id);
    }

    if (!visible) {
      issueTableCustomColumnIds = issueTableCustomColumnIds.filter(function (item) {
        return item !== id;
      });

      var key = getCustomAttributeColumnKey(id);
      delete issueTableState.filters[key];
      delete issueTableState.textFilters[key];
      delete issueTableState.dateFilters[key];
      delete issueTableState.numberFilters[key];

      if (issueTableState.sortKey === key) {
        issueTableState.sortKey = '';
        issueTableState.sortDirection = 'asc';
      }
    }

    saveIssueTableCustomColumnIds();
  }

  function getCustomAttributeTableType(definition) {
    var type = normalise(definition?.type || '');

    if (type.includes('number') || type.includes('numeric') || type.includes('integer')) return 'number';
    if (type.includes('drop') || type.includes('list') || type.includes('select')) return 'values';

    return 'text';
  }

  function getIssueTableValue(issue, key) {
    var customAttributeId = getCustomAttributeIdFromColumnKey(key);
    if (customAttributeId) {
      return getIssueCustomAttributeTableValue(issue, customAttributeId);
    }

    if (key === 'displayId') return text(getIssueDisplayId(issue, {}), '-');
    if (key === 'title') return text(getIssueTitle(issue, {}), '-');
    if (key === 'status') return formatStatusLabel(getIssueStatus(issue, {}));
    if (key === 'assignedTo') return getAssignedTo(issue, {});
    if (key === 'dueDate') return formatDate(getDueDate(issue));
    if (key === 'createdBy') return getOpenedBy(issue);

    return '-';
  }

  function getIssueCustomAttributeTableValue(issue, attributeDefinitionId) {
    var attribute = getIssueCustomAttribute(issue, attributeDefinitionId);
    var definition = getCustomAttributeDefinition(issueSettingsCache, attributeDefinitionId);

    if (!attribute) return '-';

    return getCustomAttributeDisplayValue(attribute, issueSettingsCache, definition);
  }

  function getIssueTableOptionLabel(value) {
    var label = String(value || '').trim();
    return label && label !== '-' ? label : '(Blank)';
  }

  function getIssueTableOptionKey(value) {
    return normalise(getIssueTableOptionLabel(value)) || '(blank)';
  }

  function getIssueTableColumnOptions(issues, key) {
    var optionsByKey = {};

    (issues || []).forEach(function (issue) {
      var label = getIssueTableOptionLabel(getIssueTableValue(issue, key));
      optionsByKey[getIssueTableOptionKey(label)] = label;
    });

    return Object.keys(optionsByKey).map(function (optionKey) {
      return {
        key: optionKey,
        label: optionsByKey[optionKey]
      };
    }).sort(function (a, b) {
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });
  }

  function getIssueTableDateMs(issue, key) {
    var customAttributeId = getCustomAttributeIdFromColumnKey(key);

    if (customAttributeId) {
      var customColumn = getIssueTableColumn(key);
      if (customColumn?.type !== 'date') return null;

      var customAttribute = getIssueCustomAttribute(issue, customAttributeId);
      var customDate = new Date(customAttribute?.value || '');

      return Number.isNaN(customDate.getTime()) ? null : customDate.getTime();
    }

    if (key !== 'dueDate') return null;

    var value = getDueDate(issue);
    var date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  function getIssueTableNumberValue(issue, key) {
    var customAttributeId = getCustomAttributeIdFromColumnKey(key);
    if (!customAttributeId) return null;

    var attribute = getIssueCustomAttribute(issue, customAttributeId);
    var numberValue = Number(attribute?.value);

    return Number.isFinite(numberValue) ? numberValue : null;
  }

  function dateInputToMs(value, endOfDay) {
    if (!value) return null;

    var date = new Date(value + (endOfDay ? 'T23:59:59.999' : 'T00:00:00'));
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  function getIssueTableDateRange(issues, key) {
    var dates = (issues || []).map(function (issue) {
      return getIssueTableDateMs(issue, key);
    }).filter(function (value) {
      return value !== null;
    }).sort(function (a, b) {
      return a - b;
    });

    if (!dates.length) return null;

    return {
      min: formatDateOnly(dates[0]),
      max: formatDateOnly(dates[dates.length - 1])
    };
  }

  function formatDateOnly(value) {
    var date = new Date(value);

    if (Number.isNaN(date.getTime())) return '';

    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');

    return year + '-' + month + '-' + day;
  }

  function hasIssueTableFilter(key) {
    var valueFilter = Array.isArray(issueTableState.filters[key]);
    var textFilter = Boolean(String(issueTableState.textFilters[key] || '').trim());
    var dateFilter = Boolean(issueTableState.dateFilters[key]?.from || issueTableState.dateFilters[key]?.to);
    var numberFilter = Boolean(issueTableState.numberFilters[key]?.from || issueTableState.numberFilters[key]?.to);

    return valueFilter || textFilter || dateFilter || numberFilter || false;
  }

  function issueMatchesTableFilters(issue) {
    var valueFiltersMatch = Object.keys(issueTableState.filters).every(function (key) {
      var selectedValues = issueTableState.filters[key];
      if (!Array.isArray(selectedValues)) return true;

      return selectedValues.indexOf(getIssueTableOptionKey(getIssueTableValue(issue, key))) !== -1;
    });

    var textFiltersMatch = Object.keys(issueTableState.textFilters).every(function (key) {
      var filterValue = normalise(issueTableState.textFilters[key] || '');
      if (!filterValue) return true;

      return normalise(getIssueTableValue(issue, key)).includes(filterValue);
    });

    var dateFiltersMatch = Object.keys(issueTableState.dateFilters).every(function (key) {
      var filter = issueTableState.dateFilters[key] || {};
      var issueDate = getIssueTableDateMs(issue, key);
      var from = dateInputToMs(filter.from, false);
      var to = dateInputToMs(filter.to, true);

      if (from === null && to === null) return true;
      if (issueDate === null) return false;
      if (from !== null && issueDate < from) return false;
      if (to !== null && issueDate > to) return false;

      return true;
    });

    var numberFiltersMatch = Object.keys(issueTableState.numberFilters).every(function (key) {
      var filter = issueTableState.numberFilters[key] || {};
      var issueNumber = getIssueTableNumberValue(issue, key);
      var from = filter.from === '' || filter.from === undefined ? null : Number(filter.from);
      var to = filter.to === '' || filter.to === undefined ? null : Number(filter.to);

      if (from === null && to === null) return true;
      if (issueNumber === null) return false;
      if (Number.isFinite(from) && issueNumber < from) return false;
      if (Number.isFinite(to) && issueNumber > to) return false;

      return true;
    });

    return valueFiltersMatch && textFiltersMatch && dateFiltersMatch && numberFiltersMatch;
  }

  function getIssueTableSortValue(issue, key) {
    var column = getIssueTableColumn(key);

    if (column?.type === 'number') {
      return getIssueTableNumberValue(issue, key) || 0;
    }

    if (key === 'dueDate') {
      return getIssueTableDateMs(issue, key) || 0;
    }

    if (key === 'displayId') {
      var numberValue = Number(String(getIssueTableValue(issue, key)).replace(/[^\d.-]/g, ''));
      if (Number.isFinite(numberValue)) return numberValue;
    }

    return normalise(getIssueTableValue(issue, key));
  }

  function getIssueTableRows(issues) {
    var rows = (issues || []).filter(issueMatchesTableFilters);

    if (!issueTableState.sortKey) return rows;

    var direction = issueTableState.sortDirection === 'desc' ? -1 : 1;
    return rows.slice().sort(function (a, b) {
      var aValue = getIssueTableSortValue(a, issueTableState.sortKey);
      var bValue = getIssueTableSortValue(b, issueTableState.sortKey);

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return (aValue - bValue) * direction;
      }

      return String(aValue).localeCompare(String(bValue), undefined, { numeric: true }) * direction;
    });
  }

  function getIssueViewType(issue) {
    var linkedDocuments = Array.isArray(issue?.linkedDocuments)
      ? issue.linkedDocuments
      : Array.isArray(issue?.attributes?.linkedDocuments)
        ? issue.attributes.linkedDocuments
        : [];
    var placements = Array.isArray(issue?.placements)
      ? issue.placements
      : Array.isArray(issue?.attributes?.placements)
        ? issue.attributes.placements
        : [];
    var viewables = []
      .concat(linkedDocuments.map(function (item) {
        return item?.details?.viewable || item?.viewable || null;
      }))
      .concat(placements.map(function (item) {
        return item?.details?.viewable || item?.viewable || null;
      }))
      .concat([
        issue?.placement?.details?.viewable,
        issue?.placement?.viewable,
        issue?.attributes?.placement?.details?.viewable,
        issue?.attributes?.placement?.viewable
      ])
      .filter(Boolean);

    var is2d = viewables.some(function (viewable) {
      var typeText = String(
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
    });

    return is2d ? '2D' : '3D';
  }

  function renderIssueTableIdCell(issue, value, widthStyle) {
    var viewType = getIssueViewType(issue);
    var tagClass = viewType === '2D' ? 'two-d' : 'three-d';

    return '' +
      '<td' + widthStyle + '>' +
        '<div class="issueTableIdCell" title="' + escapeAttribute(value + ' ' + viewType) + '">' +
          '<span class="issueTableIdText">' + escapeHtml(value) + '</span>' +
          '<span class="issueTableViewTypeTag ' + escapeAttribute(tagClass) + '">' + escapeHtml(viewType) + '</span>' +
        '</div>' +
      '</td>';
  }

  function forEachIssueTableDocument(callback) {
    callback(document);

    if (isIssueTablePoppedOut()) {
      callback(issueTablePopoutWindow.document);
    }
  }

  function getIssueTableElement(targetDocument, id) {
    return targetDocument ? targetDocument.getElementById(id) : null;
  }

  function isIssueTablePoppedOut() {
    return Boolean(issueTablePopoutWindow && !issueTablePopoutWindow.closed);
  }

  function getIssueTablePopoutButtonHtml() {
    return '<button id="issueTablePopoutButton" class="issueTableHeaderButton" type="button" title="Pop out project issue table" aria-label="Pop out project issue table">' +
      '<span class="glyphicon glyphicon-new-window"></span>' +
    '</button>';
  }

  function syncIssueTablePopoutButtons() {
    forEachIssueTableDocument(function (targetDocument) {
      var button = getIssueTableElement(targetDocument, 'issueTablePopoutButton');
      if (!button) return;

      var poppedOut = isIssueTablePoppedOut();
      var icon = button.querySelector('.glyphicon');

      button.classList.toggle('active', poppedOut);
      button.title = poppedOut ? 'Dock project issue table back' : 'Pop out project issue table';
      button.setAttribute('aria-label', button.title);

      if (icon) {
        icon.className = poppedOut
          ? 'glyphicon glyphicon-resize-small'
          : 'glyphicon glyphicon-new-window';
      }
    });
  }

  function renderIssueTableHead(targetDocument) {
    targetDocument = targetDocument || document;

    var head = getIssueTableElement(targetDocument, 'issueTableHead');
    if (!head) return;

    var columns = getIssueTableColumns();
    var columnWidths = getIssueTableRenderColumnWidths(columns, targetDocument);
    setIssueTableRenderedWidth(targetDocument, columnWidths);

    head.innerHTML = columns.map(function (column) {
      var isSorted = issueTableState.sortKey === column.key;
      var isFiltered = hasIssueTableFilter(column.key);
      var classes = ['issueTableColumnButton'];
      var sortMarker = '';
      var width = columnWidths[column.key];
      var widthStyle = width ? ' style="width:' + width + 'px; min-width:' + width + 'px;"' : '';

      if (isSorted) {
        classes.push('sorted');
        sortMarker = issueTableState.sortDirection === 'desc' ? 'Z-A' : 'A-Z';
      }

      if (isFiltered) classes.push('filtered');

      return '<th data-issue-table-header="' + escapeAttribute(column.key) + '"' + widthStyle + '>' +
        '<span class="issueTableColumnDragHandle" data-issue-table-drag="' + escapeAttribute(column.key) + '" title="Drag to reorder column"><span class="glyphicon glyphicon-option-vertical"></span></span>' +
        '<button class="' + classes.join(' ') + '" type="button" data-issue-table-column="' + escapeAttribute(column.key) + '" aria-label="' + escapeAttribute(column.label + ' filter') + '">' +
          '<span>' + escapeHtml(column.label) + '</span>' +
          '<span class="issueTableColumnControls">' +
            (sortMarker ? '<span class="issueTableSortMarker">' + escapeHtml(sortMarker) + '</span>' : '') +
            '<span class="glyphicon glyphicon-filter issueTableColumnIcon" aria-hidden="true"></span>' +
          '</span>' +
        '</button>' +
        '<span class="issueTableColumnResizeHandle" data-issue-table-resize="' + escapeAttribute(column.key) + '" title="Resize column"></span>' +
      '</th>';
    }).join('');
  }

  function renderIssueTableColumnMenu(targetDocument) {
    targetDocument = targetDocument || document;

    var menu = getIssueTableElement(targetDocument, 'issueTableColumnMenu');
    if (!menu) return;

    var column = getIssueTableColumn(issueTableState.openColumnKey);
    if (!column) {
      menu.hidden = true;
      menu.innerHTML = '';
      return;
    }

    var options = getIssueTableColumnOptions(loadedIssues, column.key);
    var selectedValues = hasIssueTableFilter(column.key) && Array.isArray(issueTableState.filters[column.key])
      ? issueTableState.filters[column.key]
      : options.map(function (option) { return option.key; });
    var searchText = normalise(issueTableState.searchText);
    var visibleOptions = column.searchable === false
      ? options
      : options.filter(function (option) {
          return !searchText || normalise(option.label).includes(searchText);
        });
    var dateRange = column.type === 'date' ? getIssueTableDateRange(loadedIssues, column.key) : null;
    var currentDateFilter = issueTableState.dateFilters[column.key] || {};
    var currentNumberFilter = issueTableState.numberFilters[column.key] || {};
    var currentTextFilter = issueTableState.textFilters[column.key] || '';
    var sortHtml = column.type === 'status'
      ? ''
      : '<div class="issueTableMenuActions">' +
          '<button type="button" data-issue-table-action="sort-asc">' + escapeHtml(column.type === 'date' ? 'Oldest first' : column.type === 'number' ? 'Smallest first' : 'Sort A to Z') + '</button>' +
          '<button type="button" data-issue-table-action="sort-desc">' + escapeHtml(column.type === 'date' ? 'Newest first' : column.type === 'number' ? 'Largest first' : 'Sort Z to A') + '</button>' +
          (issueTableState.sortKey === column.key ? '<button type="button" data-issue-table-action="clear-sort">Clear sort</button>' : '') +
        '</div>';
    var filterHtml = '';

    if (column.type === 'text') {
      filterHtml =
        '<label class="issueTableMenuField">' +
          '<span>Contains</span>' +
          '<input class="issueTableTextFilterInput" type="search" placeholder="' + escapeAttribute(column.placeholder || 'Contains') + '" value="' + escapeAttribute(currentTextFilter) + '" data-issue-table-text-filter>' +
        '</label>';
    } else if (column.type === 'date') {
      filterHtml =
        (dateRange ? '<div class="issueTableMenuHint">Issue dates: ' + escapeHtml(dateRange.min) + ' to ' + escapeHtml(dateRange.max) + '</div>' : '') +
        '<div class="issueTableDateRange">' +
          '<label class="issueTableMenuField"><span>From</span><input type="date" value="' + escapeAttribute(currentDateFilter.from || '') + '" data-issue-table-date-filter="from"></label>' +
          '<label class="issueTableMenuField"><span>To</span><input type="date" value="' + escapeAttribute(currentDateFilter.to || '') + '" data-issue-table-date-filter="to"></label>' +
        '</div>';
    } else if (column.type === 'number') {
      filterHtml =
        '<div class="issueTableDateRange">' +
          '<label class="issueTableMenuField"><span>Minimum</span><input type="number" value="' + escapeAttribute(currentNumberFilter.from || '') + '" data-issue-table-number-filter="from"></label>' +
          '<label class="issueTableMenuField"><span>Maximum</span><input type="number" value="' + escapeAttribute(currentNumberFilter.to || '') + '" data-issue-table-number-filter="to"></label>' +
        '</div>';
    } else {
      filterHtml =
        (column.searchable ? '<input id="issueTableFilterSearch" class="issueTableFilterSearch" type="search" placeholder="Search values" value="' + escapeAttribute(issueTableState.searchText) + '">' : '') +
        '<div class="issueTableMenuActions compact">' +
          '<button type="button" data-issue-table-action="select-all">All</button>' +
          '<button type="button" data-issue-table-action="clear-values">None</button>' +
          '<button type="button" data-issue-table-action="reset-filter">Reset filter</button>' +
        '</div>' +
        '<div class="issueTableMenuOptions">' +
          (
            visibleOptions.length
              ? visibleOptions.map(function (option) {
                  var checked = selectedValues.indexOf(option.key) !== -1 ? ' checked' : '';
                  var statusClassName = column.type === 'status' ? ' status-' + statusClass(option.label) : '';

                  return '<label class="issueTableMenuOption' + escapeAttribute(statusClassName) + '">' +
                    '<input type="checkbox" value="' + escapeAttribute(option.key) + '" data-issue-table-filter-value' + checked + '> ' +
                    '<span class="issueTableOptionLabel">' + escapeHtml(option.label) + '</span>' +
                  '</label>';
                }).join('')
              : '<div class="issueTableMenuEmpty">No matching values.</div>'
          ) +
        '</div>';
    }

    menu.hidden = false;
    menu.setAttribute('data-issue-table-menu-key', column.key);
    menu.innerHTML =
      '<div class="issueTableMenuHeader">' +
        '<div class="issueTableMenuTitle">' + escapeHtml(column.label) + '</div>' +
        '<button class="issueTableMenuClose" type="button" data-issue-table-action="close">Close</button>' +
      '</div>' +
      sortHtml +
      filterHtml +
      ((column.type === 'text' || column.type === 'date' || column.type === 'number') ? '<div class="issueTableMenuActions compact"><button type="button" data-issue-table-action="reset-filter">Reset filter</button></div>' : '');

    positionIssueTableColumnMenu(menu, column.key, targetDocument);
  }

  function positionIssueTableColumnMenu(menu, columnKey, targetDocument) {
    targetDocument = targetDocument || document;

    var targetWindow = targetDocument.defaultView || window;
    var button = Array.from(targetDocument.querySelectorAll('[data-issue-table-column]')).find(function (item) {
      return item.getAttribute('data-issue-table-column') === columnKey;
    });

    if (!button) return;

    var rect = button.getBoundingClientRect();
    var width = Math.min(320, targetWindow.innerWidth - 24);
    var left = Math.min(Math.max(12, rect.left), targetWindow.innerWidth - width - 12);
    var top = Math.min(rect.bottom + 6, targetWindow.innerHeight - 80);

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.width = width + 'px';
    menu.style.maxHeight = Math.max(220, targetWindow.innerHeight - top - 12) + 'px';
  }

  function renderIssueTableCustomColumnsMenu(targetDocument) {
    targetDocument = targetDocument || document;

    var menu = getIssueTableElement(targetDocument, 'issueTableCustomColumnsMenu');
    if (!menu) return;

    if (!issueTableState.customColumnMenuOpen) {
      menu.hidden = true;
      menu.innerHTML = '';
      return;
    }

    var definitions = (issueSettingsCache?.customAttributeDefinitions || []).filter(function (definition) {
      return definition?.id && definition?.title;
    }).sort(function (a, b) {
      return String(a.title).localeCompare(String(b.title), undefined, { numeric: true });
    });

    menu.hidden = false;
    menu.innerHTML =
      '<div class="issueTableMenuHeader">' +
        '<div class="issueTableMenuTitle">Custom columns</div>' +
        '<button class="issueTableMenuClose" type="button" data-issue-custom-columns-close>Close</button>' +
      '</div>' +
      (
        definitions.length
          ? '<div class="issueTableMenuOptions">' +
              definitions.map(function (definition) {
                var checked = issueTableCustomColumnIds.indexOf(String(definition.id)) !== -1 ? ' checked' : '';

                return '<label class="issueTableMenuOption">' +
                  '<input type="checkbox" value="' + escapeAttribute(definition.id) + '" data-issue-custom-column-toggle' + checked + '> ' +
                  '<span class="issueTableOptionLabel">' + escapeHtml(definition.title) + '</span>' +
                  '<span class="issueTableCustomColumnType">' + escapeHtml(getCustomAttributeTableType(definition)) + '</span>' +
                '</label>';
              }).join('') +
            '</div>'
          : '<div class="issueTableMenuEmpty">No custom attributes found in issue settings.</div>'
      );

    positionIssueTableCustomColumnsMenu(menu, targetDocument);
  }

  function positionIssueTableCustomColumnsMenu(menu, targetDocument) {
    targetDocument = targetDocument || document;

    var targetWindow = targetDocument.defaultView || window;
    var button = getIssueTableElement(targetDocument, 'issueTableCustomColumnsButton');
    if (!button) return;

    var rect = button.getBoundingClientRect();
    var width = Math.min(340, targetWindow.innerWidth - 24);
    var left = Math.min(Math.max(12, rect.right - width), targetWindow.innerWidth - width - 12);
    var top = Math.min(rect.bottom + 6, targetWindow.innerHeight - 80);

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.width = width + 'px';
    menu.style.maxHeight = Math.max(240, targetWindow.innerHeight - top - 12) + 'px';
  }

  function setIssueTableFilterValue(key, valueKey, checked) {
    var options = getIssueTableColumnOptions(loadedIssues, key);
    var allValues = options.map(function (option) { return option.key; });
    var selectedValues = hasIssueTableFilter(key)
      ? issueTableState.filters[key].slice()
      : allValues.slice();

    if (checked && selectedValues.indexOf(valueKey) === -1) {
      selectedValues.push(valueKey);
    }

    if (!checked) {
      selectedValues = selectedValues.filter(function (item) {
        return item !== valueKey;
      });
    }

    if (selectedValues.length === allValues.length) {
      delete issueTableState.filters[key];
    } else {
      issueTableState.filters[key] = selectedValues;
    }
  }

  function setIssueTableTextFilter(key, value) {
    var clean = String(value || '').trim();

    if (clean) {
      issueTableState.textFilters[key] = clean;
    } else {
      delete issueTableState.textFilters[key];
    }
  }

  function setIssueTableDateFilter(key, part, value) {
    var filter = issueTableState.dateFilters[key] || {};

    if (value) {
      filter[part] = value;
    } else {
      delete filter[part];
    }

    if (filter.from || filter.to) {
      issueTableState.dateFilters[key] = filter;
    } else {
      delete issueTableState.dateFilters[key];
    }
  }

  function setIssueTableNumberFilter(key, part, value) {
    var filter = issueTableState.numberFilters[key] || {};

    if (value !== '') {
      filter[part] = value;
    } else {
      delete filter[part];
    }

    if (filter.from || filter.to) {
      issueTableState.numberFilters[key] = filter;
    } else {
      delete issueTableState.numberFilters[key];
    }
  }

  function handleIssueTableMenuAction(action, key) {
    if (!key && action !== 'close') return;

    if (action === 'sort-asc' || action === 'sort-desc') {
      issueTableState.sortKey = key;
      issueTableState.sortDirection = action === 'sort-desc' ? 'desc' : 'asc';
    } else if (action === 'clear-sort') {
      if (issueTableState.sortKey === key) {
        issueTableState.sortKey = '';
        issueTableState.sortDirection = 'asc';
      }
    } else if (action === 'select-all' || action === 'clear-filter') {
      delete issueTableState.filters[key];
    } else if (action === 'clear-values') {
      issueTableState.filters[key] = [];
    } else if (action === 'reset-filter') {
      delete issueTableState.filters[key];
      delete issueTableState.textFilters[key];
      delete issueTableState.dateFilters[key];
      delete issueTableState.numberFilters[key];
    } else if (action === 'close') {
      issueTableState.openColumnKey = '';
      issueTableState.searchText = '';
    }
  }

  function formatStatusLabel(value) {
    var clean = String(value || '').replace(/_/g, ' ').trim();
    if (!clean) return '-';
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  function getCurrentProjectId() {
    return (
      window.currentModelInfo?.projectId ||
      currentIssueDetail?.issue?.projectId ||
      currentIssueDetail?.issue?.attributes?.projectId ||
      ''
    );
  }

  function getCurrentAccountId() {
    return (
      window.currentModelInfo?.hubId ||
      window.currentModelInfo?.accountId ||
      ''
    );
  }

  function issueApiQuery() {
    var accountId = getCurrentAccountId();
    return accountId ? '?accountId=' + encodeURIComponent(accountId) : '';
  }

  function issueApiUrl(issueId, suffix) {
    var projectId = getCurrentProjectId();

    if (!projectId || !issueId) return '';

    return '/api/projects/' + encodeURIComponent(projectId) +
      '/issues/' + encodeURIComponent(issueId) +
      (suffix || '') +
      issueApiQuery();
  }

  async function loadIssueSettings(forceReload) {
    var projectId = getCurrentProjectId();
    var accountId = getCurrentAccountId();
    var cacheKey = projectId + '|' + accountId;

    if (!projectId) return null;
    if (!forceReload && issueSettingsCache && issueSettingsCacheKey === cacheKey) return issueSettingsCache;

    issueTableCustomColumnIds = [];

    var query = accountId ? '?accountId=' + encodeURIComponent(accountId) : '';
    var response = await fetch('/api/projects/' + encodeURIComponent(projectId) + '/issues/settings' + query);
    var body = await response.json().catch(function () { return null; });

    if (!response.ok) {
      throw new Error(body?.error || 'Issue settings request failed: ' + response.status);
    }

    issueSettingsCache = body || {};
    issueSettingsCacheKey = cacheKey;
    clearIssueTableColumnWidths();
    loadIssueTableCustomColumnIds();

    return issueSettingsCache;
  }

  function canEditIssueAttribute(issue, attribute) {
    var permitted = issue?.permittedAttributes;

    if (!Array.isArray(permitted)) return false;

    return permitted.includes(attribute);
  }

  function canUseIssueAction(issue, action) {
    var actions = issue?.permittedActions;

    if (!Array.isArray(actions)) return false;

    return actions.includes(action);
  }

  function getIssueCustomAttributes(issue) {
    return Array.isArray(issue?.customAttributes)
      ? issue.customAttributes
      : Array.isArray(issue?.attributes?.customAttributes)
        ? issue.attributes.customAttributes
        : [];
  }

  function getIssueCustomAttributeDefinitionId(attribute) {
    return (
      attribute?.attributeDefinitionId ||
      attribute?.attributes?.attributeDefinitionId ||
      attribute?.definition?.id ||
      attribute?.attributeDefinition?.id ||
      ''
    );
  }

  function getIssueCustomAttribute(issue, attributeDefinitionId) {
    var expectedId = String(attributeDefinitionId || '');

    return getIssueCustomAttributes(issue).find(function (attribute) {
      return String(getIssueCustomAttributeDefinitionId(attribute)) === expectedId;
    }) || null;
  }

  function getCustomAttributeDefinition(settings, attributeDefinitionId) {
    var definitions = settings?.customAttributeDefinitions || [];

    return definitions.find(function (definition) {
      return String(definition.id) === String(attributeDefinitionId);
    }) || null;
  }

  function getCustomAttributeDisplayValue(attribute, settings, knownDefinition) {
    var definition = knownDefinition || getCustomAttributeDefinition(settings, getIssueCustomAttributeDefinitionId(attribute));
    var option = definition?.options?.find(function (item) {
      return String(item.id) === String(attribute.value);
    });

    if (attribute.value && isDropdownCustomAttribute(definition, attribute) && !option) {
      return 'Unresolved option';
    }

    return text(option?.name || attribute.value, 'Unspecified');
  }

  function getCustomAttributeLabel(attribute, settings) {
    var definition = getCustomAttributeDefinition(settings, getIssueCustomAttributeDefinitionId(attribute));
    return text(attribute?.title || definition?.title, 'Custom field');
  }

  function getCustomAttributeType(definition, attribute) {
    return normalise(definition?.type || attribute?.type || '');
  }

  function isDropdownCustomAttribute(definition, attribute) {
    var typeValue = getCustomAttributeType(definition, attribute);

    return typeValue.includes('drop') || typeValue.includes('list') || typeValue.includes('select');
  }

  function renderCustomAttributeEditor(attribute, definition) {
    var typeValue = getCustomAttributeType(definition, attribute);
    var value = attribute?.value === null || attribute?.value === undefined ? '' : attribute.value;

    if (isDropdownCustomAttribute(definition, attribute)) {
      var options = (definition?.options || []).map(function (option) {
        return { value: option.id, label: option.name };
      });
      var hasCurrentOption = options.some(function (option) {
        return String(option.value) === String(value);
      });

      if (value && !hasCurrentOption) {
        options.push({ value: value, label: 'Unresolved option' });
      }

      return '<select id="issueEditor-customAttribute">' +
        buildSelectOptions(options, value, 'Unspecified') +
        '</select>';
    }

    if (typeValue.includes('paragraph')) {
      return '<textarea id="issueEditor-customAttribute">' + escapeHtml(value) + '</textarea>';
    }

    var inputType = typeValue.includes('numeric') || typeValue.includes('number') ? 'number' : 'text';
    return '<input id="issueEditor-customAttribute" type="' + inputType + '" value="' + escapeAttribute(value) + '">';
  }

  function getCustomAttributeMappingValue(mapping, key) {
    var snakeKey = key.replace(/[A-Z]/g, function (letter) {
      return '_' + letter.toLowerCase();
    });

    return (
      mapping?.[key] ||
      mapping?.[snakeKey] ||
      mapping?.attributes?.[key] ||
      mapping?.attributes?.[snakeKey] ||
      mapping?.relationships?.[key]?.data?.id ||
      mapping?.relationships?.[snakeKey]?.data?.id ||
      ''
    );
  }

  function getCustomAttributeDefinitionIdFromMapping(mapping) {
    return (
      getCustomAttributeMappingValue(mapping, 'attributeDefinitionId') ||
      getCustomAttributeMappingValue(mapping, 'customAttributeDefinitionId') ||
      getCustomAttributeMappingValue(mapping, 'issueAttributeDefinitionId') ||
      getCustomAttributeMappingValue(mapping, 'definitionId') ||
      getCustomAttributeMappingValue(mapping, 'customAttributeId') ||
      mapping?.relationships?.attributeDefinition?.data?.id ||
      mapping?.relationships?.attribute_definition?.data?.id ||
      mapping?.relationships?.customAttributeDefinition?.data?.id ||
      mapping?.relationships?.custom_attribute_definition?.data?.id
    );
  }

  function getMappingTargetId(mapping) {
    return String(
      getCustomAttributeMappingValue(mapping, 'mappedItemId') ||
      getCustomAttributeMappingValue(mapping, 'mapped_item_id') ||
      mapping?.relationships?.mappedItem?.data?.id ||
      mapping?.relationships?.mapped_item?.data?.id ||
      ''
    );
  }

  function getMappingTargetType(mapping) {
    return normalise(
      getCustomAttributeMappingValue(mapping, 'mappedItemType') ||
      getCustomAttributeMappingValue(mapping, 'mapped_item_type') ||
      mapping?.relationships?.mappedItem?.data?.type ||
      mapping?.relationships?.mapped_item?.data?.type ||
      ''
    );
  }

  function getIssueTypeIdForCustomAttributeMapping(issue, settings) {
    var issueSubtypeId = String(getIssueSubtypeId(issue) || '');
    var directTypeId = String(getIssueTypeId(issue) || '');

    if (directTypeId) return directTypeId;

    var subtype = (settings?.issueSubtypes || []).find(function (item) {
      return String(item.id) === issueSubtypeId;
    });

    return String(subtype?.issueTypeId || '');
  }

  function mappingAppliesToIssue(mapping, issue, settings) {
    var issueTypeId = getIssueTypeIdForCustomAttributeMapping(issue, settings);
    var issueSubtypeId = String(getIssueSubtypeId(issue) || '');
    var mappingTypeId = String(getCustomAttributeMappingValue(mapping, 'issueTypeId') || '');
    var mappingSubtypeId = String(
      getCustomAttributeMappingValue(mapping, 'issueSubtypeId') ||
      getCustomAttributeMappingValue(mapping, 'issueSubTypeId')
    );
    var mappedItemId = getMappingTargetId(mapping);
    var mappedItemType = getMappingTargetType(mapping);

    if (mappedItemId && mappedItemType.includes('subtype')) return mappedItemId === issueSubtypeId;
    if (mappedItemId && mappedItemType.includes('type')) return mappedItemId === issueTypeId;
    if (mappedItemId && !mappedItemType) return mappedItemId === issueSubtypeId || mappedItemId === issueTypeId;

    if (mappingSubtypeId) return mappingSubtypeId === issueSubtypeId;
    if (mappingTypeId) return mappingTypeId === issueTypeId;

    return true;
  }

  function getCustomAttributeDefinitionsForIssue(issue, settings) {
    var definitions = settings?.customAttributeDefinitions || [];
    var definitionsById = {};
    var issueAttributeDefinitionsById = {};
    var ids = {};

    definitions.forEach(function (definition) {
      definitionsById[String(definition.id)] = definition;
    });

    getIssueCustomAttributes(issue).forEach(function (attribute) {
      var id = getIssueCustomAttributeDefinitionId(attribute);
      if (!id) return;

      ids[String(id)] = true;
      issueAttributeDefinitionsById[String(id)] = {
        id: String(id),
        title: attribute.title || 'Custom field',
        type: attribute.type || 'text',
        options: []
      };
    });

    (settings?.customAttributeMappings || []).forEach(function (mapping) {
      if (!mappingAppliesToIssue(mapping, issue, settings)) return;

      var definitionId = getCustomAttributeDefinitionIdFromMapping(mapping);
      if (definitionId) ids[String(definitionId)] = true;
    });

    return Object.keys(ids).map(function (id) {
      return definitionsById[id] || issueAttributeDefinitionsById[id] || null;
    }).filter(function (definition) {
      return definition !== null;
    });
  }

  function getIssueSubtypeId(issue) {
    return (
      issue?.issueSubtypeId ||
      issue?.attributes?.issueSubtypeId ||
      issue?.issueSubtype?.id ||
      issue?.attributes?.issueSubtype?.id ||
      ''
    );
  }

  function getIssueTypeId(issue) {
    return (
      issue?.issueTypeId ||
      issue?.attributes?.issueTypeId ||
      issue?.issueType?.id ||
      issue?.attributes?.issueType?.id ||
      ''
    );
  }

  function getRootCauseId(issue) {
    return (
      issue?.rootCauseId ||
      issue?.attributes?.rootCauseId ||
      issue?.rootCause?.id ||
      issue?.attributes?.rootCause?.id ||
      ''
    );
  }

  function getAssigneeValue(issue) {
    var typeValue = getAssignedToType(issue);
    var idValue =
      issue?.assignedTo ||
      issue?.attributes?.assignedTo ||
      '';

    return typeValue && idValue ? String(typeValue) + ':' + String(idValue) : '';
  }

  function buildSelectOptions(options, selectedValue, placeholder) {
    var html = '<option value="">' + escapeHtml(placeholder || 'Select') + '</option>';

    options.forEach(function (option) {
      var value = String(option.value ?? option.id ?? '');
      var label = option.label || option.name || value;
      var selected = String(selectedValue || '') === value ? ' selected' : '';

      html += '<option value="' + escapeAttribute(value) + '"' + selected + '>' +
        escapeHtml(label) +
        '</option>';
    });

    return html;
  }

  function typeBadgeText(label) {
    var clean = String(label || '').trim();
    var lower = clean.toLowerCase();

    if (lower.includes('clash')) return 'CL';
    if (lower.includes('coordination')) return 'COR';
    if (lower.includes('commissioning')) return 'CM';

    var words = clean.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      return words.map(function (word) {
        return word.charAt(0);
      }).join('').slice(0, 3).toUpperCase();
    }

    return clean.slice(0, clean.length > 8 ? 3 : 2).toUpperCase() || 'T';
  }

  function renderTypeBadge(label) {
    return '<span class="accIssueTypeBadge">' + escapeHtml(typeBadgeText(label)) + '</span>';
  }

  function getIssueTypeValueHtml(issue) {
    var label = getIssueType(issue, {});
    return '<span class="accIssueTypeValue">' + renderTypeBadge(label) + '<span>' + escapeHtml(label) + '</span></span>';
  }

  function getIssueQuickFilterType(issue) {
    var subtypeId = getIssueSubtypeId(issue);
    var subtype = (issueSettingsCache?.issueSubtypes || []).find(function (item) {
      return String(item.id) === String(subtypeId);
    });

    if (subtype?.name) {
      return subtype.categoryName
        ? subtype.categoryName + ' / ' + subtype.name
        : subtype.name;
    }

    var subtypeName =
      issue?.issueSubtype?.title ||
      issue?.issueSubtype?.name ||
      issue?.issueSubtypeName ||
      issue?.attributes?.issueSubtype ||
      issue?.subtype ||
      '';

    if (subtypeName) return getDisplayName(subtypeName, 'Not specified');

    return getIssueType(issue, {});
  }

  function getIssueQuickFilterTypeHtml(typeLabel) {
    return renderTypeBadge(typeLabel) + '<span>' + escapeHtml(typeLabel) + '</span>';
  }

  function getIssueOpenUrl(issue) {
    var projectId =
      window.currentModelInfo?.projectId ||
      currentIssueDetail?.projectId ||
      currentIssueDetail?.summary?.projectId ||
      issue?.projectId ||
      issue?.containerId ||
      issue?.attributes?.projectId ||
      issue?.attributes?.containerId ||
      '';
    var issueId = getIssueId(issue, currentIssueDetail?.summary || {});

    if (!projectId || !issueId) return '';

    return 'https://acc.autodesk.com/docs/issues/projects/' +
      encodeURIComponent(stripProjectPrefix(projectId)) +
      '/issues?issueId=' +
      encodeURIComponent(issueId);
  }

  function getIssueThumbnailUrl(issue) {
    var dataUrl = getIssueSnapshotDataUrl(issue);

    if (dataUrl) return dataUrl;

    var projectId =
      window.currentModelInfo?.projectId ||
      currentIssueDetail?.projectId ||
      currentIssueDetail?.summary?.projectId ||
      issue?.projectId ||
      issue?.containerId ||
      issue?.attributes?.projectId ||
      issue?.attributes?.containerId ||
      '';
    var issueId = getIssueId(issue, currentIssueDetail?.summary || {});

    if (!projectId || !issueId || !getIssueSnapshotUrn(issue)) return '';

    return '/api/projects/' +
      encodeURIComponent(stripProjectPrefix(projectId)) +
      '/issues/' +
      encodeURIComponent(issueId) +
      '/thumbnail' +
      issueApiQuery();
  }

  function getReferenceUrl(reference, issue) {
    var directUrl =
      reference?.webUrl ||
      reference?.web_url ||
      reference?.url ||
      reference?.href ||
      reference?.originContext?.fallbackViewerUrl ||
      reference?.details?.originContext?.fallbackViewerUrl ||
      '';

    if (directUrl) return directUrl;

    var lineageUrn =
      reference?.lineageUrn ||
      reference?.urn ||
      reference?.details?.lineageUrn ||
      '';
    var projectId =
      window.currentModelInfo?.projectId ||
      issue?.projectId ||
      issue?.containerId ||
      issue?.attributes?.projectId ||
      issue?.attributes?.containerId ||
      '';

    if (!projectId || !lineageUrn) return '';

    return 'https://acc.autodesk.com/docs/files/projects/' +
      encodeURIComponent(stripProjectPrefix(projectId)) +
      '?entityId=' +
      encodeURIComponent(lineageUrn);
  }

  function getIssueReferences(issue) {
    var candidates = [
      issue?.references,
      issue?.referenceLinks,
      issue?.referencedDocuments,
      issue?.attributes?.references,
      issue?.attributes?.referenceLinks,
      issue?.attributes?.referencedDocuments
    ];

    return candidates.find(Array.isArray) || [];
  }

  function getReferenceLabel(reference) {
    return text(
      reference?.name ||
      reference?.displayName ||
      reference?.fileName ||
      reference?.details?.viewable?.name ||
      reference?.viewable?.name ||
      reference?.urn ||
      reference?.lineageUrn,
      'Reference'
    );
  }

  function getCommentAuthorName(comment) {
    var candidates = [
      comment?.createdByDisplayName,
      comment?.createdByName,
      comment?.createdBy
    ];
    var resolvedName = candidates.map(resolveKnownUserName).find(Boolean);
    var directName = candidates.map(function (candidate) {
      return getDisplayName(candidate, '');
    }).find(function (name) {
      return !isPlaceholderName(name);
    });

    return resolvedName || directName || 'Unknown user';
  }

  function getIdentityKeys(value) {
    if (!value) return [];

    if (typeof value !== 'object') return [String(value)];

    var attributes = value.attributes || {};

    return [
      value.id,
      value.userId,
      value.uid,
      value.autodeskId,
      value.accountUserId,
      value.memberId,
      value.user?.id,
      value.user?.userId,
      value.user?.uid,
      value.user?.autodeskId,
      value.user?.accountUserId,
      value.email,
      attributes.id,
      attributes.userId,
      attributes.uid,
      attributes.autodeskId,
      attributes.accountUserId,
      attributes.memberId,
      attributes.user?.id,
      attributes.user?.userId,
      attributes.user?.uid,
      attributes.user?.autodeskId,
      attributes.user?.accountUserId,
      attributes.email
    ].filter(Boolean).map(String);
  }

  function hasMatchingIdentity(left, right) {
    var leftKeys = getIdentityKeys(left).map(normalise).filter(Boolean);
    var rightKeys = getIdentityKeys(right).map(normalise).filter(Boolean);

    return leftKeys.some(function (key) {
      return rightKeys.includes(key);
    });
  }

  function resolveKnownUserName(value) {
    if (!value || !issueSettingsCache) return '';

    var profile = issueSettingsCache.userProfile?.data || issueSettingsCache.userProfile || {};
    if (hasMatchingIdentity(value, profile)) {
      var profileName = getDisplayName(profile, '');
      return isPlaceholderName(profileName) ? '' : profileName;
    }

    var assignee = (issueSettingsCache.assignees || []).find(function (option) {
      if (option.type !== 'user') return false;
      if (normalise(option.id) && getIdentityKeys(value).map(normalise).includes(normalise(option.id))) return true;
      return hasMatchingIdentity(value, option.raw);
    });

    return assignee && !isPlaceholderName(assignee.name) ? assignee.name : '';
  }

  function getCommentBody(comment) {
    return text(comment?.body || comment?.comment || comment?.text || comment?.message, '');
  }

  function updateLoadedIssue(updatedIssue) {
    var updatedId = getIssueId(updatedIssue, {});

    if (!updatedId) return;

    loadedIssues = loadedIssues.map(function (issue) {
      return normalise(getIssueId(issue, {})) === normalise(updatedId)
        ? updatedIssue
        : issue;
    });

    selectedIssueTableId = updatedId;
    renderIssueTable(loadedIssues, selectedIssueTableId);
  }

  function setCurrentIssue(updatedIssue) {
    currentIssueDetail = {
      ...(currentIssueDetail || {}),
      issue: updatedIssue || {},
      summary: {
        ...(currentIssueDetail?.summary || {}),
        id: getIssueId(updatedIssue, {}),
        displayId: getIssueDisplayId(updatedIssue, {}),
        title: getIssueTitle(updatedIssue, {}),
        status: getIssueStatus(updatedIssue, {}),
        type: getIssueType(updatedIssue, {}),
        category: getIssueCategory(updatedIssue),
        description: getIssueDescription(updatedIssue, {}),
        assignedTo: getAssignedTo(updatedIssue, {})
      }
    };
  }

  function refreshCurrentIssueFromLoadedIssues() {
    var currentIssueId = getIssueId(currentIssueDetail?.issue || {}, currentIssueDetail?.summary || {});
    if (!currentIssueId) return;

    var refreshedIssue = loadedIssues.find(function (issue) {
      return normalise(getIssueId(issue, {})) === normalise(currentIssueId);
    });

    if (!refreshedIssue) {
      clearIssueDetails();
      return;
    }

    setCurrentIssue(refreshedIssue);
    renderIssueDetails();
    loadCurrentIssueSideData(refreshedIssue);
  }

  async function patchCurrentIssue(updates) {
    var issue = currentIssueDetail?.issue || {};
    var issueId = getIssueId(issue, currentIssueDetail?.summary || {});
    var url = issueApiUrl(issueId);

    if (!url) {
      throw new Error('Could not determine the current ACC issue.');
    }

    var response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        updates: updates
      })
    });

    var body = await response.json().catch(function () { return null; });

    if (!response.ok) {
      throw new Error(getIssueApiErrorMessage(body, 'Issue update failed: ' + response.status));
    }

    var updatedIssue = body?.data || body?.issue || body;

    setCurrentIssue(updatedIssue);
    updateLoadedIssue(updatedIssue);
    document.dispatchEvent(new CustomEvent('accissueupdated', { detail: { issue: updatedIssue } }));

    return updatedIssue;
  }

  async function loadCurrentIssueSideData(issue) {
    var issueId = getIssueId(issue, {});
    var commentsUrl = issueApiUrl(issueId, '/comments');

    currentIssueComments = [];

    if (!commentsUrl) return;

    try {
      var comments = await fetch(commentsUrl).then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) throw new Error(body?.error || 'Comments failed.');
          return body?.data || [];
        });
      });

      if (normalise(getIssueId(currentIssueDetail?.issue || {}, {})) !== normalise(issueId)) return;

      currentIssueComments = comments;
      renderIssueDetails();
    } catch (error) {
      console.warn(error);
    }
  }

  async function refreshCurrentIssueFromAcc() {
    var issue = currentIssueDetail?.issue || {};
    var issueId = getIssueId(issue, currentIssueDetail?.summary || {});
    var url = issueApiUrl(issueId);

    if (!url) return null;

    var response = await fetch(url);
    var body = await response.json().catch(function () { return null; });

    if (!response.ok) {
      throw new Error(body?.error || 'Issue refresh failed: ' + response.status);
    }

    var refreshedIssue = body?.data || body?.issue || body;

    setCurrentIssue(refreshedIssue);
    updateLoadedIssue(refreshedIssue);
    await loadCurrentIssueSideData(refreshedIssue);

    return refreshedIssue;
  }


  function initRevitConnectionPanel() {
    if (!window.RevitConnectionPanel) return;

    var revitConnectionPanel = new window.RevitConnectionPanel(setStatus);
    revitConnectionPanel.init();
  }

  function syncIssueSelectionModePanel() {
    var enabled = getOpenSavedViewOnSelectSetting();
    var panel = document.getElementById('issueSelectionModePanel');
    var state = document.getElementById('issueSelectionModeState');
    var hint = document.getElementById('issueSelectionModeHint');

    if (panel) {
      panel.classList.toggle('active', enabled);
    }

    if (state) {
      state.textContent = enabled ? 'ON' : 'OFF';
    }

    if (hint) {
      hint.textContent = enabled
        ? 'Issue clicks will open the saved ACC issue view.'
        : 'Issue clicks keep the current viewer context.';
    }
  }

  function buildIssueSelectionModePanel() {
    if (document.getElementById('issueSelectionModePanel')) return;

    var issueDetailsPanel = document.getElementById('issueDetailsPanel');
    if (!issueDetailsPanel || !issueDetailsPanel.parentNode) return;

    var panel = document.createElement('section');
    panel.id = 'issueSelectionModePanel';
    panel.className = 'issueSelectionModePanel';
    panel.innerHTML = `
      <button id="issueSelectionModeToggle" class="issueSelectionModeButton" type="button">
        <span class="issueSelectionModeText">
          <span class="issueSelectionModeTitle">Open saved ACC issue view on issue selection</span>
          <span id="issueSelectionModeHint" class="issueSelectionModeHint">Issue clicks keep the current viewer context.</span>
        </span>
        <span id="issueSelectionModeState" class="issueSelectionModeState">OFF</span>
      </button>
    `;

    var filterPanel = document.getElementById('issueFilterPanel');

    if (filterPanel && filterPanel.parentNode === issueDetailsPanel.parentNode) {
      issueDetailsPanel.parentNode.insertBefore(panel, filterPanel);
    } else {
      issueDetailsPanel.parentNode.insertBefore(panel, issueDetailsPanel);
    }

    syncIssueSelectionModePanel();
  }

  function buildIssueFilterPanel() {
    var rightPanel = document.querySelector('.rightPanel, #rightPanel, aside.viewerActions, #viewerActionsPanel');
    var issueDetailsPanel = document.getElementById('issueDetailsPanel');

    if (!issueDetailsPanel) return;

    if (document.getElementById('issueFilterPanel')) return;

    var panel = document.createElement('div');
    panel.id = 'issueFilterPanel';
    panel.className = 'issueFilterPanel';
    panel.innerHTML = `
      <div class="issueFilterHeader">
        <h3>Quick Filters</h3>
        <div class="issueFilterHeaderActions">
          <button id="issueFilterResetButton" type="button">Reset</button>
          <button id="issueFilterClearButton" type="button">Clear all</button>
          <button id="issueFilterCollapseButton" class="issueFilterCollapseButton" type="button">×</button>
        </div>
      </div>

      <div class="issueFilterBody">
        <div class="issueFilterField">
          <label for="issueTypeFilter">Type</label>
          <button id="issueTypeFilterButton" class="issueTypeFilterButton" type="button">
            <span id="issueTypeFilterLabel">Select a type</span>
            <span class="glyphicon glyphicon-chevron-down"></span>
          </button>
          <input id="issueTypeFilter" type="hidden" value="">
          <div id="issueTypeFilterMenu" class="issueTypeFilterMenu" hidden></div>
        </div>

        <div class="issueFilterField">
          <label>Status</label>
          <div id="issueStatusFilter" class="issueStatusChips">
            <button class="issueStatusChip active" type="button" data-status="draft">
              <span class="statusColour"></span><span>Draft</span>
            </button>
            <button class="issueStatusChip active" type="button" data-status="open">
              <span class="statusColour"></span><span>Open</span>
            </button>
            <button class="issueStatusChip active" type="button" data-status="pending">
              <span class="statusColour"></span><span>Pending</span>
            </button>
            <button class="issueStatusChip active" type="button" data-status="in review">
              <span class="statusColour"></span><span>In review</span>
            </button>
            <button class="issueStatusChip active" type="button" data-status="closed">
              <span class="statusColour"></span><span>Closed</span>
            </button>
          </div>
        </div>


        <div class="issueFilterField">
          <label for="issueAssignedToFilter">Assigned to</label>
          <select id="issueAssignedToFilter">
            <option value="">Select a member, role, or company</option>
          </select>
        </div>

        <div id="issueFilterSummary" class="issueFilterSummary">No issue data loaded yet.</div>
      </div>
    `;

    var filterPanel = document.getElementById('issueFilterPanel');
    if (filterPanel && filterPanel.parentNode === issueDetailsPanel.parentNode) {
      issueDetailsPanel.parentNode.insertBefore(panel, filterPanel);
    } else {
      issueDetailsPanel.parentNode.insertBefore(panel, issueDetailsPanel);
    }

    initIssueFilterEvents();
  }

  function buildIssueTablePanel() {
    var issueDetailsPanel = document.getElementById('issueDetailsPanel');
    if (!issueDetailsPanel || document.getElementById('issueTablePanel')) return;

    var panel = document.createElement('section');
    panel.id = 'issueTablePanel';
    panel.className = 'issueTablePanel';
    panel.innerHTML =
      '<div class="issueTableHeader">' +
        '<span>Project issues</span>' +
        '<div class="issueTableHeaderActions">' +
          '<span id="issueTableCount" class="issueTableCount">No issues</span>' +
          '<button id="issueTableRefreshButton" class="issueTableHeaderButton" type="button" title="Refresh issues from ACC/Forma">' +
            '<span class="glyphicon glyphicon-refresh"></span>' +
          '</button>' +
          getIssueTablePopoutButtonHtml() +
          '<button id="issueTableCustomColumnsButton" class="issueTableHeaderButton" type="button" title="Choose custom attribute columns">' +
            '<span class="glyphicon glyphicon-cog"></span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div id="issueTableCustomColumnsMenu" class="issueTableCustomColumnsMenu" hidden></div>' +
      '<div id="issueTableColumnMenu" class="issueTableColumnMenu" hidden></div>' +
      '<div class="issueTableWrapper"><table class="issueTable"><thead><tr id="issueTableHead"></tr></thead><tbody id="issueTableBody"><tr><td colspan="6">No issues loaded.</td></tr></tbody></table></div>';
    issueDetailsPanel.parentNode.insertBefore(panel, issueDetailsPanel);
    renderIssueTableHead();
    syncIssueTablePopoutButtons();
  }

  function renderIssueTable(issues, selectedIssueIdForRender) {
    forEachIssueTableDocument(function (targetDocument) {
      renderIssueTableInDocument(issues, selectedIssueIdForRender, targetDocument);
    });
  }

  function renderIssueTableInDocument(issues, selectedIssueIdForRender, targetDocument) {
    targetDocument = targetDocument || document;

    var tbody = getIssueTableElement(targetDocument, 'issueTableBody');
    if (!tbody) return;

    renderIssueTableHead(targetDocument);
    renderIssueTableColumnMenu(targetDocument);
    renderIssueTableCustomColumnsMenu(targetDocument);
    syncIssueTablePopoutButtons();

    var quickFilteredIssues = getQuickFilteredIssues(issues);
    var rows = getIssueTableRows(quickFilteredIssues);
    var total = (issues || []).length;
    var count = getIssueTableElement(targetDocument, 'issueTableCount');
    var columns = getIssueTableColumns();
    var columnWidths = getIssueTableRenderColumnWidths(columns, targetDocument);
    var colspan = columns.length;
    var customColumnsButton = getIssueTableElement(targetDocument, 'issueTableCustomColumnsButton');

    if (customColumnsButton) {
      customColumnsButton.classList.toggle('active', issueTableState.customColumnMenuOpen || issueTableCustomColumnIds.length > 0);
    }

    if (count) {
      count.textContent = rows.length === total
        ? total + ' issues'
        : rows.length + ' of ' + total + ' issues';
    }

    if (!issues || issues.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + colspan + '">No issues loaded.</td></tr>';
      return;
    }

    if (quickFilteredIssues.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + colspan + '">No issues match the quick filters.</td></tr>';
      return;
    }

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + colspan + '">No issues match the table filters.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(function (issue) {
      var issueId = getIssueId(issue, {}) || '';
      var isActive = issueId && selectedIssueIdForRender && normalise(issueId) === normalise(selectedIssueIdForRender);
      var rowClass = isActive ? ' class="active"' : '';
      var cells = columns.map(function (column) {
        var value = getIssueTableValue(issue, column.key);
        var width = columnWidths[column.key];
        var widthStyle = width ? ' style="width:' + width + 'px; min-width:' + width + 'px;"' : '';

        if (column.key === 'status') {
          return '<td' + widthStyle + '><span class="issueTableStatusPill ' + escapeAttribute(statusClass(value)) + '">' + escapeHtml(value) + '</span></td>';
        }

        if (column.key === 'displayId') {
          return renderIssueTableIdCell(issue, value, widthStyle);
        }

        return '<td' + widthStyle + '><div class="issueTableTextCell issueTableMutedCell" title="' + escapeAttribute(value) + '">' + escapeHtml(value) + '</div></td>';
      }).join('');

      return '<tr data-issue-id="' + escapeAttribute(issueId) + '"' + rowClass + '>' +
        cells +
      '</tr>';
    }).join('');
  }

  function getOpenSavedViewOnSelectSetting() {
    return localStorage.getItem('acc-issue-open-saved-view-on-select') === 'true';
  }

  function setOpenSavedViewOnSelectSetting(value) {
    var enabled = value === true;

    localStorage.setItem('acc-issue-open-saved-view-on-select', String(enabled));

    if (typeof window.accIssuePinsSetOpenSavedViewOnSelect === 'function') {
      enabled = window.accIssuePinsSetOpenSavedViewOnSelect(enabled) === true;
      localStorage.setItem('acc-issue-open-saved-view-on-select', String(enabled));
    }

    syncIssueSelectionModePanel();


    document.dispatchEvent(new CustomEvent('accissueopensavedviewsettingchanged', {
      detail: {
        openSavedViewOnIssueSelect: enabled
      }
    }));

    setStatus(
      enabled
        ? 'Issue selection mode: open saved ACC issue view.'
        : 'Issue selection mode: keep current viewer context.'
    );
  }

  function buildStableIssuePanel() {
    var panel = document.getElementById('issueDetailsPanel');
    if (!panel) return;

    panel.innerHTML = '<div class="accIssuePane"><div id="issuePaneRenderTarget"></div></div>';
    renderIssueDetails();
  }

  function renderIssueField(field, label, valueHtml, editable, editorHtml) {
    var isEditing = activeIssueEditField === field;
    var editButton = editable
      ? '<button class="accIssueIconButton" type="button" data-issue-edit="' + escapeAttribute(field) + '" title="Edit ' + escapeAttribute(label) + '"><span class="glyphicon glyphicon-pencil"></span></button>'
      : '';
    var fieldClass = editable ? 'accIssueField editable' : 'accIssueField';
    var editableAttributes = editable
      ? ' data-issue-field-edit="' + escapeAttribute(field) + '" tabindex="0" role="button"'
      : '';

    if (isEditing) {
      return '' +
        '<div class="accIssueField">' +
          '<label class="accIssueFieldLabel">' + escapeHtml(label) + '</label>' +
          '<div class="accIssueEditor">' +
            (editorHtml || '') +
            '<div class="accIssueEditorActions">' +
              '<button class="accIssueSmallButton" type="button" data-issue-cancel>Cancel</button>' +
              '<button class="accIssueSmallButton primary" type="button" data-issue-save="' + escapeAttribute(field) + '">Save</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    return '' +
      '<div class="' + fieldClass + '"' + editableAttributes + '>' +
        '<label class="accIssueFieldLabel">' + escapeHtml(label) + '</label>' +
        '<div class="accIssueFieldLine">' +
          '<div class="accIssueFieldValue">' + (valueHtml || '-') + '</div>' +
          editButton +
        '</div>' +
      '</div>';
  }

  function getIssuePlacementLabel(issue) {
    var linkedDocuments = Array.isArray(issue?.linkedDocuments) ? issue.linkedDocuments : [];
    var firstDocument = linkedDocuments[0] || null;
    var viewableName =
      firstDocument?.details?.viewable?.name ||
      firstDocument?.name ||
      firstDocument?.displayName ||
      '';

    if (viewableName) return viewableName;
    if (firstDocument?.urn) return firstDocument.urn;

    var placements = Array.isArray(issue?.placements) ? issue.placements : [];
    if (placements.length > 0) return placements.length + ' placement' + (placements.length === 1 ? '' : 's');

    return '-';
  }

  function renderStatusEditor(issue, settings) {
    var currentStatus = getIssueStatus(issue, {});
    var statuses = Array.isArray(issue?.permittedStatuses) && issue.permittedStatuses.length > 0
      ? issue.permittedStatuses
      : settings?.statuses || [];

    return '' +
      '<input id="issueEditor-status" type="hidden" value="' + escapeAttribute(currentStatus) + '">' +
      '<div class="accIssuePicker" data-picker-target="issueEditor-status">' +
        statuses.map(function (status) {
          var selected = normalise(status) === normalise(currentStatus) ? ' selected' : '';

          return '' +
            '<button class="accIssuePickerOption accIssueStatusOption' + selected + '" type="button" data-issue-option-value="' + escapeAttribute(status) + '" data-issue-option-target="issueEditor-status">' +
              '<span class="accIssueStatusHatch ' + escapeAttribute(statusClass(status)) + '"></span>' +
              '<span>' + escapeHtml(formatStatusLabel(status)) + '</span>' +
              '<span class="accIssueOptionCheck glyphicon glyphicon-ok"></span>' +
            '</button>';
        }).join('') +
      '</div>';
  }

  function renderIssueTypeEditor(issue, settings) {
    var currentSubtypeId = getIssueSubtypeId(issue);
    var issueSubtypes = settings?.issueSubtypes || [];
    var lastCategory = null;

    return '' +
      '<input id="issueEditor-issueSubtypeId" type="hidden" value="' + escapeAttribute(currentSubtypeId) + '">' +
      '<div class="accIssuePicker" data-picker-target="issueEditor-issueSubtypeId">' +
        '<div class="accIssuePickerSearch">' +
          '<span class="glyphicon glyphicon-search"></span>' +
          '<input type="search" data-issue-option-search placeholder="Search...">' +
        '</div>' +
        '<div class="accIssuePickerList">' +
          issueSubtypes.map(function (subtype) {
            var category = subtype.categoryName || subtype.issueTypeName || 'Type';
            var groupHeader = '';
            var selected = String(subtype.id) === String(currentSubtypeId) ? ' selected' : '';
            var optionText = [category, subtype.name].join(' ');

            if (category !== lastCategory) {
              lastCategory = category;
              groupHeader = '<div class="accIssuePickerGroup" data-picker-group>' + escapeHtml(category) + '</div>';
            }

            return groupHeader +
              '<button class="accIssuePickerOption accIssueTypeOption' + selected + '" type="button" data-issue-option-value="' + escapeAttribute(subtype.id) + '" data-issue-option-target="issueEditor-issueSubtypeId" data-option-text="' + escapeAttribute(optionText) + '">' +
                renderTypeBadge(subtype.name || category) +
                '<span class="accIssuePickerMain">' + escapeHtml(subtype.name || 'Type') + '</span>' +
                '<span class="accIssueOptionCheck glyphicon glyphicon-ok"></span>' +
              '</button>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  function getAssigneeSubtitle(assignee) {
    var raw = assignee?.raw || {};
    var attributes = raw.attributes || {};
    var typeValue = String(assignee?.type || '').toLowerCase();

    if (typeValue === 'user') {
      return text(
        raw.companyName ||
        raw.company?.name ||
        raw.company?.displayName ||
        attributes.companyName ||
        attributes.company?.name ||
        raw.roleName ||
        raw.role?.name ||
        attributes.roleName ||
        attributes.role?.name ||
        raw.email ||
        attributes.email ||
        '',
        ''
      );
    }

    if (typeValue === 'role') return 'Role';
    if (typeValue === 'company') return 'Company';

    return '';
  }

  function renderAssigneeOption(value, name, type, subtitle, selected) {
    var typeValue = type || 'all';
    var optionText = [name, subtitle, typeValue].join(' ');

    return '' +
      '<button class="accIssuePickerOption accIssueAssigneeOption' + (selected ? ' selected' : '') + '" type="button" data-issue-option-value="' + escapeAttribute(value) + '" data-issue-option-target="issueEditor-assignedTo" data-assignee-type="' + escapeAttribute(typeValue) + '" data-option-text="' + escapeAttribute(optionText) + '">' +
        '<span class="accIssueAssigneeAvatar ' + escapeAttribute(typeValue) + '">' + escapeHtml(getInitials(name, '?')) + '</span>' +
        '<span class="accIssuePickerText">' +
          '<span class="accIssuePickerMain">' + escapeHtml(name) + '</span>' +
          (subtitle ? '<span class="accIssuePickerMeta">' + escapeHtml(subtitle) + '</span>' : '') +
        '</span>' +
        '<span class="accIssueOptionCheck glyphicon glyphicon-ok"></span>' +
      '</button>';
  }

  function renderAssigneeEditor(issue, settings) {
    var currentValue = getAssigneeValue(issue);
    var assignees = settings?.assignees || [];
    var members = assignees.filter(function (assignee) { return assignee.type === 'user'; });
    var roles = assignees.filter(function (assignee) { return assignee.type === 'role'; });
    var companies = assignees.filter(function (assignee) { return assignee.type === 'company'; });

    return '' +
      '<input id="issueEditor-assignedTo" type="hidden" value="' + escapeAttribute(currentValue) + '">' +
      '<div class="accIssuePicker accIssueAssigneePicker" data-picker-target="issueEditor-assignedTo" data-active-assignee-type="all">' +
        '<div class="accIssuePickerSearch">' +
          '<span class="glyphicon glyphicon-search"></span>' +
          '<input type="search" data-issue-option-search placeholder="Search...">' +
        '</div>' +
        '<div class="accIssuePickerTabs">' +
          '<button class="active" type="button" data-assignee-filter="all">All</button>' +
          '<button type="button" data-assignee-filter="user">Members</button>' +
          '<button type="button" data-assignee-filter="role">Roles</button>' +
          '<button type="button" data-assignee-filter="company">Companies</button>' +
        '</div>' +
        '<div class="accIssuePickerList">' +
          '<div class="accIssuePickerGroup" data-picker-group data-assignee-type="user">Members (' + members.length + ')</div>' +
          renderAssigneeOption('', 'Unassigned', 'all', '', currentValue === '') +
          members.map(function (assignee) {
            var value = assignee.type + ':' + assignee.id;
            var name = getAssigneeOptionName(assignee);
            var subtitle = getAssigneeSubtitle(assignee);

            return renderAssigneeOption(value, name, assignee.type, subtitle, String(value) === String(currentValue));
          }).join('') +
          '<div class="accIssuePickerGroup" data-picker-group data-assignee-type="role">Roles (' + roles.length + ')</div>' +
          roles.map(function (assignee) {
            var value = assignee.type + ':' + assignee.id;
            var name = getAssigneeOptionName(assignee);
            var subtitle = getAssigneeSubtitle(assignee);

            return renderAssigneeOption(value, name, assignee.type, subtitle, String(value) === String(currentValue));
          }).join('') +
          '<div class="accIssuePickerGroup" data-picker-group data-assignee-type="company">Companies (' + companies.length + ')</div>' +
          companies.map(function (assignee) {
            var value = assignee.type + ':' + assignee.id;
            var name = getAssigneeOptionName(assignee);
            var subtitle = getAssigneeSubtitle(assignee);

            return renderAssigneeOption(value, name, assignee.type, subtitle, String(value) === String(currentValue));
          }).join('') +
        '</div>' +
      '</div>';
  }

  function renderIssueEditor(field, issue, settings) {
    if (field === 'title') {
      return '<input id="issueEditor-title" type="text" value="' + escapeAttribute(getIssueTitle(issue, {})) + '">';
    }

    if (field === 'description') {
      return '<textarea id="issueEditor-description">' + escapeHtml(issue?.description || '') + '</textarea>';
    }

    if (field === 'status') {
      return renderStatusEditor(issue, settings);
    }

    if (field === 'issueSubtypeId') {
      return renderIssueTypeEditor(issue, settings);
    }

    if (field === 'assignedTo') {
      return renderAssigneeEditor(issue, settings);
    }

    if (field === 'rootCauseId') {
      return '<select id="issueEditor-rootCauseId">' +
        buildSelectOptions((settings?.rootCauses || []).map(function (rootCause) {
          return {
            value: rootCause.id,
            label: (rootCause.categoryName ? rootCause.categoryName + ' > ' : '') + rootCause.name
          };
        }), getRootCauseId(issue), 'Unspecified') +
        '</select>';
    }

    if (field === 'dueDate' || field === 'startDate') {
      var dateValue = field === 'dueDate' ? getDueDate(issue) : getStartDate(issue);
      return '<input id="issueEditor-' + field + '" type="date" value="' + escapeAttribute(toDateInputValue(dateValue)) + '">';
    }

    if (field.startsWith('customAttribute:')) {
      var attributeDefinitionId = field.split(':')[1];
      var attribute = getIssueCustomAttribute(issue, attributeDefinitionId) || { attributeDefinitionId: attributeDefinitionId, value: '' };
      var definition = getCustomAttributeDefinition(settings, attributeDefinitionId);
      return renderCustomAttributeEditor(attribute, definition);
    }

    return '';
  }

  function renderIssueThumbnail(issue) {
    var thumbnailUrl = getIssueThumbnailUrl(issue);

    if (!thumbnailUrl) {
      return '<div class="accIssueThumbnail"><span class="accIssueThumbnailFallback">Issue thumbnail unavailable</span></div>';
    }

    return '' +
      '<div class="accIssueThumbnail has-image">' +
        '<img class="accIssueThumbnailImage" src="' + escapeAttribute(thumbnailUrl) + '" alt="Issue thumbnail" loading="lazy">' +
        '<span class="accIssueThumbnailFallback">Issue thumbnail unavailable</span>' +
      '</div>';
  }

  function renderIssueReferences(issue) {
    var explicitReferences = getIssueReferences(issue);
    var seen = new Set();
    var references = explicitReferences
      .map(function (reference) {
        var url = getReferenceUrl(reference, issue);
        var label = getReferenceLabel(reference);
        var key = url || label;

        if (!key || seen.has(key)) return null;
        seen.add(key);

        return {
          url: url,
          label: label
        };
      })
      .filter(function (reference) {
        return reference && reference.url;
      });

    return '' +
      '<div class="accIssueReferences">' +
        '<div class="accIssueSectionTitle">' +
          '<span>References (' + references.length + ')</span>' +
        '</div>' +
        (references.length
          ? references.map(function (reference) {
            return '<a class="accIssueReferenceLink" href="' + escapeAttribute(reference.url) + '" target="_blank" rel="noopener noreferrer">' +
              '<span class="glyphicon glyphicon-new-window"></span>' +
              '<span>' + escapeHtml(reference.label) + '</span>' +
            '</a>';
          }).join('')
          : '<div class="accIssueMuted">No references.</div>') +
      '</div>';
  }

  function renderIssueComments(issue) {
    var canComment = canUseIssueAction(issue, 'add_comment');
    var comments = currentIssueComments || [];
    var profile = issueSettingsCache?.userProfile || {};
    var currentUserName = getDisplayName(profile, 'SS');

    return '' +
      '<div class="accIssueComments">' +
        '<div class="accIssueSectionTitle">' +
          '<span>Comments</span>' +
          '<span class="accIssueCommentCount">Showing ' + comments.length + ' of ' + comments.length + '</span>' +
        '</div>' +
        (comments.length
          ? comments.map(function (comment) {
            var authorName = getCommentAuthorName(comment);
            var createdAt = comment.createdAt || comment.clientCreatedAt || comment.updatedAt;

            return '' +
              '<div class="accIssueComment">' +
                '<div class="accIssueCommentHeader">' +
                  '<span class="accIssueCommentAvatar">' + escapeHtml(getInitials(authorName, 'U')) + '</span>' +
                  '<span class="accIssueCommentAuthor">' + escapeHtml(authorName) + '</span>' +
                  '<span class="accIssueCommentTime">' + escapeHtml(formatRelativeTime(createdAt)) + '</span>' +
                '</div>' +
                '<div class="accIssueCommentBody">' + escapeHtml(getCommentBody(comment)) + '</div>' +
              '</div>';
          }).join('')
          : '<div class="accIssueMuted">No comments.</div>') +
        '<div class="accIssueCommentForm">' +
          '<span class="accIssueComposerAvatar">' + escapeHtml(getInitials(currentUserName, 'U')) + '</span>' +
          '<div class="accIssueCommentEditor">' +
            '<textarea id="issueCommentBody" ' + (canComment ? '' : 'disabled') + ' placeholder="Add a comment. Use @ to mention a user, role, or company."></textarea>' +
            '<div id="issueCommentMentionPopup" class="accIssueMentionPopup" hidden></div>' +
          '</div>' +
          '<button id="issueCommentSubmit" class="accIssueSmallButton primary" type="button" ' + (canComment ? '' : 'disabled') + '>Post</button>' +
        '</div>' +
      '</div>';
  }

  function getCommentMentionQuery(textarea) {
    if (!textarea) return null;

    var cursor = textarea.selectionStart || 0;
    var textBeforeCursor = textarea.value.substring(0, cursor);
    var match = textBeforeCursor.match(/(^|\s)@([^\s@]*)$/);

    if (!match) return null;

    return {
      start: cursor - match[2].length - 1,
      end: cursor,
      text: match[2] || ''
    };
  }

  function getCommentMentionOptions(searchText) {
    var search = normalise(searchText);
    var assignees = issueSettingsCache?.assignees || [];

    return assignees.filter(function (assignee) {
      var name = assignee?.name || '';
      if (!name) return false;
      if (!search) return true;

      return normalise(name).includes(search);
    }).slice(0, 40);
  }

  function getMentionGroupLabel(type) {
    if (type === 'user') return 'Members';
    if (type === 'role') return 'Roles';
    if (type === 'company') return 'Companies';

    return 'Other';
  }

  function renderCommentMentionOptions(options) {
    var groups = ['user', 'role', 'company'];
    var html = '';

    groups.forEach(function (type) {
      var groupOptions = options.filter(function (option) {
        return option.type === type;
      });

      if (!groupOptions.length) return;

      html += '<div class="accIssueMentionGroup">' + escapeHtml(getMentionGroupLabel(type)) + '</div>';
      html += groupOptions.map(function (option) {
        var name = option.name || '';

        return '' +
          '<button class="accIssueMentionOption" type="button" data-comment-mention-value="' + escapeAttribute(name) + '">' +
            '<span class="accIssueAssigneeAvatar ' + escapeAttribute(option.type || '') + '">' + escapeHtml(getInitials(name, '?')) + '</span>' +
            '<span class="accIssueMentionName">' + escapeHtml(name) + '</span>' +
            '<span class="accIssueMentionType">' + escapeHtml(option.label || getMentionGroupLabel(option.type)) + '</span>' +
          '</button>';
      }).join('');
    });

    return html || '<div class="accIssueMentionEmpty">No matching users, roles, or companies.</div>';
  }

  function updateCommentMentionPopup(textarea) {
    var popup = document.getElementById('issueCommentMentionPopup');
    var query = getCommentMentionQuery(textarea);

    if (!popup || !query) {
      hideCommentMentionPopup();
      return;
    }

    var options = getCommentMentionOptions(query.text);

    popup.innerHTML = renderCommentMentionOptions(options);
    popup.hidden = false;
  }

  function hideCommentMentionPopup() {
    var popup = document.getElementById('issueCommentMentionPopup');
    if (!popup) return;

    popup.hidden = true;
    popup.innerHTML = '';
  }

  function insertCommentMention(optionButton) {
    var textarea = document.getElementById('issueCommentBody');
    var name = optionButton?.getAttribute('data-comment-mention-value') || '';
    var query = getCommentMentionQuery(textarea);

    if (!textarea || !name || !query) return;

    var before = textarea.value.substring(0, query.start);
    var after = textarea.value.substring(query.end);
    var mentionText = '@' + name + ' ';

    textarea.value = before + mentionText + after;
    textarea.focus();
    textarea.setSelectionRange((before + mentionText).length, (before + mentionText).length);
    hideCommentMentionPopup();
  }

  function renderIssueDetailsBody(issue, settings) {
    var customFields = getCustomAttributeDefinitionsForIssue(issue, settings).map(function (definition) {
      var attribute = getIssueCustomAttribute(issue, definition.id) || { attributeDefinitionId: definition.id, value: '' };
      var label = getCustomAttributeLabel(attribute, settings);
      var fieldName = getCustomAttributeColumnKey(definition.id);

      return renderIssueField(
        fieldName,
        label,
        escapeHtml(getCustomAttributeDisplayValue(attribute, settings, definition)),
        canEditIssueAttribute(issue, 'customAttributes'),
        renderIssueEditor(fieldName, issue, settings)
      );
    }).join('');

    return '' +
      renderIssueThumbnail(issue) +
      renderIssueField('title', 'Title', escapeHtml(getIssueTitle(issue, {})), canEditIssueAttribute(issue, 'title'), renderIssueEditor('title', issue, settings)) +
      renderIssueField('status', 'Status', '<span class="accIssueStatusValue"><span class="accIssueStatusBar ' + statusClass(getIssueStatus(issue, {})) + '"></span>' + escapeHtml(formatStatusLabel(getIssueStatus(issue, {}))) + '</span>', canEditIssueAttribute(issue, 'status'), renderIssueEditor('status', issue, settings)) +
      renderIssueField('issueSubtypeId', 'Type', getIssueTypeValueHtml(issue), canEditIssueAttribute(issue, 'issueSubtypeId'), renderIssueEditor('issueSubtypeId', issue, settings)) +
      renderIssueField('description', 'Description', escapeHtml(issue?.description || 'Unspecified'), canEditIssueAttribute(issue, 'description'), renderIssueEditor('description', issue, settings)) +
      renderIssueField('assignedTo', 'Assigned to', escapeHtml(getAssignedTo(issue, {})), canEditIssueAttribute(issue, 'assignedTo'), renderIssueEditor('assignedTo', issue, settings)) +
      renderIssueField('dueDate', 'Due date', escapeHtml(formatIssueDate(getDueDate(issue))), canEditIssueAttribute(issue, 'dueDate'), renderIssueEditor('dueDate', issue, settings)) +
      renderIssueField('startDate', 'Start date', escapeHtml(formatIssueDate(getStartDate(issue))), canEditIssueAttribute(issue, 'startDate'), renderIssueEditor('startDate', issue, settings)) +
      renderIssueField('placement', 'Placement', escapeHtml(getIssuePlacementLabel(issue)), false, '') +
      renderIssueField('rootCauseId', 'Root cause', escapeHtml(getRootCause(issue)), canEditIssueAttribute(issue, 'rootCauseId'), renderIssueEditor('rootCauseId', issue, settings)) +
      customFields +
      renderIssueReferences(issue) +
      renderIssueComments(issue);
  }

  function renderIssueActivityBody(issue) {
    return '' +
      renderIssueField('createdBy', 'Created by', escapeHtml(getOpenedBy(issue)), false, '') +
      renderIssueField('createdAt', 'Created', escapeHtml(formatDate(getCreatedAt(issue))), false, '') +
      renderIssueField('updatedBy', 'Updated by', escapeHtml(getUpdatedBy(issue)), false, '') +
      renderIssueField('updatedAt', 'Updated', escapeHtml(formatDate(getUpdatedAt(issue))), false, '') +
      renderIssueComments(issue);
  }

  function renderIssueDetails() {
    var target = document.getElementById('issuePaneRenderTarget');
    if (!target) return;

    var issue = currentIssueDetail?.issue || null;

    if (!issue) {
      target.innerHTML = '' +
        '<div class="accIssueHeader">' +
          '<h2>Issue</h2>' +
          '<button id="closeIssueDetails" class="accIssueClose" type="button" title="Close">x</button>' +
        '</div>' +
        '<div id="issueDetailsEmpty" class="stableIssueEmpty">Select an issue pin in the viewer to review the issue information here.</div>';
      return;
    }

    var settings = issueSettingsCache || {};
    var displayId = getIssueDisplayId(issue, currentIssueDetail?.summary || {});
    var issueOpenUrl = getIssueOpenUrl(issue);

    target.innerHTML = '' +
      '<div class="accIssueHeader">' +
        '<h2>Issue #' + escapeHtml(displayId) + '</h2>' +
        '<button id="closeIssueDetails" class="accIssueClose" type="button" title="Close">x</button>' +
      '</div>' +
      '<div class="accIssueTabs">' +
        '<button class="accIssueTab ' + (currentIssueTab === 'details' ? 'active' : '') + '" type="button" data-issue-tab="details">Details</button>' +
        '<button class="accIssueTab ' + (currentIssueTab === 'activity' ? 'active' : '') + '" type="button" data-issue-tab="activity">Activity log</button>' +
      '</div>' +
      '<div class="accIssueActions">' +
        (issueOpenUrl
          ? '<a class="accIssueActionLink" href="' + escapeAttribute(issueOpenUrl) + '" target="_blank" rel="noopener noreferrer"><span class="glyphicon glyphicon-new-window"></span><span>Open issue on Forma</span></a>'
          : '<span class="accIssueMuted">Issue link unavailable.</span>') +
      '</div>' +
      '<div id="issueDetailsContent" class="accIssueBody">' +
        (currentIssueTab === 'activity' ? renderIssueActivityBody(issue) : renderIssueDetailsBody(issue, settings)) +
      '</div>';
  }

  function clearIssueDetails() {
    currentIssueDetail = null;
    activeIssueEditField = null;
    currentIssueTab = 'details';
    currentIssueComments = [];
    renderIssueDetails();
  }

  function showIssueDetails(detail) {
    currentIssueDetail = detail || {};
    activeIssueEditField = null;
    currentIssueTab = 'details';
    currentIssueComments = [];

    var summary = detail?.summary || {};
    var issue = detail?.issue || {};
    var displayId = getIssueDisplayId(issue, summary);
    var title = getIssueTitle(issue, summary);

    renderIssueDetails();
    setStatus('Selected issue #' + displayId + ': ' + title);

    loadIssueSettings()
      .then(function () {
        renderIssueDetails();
      })
      .catch(function (error) {
        console.warn(error);
        setStatus('Issue settings could not be loaded: ' + error.message);
      });

    loadCurrentIssueSideData(issue);
  }

  function buildCurrentIssueUpdatePayload(field) {
    var issue = currentIssueDetail?.issue || {};

    if (field === 'title') {
      var title = document.getElementById('issueEditor-title')?.value?.trim() || '';
      if (!title) throw new Error('Title cannot be empty.');
      return { title: title };
    }

    if (field === 'description') {
      return {
        description: document.getElementById('issueEditor-description')?.value || ''
      };
    }

    if (field === 'status') {
      return {
        status: document.getElementById('issueEditor-status')?.value || null
      };
    }

    if (field === 'issueSubtypeId') {
      var subtypeId = document.getElementById('issueEditor-issueSubtypeId')?.value || null;

      return {
        issueSubtypeId: subtypeId
      };
    }

    if (field === 'assignedTo') {
      var assigneeValue = document.getElementById('issueEditor-assignedTo')?.value || '';

      if (!assigneeValue) {
        return {
          assignedTo: null,
          assignedToType: null
        };
      }

      var assigneeParts = assigneeValue.split(':');

      return {
        assignedToType: assigneeParts[0] || null,
        assignedTo: assigneeParts.slice(1).join(':') || null
      };
    }

    if (field === 'rootCauseId') {
      return {
        rootCauseId: document.getElementById('issueEditor-rootCauseId')?.value || null
      };
    }

    if (field === 'dueDate' || field === 'startDate') {
      var dateValue = document.getElementById('issueEditor-' + field)?.value || null;
      var payload = {};
      payload[field] = dateValue;
      return payload;
    }

    if (field.startsWith('customAttribute:')) {
      var attributeDefinitionId = field.split(':')[1];
      var value = document.getElementById('issueEditor-customAttribute')?.value || null;
      var customAttributes = getIssueCustomAttributes(issue).map(function (attribute) {
        var currentDefinitionId = getIssueCustomAttributeDefinitionId(attribute);

        return {
          attributeDefinitionId: currentDefinitionId,
          value: String(currentDefinitionId) === String(attributeDefinitionId)
            ? value
            : attribute.value
        };
      });

      if (!customAttributes.some(function (attribute) {
        return String(attribute.attributeDefinitionId) === String(attributeDefinitionId);
      })) {
        customAttributes.push({
          attributeDefinitionId: attributeDefinitionId,
          value: value
        });
      }

      return {
        customAttributes: customAttributes
      };
    }

    return {};
  }

  function getIssueApiErrorMessage(body, fallback) {
    var detailMessages = Array.isArray(body?.details?.details)
      ? body.details.details.map(function (detail) {
        return detail.message || detail.developerMessage || detail.title || '';
      }).filter(Boolean)
      : [];

    return (
      body?.error ||
      body?.details?.developerMessage ||
      body?.details?.title ||
      detailMessages.join(' ') ||
      fallback
    );
  }

  function getIssueTablePopoutHtml() {
    return '<!DOCTYPE html>' +
      '<html>' +
        '<head>' +
          '<title>Project issues</title>' +
          '<meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width, initial-scale=1">' +
          '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/3.4.1/css/bootstrap.min.css">' +
          '<link rel="stylesheet" href="' + window.location.origin + '/css/main.css">' +
          '<link rel="stylesheet" href="' + window.location.origin + '/css/issue-panel.css">' +
        '</head>' +
        '<body class="issueTablePopoutBody">' +
          '<section id="issueTablePanel" class="issueTablePanel issueTablePanelPopout">' +
            '<div class="issueTableHeader">' +
              '<span>Project issues</span>' +
              '<div class="issueTableHeaderActions">' +
                '<span id="issueTableCount" class="issueTableCount">No issues</span>' +
                '<button id="issueTableRefreshButton" class="issueTableHeaderButton" type="button" title="Refresh issues from ACC/Forma">' +
                  '<span class="glyphicon glyphicon-refresh"></span>' +
                '</button>' +
                getIssueTablePopoutButtonHtml() +
                '<button id="issueTableCustomColumnsButton" class="issueTableHeaderButton" type="button" title="Choose custom attribute columns">' +
                  '<span class="glyphicon glyphicon-cog"></span>' +
                '</button>' +
              '</div>' +
            '</div>' +
            '<div id="issueTableCustomColumnsMenu" class="issueTableCustomColumnsMenu" hidden></div>' +
            '<div id="issueTableColumnMenu" class="issueTableColumnMenu" hidden></div>' +
            '<div class="issueTableWrapper"><table class="issueTable"><thead><tr id="issueTableHead"></tr></thead><tbody id="issueTableBody"><tr><td colspan="6">No issues loaded.</td></tr></tbody></table></div>' +
          '</section>' +
        '</body>' +
      '</html>';
  }

  function toggleIssueTablePopout() {
    if (isIssueTablePoppedOut()) {
      dockIssueTablePopout();
      return;
    }

    openIssueTablePopout();
  }

  function openIssueTablePopout() {
    var popoutWidth = getIssueTablePopoutDefaultWidth();
    var popoutHeight = getIssueTablePopoutDefaultHeight();
    var left = Math.max(40, Math.round(((window.screen?.availWidth || popoutWidth) - popoutWidth) / 2));
    var top = Math.max(40, Math.round(((window.screen?.availHeight || popoutHeight) - popoutHeight) / 2));
    var features = 'popup=yes,width=' + popoutWidth + ',height=' + popoutHeight + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes';
    var childWindow = window.open('', 'hksProjectIssuesTable', features);

    if (!childWindow) {
      setStatus('Pop-up was blocked. Allow pop-ups for this app to use the issue table window.');
      return;
    }

    issueTablePopoutWindow = childWindow;
    childWindow.document.open();
    childWindow.document.write(getIssueTablePopoutHtml());
    childWindow.document.close();

    bindIssueTableEvents(childWindow.document);
    childWindow.addEventListener('beforeunload', function () {
      issueTablePopoutWindow = null;
      syncIssueTablePopoutButtons();
    });

    renderIssueTable(loadedIssues, selectedIssueTableId);
    childWindow.focus();
    setStatus('Project issue table opened in a separate window.');
  }

  function getIssueTablePopoutDefaultWidth() {
    var columns = getIssueTableColumns();
    var preferredWidth = columns.reduce(function (sum, column) {
      return sum + getPreferredIssueTableColumnWidth(column);
    }, 0) + 48;
    var availableWidth = window.screen?.availWidth || 1200;

    return Math.round(Math.min(Math.max(980, preferredWidth), Math.max(980, availableWidth - 90)));
  }

  function getIssueTablePopoutDefaultHeight() {
    var availableHeight = window.screen?.availHeight || 760;
    return Math.round(Math.min(760, Math.max(620, availableHeight - 120)));
  }

  function dockIssueTablePopout() {
    if (issueTablePopoutWindow && !issueTablePopoutWindow.closed) {
      issueTablePopoutWindow.close();
    }

    issueTablePopoutWindow = null;
    renderIssueTable(loadedIssues, selectedIssueTableId);
    setStatus('Project issue table docked back in the main window.');
  }

  function handleIssueTableClick(event) {
    var issueTableColumnButton = event.target?.closest?.('[data-issue-table-column]');
    if (issueTableColumnButton) {
      event.preventDefault();
      var columnKey = issueTableColumnButton.getAttribute('data-issue-table-column') || '';
      issueTableState.openColumnKey = issueTableState.openColumnKey === columnKey ? '' : columnKey;
      issueTableState.searchText = '';
      renderIssueTable(loadedIssues, selectedIssueTableId);
      return true;
    }

    if (event.target?.closest?.('#issueTableRefreshButton')) {
      event.preventDefault();
      refreshIssuesFromAcc();
      return true;
    }

    if (event.target?.closest?.('#issueTablePopoutButton')) {
      event.preventDefault();
      toggleIssueTablePopout();
      return true;
    }

    var issueTableMenuAction = event.target?.closest?.('[data-issue-table-action]');
    if (issueTableMenuAction) {
      event.preventDefault();
      var menu = issueTableMenuAction.closest('#issueTableColumnMenu');
      var menuKey = menu ? menu.getAttribute('data-issue-table-menu-key') : issueTableState.openColumnKey;
      handleIssueTableMenuAction(issueTableMenuAction.getAttribute('data-issue-table-action'), menuKey);
      renderIssueTable(loadedIssues, selectedIssueTableId);
      return true;
    }

    var issueTableFilterValue = event.target?.closest?.('[data-issue-table-filter-value]');
    if (issueTableFilterValue) {
      var filterMenu = issueTableFilterValue.closest('#issueTableColumnMenu');
      var filterKey = filterMenu ? filterMenu.getAttribute('data-issue-table-menu-key') : issueTableState.openColumnKey;
      setIssueTableFilterValue(filterKey, issueTableFilterValue.value, issueTableFilterValue.checked);
      renderIssueTable(loadedIssues, selectedIssueTableId);
      return true;
    }

    var customColumnsButton = event.target?.closest?.('#issueTableCustomColumnsButton');
    if (customColumnsButton) {
      event.preventDefault();
      issueTableState.customColumnMenuOpen = !issueTableState.customColumnMenuOpen;
      issueTableState.openColumnKey = '';
      renderIssueTable(loadedIssues, selectedIssueTableId);
      return true;
    }

    var customColumnsClose = event.target?.closest?.('[data-issue-custom-columns-close]');
    if (customColumnsClose) {
      event.preventDefault();
      issueTableState.customColumnMenuOpen = false;
      renderIssueTable(loadedIssues, selectedIssueTableId);
      return true;
    }

    var customColumnToggle = event.target?.closest?.('[data-issue-custom-column-toggle]');
    if (customColumnToggle) {
      setIssueTableCustomColumn(customColumnToggle.value, customColumnToggle.checked);
      renderIssueTable(loadedIssues, selectedIssueTableId);
      return true;
    }

    if (
      issueTableState.openColumnKey &&
      !event.target?.closest?.('#issueTableColumnMenu') &&
      !event.target?.closest?.('[data-issue-table-column]')
    ) {
      issueTableState.openColumnKey = '';
      issueTableState.searchText = '';
      renderIssueTable(loadedIssues, selectedIssueTableId);
      return true;
    }

    if (
      issueTableState.customColumnMenuOpen &&
      !event.target?.closest?.('#issueTableCustomColumnsMenu') &&
      !event.target?.closest?.('#issueTableCustomColumnsButton')
    ) {
      issueTableState.customColumnMenuOpen = false;
      renderIssueTable(loadedIssues, selectedIssueTableId);
      return true;
    }

    var row = event.target?.closest?.('#issueTableBody tr[data-issue-id]');
    if (row) {
      var issueId = row.getAttribute('data-issue-id');
      if (issueId) {
        selectedIssueTableId = issueId;
        renderIssueTable(loadedIssues, selectedIssueTableId);
        document.dispatchEvent(new CustomEvent('accissuetableselect', {
          detail: {
            issueId: issueId,
            openSavedView: getOpenSavedViewOnSelectSetting()
          }
        }));
      }

      return true;
    }

    return false;
  }

  function handleIssueTableInput(event) {
    var targetDocument = event.target?.ownerDocument || document;

    if (event.target && event.target.id === 'issueTableFilterSearch') {
      issueTableState.searchText = event.target.value || '';
      renderIssueTableColumnMenu(targetDocument);
      var searchInput = getIssueTableElement(targetDocument, 'issueTableFilterSearch');
      if (searchInput) {
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }
      return true;
    }

    if (event.target?.matches?.('[data-issue-table-text-filter]')) {
      var textMenu = event.target.closest('#issueTableColumnMenu');
      var textKey = textMenu ? textMenu.getAttribute('data-issue-table-menu-key') : issueTableState.openColumnKey;
      setIssueTableTextFilter(textKey, event.target.value);
      renderIssueTable(loadedIssues, selectedIssueTableId);
      var textInput = targetDocument.querySelector('[data-issue-table-text-filter]');
      if (textInput) {
        textInput.focus();
        textInput.setSelectionRange(textInput.value.length, textInput.value.length);
      }
      return true;
    }

    return false;
  }

  function handleIssueTableChange(event) {
    if (event.target?.matches?.('[data-issue-table-date-filter]')) {
      var dateMenu = event.target.closest('#issueTableColumnMenu');
      var dateKey = dateMenu ? dateMenu.getAttribute('data-issue-table-menu-key') : issueTableState.openColumnKey;
      setIssueTableDateFilter(dateKey, event.target.getAttribute('data-issue-table-date-filter'), event.target.value);
      renderIssueTable(loadedIssues, selectedIssueTableId);
      return true;
    }

    if (event.target?.matches?.('[data-issue-table-number-filter]')) {
      var numberMenu = event.target.closest('#issueTableColumnMenu');
      var numberKey = numberMenu ? numberMenu.getAttribute('data-issue-table-menu-key') : issueTableState.openColumnKey;
      setIssueTableNumberFilter(numberKey, event.target.getAttribute('data-issue-table-number-filter'), event.target.value);
      renderIssueTable(loadedIssues, selectedIssueTableId);
      return true;
    }

    return false;
  }

  function handleIssueTablePointerDown(event) {
    var resizeHandle = event.target?.closest?.('[data-issue-table-resize]');
    var dragHandle = event.target?.closest?.('[data-issue-table-drag]');

    if (!resizeHandle && !dragHandle) return false;

    event.preventDefault();
    event.stopPropagation();

    if (dragHandle) {
      var draggedColumnKey = dragHandle.getAttribute('data-issue-table-drag');
      if (!draggedColumnKey) return true;

      issueTableState.draggingColumn = {
        key: draggedColumnKey,
        document: event.target.ownerDocument || document
      };

      document.body.classList.add('dragging-issue-table-column');
      event.target.ownerDocument?.body?.classList.add('dragging-issue-table-column');
      return true;
    }

    var columnKey = resizeHandle.getAttribute('data-issue-table-resize');
    var header = resizeHandle.closest('th');

    if (!columnKey || !header) return true;

    issueTableState.resizingColumn = {
      key: columnKey,
      startX: event.clientX,
      startWidth: header.getBoundingClientRect().width,
      document: event.target.ownerDocument || document
    };

    document.body.classList.add('resizing-issue-table-column');
    event.target.ownerDocument?.body?.classList.add('resizing-issue-table-column');
    return true;
  }

  function handleIssueTablePointerMove(event) {
    var resizeInfo = issueTableState.resizingColumn;
    var dragInfo = issueTableState.draggingColumn;

    if (resizeInfo) {
      var nextWidth = resizeInfo.startWidth + (event.clientX - resizeInfo.startX);
      setIssueTableColumnWidth(resizeInfo.key, nextWidth);
      renderIssueTable(loadedIssues, selectedIssueTableId);
      return true;
    }

    if (!dragInfo) return false;

    var targetDocument = dragInfo.document || event.target?.ownerDocument || document;
    var elementUnderPointer = targetDocument.elementFromPoint(event.clientX, event.clientY);
    var targetHeader = elementUnderPointer?.closest?.('[data-issue-table-header]');
    var targetColumnKey = targetHeader ? targetHeader.getAttribute('data-issue-table-header') : '';
    var targetRect = targetHeader ? targetHeader.getBoundingClientRect() : null;
    var placeAfterTarget = targetRect
      ? event.clientX > targetRect.left + (targetRect.width / 2)
      : false;

    if (moveIssueTableColumn(dragInfo.key, targetColumnKey, placeAfterTarget)) {
      renderIssueTable(loadedIssues, selectedIssueTableId);
    }

    return true;
  }

  function handleIssueTablePointerUp() {
    if (!issueTableState.resizingColumn && !issueTableState.draggingColumn) return false;

    var activeDocument =
      issueTableState.resizingColumn?.document ||
      issueTableState.draggingColumn?.document ||
      document;

    issueTableState.resizingColumn = null;
    issueTableState.draggingColumn = null;
    document.body.classList.remove('resizing-issue-table-column');
    document.body.classList.remove('dragging-issue-table-column');
    activeDocument?.body?.classList.remove('resizing-issue-table-column');
    activeDocument?.body?.classList.remove('dragging-issue-table-column');
    return true;
  }

  function bindIssueTableEvents(targetDocument) {
    if (!targetDocument || targetDocument.__issueTableEventsBound) return;

    targetDocument.addEventListener('click', function (event) {
      handleIssueTableClick(event);
    });

    targetDocument.addEventListener('pointerdown', function (event) {
      handleIssueTablePointerDown(event);
    });

    targetDocument.addEventListener('pointermove', function (event) {
      handleIssueTablePointerMove(event);
    });

    targetDocument.addEventListener('pointerup', function () {
      handleIssueTablePointerUp();
    });

    targetDocument.addEventListener('input', function (event) {
      handleIssueTableInput(event);
    });

    targetDocument.addEventListener('change', function (event) {
      handleIssueTableChange(event);
    });

    targetDocument.__issueTableEventsBound = true;
  }

  async function saveCurrentIssueField(field) {
    try {
      setStatus('Saving issue...');
      var payload = buildCurrentIssueUpdatePayload(field);
      var updatedIssue = await patchCurrentIssue(payload);

      activeIssueEditField = null;
      renderIssueDetails();
      setStatus('Issue #' + getIssueDisplayId(updatedIssue, {}) + ' updated.');
    } catch (error) {
      console.warn(error);
      setStatus('Could not update issue: ' + error.message);
    }
  }

  async function submitIssueComment() {
    var issue = currentIssueDetail?.issue || {};
    var issueId = getIssueId(issue, currentIssueDetail?.summary || {});
    var url = issueApiUrl(issueId, '/comments');
    var textarea = document.getElementById('issueCommentBody');
    var commentBody = textarea?.value?.trim() || '';

    if (!commentBody) {
      setStatus('Comment text is required.');
      return;
    }

    try {
      setStatus('Posting comment...');

      var response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          body: commentBody
        })
      });

      var body = await response.json().catch(function () { return null; });

      if (!response.ok) {
        throw new Error(body?.error || 'Comment failed: ' + response.status);
      }

      if (textarea) textarea.value = '';
      currentIssueComments.push(body?.data || body);
      renderIssueDetails();
      try {
        await refreshCurrentIssueFromAcc();
      } catch (refreshError) {
        console.warn(refreshError);
      }
      setStatus('Comment added.');
    } catch (error) {
      console.warn(error);
      setStatus('Could not add comment: ' + error.message);
    }
  }

  function getFilterOptionDataFromIssues(issues) {
    return {
      types: uniqueValues(issues.map(function (issue) {
        return getIssueQuickFilterType(issue);
      })),
      assignedTo: uniqueValues(issues.map(function (issue) {
        return getAssignedTo(issue, {});
      }))
    };
  }

  function populateSelect(selectId, values, placeholder) {
    var select = document.getElementById(selectId);
    if (!select) return;

    var currentValue = select.value;

    select.innerHTML = '';

    var placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = placeholder;
    select.appendChild(placeholderOption);

    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });

    if (values.includes(currentValue)) {
      select.value = currentValue;
    }
  }

  function populateIssueTypeQuickFilter(values) {
    var buttonLabel = document.getElementById('issueTypeFilterLabel');
    var input = document.getElementById('issueTypeFilter');
    var menu = document.getElementById('issueTypeFilterMenu');

    if (!input || !menu || !buttonLabel) return;

    var currentValue = input.value;
    var options = values || [];

    menu.innerHTML =
      '<button class="issueTypeFilterOption" type="button" data-issue-type-filter-value="">' +
        '<span class="issueTypeFilterOptionText">Select a type</span>' +
      '</button>' +
      options.map(function (value) {
        var selected = String(value) === String(currentValue) ? ' selected' : '';

        return '<button class="issueTypeFilterOption' + selected + '" type="button" data-issue-type-filter-value="' + escapeAttribute(value) + '">' +
          getIssueQuickFilterTypeHtml(value) +
        '</button>';
      }).join('');

    if (!options.includes(currentValue)) {
      input.value = '';
      currentValue = '';
    }

    buttonLabel.innerHTML = currentValue
      ? getIssueQuickFilterTypeHtml(currentValue)
      : 'Select a type';
  }

  function updateIssueFilterOptions(issues) {
    buildIssueFilterPanel();

    var data = getFilterOptionDataFromIssues(issues || []);

    populateIssueTypeQuickFilter(data.types);
    populateSelect('issueAssignedToFilter', data.assignedTo, 'Select a member, role, or company');

    var summary = document.getElementById('issueFilterSummary');
    if (summary) {
      summary.textContent = 'Loaded ' + (issues || []).length + ' issues. Quick filters update pins and the table.';
    }

    applyIssueFilters();
  }

  function readIssueFiltersFromUi() {
    var type = document.getElementById('issueTypeFilter')?.value || '';
    var assignedTo = document.getElementById('issueAssignedToFilter')?.value || '';

    var statuses = Array.from(document.querySelectorAll('.issueStatusChip.active'))
      .map(function (button) {
        return button.getAttribute('data-status');
      })
      .filter(Boolean);

    currentIssueFilters = {
      type: type,
      statuses: statuses,
      assignedTo: assignedTo
    };

    return currentIssueFilters;
  }

  function issueMatchesQuickFilters(issue, filters) {
    var activeFilters = filters || currentIssueFilters || {};
    var status = normaliseIssueStatusFilter(getIssueStatus(issue, {}));
    var type = normalise(getIssueQuickFilterType(issue));
    var assignedTo = normalise(getAssignedTo(issue, {}));
    var statuses = activeFilters.statuses || [];

    if (statuses.length > 0) {
      var normalisedStatuses = statuses.map(normaliseIssueStatusFilter);
      if (!normalisedStatuses.includes(status)) return false;
    } else {
      return false;
    }

    if (activeFilters.type && type !== normalise(activeFilters.type)) return false;
    if (activeFilters.assignedTo && assignedTo !== normalise(activeFilters.assignedTo)) return false;

    return true;
  }

  function normaliseIssueStatusFilter(value) {
    return normalise(value).replace(/_/g, ' ');
  }

  function getQuickFilteredIssues(issues) {
    return (issues || []).filter(function (issue) {
      return issueMatchesQuickFilters(issue, currentIssueFilters);
    });
  }

  function applyIssueFilters() {
    var filters = readIssueFiltersFromUi();
    var matchingIssueIds = getQuickFilteredIssues(loadedIssues).map(function (issue) {
      return getIssueId(issue, {});
    }).filter(Boolean);

    document.dispatchEvent(new CustomEvent('accissuefilterschanged', {
      detail: {
        filters: filters,
        issueIds: matchingIssueIds
      }
    }));

    renderIssueTable(loadedIssues, selectedIssueTableId);
  }

  function resetIssueFilters() {
    var type = document.getElementById('issueTypeFilter');
    var typeLabel = document.getElementById('issueTypeFilterLabel');
    var typeMenu = document.getElementById('issueTypeFilterMenu');
    var assignedTo = document.getElementById('issueAssignedToFilter');

    if (type) type.value = '';
    if (typeLabel) typeLabel.textContent = 'Select a type';
    if (typeMenu) typeMenu.hidden = true;
    if (assignedTo) assignedTo.value = '';

    document.querySelectorAll('.issueStatusChip').forEach(function (button) {
      button.classList.add('active');
    });

    applyIssueFilters();
  }

  function clearAllIssueFilters() {
    var type = document.getElementById('issueTypeFilter');
    var typeLabel = document.getElementById('issueTypeFilterLabel');
    var typeMenu = document.getElementById('issueTypeFilterMenu');
    var assignedTo = document.getElementById('issueAssignedToFilter');

    if (type) type.value = '';
    if (typeLabel) typeLabel.textContent = 'Select a type';
    if (typeMenu) typeMenu.hidden = true;
    if (assignedTo) assignedTo.value = '';

    document.querySelectorAll('.issueStatusChip').forEach(function (button) {
      button.classList.remove('active');
    });

    applyIssueFilters();
  }

  function initIssueFilterEvents() {
    var type = document.getElementById('issueTypeFilter');
    var typeButton = document.getElementById('issueTypeFilterButton');
    var assignedTo = document.getElementById('issueAssignedToFilter');
    var resetButton = document.getElementById('issueFilterResetButton');
    var clearButton = document.getElementById('issueFilterClearButton');
    var collapseButton = document.getElementById('issueFilterCollapseButton');
    var filterPanel = document.getElementById('issueFilterPanel');

    [assignedTo].forEach(function (select) {
      if (select) {
        select.addEventListener('change', applyIssueFilters);
      }
    });

    if (typeButton) {
      typeButton.addEventListener('click', function (event) {
        event.preventDefault();

        var menu = document.getElementById('issueTypeFilterMenu');
        if (menu) menu.hidden = !menu.hidden;
      });
    }

    document.querySelectorAll('.issueStatusChip').forEach(function (button) {
      button.addEventListener('click', function () {
        button.classList.toggle('active');
        applyIssueFilters();
      });
    });

    if (resetButton) {
      resetButton.addEventListener('click', function (event) {
        event.preventDefault();
        resetIssueFilters();
      });
    }

    if (clearButton) {
      clearButton.addEventListener('click', function (event) {
        event.preventDefault();
        clearAllIssueFilters();
      });
    }

    if (collapseButton && filterPanel) {
      collapseButton.addEventListener('click', function (event) {
        event.preventDefault();
        filterPanel.classList.toggle('collapsed');
        collapseButton.textContent = filterPanel.classList.contains('collapsed') ? '▾' : '×';
      });
    }
  }

  function updateIssuePickerVisibility(picker) {
    if (!picker) return;

    var searchText = normalise(picker.querySelector('[data-issue-option-search]')?.value || '');
    var assigneeType = picker.classList.contains('accIssueAssigneePicker')
      ? picker.getAttribute('data-active-assignee-type') || 'all'
      : 'all';

    picker.querySelectorAll('[data-issue-option-value]').forEach(function (option) {
      var optionText = normalise(option.getAttribute('data-option-text') || option.textContent || '');
      var optionType = option.getAttribute('data-assignee-type') || '';
      var matchesSearch = !searchText || optionText.includes(searchText);
      var matchesType = assigneeType === 'all' || optionType === assigneeType;

      option.style.display = matchesSearch && matchesType ? '' : 'none';
    });

    picker.querySelectorAll('[data-picker-group]').forEach(function (group) {
      var groupType = group.getAttribute('data-assignee-type') || '';
      var matchesGroupType = assigneeType === 'all' || groupType === assigneeType;
      var hasVisibleOption = false;
      var nextElement = group.nextElementSibling;

      while (nextElement && !nextElement.matches('[data-picker-group]')) {
        if (nextElement.matches('[data-issue-option-value]') && nextElement.style.display !== 'none') {
          hasVisibleOption = true;
          break;
        }

        nextElement = nextElement.nextElementSibling;
      }

      group.style.display = matchesGroupType && hasVisibleOption ? '' : 'none';
    });
  }

  function setIssuePickerValue(option) {
    var targetId = option.getAttribute('data-issue-option-target');
    var picker = option.closest('.accIssuePicker');
    var input = targetId ? document.getElementById(targetId) : null;

    if (!picker || !input) return;

    input.value = option.getAttribute('data-issue-option-value') || '';

    picker.querySelectorAll('[data-issue-option-value]').forEach(function (item) {
      item.classList.toggle('selected', item === option);
    });
  }

  function initActionButtons() {
    var switchbackButton = document.getElementById('switchbackPanelButton');

    if (switchbackButton) {
      switchbackButton.addEventListener('click', function (event) {
        event.preventDefault();

        if (typeof window.switchbackToRevitFromViewer === 'function') {
          window.switchbackToRevitFromViewer();
        } else {
          setStatus('Load a model first. The viewer switchback extension is not ready yet.');
        }
      });
    }

    var selectionModeToggle = document.getElementById('issueSelectionModeToggle');
    if (selectionModeToggle) {
      selectionModeToggle.addEventListener('click', function (event) {
        event.preventDefault();
        setOpenSavedViewOnSelectSetting(!getOpenSavedViewOnSelectSetting());
      });
    }

    syncIssueSelectionModePanel();

    document.addEventListener('viewerinstance', function (event) {
      syncIssueSelectionModePanel();
      var modelInfo = event.detail?.modelInfo || {};
      setStatus('Loaded: ' + (modelInfo.name || 'model'));
    });

    document.addEventListener('switchbackcomplete', function (event) {
      var detail = event.detail || {};
      setStatus(detail.message || 'Switchback complete.');
    });

    document.addEventListener('accissueselected', function (event) {
      showIssueDetails(event.detail || {});
      var detail = event.detail || {};
      selectedIssueTableId = getIssueId(detail.issue || {}, detail.summary || {}) || selectedIssueTableId;
      renderIssueTable(loadedIssues, selectedIssueTableId);
    });

    document.addEventListener('accissuesloaded', function (event) {
      loadedIssues = event.detail?.issues || [];
      var refreshIssueSettings = event.detail?.refreshIssueSettings === true;

      refreshCurrentIssueFromLoadedIssues();
      updateIssueFilterOptions(loadedIssues);
      renderIssueTable(loadedIssues, selectedIssueTableId);

      loadIssueSettings(refreshIssueSettings).then(function () {
        renderIssueTable(loadedIssues, selectedIssueTableId);
        renderIssueDetails();
      }).catch(function (error) {
        console.warn(error);
      });
    });

    document.addEventListener('accissuefilterresult', function (event) {
      var total = event.detail?.total || 0;
      var visible = event.detail?.visible || 0;
      var summary = document.getElementById('issueFilterSummary');

      if (summary) {
        summary.textContent = visible + ' of ' + total + ' issues visible.';
      }
    });

    document.addEventListener('accissueopensavedviewsettingchanged', function (event) {
      if (typeof event.detail?.openSavedViewOnIssueSelect !== 'boolean') return;

      localStorage.setItem(
        'acc-issue-open-saved-view-on-select',
        String(event.detail.openSavedViewOnIssueSelect)
      );
      syncIssueSelectionModePanel();
    });

    document.addEventListener('click', function (event) {
      if (handleIssueTableClick(event)) return;

      var issueTableColumnButton = event.target?.closest?.('[data-issue-table-column]');
      if (issueTableColumnButton) {
        event.preventDefault();
        var columnKey = issueTableColumnButton.getAttribute('data-issue-table-column') || '';
        issueTableState.openColumnKey = issueTableState.openColumnKey === columnKey ? '' : columnKey;
        issueTableState.searchText = '';
        renderIssueTable(loadedIssues, selectedIssueTableId);
        return;
      }

      if (event.target?.closest?.('#issueTableRefreshButton')) {
        event.preventDefault();
        refreshIssuesFromAcc();
        return;
      }

      var issueTableMenuAction = event.target?.closest?.('[data-issue-table-action]');
      if (issueTableMenuAction) {
        event.preventDefault();
        var menu = issueTableMenuAction.closest('#issueTableColumnMenu');
        var menuKey = menu ? menu.getAttribute('data-issue-table-menu-key') : issueTableState.openColumnKey;
        handleIssueTableMenuAction(issueTableMenuAction.getAttribute('data-issue-table-action'), menuKey);
        renderIssueTable(loadedIssues, selectedIssueTableId);
        return;
      }

      var issueTableFilterValue = event.target?.closest?.('[data-issue-table-filter-value]');
      if (issueTableFilterValue) {
        var filterMenu = issueTableFilterValue.closest('#issueTableColumnMenu');
        var filterKey = filterMenu ? filterMenu.getAttribute('data-issue-table-menu-key') : issueTableState.openColumnKey;
        setIssueTableFilterValue(filterKey, issueTableFilterValue.value, issueTableFilterValue.checked);
        renderIssueTable(loadedIssues, selectedIssueTableId);
        return;
      }

      var customColumnsButton = event.target?.closest?.('#issueTableCustomColumnsButton');
      if (customColumnsButton) {
        event.preventDefault();
        issueTableState.customColumnMenuOpen = !issueTableState.customColumnMenuOpen;
        issueTableState.openColumnKey = '';
        renderIssueTable(loadedIssues, selectedIssueTableId);
        return;
      }

      var customColumnsClose = event.target?.closest?.('[data-issue-custom-columns-close]');
      if (customColumnsClose) {
        event.preventDefault();
        issueTableState.customColumnMenuOpen = false;
        renderIssueTable(loadedIssues, selectedIssueTableId);
        return;
      }

      var customColumnToggle = event.target?.closest?.('[data-issue-custom-column-toggle]');
      if (customColumnToggle) {
        setIssueTableCustomColumn(customColumnToggle.value, customColumnToggle.checked);
        renderIssueTable(loadedIssues, selectedIssueTableId);
        return;
      }

      if (
        issueTableState.openColumnKey &&
        !event.target?.closest?.('#issueTableColumnMenu') &&
        !event.target?.closest?.('[data-issue-table-column]')
      ) {
        issueTableState.openColumnKey = '';
        issueTableState.searchText = '';
        renderIssueTable(loadedIssues, selectedIssueTableId);
      }

      if (
        issueTableState.customColumnMenuOpen &&
        !event.target?.closest?.('#issueTableCustomColumnsMenu') &&
        !event.target?.closest?.('#issueTableCustomColumnsButton')
      ) {
        issueTableState.customColumnMenuOpen = false;
        renderIssueTable(loadedIssues, selectedIssueTableId);
      }

      var pickerOption = event.target?.closest?.('[data-issue-option-value]');
      if (pickerOption) {
        event.preventDefault();
        setIssuePickerValue(pickerOption);
        return;
      }

      var assigneeFilter = event.target?.closest?.('[data-assignee-filter]');
      if (assigneeFilter) {
        event.preventDefault();

        var picker = assigneeFilter.closest('.accIssuePicker');
        if (picker) {
          picker.setAttribute('data-active-assignee-type', assigneeFilter.getAttribute('data-assignee-filter') || 'all');
          picker.querySelectorAll('[data-assignee-filter]').forEach(function (button) {
            button.classList.toggle('active', button === assigneeFilter);
          });
          updateIssuePickerVisibility(picker);
        }

        return;
      }

      var commentMentionOption = event.target?.closest?.('[data-comment-mention-value]');
      if (commentMentionOption) {
        event.preventDefault();
        insertCommentMention(commentMentionOption);
        return;
      }

      var issueTypeFilterOption = event.target?.closest?.('[data-issue-type-filter-value]');
      if (issueTypeFilterOption) {
        event.preventDefault();

        var typeInput = document.getElementById('issueTypeFilter');
        var typeLabel = document.getElementById('issueTypeFilterLabel');
        var typeMenu = document.getElementById('issueTypeFilterMenu');
        var typeValue = issueTypeFilterOption.getAttribute('data-issue-type-filter-value') || '';

        if (typeInput) typeInput.value = typeValue;
        if (typeLabel) {
          typeLabel.innerHTML = typeValue
            ? getIssueQuickFilterTypeHtml(typeValue)
            : 'Select a type';
        }
        if (typeMenu) typeMenu.hidden = true;

        applyIssueFilters();
        return;
      }

      if (
        !event.target?.closest?.('#issueTypeFilterMenu') &&
        !event.target?.closest?.('#issueTypeFilterButton')
      ) {
        var openTypeMenu = document.getElementById('issueTypeFilterMenu');
        if (openTypeMenu) openTypeMenu.hidden = true;
      }

      if (
        !event.target?.closest?.('#issueCommentMentionPopup') &&
        !event.target?.closest?.('#issueCommentBody')
      ) {
        hideCommentMentionPopup();
      }

      var fieldEditTarget = event.target?.closest?.('[data-issue-field-edit]');
      if (fieldEditTarget && !event.target?.closest?.('button, a, input, textarea, select')) {
        event.preventDefault();
        activeIssueEditField = fieldEditTarget.getAttribute('data-issue-field-edit') || null;
        renderIssueDetails();
        return;
      }

      var issueTab = event.target?.closest?.('[data-issue-tab]');
      if (issueTab) {
        event.preventDefault();
        currentIssueTab = issueTab.getAttribute('data-issue-tab') || 'details';
        activeIssueEditField = null;
        renderIssueDetails();
        return;
      }

      var issueEditButton = event.target?.closest?.('[data-issue-edit]');
      if (issueEditButton) {
        event.preventDefault();
        activeIssueEditField = issueEditButton.getAttribute('data-issue-edit') || null;
        renderIssueDetails();
        return;
      }

      var issueCancelButton = event.target?.closest?.('[data-issue-cancel]');
      if (issueCancelButton) {
        event.preventDefault();
        activeIssueEditField = null;
        renderIssueDetails();
        return;
      }

      var issueSaveButton = event.target?.closest?.('[data-issue-save]');
      if (issueSaveButton) {
        event.preventDefault();
        saveCurrentIssueField(issueSaveButton.getAttribute('data-issue-save'));
        return;
      }

      if (event.target && event.target.id === 'issueCommentSubmit') {
        event.preventDefault();
        submitIssueComment();
        return;
      }

      var row = event.target?.closest?.('#issueTableBody tr[data-issue-id]');
      if (row) {
        var issueId = row.getAttribute('data-issue-id');
        if (issueId) {
          selectedIssueTableId = issueId;
          renderIssueTable(loadedIssues, selectedIssueTableId);
          document.dispatchEvent(new CustomEvent('accissuetableselect', { detail: { issueId: issueId, openSavedView: getOpenSavedViewOnSelectSetting() } }));
        }
      }

      if (event.target && event.target.id === 'closeIssueDetails') {
        event.preventDefault();
        clearIssueDetails();
      }

      if (event.target && event.target.id === 'issuePanelSwitchbackButton') {
        event.preventDefault();

        if (typeof window.switchbackToRevitFromViewer === 'function') {
          window.switchbackToRevitFromViewer();
        } else {
          setStatus('Load a model first. Switchback is not ready yet.');
        }
      }

      if (event.target && event.target.id === 'issuePanelOpenSavedViewButton') {
        event.preventDefault();

        var selectedIssue = currentIssueDetail && currentIssueDetail.issue ? currentIssueDetail.issue : null;
        var selectedSummary = currentIssueDetail && currentIssueDetail.summary ? currentIssueDetail.summary : {};
        var selectedIssueId =
          selectedIssue?.id ||
          selectedIssue?.issueId ||
          selectedIssue?.attributes?.id ||
          selectedSummary?.id ||
          null;

        if (!selectedIssueId) {
          setStatus('Select an issue first.');
        } else if (typeof window.accIssuePinsOpenSavedView === 'function') {
          window.accIssuePinsOpenSavedView(selectedIssueId, { source: 'issue-panel-open-saved-view' });
          setStatus('Opening saved ACC issue view...');
        } else if (typeof window.openIssueInLatestViewable === 'function' && selectedIssue) {
          window.openIssueInLatestViewable(selectedIssue);
          setStatus('Opening saved ACC issue view...');
        } else {
          setStatus('Saved ACC issue view action is not ready yet.');
        }
      }

      if (event.target && event.target.id === 'issuePanelClearSectionButton') {
        event.preventDefault();

        if (typeof window.accIssuePinsClearSection === 'function') {
          var sectionCleared = window.accIssuePinsClearSection();
          setStatus(sectionCleared === false
            ? '2D view: no section box to clear.'
            : 'Issue section box cleared.');
        } else if (window.viewer) {
          window.viewer.setCutPlanes([]);
          window.viewer.impl.invalidate(true, true, true);
          setStatus('Section box cleared.');
        } else {
          setStatus('Viewer is not ready.');
        }
      }
    });

    document.addEventListener('pointerdown', function (event) {
      if (handleIssueTablePointerDown(event)) return;

      var resizeHandle = event.target?.closest?.('[data-issue-table-resize]');
      var dragHandle = event.target?.closest?.('[data-issue-table-drag]');

      if (!resizeHandle && !dragHandle) return;

      event.preventDefault();
      event.stopPropagation();

      if (dragHandle) {
        var draggedColumnKey = dragHandle.getAttribute('data-issue-table-drag');

        if (!draggedColumnKey) return;

        issueTableState.draggingColumn = {
          key: draggedColumnKey
        };

        document.body.classList.add('dragging-issue-table-column');
        return;
      }

      var columnKey = resizeHandle.getAttribute('data-issue-table-resize');
      var header = resizeHandle.closest('th');

      if (!columnKey || !header) return;

      issueTableState.resizingColumn = {
        key: columnKey,
        startX: event.clientX,
        startWidth: header.getBoundingClientRect().width
      };

      document.body.classList.add('resizing-issue-table-column');
    });

    document.addEventListener('pointermove', function (event) {
      if (handleIssueTablePointerMove(event)) return;

      var resizeInfo = issueTableState.resizingColumn;
      var dragInfo = issueTableState.draggingColumn;

      if (resizeInfo) {
        var nextWidth = resizeInfo.startWidth + (event.clientX - resizeInfo.startX);
        setIssueTableColumnWidth(resizeInfo.key, nextWidth);
        renderIssueTable(loadedIssues, selectedIssueTableId);
        return;
      }

      if (!dragInfo) return;

      var elementUnderPointer = document.elementFromPoint(event.clientX, event.clientY);
      var targetHeader = elementUnderPointer?.closest?.('[data-issue-table-header]');
      var targetColumnKey = targetHeader ? targetHeader.getAttribute('data-issue-table-header') : '';
      var targetRect = targetHeader ? targetHeader.getBoundingClientRect() : null;
      var placeAfterTarget = targetRect
        ? event.clientX > targetRect.left + (targetRect.width / 2)
        : false;

      if (moveIssueTableColumn(dragInfo.key, targetColumnKey, placeAfterTarget)) {
        renderIssueTable(loadedIssues, selectedIssueTableId);
      }
    });

    document.addEventListener('pointerup', function () {
      if (handleIssueTablePointerUp()) return;

      if (!issueTableState.resizingColumn && !issueTableState.draggingColumn) return;

      issueTableState.resizingColumn = null;
      issueTableState.draggingColumn = null;
      document.body.classList.remove('resizing-issue-table-column');
      document.body.classList.remove('dragging-issue-table-column');
    });

    document.addEventListener('input', function (event) {
      if (event.target && event.target.id === 'issueCommentBody') {
        updateCommentMentionPopup(event.target);
      }

      if (handleIssueTableInput(event)) return;

      if (event.target && event.target.id === 'issueTableFilterSearch') {
        issueTableState.searchText = event.target.value || '';
        renderIssueTableColumnMenu();
        var searchInput = document.getElementById('issueTableFilterSearch');
        if (searchInput) {
          searchInput.focus();
          searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }
      }

      if (event.target?.matches?.('[data-issue-table-text-filter]')) {
        var textMenu = event.target.closest('#issueTableColumnMenu');
        var textKey = textMenu ? textMenu.getAttribute('data-issue-table-menu-key') : issueTableState.openColumnKey;
        setIssueTableTextFilter(textKey, event.target.value);
        renderIssueTable(loadedIssues, selectedIssueTableId);
        var textInput = document.querySelector('[data-issue-table-text-filter]');
        if (textInput) {
          textInput.focus();
          textInput.setSelectionRange(textInput.value.length, textInput.value.length);
        }
      }
    });

    document.addEventListener('change', function (event) {
      if (handleIssueTableChange(event)) return;

      if (event.target?.matches?.('[data-issue-table-date-filter]')) {
        var dateMenu = event.target.closest('#issueTableColumnMenu');
        var dateKey = dateMenu ? dateMenu.getAttribute('data-issue-table-menu-key') : issueTableState.openColumnKey;
        setIssueTableDateFilter(dateKey, event.target.getAttribute('data-issue-table-date-filter'), event.target.value);
        renderIssueTable(loadedIssues, selectedIssueTableId);
      }

      if (event.target?.matches?.('[data-issue-table-number-filter]')) {
        var numberMenu = event.target.closest('#issueTableColumnMenu');
        var numberKey = numberMenu ? numberMenu.getAttribute('data-issue-table-menu-key') : issueTableState.openColumnKey;
        setIssueTableNumberFilter(numberKey, event.target.getAttribute('data-issue-table-number-filter'), event.target.value);
        renderIssueTable(loadedIssues, selectedIssueTableId);
      }
    });

    document.addEventListener('input', function (event) {
      if (!event.target?.matches?.('[data-issue-option-search]')) return;
      updateIssuePickerVisibility(event.target.closest('.accIssuePicker'));
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && event.target && event.target.id === 'issueCommentBody') {
        hideCommentMentionPopup();
        return;
      }

      if (event.key !== 'Enter' && event.key !== ' ') return;

      var fieldEditTarget = event.target?.closest?.('[data-issue-field-edit]');
      if (!fieldEditTarget) return;

      event.preventDefault();
      activeIssueEditField = fieldEditTarget.getAttribute('data-issue-field-edit') || null;
      renderIssueDetails();
    });

    document.addEventListener('error', function (event) {
      if (!event.target?.classList?.contains('accIssueThumbnailImage')) return;
      event.target.closest('.accIssueThumbnail')?.classList?.add('load-failed');
    }, true);
  }

  document.addEventListener('DOMContentLoaded', function () {
    initRevitConnectionPanel();
    buildStableIssuePanel();
    buildIssueSelectionModePanel();
    buildIssueFilterPanel();
    buildIssueTablePanel();
    window.PanelLayout.init();
    initActionButtons();
    clearIssueDetails();

    syncIssueSelectionModePanel();
  });
})();
