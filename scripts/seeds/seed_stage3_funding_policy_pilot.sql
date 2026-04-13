BEGIN;

-- Current live org policy baseline:
-- 1 = Get Kinder: platform/community priority org that can receive subsidy funding
-- 3 = OARCA: commercial/sporting org; donor subsidy disabled by default
UPDATE public.organizations
SET funding_class = 'mission_priority',
    subsidy_eligible = TRUE,
    subsidy_cap_percent = NULL,
    manual_override_only = FALSE,
    funding_notes = 'Stage 3 pilot seed: platform/community priority organization eligible for donor subsidy fallback.'
WHERE id = 1;

UPDATE public.organizations
SET funding_class = 'commercial',
    subsidy_eligible = FALSE,
    subsidy_cap_percent = NULL,
    manual_override_only = FALSE,
    funding_notes = 'Stage 3 pilot seed: commercial/sporting organization; unrestricted donor subsidy disabled by default.'
WHERE id = 3;

-- OARCA regatta / creator 9 events should never auto-consume unrestricted donor subsidy.
UPDATE public.events
SET funding_class_override = 'commercial',
    subsidy_eligible_override = FALSE,
    subsidy_cap_percent_override = NULL
WHERE creator_user_id = 9;

-- Explicitly mark obvious tests / personal events as subsidy-ineligible even if they belong to Get Kinder.
UPDATE public.events
SET funding_class_override = 'commercial',
    subsidy_eligible_override = FALSE,
    subsidy_cap_percent_override = NULL
WHERE LOWER(COALESCE(title, '')) LIKE ANY (
  ARRAY[
    '%test%',
    '%testing%',
    'untitled event',
    '%birthday%',
    '%watch party%',
    '%tanzi con zoe%'
  ]
);

COMMIT;
