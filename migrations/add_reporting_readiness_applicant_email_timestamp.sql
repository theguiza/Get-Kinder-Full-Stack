ALTER TABLE public.reporting_readiness_applications
  ADD COLUMN IF NOT EXISTS applicant_confirmation_email_sent_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.reporting_readiness_applications.applicant_confirmation_email_sent_at IS
  'Timestamp when the applicant confirmation email was successfully sent';
