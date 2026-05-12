/////////////////////////////////////////////////////////////////////
// ACC Data Management tree routes for 3-legged user access
// Includes ACC Issues API enrichment for filters and issue details
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
    return projectId && String(projectId).startsWith('b.')
        ? String(projectId).substring(2)
        : String(projectId);
}

function valueOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    return value;
}

function normaliseId(value) {
    if (value === undefined || value === null || value === '') return null;

    if (typeof value === 'object') {
        return (
            value.id ||
            value.userId ||
            value.uid ||
            value.autodeskId ||
            value.accountUserId ||
            value.memberId ||
            value.companyId ||
            value.roleId ||
            value.attributes?.id ||
            value.attributes?.userId ||
            value.attributes?.uid ||
            value.attributes?.autodeskId ||
            value.attributes?.accountUserId ||
            value.attributes?.memberId ||
            value.attributes?.companyId ||
            value.attributes?.roleId ||
            null
        );
    }

    return String(value);
}

function isRawAutodeskId(value) {
    if (!value || typeof value !== 'string') return false;

    const trimmed = value.trim();

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return true;
    if (/^[0-9a-f]{24}$/i.test(trimmed)) return true;
    if (/^[A-Z0-9]{12,24}$/i.test(trimmed) && !trimmed.includes('@') && !trimmed.includes(' ')) return true;
    if (trimmed.startsWith('urn:')) return true;
    if (trimmed.startsWith('b.')) return true;

    return false;
}

function firstNonEmpty(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }

    return null;
}

function getDirectName(value) {
    if (!value) return null;

    if (typeof value === 'string') {
        return isRawAutodeskId(value) ? null : value;
    }

    if (typeof value !== 'object') {
        return String(value);
    }

    const firstName = firstNonEmpty(
        value.firstName,
        value.attributes?.firstName
    );

    const lastName = firstNonEmpty(
        value.lastName,
        value.attributes?.lastName
    );

    const combinedName = `${firstName || ''} ${lastName || ''}`.trim();

    return firstNonEmpty(
        value.name,
        value.displayName,
        value.fullName,
        value.email,
        value.title,
        value.label,
        value.companyName,
        value.roleName,
        value.attributes?.name,
        value.attributes?.displayName,
        value.attributes?.fullName,
        value.attributes?.email,
        value.attributes?.title,
        combinedName || null
    );
}

function addToMap(map, key, value) {
    if (!key || !value) return;

    const cleanKey = String(key).trim();
    const cleanValue = String(value).trim();

    if (!cleanKey || !cleanValue) return;

    map.set(cleanKey, cleanValue);
}

function addIdentityObject(map, entity) {
    if (!entity) return;

    const displayName = getDirectName(entity);

    if (!displayName) return;

    const keys = [
        entity.id,
        entity.userId,
        entity.uid,
        entity.autodeskId,
        entity.accountUserId,
        entity.memberId,
        entity.email,
        entity.companyId,
        entity.roleId,
        entity.attributes?.id,
        entity.attributes?.userId,
        entity.attributes?.uid,
        entity.attributes?.autodeskId,
        entity.attributes?.accountUserId,
        entity.attributes?.memberId,
        entity.attributes?.email,
        entity.attributes?.companyId,
        entity.attributes?.roleId
    ];

    keys.forEach(key => addToMap(map, key, displayName));
}

