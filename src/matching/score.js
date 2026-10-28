/**
 * The matching algorithm. Pure functions only: no database, no web requests.
 * This runs on the server and its numbers are never sent to any browser.
 *
 * Each factor produces a value between 0 and 1. The final score is the
 * weighted average of the factors, using the weights in src/config/matching.js.
 * Some factors are also hard filters (wrong department, too far away, not free).
 */
const defaultConfig = require('../config/matching');
const { departmentOf } = require('../config/roles');
const { distanceKm } = require('../lib/geo');
const { toDayNumber, daysBetween } = require('../lib/dates');

const clamp01 = (x) => Math.max(0, Math.min(1, x));

function roleFit(position, crew, cfg) {
  const role = (crew.roles || []).find((r) => r.role_code === position.role_code);
  if (role) return role.is_primary ? cfg.roleFit.primaryRole : cfg.roleFit.secondaryRole;
  const dept = departmentOf(position.role_code);
  if (dept && (crew.roles || []).some((r) => departmentOf(r.role_code) === dept)) return cfg.roleFit.sameDepartment;
  return 0;
}

function skillsGearFit(position, crew) {
  const required = [
    ...(position.required_skills || []).map((s) => ['skill', s]),
    ...(position.required_gear || []).map((g) => ['gear', g]),
  ];
  if (required.length === 0) return 1;
  const skills = new Set(crew.skills || []);
  const gear = new Set(crew.gear || []);
  // A gear item listed as a skill (or the reverse) still counts.
  const has = (tag) => skills.has(tag) || gear.has(tag);
  const matched = required.filter(([, tag]) => has(tag)).length;
  return matched / required.length;
}

/** Returns null when the crew member is outside their own travel radius. */
function locationFit(position, crew, cfg) {
  const km = distanceKm(position.lat, position.lng, crew.lat, crew.lng);
  const radius = Math.max(crew.travel_radius_km || 0, cfg.location.alwaysLocalKm);
  if (km > radius) return null;
  return 1 - (1 - cfg.location.scoreAtEdgeOfRadius) * (km / radius);
}

function toRanges(list) {
  return (list || []).map((r) => [toDayNumber(r.start_date), toDayNumber(r.end_date)]);
}

/** Share of the shoot days the crew member marked as available and is not already booked. */
function availabilityShare(position, crew) {
  const start = toDayNumber(position.start_date);
  const end = toDayNumber(position.end_date);
  const available = toRanges(crew.availability);
  const booked = toRanges(crew.booked);
  const inAny = (day, ranges) => ranges.some(([a, b]) => day >= a && day <= b);
  let free = 0;
  for (let day = start; day <= end; day += 1) {
    if (inAny(day, available) && !inAny(day, booked)) free += 1;
  }
  return free / (end - start + 1);
}

function rateFit(position, crew, cfg) {
  const hasPos = position.rate_min != null || position.rate_max != null;
  const hasCrew = crew.rate_min != null || crew.rate_max != null;
  if (!hasPos || !hasCrew) return 0.75; // Unknown: neither rewarded nor punished much.
  const posMax = position.rate_max ?? position.rate_min;
  const crewMin = crew.rate_min ?? crew.rate_max;
  if (crewMin <= posMax) return 1;
  if (posMax <= 0) return 0;
  const over = (crewMin - posMax) / posMax;
  return clamp01(1 - cfg.rate.penaltyPer10PercentOver * (over / 0.1));
}

function daysSinceLastWorked(crew, today) {
  if (!crew.last_worked_on) return null;
  return Math.max(0, daysBetween(crew.last_worked_on, today));
}

function daysSinceWorkedFit(crew, today, cfg) {
  const days = daysSinceLastWorked(crew, today);
  const value = days == null ? cfg.daysSinceWorked.noHistoryDays : days;
  return clamp01(value / cfg.daysSinceWorked.capDays);
}

function reliabilityFit(crew, cfg) {
  const confirmed = crew.confirmed_jobs || 0;
  const cancelled = crew.crew_cancellations || 0;
  const { priorConfirmed, priorCancelled } = cfg.reliability;
  return (confirmed + priorConfirmed) / (confirmed + cancelled + priorConfirmed + priorCancelled);
}

/**
 * Scores one crew member for one position.
 * Returns { eligible: false, reason } or { eligible: true, score, factors }.
 */
function scoreCandidate(position, crew, { config = defaultConfig, today }) {
  if (!today) throw new Error('scoreCandidate needs today');
  const factors = {};

  factors.roleFit = roleFit(position, crew, config);
  if (factors.roleFit <= 0) return { eligible: false, reason: 'role' };

  const location = locationFit(position, crew, config);
  if (location === null) return { eligible: false, reason: 'distance' };
  factors.location = location;

  factors.availability = availabilityShare(position, crew);
  if (factors.availability < config.availability.minimumShare) return { eligible: false, reason: 'availability' };

  factors.skillsGear = skillsGearFit(position, crew);
  factors.rate = rateFit(position, crew, config);
  factors.daysSinceWorked = daysSinceWorkedFit(crew, today, config);
  factors.reliability = reliabilityFit(crew, config);

  let total = 0;
  let weightSum = 0;
  for (const [name, weight] of Object.entries(config.weights)) {
    if (!weight) continue;
    total += weight * factors[name];
    weightSum += weight;
  }
  const score = weightSum > 0 ? total / weightSum : 0;
  if (score < config.minimumScore) return { eligible: false, reason: 'score', score, factors };
  return { eligible: true, score, factors };
}

/** Ranks crew for a position, best first. Ties go to whoever has waited longer for work. */
function rankCandidates(position, crewList, { config = defaultConfig, today }) {
  const waited = (crew) => {
    const d = daysSinceLastWorked(crew, today);
    return d == null ? config.daysSinceWorked.noHistoryDays : d;
  };
  return crewList
    .map((crew) => ({ crew, result: scoreCandidate(position, crew, { config, today }) }))
    .filter((c) => c.result.eligible)
    .sort((a, b) => (b.result.score - a.result.score) || (waited(b.crew) - waited(a.crew)) || (a.crew.id - b.crew.id))
    .map((c) => ({ crew: c.crew, score: c.result.score, factors: c.result.factors }));
}

module.exports = {
  scoreCandidate, rankCandidates, daysSinceLastWorked,
  // Exported for tests.
  _internal: { roleFit, skillsGearFit, locationFit, availabilityShare, rateFit, daysSinceWorkedFit, reliabilityFit },
};
