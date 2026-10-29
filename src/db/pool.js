const { Pool, types } = require('pg');
const env = require('../config/env');

// Return DATE columns as plain 'YYYY-MM-DD' strings so time zones can never shift a shoot day.
types.setTypeParser(1082, (value) => value);

function sslFor(url) {
  if (/localhost|127\.0\.0\.1/.test(url) || /sslmode=disable/.test(url)) return false;
  return env.databaseSslNoVerify ? { rejectUnauthorized: false } : true;
}

let pool;

function getPool() {
  if (!pool) {
    const url = env.databaseUrl();
    pool = new Pool({ connectionString: url, ssl: sslFor(url), max: 5 });
  }
  return pool;
}

function createPool(url) {
  return new Pool({ connectionString: url, ssl: sslFor(url), max: 5 });
}

/** Runs fn(client) inside a transaction. Rolls back on any error. */
async function withTransaction(db, fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getPool, createPool, withTransaction };