function addIssueTypeObject(typeMap, categoryMap, issueType) {
    if (!issueType) return;

    const issueTypeId = firstNonEmpty(
        issueType.id,
        issueType.issueTypeId,
        issueType.attributes?.id,
        issueType.attributes?.issueTypeId
    );

    const issueTypeName = firstNonEmpty(
        issueType.title,
        issueType.name,
        issueType.displayName,
        issueType.attributes?.title,
        issueType.attributes?.name,
        issueType.attributes?.displayName
    );

    const categoryName = firstNonEmpty(
        issueType.category,
        issueType.categoryName,
        issueType.attributes?.category,
        issueType.attributes?.categoryName
    );

    if (issueTypeId && issueTypeName) {
        addToMap(typeMap, issueTypeId, issueTypeName);
    }

    if (issueTypeId && categoryName) {
        addToMap(categoryMap, issueTypeId, categoryName);
    }

    const subtypes =
        issueType.subtypes ||
        issueType.issueSubtypes ||
        issueType.attributes?.subtypes ||
        issueType.attributes?.issueSubtypes ||
        [];

    if (Array.isArray(subtypes)) {
        subtypes.forEach(subtype => {
            const subtypeId = firstNonEmpty(
                subtype.id,
                subtype.issueSubtypeId,
                subtype.attributes?.id,
                subtype.attributes?.issueSubtypeId
            );

            const subtypeName = firstNonEmpty(
                subtype.title,
                subtype.name,
                subtype.displayName,
                subtype.attributes?.title,
                subtype.attributes?.name,
                subtype.attributes?.displayName
            );

            if (subtypeId && subtypeName) {
                addToMap(typeMap, subtypeId, subtypeName);
            }

            if (subtypeId && categoryName) {
                addToMap(categoryMap, subtypeId, categoryName);
            }
        });
    }
}

function addRootCauseObject(rootCauseMap, rootCause) {
    if (!rootCause) return;

    const id = firstNonEmpty(
        rootCause.id,
        rootCause.rootCauseId,
        rootCause.attributes?.id,
        rootCause.attributes?.rootCauseId
    );

    const name = firstNonEmpty(
        rootCause.title,
        rootCause.name,
        rootCause.displayName,
        rootCause.attributes?.title,
        rootCause.attributes?.name,
        rootCause.attributes?.displayName
    );

    if (id && name) {
        addToMap(rootCauseMap, id, name);
    }
}

async function apsFetchOptional(req, url, label) {
    try {
        return await apsFetch(req, url);
    } catch (error) {
        console.warn(`Optional ACC request failed${label ? ` (${label})` : ''}:`, error.status || '', error.message);
        return null;
    }
}

async function fetchAllPagesFlexible(req, startUrl, label) {
    let url = startUrl;
    const allData = [];

    while (url) {
        const body = await apsFetchOptional(req, url, label);

        if (!body) break;

        const pageData =
            body.data ||
            body.results ||
            body.users ||
            body.companies ||
            body.roles ||
            body.issueTypes ||
            body.issueSubtypes ||
            body.rootCauses ||
            [];

        if (Array.isArray(pageData)) {
            allData.push(...pageData);
        }

        const nextUrl =
            body.pagination?.nextUrl ||
            body.links?.next?.href ||
            body.meta?.pagination?.nextUrl ||
            null;

        url = nextUrl
            ? nextUrl.startsWith('http')
                ? nextUrl
                : `${APS_API_BASE}${nextUrl}`
            : null;
    }

    return allData;
}

async function buildProjectLookupMaps(req, accProjectId) {
    const identityMap = new Map();
    const typeMap = new Map();
    const categoryMap = new Map();
    const rootCauseMap = new Map();

    const users = await fetchAllPagesFlexible(
        req,
        `${APS_API_BASE}/construction/admin/v1/projects/${encodeURIComponent(accProjectId)}/users?limit=100`,
        'project users'
    );

    users.forEach(user => addIdentityObject(identityMap, user));

    const companies = await fetchAllPagesFlexible(
        req,
        `${APS_API_BASE}/construction/admin/v1/projects/${encodeURIComponent(accProjectId)}/companies?limit=100`,
        'project companies'
    );

    companies.forEach(company => addIdentityObject(identityMap, company));

    const roles = await fetchAllPagesFlexible(
        req,
        `${APS_API_BASE}/construction/admin/v1/projects/${encodeURIComponent(accProjectId)}/roles?limit=100`,
        'project roles'
    );

    roles.forEach(role => addIdentityObject(identityMap, role));

    const issueTypes = await fetchAllPagesFlexible(
        req,
        `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/issue-types?limit=100`,
        'issue types'
    );

    issueTypes.forEach(issueType => addIssueTypeObject(typeMap, categoryMap, issueType));

    const issueSubtypes = await fetchAllPagesFlexible(
        req,
        `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/issue-subtypes?limit=100`,
        'issue subtypes'
    );

    issueSubtypes.forEach(subtype => {
        const subtypeId = firstNonEmpty(
            subtype.id,
            subtype.issueSubtypeId,
            subtype.attributes?.id,
            subtype.attributes?.issueSubtypeId
        );

        const subtypeName = firstNonEmpty(
            subtype.title,
            subtype.name,
            subtype.displayName,
            subtype.attributes?.title,
            subtype.attributes?.name,
            subtype.attributes?.displayName
        );

        const issueTypeId = firstNonEmpty(
            subtype.issueTypeId,
            subtype.attributes?.issueTypeId
        );

        if (subtypeId && subtypeName) {
            addToMap(typeMap, subtypeId, subtypeName);
        }

        if (subtypeId && issueTypeId && categoryMap.has(issueTypeId)) {
            addToMap(categoryMap, subtypeId, categoryMap.get(issueTypeId));
        }
    });

    const rootCauses = await fetchAllPagesFlexible(
        req,
        `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/root-causes?limit=100`,
        'root causes'
    );

    rootCauses.forEach(rootCause => addRootCauseObject(rootCauseMap, rootCause));

    return {
        identityMap,
        typeMap,
        categoryMap,
        rootCauseMap
    };
}

