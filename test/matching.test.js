const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config/matching');
const { scoreCandidate, rankCandidates, _internal } = require('../src/matching/score');
const { toPublicCrew } = require('../src/matching');
const { findCity } = require('../src/config/cities');

const TODAY = '2026-06-01';
const LA = findCity('los_angeles');
const SD = findCity('san_diego'); // about 180 km from LA
const NY = findCity('new_york');

function position(overrides = {}) {
  return {
    id: 1, role_code: 'gaffer', lat: LA.lat, lng: LA.lng,
    start_date: '2026-06-10', end_date: '2026-06-19',
    rate_min: 400, rate_max: 600, required_skills: [], required_gear: [],
    ...overrides,
  };
}

let nextId = 1;
function crew(overrides = {}) {
  nextId += 1;
  return {
    id: nextId, lat: LA.lat, lng: LA.lng, travel_radius_km: 50,
    roles: [{ role_code: 'gaffer', is_primary: true }],
    skills: [], gear: [], rate_min: 400, rate_max: 550,
    availability: [{ start_date: '2026-06-01', end_date: '2026-06-30' }], booked: [],
    last_worked_on: '2026-05-01', confirmed_jobs: 3, crew_cancellations: 0,
    ...overrides,
  };
}

const score = (p, c, cfg = config) => scoreCandidate(p, c, { config: cfg, today: TODAY });

test('a perfect local, available gaffer is eligible with a high score', () => {
  const r = score(position(), crew());
  assert.equal(r.eligible, true);
  assert.ok(r.score > 0.8, `score was ${r.score}`);
});

test('role fit: primary role beats a secondary role, which beats same department', () => {
  const primary = score(position(), crew()).score;
  const secondary = score(position(), crew({ roles: [{ role_code: 'electrician', is_primary: true }, { role_code: 'gaffer', is_primary: false }] })).score;
  const sameDept = score(position(), crew({ roles: [{ role_code: 'electrician', is_primary: true }] })).score;
  assert.ok(primary > secondary && secondary > sameDept, `${primary} > ${secondary} > ${sameDept}`);
});

test('role fit: someone from another department is never shown', () => {
  const r = score(position(), crew({ roles: [{ role_code: 'sound_mixer', is_primary: true }] }));
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'role');
});

test('location: crew beyond their own travel radius are never shown', () => {
  const r = score(position(), crew({ lat: NY.lat, lng: NY.lng, travel_radius_km: 500 }));
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'distance');
});

test('location: inside the radius, closer ranks higher', () => {
  const near = score(position(), crew({ travel_radius_km: 300 })).factors.location;
  const far = score(position(), crew({ lat: SD.lat, lng: SD.lng, travel_radius_km: 300 })).factors.location;
  assert.ok(near > far);
  assert.equal(near, 1);
});

test('availability: no available days means not shown, partial availability scores lower', () => {
  const none = score(position(), crew({ availability: [] }));
  assert.equal(none.eligible, false);
  assert.equal(none.reason, 'availability');

  const full = score(position(), crew()).factors.availability;
  const part = score(position(), crew({ availability: [{ start_date: '2026-06-10', end_date: '2026-06-16' }] })).factors.availability;
  assert.equal(full, 1);
  assert.equal(part, 0.7);
});

test('availability: days already booked on another job do not count as free', () => {
  const booked = [{ position_id: 99, start_date: '2026-06-10', end_date: '2026-06-19' }];
  const r = score(position(), crew({ booked }));
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'availability');
});

test('skills and gear: share of requirements met', () => {
  const p = position({ required_skills: ['rigging', 'dmx'], required_gear: ['skypanel', 'generator'] });
  assert.equal(_internal.skillsGearFit(p, crew({ skills: ['rigging', 'dmx'], gear: ['skypanel', 'generator'] })), 1);
  assert.equal(_internal.skillsGearFit(p, crew({ skills: ['rigging'], gear: ['skypanel'] })), 0.5);
  assert.equal(_internal.skillsGearFit(p, crew()), 0);
  assert.equal(_internal.skillsGearFit(position(), crew()), 1, 'no requirements means full marks');
});

