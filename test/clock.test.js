/**
 * The "days since last worked" clock. The key rule: it resets ONLY when BOTH
 * the crew member and the production confirm a job. Neither side alone can do it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { connectTestDb, resetDb } = require('./helpers/db');
const { makeAcceptedJob, makeCrew, makeProduction } = require('./helpers/fixtures');
const { confirmCompletion, getClock, cancelEngagement } = require('../src/services/engagements');

const TODAY = '2026-03-20';
let db;

test.before(async () => {
  db = await connectTestDb();
  if (db) await resetDb(db);
});
test.after(async () => { if (db) await db.end(); });

const dbTest = (name, fn) => test(name, async (t) => {
  if (!db) return t.skip('no test database available (set TEST_DATABASE_URL)');
  return fn(t);
});

const crewConfirms = (job, today = TODAY) => confirmCompletion(db, { side: 'crew', actorId: job.crewId, engagementId: job.engagementId, today });
const productionConfirms = (job, today = TODAY) => confirmCompletion(db, { side: 'production', actorId: job.productionId, engagementId: job.engagementId, today });
const status = async (job) => (await db.query('SELECT status FROM engagements WHERE id = $1', [job.engagementId])).rows[0].status;

dbTest('a new crew member has no clock value', async () => {
  const crewId = await makeCrew(db);
  const clock = await getClock(db, crewId, TODAY);
  assert.equal(clock.lastWorkedOn, null);
  assert.equal(clock.daysSinceLastWorked, null);
  assert.equal(clock.confirmedJobs, 0);
});

dbTest('crew confirming alone does NOT reset the clock', async () => {
  const job = await makeAcceptedJob(db);
  const result = await crewConfirms(job);
  assert.equal(result.completed, false);
  assert.equal(await status(job), 'accepted');
  const clock = await getClock(db, job.crewId, TODAY);
  assert.equal(clock.lastWorkedOn, null);
  assert.equal(clock.confirmedJobs, 0);
});

dbTest('crew confirming many times alone still does NOT reset the clock', async () => {
  const job = await makeAcceptedJob(db);
  for (let i = 0; i < 5; i += 1) await crewConfirms(job);
  assert.equal(await status(job), 'accepted');
  assert.equal((await getClock(db, job.crewId, TODAY)).lastWorkedOn, null);
});

dbTest('production confirming alone does NOT reset the clock', async () => {
  const job = await makeAcceptedJob(db);
  const result = await productionConfirms(job);
  assert.equal(result.completed, false);
  assert.equal((await getClock(db, job.crewId, TODAY)).lastWorkedOn, null);
});

dbTest('both sides confirming resets the clock (crew first)', async () => {
  const job = await makeAcceptedJob(db, { start: '2026-03-01', end: '2026-03-10' });
  await crewConfirms(job);
  const result = await productionConfirms(job);
  assert.equal(result.completed, true);
  assert.equal(await status(job), 'completed');
  const clock = await getClock(db, job.crewId, TODAY);
  assert.equal(clock.lastWorkedOn, '2026-03-10');
  assert.equal(clock.daysSinceLastWorked, 10);
  assert.equal(clock.confirmedJobs, 1);
});

dbTest('both sides confirming resets the clock (production first)', async () => {
  const job = await makeAcceptedJob(db, { start: '2026-03-01', end: '2026-03-15' });
  await productionConfirms(job);
  const result = await crewConfirms(job);
  assert.equal(result.completed, true);
  assert.equal((await getClock(db, job.crewId, TODAY)).lastWorkedOn, '2026-03-15');
});

dbTest('a job confirmed before its end date counts until today, never a future date', async () => {
  const job = await makeAcceptedJob(db, { start: '2026-03-15', end: '2026-04-30' });
  await crewConfirms(job);
  await productionConfirms(job);
  const clock = await getClock(db, job.crewId, TODAY);
  assert.equal(clock.lastWorkedOn, TODAY);
  assert.equal(clock.daysSinceLastWorked, 0);
});

dbTest('a job cannot be confirmed before it starts', async () => {
  const job = await makeAcceptedJob(db, { start: '2026-04-01', end: '2026-04-05' });
  await assert.rejects(crewConfirms(job), /once it has started/);
  await assert.rejects(productionConfirms(job), /once it has started/);
});

dbTest('another crew member cannot confirm someone else\'s job', async () => {
  const job = await makeAcceptedJob(db);
  const stranger = await makeCrew(db);
  await assert.rejects(
    confirmCompletion(db, { side: 'crew', actorId: stranger, engagementId: job.engagementId, today: TODAY }), /not found/i);
  await productionConfirms(job);
  assert.equal(await status(job), 'accepted', 'a stranger\'s confirmation must not count');
});

dbTest('a different production cannot confirm a job it does not own', async () => {
  const job = await makeAcceptedJob(db);
  await crewConfirms(job);
  const otherProduction = await makeProduction(db);
  await assert.rejects(
    confirmCompletion(db, { side: 'production', actorId: otherProduction, engagementId: job.engagementId, today: TODAY }), /not found/i);
  assert.equal(await status(job), 'accepted');
});

dbTest('a crew member who also owns a production account cannot confirm a job from another production', async () => {
  const job = await makeAcceptedJob(db);
  const crewsOwnProduction = await makeProduction(db);
  await crewConfirms(job);
  await assert.rejects(
    confirmCompletion(db, { side: 'production', actorId: crewsOwnProduction, engagementId: job.engagementId, today: TODAY }), /not found/i);
  assert.equal((await getClock(db, job.crewId, TODAY)).lastWorkedOn, null);
});

dbTest('offers that were never accepted cannot be confirmed', async () => {
  const job = await makeAcceptedJob(db);
  await db.query("UPDATE engagements SET status = 'offered' WHERE id = $1", [job.engagementId]);
  await assert.rejects(crewConfirms(job), /Only accepted jobs/);
  await assert.rejects(productionConfirms(job), /Only accepted jobs/);
});

dbTest('database refuses to mark a job completed with only one confirmation, even with direct SQL', async () => {
  const job = await makeAcceptedJob(db);
  await crewConfirms(job);
  await assert.rejects(
    db.query("UPDATE engagements SET status = 'completed', completed_at = now(), worked_until = '2026-03-10' WHERE id = $1", [job.engagementId]),
    /completed_needs_both_confirmations/,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO engagements (position_id, crew_id, status, crew_confirmed_at, completed_at, worked_until)
       SELECT position_id, $2, 'completed', now(), now(), '2026-03-10' FROM engagements WHERE id = $1`,
      [job.engagementId, await makeCrew(db)]),
    /completed_needs_both_confirmations/,
  );
  assert.equal((await getClock(db, job.crewId, TODAY)).lastWorkedOn, null);
});

dbTest('a confirmation cannot be removed, and a completed job cannot be changed', async () => {
  const job = await makeAcceptedJob(db);
  await crewConfirms(job);
  await assert.rejects(
    db.query('UPDATE engagements SET crew_confirmed_at = NULL WHERE id = $1', [job.engagementId]), /cannot be changed/);
  await productionConfirms(job);
  await assert.rejects(
    db.query("UPDATE engagements SET worked_until = '2026-03-19' WHERE id = $1", [job.engagementId]), /cannot be changed/);
});

dbTest('the clock moves only to the most recent job both sides confirmed', async () => {
  const crewId = await makeCrew(db);
  const older = await makeAcceptedJob(db, { crewId, start: '2026-01-05', end: '2026-01-10' });
  const newer = await makeAcceptedJob(db, { crewId, start: '2026-02-01', end: '2026-02-20' });
  await crewConfirms(older);
  await productionConfirms(older);
  await crewConfirms(newer); // newer job: crew only
  const clock = await getClock(db, crewId, TODAY);
  assert.equal(clock.lastWorkedOn, '2026-01-10');
  assert.equal(clock.confirmedJobs, 1);
});

dbTest('once one side has confirmed, the job can no longer be cancelled', async () => {
  const job = await makeAcceptedJob(db);
  await productionConfirms(job);
  await assert.rejects(
    cancelEngagement(db, { side: 'crew', actorId: job.crewId, engagementId: job.engagementId }), /can no longer be cancelled/);
});

dbTest('two confirmations arriving at the same moment complete the job exactly once', async () => {
  const job = await makeAcceptedJob(db, { start: '2026-03-01', end: '2026-03-05' });
  const results = await Promise.all([crewConfirms(job), productionConfirms(job)]);
  assert.equal(results.filter((r) => r.completed).length, 1);
  assert.equal(await status(job), 'completed');
  assert.equal((await getClock(db, job.crewId, TODAY)).lastWorkedOn, '2026-03-05');
});