function resolveIdentity(identityMap, value, fallback) {
    const directName = getDirectName(value);

    if (directName) return directName;

    const key = normaliseId(value);

    if (!key) return fallback || '';

    return identityMap.get(key) || fallback || '';
}

function resolveIssueTypeName(typeMap, issueTypeId, issueTypeObject, fallback) {
    const directName = getDirectName(issueTypeObject);

    if (directName) return directName;

    if (issueTypeId && typeMap.has(issueTypeId)) {
        return typeMap.get(issueTypeId);
    }

    return fallback || '';
}

function getIssueLocationName(issue) {
    return firstNonEmpty(
        issue.locationName,
        issue.locationDetails,
        issue.location?.name,
        issue.location?.displayName,
        issue.attributes?.locationName,
        issue.attributes?.locationDetails,
        issue.attributes?.location?.name,
        issue.attributes?.location?.displayName
    );
}

function getIssueAssignedToType(issue) {
    return firstNonEmpty(
        issue.assignedToType,
        issue.attributes?.assignedToType,
        issue.assigneeType
    );
}

function getIssueAssignedToValue(issue) {
    return firstNonEmpty(
        issue.assignedTo,
        issue.attributes?.assignedTo,
        issue.assignee
    );
}

function getIssueOpenedByValue(issue) {
    return firstNonEmpty(
        issue.openedBy,
        issue.attributes?.openedBy,
        issue.createdBy,
        issue.attributes?.createdBy
    );
}

function getIssueCreatedByValue(issue) {
    return firstNonEmpty(
        issue.createdBy,
        issue.attributes?.createdBy,
        issue.openedBy,
        issue.attributes?.openedBy
    );
}

function getIssueUpdatedByValue(issue) {
    return firstNonEmpty(
        issue.updatedBy,
        issue.attributes?.updatedBy
    );
}

function getIssueClosedByValue(issue) {
    return firstNonEmpty(
        issue.closedBy,
        issue.attributes?.closedBy
    );
}

