ALTER TABLE userdata
  ADD COLUMN IF NOT EXISTS org_rep BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS org_id INTEGER;

CREATE TABLE IF NOT EXISTS organizations (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  website         VARCHAR(255),
  logo_url        TEXT,
  rep_user_id     INTEGER REFERENCES userdata(id),
  rep_role        VARCHAR(255),
  status          VARCHAR(50) NOT NULL DEFAULT 'pending',
  applied_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  approved_at     TIMESTAMP WITH TIME ZONE,
  approved_by     VARCHAR(255),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_applications (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES userdata(id),
  org_name        VARCHAR(255) NOT NULL,
  org_description TEXT,
  org_website     VARCHAR(255),
  rep_role        VARCHAR(255),
  status          VARCHAR(50) NOT NULL DEFAULT 'pending',
  submitted_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reviewed_at     TIMESTAMP WITH TIME ZONE,
  reviewed_by     VARCHAR(255),
  notes           TEXT
);
