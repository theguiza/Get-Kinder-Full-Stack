ALTER TABLE public.reporting_readiness_applications
  ADD COLUMN IF NOT EXISTS how_heard_about TEXT,
  ADD COLUMN IF NOT EXISTS referral_source TEXT,
  ADD COLUMN IF NOT EXISTS application_prompt TEXT,
  ADD COLUMN IF NOT EXISTS application_prompt_other TEXT;

COMMENT ON COLUMN public.reporting_readiness_applications.how_heard_about IS
  'Required application answer: how the applicant first heard about Get Kinder';

COMMENT ON COLUMN public.reporting_readiness_applications.referral_source IS
  'Conditional application answer: who referred the applicant to Get Kinder';

COMMENT ON COLUMN public.reporting_readiness_applications.application_prompt IS
  'Optional application answer: what prompted the applicant to apply today';

COMMENT ON COLUMN public.reporting_readiness_applications.application_prompt_other IS
  'Conditional application answer when application_prompt is Other';
