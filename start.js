/////////////////////////////////////////////////////////////////////
// App startup
/////////////////////////////////////////////////////////////////////
const issuesRouter = require('./routes/issues');
app.use('/api', issuesRouter);
const path = require('path');
const express = require('express');
const fs = require('fs');
const session = require('express-session');
const { PORT, SESSION_SECRET, APS_CALLBACK_URL } = require('./config.js');

const masterconfigpath = './public/extensions/config.json';
const extensionsconfig = require(masterconfigpath);
const source = './public/extensions';
const extensions = [];

fs.readdirSync(source, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .forEach(folder => {
        const configPath = `${source}/${folder.name}/config.json`;
        if (fs.existsSync(configPath)) {
            const econfig = require(configPath);
            extensions.push(econfig);
        }
    });

extensionsconfig.Extensions = extensions;
fs.writeFileSync(masterconfigpath, JSON.stringify(extensionsconfig, null, 4));

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use(require('./routes/auth.js'));
app.use(require('./routes/models.js'));

app.use(function (err, req, res, next) {
    console.error(err);
    res.status(err.status || 500).json({
        error: err.message || 'Unexpected server error.',
        details: err.details || null
    });
});

app.listen(PORT, function () {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log(`APS callback URL in use: ${APS_CALLBACK_URL}`);
    console.log(`Open debug page: http://localhost:${PORT}/auth/debug`);
});
