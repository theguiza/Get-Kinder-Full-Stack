import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { listOrganizationEvidenceItems as readOrganizationEvidenceItems } from "../db/kaiEvidenceLibraryReadModels.js";

/**
 * KAI Impact Library redesign, E1 correction: Knowledge Studio's Evidence
 * tab must not be enumerated through kai.claims (evidence items can exist
 * without a claim - see kaiEvidenceLibraryReadModels.js). This is the
 * smallest new, organization-scoped, read-only service for browsing
 * kai.evidence_items directly, mirroring kaiClaimLibraryService.js's exact
 * authorization/pagination/fail-closed-validation conventions. No new
 * persistence, no schema change - reads only.
 */
const EVIDENCE_LIBRARY_READ_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const EVIDENCE_LIBRARY_READ_OPERATION = "read_intake";
const EVIDENCE_LIBRARY_DEFAULT_LIMIT = 25;
const EVIDENCE_LIBRARY_MAX_LIMIT = 25;
const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;
const MACHINE_TOKEN_RE = /^[a-z0-9_]{1,64}$/;

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
  const limit = value ?? EVIDENCE_LIBRARY_DEFAULT_LIMIT;
  return Number.isInteger(limit) && limit >= 1 && limit <= EVIDENCE_LIBRARY_MAX_LIMIT ? limit : null;
}

function isOptionalMachineToken(value) {
  return value === null || (typeof value === "string" && MACHINE_TOKEN_RE.test(value));
}

function isOptionalStatement(value) {
  return value === null || (typeof value === "string" && value.length > 0 && value.length <= 4000);
}

function isOptionalUuid(value) {
  return value === null || canonicalUuid(value);
}

function isOptionalBoolean(value) {
  return value === null || typeof value === "boolean";
}

function responseEvidenceItem(row, organizationId) {
  if (
    !isPlainObject(row)
    || !canonicalUuid(row.evidence_item_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || !isOptionalUuid(row.source_id ?? null)
    || !isOptionalUuid(row.source_version_id ?? null)
    || !isOptionalMachineToken(row.evidence_type ?? null)
    || !isOptionalMachineToken(row.data_class ?? null)
    || !isOptionalMachineToken(row.support_strength ?? null)
    || !isOptionalStatement(row.statement ?? null)
    || !isOptionalMachineToken(row.evidence_review_status ?? null)
    || !isOptionalBoolean(row.internal_only ?? null)
    || !isOptionalBoolean(row.public_use_allowed ?? null)
    || !isOptionalBoolean(row.funder_use_allowed ?? null)
  ) {
    return null;
  }
  return {
    evidenceItemId: row.evidence_item_id,
    sourceId: row.source_id ?? null,
    sourceVersionId: row.source_version_id ?? null,
    evidenceType: row.evidence_type ?? null,
    dataClass: row.data_class ?? null,
    supportStrength: row.support_strength ?? null,
    statement: row.statement ?? null,
    evidenceReviewStatus: row.evidence_review_status ?? null,
    internalOnly: row.internal_only ?? null,
    publicUseAllowed: row.public_use_allowed ?? null,
    funderUseAllowed: row.funder_use_allowed ?? null,
  };
}

export async function listOrganizationEvidenceLibrary(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const organizationId = typeof input.organizationId === "string" ? input.organizationId.trim().toLowerCase() : "";
  const limit = normalizeLimit(input.limit);
  const afterEvidenceItemId = input.afterEvidenceItemId ?? null;
  if (!canonicalUuid(organizationId) || !limit || (afterEvidenceItemId !== null && !canonicalUuid(afterEvidenceItemId))) {
    return buildKaiError("validation_blocker");
  }
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied");

  const genericAuth = validateActorCanPerformOperation(input.actorContext, EVIDENCE_LIBRARY_READ_OPERATION, organizationId);
  if (!genericAuth.ok) {
    return buildKaiError(genericAuth.error_code || "authorization_denied", { blockers: genericAuth.blockers });
  }
  const roleAuth = validateActorCanPerformOperation(
    input.actorContext,
    EVIDENCE_LIBRARY_READ_OPERATION,
    organizationId,
    { allowedRoles: EVIDENCE_LIBRARY_READ_ROLES },
  );
  if (!roleAuth.ok) {
    return buildKaiError(roleAuth.error_code || "authorization_denied", { blockers: roleAuth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const readItems = dependencies.listOrganizationEvidenceItems || readOrganizationEvidenceItems;
  const rows = await readItems(organizationId, { limit, afterEvidenceItemId });
  if (!Array.isArray(rows) || rows.length > limit + 1) return buildKaiError("system_error");

  const candidates = [];
  for (const row of rows) {
    const candidate = responseEvidenceItem(row, organizationId);
    if (!candidate) return buildKaiError("system_error");
    candidates.push(candidate);
  }
  const items = candidates.slice(0, limit);
  const hasNext = candidates.length > limit;

  return {
    ok: true,
    data: {
      items,
      limit,
      afterEvidenceItemId,
      truncated: hasNext,
      nextAfterEvidenceItemId: hasNext ? items.at(-1).evidenceItemId : null,
    },
    warnings: [],
  };
}

export const __evidenceLibraryServiceContract = Object.freeze({
  EVIDENCE_LIBRARY_READ_OPERATION,
  EVIDENCE_LIBRARY_READ_ROLES,
  EVIDENCE_LIBRARY_DEFAULT_LIMIT,
  EVIDENCE_LIBRARY_MAX_LIMIT,
});

export const __testables = Object.freeze({
  responseEvidenceItem,
});
