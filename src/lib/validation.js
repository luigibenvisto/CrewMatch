/** Input validation for every form. Anything that fails is rejected with a readable message. */
const { z } = require('zod');
const { isIsoDate } = require('./dates');
const { roles } = require('../config/roles');
const { findCity } = require('../config/cities');

const trimmed = (max) => z.preprocess((v) => (v == null ? '' : v), z.string().trim().max(max, `Text must be at most ${max} characters`));
const requiredText = (label, max) => z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254));
const password = z.string().min(10, 'Password must be at least 10 characters').max(200, 'Password is too long');

// Form fields arrive as strings; empty means "not given".
const optionalInt = (label, min, max) => z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : Number(v)),
  z.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`).nullable(),
);
const requiredInt = (label, min, max) => z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : Number(v)),
  z.number({ error: `${label} is required` }).int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`),
);

const isoDate = (label) => z.string({ error: `${label} is required` }).refine(isIsoDate, `${label} must be a valid date`);
const cityCode = z.string({ error: 'Pick a city' }).refine((c) => !!findCity(c), 'Pick a city from the list');
const roleCode = z.string({ error: 'Pick a role' }).refine((c) => !!roles[c], 'Pick a role from the list');

/** "Steadicam, ARRI Alexa , steadicam" -> ['steadicam', 'arri alexa'] */
function parseTags(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  const seen = new Set();
  for (const part of raw.split(',')) {
    const tag = part.trim().toLowerCase().replace(/\s+/g, ' ');
    if (tag && tag.length <= 40) seen.add(tag);
  }
  return [...seen].slice(0, 30);
}
const tags = z.preprocess(parseTags, z.array(z.string()));

function toArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

const rangeCheck = (minKey, maxKey, message) => (data, ctx) => {
  if (data[minKey] != null && data[maxKey] != null && data[minKey] > data[maxKey]) {
    ctx.addIssue({ code: 'custom', message, path: [maxKey] });
  }
};
const dateOrder = (data, ctx) => {
  if (data.start_date && data.end_date && data.end_date < data.start_date) {
    ctx.addIssue({ code: 'custom', message: 'End date must be on or after the start date', path: ['end_date'] });
  }
};

const login = z.object({ email, password: z.string().min(1, 'Enter your password').max(200) });

const crewSignup = z.object({
  full_name: requiredText('Name', 120),
  email,
  password,
  city_code: cityCode,
  primary_role: roleCode,
});

const productionSignup = z.object({
  company_name: requiredText('Company name', 160),
  contact_name: requiredText('Contact name', 120),
  email,
  password,
});

const crewProfile = z.object({
  full_name: requiredText('Name', 120),
  phone: trimmed(40),
  city_code: cityCode,
  travel_radius_km: requiredInt('Travel radius', 0, 20000),
  rate_min: optionalInt('Minimum day rate', 0, 100000),
  rate_max: optionalInt('Maximum day rate', 0, 100000),
  bio: trimmed(2000),
  skills: tags,
  gear: tags,
  primary_role: roleCode,
  other_roles: z.preprocess(toArray, z.array(roleCode).max(10, 'Pick at most 10 other roles')),
}).superRefine(rangeCheck('rate_min', 'rate_max', 'Maximum day rate must be at least the minimum'));

const availability = z.object({
  start_date: isoDate('Start date'),
  end_date: isoDate('End date'),
}).superRefine(dateOrder);

const credit = z.object({
  project_title: requiredText('Project title', 160),
  role_title: requiredText('Role', 120),
  year: optionalInt('Year', 1900, 2100),
  company: trimmed(160),
});

const project = z.object({
  title: requiredText('Project title', 160),
  description: trimmed(4000),
  city_code: cityCode,
  start_date: isoDate('Start date'),
  end_date: isoDate('End date'),
  budget_min: optionalInt('Minimum budget', 0, 1000000000),
  budget_max: optionalInt('Maximum budget', 0, 1000000000),
}).superRefine(dateOrder)
  .superRefine(rangeCheck('budget_min', 'budget_max', 'Maximum budget must be at least the minimum'));

const position = z.object({
  role_code: roleCode,
  headcount: requiredInt('Number of people', 1, 50),
  rate_min: optionalInt('Minimum day rate', 0, 100000),
  rate_max: optionalInt('Maximum day rate', 0, 100000),
  required_skills: tags,
  required_gear: tags,
  start_date: isoDate('Start date'),
  end_date: isoDate('End date'),
  notes: trimmed(1000),
}).superRefine(dateOrder)
  .superRefine(rangeCheck('rate_min', 'rate_max', 'Maximum day rate must be at least the minimum'));

const offer = z.object({
  crew_id: requiredInt('Crew member', 1, 2147483647),
  offered_rate: optionalInt('Day rate', 0, 100000),
  message: trimmed(1000),
});

const id = requiredInt('id', 1, 2147483647);

/** Returns { data } or { errors: [messages] }. */
function validate(schema, input) {
  const result = schema.safeParse(input || {});
  if (result.success) return { data: result.data };
  return { errors: [...new Set(result.error.issues.map((i) => i.message))] };
}

module.exports = {
  validate, parseTags, schemas: { login, crewSignup, productionSignup, crewProfile, availability, credit, project, position, offer, id },
};
