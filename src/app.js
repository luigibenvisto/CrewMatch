/** Builds the Express web app. server.js starts it; tests start it on a random port. */
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const env = require('./config/env');
const { csrfProtection } = require('./lib/csrf');
const { roleLabel, departmentLabel, departmentOf, departments } = require('./config/roles');
const { cities } = require('./config/cities');
const { formatDate } = require('./lib/dates');
const { formatMoney } = require('./services/pricing');
const pricingConfig = require('./config/pricing');

function createApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('trust proxy', 1); // Render and Railway put the app behind one proxy.
  app.disable('x-powered-by');
  app.locals.db = db;

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'"],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': env.isProduction ? [] : null,
      },
    },
  }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: env.isProduction ? '1d' : 0 }));
  app.use(express.urlencoded({ extended: false, limit: '50kb', parameterLimit: 200 }));

  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  app.use(session({
    store: new PgSession({ pool: db, tableName: 'user_sessions', createTableIfMissing: true }),
    name: 'crewmatch.sid',
    secret: env.sessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.isProduction,
      maxAge: 1000 * 60 * 60 * 24 * 14,
    },
  }));

  // Values every page can use.
  app.use((req, res, next) => {
    res.locals.account = req.session.account || null;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    res.locals.path = req.path;
    Object.assign(res.locals, {
      roleLabel, departmentLabel, departmentOf, departments, cities, formatDate, formatMoney,
      currency: pricingConfig.currency, errors: [], values: {},
    });
    next();
  });
  app.use(csrfProtection);

  app.use(require('./routes/public'));
  app.use('/crew', require('./routes/crew'));
  app.use('/production', require('./routes/production'));
  app.use('/admin', require('./routes/admin'));

  app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.isUserError) {
      return res.status(err.status).render('error', { title: 'Something is not right', message: err.message });
    }
    console.error(err);
    return res.status(500).render('error', { title: 'Server error', message: 'Something went wrong on our side. Please try again.' });
  });

  return app;
}

module.exports = { createApp };
