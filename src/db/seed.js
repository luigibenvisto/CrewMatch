/**
 * Loads invented sample crew and productions. All names, companies and credits are made up.
 * Every sample account is flagged is_sample, and the admin page can delete them all at once.
 *
 * Sample logins (all share one password, shown in the README):
 *   crew1@sample.crewmatch.test ... crew90@sample.crewmatch.test
 *   production1@sample.crewmatch.test ... production4@sample.crewmatch.test
 */
const { findCity } = require('../config/cities');
const { departments } = require('../config/roles');
const { hashPassword } = require('../lib/password');
const { todayIso, addDays } = require('../lib/dates');

const SAMPLE_PASSWORD = 'sample-password-123';

// Small deterministic random generator so every seed run produces the same data.
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const FIRST = ['Ava', 'Marco', 'Lena', 'Theo', 'Sofia', 'Jonah', 'Priya', 'Mateo', 'Hana', 'Felix', 'Nora', 'Luca',
  'Zara', 'Omar', 'Greta', 'Diego', 'Ines', 'Kai', 'Maya', 'Elio', 'Rosa', 'Sam', 'Yara', 'Bruno', 'Ivy', 'Nico',
  'Chloe', 'Arjun', 'Freya', 'Tomas', 'Leila', 'Ezra', 'Mila', 'Rafael', 'Anya', 'Jude', 'Elsa', 'Kofi', 'Vera', 'Milo'];
const LAST = ['Rossi', 'Okafor', 'Lindqvist', 'Moreau', 'Castillo', 'Nakamura', 'Brennan', 'Haddad', 'Novak', 'Ferreira',
  'Kowalski', 'Adeyemi', 'Silva', 'Bianchi', 'Dubois', 'Jensen', 'Patel', 'Romano', 'Fischer', 'Quinn'];

const SKILLS = {
  camera: [['steadicam', 'focus pulling', 'drone', 'gimbal', 'anamorphic'], ['arri alexa', 'red komodo', 'sony venice', 'cooke primes', 'dji ronin']],
  grip: [['rigging', 'dolly', 'crane', 'car mounts'], ['dana dolly', 'jib arm', 'c-stands', 'speed rail']],
  electric: [['rigging', 'dmx', 'generator', 'lighting design'], ['skypanel', 'aputure 600d', 'astera tubes', 'generator 100kva']],
  sound: [['wireless', 'timecode', 'boom', 'playback'], ['sound devices 888', 'zaxcom', 'sennheiser mkh416', 'lectrosonics']],
  art: [['carpentry', 'set dressing', 'props', 'scenic painting'], ['prop van', 'workshop', 'power tools']],
  costume_hmu: [['period costume', 'sfx makeup', 'wigs', 'tailoring'], ['makeup kit', 'sewing machine']],
  production: [['scheduling', 'budgeting', 'movie magic', 'locations'], ['production van', 'walkies']],
  post: [['davinci resolve', 'avid', 'premiere', 'after effects', 'pro tools'], ['edit suite', 'grading monitor']],
};

// Most sample crew live near the sample projects (Los Angeles, Rome, London, Atlanta) so shortlists are full.
const CITY_ROTATION = ['los_angeles', 'rome', 'london', 'atlanta', 'los_angeles', 'naples', 'london', 'atlanta',
  'new_york', 'milan', 'manchester', 'vancouver'];
// Roles the sample projects need, so each of their positions has several candidates.
const BUSY_ROLES = ['dop', 'first_ac', 'gaffer', 'key_grip', 'sound_mixer', 'production_designer', 'camera_operator',
  'second_ac', 'electrician', 'boom_operator', 'art_director', 'first_ad', 'steadicam', 'key_makeup', 'grip', 'editor'];
const CREW_COUNT = 90;

function pick(r, list) { return list[Math.floor(r() * list.length)]; }
function pickSome(r, list, n) {
  const copy = [...list];
  const out = [];
  while (copy.length && out.length < n) out.push(copy.splice(Math.floor(r() * copy.length), 1)[0]);
  return out;
}

