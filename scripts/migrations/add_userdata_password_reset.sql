ALTER TABLE public.userdata
  ADD COLUMN IF NOT EXISTS reset_password_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS reset_password_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reset_password_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_userdata_reset_password_token_hash
  ON public.userdata (reset_password_token_hash);
