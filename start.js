/////////////////////////////////////////////////////////////////////
// Express app entry point
/////////////////////////////////////////////////////////////////////

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const app = express();

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_to_a_long_random_string';

/////////////////////////////////////////////////////////////////////
// Middleware
/////////////////////////////////////////////////////////////////////

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      sameSite: 'lax'
    }
  })
);

/////////////////////////////////////////////////////////////////////
// Static files
/////////////////////////////////////////////////////////////////////

app.use(express.static(path.join(__dirname, 'public')));

/////////////////////////////////////////////////////////////////////
// Routes
/////////////////////////////////////////////////////////////////////

const authRouter = require('./routes/auth');
const modelsRouter = require('./routes/models');
const issuesRouter = require('./routes/issues');

app.use('/', authRouter);

/*
  Important:
  issues.js already defines:
  /api/projects/:projectId/issues

  So mount it at "/" not "/api".
  Mount it before models.js so the enriched issue route wins if models.js has an older issue route.
*/
app.use('/', issuesRouter);

app.use('/', modelsRouter);

/////////////////////////////////////////////////////////////////////
// Home route
/////////////////////////////////////////////////////////////////////

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/////////////////////////////////////////////////////////////////////
// Error handler
/////////////////////////////////////////////////////////////////////

app.use(function (err, req, res, next) {
  console.error(err);

  res.status(err.status || 500).json({
    error: err.message || 'Server error.',
    details: err.details || null
  });
});

/////////////////////////////////////////////////////////////////////
// Start server
/////////////////////////////////////////////////////////////////////

app.listen(PORT, function () {
  console.log(`Server listening on http://localhost:${PORT}`);
});