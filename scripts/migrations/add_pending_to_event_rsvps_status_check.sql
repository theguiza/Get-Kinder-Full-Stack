DO $$
DECLARE
  allowed_statuses TEXT[];
  allowed_statuses_sql TEXT;
BEGIN
  SELECT COALESCE(array_agg(status ORDER BY status), ARRAY[]::TEXT[])
    INTO allowed_statuses
    FROM (
      SELECT DISTINCT status
      FROM public.event_rsvps
      WHERE status IS NOT NULL
    ) status_values;

  IF NOT ('pending' = ANY (allowed_statuses)) THEN
    allowed_statuses := array_append(allowed_statuses, 'pending');
  END IF;

  IF COALESCE(array_length(allowed_statuses, 1), 0) = 0 THEN
    allowed_statuses := ARRAY['pending', 'accepted', 'declined', 'checked_in'];
  END IF;

  SELECT string_agg(quote_literal(value), ', ' ORDER BY value)
    INTO allowed_statuses_sql
    FROM unnest(allowed_statuses) AS value;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'event_rsvps'
      AND c.conname = 'event_rsvps_status_check'
  ) THEN
    ALTER TABLE public.event_rsvps
      DROP CONSTRAINT event_rsvps_status_check;
  END IF;

  EXECUTE format(
    'ALTER TABLE public.event_rsvps ADD CONSTRAINT event_rsvps_status_check CHECK (status IN (%s))',
    allowed_statuses_sql
  );
END $$;
