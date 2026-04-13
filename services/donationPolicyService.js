const FUNDING_CLASS_RANK = {
  mission_priority: 0,
  mixed: 1,
  commercial: 2,
};

function normalizeFundingClass(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "mission_priority" || normalized === "mixed" || normalized === "commercial") {
    return normalized;
  }
  return "mixed";
}

function parseOptionalBoolean(value) {
  if (value === true || value === false) return value;
  if (value == null) return null;
  return null;
}

function toSafeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toNullableDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function resolveEffectivePolicyProfile(candidate = {}) {
  const fundingClass = normalizeFundingClass(
    candidate.funding_class_override ?? candidate.org_funding_class ?? candidate.funding_class,
  );
  const explicitEligibility = parseOptionalBoolean(
    candidate.subsidy_eligible_override ?? candidate.org_subsidy_eligible ?? candidate.subsidy_eligible,
  );
  const manualOverrideOnly = candidate.org_manual_override_only === true || candidate.manual_override_only === true;
  const orgApproved = String(candidate.organization_status || candidate.org_status || "").toLowerCase() === "approved";
  const eligibleByClass = fundingClass === "mission_priority"
    || (fundingClass === "mixed" && explicitEligibility === true);
  const isEligible = orgApproved && !manualOverrideOnly && fundingClass !== "commercial" && eligibleByClass;

  return {
    fundingClass,
    explicitEligibility,
    manualOverrideOnly,
    organizationApproved: orgApproved,
    isEligible,
    balanceRank: Math.max(0, toSafeNumber(candidate.org_pool_balance ?? candidate.current_balance, 0)),
    startAt: toNullableDate(candidate.start_at),
  };
}

function compareCandidatePriority(a, b) {
  const aProfile = a._policyProfile || resolveEffectivePolicyProfile(a);
  const bProfile = b._policyProfile || resolveEffectivePolicyProfile(b);
  const aRank = FUNDING_CLASS_RANK[aProfile.fundingClass] ?? 9;
  const bRank = FUNDING_CLASS_RANK[bProfile.fundingClass] ?? 9;
  if (aRank !== bRank) return aRank - bRank;
  if (aProfile.balanceRank !== bProfile.balanceRank) return aProfile.balanceRank - bProfile.balanceRank;

  const aStart = aProfile.startAt ? aProfile.startAt.getTime() : Number.POSITIVE_INFINITY;
  const bStart = bProfile.startAt ? bProfile.startAt.getTime() : Number.POSITIVE_INFINITY;
  if (aStart !== bStart) return aStart - bStart;

  const aCreated = toNullableDate(a.created_at)?.getTime() ?? Number.POSITIVE_INFINITY;
  const bCreated = toNullableDate(b.created_at)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aCreated !== bCreated) return aCreated - bCreated;

  return String(a.id || "").localeCompare(String(b.id || ""));
}

function buildPolicyReasonCode(targetType, fundingClass) {
  const normalizedType = targetType === "event" ? "event" : "org";
  return `policy_${normalizedType}_${normalizeFundingClass(fundingClass)}`;
}

export function choosePolicyAllocationTarget({
  eventCandidates = [],
  organizationCandidates = [],
} = {}) {
  const eligibleEvents = (Array.isArray(eventCandidates) ? eventCandidates : [])
    .map((candidate) => ({ ...candidate, _policyProfile: resolveEffectivePolicyProfile(candidate) }))
    .filter((candidate) => candidate._policyProfile.isEligible)
    .sort(compareCandidatePriority);

  if (eligibleEvents.length > 0) {
    const winner = eligibleEvents[0];
    return {
      targetType: "event",
      organizationId: Number(winner.organization_id),
      eventId: winner.id,
      targetLabel: winner.title || `event:${winner.id}`,
      fundingClass: winner._policyProfile.fundingClass,
      policyReasonCode: buildPolicyReasonCode("event", winner._policyProfile.fundingClass),
    };
  }

  const eligibleOrganizations = (Array.isArray(organizationCandidates) ? organizationCandidates : [])
    .map((candidate) => ({ ...candidate, _policyProfile: resolveEffectivePolicyProfile(candidate) }))
    .filter((candidate) => candidate._policyProfile.isEligible)
    .sort(compareCandidatePriority);

  if (eligibleOrganizations.length > 0) {
    const winner = eligibleOrganizations[0];
    return {
      targetType: "org",
      organizationId: Number(winner.id),
      eventId: null,
      targetLabel: winner.name || `org:${winner.id}`,
      fundingClass: winner._policyProfile.fundingClass,
      policyReasonCode: buildPolicyReasonCode("org", winner._policyProfile.fundingClass),
    };
  }

  return null;
}

