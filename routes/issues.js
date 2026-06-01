// Server routes for ACC Issues: loading, enriching, updating, comments, thumbnails, and settings.
// Do not put browser UI rendering code here.
const express = require('express');
const fs = require('fs');
const path = require('path');

const {
  APS_API_BASE,
  apsFetch,
  apsFetchTwoLegged
} = require('../services/aps.js');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session?.token?.access_token) {
    return res.status(401).json({
      error: 'Not authenticated. Please sign in with Autodesk.'
    });
  }

  next();
}

function stripB(value) {
  if (!value) return value;
  return String(value).startsWith('b.') ? String(value).substring(2) : String(value);
}

function projectGuid(projectId) {
  return stripB(projectId);
}

function accountGuid(accountId) {
  return stripB(accountId);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return null;
}

function normaliseKey(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim();
}

function normaliseId(value) {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'object') {
    return firstNonEmpty(
      value.member_group_id,
      value.memberGroupId,
      value.memberGroupID,
      value.memberGroup?.id,
      value.member_group?.id,
      value.id,
      value.userId,
      value.uid,
      value.autodeskId,
      value.accountUserId,
      value.memberId,
      value.companyId,
      value.roleId,
      value.attributes?.member_group_id,
      value.attributes?.memberGroupId,
      value.attributes?.memberGroupID,
      value.attributes?.memberGroup?.id,
      value.attributes?.member_group?.id,
      value.attributes?.id,
      value.attributes?.userId,
      value.attributes?.uid,
      value.attributes?.autodeskId,
      value.attributes?.accountUserId,
      value.attributes?.memberId,
      value.attributes?.companyId,
      value.attributes?.roleId,
      value.relationships?.memberGroup?.data?.id,
      value.relationships?.member_group?.data?.id
    );
  }

  return String(value);
}

function getCandidateKeys(value) {
  if (value === undefined || value === null || value === '') return [];

  if (typeof value !== 'object') {
    return [normaliseKey(value)].filter(Boolean);
  }

  const attributes = value.attributes || {};
  const relationships = value.relationships || {};

  return Array.from(new Set([
    value.member_group_id,
    value.memberGroupId,
    value.memberGroupID,
    value.memberGroup?.id,
    value.member_group?.id,
    attributes.member_group_id,
    attributes.memberGroupId,
    attributes.memberGroupID,
    attributes.memberGroup?.id,
    attributes.member_group?.id,
    relationships.memberGroup?.data?.id,
    relationships.member_group?.data?.id,
    value.id,
    attributes.id,
    value.userId,
    attributes.userId,
    value.uid,
    attributes.uid,
    value.autodeskId,
    value.autodesk_id,
    attributes.autodeskId,
    attributes.autodesk_id,
    value.accountUserId,
    attributes.accountUserId,
    value.memberId,
    attributes.memberId,
    value.companyId,
    attributes.companyId,
    value.accountCompanyId,
    attributes.accountCompanyId,
    value.roleId,
    attributes.roleId,
    value.email,
    attributes.email
  ].map(normaliseKey).filter(Boolean)));
}

function isRawAutodeskId(value) {
  if (!value || typeof value !== 'string') return false;

  const trimmed = value.trim();

  if (/^[0-9]+$/.test(trimmed)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return true;
  if (/^[0-9a-f]{24}$/i.test(trimmed)) return true;
  if (/^[A-Z0-9]{12,24}$/i.test(trimmed) && !trimmed.includes('@') && !trimmed.includes(' ')) return true;
  if (trimmed.startsWith('urn:')) return true;
  if (trimmed.startsWith('b.')) return true;

  return false;
}

function getDirectName(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    return isRawAutodeskId(value) ? null : value;
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  const attributes = value.attributes || {};

  const firstName = firstNonEmpty(
    value.firstName,
    attributes.firstName
  );

  const lastName = firstNonEmpty(
    value.lastName,
    attributes.lastName
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
    attributes.name,
    attributes.displayName,
    attributes.fullName,
    attributes.email,
    attributes.title,
    attributes.companyName,
    attributes.roleName,
    combinedName || null
  );
}

function getIssueSnapshotUrn(issue) {
  return firstNonEmpty(
    issue?.snapshotUrn,
    issue?.attributes?.snapshotUrn,
    issue?.snapshot?.urn,
    issue?.attributes?.snapshot?.urn
  );
}

function parseOssObjectUrn(urn) {
  let value = String(urn || '').trim();

  if (value && !value.startsWith('urn:')) {
    try {
      const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
      const padding = '='.repeat((4 - (base64.length % 4)) % 4);
      const decoded = Buffer.from(base64 + padding, 'base64').toString('utf8').trim();

      if (decoded.startsWith('urn:')) {
        value = decoded;
      }
    } catch (_) {}
  }

  const match = /^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/i.exec(value);

  if (!match) return null;

  return {
    bucketKey: match[1],
    objectName: match[2]
  };
}

async function getSignedObjectDownloadUrl(req, objectInfo) {
  const signedUrl =
    `${APS_API_BASE}/oss/v2/buckets/${encodeURIComponent(objectInfo.bucketKey)}` +
    `/objects/${encodeURIComponent(objectInfo.objectName)}/signeds3download?minutesExpiration=10`;
  const body = await apsFetch(req, signedUrl);

  return firstNonEmpty(
    body?.url,
    body?.signedUrl,
    body?.signedURL,
    body?.downloadUrl,
    body?.downloadURL,
    body?.data?.url,
    body?.data?.signedUrl
  );
}

function cleanAssigneeName(name, type) {
  if (!name) return name;

  let clean = String(name).trim();

  if (String(type || '').toLowerCase() === 'role') {
    clean = clean.replace(/^\d+\s+/, '').replace(/\s+\(role\)$/i, '').trim();
  }

  return clean;
}

function getUserRoleObjects(user) {
  if (!user || typeof user !== 'object') return [];

  const attributes = user.attributes || {};
  const candidates = [
    user.role,
    user.roles,
    user.projectRole,
    user.projectRoles,
    user.industryRole,
    user.industryRoles,
    user.industry_roles,
    attributes.role,
    attributes.roles,
    attributes.projectRole,
    attributes.projectRoles,
    attributes.industryRole,
    attributes.industryRoles,
    attributes.industry_roles
  ];

  return candidates.flatMap(value => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return [value];
  });
}

