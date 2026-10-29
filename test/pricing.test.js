const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../src/config/pricing');
const { quoteProjectFee, nextSubscriptionPeriod, subscriptionQuote } = require('../src/services/pricing');

test('project fee scales with project length (both days included)', () => {
  assert.equal(quoteProjectFee('2026-01-01', '2026-01-01').days, 1);
  assert.equal(quoteProjectFee('2026-01-01', '2026-01-01').amountCents, pricing.projectFeeTiers[0].priceCents);
  assert.equal(quoteProjectFee('2026-01-01', '2026-01-03').amountCents, pricing.projectFeeTiers[0].priceCents);
  assert.equal(quoteProjectFee('2026-01-01', '2026-01-04').amountCents, pricing.projectFeeTiers[1].priceCents);
  assert.equal(quoteProjectFee('2026-01-01', '2026-01-30').amountCents, pricing.projectFeeTiers[2].priceCents);
  assert.equal(quoteProjectFee('2026-01-01', '2026-03-31').amountCents, pricing.projectFeeTiers[3].priceCents);
  assert.equal(quoteProjectFee('2026-01-01', '2027-01-01').amountCents, pricing.projectFeeTiers[4].priceCents);
});

test('longer projects never cost less than shorter ones', () => {
  let previous = 0;
  for (let days = 1; days <= 400; days += 1) {
    const end = new Date(Date.UTC(2026, 0, days)).toISOString().slice(0, 10);
    const { amountCents } = quoteProjectFee('2026-01-01', end);
    assert.ok(amountCents >= previous, `day ${days}`);
    previous = amountCents;
  }
});

test('month boundaries and leap years are counted correctly', () => {
  assert.equal(quoteProjectFee('2028-02-28', '2028-03-01').days, 3);
  assert.equal(quoteProjectFee('2026-02-28', '2026-03-01').days, 2);
});

test('subscription periods chain without gaps or overlaps', () => {
  const first = nextSubscriptionPeriod('2026-01-10', null);
  assert.deepEqual(first, { start: '2026-01-10', end: '2026-02-08' });
  const renewal = nextSubscriptionPeriod('2026-02-01', first.end);
  assert.deepEqual(renewal, { start: '2026-02-09', end: '2026-03-10' });
  const lapsed = nextSubscriptionPeriod('2026-05-01', first.end);
  assert.equal(lapsed.start, '2026-05-01');
  assert.equal(subscriptionQuote().amountCents, pricing.subscription.priceCents);
});
