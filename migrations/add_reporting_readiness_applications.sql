CREATE TABLE IF NOT EXISTS public.reporting_readiness_applications (
  id                        SERIAL PRIMARY KEY,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Step 1: Organization fit
  org_name                  TEXT NOT NULL,
  website                   TEXT NOT NULL,
  contact_name              TEXT NOT NULL,
  role                      TEXT NOT NULL,
  role_other                TEXT,
  email                     TEXT NOT NULL,
  phone                     TEXT,
  budget_range              TEXT NOT NULL,
  program_area              TEXT NOT NULL,
  program_area_other        TEXT,

  -- Step 2: Reporting pressure
  funding_status            TEXT NOT NULL,
  funders_list              TEXT,
  reporting_challenges      TEXT[] NOT NULL DEFAULT '{}',
  reporting_challenge_other TEXT,
  upcoming_deadline         TEXT NOT NULL,
  confidence_rating         INTEGER CHECK (confidence_rating BETWEEN 1 AND 5),
  funder_understanding      TEXT NOT NULL,

  -- Step 3: Data readiness
  data_locations            TEXT[] NOT NULL DEFAULT '{}',
  data_locations_other      TEXT,
  shareable_materials       TEXT[] NOT NULL DEFAULT '{}',
  sensitive_data            TEXT NOT NULL,
  anonymized_learnings      TEXT NOT NULL,
  assessment_value          TEXT NOT NULL,
  additional_notes          TEXT,
  consent                   BOOLEAN NOT NULL DEFAULT FALSE,

  -- Internal review fields
  status                    TEXT NOT NULL DEFAULT 'pending',
  fit_score                 INTEGER,
  reviewer_notes            TEXT,
  reviewed_by               TEXT,
  reviewed_at               TIMESTAMPTZ,
  calendar_link_sent_at     TIMESTAMPTZ
);

COMMENT ON TABLE public.reporting_readiness_applications IS
  'Applications for the Impact Reporting & Data Readiness Assessment design partner cohort';

COMMENT ON COLUMN public.reporting_readiness_applications.status IS
  'pending | reviewing | qualified | not_qualified | calendar_sent';