function buildProjectRoleOptions(users, roles) {
  const roleOptions = uniqueOptions(roles.map(role => makeOption(role, 'role', 'Role')));
  const rolesByKey = new Map();
  const rolesByName = new Map();

  roleOptions.forEach(option => {
    rolesByKey.set(option.id, option);
    getCandidateKeys(option.raw).forEach(key => rolesByKey.set(key, option));
    rolesByName.set(cleanAssigneeName(option.name, 'role').toLowerCase(), option);
  });

  const projectRoleOptions = [];

  users.forEach(user => {
    getUserRoleObjects(user).forEach(role => {
      const directOption = makeOption(role, 'role', 'Role');

      if (!directOption || directOption.name === 'Role') {
        return;
      }

      const matchedByKey = getCandidateKeys(role).some(key => {
        const option = rolesByKey.get(key);
        if (option) {
          projectRoleOptions.push(option);
          return true;
        }

        return false;
      });

      if (matchedByKey) return;

      const matchedByName = rolesByName.get(cleanAssigneeName(directOption.name, 'role').toLowerCase());
      if (matchedByName) {
        projectRoleOptions.push(matchedByName);
        return;
      }

      if (typeof role === 'object') {
        projectRoleOptions.push(directOption);
      }
    });
  });

  return projectRoleOptions.length > 0
    ? uniqueOptions(projectRoleOptions)
    : roleOptions;
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

  getCandidateKeys(entity).forEach(key => addToMap(map, key, displayName));
}

function addCompanyObject(companyMap, company) {
  if (!company) return;

  const displayName = getDirectName(company);

  if (!displayName) return;

  getCandidateKeys(company).forEach(key => addToMap(companyMap, key, displayName));

  const attributes = company.attributes || {};

  [
    company.member_group_id,
    company.memberGroupId,
    company.memberGroupID,
    company.memberGroup?.id,
    company.member_group?.id,
    attributes.member_group_id,
    attributes.memberGroupId,
    attributes.memberGroupID,
    attributes.memberGroup?.id,
    attributes.member_group?.id
  ].forEach(key => addToMap(companyMap, key, displayName));
}

function addRoleObject(roleMap, role) {
  if (!role) return;

  const displayName = cleanAssigneeName(getDirectName(role), 'role');

  if (!displayName) return;

  getCandidateKeys(role).forEach(key => addToMap(roleMap, key, displayName));
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
    if (error.status === 404) {
      return null;
    }

    console.warn(
      `Optional 3-legged ACC request failed${label ? ` (${label})` : ''}:`,
      error.status || '',
      error.message,
      error.details || ''
    );

    return null;
  }
}

async function apsFetchTwoLeggedOptional(url, label) {
  try {
    return await apsFetchTwoLegged(url);
  } catch (error) {
    console.warn(
      `Optional 2-legged APS request failed${label ? ` (${label})` : ''}:`,
      error.status || '',
      error.message,
      error.details || ''
    );

    return null;
  }
}

function extractPageData(body) {
  if (Array.isArray(body)) return body;

  return (
    body?.data ||
    body?.results ||
    body?.users ||
    body?.companies ||
    body?.roles ||
    body?.industry_roles ||
    body?.issueTypes ||
    body?.issueSubtypes ||
    body?.rootCauses ||
    []
  );
}

function getNextUrl(body) {
  if (Array.isArray(body)) return null;

  return (
    body?.pagination?.nextUrl ||
    body?.links?.next?.href ||
    body?.meta?.pagination?.nextUrl ||
    body?.page?.nextUrl ||
    null
  );
}

async function fetchAllPagesFlexible(req, startUrl, label) {
  let url = startUrl;
  const allData = [];

  while (url) {
    const body = await apsFetchOptional(req, url, label);

    if (!body) break;

    const pageData = extractPageData(body);

    if (Array.isArray(pageData)) {
      allData.push(...pageData);
    }

    const nextUrl = getNextUrl(body);

    url = nextUrl
      ? nextUrl.startsWith('http')
        ? nextUrl
        : `${APS_API_BASE}${nextUrl}`
      : null;
  }

  return allData;
}

async function fetchAllPagesFlexibleTwoLegged(startUrl, label) {
  let url = startUrl;
  const allData = [];

  while (url) {
    const body = await apsFetchTwoLeggedOptional(url, label);

    if (!body) break;

    const pageData = extractPageData(body);

    if (Array.isArray(pageData)) {
      allData.push(...pageData);
    }

    const nextUrl = getNextUrl(body);

    url = nextUrl
      ? nextUrl.startsWith('http')
        ? nextUrl
        : `${APS_API_BASE}${nextUrl}`
      : null;
  }

  return allData;
}

