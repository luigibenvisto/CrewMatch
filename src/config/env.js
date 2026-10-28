/** Reads settings from environment variables. Secrets never live in the code. */
const isProduction = process.env.NODE_ENV === 'production';

function required(name, devFallback) {
  const value = process.env[name];
  if (value) return value;
  if (!isProduction && devFallback !== undefined) return devFallback;
  throw new Error(`Missing required environment variable ${name}. See README, "Environment variables".`);
}

const env = {
  isProduction,
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT) || 3000,
  databaseUrl: () => required('DATABASE_URL', 'postgres://crewmatch:crewmatch@localhost:5432/crewmatch_dev'),
  sessionSecret: () => required('SESSION_SECRET', 'dev-only-insecure-secret-do-not-use-in-production'),
  adminEmail: () => process.env.ADMIN_EMAIL || '',
  adminPassword: () => process.env.ADMIN_PASSWORD || '',
  seedSampleData: process.env.SEED_SAMPLE_DATA === 'true',
  paymentsMode: process.env.PAYMENTS_MODE || 'stub',
  databaseSslNoVerify: process.env.DATABASE_SSL_NO_VERIFY === 'true',
};

if (isProduction && env.sessionSecret().length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters long in production.');
}

module.exports = env;