test('rate: overlapping ranges score fully, asking well over budget scores low', () => {
  assert.equal(_internal.rateFit(position(), crew(), config), 1);
  assert.equal(_internal.rateFit(position(), crew({ rate_min: 200, rate_max: 300 }), config), 1, 'cheaper than budget is fine');
  const slightlyOver = _internal.rateFit(position(), crew({ rate_min: 630, rate_max: 700 }), config);
  const wayOver = _internal.rateFit(position(), crew({ rate_min: 1200, rate_max: 1500 }), config);
  assert.ok(slightlyOver < 1 && slightlyOver > wayOver);
  assert.equal(wayOver, 0);
  assert.equal(_internal.rateFit(position({ rate_min: null, rate_max: null }), crew(), config), 0.75, 'unknown rate is neutral');
});

test('days since last worked: someone who has waited longer ranks higher, all else equal', () => {
  const waitedLong = crew({ last_worked_on: '2026-02-01' });
  const workedRecently = crew({ last_worked_on: '2026-05-28' });
  const ranked = rankCandidates(position(), [workedRecently, waitedLong], { config, today: TODAY });
  assert.deepEqual(ranked.map((r) => r.crew.id), [waitedLong.id, workedRecently.id]);
});

test('days since last worked: capped, and new members get a neutral value', () => {
  const cfg = config.daysSinceWorked;
  assert.equal(_internal.daysSinceWorkedFit(crew({ last_worked_on: '2020-01-01' }), TODAY, config), 1);
  assert.equal(_internal.daysSinceWorkedFit(crew({ last_worked_on: null }), TODAY, config), cfg.noHistoryDays / cfg.capDays);
});

test('reliability: cancellations lower the score, confirmed jobs raise it', () => {
  const reliable = _internal.reliabilityFit(crew({ confirmed_jobs: 10, crew_cancellations: 0 }), config);
  const fresh = _internal.reliabilityFit(crew({ confirmed_jobs: 0, crew_cancellations: 0 }), config);
  const flaky = _internal.reliabilityFit(crew({ confirmed_jobs: 2, crew_cancellations: 4 }), config);
  assert.ok(reliable > fresh && fresh > flaky);
});

test('weights come from config: changing them changes the order', () => {
  // A is closer to budget; B has waited much longer for work.
  const a = crew({ rate_min: 600, rate_max: 650, last_worked_on: '2026-05-30' });
  const b = crew({ rate_min: 700, rate_max: 750, last_worked_on: '2026-01-01' });
  const rateHeavy = { ...config, weights: { ...config.weights, rate: 100, daysSinceWorked: 0 }, minimumScore: 0 };
  const clockHeavy = { ...config, weights: { ...config.weights, rate: 0, daysSinceWorked: 100 }, minimumScore: 0 };
  const order = (cfg) => rankCandidates(position(), [a, b], { config: cfg, today: TODAY }).map((r) => r.crew.id);
  assert.deepEqual(order(rateHeavy), [a.id, b.id]);
  assert.deepEqual(order(clockHeavy), [b.id, a.id]);
});

test('a weight of zero switches a factor off', () => {
  const cfg = { ...config, weights: { roleFit: 1, skillsGear: 0, location: 0, availability: 0, rate: 0, daysSinceWorked: 0, reliability: 0 } };
  const r = score(position({ required_skills: ['nothing-matches'] }), crew(), cfg);
  assert.equal(r.score, 1);
});

test('crew below the minimum score are left out', () => {
  const cfg = { ...config, minimumScore: 0.99 };
  const r = score(position({ required_skills: ['a', 'b'] }), crew(), cfg);
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'score');
});

test('ranking is deterministic and best first', () => {
  const list = [crew({ roles: [{ role_code: 'electrician', is_primary: true }] }), crew(), crew({ travel_radius_km: 300, lat: SD.lat, lng: SD.lng })];
  const one = rankCandidates(position(), list, { config, today: TODAY }).map((r) => r.crew.id);
  const two = rankCandidates(position(), [...list].reverse(), { config, today: TODAY }).map((r) => r.crew.id);
  assert.deepEqual(one, two);
  assert.equal(one[0], list[1].id);
});

test('what productions see never includes scores or factor values', () => {
  const [ranked] = rankCandidates(position(), [crew({ full_name: 'Jo', city_name: 'Los Angeles', bio: '' })], { config, today: TODAY });
  const visible = toPublicCrew(ranked.crew);
  const text = JSON.stringify(visible).toLowerCase();
  for (const word of ['score', 'factor', 'weight', 'last_worked', 'cancell', 'availability', 'lat', 'lng']) {
    assert.ok(!text.includes(word), `public crew data must not include "${word}"`);
  }
});
