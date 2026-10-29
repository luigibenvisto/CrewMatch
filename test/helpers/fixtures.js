/** Small builders for test data. */
const { findCity } = require('../../src/config/cities');

let counter = 0;
const next = () => { counter += 1; return counter; };

async function makeCrew(db, { role = 'gaffer', city = 'los_angeles' } = {}) {
  const c = findCity(city);
  const n = next();
  const { rows: [{ id }] } = await db.query(
    `INSERT INTO crew (email, password_hash, full_name, city_code, city_name, lat, lng, travel_radius_km, rate_min, rate_max)
     VALUES ($1, 'x', $2, $3, $4, $5, $6, 100, 300, 500) RETURNING id`,
    [`crew${n}@test.example`, `Crew ${n}`, c.code, c.name, c.lat, c.lng]);
  await db.query('INSERT INTO crew_roles (crew_id, role_code, is_primary) VALUES ($1, $2, TRUE)', [id, role]);
  return id;
}

async function makeProduction(db) {
  const n = next();
  const { rows: [{ id }] } = await db.query(
    "INSERT INTO productions (email, password_hash, company_name, contact_name) VALUES ($1, 'x', $2, 'Contact') RETURNING id",
    [`prod${n}@test.example`, `Company ${n}`]);
  return id;
}

async function makePosition(db, productionId, { start = '2026-03-01', end = '2026-03-10', role = 'gaffer', city = 'los_angeles' } = {}) {
  const c = findCity(city);
  const { rows: [{ id: projectId }] } = await db.query(
    `INSERT INTO projects (production_id, title, city_code, city_name, lat, lng, start_date, end_date, status, billing)
     VALUES ($1, 'Test project', $2, $3, $4, $5, $6, $7, 'open', 'paid') RETURNING id`,
    [productionId, c.code, c.name, c.lat, c.lng, start, end]);
  const { rows: [{ id }] } = await db.query(
    'INSERT INTO positions (project_id, role_code, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING id',
    [projectId, role, start, end]);
  return id;
}

/** An accepted engagement, ready to be confirmed. Inserted directly to skip the matching step. */
async function makeAcceptedJob(db, opts = {}) {
  const crewId = opts.crewId || await makeCrew(db);
  const productionId = opts.productionId || await makeProduction(db);
  const positionId = await makePosition(db, productionId, opts);
  const { rows: [{ id }] } = await db.query(
    "INSERT INTO engagements (position_id, crew_id, status, responded_at) VALUES ($1, $2, 'accepted', now()) RETURNING id",
    [positionId, crewId]);
  return { engagementId: id, crewId, productionId, positionId };
}

module.exports = { makeCrew, makeProduction, makePosition, makeAcceptedJob };
