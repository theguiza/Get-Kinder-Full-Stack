BEGIN;

WITH credit_rows AS (
  SELECT
    pt.id AS origin_pool_transaction_id,
    pt.pool_id,
    pt.reason,
    pt.donation_id,
    pt.amount_credits,
    pt.created_at,
    fp.slug AS pool_slug,
    NULLIF(SUBSTRING(fp.slug FROM '^u([0-9]+)__'), '')::integer AS scoped_rep_user_id
  FROM public.pool_transactions pt
  JOIN public.funding_pools fp ON fp.id = pt.pool_id
  WHERE pt.direction = 'credit'
    AND pt.reason IN ('donation_in', 'org_topup', 'subscription_topup', 'manual_adjust')
    AND NOT EXISTS (
      SELECT 1
      FROM public.funding_credits fc
      WHERE fc.origin_pool_transaction_id = pt.id
    )
),
resolved_org AS (
  SELECT
    cr.*,
    org.id AS scoped_organization_id
  FROM credit_rows cr
  LEFT JOIN public.organizations org ON org.rep_user_id = cr.scoped_rep_user_id
),
donation_scope AS (
  SELECT
    dar.donation_id,
    dar.status AS review_status,
    dar.manual_target_type,
    dar.manual_target_org_id,
    dar.manual_target_event_id
  FROM public.donation_allocation_reviews dar
)
INSERT INTO public.funding_credits (
  pool_id,
  origin_pool_transaction_id,
  source_type,
  scope_type,
  organization_id,
  event_id,
  donation_id,
  subscription_topup_id,
  amount_ic,
  remaining_ic,
  allocation_status,
  expires_at,
  created_by_user_id,
  metadata
)
SELECT
  ro.pool_id,
  ro.origin_pool_transaction_id,
  CASE
    WHEN ro.reason = 'donation_in' THEN 'donation'
    WHEN ro.reason = 'subscription_topup' THEN 'subscription'
    WHEN ro.reason = 'org_topup' THEN 'admin_grant'
    WHEN ro.reason = 'manual_adjust' THEN 'admin_grant'
    ELSE 'reserve'
  END AS source_type,
  CASE
    WHEN ro.reason = 'donation_in' AND ds.manual_target_type IN ('event', 'org', 'unrestricted') THEN ds.manual_target_type
    WHEN ro.reason IN ('org_topup', 'subscription_topup', 'manual_adjust') AND ro.scoped_organization_id IS NOT NULL THEN 'org'
    ELSE 'unrestricted'
  END AS scope_type,
  CASE
    WHEN ro.reason = 'donation_in' THEN ds.manual_target_org_id
    WHEN ro.reason IN ('org_topup', 'subscription_topup', 'manual_adjust') THEN ro.scoped_organization_id
    ELSE NULL
  END AS organization_id,
  CASE
    WHEN ro.reason = 'donation_in' AND ds.manual_target_type = 'event' THEN ds.manual_target_event_id
    ELSE NULL
  END AS event_id,
  ro.donation_id,
  st.id AS subscription_topup_id,
  ro.amount_credits AS amount_ic,
  ro.amount_credits AS remaining_ic,
  CASE
    WHEN ro.reason = 'donation_in' AND ds.review_status = 'pending_manual_review' THEN 'held_pending_manual_review'
    ELSE 'available'
  END AS allocation_status,
  NULL AS expires_at,
  NULL AS created_by_user_id,
  jsonb_strip_nulls(
    jsonb_build_object(
      'stage', 'stage4_backfill',
      'pool_slug', ro.pool_slug,
      'origin_reason', ro.reason,
      'scoped_rep_user_id', ro.scoped_rep_user_id,
      'review_status', ds.review_status
    )
  ) AS metadata
FROM resolved_org ro
LEFT JOIN donation_scope ds ON ds.donation_id = ro.donation_id
LEFT JOIN public.subscription_topups st ON st.pool_transaction_id = ro.origin_pool_transaction_id;

COMMIT;
