/**
 * End-to-end tests through the real web app: separate logins, form protection,
 * and the full flow from posting a project to both sides confirming the job.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { connectTestDb, resetDb } = require('./helpers/db');
const { createApp } = require('../src/app');
const { todayIso, addDays } = require('../src/lib/dates');

let db;
let server;
let base;

test.before(async () => {
  db = await connectTestDb();
  if (!db) return;
  await resetDb(db);
  server = createApp(db).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) await db.end();
});

/** A tiny browser: keeps cookies and the form token between requests. */
function browser() {
  let cookie = '';
  let csrf = '';
  async function request(method, path, form) {
    const headers = { cookie };
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries({ _csrf: csrf, ...form })) {
        for (const item of [].concat(v)) params.append(k, item);
      }
      body = params.toString();
    }
    const res = await fetch(base + path, { method, headers, body, redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    const match = text.match(/name="_csrf" value="([^"]+)"/);
    if (match) csrf = match[1];
    return { status: res.status, location: res.headers.get('location'), text };
  }
  return {
    get: (path) => request('GET', path),
    post: (path, form = {}) => request('POST', path, form),
    postWithoutToken: async (path, form) => {
      const saved = csrf;
      csrf = 'wrong';
      const r = await request('POST', path, form);
      csrf = saved;
      return r;
    },
  };
}

const dbTest = (name, fn) => test(name, async (t) => {
  if (!db) return t.skip('no test database available (set TEST_DATABASE_URL)');
  return fn(t);
});

async function signUpCrew(b, email) {
  await b.get('/crew/signup');
  return b.post('/crew/signup', { full_name: 'Test Gaffer', email, password: 'a-good-password', city_code: 'rome', primary_role: 'gaffer' });
}
async function signUpProduction(b, email) {
  await b.get('/production/signup');
  return b.post('/production/signup', { company_name: 'Test Films', contact_name: 'Pat', email, password: 'a-good-password' });
}

dbTest('crew and production accounts are fully separate', async () => {
  const crew = browser();
  const production = browser();
  assert.equal((await signUpCrew(crew, 'sep-crew@test.example')).status, 302);
  assert.equal((await signUpProduction(production, 'sep-prod@test.example')).status, 302);

  assert.equal((await crew.get('/crew')).status, 200);
  assert.equal((await crew.get('/production')).status, 403);
  assert.equal((await crew.post('/production/engagements/1/confirm')).status, 403);
  assert.equal((await production.get('/production')).status, 200);
  assert.equal((await production.get('/crew')).status, 403);
  assert.equal((await production.post('/crew/engagements/1/confirm')).status, 403);
  assert.equal((await crew.get('/admin')).status, 403);

  // A crew login does not work on the production login page, and vice versa.
  const other = browser();
  await other.get('/production/login');
  assert.equal((await other.post('/production/login', { email: 'sep-crew@test.example', password: 'a-good-password' })).status, 401);
  await other.get('/crew/login');
  assert.equal((await other.post('/crew/login', { email: 'sep-prod@test.example', password: 'a-good-password' })).status, 401);
});

dbTest('passwords are stored hashed, never as plain text', async () => {
  const { rows } = await db.query("SELECT password_hash FROM crew WHERE email = 'sep-crew@test.example'");
  assert.match(rows[0].password_hash, /^scrypt\$/);
  assert.ok(!rows[0].password_hash.includes('a-good-password'));
});

dbTest('bad input is rejected with a message', async () => {
  const b = browser();
  await b.get('/crew/signup');
  const r = await b.post('/crew/signup', { full_name: '', email: 'not-an-email', password: 'short', city_code: 'atlantis', primary_role: 'wizard' });
  assert.equal(r.status, 400);
  assert.match(r.text, /valid email/);
  assert.match(r.text, /at least 10 characters/);
});

dbTest('forms without the security token are refused', async () => {
  const b = browser();
  await b.get('/crew/signup');
  const r = await b.postWithoutToken('/crew/signup', { full_name: 'X', email: 'x@test.example', password: 'a-good-password', city_code: 'rome', primary_role: 'gaffer' });
  assert.equal(r.status, 403);
});

