/** Crew profile data: roles, skills, gear, location, rates, availability, credits. */
const { withTransaction } = require('../db/pool');
const { findCity } = require('../config/cities');
const { UserError } = require('../lib/errors');

async function getCrewProfile(db, crewId) {
  const { rows } = await db.query('SELECT * FROM crew WHERE id = $1', [crewId]);
  if (!rows[0]) return null;
  const [roles, availability, credits] = await Promise.all([
    db.query('SELECT role_code, is_primary FROM crew_roles WHERE crew_id = $1 ORDER BY is_primary DESC, role_code', [crewId]),
    db.query('SELECT id, start_date, end_date FROM crew_availability WHERE crew_id = $1 ORDER BY start_date', [crewId]),
    db.query('SELECT * FROM crew_credits WHERE crew_id = $1 ORDER BY year DESC NULLS LAST, id DESC', [crewId]),
  ]);
  const primary = roles.rows.find((r) => r.is_primary);
  return {
    ...rows[0],
    roles: roles.rows,
    primary_role: primary ? primary.role_code : null,
    other_roles: roles.rows.filter((r) => !r.is_primary).map((r) => r.role_code),
    availability: availability.rows,
    credits: credits.rows,
  };
}

async function updateCrewProfile(db, crewId, data) {
  const city = findCity(data.city_code);
  const otherRoles = [...new Set(data.other_roles)].filter((r) => r !== data.primary_role);
  await withTransaction(db, async (client) => {
    await client.query(
      `UPDATE crew SET full_name = $2, phone = $3, city_code = $4, city_name = $5, lat = $6, lng = $7,
              travel_radius_km = $8, rate_min = $9, rate_max = $10, bio = $11, skills = $12, gear = $13, updated_at = now()
        WHERE id = $1`,
      [crewId, data.full_name, data.phone || null, city.code, city.name, city.lat, city.lng,
        data.travel_radius_km, data.rate_min, data.rate_max, data.bio, data.skills, data.gear],
    );
    await client.query('DELETE FROM crew_roles WHERE crew_id = $1', [crewId]);
    await client.query('INSERT INTO crew_roles (crew_id, role_code, is_primary) VALUES ($1, $2, TRUE)', [crewId, data.primary_role]);
    for (const role of otherRoles) {
      await client.query('INSERT INTO crew_roles (crew_id, role_code, is_primary) VALUES ($1, $2, FALSE)', [crewId, role]);
    }
  });
}

async function addAvailability(db, crewId, { start_date, end_date }) {
  const { rows: [{ count }] } = await db.query('SELECT count(*)::int AS count FROM crew_availability WHERE crew_id = $1', [crewId]);
  if (count >= 100) throw new UserError('You have too many availability periods. Remove some old ones first.');
  await db.query('INSERT INTO crew_availability (crew_id, start_date, end_date) VALUES ($1, $2, $3)', [crewId, start_date, end_date]);
}

async function removeAvailability(db, crewId, id) {
  await db.query('DELETE FROM crew_availability WHERE id = $1 AND crew_id = $2', [id, crewId]);
}

async function addCredit(db, crewId, { project_title, role_title, year, company }) {
  const { rows: [{ count }] } = await db.query('SELECT count(*)::int AS count FROM crew_credits WHERE crew_id = $1', [crewId]);
  if (count >= 200) throw new UserError('You have reached the maximum number of credits.');
  await db.query('INSERT INTO crew_credits (crew_id, project_title, role_title, year, company) VALUES ($1, $2, $3, $4, $5)',
    [crewId, project_title, role_title, year, company]);
}

async function removeCredit(db, crewId, id) {
  await db.query('DELETE FROM crew_credits WHERE id = $1 AND crew_id = $2', [id, crewId]);
}

module.exports = { getCrewProfile, updateCrewProfile, addAvailability, removeAvailability, addCredit, removeCredit };
