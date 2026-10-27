import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { validateRecordCountDefinition } from "../validators/kaiSourceMeasurementValidators.js";
import { __evidenceLineageServiceContract } from "./kaiEvidenceLineageService.js";

// The P2-01 evidence-extraction authority (organization membership only):
// whoever may create evidence from a promoted source may record what one of
// its records represents and the resulting measurement evidence. Defining the
// counted unit is the organization's factual input; it approves nothing and
// the evidence stays GK-review-gated.
const SOURCE_MEASUREMENT_ALLOWED_ROLES = __evidenceLineageServiceContract.EVIDENCE_LINEAGE_ALLOWED_ROLES;
const SOURCE_MEASUREMENT_OPERATION = "record_source_record_count_measurement";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNormalizedNow(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isRecordInput(value) {
  const allowedKeys = new Set(["organizationId", "sourceVersionId", "definition", "worksheetKey", "actorContext", "now"]);
  return isPlainObject(value)
    && Object.keys(value).every((key) => allowedKeys.has(key))
    && isNonEmptyString(value.organizationId)
    && isNonEmptyString(value.sourceVersionId)
    && isPlainObject(value.actorContext)
    && isNormalizedNow(value.now);
}

// One admission for the write and the read-only basis: a mapped human with
// the P2-01 extraction authority in this organization, before any read.
function admitMeasurementActor(actorContext, organizationId) {
  if (actorContext?.actorType !== "human" || !isNonEmptyString(actorContext?.actorUserId)) {
    return buildKaiError("authorization_denied");
  }
  const auth = validateActorCanPerformOperation(actorContext, SOURCE_MEASUREMENT_OPERATION, organizationId, {
    allowedRoles: SOURCE_MEASUREMENT_ALLOWED_ROLES,
  });
  if (!auth.ok) return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
  });
  if (tenant.severity === "blocker") return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  return null;
}

async function createDefaultRepository() {
  const { createPostgresSourceMeasurementRepository } = await import("../dictionary/postgresSourceMeasurementRepository.js");
  return createPostgresSourceMeasurementRepository();
}

/**
 * KAI P2-01M: record a human definition of what one data record of a promoted,
 * current source version represents, and the record-count measurement KAI
 * derives deterministically from that version's committed P1 profile (no
 * model, no raw file read, no row-level data persisted). The measurement
 * becomes internal-only, GK-review-gated `source_record_count_measurement`
 * evidence with a whole-version locator; nothing is approved, and no claim,
 * gap, or client follow-up is created here. Without a complete definition
 * nothing is written and the structured blocker names what is missing.
 */
export async function recordSourceRecordCountMeasurement(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) return buildKaiError("feature_disabled");
  if (!isRecordInput(input)) return buildKaiError("validation_blocker");

  const { actorContext } = input;
  const denied = admitMeasurementActor(actorContext, input.organizationId);
  if (denied) return denied;

  const definition = validateRecordCountDefinition(input.definition);
  if (!definition.ok) return buildKaiError(definition.code, { blockers: definition.blockers });

  const repository = dependencies.sourceMeasurementRepository || (await createDefaultRepository());
  const result = await repository.recordSourceRecordCountMeasurement({
    organizationId: input.organizationId,
    sourceVersionId: input.sourceVersionId,
    definition: definition.definition,
    worksheetKey: input.worksheetKey ?? null,
    actorUserId: actorContext.actorUserId,
    now: input.now,
  });
  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      ...(Array.isArray(result.error.blockers) ? { blockers: result.error.blockers } : {}),
    });
  }
  return { ok: true, data: result.data, error: null };
}

/**
 * Read-only basis for recording the measurement (Plan A Prompt 8): the
 * authoritative profile counts and calculation for the exact promoted,
 * current, permitted version (or the structured reason it cannot be
 * measured), and any definition, measurement, limitations, and claim already
 * recorded for it. Same admission as the write; writes nothing.
 */
export async function getSourceRecordCountMeasurementBasis(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) return buildKaiError("feature_disabled");
  const allowedKeys = new Set(["organizationId", "sourceVersionId", "worksheetKey", "actorContext"]);
  if (!isPlainObject(input) || !Object.keys(input).every((key) => allowedKeys.has(key))
    || !["organizationId", "sourceVersionId", "actorContext"].every((key) => Object.hasOwn(input, key))
    || !isNonEmptyString(input.organizationId) || !isNonEmptyString(input.sourceVersionId) || !isPlainObject(input.actorContext)) {
    return buildKaiError("validation_blocker");
  }
  const denied = admitMeasurementActor(input.actorContext, input.organizationId);
  if (denied) return denied;
  const repository = dependencies.sourceMeasurementRepository || (await createDefaultRepository());
  const result = await repository.readSourceRecordCountMeasurementBasis({
    organizationId: input.organizationId,
    sourceVersionId: input.sourceVersionId,
    worksheetKey: input.worksheetKey ?? null,
  });
  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      ...(Array.isArray(result.error.blockers) ? { blockers: result.error.blockers } : {}),
    });
  }
  return { ok: true, data: result.data, error: null };
}

export const __sourceMeasurementServiceContract = Object.freeze({
  SOURCE_MEASUREMENT_OPERATION,
  SOURCE_MEASUREMENT_ALLOWED_ROLES,
});
