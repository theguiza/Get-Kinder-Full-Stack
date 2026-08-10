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
