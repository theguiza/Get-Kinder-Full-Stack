import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { listOrganizationEvidenceGaps as readOrganizationEvidenceGaps } from "../db/kaiOrganizationEvidenceGapReadModels.js";
import { filterCurrentOrganizationEvidenceGaps as filterCurrentOrganizationEvidenceGapsDefault } from "../dictionary/postgresOrganizationEvidenceGapCurrentStateRepository.js";

/**
 * Assistant-specific organization-level gap read for the
 * impact_evidence_library KAI surface. Uses the same gk_admin/gk_operator/
 * gk_reviewer boundary that already governs the other three Impact Library
 * tools and this same gap state as surfaced per-claim by
 * get_claim_traceability_summary (TRACEABILITY_GAP_ITEM_KEYS). This does not
 * list claims and fan out per-claim traceability calls: it reads one bounded,
 * keyset-paginated candidate page of kai.gap_log_items, then - inside that
 * same read-only transaction/snapshot - batch-validates every candidate claim
 * referenced by that page against the identical current-state gates
 * get_claim_traceability_summary itself enforces
 * (filterCurrentOrganizationEvidenceGaps,
 * Backend/kai/dictionary/postgresOrganizationEvidenceGapCurrentStateRepository.js),
 * omitting any candidate whose owning claim traceability would currently
 * refuse to expose as current. Semantic filtering happens strictly after
 * candidate pagination: the keyset cursor always advances to the last
 * persisted candidate actually scanned, never to the last candidate that
 * survived the current-state filter, so a stale row filtered out of one page
 * can never make a later current gap unreachable.
 */
async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}
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
  const filterCurrent = dependencies.filterCurrentOrganizationEvidenceGaps || filterCurrentOrganizationEvidenceGapsDefault;
  const runInTransaction = dependencies.runInTransaction || (await resolveDefaultRunInTransaction());

  let result;
  try {
    result = await runInTransaction(async (tx) => {
    // Same read-only snapshot convention get_claim_traceability_summary
    // itself uses (postgresClaimTraceabilityRepository.js#
    // createPostgresClaimTraceabilityRepository): the candidate gap page and
    // every authoritative batch read used to validate it are read from one
    // consistent REPEATABLE READ / READ ONLY snapshot, never a mix of this
    // snapshot and independently changing outside state.
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const candidateRows = await readGaps(organizationId, { limit, afterGapLogItemId }, tx);
    if (!Array.isArray(candidateRows) || candidateRows.length > limit + 1) return null;

    const candidateGaps = [];
    for (const row of candidateRows) {
      const gap = toSafeGap(row, organizationId);
      if (!gap) return null;
      candidateGaps.push(gap);
    }

    // Candidate pagination is decided from the persisted candidate sequence
    // actually scanned, BEFORE semantic (current-state) filtering: the first
    // `limit` candidate rows are "scanned", any (limit+1)'th row is only a
    // lookahead used to detect truncation. The keyset cursor always advances
    // past the last scanned candidate, never past the last candidate that
    // happened to survive filtering - so a stale row filtered out of this
    // page can never make a later current gap unreachable, and this service
    // never internally re-fetches more candidate pages to try to fill
    // `limit` with current results (that would turn bounded pagination into
    // unbounded scanning).
    const scannedCandidates = candidateGaps.slice(0, limit);
    const truncated = candidateGaps.length > limit;
    const nextAfterGapLogItemId = truncated ? scannedCandidates.at(-1).gap_log_item_id : null;

    const currentItems = await filterCurrent(tx, {
      organizationId,
      candidateGapRows: scannedCandidates,
    });

      return { items: currentItems, truncated, nextAfterGapLogItemId };
    });
  } catch {
    return buildKaiError("system_error");
  }

  if (!result) return buildKaiError("system_error");

  return {
    ok: true,
    data: {
      items: result.items,
      limit,
      afterGapLogItemId,
      truncated: result.truncated,
      nextAfterGapLogItemId: result.nextAfterGapLogItemId,
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
