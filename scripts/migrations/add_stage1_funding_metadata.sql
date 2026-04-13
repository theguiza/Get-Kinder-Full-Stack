ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS funding_class TEXT NOT NULL DEFAULT 'mixed',
  ADD COLUMN IF NOT EXISTS subsidy_eligible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subsidy_cap_percent INTEGER,
  ADD COLUMN IF NOT EXISTS manual_override_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS funding_notes TEXT;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS funding_class_override TEXT,
  ADD COLUMN IF NOT EXISTS subsidy_eligible_override BOOLEAN,
  ADD COLUMN IF NOT EXISTS subsidy_cap_percent_override INTEGER,
  ADD COLUMN IF NOT EXISTS event_package_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS event_package_expires_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organizations_funding_class_check'
      AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_funding_class_check
      CHECK (funding_class IN ('commercial', 'mixed', 'mission_priority'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organizations_subsidy_cap_percent_check'
      AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_subsidy_cap_percent_check
      CHECK (
        subsidy_cap_percent IS NULL
        OR (subsidy_cap_percent >= 0 AND subsidy_cap_percent <= 100)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_funding_class_override_check'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_funding_class_override_check
      CHECK (
        funding_class_override IS NULL
        OR funding_class_override IN ('commercial', 'mixed', 'mission_priority')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_subsidy_cap_percent_override_check'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_subsidy_cap_percent_override_check
      CHECK (
        subsidy_cap_percent_override IS NULL
        OR (subsidy_cap_percent_override >= 0 AND subsidy_cap_percent_override <= 100)
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.funding_credits (
  id BIGSERIAL PRIMARY KEY,
  pool_id BIGINT NOT NULL REFERENCES public.funding_pools(id) ON DELETE CASCADE,
  origin_pool_transaction_id BIGINT NOT NULL UNIQUE REFERENCES public.pool_transactions(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  organization_id INTEGER REFERENCES public.organizations(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  donation_id BIGINT REFERENCES public.donations(id) ON DELETE SET NULL,
  subscription_topup_id BIGINT REFERENCES public.subscription_topups(id) ON DELETE SET NULL,
  amount_ic INTEGER NOT NULL,
  remaining_ic INTEGER NOT NULL,
  allocation_status TEXT NOT NULL DEFAULT 'available',
  expires_at TIMESTAMPTZ,
  created_by_user_id INTEGER REFERENCES public.userdata(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'funding_credits_source_type_check'
      AND conrelid = 'public.funding_credits'::regclass
  ) THEN
    ALTER TABLE public.funding_credits
      ADD CONSTRAINT funding_credits_source_type_check
      CHECK (source_type IN ('donation', 'event_package', 'subscription', 'admin_grant', 'pilot_subsidy', 'org_topup', 'reserve'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'funding_credits_scope_type_check'
      AND conrelid = 'public.funding_credits'::regclass
  ) THEN
    ALTER TABLE public.funding_credits
      ADD CONSTRAINT funding_credits_scope_type_check
      CHECK (scope_type IN ('event', 'org', 'unrestricted'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'funding_credits_allocation_status_check'
      AND conrelid = 'public.funding_credits'::regclass
  ) THEN
    ALTER TABLE public.funding_credits
      ADD CONSTRAINT funding_credits_allocation_status_check
      CHECK (allocation_status IN ('available', 'held_pending_manual_review', 'held_pending_subscription', 'allocated', 'partially_spent', 'spent', 'expired', 'reversed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'funding_credits_amount_ic_check'
      AND conrelid = 'public.funding_credits'::regclass
  ) THEN
    ALTER TABLE public.funding_credits
      ADD CONSTRAINT funding_credits_amount_ic_check
      CHECK (amount_ic >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'funding_credits_remaining_ic_check'
      AND conrelid = 'public.funding_credits'::regclass
  ) THEN
    ALTER TABLE public.funding_credits
      ADD CONSTRAINT funding_credits_remaining_ic_check
      CHECK (remaining_ic >= 0 AND remaining_ic <= amount_ic);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS funding_credits_source_status_idx
  ON public.funding_credits(source_type, allocation_status);

CREATE INDEX IF NOT EXISTS funding_credits_org_status_expiry_idx
  ON public.funding_credits(organization_id, allocation_status, expires_at);

CREATE INDEX IF NOT EXISTS funding_credits_event_status_expiry_idx
  ON public.funding_credits(event_id, allocation_status, expires_at);

CREATE INDEX IF NOT EXISTS funding_credits_donation_idx
  ON public.funding_credits(donation_id);

CREATE INDEX IF NOT EXISTS funding_credits_scope_status_idx
  ON public.funding_credits(scope_type, allocation_status);

CREATE TABLE IF NOT EXISTS public.funding_allocations (
  id BIGSERIAL PRIMARY KEY,
  funding_credit_id BIGINT NOT NULL REFERENCES public.funding_credits(id) ON DELETE CASCADE,
  pool_transaction_id BIGINT REFERENCES public.pool_transactions(id) ON DELETE SET NULL,
  wallet_tx_id UUID REFERENCES public.wallet_transactions(id) ON DELETE SET NULL,
  donor_receipt_id BIGINT REFERENCES public.donor_receipts(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  organization_id INTEGER REFERENCES public.organizations(id) ON DELETE SET NULL,
  volunteer_user_id INTEGER REFERENCES public.userdata(id) ON DELETE SET NULL,
  amount_ic INTEGER NOT NULL,
  minutes_funded INTEGER,
  allocation_rank INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'funding_allocations_amount_ic_check'
      AND conrelid = 'public.funding_allocations'::regclass
  ) THEN
    ALTER TABLE public.funding_allocations
      ADD CONSTRAINT funding_allocations_amount_ic_check
      CHECK (amount_ic > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS funding_allocations_credit_idx
  ON public.funding_allocations(funding_credit_id);

CREATE INDEX IF NOT EXISTS funding_allocations_wallet_tx_idx
  ON public.funding_allocations(wallet_tx_id);

CREATE INDEX IF NOT EXISTS funding_allocations_event_org_idx
  ON public.funding_allocations(event_id, organization_id);

CREATE INDEX IF NOT EXISTS funding_allocations_volunteer_idx
  ON public.funding_allocations(volunteer_user_id);

CREATE TABLE IF NOT EXISTS public.donation_allocation_reviews (
  id BIGSERIAL PRIMARY KEY,
  donation_id BIGINT NOT NULL UNIQUE REFERENCES public.donations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_manual_review',
  review_due_at TIMESTAMPTZ NOT NULL,
  manual_target_type TEXT,
  manual_target_org_id INTEGER REFERENCES public.organizations(id) ON DELETE SET NULL,
  manual_target_event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  reviewed_by_user_id INTEGER REFERENCES public.userdata(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  policy_reason_code TEXT,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'donation_allocation_reviews_status_check'
      AND conrelid = 'public.donation_allocation_reviews'::regclass
  ) THEN
    ALTER TABLE public.donation_allocation_reviews
      ADD CONSTRAINT donation_allocation_reviews_status_check
      CHECK (status IN ('pending_manual_review', 'manually_allocated', 'policy_allocated', 'cancelled'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'donation_allocation_reviews_manual_target_type_check'
      AND conrelid = 'public.donation_allocation_reviews'::regclass
  ) THEN
    ALTER TABLE public.donation_allocation_reviews
      ADD CONSTRAINT donation_allocation_reviews_manual_target_type_check
      CHECK (manual_target_type IS NULL OR manual_target_type IN ('org', 'event', 'unrestricted'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS donation_allocation_reviews_status_due_idx
  ON public.donation_allocation_reviews(status, review_due_at);

CREATE INDEX IF NOT EXISTS donation_allocation_reviews_org_idx
  ON public.donation_allocation_reviews(manual_target_org_id);

CREATE INDEX IF NOT EXISTS donation_allocation_reviews_event_idx
  ON public.donation_allocation_reviews(manual_target_event_id);

CREATE TABLE IF NOT EXISTS public.event_package_rollovers (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  funding_credit_id BIGINT NOT NULL REFERENCES public.funding_credits(id) ON DELETE CASCADE,
  unused_ic INTEGER NOT NULL,
  status TEXT NOT NULL,
  held_until TIMESTAMPTZ,
  subscription_required BOOLEAN NOT NULL DEFAULT true,
  notified_at TIMESTAMPTZ,
  rolled_over_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'event_package_rollovers_unused_ic_check'
      AND conrelid = 'public.event_package_rollovers'::regclass
  ) THEN
    ALTER TABLE public.event_package_rollovers
      ADD CONSTRAINT event_package_rollovers_unused_ic_check
      CHECK (unused_ic >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'event_package_rollovers_status_check'
      AND conrelid = 'public.event_package_rollovers'::regclass
  ) THEN
    ALTER TABLE public.event_package_rollovers
      ADD CONSTRAINT event_package_rollovers_status_check
      CHECK (status IN ('eligible_for_rollover', 'held_pending_subscription', 'rolled_to_org_pool', 'expired_unused', 'manually_overridden'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_package_rollovers_event_status_idx
  ON public.event_package_rollovers(event_id, status);

CREATE INDEX IF NOT EXISTS event_package_rollovers_org_status_held_idx
  ON public.event_package_rollovers(organization_id, status, held_until);
