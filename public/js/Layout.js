/////////////////////////////////////////////////////////////////////
// Resizable, collapsible layout controls, stable issue panel, issue filters
/////////////////////////////////////////////////////////////////////

(function () {
  var currentIssueDetail = null;
  var loadedIssues = [];
  var currentIssueFilters = {
    category: '',
    type: '',
    statuses: ['draft', 'open', 'pending', 'in review', 'closed'],
    location: '',
    assignedTo: ''
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function setStatus(text) {
    var status = document.getElementById('viewerActionStatus');
    if (status) status.textContent = text;
  }

  function isRawAutodeskId(value) {
    if (!value || typeof value !== 'string') return false;

    var trimmed = value.trim();

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return true;
    if (/^[0-9a-f]{24}$/i.test(trimmed)) return true;
    if (/^[A-Z0-9]{12,24}$/i.test(trimmed) && !trimmed.includes('@') && !trimmed.includes(' ')) return true;
    if (trimmed.startsWith('urn:')) return true;
    if (trimmed.startsWith('b.')) return true;

    return false;
  }

  function text(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback || '-';

    if (typeof value === 'object') {
      return getDisplayName(value, fallback || '-');
    }

    var stringValue = String(value);

    if (isRawAutodeskId(stringValue)) {
      return fallback || 'Unresolved name';
    }

    return stringValue;
  }

  function setElementText(id, value, fallback) {
    var element = document.getElementById(id);
    if (element) element.textContent = text(value, fallback);
  }

  function getDisplayName(value, fallback) {
    if (!value) return fallback || '-';

    if (typeof value === 'string') {
      return isRawAutodeskId(value) ? (fallback || 'Unresolved name') : value;
    }

    if (typeof value !== 'object') {
      return String(value);
    }

    var name =
      value.name ||
      value.displayName ||
      value.fullName ||
      value.email ||
      value.title ||
      value.label ||
      value.companyName ||
      value.roleName ||
      value.attributes?.name ||
      value.attributes?.displayName ||
      value.attributes?.email ||
      value.attributes?.title ||
      value.user?.name ||
      value.user?.displayName ||
      value.user?.email ||
      value.company?.name ||
      value.company?.displayName ||
      value.role?.name ||
      value.role?.displayName ||
      null;

    if (name) return String(name);

    return fallback || '-';
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

    return getDisplayName(assignedValue, fallback);
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

  function formatDate(value) {
    if (!value) return '-';

    var date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return text(value, '-');
    }

    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
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

  function getLocation(issue) {
    var locationValue =
      issue?.locationName ||
      issue?.locationDetails ||
      issue?.location ||
      issue?.attributes?.locationName ||
      issue?.attributes?.locationDetails ||
      issue?.attributes?.location ||
      '';

    if (!locationValue) return '-';

    return getDisplayName(locationValue, '-');
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
    if (value.includes('answered')) return 'answered';
    if (value.includes('void')) return 'void';
    if (value.includes('draft')) return 'draft';

    return 'open';
  }

  function normalise(value) {
    return String(value || '').trim().toLowerCase();
  }

  function uniqueValues(values) {
    var set = new Set();

    values.forEach(function (value) {
      var clean = text(value, '').trim();
      if (clean && clean !== '-' && !isRawAutodeskId(clean)) {
        set.add(clean);
      }
    });

    return Array.from(set).sort(function (a, b) {
      return a.localeCompare(b);
    });
  }

  function injectIssuePanelStyles() {
    if (document.getElementById('stableIssuePanelStyles')) return;

    var style = document.createElement('style');
    style.id = 'stableIssuePanelStyles';

    style.textContent = `
      #issueDetailsPanel {
        background: #ffffff;
        color: #172033;
        border: 1px solid #d8dee8;
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.14);
        font-family: Arial, sans-serif;
      }

      .stableIssueShell {
        height: 100%;
        min-height: 520px;
        display: flex;
        flex-direction: column;
        background: #ffffff;
      }

      .stableIssueHeader {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        padding: 14px 14px 12px 14px;
        border-bottom: 1px solid #e5eaf0;
        background: #ffffff;
      }

      .stableIssueHeaderText {
        min-width: 0;
      }

      .stableIssueEyebrow {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: #697386;
        margin-bottom: 6px;
      }

      .stableIssueTitle {
        margin: 0;
        font-size: 18px;
        line-height: 1.25;
        font-weight: 650;
        color: #111827;
        word-break: break-word;
      }

      .stableIssueClose {
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #6b7280;
        font-size: 24px;
        line-height: 24px;
        cursor: pointer;
      }

      .stableIssueClose:hover {
        background: #f3f4f6;
        color: #111827;
      }

      .stableIssueStatusDot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #f59e0b;
        display: inline-block;
        flex: 0 0 auto;
      }

      .stableIssueStatusDot.closed {
        background: #10b981;
      }

      .stableIssueStatusDot.answered {
        background: #3b82f6;
      }

      .stableIssueStatusDot.void {
        background: #9ca3af;
      }

      .stableIssueStatusDot.draft {
        background: #8b5cf6;
      }

      .stableIssueBody {
        padding: 14px;
        overflow: auto;
        background: #ffffff;
      }

      .stableIssueEmpty {
        padding: 18px;
        color: #6b7280;
        font-size: 13px;
        line-height: 1.45;
      }

      .stableIssueActions {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
        margin-bottom: 14px;
      }

      .stableIssueActions button {
        height: 34px;
        border-radius: 7px;
        font-size: 13px;
        cursor: pointer;
        border: 1px solid #cbd5e1;
        background: #ffffff;
        color: #0f172a;
      }

      .stableIssueActions button:hover {
        background: #f8fafc;
        border-color: #94a3b8;
      }

      .stableIssueActions .primary {
        background: #2563eb;
        color: #ffffff;
        border-color: #2563eb;
      }

      .stableIssueActions .primary:hover {
        background: #1d4ed8;
      }

      .stableIssueCard {
        border: 1px solid #e5eaf0;
        border-radius: 8px;
        background: #ffffff;
        margin-bottom: 12px;
        overflow: hidden;
      }

      .stableIssueCardHeader {
        padding: 10px 12px;
        font-size: 12px;
        font-weight: 700;
        color: #334155;
        background: #f8fafc;
        border-bottom: 1px solid #e5eaf0;
      }

      .stableIssueCardBody {
        padding: 12px;
      }

      .stableIssueField {
        margin-bottom: 13px;
      }

      .stableIssueField:last-child {
        margin-bottom: 0;
      }

      .stableIssueFieldLabel {
        font-size: 11px;
        color: #64748b;
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.035em;
      }

      .stableIssueFieldValue {
        font-size: 13px;
        line-height: 1.45;
        color: #111827;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .stableIssueDescription {
        min-height: 52px;
      }

      .stableIssueGrid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }

      .stableIssueBadge {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        max-width: 100%;
        padding: 4px 8px;
        border-radius: 999px;
        background: #eef2ff;
        color: #3730a3;
        font-size: 12px;
        font-weight: 600;
      }

      .issueFilterPanel {
        background: #ffffff;
        border: 1px solid #d8dee8;
        border-radius: 10px;
        overflow: hidden;
        margin-bottom: 12px;
        font-family: Arial, sans-serif;
      }

      .issueFilterHeader {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 12px;
        border-bottom: 1px solid #e5eaf0;
      }

      .issueFilterHeader h3 {
        margin: 0;
        font-size: 15px;
        color: #111827;
      }

      .issueFilterHeaderActions {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .issueFilterHeaderActions button {
        border: 0;
        background: transparent;
        color: #2563eb;
        font-size: 12px;
        cursor: pointer;
        padding: 0;
      }

      .issueFilterCollapseButton {
        color: #64748b !important;
        font-size: 18px !important;
        line-height: 18px;
      }

      .issueFilterBody {
        padding: 12px;
      }

      .issueFilterPanel.collapsed .issueFilterBody {
        display: none;
      }

      .issueFilterField {
        margin-bottom: 12px;
      }

      .issueFilterField label {
        display: block;
        font-size: 12px;
        color: #475569;
        margin-bottom: 5px;
      }

      .issueFilterField select {
        width: 100%;
        height: 34px;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        padding: 0 8px;
        background: #ffffff;
        color: #111827;
        font-size: 13px;
      }

      .issueStatusChips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .issueStatusChip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: 1px solid #cbd5e1;
        background: #ffffff;
        border-radius: 999px;
        padding: 4px 8px;
        font-size: 12px;
        cursor: pointer;
        color: #111827;
      }

      .issueStatusChip.active {
        border-color: #2563eb;
        background: #eff6ff;
      }

      .issueStatusChip .statusColour {
        width: 3px;
        height: 14px;
        border-radius: 2px;
        display: inline-block;
      }

      .issueStatusChip[data-status="draft"] .statusColour {
        background: #475569;
      }

      .issueStatusChip[data-status="open"] .statusColour {
        background: #f59e0b;
      }

      .issueStatusChip[data-status="pending"] .statusColour {
        background: #0ea5e9;
      }

      .issueStatusChip[data-status="in review"] .statusColour {
        background: #8b5cf6;
      }

      .issueStatusChip[data-status="closed"] .statusColour {
        background: #9ca3af;
      }

      .issueFilterSummary {
        font-size: 12px;
        color: #64748b;
        margin-top: 8px;
      }

      .issueTablePanel { margin-top: 10px; border: 1px solid #94a3b8; border-radius: 8px; background: #fff; overflow: hidden; box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08); }
      .issueTableHeader { padding: 10px 12px; font-size: 14px; font-weight: 700; border-bottom: 1px solid #e5e7eb; background: #e2e8f0; color: #0f172a; }
      .issueTableWrapper { max-height: 360px; overflow: auto; }
      .issueTable { width: 100%; border-collapse: collapse; font-size: 13px; }
      .issueTable thead th { position: sticky; top: 0; background: #f8fafc; z-index: 1; }
      .issueTable th, .issueTable td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
      .issueTable tbody tr { cursor: pointer; }
      .issueTable tbody tr:hover { background: #f8fafc; }
      .issueTable tbody tr:nth-child(even) { background: #fcfdff; }
      .issueTable tbody tr.active { background: #dbeafe; }
    `;

    document.head.appendChild(style);
  }

  function buildIssueFilterPanel() {
    injectIssuePanelStyles();

    var rightPanel = document.querySelector('.rightPanel, #rightPanel, aside.viewerActions, #viewerActionsPanel');
    var issueDetailsPanel = document.getElementById('issueDetailsPanel');

    if (!issueDetailsPanel) return;

    if (document.getElementById('issueFilterPanel')) return;

    var panel = document.createElement('div');
    panel.id = 'issueFilterPanel';
    panel.className = 'issueFilterPanel';
    panel.innerHTML = `
      <div class="issueFilterHeader">
        <h3>Filter issues</h3>
        <div class="issueFilterHeaderActions">
          <button id="issueFilterResetButton" type="button">Reset</button>
          <button id="issueFilterClearButton" type="button">Clear all</button>
          <button id="issueFilterCollapseButton" class="issueFilterCollapseButton" type="button">×</button>
        </div>
      </div>

      <div class="issueFilterBody">
        <div class="issueFilterField">
          <label for="issueCategoryFilter">Category</label>
          <select id="issueCategoryFilter">
            <option value="">Select a type</option>
          </select>
        </div>

        <div class="issueFilterField">
          <label for="issueTypeFilter">Type</label>
          <select id="issueTypeFilter">
            <option value="">Select a type</option>
          </select>
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
          <label for="issueLocationFilter">Location</label>
          <select id="issueLocationFilter">
            <option value="">Select...</option>
          </select>
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
    panel.innerHTML = '<div class="issueTableHeader">Project issues</div><div class="issueTableWrapper"><table class="issueTable"><thead><tr><th>ID</th><th>Title</th><th>Status</th></tr></thead><tbody id="issueTableBody"><tr><td colspan="3">No issues loaded.</td></tr></tbody></table></div>';
    issueDetailsPanel.parentNode.insertBefore(panel, issueDetailsPanel);
  }

  function renderIssueTable(issues, selectedIssueId) {
    var tbody = document.getElementById('issueTableBody');
    if (!tbody) return;

    if (!issues || issues.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3">No issues loaded.</td></tr>';
      return;
    }

    tbody.innerHTML = issues.map(function (issue) {
      var issueId = issue?.id || issue?.issueId || issue?.attributes?.id || '';
      var rowClass = issueId && issueId === selectedIssueId ? ' class="active"' : '';
      return '<tr data-issue-id="' + issueId + '"' + rowClass + '><td>' + text(getIssueDisplayId(issue, {}), '-') + '</td><td>' + text(getIssueTitle(issue, {}), '-') + '</td><td>' + text(getIssueStatus(issue, {}), '-') + '</td></tr>';
    }).join('');
  }

  function buildStableIssuePanel() {
    injectIssuePanelStyles();

    var panel = document.getElementById('issueDetailsPanel');
    if (!panel) return;

    panel.innerHTML = `
      <div class="stableIssueShell">
        <div class="stableIssueHeader">
          <div class="stableIssueHeaderText">
            <div class="stableIssueEyebrow">
              <span id="issueDetailsStatusIndicator" class="stableIssueStatusDot"></span>
              <span id="issueDetailsNumber">Issue</span>
              <span>·</span>
              <span id="issueDetailsSubtitle">No issue selected</span>
            </div>
            <h2 id="issueDetailsTitle" class="stableIssueTitle">Select an issue pin</h2>
          </div>
          <button id="closeIssueDetails" class="stableIssueClose" type="button" title="Close">×</button>
        </div>

        <div id="issueDetailsEmpty" class="stableIssueEmpty">
          Select an issue pin in the viewer to review the issue information here.
        </div>

        <div id="issueDetailsContent" class="stableIssueBody" style="display:none;">
          <div class="stableIssueActions">
            <button id="issuePanelSwitchbackButton" class="primary" type="button">Switchback current view to Revit</button>
            <button id="issuePanelClearSectionButton" type="button">Clear section box</button>
          </div>

          <div class="stableIssueCard">
            <div class="stableIssueCardHeader">Issue</div>
            <div class="stableIssueCardBody">
              <div class="stableIssueField">
                <div class="stableIssueFieldLabel">Status</div>
                <div id="issueDetailsStatus" class="stableIssueFieldValue stableIssueBadge">-</div>
              </div>

              <div class="stableIssueField">
                <div class="stableIssueFieldLabel">Type</div>
                <div id="issueDetailsType" class="stableIssueFieldValue">-</div>
              </div>

              <div class="stableIssueField">
                <div class="stableIssueFieldLabel">Description</div>
                <div id="issueDetailsDescription" class="stableIssueFieldValue stableIssueDescription">-</div>
              </div>
            </div>
          </div>

          <div class="stableIssueCard">
            <div class="stableIssueCardHeader">Assignment</div>
            <div class="stableIssueCardBody stableIssueGrid">
              <div class="stableIssueField">
                <div class="stableIssueFieldLabel">Assigned to</div>
                <div id="issueDetailsAssignedTo" class="stableIssueFieldValue">-</div>
              </div>

              <div class="stableIssueField">
                <div class="stableIssueFieldLabel">Location</div>
                <div id="issueDetailsLocation" class="stableIssueFieldValue">-</div>
              </div>

              <div class="stableIssueField">
                <div class="stableIssueFieldLabel">Root cause</div>
                <div id="issueDetailsRootCause" class="stableIssueFieldValue">-</div>
              </div>
            </div>
          </div>

          <div class="stableIssueCard">
            <div class="stableIssueCardHeader">Dates</div>
            <div class="stableIssueCardBody stableIssueGrid">
              <div class="stableIssueField">
                <div class="stableIssueFieldLabel">Start date</div>
                <div id="issueDetailsStartDate" class="stableIssueFieldValue">-</div>
              </div>

              <div class="stableIssueField">
                <div class="stableIssueFieldLabel">Due date</div>
                <div id="issueDetailsDueDate" class="stableIssueFieldValue">-</div>
              </div>

              <div class="stableIssueField">
                <div class="stableIssueFieldLabel">Created</div>
                <div id="issueDetailsCreatedAt" class="stableIssueFieldValue">-</div>
              </div>

              <div class="stableIssueField">
                <div class="stableIssueFieldLabel">Updated</div>
                <div id="issueDetailsUpdatedAt" class="stableIssueFieldValue">-</div>
              </div>
            </div>
          </div>

          <div class="stableIssueCard">
            <div class="stableIssueCardHeader">People</div>
            <div class="stableIssueCardBody stableIssueGrid">
              <div class="stableIssueField">
                <div class="stableIssueFieldLabel">Created by</div>
                <div id="issueDetailsCreatedBy" class="stableIssueFieldValue">-</div>
              </div>

              <div class="stableIssueField">
                <div class="stableIssueFieldLabel">Updated by</div>
                <div id="issueDetailsUpdatedBy" class="stableIssueFieldValue">-</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function clearIssueDetails() {
    currentIssueDetail = null;

    var panel = document.getElementById('issueDetailsPanel');
    var empty = document.getElementById('issueDetailsEmpty');
    var content = document.getElementById('issueDetailsContent');
    var indicator = document.getElementById('issueDetailsStatusIndicator');

    if (panel) panel.classList.add('empty');
    if (empty) empty.style.display = 'block';
    if (content) content.style.display = 'none';

    if (indicator) indicator.className = 'stableIssueStatusDot';

    setElementText('issueDetailsNumber', 'Issue');
    setElementText('issueDetailsSubtitle', 'No issue selected');
    setElementText('issueDetailsTitle', 'Select an issue pin');
    setElementText('issueDetailsStatus', '-');
    setElementText('issueDetailsType', '-');
    setElementText('issueDetailsDescription', '-');
    setElementText('issueDetailsAssignedTo', '-');
    setElementText('issueDetailsLocation', '-');
    setElementText('issueDetailsRootCause', '-');
    setElementText('issueDetailsStartDate', '-');
    setElementText('issueDetailsDueDate', '-');
    setElementText('issueDetailsCreatedAt', '-');
    setElementText('issueDetailsUpdatedAt', '-');
    setElementText('issueDetailsCreatedBy', '-');
    setElementText('issueDetailsUpdatedBy', '-');
  }

  function showIssueDetails(detail) {
    currentIssueDetail = detail || {};

    var summary = detail?.summary || {};
    var issue = detail?.issue || {};

    var panel = document.getElementById('issueDetailsPanel');
    var empty = document.getElementById('issueDetailsEmpty');
    var content = document.getElementById('issueDetailsContent');
    var indicator = document.getElementById('issueDetailsStatusIndicator');

    if (panel) panel.classList.remove('empty');
    if (empty) empty.style.display = 'none';
    if (content) content.style.display = 'block';

    var displayId = getIssueDisplayId(issue, summary);
    var title = getIssueTitle(issue, summary);
    var status = getIssueStatus(issue, summary);

    setElementText('issueDetailsNumber', 'Issue #' + displayId);
    setElementText('issueDetailsSubtitle', status);
    setElementText('issueDetailsTitle', title);
    setElementText('issueDetailsStatus', status);
    setElementText('issueDetailsType', getIssueType(issue, summary));
    setElementText('issueDetailsDescription', getIssueDescription(issue, summary));
    setElementText('issueDetailsAssignedTo', getAssignedTo(issue, summary));
    setElementText('issueDetailsLocation', getLocation(issue));
    setElementText('issueDetailsRootCause', getRootCause(issue));
    setElementText('issueDetailsStartDate', formatDate(getStartDate(issue)));
    setElementText('issueDetailsDueDate', formatDate(getDueDate(issue)));
    setElementText('issueDetailsCreatedAt', formatDate(getCreatedAt(issue)));
    setElementText('issueDetailsUpdatedAt', formatDate(getUpdatedAt(issue)));
    setElementText('issueDetailsCreatedBy', getOpenedBy(issue));
    setElementText('issueDetailsUpdatedBy', getUpdatedBy(issue));

    if (indicator) {
      indicator.className = 'stableIssueStatusDot ' + statusClass(status);
    }

    setStatus('Selected issue #' + displayId + ': ' + title);
  }

  function getFilterOptionDataFromIssues(issues) {
    return {
      categories: uniqueValues(issues.map(function (issue) {
        return getIssueCategory(issue);
      })),
      types: uniqueValues(issues.map(function (issue) {
        return getIssueType(issue, {});
      })),
      locations: uniqueValues(issues.map(function (issue) {
        return getLocation(issue);
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

  function updateIssueFilterOptions(issues) {
    buildIssueFilterPanel();

    var data = getFilterOptionDataFromIssues(issues || []);

    populateSelect('issueCategoryFilter', data.categories, 'Select a type');
    populateSelect('issueTypeFilter', data.types, 'Select a type');
    populateSelect('issueLocationFilter', data.locations, 'Select...');
    populateSelect('issueAssignedToFilter', data.assignedTo, 'Select a member, role, or company');

    var summary = document.getElementById('issueFilterSummary');
    if (summary) {
      summary.textContent = 'Loaded ' + (issues || []).length + ' issues. Filters update the visible pins.';
    }

    applyIssueFilters();
  }

  function readIssueFiltersFromUi() {
    var category = document.getElementById('issueCategoryFilter')?.value || '';
    var type = document.getElementById('issueTypeFilter')?.value || '';
    var location = document.getElementById('issueLocationFilter')?.value || '';
    var assignedTo = document.getElementById('issueAssignedToFilter')?.value || '';

    var statuses = Array.from(document.querySelectorAll('.issueStatusChip.active'))
      .map(function (button) {
        return button.getAttribute('data-status');
      })
      .filter(Boolean);

    currentIssueFilters = {
      category: category,
      type: type,
      statuses: statuses,
      location: location,
      assignedTo: assignedTo
    };

    return currentIssueFilters;
  }

  function applyIssueFilters() {
    var filters = readIssueFiltersFromUi();

    document.dispatchEvent(new CustomEvent('accissuefilterschanged', {
      detail: {
        filters: filters
      }
    }));
  }

  function resetIssueFilters() {
    var category = document.getElementById('issueCategoryFilter');
    var type = document.getElementById('issueTypeFilter');
    var location = document.getElementById('issueLocationFilter');
    var assignedTo = document.getElementById('issueAssignedToFilter');

    if (category) category.value = '';
    if (type) type.value = '';
    if (location) location.value = '';
    if (assignedTo) assignedTo.value = '';

    document.querySelectorAll('.issueStatusChip').forEach(function (button) {
      button.classList.add('active');
    });

    applyIssueFilters();
  }

  function clearAllIssueFilters() {
    var category = document.getElementById('issueCategoryFilter');
    var type = document.getElementById('issueTypeFilter');
    var location = document.getElementById('issueLocationFilter');
    var assignedTo = document.getElementById('issueAssignedToFilter');

    if (category) category.value = '';
    if (type) type.value = '';
    if (location) location.value = '';
    if (assignedTo) assignedTo.value = '';

    document.querySelectorAll('.issueStatusChip').forEach(function (button) {
      button.classList.remove('active');
    });

    applyIssueFilters();
  }

  function initIssueFilterEvents() {
    var category = document.getElementById('issueCategoryFilter');
    var type = document.getElementById('issueTypeFilter');
    var location = document.getElementById('issueLocationFilter');
    var assignedTo = document.getElementById('issueAssignedToFilter');
    var resetButton = document.getElementById('issueFilterResetButton');
    var clearButton = document.getElementById('issueFilterClearButton');
    var collapseButton = document.getElementById('issueFilterCollapseButton');
    var filterPanel = document.getElementById('issueFilterPanel');

    [category, type, location, assignedTo].forEach(function (select) {
      if (select) {
        select.addEventListener('change', applyIssueFilters);
      }
    });

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
          var leftWidth = clamp(moveEvent.clientX, 220, Math.min(620, viewportWidth * 0.55));
          layout.style.setProperty('--left-width', leftWidth + 'px');
          localStorage.setItem('acc-switchback-left-width', String(leftWidth));
        }

        if (side === 'right') {
          var rightWidth = clamp(viewportWidth - moveEvent.clientX, 300, Math.min(620, viewportWidth * 0.5));
          layout.style.setProperty('--right-width', rightWidth + 'px');
          localStorage.setItem('acc-switchback-right-width', String(rightWidth));
        }
      }

      function onMouseUp() {
        document.body.classList.remove('resizing-panels');
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
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
      });
    }

    if (expandLeft) {
      expandLeft.addEventListener('click', function (event) {
        event.preventDefault();
        layout.classList.remove('left-collapsed');
        localStorage.setItem('acc-switchback-left-collapsed', 'false');
      });
    }

    if (collapseRight) {
      collapseRight.addEventListener('click', function (event) {
        event.preventDefault();
        layout.classList.add('right-collapsed');
        localStorage.setItem('acc-switchback-right-collapsed', 'true');
      });
    }

    if (expandRight) {
      expandRight.addEventListener('click', function (event) {
        event.preventDefault();
        layout.classList.remove('right-collapsed');
        localStorage.setItem('acc-switchback-right-collapsed', 'false');
      });
    }

    if (localStorage.getItem('acc-switchback-left-collapsed') === 'true') {
      layout.classList.add('left-collapsed');
    }

    if (localStorage.getItem('acc-switchback-right-collapsed') === 'true') {
      layout.classList.add('right-collapsed');
    }
  }

  function initActionButtons() {
    var switchbackButton = document.getElementById('switchbackPanelButton');
    var viewInViewerButton = document.getElementById('viewInViewerButton');

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

    if (viewInViewerButton) {
      viewInViewerButton.addEventListener('click', function (event) {
        event.preventDefault();

        if (!window.viewer) {
          setStatus('Load a model first.');
          return;
        }

        var extensionName = 'NestedViewerExtension';
        var currentlyLoaded = !!window.viewer.getExtension(extensionName);

        if (currentlyLoaded) {
          window.viewer.unloadExtension(extensionName);
          setStatus('Viewer in Viewer unloaded.');
        } else {
          window.viewer.loadExtension(extensionName)
            .then(function () {
              setStatus('Viewer in Viewer loaded.');
            })
            .catch(function (error) {
              setStatus('Could not load Viewer in Viewer: ' + error.message);
            });
        }
      });
    }

    document.addEventListener('viewerinstance', function (event) {
      var modelInfo = event.detail?.modelInfo || {};
      setStatus('Loaded: ' + (modelInfo.name || 'model'));
    });

    document.addEventListener('switchbackcomplete', function (event) {
      var detail = event.detail || {};
      setStatus(detail.message || 'Switchback complete.');
    });

    document.addEventListener('accissueselected', function (event) {
      showIssueDetails(event.detail || {});
      var selectedIssueId = event.detail?.issue?.id || event.detail?.issue?.issueId || event.detail?.issue?.attributes?.id || null;
      renderIssueTable(loadedIssues, selectedIssueId);
    });

    document.addEventListener('accissuesloaded', function (event) {
      loadedIssues = event.detail?.issues || [];
      updateIssueFilterOptions(loadedIssues);
      renderIssueTable(loadedIssues);
    });

    document.addEventListener('accissuefilterresult', function (event) {
      var total = event.detail?.total || 0;
      var visible = event.detail?.visible || 0;
      var summary = document.getElementById('issueFilterSummary');

      if (summary) {
        summary.textContent = visible + ' of ' + total + ' issues visible.';
      }
    });

    document.addEventListener('click', function (event) {
      var row = event.target?.closest?.('#issueTableBody tr[data-issue-id]');
      if (row) {
        var issueId = row.getAttribute('data-issue-id');
        if (issueId) {
          document.dispatchEvent(new CustomEvent('accissuetableselect', { detail: { issueId: issueId } }));
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

      if (event.target && event.target.id === 'issuePanelClearSectionButton') {
        event.preventDefault();

        if (typeof window.accIssuePinsClearSection === 'function') {
          window.accIssuePinsClearSection();
          setStatus('Issue section box cleared.');
        } else if (window.viewer) {
          window.viewer.setCutPlanes([]);
          window.viewer.impl.invalidate(true, true, true);
          setStatus('Section box cleared.');
        } else {
          setStatus('Viewer is not ready.');
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    buildIssueFilterPanel();
    buildIssueTablePanel();
    buildStableIssuePanel();
    restoreWidths();
    initResizeGrip('leftResizeGrip', 'left');
    initResizeGrip('rightResizeGrip', 'right');
    initCollapseButtons();
    initActionButtons();
    clearIssueDetails();
  });
})();
