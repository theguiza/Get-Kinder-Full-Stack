-- Supports keyset pagination for published event listings.
-- If your migration runner wraps statements in a transaction,
-- remove CONCURRENTLY before running.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_published_start_id
  ON public.events (start_at, id)
  WHERE status = 'published';
