/** Signup and login. Crew and productions live in separate tables with separate logins. */
const { withTransaction } = require('../db/pool');
const { hashPassword, verifyPassword, burnPasswordCheck } = require('../lib/password');
const { UserError } = require('../lib/errors');
const { findCity } = require('../config/cities');

async function signUpCrew(db, { full_name, email, password, city_code, primary_role }, { isSample = false } = {}) {
  const city = findCity(city_code);
  const hash = await hashPassword(password);
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO crew (email, password_hash, full_name, city_code, city_name, lat, lng, is_sample)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (lower(email)) DO NOTHING RETURNING id`,
      [email, hash, full_name, city.code, city.name, city.lat, city.lng, isSample],
    );
    if (!rows[0]) throw new UserError('An account with this email already exists. Try logging in.');
    await client.query('INSERT INTO crew_roles (crew_id, role_code, is_primary) VALUES ($1, $2, TRUE)', [rows[0].id, primary_role]);
    return rows[0].id;
  });
}

async function signUpProduction(db, { company_name, contact_name, email, password }, { isSample = false } = {}) {
  const hash = await hashPassword(password);
  const { rows } = await db.query(
    `INSERT INTO productions (email, password_hash, company_name, contact_name, is_sample)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (lower(email)) DO NOTHING RETURNING id`,
    [email, hash, company_name, contact_name, isSample],
  );
  if (!rows[0]) throw new UserError('An account with this email already exists. Try logging in.');
  return rows[0].id;
}

/** table is fixed by the caller ('crew' or 'productions'), never taken from user input. */
async function logIn(db, table, { email, password }) {
  if (!['crew', 'productions'].includes(table)) throw new Error('bad table');
  const { rows } = await db.query(`SELECT id, password_hash, is_suspended FROM ${table} WHERE lower(email) = lower($1)`, [email]);
  const account = rows[0];
  const ok = account ? await verifyPassword(password, account.password_hash) : await burnPasswordCheck(password);
  if (!ok) throw new UserError('Wrong email or password.', 401);
  if (account.is_suspended) throw new UserError('This account is suspended. Contact the CrewMatch team.', 403);
  return account.id;
}

module.exports = { signUpCrew, signUpProduction, logIn };
