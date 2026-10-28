-- CrewMatch initial schema.
-- Crew and productions are separate tables with separate logins. No shared "users" table.

CREATE TABLE crew (
  id               SERIAL PRIMARY KEY,
  email            TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  full_name        TEXT NOT NULL,
  phone            TEXT,
  city_code        TEXT NOT NULL,
  city_name        TEXT NOT NULL,
  lat              DOUBLE PRECISION NOT NULL,
  lng              DOUBLE PRECISION NOT NULL,
  travel_radius_km INTEGER NOT NULL DEFAULT 50 CHECK (travel_radius_km BETWEEN 0 AND 20000),
  rate_min         INTEGER CHECK (rate_min >= 0),
  rate_max         INTEGER CHECK (rate_max >= 0),
  bio              TEXT NOT NULL DEFAULT '',
  skills           TEXT[] NOT NULL DEFAULT '{}',
  gear             TEXT[] NOT NULL DEFAULT '{}',
  is_sample        BOOLEAN NOT NULL DEFAULT FALSE,
  is_suspended     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (rate_min IS NULL OR rate_max IS NULL OR rate_min <= rate_max)
);
CREATE UNIQUE INDEX crew_email_unique ON crew (lower(email));

CREATE TABLE crew_roles (
  crew_id    INTEGER NOT NULL REFERENCES crew(id) ON DELETE CASCADE,
  role_code  TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (crew_id, role_code)
);
CREATE UNIQUE INDEX crew_one_primary_role ON crew_roles (crew_id) WHERE is_primary;
CREATE INDEX crew_roles_role ON crew_roles (role_code);

CREATE TABLE crew_availability (
  id         SERIAL PRIMARY KEY,
  crew_id    INTEGER NOT NULL REFERENCES crew(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  CHECK (end_date >= start_date)
);
CREATE INDEX crew_availability_crew ON crew_availability (crew_id);

CREATE TABLE crew_credits (
  id            SERIAL PRIMARY KEY,
  crew_id       INTEGER NOT NULL REFERENCES crew(id) ON DELETE CASCADE,
  project_title TEXT NOT NULL,
  role_title    TEXT NOT NULL,
  year          INTEGER CHECK (year BETWEEN 1900 AND 2100),
  company       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX crew_credits_crew ON crew_credits (crew_id);

CREATE TABLE productions (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  company_name  TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  phone         TEXT,
  website       TEXT,
  is_sample     BOOLEAN NOT NULL DEFAULT FALSE,
  is_suspended  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX productions_email_unique ON productions (lower(email));

-- Subscriptions (one row per paid period chain). Payment provider details are stubbed.
CREATE TABLE subscriptions (
  id                   SERIAL PRIMARY KEY,
  production_id        INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  plan_code            TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'past_due')),
  current_period_start DATE NOT NULL,
  current_period_end   DATE NOT NULL,
  provider             TEXT NOT NULL,
  provider_ref         TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (current_period_end >= current_period_start)
);
CREATE INDEX subscriptions_production ON subscriptions (production_id);

CREATE TABLE projects (
  id            SERIAL PRIMARY KEY,
  production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  city_code     TEXT NOT NULL,
  city_name     TEXT NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  budget_min    INTEGER CHECK (budget_min >= 0),
  budget_max    INTEGER CHECK (budget_max >= 0),
  -- draft: not paid yet, invisible to crew. open: visible and matching. closed: finished/archived.
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  -- How this project is paid for: unpaid, paid (per-project fee) or subscription.
  billing       TEXT NOT NULL DEFAULT 'unpaid' CHECK (billing IN ('unpaid', 'paid', 'subscription')),
  fee_cents     INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max),
  CHECK (status = 'draft' OR billing <> 'unpaid')
);
CREATE INDEX projects_production ON projects (production_id);

CREATE TABLE positions (
  id              SERIAL PRIMARY KEY,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role_code       TEXT NOT NULL,
  headcount       INTEGER NOT NULL DEFAULT 1 CHECK (headcount BETWEEN 1 AND 50),
  rate_min        INTEGER CHECK (rate_min >= 0),
  rate_max        INTEGER CHECK (rate_max >= 0),
  required_skills TEXT[] NOT NULL DEFAULT '{}',
  required_gear   TEXT[] NOT NULL DEFAULT '{}',
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  notes           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (rate_min IS NULL OR rate_max IS NULL OR rate_min <= rate_max)
);
CREATE INDEX positions_project ON positions (project_id);

