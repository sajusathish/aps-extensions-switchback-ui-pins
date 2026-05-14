/////////////////////////////////////////////////////////////////////
// APS helper service for 3-legged OAuth and ACC Data Management access
// Includes a separate 2-legged helper for server-side account/company/role lookups.
/////////////////////////////////////////////////////////////////////

const {
    APS_CLIENT_ID,
    APS_CLIENT_SECRET,
    APS_CALLBACK_URL
} = require('../config.js');

const APS_AUTH_BASE = 'https://developer.api.autodesk.com/authentication/v2';
const APS_API_BASE = 'https://developer.api.autodesk.com';

const SCOPES = [
    'data:read',
    'viewables:read',
    'account:read',
    'offline_access'
];

const TWO_LEGGED_SCOPES = [
    'account:read',
    'data:read'
];

let cachedTwoLeggedToken = null;

function toQueryString(params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            query.append(key, value.join(' '));
        } else if (value !== undefined && value !== null) {
            query.append(key, value);
        }
    });
    return query.toString();
}

function getAuthorizationUrl() {
    const query = toQueryString({
        response_type: 'code',
        client_id: APS_CLIENT_ID,
        redirect_uri: APS_CALLBACK_URL,
        scope: SCOPES
    });

    return `${APS_AUTH_BASE}/authorize?${query}`;
}

async function exchangeCodeForToken(code) {
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', APS_CALLBACK_URL);
    params.append('client_id', APS_CLIENT_ID);
    params.append('client_secret', APS_CLIENT_SECRET);

    const response = await fetch(`${APS_AUTH_BASE}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
        const message = body?.developerMessage || body?.error_description || body?.error || `Token exchange failed: ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.details = body;
        throw error;
    }

    return {
        ...body,
        expires_at: Date.now() + body.expires_in * 1000
    };
}

async function refreshTokenIfNeeded(req) {
    const token = req.session?.token;

    if (!token?.access_token) {
        throw new Error('Not authenticated. Please sign in with Autodesk.');
    }

    const expiresAt = token.expires_at || 0;
    const now = Date.now();

    if (expiresAt - now > 60 * 1000) {
        return token;
    }

    if (!token.refresh_token) {
        return token;
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', token.refresh_token);
    params.append('client_id', APS_CLIENT_ID);
    params.append('client_secret', APS_CLIENT_SECRET);
    params.append('scope', SCOPES.join(' '));

    const response = await fetch(`${APS_AUTH_BASE}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
        const message = body?.developerMessage || body?.error_description || body?.error || `Token refresh failed: ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.details = body;
        throw error;
    }

    req.session.token = {
        ...body,
        expires_at: Date.now() + body.expires_in * 1000
    };

    return req.session.token;
}

async function getTwoLeggedToken() {
    const now = Date.now();

    if (cachedTwoLeggedToken?.access_token && cachedTwoLeggedToken.expires_at - now > 60 * 1000) {
        return cachedTwoLeggedToken;
    }

    if (!APS_CLIENT_ID || !APS_CLIENT_SECRET) {
        throw new Error('APS_CLIENT_ID and APS_CLIENT_SECRET are required for 2-legged lookup requests.');
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', APS_CLIENT_ID);
    params.append('client_secret', APS_CLIENT_SECRET);
    params.append('scope', TWO_LEGGED_SCOPES.join(' '));

    const response = await fetch(`${APS_AUTH_BASE}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
        const message = body?.developerMessage || body?.error_description || body?.error || `2-legged token request failed: ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.details = body;
        throw error;
    }

    cachedTwoLeggedToken = {
        ...body,
        expires_at: Date.now() + body.expires_in * 1000
    };

    return cachedTwoLeggedToken;
}

async function apsFetch(req, url, options = {}) {
    const token = await refreshTokenIfNeeded(req);

    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token.access_token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
        const message = body?.developerMessage || body?.error || `APS request failed: ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.details = body;
        throw error;
    }

    return body;
}

async function apsFetchTwoLegged(url, options = {}) {
    const token = await getTwoLeggedToken();

    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token.access_token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
        const message = body?.developerMessage || body?.error || `2-legged APS request failed: ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.details = body;
        throw error;
    }

    return body;
}

async function fetchAllPages(req, startUrl) {
    let url = startUrl;
    const allData = [];

    while (url) {
        const body = await apsFetch(req, url);
        allData.push(...(body.data || []));
        url = body.links?.next?.href || null;
    }

    return allData;
}

function toBase64Url(value) {
    return Buffer.from(value)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function getDerivativeUrnFromVersion(version) {
    return (
        version?.relationships?.derivatives?.data?.id ||
        version?.relationships?.derivatives?.meta?.link?.href ||
        version?.attributes?.extension?.data?.derivativeUrn ||
        null
    );
}

function getViewerUrnFromVersion(version) {
    const derivativeUrn = getDerivativeUrnFromVersion(version);

    if (derivativeUrn) {
        if (derivativeUrn.startsWith('urn:')) return derivativeUrn.substring(4);
        return derivativeUrn;
    }

    return toBase64Url(version.id);
}

function getDisplayName(entity) {
    return (
        entity?.attributes?.displayName ||
        entity?.attributes?.name ||
        entity?.attributes?.extension?.data?.sourceFileName ||
        entity?.name ||
        entity?.id ||
        'Unnamed'
    );
}

module.exports = {
    APS_API_BASE,
    SCOPES,
    TWO_LEGGED_SCOPES,
    getAuthorizationUrl,
    exchangeCodeForToken,
    refreshTokenIfNeeded,
    getTwoLeggedToken,
    apsFetch,
    apsFetchTwoLegged,
    fetchAllPages,
    getViewerUrnFromVersion,
    getDisplayName
};