function getAccountIdFromRequest(req) {
  return accountGuid(
    req.query.accountId ||
    req.query.hubId ||
    req.headers['x-acc-account-id'] ||
    req.headers['x-acc-hub-id'] ||
    null
  );
}

async function buildProjectLookupMaps(req, accProjectId, accAccountId, issues) {
  const identityMap = new Map();
  const companyMap = new Map();
  const roleMap = new Map();
  const typeMap = new Map();
  const categoryMap = new Map();
  const rootCauseMap = new Map();

  const lookupDebug = {
    accountId: accAccountId || null,
    projectId: accProjectId,
    projectUsers: 0,
    hqProjectCompanies: 0,
    hqIndustryRoles: 0,
    issueHarvestedAssigneeObjects: 0,
    twoLeggedCompaniesAttempted: false,
    twoLeggedRolesAttempted: false
  };

  const users = await fetchAllPagesFlexible(
    req,
    `${APS_API_BASE}/construction/admin/v1/projects/${encodeURIComponent(accProjectId)}/users?limit=100`,
    'project users'
  );

  users.forEach(user => addIdentityObject(identityMap, user));
  lookupDebug.projectUsers = users.length;

  if (accAccountId) {
    lookupDebug.twoLeggedCompaniesAttempted = true;

    const hqProjectCompanies = await fetchAllPagesFlexibleTwoLegged(
      `${APS_API_BASE}/hq/v1/accounts/${encodeURIComponent(accAccountId)}/projects/${encodeURIComponent(accProjectId)}/companies`,
      'HQ project companies by member_group_id'
    );

    hqProjectCompanies.forEach(company => addCompanyObject(companyMap, company));
    lookupDebug.hqProjectCompanies = hqProjectCompanies.length;

    lookupDebug.twoLeggedRolesAttempted = true;

    const hqIndustryRoles = await fetchAllPagesFlexibleTwoLegged(
      `${APS_API_BASE}/hq/v2/accounts/${encodeURIComponent(accAccountId)}/projects/${encodeURIComponent(accProjectId)}/industry_roles`,
      'HQ project industry roles'
    );

    hqIndustryRoles.forEach(role => addRoleObject(roleMap, role));
    lookupDebug.hqIndustryRoles = hqIndustryRoles.length;
  } else {
    console.warn('No accountId/hubId was supplied to the issues route. Company and role 2-legged lookups were skipped.');
  }

  harvestAssigneeObjectsFromIssues(issues || [], identityMap, companyMap, roleMap, lookupDebug);

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
    companyMap,
    roleMap,
    typeMap,
    categoryMap,
    rootCauseMap,
    lookupDebug
  };
}

function harvestAssigneeObjectsFromIssues(issues, identityMap, companyMap, roleMap, lookupDebug) {
  const visited = new WeakSet();
  let count = 0;

  function visit(value) {
    if (!value || typeof value !== 'object') return;

    if (visited.has(value)) return;
    visited.add(value);

    const directName = getDirectName(value);
    const keys = getCandidateKeys(value);
    const type = String(
      value.type ||
      value.assigneeType ||
      value.assignedToType ||
      value.attributes?.type ||
      value.attributes?.assigneeType ||
      value.attributes?.assignedToType ||
      ''
    ).toLowerCase();

    if (directName && keys.length > 0) {
      if (type.includes('company')) {
        keys.forEach(key => addToMap(companyMap, key, directName));
        count += 1;
      } else if (type.includes('role')) {
        keys.forEach(key => addToMap(roleMap, key, directName));
        count += 1;
      } else if (type.includes('user') || value.email || value.attributes?.email) {
        keys.forEach(key => addToMap(identityMap, key, directName));
        count += 1;
      }
    }

    Object.values(value).forEach(child => {
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else if (child && typeof child === 'object') {
        visit(child);
      }
    });
  }

  issues.forEach(visit);
  lookupDebug.issueHarvestedAssigneeObjects = count;
}

function resolveFromMap(map, value) {
  const directName = getDirectName(value);

  if (directName) return directName;

  const keys = getCandidateKeys(value);

  for (const key of keys) {
    if (map.has(key)) return map.get(key);
  }

  const id = normaliseId(value);
  if (id && map.has(id)) return map.get(id);

  return null;
}

function resolveIdentity(identityMap, value, fallback) {
  return resolveFromMap(identityMap, value) || fallback || '';
}

function resolveCompany(companyMap, value, fallback) {
  return resolveFromMap(companyMap, value) || fallback || '';
}

