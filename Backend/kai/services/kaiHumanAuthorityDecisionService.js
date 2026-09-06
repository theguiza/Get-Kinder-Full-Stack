import {
  isKaiGenerationEnabled,
  isKaiPublicExportEnabled,
  isKaiSprint2Enabled,
} from "../config/kaiSprint2Config.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { roleRequiredForDecisionType } from "../dictionary/humanAuthorityDecisionContract.js";
import { buildKaiError } from "../errors/kaiErrors.js";

const FINAL_RELEASE_AUTHORITY_DECISION_TYPE = "export_authority_granted";
const FINAL_RELEASE_AUTHORITY_OPERATION = "record_human_final_release_authority_decision";
const FINAL_RELEASE_AUTHORITY_ROLES = new Set([
  roleRequiredForDecisionType(FINAL_RELEASE_AUTHORITY_DECISION_TYPE),
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REQUESTED_AUDIENCES = new Set(["internal", "funder", "public"]);

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

function isRecordHumanFinalReleaseAuthorityInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "exportCandidateId",
    "requestedAudience",
    "decisionAction",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.exportCandidateId)
    && REQUESTED_AUDIENCES.has(input.requestedAudience)
    && ["grant", "revoke"].includes(input.decisionAction)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

async function createDefaultHumanAuthorityDecisionRepository() {
  const { createPostgresHumanAuthorityDecisionRepository } = await import(
    "../dictionary/postgresHumanAuthorityDecisionRepository.js"
  );
  return createPostgresHumanAuthorityDecisionRepository();
}

export async function recordHumanFinalReleaseAuthorityDecision(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isRecordHumanFinalReleaseAuthorityInput(input)) return buildKaiError("validation_blocker", { data: null });
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    FINAL_RELEASE_AUTHORITY_OPERATION,
    input.organizationId,
    { allowedRoles: FINAL_RELEASE_AUTHORITY_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const repository =
    dependencies.humanAuthorityDecisionRepository || (await createDefaultHumanAuthorityDecisionRepository());
  const result = await repository.recordDecision({
    organizationId: input.organizationId,
    exportCandidateId: input.exportCandidateId,
    decisionType: FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
    decisionAction: input.decisionAction,
    requestedAudience: input.requestedAudience,
    actorContext: input.actorContext,
    now: input.now,
  }, {
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });
  return { ok: true, data: result.data, error: null };
}

export const __humanAuthorityDecisionServiceContract = Object.freeze({
  FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
  FINAL_RELEASE_AUTHORITY_OPERATION,
  FINAL_RELEASE_AUTHORITY_ROLES,
});

export const __humanAuthorityDecisionServiceTestables = Object.freeze({
  isRecordHumanFinalReleaseAuthorityInput,
  isMappedHumanActor,
});