-- Crew can flag interest in a matched job. Productions see a label, it does not change ranking.
CREATE TABLE interests (
  position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  crew_id     INTEGER NOT NULL REFERENCES crew(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (position_id, crew_id)
);

-- An engagement is an offer from a production to a crew member for one position,
-- and everything that happens to it afterwards.
CREATE TABLE engagements (
  id                      SERIAL PRIMARY KEY,
  position_id             INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  crew_id                 INTEGER NOT NULL REFERENCES crew(id) ON DELETE CASCADE,
  status                  TEXT NOT NULL DEFAULT 'offered'
                          CHECK (status IN ('offered', 'accepted', 'declined', 'withdrawn', 'cancelled', 'completed')),
  offered_rate            INTEGER CHECK (offered_rate >= 0),
  message                 TEXT NOT NULL DEFAULT '',
  offered_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at            TIMESTAMPTZ,
  crew_confirmed_at       TIMESTAMPTZ,
  production_confirmed_at TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  worked_until            DATE,
  cancelled_by            TEXT CHECK (cancelled_by IN ('crew', 'production')),
  cancelled_at            TIMESTAMPTZ,
  UNIQUE (position_id, crew_id),

  -- THE CLOCK RULE, enforced by the database itself:
  -- an engagement is "completed" if and only if BOTH sides confirmed it.
  CONSTRAINT completed_needs_both_confirmations CHECK (
    (status = 'completed') = (crew_confirmed_at IS NOT NULL AND production_confirmed_at IS NOT NULL)
  ),
  CONSTRAINT completed_has_dates CHECK (
    (status = 'completed') = (completed_at IS NOT NULL AND worked_until IS NOT NULL)
  ),
  CONSTRAINT confirmations_only_on_accepted_jobs CHECK (
    status IN ('accepted', 'completed') OR (crew_confirmed_at IS NULL AND production_confirmed_at IS NULL)
  ),
  CONSTRAINT cancellation_consistent CHECK (
    (status = 'cancelled') = (cancelled_by IS NOT NULL)
  )
);
CREATE INDEX engagements_crew ON engagements (crew_id);
CREATE INDEX engagements_position ON engagements (position_id);

-- Once an engagement is completed it is frozen, and a confirmation can never be taken back.
-- This stops anyone (including a bug in the app) from moving the clock after the fact.
CREATE FUNCTION protect_engagement_history() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'completed engagements cannot be changed';
  END IF;
  IF OLD.crew_confirmed_at IS NOT NULL AND NEW.crew_confirmed_at IS DISTINCT FROM OLD.crew_confirmed_at THEN
    RAISE EXCEPTION 'a crew confirmation cannot be changed or removed';
  END IF;
  IF OLD.production_confirmed_at IS NOT NULL
     AND NEW.production_confirmed_at IS DISTINCT FROM OLD.production_confirmed_at THEN
    RAISE EXCEPTION 'a production confirmation cannot be changed or removed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER engagements_protect_history
  BEFORE UPDATE ON engagements
  FOR EACH ROW EXECUTE FUNCTION protect_engagement_history();

-- "Days since last worked" is never stored on the crew record, so nobody can edit it.
-- It is always calculated from engagements that BOTH sides confirmed.
CREATE VIEW crew_work_stats AS
SELECT
  c.id AS crew_id,
  MAX(e.worked_until) FILTER (WHERE e.status = 'completed') AS last_worked_on,
  COUNT(e.id) FILTER (WHERE e.status = 'completed')::int AS confirmed_jobs,
  COUNT(e.id) FILTER (WHERE e.status = 'cancelled' AND e.cancelled_by = 'crew')::int AS crew_cancellations
FROM crew c
LEFT JOIN engagements e ON e.crew_id = c.id
GROUP BY c.id;

CREATE TABLE payments (
  id            SERIAL PRIMARY KEY,
  production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('subscription', 'project_fee')),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  provider      TEXT NOT NULL,
  provider_ref  TEXT,
  description   TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);
CREATE INDEX payments_production ON payments (production_id);
