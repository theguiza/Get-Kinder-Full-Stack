ALTER TABLE public.userdata
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verification_token_hash VARCHAR(255),
  ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMP;

UPDATE public.userdata
   SET email_verified = TRUE
 WHERE (google_id IS NOT NULL OR facebook_id IS NOT NULL)
   AND email_verified IS DISTINCT FROM TRUE;
