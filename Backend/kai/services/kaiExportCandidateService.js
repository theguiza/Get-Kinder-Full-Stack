import {
  isKaiSprint2Enabled,
  isKaiGenerationEnabled,
  isKaiPublicExportEnabled,
} from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import {
  LIMITATION_SNAPSHOT_ALLOWED_ROLES,
  EXPORT_CANDIDATE_ALLOWED_ROLES,
  isLimitationCodeSet,
} from "../dictionary/exportCandidateContract.js";

const LIMITATION_SNAPSHOT_ROLES = new Set(LIMITATION_SNAPSHOT_ALLOWED_ROLES);
const EXPORT_CANDIDATE_ROLES = new Set(EXPORT_CANDIDATE_ALLOWED_ROLES);
const CONFIRM_LIMITATION_SNAPSHOT_OPERATION = "confirm_generated_draft_limitation_snapshot";
const CREATE_EXPORT_CANDIDATE_OPERATION = "create_generated_draft_export_candidate";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// repository.confirmLimitationSnapshot fails closed with a bare
// { code: "validation_blocker", reason } for several distinct internal
// checks (input shape, missing audit dependency, an actor whose
// organization role can't be resolved into a confirmed_by_role, a cited-pair
// set that changed between the read and the write, or entries that don't
// exactly cover the persisted cited pairs). Every one of those is a genuine
// validation failure the caller needs to be able to act on, so each reason
// maps to a populated structured blocker here rather than surfacing as an
// empty blockers array.
const CONFIRM_LIMITATION_SNAPSHOT_BLOCKER_DETAIL = Object.freeze({
  invalid_confirm_input_shape: {
    message: "The limitation snapshot confirmation request was malformed.",
    required_fix: "Resend the request with organizationId, generatedContentDraftId, actorContext, and now populated as expected.",
  },
  missing_metadata_only_audit_dependency: {
    message: "The limitation snapshot confirmation could not be recorded because its audit dependency is unavailable.",
    required_fix: "Retry the request; if this persists, the service is missing its metadataOnlyAudit wiring.",
  },
  confirmed_by_role_not_derivable: {
    message: "The confirming actor does not hold an active organization role permitted to confirm a limitation snapshot.",
    required_fix: "Grant the confirming actor an active gk_reviewer or gk_admin membership in this organization.",
  },
  no_cited_pairs: {
    message: "This generated content draft has no cited claim/evidence pairs to snapshot.",
    required_fix: "Add at least one claim/evidence citation to the draft before confirming a limitation snapshot.",
  },
  entries_do_not_match_cited_pairs: {
    message: "The limitation snapshot entries do not exactly match the draft's currently persisted cited claim/evidence pairs.",
    required_fix: "Re-read the draft's current cited pairs and resubmit entries that cover them exactly, with no additions or omissions.",
  },
});

function buildConfirmLimitationSnapshotValidationBlocker(reason, input) {
  const detail = CONFIRM_LIMITATION_SNAPSHOT_BLOCKER_DETAIL[reason] || {
    message: "The limitation snapshot confirmation failed validation.",
    required_fix: "Review the request and retry.",
  };
  return {
    validator_key: "VAL-EXP-CAND-002",
    severity: "blocker",
    object_type: "generated_content_draft",
    object_code: input.generatedContentDraftId,
    object_id: input.generatedContentDraftId,
    message: detail.message,
    blocking_reason: reason || "validation_failed",
    required_fix: detail.required_fix,
    evidence: {},
  };
}

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  let normalized = null;
  try {
    normalized = new Date(value).toISOString();
  } catch {
    return false;
  }
  return normalized === value;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

