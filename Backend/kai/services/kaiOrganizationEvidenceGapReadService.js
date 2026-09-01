import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { listOrganizationEvidenceGaps as readOrganizationEvidenceGaps } from "../db/kaiOrganizationEvidenceGapReadModels.js";

/**
 * Assistant-specific organization-level gap read for the
 * impact_evidence_library KAI surface. Uses the same gk_admin/gk_operator/
 * gk_reviewer boundary that already governs the other three Impact Library
 * tools and this same gap state as surfaced per-claim by
 * get_claim_traceability_summary (TRACEABILITY_GAP_ITEM_KEYS). This does not
 * list claims and fan out per-claim traceability calls - it is a single
 * bounded organization-scoped query over kai.gap_log_items.
 */
const ORGANIZATION_EVIDENCE_GAPS_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const LIST_ORGANIZATION_EVIDENCE_GAPS_OPERATION = "list_organization_evidence_gaps_impact_library";
const ORGANIZATION_EVIDENCE_GAPS_DEFAULT_LIMIT = 25;
const ORGANIZATION_EVIDENCE_GAPS_MAX_LIMIT = 25;
const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalUuid(value) {
  return typeof value === "string" && value === value.toLowerCase() && UUID_RE.test(value);
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && typeof actorContext?.actorUserId === "string" && actorContext.actorUserId.length > 0;
}

function normalizeLimit(value) {
  const limit = value ?? ORGANIZATION_EVIDENCE_GAPS_DEFAULT_LIMIT;
  return Number.isInteger(limit) && limit >= 1 && limit <= ORGANIZATION_EVIDENCE_GAPS_MAX_LIMIT ? limit : null;
}

function toSafeGap(row, organizationId) {
  if (
    !isPlainObject(row)
    || !canonicalUuid(row.gap_log_item_id)
    || !canonicalUuid(row.claim_id)
    || typeof row.dimension_key !== "string"
    || typeof row.assessment_status !== "string"
    || typeof row.validator_key !== "string"
  ) {
    return null;
  }
  return {
    gap_log_item_id: row.gap_log_item_id,
    claim_id: row.claim_id,
    dimension_key: row.dimension_key,
    assessment_status: row.assessment_status,
    validator_key: row.validator_key,
  };
}

export async function listOrganizationEvidenceGapsForImpactLibrary(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const organizationId = typeof input.organizationId === "string" ? input.organizationId.trim().toLowerCase() : "";
  const limit = normalizeLimit(input.limit);
  const afterGapLogItemId = input.afterGapLogItemId ?? null;
  if (
    !canonicalUuid(organizationId)
    || !limit
    || (afterGapLogItemId !== null && !canonicalUuid(afterGapLogItemId))
  ) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) return buildKaiError("authorization_denied");

  const auth = validateActorCanPerformOperation(
    actorContext,
    LIST_ORGANIZATION_EVIDENCE_GAPS_OPERATION,
    organizationId,
    { allowedRoles: ORGANIZATION_EVIDENCE_GAPS_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const readGaps = dependencies.listOrganizationEvidenceGaps || readOrganizationEvidenceGaps;
  const rows = await readGaps(organizationId, { limit, afterGapLogItemId });
  if (!Array.isArray(rows) || rows.length > limit + 1) return buildKaiError("system_error");

  const gaps = [];
  for (const row of rows) {
    const gap = toSafeGap(row, organizationId);
    if (!gap) return buildKaiError("system_error");
    gaps.push(gap);
  }
  const items = gaps.slice(0, limit);
  const hasNext = gaps.length > limit;

  return {
    ok: true,
    data: {
      items,
      limit,
      afterGapLogItemId,
      truncated: hasNext,
      nextAfterGapLogItemId: hasNext ? items.at(-1).gap_log_item_id : null,
    },
    error: null,
  };
}

export const __organizationEvidenceGapReadServiceContract = Object.freeze({
  ORGANIZATION_EVIDENCE_GAPS_ALLOWED_ROLES,
  LIST_ORGANIZATION_EVIDENCE_GAPS_OPERATION,
  ORGANIZATION_EVIDENCE_GAPS_DEFAULT_LIMIT,
  ORGANIZATION_EVIDENCE_GAPS_MAX_LIMIT,
});

export const __organizationEvidenceGapReadServiceTestables = Object.freeze({
  toSafeGap,
});
