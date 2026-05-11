const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// 3-legged token
async function getAccessToken() {
  // Use your existing 3-legged APS token logic
  return { access_token: process.env.APS_3LEGGED_TOKEN, expires_in: 3599 };
}

// Resolve user/role/company names
async function resolveEntity(entityId, type, token) {
  if (!entityId) return null;
  try {
    let url;
    switch(type) {
      case 'user': url = `https://developer.api.autodesk.com/project/v1/users/${entityId}`; break;
      case 'company': url = `https://developer.api.autodesk.com/project/v1/companies/${entityId}`; break;
      case 'role': url = `https://developer.api.autodesk.com/project/v1/roles/${entityId}`; break;
      default: return entityId;
    }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return entityId;
    const data = await res.json();
    return data?.displayName || data?.attributes?.displayName || entityId;
  } catch {
    return entityId;
  }
}

// GET issues with resolved names + placement
router.get('/projects/:projectId/issues', async (req, res) => {
  try {
    const { projectId } = req.params;
    const tokenObj = await getAccessToken();
    const token = tokenObj.access_token;

    let issues = [];
    let nextUrl = `https://developer.api.autodesk.com/construction/issues/v1/projects/${projectId}/issues?limit=100`;

    // handle pagination
    while (nextUrl) {
      const response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) break;
      const body = await response.json();
      issues = issues.concat(body.data || []);
      nextUrl = body.pagination?.nextUrl || null;
    }

    const issuesWithNames = await Promise.all(issues.map(async (issue) => {
      const createdBy = await resolveEntity(issue.createdBy?.id, 'user', token);
      const updatedBy = await resolveEntity(issue.updatedBy?.id, 'user', token);

      let assignedTo = null;
      if (issue.assignedTo) {
        if (issue.assignedTo.type === 'user') assignedTo = await resolveEntity(issue.assignedTo.id, 'user', token);
        else if (issue.assignedTo.type === 'company') assignedTo = await resolveEntity(issue.assignedTo.id, 'company', token);
        else assignedTo = issue.assignedTo.name || issue.assignedTo.id;
      }

      // Section box around issue placement
      let sectionBox = null;
      if (issue.placements?.length > 0) {
        const pos = issue.placements[0].origin || { x:0, y:0, z:0 };
        const size = issue.sectionBoxSize || 5; // default bounding box size
        sectionBox = {
          min: { x: pos.x - size, y: pos.y - size, z: pos.z - size },
          max: { x: pos.x + size, y: pos.y + size, z: pos.z + size },
          center: pos
        };
      }

      return {
        ...issue,
        createdBy,
        updatedBy,
        assignedTo,
        sectionBox
      };
    }));

    res.json({ ok: true, data: issuesWithNames });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;