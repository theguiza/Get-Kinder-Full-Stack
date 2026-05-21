-- UP
ALTER TABLE public.event_roles DROP CONSTRAINT IF EXISTS event_roles_spots_check;
ALTER TABLE public.event_roles
  ADD CONSTRAINT event_roles_spots_check
  CHECK (spots_needed > 0 AND spots_filled >= 0);

-- DOWN
-- ALTER TABLE public.event_roles DROP CONSTRAINT IF EXISTS event_roles_spots_check;
-- ALTER TABLE public.event_roles
--   ADD CONSTRAINT event_roles_spots_check
--   CHECK (spots_needed > 0 AND spots_filled >= 0 AND spots_filled <= spots_needed);
