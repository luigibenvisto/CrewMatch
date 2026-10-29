const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { requireAccount, startSession, paramId, setFlash } = require('./helpers');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: env.isTest ? 1000 : 10, standardHeaders: true, legacyHeaders: false });

function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function adminConfigured() {
  return env.adminEmail() && env.adminPassword().length >= 12;
}

router.get('/login', (req, res) => res.render('admin/login', { title: 'Admin log in', configured: adminConfigured() }));

router.post('/login', loginLimiter, async (req, res) => {
  // Both checks always run, so the response time does not reveal which one failed.
  const emailOk = sameSecret(String(req.body.email || '').trim().toLowerCase(), env.adminEmail().trim().toLowerCase());
  const passwordOk = sameSecret(String(req.body.password || ''), env.adminPassword());
  const ok = adminConfigured() && emailOk && passwordOk;
  if (!ok) {
    return res.status(401).render('admin/login', { title: 'Admin log in', configured: adminConfigured(), errors: ['Wrong email or password.'] });
  }
  await startSession(req, { type: 'admin', id: 0 });
  return res.redirect('/admin');
});

router.use(requireAccount('admin', '/admin/login'));

router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  const [crew, productions, projects, engagements, totals] = await Promise.all([
    db.query(`SELECT c.id, c.full_name, c.email, c.city_name, c.is_sample, c.is_suspended, c.created_at,
                     s.confirmed_jobs, s.crew_cancellations, s.last_worked_on,
                     (SELECT role_code FROM crew_roles r WHERE r.crew_id = c.id AND r.is_primary) AS primary_role
                FROM crew c JOIN crew_work_stats s ON s.crew_id = c.id ORDER BY c.created_at DESC LIMIT 500`),
    db.query(`SELECT pd.id, pd.company_name, pd.contact_name, pd.email, pd.is_sample, pd.is_suspended, pd.created_at,
                     (SELECT count(*)::int FROM projects p WHERE p.production_id = pd.id) AS project_count
                FROM productions pd ORDER BY pd.created_at DESC LIMIT 500`),
    db.query(`SELECT p.id, p.title, p.city_name, p.start_date, p.end_date, p.status, p.billing, p.fee_cents, pd.company_name,
                     (SELECT count(*)::int FROM positions x WHERE x.project_id = p.id) AS position_count
                FROM projects p JOIN productions pd ON pd.id = p.production_id ORDER BY p.created_at DESC LIMIT 500`),
    db.query(`SELECT status, count(*)::int AS count FROM engagements GROUP BY status ORDER BY status`),
    db.query(`SELECT (SELECT count(*)::int FROM crew) AS crew, (SELECT count(*)::int FROM productions) AS productions,
                     (SELECT count(*)::int FROM projects) AS projects,
                     (SELECT coalesce(sum(amount_cents), 0)::int FROM payments WHERE status = 'succeeded' AND provider <> 'stub') AS revenue_cents,
                     (SELECT count(*)::int FROM crew WHERE is_sample) + (SELECT count(*)::int FROM productions WHERE is_sample) AS sample_accounts`),
  ]);
  res.render('admin/dashboard', {
    title: 'Admin',
    crew: crew.rows,
    productions: productions.rows,
    projects: projects.rows,
    engagementCounts: engagements.rows,
    totals: totals.rows[0],
  });
});

for (const [path, table] of [['crew', 'crew'], ['productions', 'productions']]) {
  router.post(`/${path}/:id/suspend`, async (req, res) => {
    const { rows } = await req.app.locals.db.query(
      `UPDATE ${table} SET is_suspended = NOT is_suspended WHERE id = $1 RETURNING is_suspended`, [paramId(req)]);
    if (rows[0]) setFlash(req, rows[0].is_suspended ? 'Account suspended.' : 'Account restored.');
    res.redirect('/admin');
  });
}

router.post('/sample-data/delete', async (req, res) => {
  const db = req.app.locals.db;
  const crew = await db.query('DELETE FROM crew WHERE is_sample');
  const productions = await db.query('DELETE FROM productions WHERE is_sample');
  setFlash(req, `Deleted ${crew.rowCount} sample crew and ${productions.rowCount} sample productions.`);
  res.redirect('/admin');
});

module.exports = router;
