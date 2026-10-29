const express = require('express');
const { validate, schemas } = require('../lib/validation');
const { todayIso } = require('../lib/dates');
const { findCity } = require('../config/cities');
const { UserError } = require('../lib/errors');
const engagements = require('../services/engagements');
const billing = require('../services/billing');
const { quoteProjectFee, subscriptionQuote } = require('../services/pricing');
const { shortlistForPosition } = require('../matching');
const provider = require('../payments/provider');
const { requireAccount, paramId, actionThenRedirect, setFlash } = require('./helpers');

const router = express.Router();
router.use(requireAccount('production', '/production/login'));

async function ownProject(db, productionId, projectId) {
  const { rows } = await db.query('SELECT * FROM projects WHERE id = $1 AND production_id = $2', [projectId, productionId]);
  if (!rows[0]) throw new UserError('Project not found.', 404);
  return rows[0];
}

async function ownPosition(db, productionId, positionId) {
  const { rows } = await db.query(
    `SELECT p.*, pr.title AS project_title, pr.status AS project_status, pr.city_name, pr.id AS project_id
       FROM positions p JOIN projects pr ON pr.id = p.project_id
      WHERE p.id = $1 AND pr.production_id = $2`,
    [positionId, productionId],
  );
  if (!rows[0]) throw new UserError('Position not found.', 404);
  return rows[0];
}

const ENGAGEMENT_SELECT = `
  SELECT e.*, c.full_name, c.city_name AS crew_city, p.role_code, p.start_date, p.end_date, pr.title AS project_title,
         CASE WHEN e.status IN ('accepted', 'completed') THEN c.email END AS contact_email,
         CASE WHEN e.status IN ('accepted', 'completed') THEN c.phone END AS contact_phone
    FROM engagements e
    JOIN crew c ON c.id = e.crew_id
    JOIN positions p ON p.id = e.position_id
    JOIN projects pr ON pr.id = p.project_id`;

router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  const today = todayIso();
  const [production, projects, toConfirm, subscription] = await Promise.all([
    db.query('SELECT company_name, contact_name FROM productions WHERE id = $1', [req.accountId]),
    db.query(
      `SELECT pr.*,
              (SELECT count(*)::int FROM positions p WHERE p.project_id = pr.id) AS position_count,
              (SELECT count(*)::int FROM positions p WHERE p.project_id = pr.id AND p.status = 'open') AS open_positions
         FROM projects pr WHERE pr.production_id = $1 ORDER BY pr.start_date DESC`,
      [req.accountId]),
    db.query(`${ENGAGEMENT_SELECT} WHERE pr.production_id = $1 AND e.status = 'accepted' ORDER BY p.start_date`, [req.accountId]),
    billing.activeSubscription(db, req.accountId, today),
  ]);
  res.render('production/dashboard', {
    title: 'Production dashboard',
    production: production.rows[0],
    projects: projects.rows,
    accepted: toConfirm.rows,
    subscription,
    today,
  });
});

router.get('/projects/new', (req, res) => res.render('production/project-new', { title: 'Post a project' }));