async function fetchPolicyEventCandidates(client, now = new Date()) {
  const { rows } = await client.query(
    `
      SELECT
        e.id,
        e.title,
        e.start_at,
        e.end_at,
        e.created_at,
        e.funding_class_override,
        e.subsidy_eligible_override,
        e.subsidy_cap_percent_override,
        COALESCE(primary_org.id, rep_org.id) AS organization_id,
        COALESCE(primary_org.name, rep_org.name) AS organization_name,
        COALESCE(primary_org.status, rep_org.status) AS organization_status,
        COALESCE(primary_org.funding_class, rep_org.funding_class, 'mixed') AS org_funding_class,
        COALESCE(primary_org.subsidy_eligible, rep_org.subsidy_eligible, false) AS org_subsidy_eligible,
        COALESCE(primary_org.subsidy_cap_percent, rep_org.subsidy_cap_percent) AS org_subsidy_cap_percent,
        COALESCE(primary_org.manual_override_only, rep_org.manual_override_only, false) AS org_manual_override_only,
        COALESCE(pool_balance.current_balance, 0)::bigint AS org_pool_balance
      FROM public.events e
      LEFT JOIN public.userdata host ON host.id = e.creator_user_id
      LEFT JOIN public.organizations primary_org ON primary_org.id = host.org_id
      LEFT JOIN public.organizations rep_org ON rep_org.rep_user_id = e.creator_user_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN pt.direction = 'credit' THEN pt.amount_credits
                ELSE -pt.amount_credits
              END
            ),
            0
          ) AS current_balance
        FROM public.funding_pools fp
        JOIN public.pool_transactions pt ON pt.pool_id = fp.id
        WHERE COALESCE(primary_org.rep_user_id, rep_org.rep_user_id) IS NOT NULL
          AND LEFT(
            fp.slug,
            LENGTH('u' || COALESCE(primary_org.rep_user_id, rep_org.rep_user_id)::text || '__')
          ) = ('u' || COALESCE(primary_org.rep_user_id, rep_org.rep_user_id)::text || '__')
      ) pool_balance ON TRUE
      WHERE e.status = 'published'
        AND (e.end_at IS NULL OR e.end_at >= $1)
        AND COALESCE(primary_org.id, rep_org.id) IS NOT NULL
    `,
    [now],
  );

  return rows || [];
}

async function fetchPolicyOrganizationCandidates(client, now = new Date()) {
  const { rows } = await client.query(
    `
      SELECT
        o.id,
        o.name,
        o.status AS org_status,
        o.funding_class,
        o.subsidy_eligible,
        o.subsidy_cap_percent,
        o.manual_override_only,
        o.approved_at,
        o.created_at,
        COALESCE(pool_balance.current_balance, 0)::bigint AS current_balance,
        COALESCE(live_events.active_events_count, 0)::int AS active_events_count
      FROM public.organizations o
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN pt.direction = 'credit' THEN pt.amount_credits
                ELSE -pt.amount_credits
              END
            ),
            0
          ) AS current_balance
        FROM public.funding_pools fp
        JOIN public.pool_transactions pt ON pt.pool_id = fp.id
        WHERE o.rep_user_id IS NOT NULL
          AND LEFT(fp.slug, LENGTH('u' || o.rep_user_id::text || '__')) = ('u' || o.rep_user_id::text || '__')
      ) pool_balance ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS active_events_count
        FROM public.events e
        WHERE e.creator_user_id = o.rep_user_id
          AND e.status = 'published'
          AND (e.end_at IS NULL OR e.end_at >= $1)
      ) live_events ON TRUE
      WHERE o.status = 'approved'
    `,
    [now],
  );

  return rows || [];
}

export async function resolvePolicyDonationTarget(client, { now = new Date() } = {}) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("client with query() is required");
  }

  const eventCandidates = await fetchPolicyEventCandidates(client, now);
  const organizationCandidates = await fetchPolicyOrganizationCandidates(client, now);

  return choosePolicyAllocationTarget({ eventCandidates, organizationCandidates });
}
