ALTER TABLE public.event_ratings
  ADD COLUMN IF NOT EXISTS ratee_org_id INTEGER;

ALTER TABLE public.event_ratings
  ALTER COLUMN ratee_user_id DROP NOT NULL;

ALTER TABLE public.event_ratings
  DROP CONSTRAINT IF EXISTS event_ratings_ratee_org_id_fkey;

ALTER TABLE public.event_ratings
  ADD CONSTRAINT event_ratings_ratee_org_id_fkey
  FOREIGN KEY (ratee_org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.event_ratings
  DROP CONSTRAINT IF EXISTS event_ratings_ratee_role_check;

ALTER TABLE public.event_ratings
  ADD CONSTRAINT event_ratings_ratee_role_check
  CHECK (ratee_role IN ('volunteer', 'host', 'organization'));

UPDATE public.event_ratings er
SET
  ratee_org_id = u.org_id,
  ratee_user_id = NULL,
  ratee_role = 'organization'
FROM public.userdata u
WHERE er.ratee_role = 'host'
  AND er.ratee_user_id = u.id
  AND u.org_id IS NOT NULL
  AND er.ratee_org_id IS NULL;

ALTER TABLE public.event_ratings
  DROP CONSTRAINT IF EXISTS event_ratings_ratee_target_check;

ALTER TABLE public.event_ratings
  ADD CONSTRAINT event_ratings_ratee_target_check
  CHECK (
    (ratee_role = 'organization' AND ratee_org_id IS NOT NULL AND ratee_user_id IS NULL)
    OR
    (ratee_role IN ('volunteer', 'host') AND ratee_user_id IS NOT NULL AND ratee_org_id IS NULL)
  );

DROP INDEX IF EXISTS public.uq_event_ratings_pair;

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_ratings_pair
  ON public.event_ratings (
    event_id,
    rater_user_id,
    rater_role,
    ratee_role,
    COALESCE(ratee_user_id, -1),
    COALESCE(ratee_org_id, -1)
  );
