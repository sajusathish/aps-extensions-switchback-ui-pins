// Server routes for Autodesk sign-in, callback, logout, and current user status.
// Do not put model, issue, or switchback JSON routes here.
const express = require('express');
const {
    getAuthorizationUrl,
    exchangeCodeForToken,
    refreshTokenIfNeeded,
    apsFetch,
    APS_API_BASE
} = require('../services/aps.js');

let router = express.Router();

router.get('/auth/login', function (req, res) {
    const authUrl = getAuthorizationUrl();
    res.redirect(authUrl);
});

router.get('/auth/debug', function (req, res) {
    const authUrl = getAuthorizationUrl();
    const url = new URL(authUrl);

    res.type('html').send(`
        <!doctype html>
        <html>
            <head>
                <title>APS OAuth Debug</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 32px; line-height: 1.5; }
                    code, pre { background: #f4f4f4; padding: 8px; border-radius: 6px; display: block; overflow: auto; }
                    a { color: #0b57d0; }
                </style>
            </head>
            <body>
                <h1>APS OAuth Debug</h1>
                <p><strong>Callback URL sent to Autodesk:</strong></p>
                <code>${url.searchParams.get('redirect_uri')}</code>
                <p><strong>Client ID:</strong></p>
                <code>${url.searchParams.get('client_id')}</code>
                <p><strong>Scopes:</strong></p>
                <code>${url.searchParams.get('scope')}</code>
                <p><strong>Full Autodesk login URL:</strong></p>
                <pre>${authUrl}</pre>
                <p><a href="${authUrl}">Test Autodesk login</a></p>
                <p>Make sure the callback URL above is registered exactly in Autodesk Developer Portal.</p>
            </body>
        </html>
    `);
});


router.get('/auth/callback', async function (req, res, next) {
    try {
        const code = req.query.code;

        if (!code) {
            return res.status(400).send('Missing Autodesk authorization code.');
        }

        req.session.token = await exchangeCodeForToken(code);
        res.redirect('/');
    } catch (err) {
        console.error('OAuth callback failed:', err);
        next(err);
    }
});

router.get('/auth/logout', function (req, res) {
    req.session.destroy(function () {
        res.redirect('/');
    });
});

router.get('/api/auth/status', async function (req, res) {
    res.json({
        authenticated: !!req.session?.token?.access_token
    });
});

router.get('/api/me', async function (req, res) {
    try {
        if (!req.session?.token?.access_token) {
            return res.json({ authenticated: false });
        }

        let profile = null;
        try {
            profile = await apsFetch(req, `${APS_API_BASE}/userprofile/v1/users/@me`);
        } catch (profileError) {
            profile = null;
        }

        res.json({
            authenticated: true,
            profile
        });
    } catch (err) {
        res.json({
            authenticated: false,
            error: err.message
        });
    }
});

router.get('/api/auth/token', async function (req, res, next) {
    try {
        const token = await refreshTokenIfNeeded(req);
        res.json({
            access_token: token.access_token,
            expires_in: token.expires_in || 3599
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
