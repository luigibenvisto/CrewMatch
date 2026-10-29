/**
 * Offers, answers, cancellations and job confirmations.
 *
 * THE "DAYS SINCE LAST WORKED" CLOCK
 * ----------------------------------
 * The clock is never stored on the crew record. It is always calculated from
 * engagements whose status is 'completed', and an engagement only becomes
 * 'completed' when BOTH the crew member AND the production have confirmed it.
 * Neither side can do it alone, and this is enforced three times:
 *   1. here, in confirmCompletion();
 *   2. by a database constraint (completed_needs_both_confirmations);
 *   3. by a database trigger that freezes confirmations once made.
 */
const { withTransaction } = require('../db/pool');
const { UserError } = require('../lib/errors');
const { todayIso, daysBetween } = require('../lib/dates');
const { isShortlisted } = require('../matching');

const SIDES = ['crew', 'production'];

async function lockEngagement(client, engagementId) {
  const { rows } = await client.query(
    `SELECT e.*, p.start_date, p.end_date, p.headcount, p.status AS position_status,
            pr.production_id, pr.id AS project_id
       FROM engagements e
       JOIN positions p ON p.id = e.position_id
       JOIN projects pr ON pr.id = p.project_id
      WHERE e.id = $1
      FOR UPDATE OF e`,
    [engagementId],
  );
  return rows[0] || null;
}

/** Throws unless the actor is the crew member (or the production) on this engagement. */
function assertOwner(engagement, side, actorId) {
  if (!SIDES.includes(side)) throw new Error(`Unknown side ${side}`);
  const owner = side === 'crew' ? engagement.crew_id : engagement.production_id;
  if (owner !== actorId) throw new UserError('Job not found.', 404);
}

async function sendOffer(db, { productionId, positionId, crewId, offeredRate = null, message = '', today = todayIso() }) {
  const { rows } = await db.query(
    `SELECT p.*, pr.production_id, pr.status AS project_status
       FROM positions p JOIN projects pr ON pr.id = p.project_id WHERE p.id = $1`,
    [positionId],
  );
  const position = rows[0];
  if (!position || position.production_id !== productionId) throw new UserError('Position not found.', 404);
  if (position.project_status !== 'open') throw new UserError('This project is not open. Pay for it first.');
  if (position.status !== 'open') throw new UserError('This position is already filled or closed.');
  // Productions can only make offers to crew the matching put in front of them.
  if (!(await isShortlisted(db, positionId, crewId, { today }))) {
    throw new UserError('This crew member is no longer on the list for this position.');
  }
  const result = await db.query(
    `INSERT INTO engagements (position_id, crew_id, offered_rate, message)
     VALUES ($1, $2, $3, $4) ON CONFLICT (position_id, crew_id) DO NOTHING RETURNING *`,
    [positionId, crewId, offeredRate, message],
  );
  if (!result.rows[0]) throw new UserError('An offer was already sent to this person.');
  return result.rows[0];
}

async function respondToOffer(db, { crewId, engagementId, accept }) {
  return withTransaction(db, async (client) => {
    const e = await lockEngagement(client, engagementId);
    if (!e) throw new UserError('Job not found.', 404);
    assertOwner(e, 'crew', crewId);
    if (e.status !== 'offered') throw new UserError('This offer has already been answered or withdrawn.');

    if (!accept) {
      const { rows } = await client.query(
        "UPDATE engagements SET status = 'declined', responded_at = now() WHERE id = $1 RETURNING *", [e.id]);
      return rows[0];
    }

    // Lock the position so two people cannot take the last spot at the same moment.
    const { rows: [position] } = await client.query('SELECT * FROM positions WHERE id = $1 FOR UPDATE', [e.position_id]);
    if (position.status !== 'open') throw new UserError('Sorry, this position has just been filled or closed.');
    const { rows: [{ count }] } = await client.query(
      "SELECT count(*)::int AS count FROM engagements WHERE position_id = $1 AND status = 'accepted'", [e.position_id]);
    if (count >= position.headcount) throw new UserError('Sorry, this position has just been filled.');

    const { rows: clashes } = await client.query(
      `SELECT 1 FROM engagements x JOIN positions p ON p.id = x.position_id
        WHERE x.crew_id = $1 AND x.status = 'accepted' AND x.id <> $2
          AND p.start_date <= $4 AND p.end_date >= $3`,
      [crewId, e.id, position.start_date, position.end_date],
    );
    if (clashes.length) throw new UserError('You already accepted another job on some of these dates.');

    const { rows } = await client.query(
      "UPDATE engagements SET status = 'accepted', responded_at = now() WHERE id = $1 RETURNING *", [e.id]);
    if (count + 1 >= position.headcount) {
      await client.query("UPDATE positions SET status = 'filled' WHERE id = $1", [position.id]);
    }
    return rows[0];
  });
}

