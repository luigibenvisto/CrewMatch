/** Starts CrewMatch: updates the database, optionally loads sample data, then serves the site. */
const env = require('./config/env');
const { getPool } = require('./db/pool');
const { migrate } = require('./db/migrate');
const { createApp } = require('./app');

async function main() {
  const pool = getPool();
  await migrate(pool);
  if (env.seedSampleData) {
    const { seedIfEmpty } = require('./db/seed');
    await seedIfEmpty(pool);
  }
  const app = createApp(pool);
  const server = app.listen(env.port, () => console.log(`CrewMatch is running on port ${env.port}`));

  const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('CrewMatch could not start:', err.message);
  process.exit(1);
});