async function seed(db, { log = console.log } = {}) {
  const r = rng(42);
  const today = todayIso();
  const hash = await hashPassword(SAMPLE_PASSWORD);
  const allRoles = departments.flatMap((d) => d.roles);

  // ---- Crew ----------------------------------------------------------------
  const crewIds = [];
  for (let i = 0; i < CREW_COUNT; i += 1) {
    const role = i < allRoles.length ? allRoles[i] : allRoles.find((x) => x.code === BUSY_ROLES[i % BUSY_ROLES.length]);
    const dept = role.department;
    const city = findCity(CITY_ROTATION[i % CITY_ROTATION.length]);
    const base = 250 + Math.round(r() * 10) * 50;
    const [skillPool, gearPool] = SKILLS[dept];
    const { rows: [{ id }] } = await db.query(
      `INSERT INTO crew (email, password_hash, full_name, city_code, city_name, lat, lng, travel_radius_km,
                         rate_min, rate_max, bio, skills, gear, is_sample, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE, now() - interval '200 days') RETURNING id`,
      [`crew${i + 1}@sample.crewmatch.test`, hash, `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + Math.floor(i / FIRST.length)) % LAST.length]}`, city.code, city.name, city.lat, city.lng,
        pick(r, [50, 100, 250, 500]), base, base + 150,
        `${role.label} based in ${city.name}. (Sample profile, invented for testing.)`,
        pickSome(r, skillPool, 2 + Math.floor(r() * 2)), pickSome(r, gearPool, 1 + Math.floor(r() * 2))],
    );
    crewIds.push({ id, role, city });
    await db.query('INSERT INTO crew_roles (crew_id, role_code, is_primary) VALUES ($1, $2, TRUE)', [id, role.code]);
    const sameDept = departments.find((d) => d.code === dept).roles.filter((x) => x.code !== role.code);
    if (sameDept.length && r() < 0.6) {
      await db.query('INSERT INTO crew_roles (crew_id, role_code, is_primary) VALUES ($1, $2, FALSE)', [id, pick(r, sameDept).code]);
    }
    // Availability: most people are free for most of the next three months, with gaps.
    const start = addDays(today, Math.floor(r() * 10));
    await db.query('INSERT INTO crew_availability (crew_id, start_date, end_date) VALUES ($1, $2, $3)',
      [id, start, addDays(start, 30 + Math.floor(r() * 30))]);
    await db.query('INSERT INTO crew_availability (crew_id, start_date, end_date) VALUES ($1, $2, $3)',
      [id, addDays(start, 70), addDays(start, 100)]);
    for (let c = 0; c < 1 + Math.floor(r() * 3); c += 1) {
      await db.query('INSERT INTO crew_credits (crew_id, project_title, role_title, year, company) VALUES ($1, $2, $3, $4, $5)',
        [id, pick(r, ['The Long Field', 'Salt & Static', 'Night Ferry', 'Paper Lanterns', 'Northern Echo', 'Red Harbour', 'Glass Orchard']),
          role.label, 2019 + Math.floor(r() * 7), pick(r, ['Kestrel Pictures', 'Bright Alley Films', 'Lowtide Studio', 'Copperline Media'])]);
    }
  }

  // ---- Productions, projects and positions ---------------------------------
  const productions = [
    ['Kestrel Pictures', 'Dana Whitlock', 'los_angeles'],
    ['Lowtide Studio', 'Giulia Ferri', 'rome'],
    ['Bright Alley Films', 'Sam Okoro', 'london'],
    ['Copperline Media', 'Riley Chen', 'atlanta'],
  ];
  const productionIds = [];
  for (let i = 0; i < productions.length; i += 1) {
    const [company, contact, cityCode] = productions[i];
    const { rows: [{ id }] } = await db.query(
      `INSERT INTO productions (email, password_hash, company_name, contact_name, is_sample)
       VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
      [`production${i + 1}@sample.crewmatch.test`, hash, `${company} (sample)`, contact],
    );
    productionIds.push({ id, cityCode });
  }

  const insertProject = async (productionId, cityCode, title, start, end, status, billing) => {
    const city = findCity(cityCode);
    const { rows: [{ id }] } = await db.query(
      `INSERT INTO projects (production_id, title, description, city_code, city_name, lat, lng, start_date, end_date,
                             budget_min, budget_max, status, billing, fee_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [productionId, title, `${title}: an invented sample project for testing CrewMatch.`, city.code, city.name, city.lat, city.lng,
        start, end, 50000, 250000, status, billing, billing === 'paid' ? 3900 : 0],
    );
    return id;
  };
  const insertPosition = async (projectId, roleCode, start, end, opts = {}) => {
    const { rows: [{ id }] } = await db.query(
      `INSERT INTO positions (project_id, role_code, headcount, rate_min, rate_max, required_skills, required_gear, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [projectId, roleCode, opts.headcount || 1, opts.rateMin || 300, opts.rateMax || 650, opts.skills || [], opts.gear || [],
        start, end, opts.status || 'open'],
    );
    return id;
  };

  // Open projects in the near future.
  const open = [
    [0, 'Desert Lights (sample feature)', 7, 30, ['dop', 'first_ac', 'gaffer', 'key_grip', 'sound_mixer', 'production_designer']],
    [1, 'La Casa Blu (sample series)', 14, 60, ['camera_operator', 'second_ac', 'electrician', 'boom_operator', 'art_director', 'first_ad']],
    [2, 'Tidewater (sample commercial)', 5, 8, ['dop', 'steadicam', 'gaffer', 'key_makeup']],
    [3, 'Southern Static (sample music video)', 3, 4, ['camera_operator', 'gaffer', 'grip', 'editor']],
  ];
  for (const [p, title, offset, length, roleCodes] of open) {
    const start = addDays(today, offset);
    const end = addDays(start, length - 1);
    const projectId = await insertProject(productionIds[p].id, productionIds[p].cityCode, title, start, end, 'open', p === 1 ? 'subscription' : 'paid');
    for (const code of roleCodes) await insertPosition(projectId, code, start, end, code === 'steadicam' ? { gear: ['steadicam'] } : {});
  }
  // Give the Rome production an active subscription.
  await db.query(
    `INSERT INTO subscriptions (production_id, plan_code, status, current_period_start, current_period_end, provider, provider_ref)
     VALUES ($1, 'production_pass_monthly', 'active', $2, $3, 'stub', 'stub_seed')`,
    [productionIds[1].id, addDays(today, -5), addDays(today, 24)],
  );

  // Past project with jobs BOTH sides confirmed, so the clocks start at different values.
  const pastStart = addDays(today, -60);
  const pastEnd = addDays(today, -45);
  const pastProject = await insertProject(productionIds[0].id, 'los_angeles', 'Old Harbour (sample, finished)', pastStart, pastEnd, 'closed', 'paid');
  for (const worker of crewIds.slice(0, 12)) {
    const positionId = await insertPosition(pastProject, worker.role.code, pastStart, pastEnd, { status: 'filled' });
    await db.query(
      `INSERT INTO engagements (position_id, crew_id, status, offered_at, responded_at, crew_confirmed_at, production_confirmed_at,
                                completed_at, worked_until)
       VALUES ($1, $2, 'completed', $3, $3, $4, $4, $4, $5)`,
      [positionId, worker.id, `${addDays(pastStart, -10)}T12:00:00Z`, `${addDays(pastEnd, 1)}T12:00:00Z`, pastEnd],
    );
  }
  // One sample cancellation, so reliability differs between people.
  const cancelled = crewIds[12];
  const cancelPosition = await insertPosition(pastProject, cancelled.role.code, pastStart, pastEnd, { status: 'closed' });
  await db.query(
    `INSERT INTO engagements (position_id, crew_id, status, responded_at, cancelled_by, cancelled_at)
     VALUES ($1, $2, 'cancelled', now(), 'crew', now())`,
    [cancelPosition, cancelled.id],
  );

  log(`Seeded ${crewIds.length} sample crew and ${productionIds.length} sample productions. Password for all: ${SAMPLE_PASSWORD}`);
}

/** Seeds only when there are no accounts at all, so real data is never mixed with sample data by accident. */
async function seedIfEmpty(db, opts) {
  const { rows: [{ count }] } = await db.query('SELECT (SELECT count(*) FROM crew) + (SELECT count(*) FROM productions) AS count');
  if (Number(count) > 0) {
    (opts && opts.log ? opts.log : console.log)('Database already has accounts; sample data not loaded.');
    return false;
  }
  await seed(db, opts);
  return true;
}

if (require.main === module) {
  const { getPool } = require('./pool');
  const { migrate } = require('./migrate');
  const pool = getPool();
  migrate(pool)
    .then(() => seedIfEmpty(pool))
    .then(() => pool.end())
    .catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { seed, seedIfEmpty, SAMPLE_PASSWORD };
