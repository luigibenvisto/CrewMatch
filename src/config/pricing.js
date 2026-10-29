/**
 * CrewMatch pricing. Crew never pay. Productions choose one of:
 *   1. A subscription that covers every project while it is active, or
 *   2. A one-off fee per project, scaled to the project's length in days.
 *
 * All amounts are in cents (2900 = 29.00).
 */
module.exports = {
  currency: 'USD',

  subscription: {
    code: 'production_pass_monthly',
    name: 'Production Pass (monthly)',
    priceCents: 7900,
    periodDays: 30,
  },

  // Project length = calendar days from start date to end date, both included.
  // The first tier whose maxDays is >= the project length applies.
  projectFeeTiers: [
    { maxDays: 3, priceCents: 1900, label: 'Short (1 to 3 days)' },
    { maxDays: 10, priceCents: 3900, label: 'Standard (4 to 10 days)' },
    { maxDays: 30, priceCents: 6900, label: 'Long (11 to 30 days)' },
    { maxDays: 90, priceCents: 12900, label: 'Extended (31 to 90 days)' },
    { maxDays: Infinity, priceCents: 19900, label: 'Series (over 90 days)' },
  ],
};