router.post('/projects', async (req, res) => {
  const { data, errors } = validate(schemas.project, req.body);
  if (errors) return res.status(400).render('production/project-new', { title: 'Post a project', errors, values: req.body });
  if (data.end_date < todayIso()) {
    return res.status(400).render('production/project-new', { title: 'Post a project', errors: ['The project cannot end in the past.'], values: req.body });
  }
  const city = findCity(data.city_code);
  const { rows } = await req.app.locals.db.query(
    `INSERT INTO projects (production_id, title, description, city_code, city_name, lat, lng, start_date, end_date, budget_min, budget_max)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [req.accountId, data.title, data.description, city.code, city.name, city.lat, city.lng,
      data.start_date, data.end_date, data.budget_min, data.budget_max],
  );
  setFlash(req, 'Project saved. Add the positions you need, then pay to open it to crew.');
  return res.redirect(`/production/projects/${rows[0].id}`);
});

async function renderProject(req, res, { errors = [], values = {}, status = 200 } = {}) {
  const db = req.app.locals.db;
  const project = await ownProject(db, req.accountId, paramId(req));
  const [positions, subscription] = await Promise.all([
    db.query(
      `SELECT p.*,
              (SELECT count(*)::int FROM engagements e WHERE e.position_id = p.id AND e.status = 'accepted') AS accepted_count,
              (SELECT count(*)::int FROM engagements e WHERE e.position_id = p.id AND e.status = 'offered') AS pending_count
         FROM positions p WHERE p.project_id = $1 ORDER BY p.id`,
      [project.id]),
    billing.activeSubscription(db, req.accountId),
  ]);
  res.status(status).render('production/project', {
    title: project.title,
    project,
    positions: positions.rows,
    subscription,
    quote: quoteProjectFee(project.start_date, project.end_date),
    subscriptionQuote: subscriptionQuote(),
    paymentsAreStub: provider.isStub(),
    errors,
    values: { start_date: project.start_date, end_date: project.end_date, headcount: 1, ...values },
  });
}

router.get('/projects/:id', (req, res) => renderProject(req, res));

router.post('/projects/:id/positions', async (req, res) => {
  const db = req.app.locals.db;
  const project = await ownProject(db, req.accountId, paramId(req));
  if (project.status === 'closed') throw new UserError('This project is closed.');
  const { data, errors } = validate(schemas.position, req.body);
  const allErrors = errors || [];
  if (data && (data.start_date < project.start_date || data.end_date > project.end_date)) {
    allErrors.push(`Position dates must be inside the project dates (${project.start_date} to ${project.end_date}).`);
  }
  if (allErrors.length) return renderProject(req, res, { errors: allErrors, values: req.body, status: 400 });
  const { rows: [{ count }] } = await db.query('SELECT count(*)::int AS count FROM positions WHERE project_id = $1', [project.id]);
  if (count >= 100) throw new UserError('A project can have at most 100 positions.');
  await db.query(
    `INSERT INTO positions (project_id, role_code, headcount, rate_min, rate_max, required_skills, required_gear, start_date, end_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [project.id, data.role_code, data.headcount, data.rate_min, data.rate_max, data.required_skills, data.required_gear,
      data.start_date, data.end_date, data.notes],
  );
  setFlash(req, 'Position added.');
  return res.redirect(`/production/projects/${project.id}`);
});

router.post('/projects/:id/pay', (req, res) => {
  const projectId = paramId(req);
  return actionThenRedirect(req, res, `/production/projects/${projectId}`, async () => {
    await billing.payForProject(req.app.locals.db, { productionId: req.accountId, projectId });
    return 'Payment recorded. Your project is open and crew are being matched.';
  });
});

router.post('/projects/:id/use-subscription', (req, res) => {
  const projectId = paramId(req);
  return actionThenRedirect(req, res, `/production/projects/${projectId}`, async () => {
    await billing.openWithSubscription(req.app.locals.db, { productionId: req.accountId, projectId });
    return 'Project opened with your subscription.';
  });
});

router.post('/projects/:id/close', async (req, res) => {
  const project = await ownProject(req.app.locals.db, req.accountId, paramId(req));
  await req.app.locals.db.query(
    "UPDATE projects SET status = 'closed' WHERE id = $1 AND status = 'open'", [project.id]);
  await req.app.locals.db.query("UPDATE positions SET status = 'closed' WHERE project_id = $1 AND status = 'open'", [project.id]);
  setFlash(req, 'Project closed. Crew will no longer see it. You can still confirm finished jobs.');
  res.redirect(`/production/projects/${project.id}`);
});

router.get('/positions/:id', async (req, res) => {
  const db = req.app.locals.db;
  const position = await ownPosition(db, req.accountId, paramId(req));
  const [shortlist, sent] = await Promise.all([
    position.project_status === 'open' && position.status === 'open' ? shortlistForPosition(db, position.id) : [],
    db.query(`${ENGAGEMENT_SELECT} WHERE e.position_id = $1 ORDER BY e.offered_at DESC`, [position.id]),
  ]);
  res.render('production/position', { title: position.project_title, position, shortlist, sent: sent.rows });
});

router.post('/positions/:id/offers', async (req, res) => {
  const positionId = paramId(req);
  const { data, errors } = validate(schemas.offer, req.body);
  if (errors) {
    setFlash(req, errors.join(' '), 'error');
    return res.redirect(`/production/positions/${positionId}`);
  }
  return actionThenRedirect(req, res, `/production/positions/${positionId}`, async () => {
    await engagements.sendOffer(req.app.locals.db, {
      productionId: req.accountId, positionId, crewId: data.crew_id, offeredRate: data.offered_rate, message: data.message,
    });
    return 'Offer sent.';
  });
});

router.post('/positions/:id/close', async (req, res) => {
  const position = await ownPosition(req.app.locals.db, req.accountId, paramId(req));
  await req.app.locals.db.query("UPDATE positions SET status = 'closed' WHERE id = $1", [position.id]);
  setFlash(req, 'Position closed.');
  res.redirect(`/production/projects/${position.project_id}`);
});

router.post('/engagements/:id/:action', async (req, res) => {
  const db = req.app.locals.db;
  const engagementId = paramId(req);
  const productionId = req.accountId;
  const back = req.body.back === 'dashboard' ? '/production' : null;
  const actions = {
    withdraw: async () => { await engagements.withdrawOffer(db, { productionId, engagementId }); return 'Offer withdrawn.'; },
    cancel: async () => { await engagements.cancelEngagement(db, { side: 'production', actorId: productionId, engagementId }); return 'Job cancelled.'; },
    confirm: async () => {
      const r = await engagements.confirmCompletion(db, { side: 'production', actorId: productionId, engagementId });
      return r.completed
        ? 'Both sides have confirmed this job. Thank you.'
        : 'Thanks. The job will count once the crew member confirms it too.';
    },
  };
  const action = actions[req.params.action];
  if (!action) return res.status(404).render('error', { title: 'Not found', message: 'Unknown action.' });
  const { rows } = await db.query('SELECT position_id FROM engagements WHERE id = $1', [engagementId]);
  const to = back || (rows[0] ? `/production/positions/${rows[0].position_id}` : '/production');
  return actionThenRedirect(req, res, to, action);
});

router.get('/billing', async (req, res) => {
  const db = req.app.locals.db;
  const [subscription, payments] = await Promise.all([
    billing.activeSubscription(db, req.accountId),
    db.query('SELECT * FROM payments WHERE production_id = $1 ORDER BY created_at DESC LIMIT 50', [req.accountId]),
  ]);
  res.render('production/billing', {
    title: 'Billing', subscription, payments: payments.rows, subscriptionQuote: subscriptionQuote(), paymentsAreStub: provider.isStub(),
  });
});

router.post('/billing/subscribe', (req, res) => actionThenRedirect(req, res, '/production/billing', async () => {
  await billing.buySubscription(req.app.locals.db, { productionId: req.accountId });
  return 'Subscription active.';
}));

module.exports = router;
