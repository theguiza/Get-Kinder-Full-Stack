ALTER TABLE public.donation_allocation_reviews
  ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_sent_to TEXT,
  ADD COLUMN IF NOT EXISTS last_notification_error TEXT;

CREATE INDEX IF NOT EXISTS donation_allocation_reviews_notification_due_idx
  ON public.donation_allocation_reviews(status, review_due_at, notification_sent_at);
