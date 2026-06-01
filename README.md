# HKS ACC-Revit Switchback

This app connects Autodesk ACC issues with the Autodesk Viewer and a Revit switchback workflow.

The main app does three things:

1. Loads ACC hubs, projects, folders, files, and file versions.
2. Loads ACC issues and shows them as viewer pins, a quick filter panel, and an issue table.
3. Creates switchback JSON/OTP data so the current viewer context can be used by the Revit side.

## Current App Extensions

Only these app-owned viewer extensions are loaded:

- `AccIssuePins` - loads ACC issues and renders issue pins in the viewer.
- `SwitchbackToRevit` - writes viewer camera/section data for the Revit switchback workflow.

Old APS boilerplate/demo extensions were removed from this repository because this app does not use them.

## Project Structure

- `start.js` - Express app startup.
- `config.js` - environment variable loading and validation.
- `routes/auth.js` - Autodesk sign-in and token routes.
- `routes/models.js` - ACC tree/model routes and switchback JSON route.
- `routes/issues.js` - ACC issue, issue settings, comments, thumbnail, and edit routes.
- `services/aps.js` - shared APS token and fetch helpers.
- `public/index.html` - main page markup.
- `public/css/main.css` - app layout and shared UI styles.
- `public/js/ApsTree.js` - left ACC hub/project/file tree.
- `public/js/ApsViewer.js` - Autodesk Viewer setup, model loading, view switching helpers.
- `public/js/Layout.js` - right panel UI, issue details, filters, and table.
- `public/js/RevitConnection.js` - Revit OTP panel logic.
- `public/extensions/AccIssuePins` - ACC issue pin viewer extension.
- `public/extensions/SwitchbackToRevit` - Revit switchback viewer extension.
- `switchback-output` - runtime folder for generated switchback files and the Dynamo helper file.

## Setup

Create a `.env` file in the project root:

```text
APS_CLIENT_ID=your_client_id
APS_CLIENT_SECRET=your_client_secret
APS_CALLBACK_URL=http://localhost:3000/auth/callback
SESSION_SECRET=use_a_long_random_value
```

Install packages:

```bash
npm install
```

Start the app:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Notes For Learning

This repository intentionally uses plain JavaScript loaded by script tags. There is no React build step or bundler here.

Most browser code uses simple globals because that matches the current project setup:

- `window.viewer`
- `window.currentModelInfo`
- `window.accIssuePinsSelectIssue`
- `window.openIssueInLatestViewable`

When refactoring, keep behavior first. Move code only when the new location makes ownership clearer.
