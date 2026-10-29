/** Pricing logic. Pure functions; the prices themselves live in src/config/pricing.js. */
const defaultPricing = require('../config/pricing');
const { lengthInDays, addDays } = require('../lib/dates');

function quoteProjectFee(startDate, endDate, pricing = defaultPricing) {
  const days = lengthInDays(startDate, endDate);
  if (days < 1) throw new Error('Project must be at least one day long');
  const tier = pricing.projectFeeTiers.find((t) => days <= t.maxDays);
  return { days, tierLabel: tier.label, amountCents: tier.priceCents, currency: pricing.currency };
}

function subscriptionQuote(pricing = defaultPricing) {
  const { code, name, priceCents, periodDays } = pricing.subscription;
  return { planCode: code, name, amountCents: priceCents, periodDays, currency: pricing.currency };
}

/** Period covered by a new subscription payment, starting today (or when the current one ends). */
function nextSubscriptionPeriod(today, currentPeriodEnd, pricing = defaultPricing) {
  const start = currentPeriodEnd && currentPeriodEnd >= today ? addDays(currentPeriodEnd, 1) : today;
  return { start, end: addDays(start, pricing.subscription.periodDays - 1) };
}

function formatMoney(cents, currency = defaultPricing.currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

module.exports = { quoteProjectFee, subscriptionQuote, nextSubscriptionPeriod, formatMoney };