function isConfirmLimitationSnapshotInput(input) {
  if (!hasExactKeys(input, new Set([
    "organizationId",
    "generatedContentDraftId",
    "entries",
    "actorContext",
    "now",
  ]))) return false;
  if (!UUID_PATTERN.test(input.organizationId) || !UUID_PATTERN.test(input.generatedContentDraftId)) return false;
  if (!Array.isArray(input.entries) || input.entries.length < 1) return false;
  const entryKeys = new Set(["claimId", "evidenceItemId", "limitationCodes"]);
  for (const entry of input.entries) {
    if (!hasExactKeys(entry, entryKeys)) return false;
    if (!UUID_PATTERN.test(entry.claimId) || !UUID_PATTERN.test(entry.evidenceItemId)) return false;
    if (!isLimitationCodeSet(entry.limitationCodes)) return false;
  }
  return Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

function isCreateExportCandidateInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "generatedContentDraftId",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.generatedContentDraftId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

async function createDefaultExportCandidateRepository() {
  const { createPostgresExportCandidateRepository } = await import(
    "../dictionary/postgresExportCandidateRepository.js"
  );
  return createPostgresExportCandidateRepository();
}

export async function confirmGeneratedDraftLimitationSnapshot(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isConfirmLimitationSnapshotInput(input)) return buildKaiError("validation_blocker", { data: null });
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    CONFIRM_LIMITATION_SNAPSHOT_OPERATION,
    input.organizationId,
    { allowedRoles: LIMITATION_SNAPSHOT_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const repository =
    dependencies.exportCandidateRepository || (await createDefaultExportCandidateRepository());
  const result = await repository.confirmLimitationSnapshot(input, {
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });
  return { ok: true, data: result.data, error: null };
}

// Phase-14: generic confirmation entry point for the existing
// confirmGeneratedDraftLimitationSnapshot capability. The browser never
// curates claim/evidence/limitation-code entries here - entries are derived
// server-side, exclusively from the draft's own persisted citation pairs
// (loadCitedPairsForDraft), each with an empty limitationCodes array. This
// reuses the existing limitation-snapshot entry contract exactly (isLimitationCodeSet
// accepts an empty array) and delegates to the unmodified
// repository.confirmLimitationSnapshot for every currentness/fingerprint/
// audit/authority check - this function adds no new semantics of its own.
export async function confirmGeneratedDraftLimitationSnapshotFromCitedPairs(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isCreateExportCandidateInput(input)) return buildKaiError("validation_blocker", { data: null });
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    CONFIRM_LIMITATION_SNAPSHOT_OPERATION,
    input.organizationId,
    { allowedRoles: LIMITATION_SNAPSHOT_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const repository =
    dependencies.exportCandidateRepository || (await createDefaultExportCandidateRepository());

  const citedPairsResult = await repository.loadCitedPairsForDraft(input);
  if (!citedPairsResult.ok) {
    return buildKaiError(citedPairsResult.error.code, { status: citedPairsResult.error.status, data: null });
  }
  if (citedPairsResult.data.citedPairs.length === 0) {
    return buildKaiError("validation_blocker", {
      data: null,
      blockers: [
        {
          validator_key: "VAL-EXP-CAND-001",
          severity: "blocker",
          object_type: "generated_content_draft",
          object_code: input.generatedContentDraftId,
          object_id: input.generatedContentDraftId,
          message: "This generated content draft has no cited claim/evidence pairs to snapshot.",
          blocking_reason: "no_cited_pairs",
          required_fix: "Add at least one claim/evidence citation to the draft before confirming a limitation snapshot.",
          evidence: {},
        },
      ],
    });
  }

  const entries = citedPairsResult.data.citedPairs.map((pair) => ({
    claimId: pair.claimId,
    evidenceItemId: pair.evidenceItemId,
    limitationCodes: [],
  }));

  const result = await repository.confirmLimitationSnapshot({
    organizationId: input.organizationId,
    generatedContentDraftId: input.generatedContentDraftId,
    entries,
    actorContext: input.actorContext,
    now: input.now,
  }, {
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });
  if (!result.ok) {
    if (result.error.code === "validation_blocker") {
      return buildKaiError("validation_blocker", {
        status: result.error.status,
        data: null,
        blockers: [buildConfirmLimitationSnapshotValidationBlocker(result.error.reason, input)],
      });
    }
    return buildKaiError(result.error.code, { status: result.error.status, data: null });
  }
  return { ok: true, data: result.data, error: null };
}

export async function createGeneratedDraftExportCandidate(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isCreateExportCandidateInput(input)) return buildKaiError("validation_blocker", { data: null });
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    CREATE_EXPORT_CANDIDATE_OPERATION,
    input.organizationId,
    { allowedRoles: EXPORT_CANDIDATE_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const repository =
    dependencies.exportCandidateRepository || (await createDefaultExportCandidateRepository());
  const result = await repository.createExportCandidate(input, {
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });
  return { ok: true, data: result.data, error: null };
}

export const __exportCandidateServiceContract = Object.freeze({
  LIMITATION_SNAPSHOT_ROLES,
  EXPORT_CANDIDATE_ROLES,
  CONFIRM_LIMITATION_SNAPSHOT_OPERATION,
  CREATE_EXPORT_CANDIDATE_OPERATION,
});

export const __exportCandidateServiceTestables = Object.freeze({
  isConfirmLimitationSnapshotInput,
  isCreateExportCandidateInput,
  isMappedHumanActor,
});
