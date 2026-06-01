# Code Map

This project is an Autodesk Viewer + ACC Issues + Revit switchback web app.

The goal of this file is to help you find the right file before you start editing.

## Quick Rule

If you are changing what the user sees, start in `public/`.

If you are changing what the server asks Autodesk for, start in `routes/` or `services/`.

If you are changing the Revit switchback button or JSON payload, start in the `SwitchbackToRevit` extension.

## Main Browser Files

`public/index.html`

This is the page structure. It loads CSS and JavaScript files. Keep it mostly as HTML structure and script/style references.

`public/js/ApsTree.js`

Controls the left ACC hub/project/file tree. Open this when you need to change how hubs, projects, folders, files, or versions appear in the left pane.

`public/js/ApsViewer.js`

Loads Autodesk Viewer, opens model/viewable documents, switches views, and restores viewer state. Open this when you need to change model loading, view switching, or viewer startup behavior.

`public/js/viewer/current-view-bar.js`

Controls the floating "Current view" label above Autodesk Viewer. Open this when the displayed view/sheet name is wrong.

`public/js/layout/panel-layout.js`

Controls left/right panel resize and collapse behavior. Open this if the side panels do not resize correctly or the viewer does not fill the available space.

`public/js/Layout.js`

Controls the right-side app UI: Quick Filters, issue table, issue details panel, issue edits, table sorting/filtering, panel resize, and click handlers.

This file is still the largest UI file. The low-risk shared helpers have been moved out, but the issue table and issue panel are still together so existing behavior stays stable.

`public/js/RevitConnection.js`

Controls the "Connect to my Revit instance" OTP panel. Open this when you need to change OTP generation, OTP storage, copy/new buttons, or the OTP payload used by switchback.

## Utility Files

`public/js/utils/text-utils.js`

Shared text helpers. Examples: display names, initials, raw Autodesk ID checks, normalising text, unique value lists, role/company name cleanup.

`public/js/utils/html-utils.js`

Shared safe HTML helpers. Examples: escaping HTML, escaping attributes, setting element text.

`public/js/utils/date-utils.js`

Shared date helpers. Examples: full date formatting, issue date formatting, date input values, relative comment times.

## Viewer Extensions

`public/extensions/config.json`

Lists which viewer extensions are loaded.

`public/extensions/extensionloader.js`

Loads extension CSS and JavaScript files from `public/extensions/config.json`.

`public/extensions/AccIssuePins/contents/main.js`

Autodesk Viewer extension for issue pushpins. Open this for pushpin position, selected red pin state, section box behavior, 2D pin focus, and issue-to-viewer interaction.

`public/extensions/AccIssuePins/contents/main.css`

CSS for issue pushpins and the issue focus settings panel.

`public/extensions/SwitchbackToRevit/contents/main.js`

Autodesk Viewer extension for the Revit switchback toolbar button and switchback JSON payload.

`public/extensions/SwitchbackToRevit/contents/main.css`

CSS for the Revit switchback toolbar button and switchback toast.

## CSS Files

`public/css/main.css`

Main page layout: navbar, left panel, right panel, viewer area, resize handles, and the current-view floating bar.

`public/css/issue-panel.css`

Right-side issue UI: OTP panel, Quick Filters, issue table, issue details panel, editors, comments, and table menus.

`public/css/w2ui-1.4.min.css`

External library CSS. Avoid editing this unless you are replacing the library.

## Server Files

`start.js`

Starts the Express server, mounts routes, and serves files from `public/`.

`routes/auth.js`

Autodesk sign-in, callback, logout, and current-user status.

`routes/models.js`

ACC hubs, projects, folders, items, versions, and viewer URNs.

`routes/issues.js`

ACC Issues API routes. Open this for issue loading, issue settings, issue enrichment, issue update PATCH requests, comments, thumbnails, and attachments.

`services/aps.js`

Shared APS auth/token/fetch helpers used by server routes.

## Where To Go For Common Changes

Change how Autodesk Viewer loads:

Open `public/js/ApsViewer.js`.

Change the issue table:

Open `public/js/Layout.js`. Search for `renderIssueTable`, `renderIssueTableHead`, or `issueTableState`.

Change filters or sorting:

Open `public/js/Layout.js`. Search for `Quick Filters`, `issueMatchesQuickFilters`, `issueMatchesTableFilters`, or `handleIssueTableMenuAction`.

Change the issue details panel:

Open `public/js/Layout.js`. Search for `renderIssueDetails`, `renderIssueDetailsBody`, or `renderIssueField`.

Change pushpin behavior:

Open `public/extensions/AccIssuePins/contents/main.js`.

Change switchback JSON:

Open `public/extensions/SwitchbackToRevit/contents/main.js`. Search for `createSwitchbackPayload`.

Change OTP:

Open `public/js/RevitConnection.js`.

Change CSS:

Use `public/css/main.css` for page layout.

Use `public/css/issue-panel.css` for the issue panel and table.

Use extension CSS files for extension-specific UI.

Change ACC issue API loading or saving:

Open `routes/issues.js`.

Change APS token/fetch behavior:

Open `services/aps.js`.

## Files To Avoid Editing Unless Necessary

`node_modules/`

Installed packages. Do not edit.

`public/css/w2ui-1.4.min.css`

External library CSS.

`switchback-output/`

Generated switchback JSON output. Usually do not edit by hand.

`package-lock.json`

Only changes when npm dependencies change.

## Simple App Flow

1. Browser opens `public/index.html`.
2. CSS files load first.
3. Utility files load next.
4. `RevitConnection.js` prepares the OTP panel.
5. `Layout.js` prepares the right-side UI and issue table.
6. `ApsTree.js` loads the ACC tree on the left.
7. User picks a file/version from the tree.
8. `ApsViewer.js` starts Autodesk Viewer and loads the selected model/viewable.
9. Viewer extensions load from `public/extensions/config.json`.
10. `AccIssuePins` loads ACC issues and draws pushpins in the viewer.
11. `Layout.js` receives issue events and renders Quick Filters, the issue table, and issue details.
12. If the user clicks switchback, `SwitchbackToRevit` creates the JSON payload and sends it to the server.
13. The Revit add-in reads the synced switchback data using the OTP/session information.

## Debugging Tips

If a button does nothing, search for its `id` or `data-*` attribute in `public/js/Layout.js`.

If a viewer action behaves wrong, check `ApsViewer.js` first, then the relevant extension.

If issue data looks wrong, check `routes/issues.js` first, then how `Layout.js` displays it.

If a name shows as an ID, look in `routes/issues.js` enrichment or `text-utils.js`.

If CSS looks wrong, inspect the element in the browser and then open the CSS file listed above.
