/** Turns prices into payment records, paid projects and subscription periods. */
const { withTransaction } = require('../db/pool');
const provider = require('../payments/provider');
const { quoteProjectFee, subscriptionQuote, nextSubscriptionPeriod } = require('./pricing');
const { UserError } = require('../lib/errors');
const { todayIso } = require('../lib/dates');

async function activeSubscription(db, productionId, today = todayIso()) {
  const { rows } = await db.query(
    `SELECT * FROM subscriptions
      WHERE production_id = $1 AND status = 'active' AND current_period_start <= $2 AND current_period_end >= $2
      ORDER BY current_period_end DESC LIMIT 1`,
    [productionId, today],
  );
  return rows[0] || null;
}

async function latestSubscriptionEnd(db, productionId) {
  const { rows } = await db.query(
    "SELECT max(current_period_end) AS end FROM subscriptions WHERE production_id = $1 AND status = 'active'", [productionId]);
  return rows[0].end;
}

async function recordPayment(client, { productionId, projectId = null, kind, amountCents, currency, description, result }) {
  const { rows } = await client.query(
    `INSERT INTO payments (production_id, project_id, kind, amount_cents, currency, status, provider, provider_ref, description, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $6 = 'succeeded' THEN now() END) RETURNING *`,
    [productionId, projectId, kind, amountCents, currency, result.status, result.provider, result.providerRef, description],
  );
  return rows[0];
}

/** Pays the per-project fee and opens the project. */
async function payForProject(db, { productionId, projectId }) {
  const { rows } = await db.query('SELECT * FROM projects WHERE id = $1 AND production_id = $2', [projectId, productionId]);
  const project = rows[0];
  if (!project) throw new UserError('Project not found.', 404);
  if (project.billing !== 'unpaid') throw new UserError('This project is already paid for.');
  const quote = quoteProjectFee(project.start_date, project.end_date);
  const description = `Project fee: ${project.title} (${quote.days} days, ${quote.tierLabel})`;
  const result = await provider.charge({
    kind: 'project_fee', amountCents: quote.amountCents, currency: quote.currency, description, productionId,
  });
  return withTransaction(db, async (client) => {
    const payment = await recordPayment(client, {
      productionId, projectId, kind: 'project_fee', amountCents: quote.amountCents, currency: quote.currency, description, result,
    });
    if (result.status === 'succeeded') {
      await client.query(
        "UPDATE projects SET billing = 'paid', fee_cents = $2, status = 'open' WHERE id = $1 AND billing = 'unpaid'",
        [projectId, quote.amountCents]);
    }
    return payment;
  });
}

/** Opens a project for free because the production has an active subscription. */
async function openWithSubscription(db, { productionId, projectId, today = todayIso() }) {
  if (!(await activeSubscription(db, productionId, today))) throw new UserError('You do not have an active subscription.');
  const { rowCount } = await db.query(
    "UPDATE projects SET billing = 'subscription', fee_cents = 0, status = 'open' WHERE id = $1 AND production_id = $2 AND billing = 'unpaid'",
    [projectId, productionId]);
  if (!rowCount) throw new UserError('Project not found or already paid for.');
}

/** Buys (or extends) the subscription by one period. */
async function buySubscription(db, { productionId, today = todayIso() }) {
  const quote = subscriptionQuote();
  const period = nextSubscriptionPeriod(today, await latestSubscriptionEnd(db, productionId));
  const description = `${quote.name}: ${period.start} to ${period.end}`;
  const result = await provider.charge({
    kind: 'subscription', amountCents: quote.amountCents, currency: quote.currency, description, productionId,
  });
  return withTransaction(db, async (client) => {
    const payment = await recordPayment(client, {
      productionId, kind: 'subscription', amountCents: quote.amountCents, currency: quote.currency, description, result,
    });
    if (result.status === 'succeeded') {
      await client.query(
        `INSERT INTO subscriptions (production_id, plan_code, status, current_period_start, current_period_end, provider, provider_ref)
         VALUES ($1, $2, 'active', $3, $4, $5, $6)`,
        [productionId, quote.planCode, period.start, period.end, result.provider, result.providerRef]);
    }
    return payment;
  });
}

module.exports = { activeSubscription, payForProject, openWithSubscription, buySubscription };
