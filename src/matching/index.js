/**
 * Loads data from the database, runs the matching algorithm and returns
 * ONLY what people are allowed to see: an ordered list, never scores.
 */
const config = require('../config/matching');
const { departments, departmentOf } = require('../config/roles');
const { rankCandidates } = require('./score');
const { todayIso } = require('../lib/dates');

function rolesInDepartment(dept) {
  const d = departments.find((x) => x.code === dept);
  return d ? d.roles.map((r) => r.code) : [];
}

/** Loads crew with everything the algorithm needs. Filter by ids or by department. */
async function loadCrewForMatching(db, { crewIds, department } = {}) {
  const where = ['NOT c.is_suspended'];
  const params = [];
  if (crewIds) {
    params.push(crewIds);
    where.push(`c.id = ANY($${params.length})`);
  }
  if (department) {
    params.push(rolesInDepartment(department));
    where.push(`EXISTS (SELECT 1 FROM crew_roles r WHERE r.crew_id = c.id AND r.role_code = ANY($${params.length}))`);
  }
  const { rows: crew } = await db.query(
    `SELECT c.id, c.full_name, c.city_name, c.lat, c.lng, c.travel_radius_km, c.rate_min, c.rate_max,
            c.skills, c.gear, c.bio, s.last_worked_on, s.confirmed_jobs, s.crew_cancellations
       FROM crew c JOIN crew_work_stats s ON s.crew_id = c.id
      WHERE ${where.join(' AND ')}`,
    params,
  );
  if (crew.length === 0) return [];
  const ids = crew.map((c) => c.id);

  const [roles, availability, booked] = await Promise.all([
    db.query('SELECT crew_id, role_code, is_primary FROM crew_roles WHERE crew_id = ANY($1)', [ids]),
    db.query('SELECT crew_id, start_date, end_date FROM crew_availability WHERE crew_id = ANY($1)', [ids]),
    db.query(
      `SELECT e.crew_id, p.id AS position_id, p.start_date, p.end_date
         FROM engagements e JOIN positions p ON p.id = e.position_id
        WHERE e.crew_id = ANY($1) AND e.status = 'accepted'`,
      [ids],
    ),
  ]);
  const byId = new Map(crew.map((c) => [c.id, { ...c, roles: [], availability: [], booked: [] }]));
  for (const r of roles.rows) byId.get(r.crew_id).roles.push(r);
  for (const a of availability.rows) byId.get(a.crew_id).availability.push(a);
  for (const b of booked.rows) byId.get(b.crew_id).booked.push(b);
  return [...byId.values()];
}

/** A crew member's own booking on this very position must not count as a clash. */
function forPosition(crew, positionId) {
  return { ...crew, booked: crew.booked.filter((b) => b.position_id !== positionId) };
}

async function loadPosition(db, positionId) {
  const { rows } = await db.query(
    `SELECT p.*, pr.lat, pr.lng, pr.city_name, pr.title AS project_title, pr.production_id, pr.status AS project_status
       FROM positions p JOIN projects pr ON pr.id = p.project_id WHERE p.id = $1`,
    [positionId],
  );
  return rows[0] || null;
}

/** Only what a production may see about a shortlisted crew member. No scores. */
function toPublicCrew(crew) {
  const primary = crew.roles.find((r) => r.is_primary);
  return {
    id: crew.id,
    full_name: crew.full_name,
    primary_role: primary ? primary.role_code : null,
    other_roles: crew.roles.filter((r) => !r.is_primary).map((r) => r.role_code),
    city_name: crew.city_name,
    travel_radius_km: crew.travel_radius_km,
    rate_min: crew.rate_min,
    rate_max: crew.rate_max,
    skills: crew.skills,
    gear: crew.gear,
    bio: crew.bio,
    confirmed_jobs: crew.confirmed_jobs,
  };
}

/**
 * The ranked shortlist a production sees for one of its positions.
 * Crew who already have an offer for this position are left out.
 */
async function shortlistForPosition(db, positionId, { today = todayIso() } = {}) {
  const position = await loadPosition(db, positionId);
  if (!position) return [];
  const pool = await loadCrewForMatching(db, { department: departmentOf(position.role_code) });
  const { rows: taken } = await db.query('SELECT crew_id FROM engagements WHERE position_id = $1', [positionId]);
  const exclude = new Set(taken.map((t) => t.crew_id));
  const candidates = pool.filter((c) => !exclude.has(c.id)).map((c) => forPosition(c, positionId));
  const ranked = rankCandidates(position, candidates, { config, today }).slice(0, config.shortlistSize);
  if (ranked.length === 0) return [];

  const ids = ranked.map((r) => r.crew.id);
  const [credits, interests] = await Promise.all([
    db.query('SELECT crew_id, project_title, role_title, year, company FROM crew_credits WHERE crew_id = ANY($1) ORDER BY year DESC NULLS LAST', [ids]),
    db.query('SELECT crew_id FROM interests WHERE position_id = $1 AND crew_id = ANY($2)', [positionId, ids]),
  ]);
  const interested = new Set(interests.rows.map((i) => i.crew_id));
  return ranked.map(({ crew }) => ({
    ...toPublicCrew(crew),
    credits: credits.rows.filter((c) => c.crew_id === crew.id).slice(0, 5),
    interested: interested.has(crew.id),
  }));
}

/** Jobs that fit a crew member, best first. Jobs they already have an offer for are left out. */
async function matchedJobsForCrew(db, crewId, { today = todayIso() } = {}) {
  const [crew] = await loadCrewForMatching(db, { crewIds: [crewId] });
  if (!crew) return [];
  const { rows: positions } = await db.query(
    `SELECT p.*, pr.lat, pr.lng, pr.city_name, pr.title AS project_title, pr.description AS project_description,
            prod.company_name
       FROM positions p
       JOIN projects pr ON pr.id = p.project_id
       JOIN productions prod ON prod.id = pr.production_id
      WHERE p.status = 'open' AND pr.status = 'open' AND p.end_date >= $2 AND NOT prod.is_suspended
        AND NOT EXISTS (SELECT 1 FROM engagements e WHERE e.position_id = p.id AND e.crew_id = $1)`,
    [crewId, today],
  );
  const { rows: interests } = await db.query('SELECT position_id FROM interests WHERE crew_id = $1', [crewId]);
  const interested = new Set(interests.map((i) => i.position_id));

  const scored = [];
  for (const position of positions) {
    const [ranked] = rankCandidates(position, [forPosition(crew, position.id)], { config, today });
    if (ranked) scored.push({ position, score: ranked.score });
  }
  scored.sort((a, b) => b.score - a.score || a.position.start_date.localeCompare(b.position.start_date));
  return scored.slice(0, config.crewFeedSize).map(({ position: p }) => ({
    position_id: p.id,
    role_code: p.role_code,
    project_title: p.project_title,
    project_description: p.project_description,
    company_name: p.company_name,
    city_name: p.city_name,
    start_date: p.start_date,
    end_date: p.end_date,
    rate_min: p.rate_min,
    rate_max: p.rate_max,
    required_skills: p.required_skills,
    required_gear: p.required_gear,
    notes: p.notes,
    interested: interested.has(p.id),
  }));
}

/** True if this crew member currently appears in the shortlist (used to authorise offers). */
async function isShortlisted(db, positionId, crewId, opts) {
  const list = await shortlistForPosition(db, positionId, opts);
  return list.some((c) => c.id === crewId);
}

module.exports = { loadCrewForMatching, shortlistForPosition, matchedJobsForCrew, isShortlisted, toPublicCrew };
