/////////////////////////////////////////////////////////////////////
// ACC Data Management tree routes for 3-legged user access
/////////////////////////////////////////////////////////////////////

const express = require('express');
const fs = require('fs');
const path = require('path');
const {
    APS_API_BASE,
    apsFetch,
    fetchAllPages,
    getViewerUrnFromVersion,
    getDisplayName
} = require('../services/aps.js');

let router = express.Router();

function requireAuth(req, res, next) {
    if (!req.session?.token?.access_token) {
        return res.status(401).json({ error: 'Not authenticated. Please sign in with Autodesk.' });
    }
    next();
}

function makeNode(entity, type, extra = {}) {
    return {
        id: extra.id || entity.id,
        text: extra.text || getDisplayName(entity),
        type,
        children: extra.children ?? false,
        data: {
            raw: entity,
            ...extra.data
        }
    };
}

function projectGuid(projectId) {
    return projectId && projectId.startsWith('b.') ? projectId.substring(2) : projectId;
}

router.get('/api/models/acc-tree', requireAuth, async function (req, res, next) {
    try {
        const id = req.query.id || '#';
        const type = req.query.type || null;

        if (id === '#') {
            const hubs = await fetchAllPages(req, `${APS_API_BASE}/project/v1/hubs`);
            return res.json(hubs.map(hub => makeNode(hub, 'hub', { children: true })));
        }

        if (type === 'hub') {
            const hubId = req.query.hubId || id;
            const projects = await fetchAllPages(
                req,
                `${APS_API_BASE}/project/v1/hubs/${encodeURIComponent(hubId)}/projects`
            );

            return res.json(projects.map(project => makeNode(project, 'project', {
                children: true,
                data: { hubId }
            })));
        }

        if (type === 'project') {
            const hubId = req.query.hubId;
            const projectId = req.query.projectId || id;

            const body = await apsFetch(
                req,
                `${APS_API_BASE}/project/v1/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/topFolders`
            );

            const topFolders = body.data || [];
            return res.json(topFolders.map(folder => makeNode(folder, 'folder', {
                children: true,
                data: { hubId, projectId }
            })));
        }

        if (type === 'folder') {
            const hubId = req.query.hubId;
            const projectId = req.query.projectId;
            const folderId = req.query.folderId || id;

            const contents = await fetchAllPages(
                req,
                `${APS_API_BASE}/data/v1/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}/contents`
            );

            return res.json(contents.map(entity => {
                const isFolder = entity.type === 'folders';
                return makeNode(entity, isFolder ? 'folder' : 'item', {
                    children: true,
                    data: {
                        hubId,
                        projectId,
                        folderId: entity.id
                    }
                });
            }));
        }

        if (type === 'item') {
            const hubId = req.query.hubId;
            const projectId = req.query.projectId;
            const itemId = req.query.itemId || id;

            const versions = await fetchAllPages(
                req,
                `${APS_API_BASE}/data/v1/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/versions`
            );

            return res.json(versions.map(version => {
                const versionNumber = version?.attributes?.versionNumber;
                const baseName = getDisplayName(version);
                const label = versionNumber ? `${baseName} - V${versionNumber}` : baseName;
                const viewerUrn = getViewerUrnFromVersion(version);

                return makeNode(version, 'version', {
                    id: version.id,
                    text: label,
                    children: false,
                    data: {
                        hubId,
                        projectId,
                        itemId,
                        viewerUrn,
                        versionId: version.id,
                        name: label
                    }
                });
            }));
        }

        res.json([]);
    } catch (err) {
        next(err);
    }
});

router.get('/api/projects/:projectId/issues', requireAuth, async function (req, res, next) {
    try {
        const rawProjectId = req.params.projectId;
        const accProjectId = projectGuid(rawProjectId);
        const issues = [];
        const limit = 100;

        let url = `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/issues?limit=${limit}`;

        while (url) {
            const body = await apsFetch(req, url);
            const pageIssues = body.data || body.results || body.issues || [];
            issues.push(...pageIssues);

            const nextUrl = body.pagination?.nextUrl || body.links?.next?.href || null;
            url = nextUrl ? (nextUrl.startsWith('http') ? nextUrl : `${APS_API_BASE}${nextUrl}`) : null;
        }

        const debugFolder = path.join(process.cwd(), 'switchback-output');
        if (!fs.existsSync(debugFolder)) {
            fs.mkdirSync(debugFolder, { recursive: true });
        }
        fs.writeFileSync(
            path.join(debugFolder, `latest-issues-${accProjectId}.json`),
            JSON.stringify({ data: issues, count: issues.length }, null, 2),
            'utf8'
        );

        res.json({
            data: issues,
            count: issues.length
        });
    } catch (err) {
        next(err);
    }
});

router.post('/api/switchback', requireAuth, async function (req, res, next) {
    try {
        const payload = req.body;
        const outputFolder = path.join(process.cwd(), 'switchback-output');

        if (!fs.existsSync(outputFolder)) {
            fs.mkdirSync(outputFolder, { recursive: true });
        }

        const filePath = path.join(outputFolder, 'latest-switchback.json');
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');

        res.json({
            ok: true,
            filePath,
            payload
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
