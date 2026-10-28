const express = require('express');
const { validate, schemas } = require('../lib/validation');
const { todayIso } = require('../lib/dates');
const { buildMonths } = require('../lib/calendar');
const crewService = require('../services/crew');
const engagements = require('../services/engagements');
const { matchedJobsForCrew } = require('../matching');
const { requireAccount, paramId, actionThenRedirect, setFlash } = require('./helpers');

const router = express.Router();
router.use(requireAccount('crew', '/crew/login'));

async function loadEngagements(db, crewId) {
  const { rows } = await db.query(
    `SELECT e.*, p.role_code, p.start_date, p.end_date, p.rate_min, p.rate_max, p.notes,
            pr.title AS project_title, pr.city_name, prod.company_name,
            CASE WHEN e.status IN ('accepted', 'completed') THEN prod.contact_name END AS contact_name,
            CASE WHEN e.status IN ('accepted', 'completed') THEN prod.email END AS contact_email,
            CASE WHEN e.status IN ('accepted', 'completed') THEN prod.phone END AS contact_phone
       FROM engagements e
       JOIN positions p ON p.id = e.position_id
       JOIN projects pr ON pr.id = p.project_id
       JOIN productions prod ON prod.id = pr.production_id
      WHERE e.crew_id = $1
      ORDER BY p.start_date DESC`,
    [crewId],
  );
  return rows;
}

router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  const today = todayIso();
  const [profile, clock, list, jobs] = await Promise.all([
    crewService.getCrewProfile(db, req.accountId),
    engagements.getClock(db, req.accountId, today),
    loadEngagements(db, req.accountId),
    matchedJobsForCrew(db, req.accountId, { today }),
  ]);
  res.render('crew/dashboard', {
    title: 'Your dashboard',
    profile,
    clock,
    today,
    offers: list.filter((e) => e.status === 'offered'),
    upcoming: list.filter((e) => e.status === 'accepted'),
    history: list.filter((e) => ['completed', 'declined', 'withdrawn', 'cancelled'].includes(e.status)),
    jobs: jobs.slice(0, 5),
    jobCount: jobs.length,
  });
});

router.get('/jobs', async (req, res) => {
  const jobs = await matchedJobsForCrew(req.app.locals.db, req.accountId);
  res.render('crew/jobs', { title: 'Jobs that fit you', jobs });
});

router.post('/jobs/:id/interest', async (req, res) => {
  const positionId = paramId(req);
  const db = req.app.locals.db;
  // Only jobs that actually match this person can be flagged.
  const jobs = await matchedJobsForCrew(db, req.accountId);
  const job = jobs.find((j) => j.position_id === positionId);
  if (!job) {
    setFlash(req, 'That job is no longer available.', 'error');
  } else if (job.interested) {
    await db.query('DELETE FROM interests WHERE position_id = $1 AND crew_id = $2', [positionId, req.accountId]);
    setFlash(req, 'Interest removed.');
  } else {
    await db.query('INSERT INTO interests (position_id, crew_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [positionId, req.accountId]);
    setFlash(req, 'The production will see that you are interested.');
  }
  res.redirect('/crew/jobs');
});

async function renderProfile(req, res, { errors = [], values = null, status = 200 } = {}) {
  const db = req.app.locals.db;
  const today = todayIso();
  const profile = await crewService.getCrewProfile(db, req.accountId);
  const { rows: booked } = await db.query(
    `SELECT p.start_date, p.end_date FROM engagements e JOIN positions p ON p.id = e.position_id
      WHERE e.crew_id = $1 AND e.status = 'accepted'`, [req.accountId]);
  res.status(status).render('crew/profile', {
    title: 'Your profile',
    profile,
    errors,
    values: values || profile,
    today,
    months: buildMonths(today, { available: profile.availability, booked }, 3),
  });
}

router.get('/profile', (req, res) => renderProfile(req, res));

router.post('/profile', async (req, res) => {
  const { data, errors } = validate(schemas.crewProfile, req.body);
  if (errors) {
    const values = { ...req.body, other_roles: [].concat(req.body.other_roles || []) };
    return renderProfile(req, res, { errors, values, status: 400 });
  }
  await crewService.updateCrewProfile(req.app.locals.db, req.accountId, data);
  setFlash(req, 'Profile saved.');
  return res.redirect('/crew/profile');
});

router.post('/availability', async (req, res) => {
  const { data, errors } = validate(schemas.availability, req.body);
  if (errors) {
    setFlash(req, errors.join(' '), 'error');
    return res.redirect('/crew/profile#availability');
  }
  return actionThenRedirect(req, res, '/crew/profile#availability', async () => {
    await crewService.addAvailability(req.app.locals.db, req.accountId, data);
    return 'Availability added.';
  });
});

router.post('/availability/:id/delete', async (req, res) => {
  await crewService.removeAvailability(req.app.locals.db, req.accountId, paramId(req));
  setFlash(req, 'Availability removed.');
  res.redirect('/crew/profile#availability');
});

router.post('/credits', async (req, res) => {
  const { data, errors } = validate(schemas.credit, req.body);
  if (errors) {
    setFlash(req, errors.join(' '), 'error');
    return res.redirect('/crew/profile#credits');
  }
  return actionThenRedirect(req, res, '/crew/profile#credits', async () => {
    await crewService.addCredit(req.app.locals.db, req.accountId, data);
    return 'Credit added.';
  });
});

router.post('/credits/:id/delete', async (req, res) => {
  await crewService.removeCredit(req.app.locals.db, req.accountId, paramId(req));
  setFlash(req, 'Credit removed.');
  res.redirect('/crew/profile#credits');
});

router.post('/engagements/:id/:action', async (req, res) => {
  const db = req.app.locals.db;
  const engagementId = paramId(req);
  const crewId = req.accountId;
  const actions = {
    accept: async () => { await engagements.respondToOffer(db, { crewId, engagementId, accept: true }); return 'Offer accepted. The production can now see your contact details.'; },
    decline: async () => { await engagements.respondToOffer(db, { crewId, engagementId, accept: false }); return 'Offer declined.'; },
    cancel: async () => { await engagements.cancelEngagement(db, { side: 'crew', actorId: crewId, engagementId }); return 'Job cancelled.'; },
    confirm: async () => {
      const r = await engagements.confirmCompletion(db, { side: 'crew', actorId: crewId, engagementId });
      return r.completed
        ? 'Both sides have confirmed this job. Your days-since-last-worked clock has been reset.'
        : 'Thanks. The job will count once the production confirms it too.';
    },
  };
  const action = actions[req.params.action];
  if (!action) return res.status(404).render('error', { title: 'Not found', message: 'Unknown action.' });
  return actionThenRedirect(req, res, '/crew', action);
});

module.exports = router;