dbTest('full flow: post, pay, match, offer, accept, and the clock resets only after both confirm', async () => {
  const today = todayIso();
  const crew = browser();
  const production = browser();
  await signUpCrew(crew, 'flow-crew@test.example');
  await signUpProduction(production, 'flow-prod@test.example');

  // Crew fills in profile and availability.
  await crew.get('/crew/profile');
  let r = await crew.post('/crew/profile', {
    full_name: 'Flo Gaffer', phone: '', city_code: 'rome', travel_radius_km: '100', rate_min: '400', rate_max: '500',
    bio: 'Gaffer', skills: 'rigging, dmx', gear: 'skypanel', primary_role: 'gaffer', other_roles: ['electrician'],
  });
  assert.equal(r.status, 302);
  r = await crew.post('/crew/availability', { start_date: addDays(today, -3), end_date: addDays(today, 30) });
  assert.equal(r.status, 302);

  // Production posts a project and a position.
  await production.get('/production/projects/new');
  r = await production.post('/production/projects', {
    title: 'Flow Film', description: '', city_code: 'rome', start_date: today, end_date: addDays(today, 4), budget_min: '', budget_max: '',
  });
  assert.equal(r.status, 302);
  const projectPath = r.location;
  await production.get(projectPath);
  r = await production.post(`${projectPath}/positions`, {
    role_code: 'gaffer', headcount: '1', rate_min: '350', rate_max: '550', required_skills: 'rigging', required_gear: '',
    start_date: today, end_date: addDays(today, 4), notes: '',
  });
  assert.equal(r.status, 302);
  const { rows: [position] } = await db.query("SELECT p.id FROM positions p JOIN projects pr ON pr.id = p.project_id WHERE pr.title = 'Flow Film'");

  // Unpaid: crew do not see it, production sees no suggestions.
  assert.ok(!(await crew.get('/crew/jobs')).text.includes('Flow Film'));
  // Pay (stub) to open the project.
  r = await production.post(`${projectPath}/pay`);
  assert.equal(r.status, 302);
  assert.ok((await crew.get('/crew/jobs')).text.includes('Flow Film'));

  // Production sees the crew member, with no scores anywhere on the page.
  const page = await production.get(`/production/positions/${position.id}`);
  assert.ok(page.text.includes('Flo Gaffer'));
  assert.ok(!/score|weight|factor/i.test(page.text), 'ranking math must never reach the browser');
  assert.ok(!page.text.includes('flow-crew@test.example'), 'email stays private until an offer is accepted');

  const { rows: [crewRow] } = await db.query("SELECT id FROM crew WHERE email = 'flow-crew@test.example'");
  r = await production.post(`/production/positions/${position.id}/offers`, { crew_id: String(crewRow.id), offered_rate: '500', message: 'Hi' });
  assert.equal(r.status, 302);
  const { rows: [engagement] } = await db.query('SELECT id FROM engagements WHERE crew_id = $1', [crewRow.id]);

  await crew.get('/crew');
  await crew.post(`/crew/engagements/${engagement.id}/accept`);
  assert.ok((await production.get(`/production/positions/${position.id}`)).text.includes('flow-crew@test.example'));

  // Crew confirms alone: clock does not move.
  await crew.post(`/crew/engagements/${engagement.id}/confirm`);
  let dash = await crew.get('/crew');
  assert.match(dash.text, /No confirmed jobs yet/);

  // Production confirms: now it counts.
  await production.get('/production');
  await production.post(`/production/engagements/${engagement.id}/confirm`, { back: 'dashboard' });
  dash = await crew.get('/crew');
  assert.ok(!dash.text.includes('No confirmed jobs yet'));
  assert.match(dash.text, /<p class="big">0<\/p>/);
});

dbTest('a production cannot send an offer to crew the matching did not suggest', async () => {
  const production = browser();
  await signUpProduction(production, 'nomatch-prod@test.example');
  const { rows: [{ id: soundId }] } = await db.query(
    "INSERT INTO crew (email, password_hash, full_name, city_code, city_name, lat, lng) VALUES ('sound@test.example', 'x', 'S', 'rome', 'Rome', 41.9, 12.5) RETURNING id");
  await db.query("INSERT INTO crew_roles (crew_id, role_code, is_primary) VALUES ($1, 'sound_mixer', TRUE)", [soundId]);
  const today = todayIso();
  await production.get('/production/projects/new');
  const r = await production.post('/production/projects', {
    title: 'No Match', city_code: 'rome', start_date: today, end_date: addDays(today, 2),
  });
  await production.get(r.location);
  await production.post(`${r.location}/positions`, { role_code: 'gaffer', headcount: '1', start_date: today, end_date: addDays(today, 2) });
  await production.post(`${r.location}/pay`);
  const { rows: [position] } = await db.query("SELECT p.id FROM positions p JOIN projects pr ON pr.id = p.project_id WHERE pr.title = 'No Match'");
  await production.get(`/production/positions/${position.id}`);
  await production.post(`/production/positions/${position.id}/offers`, { crew_id: String(soundId) });
  const { rows } = await db.query('SELECT 1 FROM engagements WHERE crew_id = $1', [soundId]);
  assert.equal(rows.length, 0);
});
