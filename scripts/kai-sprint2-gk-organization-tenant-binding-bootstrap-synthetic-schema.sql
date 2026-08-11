BEGIN;

-- Minimal synthetic mirror of the two existing (non-KAI) tables this
-- migration's foreign key depends on. This is not the full application
-- schema - only the columns kai.gk_organization_bindings actually
-- references, so the runner-owned ephemeral database can prove the FK and
-- constraint behavior without depending on scripts/migrations/*.sql
-- (which are Get Kinder application migrations, not KAI Sprint2 ones).
CREATE TABLE public.userdata (
  id SERIAL PRIMARY KEY
);

CREATE TABLE public.organizations (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  website         VARCHAR(255),
  logo_url        TEXT,
  rep_user_id     INTEGER REFERENCES public.userdata(id),
  rep_role        VARCHAR(255),
  status          VARCHAR(50) NOT NULL DEFAULT 'pending',
  applied_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  approved_at     TIMESTAMP WITH TIME ZONE,
  approved_by     VARCHAR(255),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMIT;
