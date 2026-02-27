CREATE TABLE IF NOT EXISTS public.event_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  rater_user_id INTEGER NOT NULL REFERENCES public.userdata(id) ON DELETE CASCADE,
  ratee_user_id INTEGER REFERENCES public.userdata(id) ON DELETE CASCADE,
  ratee_org_id INTEGER REFERENCES public.organizations(id) ON DELETE CASCADE,
  rater_role TEXT NOT NULL CHECK (rater_role IN ('volunteer', 'host')),
  ratee_role TEXT NOT NULL CHECK (ratee_role IN ('volunteer', 'host', 'organization')),
  stars SMALLINT NOT NULL CHECK (stars >= 1 AND stars <= 5),
  tags TEXT[],
  note TEXT,
  revealed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_ratings_ratee_target_check CHECK (
    (ratee_role = 'organization' AND ratee_org_id IS NOT NULL AND ratee_user_id IS NULL)
    OR
    (ratee_role IN ('volunteer', 'host') AND ratee_user_id IS NOT NULL AND ratee_org_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_ratings_pair
  ON public.event_ratings (
    event_id,
    rater_user_id,
    rater_role,
    ratee_role,
    COALESCE(ratee_user_id, -1),
    COALESCE(ratee_org_id, -1)
  );

CREATE INDEX IF NOT EXISTS idx_event_ratings_event
  ON public.event_ratings (event_id);

CREATE INDEX IF NOT EXISTS idx_event_ratings_ratee_created
  ON public.event_ratings (ratee_user_id, created_at DESC);
