CREATE TABLE IF NOT EXISTS public.user_org_memberships (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.userdata(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role VARCHAR(64) NOT NULL DEFAULT 'admin',
  is_active BOOLEAN NOT NULL DEFAULT true,
  added_by_user_id INTEGER REFERENCES public.userdata(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, org_id)
);

ALTER TABLE public.user_org_memberships
  ADD COLUMN IF NOT EXISTS role VARCHAR(64) NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS added_by_user_id INTEGER REFERENCES public.userdata(id),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS user_org_memberships_org_id_idx
  ON public.user_org_memberships (org_id);

CREATE INDEX IF NOT EXISTS user_org_memberships_user_id_idx
  ON public.user_org_memberships (user_id);

INSERT INTO public.user_org_memberships (user_id, org_id, role, is_active, created_at)
SELECT
  u.id,
  u.org_id,
  'admin',
  true,
  NOW()
FROM public.userdata u
WHERE u.org_id IS NOT NULL
ON CONFLICT (user_id, org_id)
DO UPDATE SET
  is_active = true,
  role = COALESCE(public.user_org_memberships.role, 'admin');
