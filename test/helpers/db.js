/**
 * Test database helper. Tests that need Postgres use TEST_DATABASE_URL
 * (default: a local "crewmatch_test" database). The test database is wiped.
 * If no database is reachable those tests are skipped, unless REQUIRE_DB_TESTS=1
 * (set in CI), in which case they fail.
 */
const { createPool } = require('../../src/db/pool');
const { migrate } = require('../../src/db/migrate');

const URL = process.env.TEST_DATABASE_URL || 'postgres://crewmatch:crewmatch@localhost:5432/crewmatch_test';

async function connectTestDb() {
  const pool = createPool(URL);
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    await pool.end().catch(() => {});
    if (process.env.REQUIRE_DB_TESTS === '1') throw err;
    return null;
  }
  return pool;
}

async function resetDb(pool) {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool, { log: () => {} });
}

module.exports = { connectTestDb, resetDb };
