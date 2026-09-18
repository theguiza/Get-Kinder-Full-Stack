import { isKaiSprint2Enabled, isKaiGenerationEnabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { resolveAuthorizedHumanRole } from "../auth/kaiAuthorizedRoleAttribution.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_TYPES,
  roleRequiredForBoardReportingCandidateHumanAuthorityDecisionType,
} from "../dictionary/boardReportingCandidateHumanAuthorityDecisionContract.js";

// ---------------------------------------------------------------------------
// BR-04: governed human final-release authority application for a Board
// Reporting candidate - the Board-level analogue of the existing P3-17
// kaiHumanAuthorityDecisionService.js and P14-07
// kaiGrantResponsePacketHumanFinalReleaseAuthorityService.js, structurally
// mirrored (feature flags, exact-keys input, gk_admin-only authorization,
// tenant boundary check, then a single delegation to the repository),
// wrapped around the new BR-04
// postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js. This
// file creates no persistence of its own and does not duplicate that
// repository's binding/replay/supersession/effectiveness logic. Recording a
// decision here grants only the same "human final-release authority"
// concept P3-17/P14-07 already grant for their own object - no
// final-eligibility evaluation, no Board manifest, and no Board
// file/artifact is produced by this file.
//
// Unlike P3-17 (which additionally accepts a client-supplied
// requestedAudience), a Board Reporting candidate's audience is always
// exactly "internal" - so this service accepts no requestedAudience at all.
// Unlike P14-07B1 (which recomposes a packet render-model fingerprint to
// prove currentness), a Board Reporting candidate is immutable once created
// and its release-authority precondition is instead that the caller's own
// bound reviewQueueItemId names a 'board_reporting_candidate_review' queue
// row that is already resolved (BR-03B COMPLETE) - so this service accepts
// a reviewQueueItemId, which neither P3-17 nor P14-07 accept at all.
// ---------------------------------------------------------------------------

const FINAL_RELEASE_AUTHORITY_DECISION_TYPE = BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_TYPES[0];
const RECORD_BOARD_REPORTING_CANDIDATE_HUMAN_FINAL_RELEASE_AUTHORITY_OPERATION =
  "record_board_reporting_candidate_human_final_release_authority_decision";
const RECORD_BOARD_REPORTING_CANDIDATE_HUMAN_FINAL_RELEASE_AUTHORITY_ROLES = new Set([
  roleRequiredForBoardReportingCandidateHumanAuthorityDecisionType(FINAL_RELEASE_AUTHORITY_DECISION_TYPE),
]);
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
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

// Exact-keys input contract: organizationId + engagementId +
// boardReportingCandidateId + reviewQueueItemId + decisionAction +
// actorContext + now, and NOTHING else. In particular, no fingerprint,
// members, memberCount, review state, eligibility, authority state, or
// manifest identity is ever accepted from a caller - actorContext/now are
// always server/route-derived, never client-supplied.
function isRecordBoardReportingCandidateHumanFinalReleaseAuthorityInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "boardReportingCandidateId",
    "reviewQueueItemId",
    "decisionAction",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.boardReportingCandidateId)
    && UUID_PATTERN.test(input.reviewQueueItemId)
    && ["grant", "revoke"].includes(input.decisionAction)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

async function createDefaultBoardReportingCandidateHumanAuthorityDecisionRepository() {
  const { createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository } = await import(
    "../dictionary/postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js"
  );
  return createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository();
}

export async function recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isRecordBoardReportingCandidateHumanFinalReleaseAuthorityInput(input)) {
    return buildKaiError("validation_blocker", { data: null });
  }
  // An assistant/system actorContext is refused here (before any repository
  // call) - only a mapped human actor may ever reach the gk_admin
  // authorization check below.
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    RECORD_BOARD_REPORTING_CANDIDATE_HUMAN_FINAL_RELEASE_AUTHORITY_OPERATION,
    input.organizationId,
    { allowedRoles: RECORD_BOARD_REPORTING_CANDIDATE_HUMAN_FINAL_RELEASE_AUTHORITY_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const decidedByRole = resolveAuthorizedHumanRole({
    actorContext: input.actorContext,
    auth,
    allowedRoles: RECORD_BOARD_REPORTING_CANDIDATE_HUMAN_FINAL_RELEASE_AUTHORITY_ROLES,
  });
  if (!decidedByRole) {
    return buildKaiError("validation_blocker", { data: null });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant], data: null });
  }

  const repository =
    dependencies.boardReportingCandidateHumanAuthorityDecisionRepository
    || (await createDefaultBoardReportingCandidateHumanAuthorityDecisionRepository());
  const result = await repository.recordDecision({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
    boardReportingCandidateId: input.boardReportingCandidateId,
    reviewQueueItemId: input.reviewQueueItemId,
    decisionType: FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
    decisionAction: input.decisionAction,
    actorContext: input.actorContext,
    decidedByRole,
    now: input.now,
  }, {
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });

  // Explicit allowlist projection - never a passthrough spread - so the
  // public DTO is pinned by construction. Metadata-only: no manifest, no
  // packet bytes, and no candidate/member content is ever produced or
  // returned here.
  const data = {
    boardReportingCandidateId: result.data.boardReportingCandidateId,
    decisionType: result.data.decisionType,
    decisionAction: result.data.decisionAction,
    effective: result.data.effective,
    effectivenessReason: result.data.effectivenessReason,
    replayed: result.data.replayed,
    decisionId: result.data.decisionId,
    supersedesDecisionId: result.data.supersedesDecisionId,
    decidedByRole: result.data.decidedByRole,
    headDecisionId: result.data.headDecisionId,
  };

  return { ok: true, data, error: null };
}

export const __boardReportingCandidateHumanFinalReleaseAuthorityServiceContract = Object.freeze({
  FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
  RECORD_BOARD_REPORTING_CANDIDATE_HUMAN_FINAL_RELEASE_AUTHORITY_OPERATION,
  RECORD_BOARD_REPORTING_CANDIDATE_HUMAN_FINAL_RELEASE_AUTHORITY_ROLES,
});

export const __boardReportingCandidateHumanFinalReleaseAuthorityServiceTestables = Object.freeze({
  isRecordBoardReportingCandidateHumanFinalReleaseAuthorityInput,
  isMappedHumanActor,
});
