\if :{?down}
DROP INDEX IF EXISTS public.idx_events_project_id;
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_project_id_fkey;
ALTER TABLE public.events
  DROP COLUMN IF EXISTS project_id;

DROP INDEX IF EXISTS public.idx_event_roles_project_id;
ALTER TABLE public.event_roles
  DROP CONSTRAINT IF EXISTS event_roles_project_id_fkey;
ALTER TABLE public.event_roles
  DROP COLUMN IF EXISTS project_id;

DO $$
BEGIN
  IF to_regclass('public.projects') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS projects_set_updated_at ON public.projects;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_projects_start_end_date;
DROP INDEX IF EXISTS public.idx_projects_organization_lifecycle_stage;
DROP INDEX IF EXISTS public.idx_projects_organization_id;
DROP INDEX IF EXISTS public.idx_projects_program_id;
DROP TABLE IF EXISTS public.projects;

DO $$
BEGIN
  IF to_regclass('public.programs') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS programs_set_updated_at ON public.programs;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_programs_organization_status;
DROP INDEX IF EXISTS public.idx_programs_organization_id;
DROP TABLE IF EXISTS public.programs;
\else
CREATE TABLE IF NOT EXISTS public.programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  funder TEXT,
  reporting_period_start DATE,
  reporting_period_end DATE,
  intended_equity_groups TEXT[] DEFAULT '{}'::TEXT[],
  proposal_text TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_by_user_id INTEGER NOT NULL REFERENCES public.userdata(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_programs_organization_id
  ON public.programs USING btree (organization_id);

CREATE INDEX IF NOT EXISTS idx_programs_organization_status
  ON public.programs USING btree (organization_id, status);

CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES public.programs(id) ON DELETE SET NULL,
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  start_date DATE,
  end_date DATE,
  languages TEXT[] DEFAULT '{}'::TEXT[],
  partner_org_ids INTEGER[] DEFAULT '{}'::INTEGER[],
  beneficiary_count INTEGER CHECK (beneficiary_count >= 0),
  beneficiary_equity_breakdown JSONB,
  lifecycle_stage TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle_stage IN ('draft', 'recruiting', 'live', 'closing_out', 'reported')),
  created_by_user_id INTEGER NOT NULL REFERENCES public.userdata(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_program_id
  ON public.projects USING btree (program_id);

CREATE INDEX IF NOT EXISTS idx_projects_organization_id
  ON public.projects USING btree (organization_id);

CREATE INDEX IF NOT EXISTS idx_projects_organization_lifecycle_stage
  ON public.projects USING btree (organization_id, lifecycle_stage);

CREATE INDEX IF NOT EXISTS idx_projects_start_end_date
  ON public.projects USING btree (start_date, end_date);

ALTER TABLE public.event_roles
  ADD COLUMN IF NOT EXISTS project_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'event_roles_project_id_fkey'
      AND conrelid = 'public.event_roles'::regclass
  ) THEN
    ALTER TABLE public.event_roles
      ADD CONSTRAINT event_roles_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_event_roles_project_id
  ON public.event_roles USING btree (project_id);

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS project_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_project_id_fkey'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_project_id
  ON public.events USING btree (project_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'programs_set_updated_at'
      AND tgrelid = 'public.programs'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER programs_set_updated_at
      BEFORE UPDATE ON public.programs
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'projects_set_updated_at'
      AND tgrelid = 'public.projects'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER projects_set_updated_at
      BEFORE UPDATE ON public.projects
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
\endif
