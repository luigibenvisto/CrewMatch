const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { validate, schemas } = require('../lib/validation');
const accounts = require('../services/accounts');
const { quoteProjectFee, subscriptionQuote } = require('../services/pricing');
const pricing = require('../config/pricing');
const { startSession, setFlash } = require('./helpers');

const router = express.Router();

// Slows down password guessing and mass signups.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: env.isTest ? 1000 : 30, standardHeaders: true, legacyHeaders: false });

router.get('/', (req, res) => res.render('public/home', { title: 'CrewMatch' }));
// Old links and domain redirects that land on /crewmatch still work.
router.get(['/crewmatch', '/crewmatch/'], (req, res) => res.redirect(301, '/'));

router.get('/pricing', (req, res) => {
  res.render('public/pricing', {
    title: 'Pricing',
    subscription: subscriptionQuote(),
    tiers: pricing.projectFeeTiers,
    example: quoteProjectFee('2026-01-01', '2026-01-12'),
  });
});

const ACCOUNT_TYPES = {
  crew: {
    table: 'crew', signup: schemas.crewSignup, signUp: accounts.signUpCrew, home: '/crew/profile', dashboard: '/crew',
    label: 'Crew',
  },
  production: {
    table: 'productions', signup: schemas.productionSignup, signUp: accounts.signUpProduction, home: '/production', dashboard: '/production',
    label: 'Production',
  },
};

for (const [type, cfg] of Object.entries(ACCOUNT_TYPES)) {
  router.get(`/${type}/signup`, (req, res) => res.render(`public/signup-${type}`, { title: `${cfg.label} sign up` }));

  router.post(`/${type}/signup`, authLimiter, async (req, res) => {
    const values = { ...req.body, password: '' };
    const { data, errors } = validate(cfg.signup, req.body);
    if (errors) return res.status(400).render(`public/signup-${type}`, { title: `${cfg.label} sign up`, errors, values });
    try {
      const id = await cfg.signUp(req.app.locals.db, data);
      await startSession(req, { type, id });
      setFlash(req, type === 'crew'
        ? 'Welcome to CrewMatch. Fill in your profile and availability so we can match you.'
        : 'Welcome to CrewMatch. Post your first project to start finding crew.');
      return res.redirect(cfg.home);
    } catch (err) {
      if (!err.isUserError) throw err;
      return res.status(400).render(`public/signup-${type}`, { title: `${cfg.label} sign up`, errors: [err.message], values });
    }
  });

  router.get(`/${type}/login`, (req, res) => res.render('public/login', { title: `${cfg.label} log in`, type, label: cfg.label }));

  router.post(`/${type}/login`, authLimiter, async (req, res) => {
    const render = (status, errors) => res.status(status).render('public/login', {
      title: `${cfg.label} log in`, type, label: cfg.label, errors, values: { email: req.body.email },
    });
    const { data, errors } = validate(schemas.login, req.body);
    if (errors) return render(400, errors);
    try {
      const id = await accounts.logIn(req.app.locals.db, cfg.table, data);
      await startSession(req, { type, id });
      return res.redirect(cfg.dashboard);
    } catch (err) {
      if (!err.isUserError) throw err;
      return render(err.status, [err.message]);
    }
  });
}

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('crewmatch.sid');
    res.redirect('/');
  });
});

module.exports = router;
