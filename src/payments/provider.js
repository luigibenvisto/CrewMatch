/**
 * ============================================================================
 *  PAYMENT PROVIDER: STUB.  NO REAL MONEY MOVES.
 * ============================================================================
 *  Every "payment" made through this file succeeds immediately and is free.
 *  It exists so the rest of the app (prices, payment records, which projects
 *  are paid, subscription periods) works end to end today.
 *
 *  To take real payments, replace charge() with a real provider (Stripe is
 *  the usual choice) and set PAYMENTS_MODE=stripe. The README section
 *  "Turning on real payments" lists the steps. Nothing else in the app should
 *  need to change: it only ever calls charge() and reads the result.
 * ============================================================================
 */
const crypto = require('crypto');
const env = require('../config/env');

/**
 * @param {object} p
 * @param {'subscription'|'project_fee'} p.kind
 * @param {number} p.amountCents
 * @param {string} p.currency
 * @param {string} p.description
 * @param {number} p.productionId
 * @returns {Promise<{status: 'succeeded'|'pending'|'failed', provider: string, providerRef: string}>}
 */
async function charge({ kind, amountCents, currency, description, productionId }) {
  if (env.paymentsMode !== 'stub') {
    // TODO(payments): call the real provider here, e.g. create a Stripe Checkout Session
    // and return status 'pending' plus its id, then mark the payment succeeded from a webhook.
    throw new Error(`PAYMENTS_MODE "${env.paymentsMode}" is not implemented yet. Use PAYMENTS_MODE=stub.`);
  }
  void kind; void amountCents; void currency; void description; void productionId;
  return { status: 'succeeded', provider: 'stub', providerRef: `stub_${crypto.randomUUID()}` };
}

module.exports = { charge, isStub: () => env.paymentsMode === 'stub' };