async function withdrawOffer(db, { productionId, engagementId }) {
  return withTransaction(db, async (client) => {
    const e = await lockEngagement(client, engagementId);
    if (!e) throw new UserError('Job not found.', 404);
    assertOwner(e, 'production', productionId);
    if (e.status !== 'offered') throw new UserError('Only offers that have not been answered can be withdrawn.');
    const { rows } = await client.query(
      "UPDATE engagements SET status = 'withdrawn', responded_at = now() WHERE id = $1 RETURNING *", [e.id]);
    return rows[0];
  });
}

/** Either side can cancel an accepted job before anyone has confirmed it. Counts against the canceller. */
async function cancelEngagement(db, { side, actorId, engagementId }) {
  return withTransaction(db, async (client) => {
    const e = await lockEngagement(client, engagementId);
    if (!e) throw new UserError('Job not found.', 404);
    assertOwner(e, side, actorId);
    if (e.status !== 'accepted') throw new UserError('Only accepted jobs can be cancelled.');
    if (e.crew_confirmed_at || e.production_confirmed_at) {
      throw new UserError('This job has already been confirmed as worked by one side, so it can no longer be cancelled.');
    }
    const { rows } = await client.query(
      "UPDATE engagements SET status = 'cancelled', cancelled_by = $2, cancelled_at = now() WHERE id = $1 RETURNING *",
      [e.id, side],
    );
    await client.query("UPDATE positions SET status = 'open' WHERE id = $1 AND status = 'filled'", [e.position_id]);
    return rows[0];
  });
}

/**
 * One side confirms that a job really happened.
 * The job only counts (and the crew member's clock only resets) once BOTH sides have done this.
 * Confirming twice from the same side changes nothing.
 */
async function confirmCompletion(db, { side, actorId, engagementId, today = todayIso() }) {
  return withTransaction(db, async (client) => {
    const e = await lockEngagement(client, engagementId);
    if (!e) throw new UserError('Job not found.', 404);
    assertOwner(e, side, actorId);
    if (e.status === 'completed') return { engagement: e, completed: true, alreadyDone: true };
    if (e.status !== 'accepted') throw new UserError('Only accepted jobs can be confirmed as worked.');
    if (today < e.start_date) throw new UserError('You can confirm this job once it has started.');

    const column = side === 'crew' ? 'crew_confirmed_at' : 'production_confirmed_at';
    if (e[column]) return { engagement: e, completed: false, alreadyDone: true };

    const otherColumn = side === 'crew' ? 'production_confirmed_at' : 'crew_confirmed_at';
    const bothConfirmed = Boolean(e[otherColumn]);

    let rows;
    if (bothConfirmed) {
      // The last day worked is the job's end date, or today if the job ended early.
      const workedUntil = e.end_date < today ? e.end_date : today;
      ({ rows } = await client.query(
        `UPDATE engagements
            SET ${column} = now(), status = 'completed', completed_at = now(), worked_until = $2
          WHERE id = $1 RETURNING *`,
        [e.id, workedUntil],
      ));
    } else {
      ({ rows } = await client.query(`UPDATE engagements SET ${column} = now() WHERE id = $1 RETURNING *`, [e.id]));
    }
    return { engagement: rows[0], completed: bothConfirmed, alreadyDone: false };
  });
}

/** The crew member's clock: days since the last job that BOTH sides confirmed. */
async function getClock(db, crewId, today = todayIso()) {
  const { rows } = await db.query(
    'SELECT last_worked_on, confirmed_jobs, crew_cancellations FROM crew_work_stats WHERE crew_id = $1', [crewId]);
  const stats = rows[0] || { last_worked_on: null, confirmed_jobs: 0, crew_cancellations: 0 };
  return {
    lastWorkedOn: stats.last_worked_on,
    daysSinceLastWorked: stats.last_worked_on ? Math.max(0, daysBetween(stats.last_worked_on, today)) : null,
    confirmedJobs: stats.confirmed_jobs,
    cancellations: stats.crew_cancellations,
  };
}

module.exports = { sendOffer, respondToOffer, withdrawOffer, cancelEngagement, confirmCompletion, getClock };
