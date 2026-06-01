// Express app startup. Mounts routes and serves the browser files from public/.
require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const app = express();

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_to_a_long_random_string';

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

app.use(express.static(path.join(__dirname, 'public')));

const authRouter = require('./routes/auth');
const modelsRouter = require('./routes/models');
const issuesRouter = require('./routes/issues');

app.use('/', authRouter);

// Mount issues first because models.js still has an older issue route.
app.use('/', issuesRouter);

app.use('/', modelsRouter);

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(function (err, req, res, next) {
  console.error(err);

  res.status(err.status || 500).json({
    error: err.message || 'Server error.',
    details: err.details || null
  });
});

app.listen(PORT, function () {
  console.log(`Server listening on http://localhost:${PORT}`);
});