function enrichIssue(issue, maps) {
    const {
        identityMap,
        typeMap,
        categoryMap,
        rootCauseMap
    } = maps;

    const assignedToType = getIssueAssignedToType(issue);
    const assignedToValue = getIssueAssignedToValue(issue);

    let assignedFallback = 'Assigned';

    if (!assignedToValue) {
        assignedFallback = 'Unassigned';
    } else if (String(assignedToType || '').toLowerCase().includes('company')) {
        assignedFallback = 'Unresolved company';
    } else if (String(assignedToType || '').toLowerCase().includes('role')) {
        assignedFallback = 'Unresolved role';
    } else {
        assignedFallback = 'Unresolved user';
    }

    const issueTypeId = firstNonEmpty(
        issue.issueTypeId,
        issue.attributes?.issueTypeId,
        issue.issueType?.id,
        issue.attributes?.issueType?.id
    );

    const issueSubtypeId = firstNonEmpty(
        issue.issueSubtypeId,
        issue.attributes?.issueSubtypeId,
        issue.issueSubtype?.id,
        issue.attributes?.issueSubtype?.id
    );

    const issueTypeName = resolveIssueTypeName(
        typeMap,
        issueTypeId,
        issue.issueType || issue.attributes?.issueType,
        issue.issueTypeName || issue.attributes?.issueTypeName || ''
    );

    const issueSubtypeName = resolveIssueTypeName(
        typeMap,
        issueSubtypeId,
        issue.issueSubtype || issue.attributes?.issueSubtype,
        issue.issueSubtypeName || issue.attributes?.issueSubtypeName || ''
    );

    const categoryName = firstNonEmpty(
        issue.categoryName,
        issue.category,
        issue.issueCategory,
        issue.attributes?.categoryName,
        issue.attributes?.category,
        issue.attributes?.issueCategory,
        categoryMap.get(issueSubtypeId),
        categoryMap.get(issueTypeId)
    );

    const rootCauseId = firstNonEmpty(
        issue.rootCauseId,
        issue.attributes?.rootCauseId,
        issue.rootCause?.id,
        issue.attributes?.rootCause?.id
    );

    const rootCauseName = firstNonEmpty(
        getDirectName(issue.rootCause),
        getDirectName(issue.attributes?.rootCause),
        rootCauseId ? rootCauseMap.get(rootCauseId) : null,
        issue.rootCauseName,
        issue.attributes?.rootCauseName
    );

    const assignedToDisplayName = resolveIdentity(identityMap, assignedToValue, assignedFallback);
    const openedByDisplayName = resolveIdentity(identityMap, getIssueOpenedByValue(issue), 'Unresolved user');
    const createdByDisplayName = resolveIdentity(identityMap, getIssueCreatedByValue(issue), 'Unresolved user');
    const updatedByDisplayName = resolveIdentity(identityMap, getIssueUpdatedByValue(issue), 'Unresolved user');
    const closedByDisplayName = resolveIdentity(identityMap, getIssueClosedByValue(issue), '');

    const locationName = getIssueLocationName(issue);

    return {
        ...issue,

        assignedToDisplayName,
        assignedToName: assignedToDisplayName,

        openedByDisplayName,
        openedByName: openedByDisplayName,

        createdByDisplayName,
        createdByName: createdByDisplayName,

        updatedByDisplayName,
        updatedByName: updatedByDisplayName,

        closedByDisplayName,
        closedByName: closedByDisplayName,

        issueTypeName: issueTypeName || '',
        issueSubtypeName: issueSubtypeName || '',
        categoryName: categoryName || '',

        rootCauseName: rootCauseName || '',
        locationName: locationName || ''
    };
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

        const maps = await buildProjectLookupMaps(req, accProjectId);

        let url = `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/issues?limit=${limit}`;

        while (url) {
            const body = await apsFetch(req, url);
            const pageIssues = body.data || body.results || body.issues || [];
            issues.push(...pageIssues);

            const nextUrl =
                body.pagination?.nextUrl ||
                body.links?.next?.href ||
                body.meta?.pagination?.nextUrl ||
                null;

            url = nextUrl
                ? nextUrl.startsWith('http')
                    ? nextUrl
                    : `${APS_API_BASE}${nextUrl}`
                : null;
        }

        const enrichedIssues = issues.map(issue => enrichIssue(issue, maps));

        const debugFolder = path.join(process.cwd(), 'switchback-output');

        if (!fs.existsSync(debugFolder)) {
            fs.mkdirSync(debugFolder, { recursive: true });
        }

        fs.writeFileSync(
            path.join(debugFolder, `latest-issues-${accProjectId}.json`),
            JSON.stringify(
                {
                    data: enrichedIssues,
                    count: enrichedIssues.length,
                    lookupCounts: {
                        identities: maps.identityMap.size,
                        issueTypes: maps.typeMap.size,
                        categories: maps.categoryMap.size,
                        rootCauses: maps.rootCauseMap.size
                    }
                },
                null,
                2
            ),
            'utf8'
        );

        res.json({
            data: enrichedIssues,
            count: enrichedIssues.length,
            lookupCounts: {
                identities: maps.identityMap.size,
                issueTypes: maps.typeMap.size,
                categories: maps.categoryMap.size,
                rootCauses: maps.rootCauseMap.size
            }
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