function resolveRole(roleMap, value, fallback) {
  return resolveFromMap(roleMap, value) || fallback || '';
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
    issue.assignee,
    issue.member_group_id,
    issue.memberGroupId,
    issue.attributes?.member_group_id,
    issue.attributes?.memberGroupId
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

function isPlaceholderDisplayName(value) {
  const clean = String(value || '').trim().toLowerCase();

  return !clean ||
    clean === '-' ||
    clean === 'user' ||
    clean === 'unknown' ||
    clean === 'unknown user' ||
    clean === 'unresolved user' ||
    isRawAutodeskId(clean);
}

function cleanDisplayName(value) {
  const clean = String(value || '').trim();
  return isPlaceholderDisplayName(clean) ? '' : clean;
}

function getCommentCreatedByValue(comment) {
  return comment?.createdBy || null;
}

function getCommentDirectAuthorName(comment) {
  return cleanDisplayName(firstNonEmpty(
    comment.createdByDisplayName,
    comment.createdByName,
    getDirectName(comment.createdBy)
  ));
}

function enrichComment(comment, identityMap) {
  const directAuthorName = getCommentDirectAuthorName(comment);
  const resolvedAuthorName = cleanDisplayName(resolveIdentity(identityMap, getCommentCreatedByValue(comment), ''));
  const authorName = directAuthorName || resolvedAuthorName;

  if (!authorName) return comment;

  return {
    ...comment,
    createdByDisplayName: authorName,
    createdByName: authorName
  };
}

async function buildProjectIdentityMap(req, accProjectId) {
  const identityMap = new Map();
  const users = await fetchAllPagesFlexible(
    req,
    `${APS_API_BASE}/construction/admin/v1/projects/${encodeURIComponent(accProjectId)}/users?limit=100`,
    'project users'
  );

  users.forEach(user => addIdentityObject(identityMap, user));

  return identityMap;
}

function getUnresolvedAssigneeLabel(assignedType, assignedToValue) {
  const id = normaliseId(assignedToValue);

  if (String(assignedType || '').toLowerCase().includes('company')) {
    return id ? `Company ${id}` : 'Unresolved company';
  }

  if (String(assignedType || '').toLowerCase().includes('role')) {
    return id ? `Role ${id}` : 'Unresolved role';
  }

  if (String(assignedType || '').toLowerCase().includes('user')) {
    return id ? `User ${id}` : 'Unresolved user';
  }

  return id ? `Assignee ${id}` : 'Unassigned';
}

function enrichIssue(issue, maps) {
  const {
    identityMap,
    companyMap,
    roleMap,
    typeMap,
    categoryMap,
    rootCauseMap
  } = maps;

  const assignedToType = getIssueAssignedToType(issue);
  const assignedToValue = getIssueAssignedToValue(issue);
  const assignedTypeText = String(assignedToType || '').toLowerCase();

  let assignedToDisplayName = '';

  if (!assignedToValue) {
    assignedToDisplayName = 'Unassigned';
  } else if (assignedTypeText.includes('company')) {
    assignedToDisplayName = resolveCompany(companyMap, assignedToValue, getUnresolvedAssigneeLabel(assignedToType, assignedToValue));
  } else if (assignedTypeText.includes('role')) {
    assignedToDisplayName = resolveRole(roleMap, assignedToValue, getUnresolvedAssigneeLabel(assignedToType, assignedToValue));
  } else {
    assignedToDisplayName = resolveIdentity(identityMap, assignedToValue, getUnresolvedAssigneeLabel(assignedToType, assignedToValue));
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

function optionId(entity) {
  return firstNonEmpty(normaliseId(entity), ...getCandidateKeys(entity));
}

function makeOption(entity, type, fallbackName) {
  const id = optionId(entity);
  const name = cleanAssigneeName(getDirectName(entity) || fallbackName || id, type);

  if (!id || !name) return null;

  return {
    id: String(id),
    name: String(name),
    type,
    label: type === 'user' ? 'Member' : type === 'role' ? 'Role' : 'Company',
    raw: entity
  };
}

function uniqueOptions(options) {
  const seen = new Set();

  return options
    .filter(Boolean)
    .filter(option => {
      const key = `${option.type}:${option.id}`;

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getIssueTypeId(issueType) {
  return firstNonEmpty(
    issueType?.id,
    issueType?.issueTypeId,
    issueType?.attributes?.id,
    issueType?.attributes?.issueTypeId
  );
}

function getIssueTypeName(issueType) {
  return firstNonEmpty(
    issueType?.title,
    issueType?.name,
    issueType?.displayName,
    issueType?.attributes?.title,
    issueType?.attributes?.name,
    issueType?.attributes?.displayName
  );
}

function getIssueTypeCategory(issueType) {
  return firstNonEmpty(
    issueType?.category,
    issueType?.categoryName,
    issueType?.attributes?.category,
    issueType?.attributes?.categoryName
  );
}

function getSubtypesFromIssueType(issueType) {
  return (
    issueType?.subtypes ||
    issueType?.issueSubtypes ||
    issueType?.attributes?.subtypes ||
    issueType?.attributes?.issueSubtypes ||
    []
  );
}

function buildIssueTypeOptions(issueTypes, issueSubtypes) {
  const issueTypeById = new Map();
  const options = [];

  issueTypes.forEach(issueType => {
    const issueTypeId = getIssueTypeId(issueType);
    const issueTypeName = getIssueTypeName(issueType);
    const categoryName = getIssueTypeCategory(issueType) || issueTypeName || '';

    if (issueTypeId) {
      issueTypeById.set(issueTypeId, {
        id: String(issueTypeId),
        name: issueTypeName || String(issueTypeId),
        categoryName
      });
    }

    const subtypes = getSubtypesFromIssueType(issueType);

    if (Array.isArray(subtypes)) {
      subtypes.forEach(subtype => {
        const subtypeId = getIssueTypeId(subtype);
        const subtypeName = getIssueTypeName(subtype);

        if (!subtypeId || !subtypeName) return;

        options.push({
          id: String(subtypeId),
          name: String(subtypeName),
          issueTypeId: issueTypeId ? String(issueTypeId) : '',
          issueTypeName: issueTypeName || '',
          categoryName
        });
      });
    }
  });

  issueSubtypes.forEach(subtype => {
    const subtypeId = getIssueTypeId(subtype);
    const subtypeName = getIssueTypeName(subtype);
    const issueTypeId = firstNonEmpty(subtype.issueTypeId, subtype.attributes?.issueTypeId);
    const parent = issueTypeId ? issueTypeById.get(issueTypeId) : null;

    if (!subtypeId || !subtypeName) return;

    options.push({
      id: String(subtypeId),
      name: String(subtypeName),
      issueTypeId: issueTypeId ? String(issueTypeId) : '',
      issueTypeName: parent?.name || '',
      categoryName: parent?.categoryName || ''
    });
  });

  return uniqueOptions(options.map(option => ({
    ...option,
    type: 'issueSubtype'
  })));
}

function getRootCauseId(rootCause) {
  return firstNonEmpty(
    rootCause?.id,
    rootCause?.rootCauseId,
    rootCause?.attributes?.id,
    rootCause?.attributes?.rootCauseId
  );
}

function getRootCauseName(rootCause) {
  return firstNonEmpty(
    rootCause?.title,
    rootCause?.name,
    rootCause?.displayName,
    rootCause?.attributes?.title,
    rootCause?.attributes?.name,
    rootCause?.attributes?.displayName
  );
}

function buildRootCauseOptions(rootCauseCategories, rootCauses) {
  const options = [];

  rootCauseCategories.forEach(category => {
    const categoryName = getRootCauseName(category) || '';
    const children = category?.rootCauses || category?.root_causes || category?.attributes?.rootCauses || [];

    if (Array.isArray(children)) {
      children.forEach(rootCause => {
        const id = getRootCauseId(rootCause);
        const name = getRootCauseName(rootCause);

        if (!id || !name) return;

        options.push({
          id: String(id),
          name: String(name),
          categoryName,
          type: 'rootCause'
        });
      });
    }
  });

  rootCauses.forEach(rootCause => {
    const id = getRootCauseId(rootCause);
    const name = getRootCauseName(rootCause);

    if (!id || !name) return;

    options.push({
      id: String(id),
      name: String(name),
      categoryName: '',
      type: 'rootCause'
    });
  });

  return uniqueOptions(options);
}

function getCustomAttributeOptions(definition) {
  const candidates = [
    definition?.options,
    definition?.values,
    definition?.listOptions,
    definition?.allowedValues,
    definition?.possibleValues,
    definition?.permittedValues,
    definition?.metadata?.options,
    definition?.metadata?.values,
    definition?.metadata?.listOptions,
    definition?.metadata?.list?.options,
    definition?.metadata?.list?.values,
    definition?.metadata?.allowedValues,
    definition?.metadata?.possibleValues,
    definition?.metadata?.permittedValues,
    definition?.attributes?.options,
    definition?.attributes?.values,
    definition?.attributes?.listOptions,
    definition?.attributes?.allowedValues,
    definition?.attributes?.possibleValues,
    definition?.attributes?.permittedValues,
    definition?.attributes?.metadata?.options,
    definition?.attributes?.metadata?.values,
    definition?.attributes?.metadata?.listOptions,
    definition?.attributes?.metadata?.list?.options,
    definition?.attributes?.metadata?.list?.values,
    definition?.attributes?.metadata?.allowedValues,
    definition?.attributes?.metadata?.possibleValues,
    definition?.attributes?.metadata?.permittedValues
  ];

  const values = candidates.find(Array.isArray) || [];

  return values.map(option => {
    const id = typeof option === 'object'
      ? firstNonEmpty(option?.id, option?.value, option?.key)
      : option;
    const name = typeof option === 'object'
      ? firstNonEmpty(option?.title, option?.name, option?.label, option?.displayName, option?.value, id)
      : option;

    if (!id || !name) return null;

    return {
      id: String(id),
      name: String(name)
    };
  }).filter(Boolean);
}

function buildCustomAttributeDefinitions(definitions) {
  return definitions.map(definition => {
    const id = firstNonEmpty(
      definition?.id,
      definition?.attributeDefinitionId,
      definition?.attributes?.id,
      definition?.attributes?.attributeDefinitionId
    );

    const title = firstNonEmpty(
      definition?.title,
      definition?.name,
      definition?.displayName,
      definition?.attributes?.title,
      definition?.attributes?.name,
      definition?.attributes?.displayName
    );

    if (!id || !title) return null;

    return {
      id: String(id),
      title: String(title),
      type: firstNonEmpty(
        definition?.type,
        definition?.dataType,
        definition?.fieldType,
        definition?.customFieldType,
        definition?.metadata?.type,
        definition?.metadata?.dataType,
        definition?.attributes?.type,
        definition?.attributes?.dataType,
        definition?.attributes?.fieldType,
        definition?.attributes?.customFieldType,
        definition?.attributes?.metadata?.type,
        definition?.attributes?.metadata?.dataType,
        'text'
      ),
      options: getCustomAttributeOptions(definition),
      raw: definition
    };
  }).filter(Boolean);
}

async function buildIssueSettings(req, accProjectId, accAccountId) {
  const users = await fetchAllPagesFlexible(
    req,
    `${APS_API_BASE}/construction/admin/v1/projects/${encodeURIComponent(accProjectId)}/users?limit=100`,
    'project users'
  );

  const companies = accAccountId
    ? await fetchAllPagesFlexibleTwoLegged(
      `${APS_API_BASE}/hq/v1/accounts/${encodeURIComponent(accAccountId)}/projects/${encodeURIComponent(accProjectId)}/companies`,
      'HQ project companies'
    )
    : [];

  const roles = accAccountId
    ? await fetchAllPagesFlexibleTwoLegged(
      `${APS_API_BASE}/hq/v2/accounts/${encodeURIComponent(accAccountId)}/projects/${encodeURIComponent(accProjectId)}/industry_roles`,
      'HQ project industry roles'
    )
    : [];

  const issueTypes = await fetchAllPagesFlexible(
    req,
    `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/issue-types?limit=100&include=subtypes`,
    'issue types'
  );

  const issueSubtypes = await fetchAllPagesFlexible(
    req,
    `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/issue-subtypes?limit=100`,
    'issue subtypes'
  );

  const rootCauseCategories = await fetchAllPagesFlexible(
    req,
    `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/issue-root-cause-categories?limit=100&include=rootcauses`,
    'root cause categories'
  );

  const rootCauses = await fetchAllPagesFlexible(
    req,
    `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/root-causes?limit=100`,
    'root causes'
  );

  const customAttributeDefinitions = await fetchAllPagesFlexible(
    req,
    `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/issue-attribute-definitions?limit=100`,
    'custom attribute definitions'
  );

  const customAttributeMappings = await fetchAllPagesFlexible(
    req,
    `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/issue-attribute-mappings?limit=100`,
    'custom attribute mappings'
  );

  const userProfile = await apsFetchOptional(
    req,
    `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/users/me`,
    'issue user profile'
  );

  const assignees = uniqueOptions([
    ...users.map(user => makeOption(user, 'user', 'User')),
    ...companies.map(company => makeOption(company, 'company', 'Company')),
    ...buildProjectRoleOptions(users, roles)
  ]);

  return {
    projectId: accProjectId,
    accountId: accAccountId || null,
    statuses: ['draft', 'open', 'pending', 'in_review', 'closed'],
    assignees,
    issueTypes: issueTypes.map(type => ({
      id: String(getIssueTypeId(type) || ''),
      name: String(getIssueTypeName(type) || ''),
      categoryName: String(getIssueTypeCategory(type) || '')
    })).filter(type => type.id && type.name),
    issueSubtypes: buildIssueTypeOptions(issueTypes, issueSubtypes),
    rootCauses: buildRootCauseOptions(rootCauseCategories, rootCauses),
    customAttributeDefinitions: buildCustomAttributeDefinitions(customAttributeDefinitions),
    customAttributeMappings,
    userProfile
  };
}

async function fetchIssueById(req, accProjectId, issueId) {
  const body = await apsFetch(
    req,
    `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/issues/${encodeURIComponent(issueId)}`
  );

  return body?.data || body?.issue || body;
}

async function enrichSingleIssue(req, accProjectId, accAccountId, issue) {
  const maps = await buildProjectLookupMaps(req, accProjectId, accAccountId, [issue]);
  return enrichIssue(issue, maps);
}

const PATCHABLE_ISSUE_ATTRIBUTES = new Set([
  'title',
  'description',
  'issueTypeId',
  'issueSubtypeId',
  'status',
  'assignedTo',
  'assignedToType',
  'dueDate',
  'startDate',
  'locationId',
  'locationDetails',
  'rootCauseId',
  'officialResponse',
  'customAttributes',
  'published',
  'watchers',
  'watcherObjects',
  'gpsCoordinates'
]);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function nullableString(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return String(value);
}

function normaliseCustomAttributes(value) {
  if (!Array.isArray(value)) return undefined;

  return value
    .map(attribute => {
      const attributeDefinitionId = firstNonEmpty(
        attribute?.attributeDefinitionId,
        attribute?.id
      );

      if (!attributeDefinitionId) return null;

      return {
        attributeDefinitionId: String(attributeDefinitionId),
        value: attribute?.value === undefined || attribute?.value === '' ? null : attribute.value
      };
    })
    .filter(Boolean);
}

function normaliseWatcherObjects(value) {
  if (!Array.isArray(value)) return undefined;

  return value
    .map(watcher => {
      const id = firstNonEmpty(watcher?.id, watcher?.value);
      const type = firstNonEmpty(watcher?.type, watcher?.assignedToType);

      if (!id || !type) return null;

      return {
        id: String(id),
        type: String(type)
      };
    })
    .filter(Boolean);
}

function buildIssuePatchPayload(input, currentIssue) {
  const source = input?.updates && typeof input.updates === 'object'
    ? input.updates
    : input || {};

  const permittedAttributes = new Set(
    Array.isArray(currentIssue?.permittedAttributes)
      ? currentIssue.permittedAttributes
      : []
  );

  const permittedStatuses = new Set(
    Array.isArray(currentIssue?.permittedStatuses)
      ? currentIssue.permittedStatuses
      : []
  );

  const payload = {};

  PATCHABLE_ISSUE_ATTRIBUTES.forEach(attribute => {
    if (!hasOwn(source, attribute)) return;

    if (permittedAttributes.size > 0 && !permittedAttributes.has(attribute)) {
      return;
    }

    const value = source[attribute];

    if (['title', 'description', 'status', 'assignedTo', 'assignedToType', 'dueDate', 'startDate', 'locationId', 'locationDetails', 'rootCauseId', 'officialResponse', 'issueTypeId', 'issueSubtypeId'].includes(attribute)) {
      const cleanValue = nullableString(value);

      if (attribute === 'status' && cleanValue && permittedStatuses.size > 0 && !permittedStatuses.has(cleanValue)) {
        return;
      }

      payload[attribute] = cleanValue;
      return;
    }

    if (attribute === 'published') {
      payload.published = value === true || value === 'true';
      return;
    }

    if (attribute === 'customAttributes') {
      const customAttributes = normaliseCustomAttributes(value);
      if (customAttributes) payload.customAttributes = customAttributes;
      return;
    }

    if (attribute === 'watcherObjects') {
      const watcherObjects = normaliseWatcherObjects(value);
      if (watcherObjects) payload.watcherObjects = watcherObjects;
      return;
    }

    if (attribute === 'watchers') {
      payload.watchers = Array.isArray(value) ? value.map(String) : [];
      return;
    }

    payload[attribute] = value;
  });

  return payload;
}

router.get('/api/projects/:projectId/issues/settings', requireAuth, async function (req, res, next) {
  try {
    const accProjectId = projectGuid(req.params.projectId);
    const accAccountId = getAccountIdFromRequest(req);
    const settings = await buildIssueSettings(req, accProjectId, accAccountId);

    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.get('/api/projects/:projectId/issues/:issueId', requireAuth, async function (req, res, next) {
  try {
    const accProjectId = projectGuid(req.params.projectId);
    const accAccountId = getAccountIdFromRequest(req);
    const issue = await fetchIssueById(req, accProjectId, req.params.issueId);
    const enrichedIssue = await enrichSingleIssue(req, accProjectId, accAccountId, issue);

    res.json({
      data: enrichedIssue
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/projects/:projectId/issues/:issueId/thumbnail', requireAuth, async function (req, res, next) {
  try {
    const accProjectId = projectGuid(req.params.projectId);
    const issue = await fetchIssueById(req, accProjectId, req.params.issueId);
    const snapshotUrn = getIssueSnapshotUrn(issue);
    const objectInfo = parseOssObjectUrn(snapshotUrn);

    if (!objectInfo) {
      return res.status(404).json({
        error: 'Issue thumbnail is not available.'
      });
    }

    const downloadUrl = await getSignedObjectDownloadUrl(req, objectInfo);

    if (!downloadUrl) {
      return res.status(404).json({
        error: 'Issue thumbnail download URL is not available.'
      });
    }

    res.setHeader('Cache-Control', 'private, max-age=300');
    res.redirect(downloadUrl);
  } catch (err) {
    next(err);
  }
});

router.patch('/api/projects/:projectId/issues/:issueId', requireAuth, async function (req, res, next) {
  try {
    const accProjectId = projectGuid(req.params.projectId);
    const accAccountId = getAccountIdFromRequest(req);
    const issueId = req.params.issueId;
    const currentIssue = await fetchIssueById(req, accProjectId, issueId);
    const payload = buildIssuePatchPayload(req.body, currentIssue);

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({
        error: 'No permitted issue fields were supplied for update.'
      });
    }

    const patchedBody = await apsFetch(
      req,
      `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/issues/${encodeURIComponent(issueId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload)
      }
    );

    const patchedIssue = patchedBody?.data || patchedBody?.issue || patchedBody;
    const freshIssue = patchedIssue && Object.keys(patchedIssue).length > 0
      ? patchedIssue
      : await fetchIssueById(req, accProjectId, issueId);

    const enrichedIssue = await enrichSingleIssue(req, accProjectId, accAccountId, freshIssue);

    res.json({
      data: enrichedIssue,
      patched: Object.keys(payload)
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/projects/:projectId/issues/:issueId/comments', requireAuth, async function (req, res, next) {
  try {
    const accProjectId = projectGuid(req.params.projectId);
    const comments = await fetchAllPagesFlexible(
      req,
      `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/issues/${encodeURIComponent(req.params.issueId)}/comments?limit=100`,
      'issue comments'
    );
    const identityMap = await buildProjectIdentityMap(req, accProjectId);
    const enrichedComments = comments.map(comment => enrichComment(comment, identityMap));

    res.json({
      data: enrichedComments,
      count: enrichedComments.length
    });
  } catch (err) {
    next(err);
  }
});

router.post('/api/projects/:projectId/issues/:issueId/comments', requireAuth, async function (req, res, next) {
  try {
    const accProjectId = projectGuid(req.params.projectId);
    const issueId = req.params.issueId;
    const commentBody = String(req.body?.body || '').trim();

    if (!commentBody) {
      return res.status(400).json({
        error: 'Comment text is required.'
      });
    }

    const comment = await apsFetch(
      req,
      `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/issues/${encodeURIComponent(issueId)}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({
          issueId,
          body: commentBody
        })
      }
    );
    const identityMap = await buildProjectIdentityMap(req, accProjectId);
    const enrichedComment = enrichComment(comment?.data || comment?.comment || comment, identityMap);

    res.json({
      data: enrichedComment
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/projects/:projectId/issues/:issueId/attachments', requireAuth, async function (req, res, next) {
  try {
    const accProjectId = projectGuid(req.params.projectId);
    const attachments = await fetchAllPagesFlexible(
      req,
      `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/attachments/${encodeURIComponent(req.params.issueId)}/items?limit=100`,
      'issue attachments'
    );

    res.json({
      data: attachments,
      count: attachments.length
    });
  } catch (err) {
    next(err);
  }
});


router.get('/api/debug/hq-project-companies', requireAuth, async function (req, res, next) {
  try {
    const accountId = accountGuid(req.query.accountId);
    const projectId = projectGuid(req.query.projectId);
    const target = String(req.query.target || '').trim();

    if (!accountId || !projectId) {
      return res.status(400).json({
        error: 'accountId and projectId are required.'
      });
    }

    const url =
      `${APS_API_BASE}/hq/v1/accounts/${encodeURIComponent(accountId)}` +
      `/projects/${encodeURIComponent(projectId)}/companies`;

    const companies = await fetchAllPagesFlexibleTwoLegged(
      url,
      'debug HQ project companies'
    );

    function flattenCompany(company) {
      const attributes = company?.attributes || {};
      const relationships = company?.relationships || {};

      return {
        id: company?.id || attributes.id || '',
        name:
          company?.name ||
          company?.displayName ||
          company?.companyName ||
          attributes.name ||
          attributes.displayName ||
          attributes.companyName ||
          '',
        member_group_id:
          company?.member_group_id ||
          company?.memberGroupId ||
          company?.memberGroupID ||
          company?.memberGroup?.id ||
          company?.member_group?.id ||
          attributes.member_group_id ||
          attributes.memberGroupId ||
          attributes.memberGroupID ||
          attributes.memberGroup?.id ||
          attributes.member_group?.id ||
          relationships.memberGroup?.data?.id ||
          relationships.member_group?.data?.id ||
          '',
        keys: getCandidateKeys(company),
        raw: company
      };
    }

    const flatCompanies = companies.map(flattenCompany);

    const exactMatches = flatCompanies.filter(company => {
      return target && String(company.member_group_id) === target;
    });

    const keyMatches = flatCompanies.filter(company => {
      return target && Array.isArray(company.keys) && company.keys.includes(target);
    });

    const looseMatches = flatCompanies.filter(company => {
      try {
        return target && JSON.stringify(company.raw).includes(target);
      } catch {
        return false;
      }
    });

    res.json({
      accountId,
      projectId,
      target,
      count: companies.length,
      companies: flatCompanies,
      exactMatches,
      keyMatches,
      looseMatches
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/debug/hq-project-companies-raw', requireAuth, async function (req, res, next) {
  try {
    const accountId = accountGuid(req.query.accountId);
    const projectId = String(req.query.projectId || '').trim();
    const target = String(req.query.target || '').trim();

    if (!accountId || !projectId) {
      return res.status(400).json({
        error: 'accountId and projectId are required.'
      });
    }

    const projectCandidates = Array.from(new Set([
      projectId,
      stripB(projectId),
      `b.${stripB(projectId)}`
    ].filter(Boolean)));

    const results = [];

    for (const candidateProjectId of projectCandidates) {
      const url =
        `${APS_API_BASE}/hq/v1/accounts/${encodeURIComponent(accountId)}` +
        `/projects/${encodeURIComponent(candidateProjectId)}/companies`;

      try {
        const body = await apsFetchTwoLegged(url);

        results.push({
          projectIdTried: candidateProjectId,
          url,
          ok: true,
          rawBody: body,
          rawBodyType: Array.isArray(body) ? 'array' : typeof body,
          rawKeys: body && typeof body === 'object' ? Object.keys(body) : [],
          bodyContainsTarget: target ? JSON.stringify(body).includes(target) : false
        });
      } catch (error) {
        results.push({
          projectIdTried: candidateProjectId,
          url,
          ok: false,
          status: error.status || null,
          message: error.message,
          details: error.details || null
        });
      }
    }

    res.json({
      accountId,
      inputProjectId: projectId,
      target,
      results
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/projects/:projectId/issues', requireAuth, async function (req, res, next) {
  try {
    const rawProjectId = req.params.projectId;
    const accProjectId = projectGuid(rawProjectId);
    const accAccountId = getAccountIdFromRequest(req);
    const issues = [];
    const limit = 100;

    let url =
      `${APS_API_BASE}/construction/issues/v1/projects/${encodeURIComponent(accProjectId)}/issues` +
      `?limit=${limit}`;

    while (url) {
      const body = await apsFetch(req, url);

      const pageIssues = body.data || body.results || body.issues || [];
      issues.push(...pageIssues);

      const nextUrl = getNextUrl(body);

      url = nextUrl
        ? nextUrl.startsWith('http')
          ? nextUrl
          : `${APS_API_BASE}${nextUrl}`
        : null;
    }

    const maps = await buildProjectLookupMaps(req, accProjectId, accAccountId, issues);
    const enrichedIssues = issues.map(issue => enrichIssue(issue, maps));

    const debugFolder = path.join(process.cwd(), 'switchback-output');

    if (!fs.existsSync(debugFolder)) {
      fs.mkdirSync(debugFolder, { recursive: true });
    }

    const responseBody = {
      data: enrichedIssues,
      count: enrichedIssues.length,
      accountId: accAccountId || null,
      projectId: accProjectId,
      lookupCounts: {
        identities: maps.identityMap.size,
        companies: maps.companyMap.size,
        roles: maps.roleMap.size,
        issueTypes: maps.typeMap.size,
        categories: maps.categoryMap.size,
        rootCauses: maps.rootCauseMap.size,
        ...maps.lookupDebug
      }
    };

    fs.writeFileSync(
      path.join(debugFolder, `latest-issues-${accProjectId}.json`),
      JSON.stringify(responseBody, null, 2),
      'utf8'
    );

    res.json(responseBody);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
