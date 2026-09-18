import { isKaiSprint2Enabled, isKaiGenerationEnabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { resolveAuthorizedHumanRole } from "../auth/kaiAuthorizedRoleAttribution.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_TYPES,
  roleRequiredForGrantResponsePacketHumanAuthorityDecisionType,
} from "../dictionary/grantResponsePacketHumanAuthorityDecisionContract.js";

// ---------------------------------------------------------------------------
// P14-07: governed human final-release authority application for a Grant
// Response Packet export candidate - the packet-level analogue of the
// existing P3-17 kaiHumanAuthorityDecisionService.js, structurally mirrored
// (feature flags, exact-keys input, gk_admin-only authorization, tenant
// boundary check, then a single delegation to the repository), wrapped
// around the existing P14-07B1
// postgresGrantResponsePacketHumanAuthorityDecisionRepository.js. This file
// creates no persistence of its own and does not duplicate B1's
// replay/supersession/effectiveness logic. Recording a decision here grants
// only the same "human final-release authority" concept P3-17 already
// grants for a single draft - no final-eligibility evaluation, no packet
// manifest, and no final packet bytes are produced by this file.
//
// Unlike P3-17 (which additionally accepts a client-supplied
// requestedAudience, since a single draft's export audience varies), a
// Grant Response Packet's audience is always exactly "funder" - so this
// service accepts no requestedAudience at all, matching the exact
// B1 repository contract.
// ---------------------------------------------------------------------------

const FINAL_RELEASE_AUTHORITY_DECISION_TYPE = GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_TYPES[0];
const RECORD_GRANT_RESPONSE_PACKET_HUMAN_FINAL_RELEASE_AUTHORITY_OPERATION =
  "record_grant_response_packet_human_final_release_authority_decision";
const RECORD_GRANT_RESPONSE_PACKET_HUMAN_FINAL_RELEASE_AUTHORITY_ROLES = new Set([
  roleRequiredForGrantResponsePacketHumanAuthorityDecisionType(FINAL_RELEASE_AUTHORITY_DECISION_TYPE),
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

// Exact-keys input contract: organizationId + engagementId +
// grantResponsePacketExportCandidateId + decisionAction + actorContext + now,
// and NOTHING else. In particular, no fingerprint, members, memberCount,
// review state, eligibility, authority state, requestedAudience, or manifest
// identity is ever accepted from a caller - actorContext/now are always
// server/route-derived, never client-supplied.
function isRecordGrantResponsePacketHumanFinalReleaseAuthorityInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "grantResponsePacketExportCandidateId",
    "decisionAction",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.grantResponsePacketExportCandidateId)
    && ["grant", "revoke"].includes(input.decisionAction)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

async function createDefaultGrantResponsePacketHumanAuthorityDecisionRepository() {
  const { createPostgresGrantResponsePacketHumanAuthorityDecisionRepository } = await import(
    "../dictionary/postgresGrantResponsePacketHumanAuthorityDecisionRepository.js"
  );
  return createPostgresGrantResponsePacketHumanAuthorityDecisionRepository();
}

export async function recordGrantResponsePacketHumanFinalReleaseAuthorityDecision(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isRecordGrantResponsePacketHumanFinalReleaseAuthorityInput(input)) {
    return buildKaiError("validation_blocker", { data: null });
  }
  // An assistant/system actorContext is refused here (before any repository
  // call) - only a mapped human actor may ever reach the gk_admin
  // authorization check below.
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    RECORD_GRANT_RESPONSE_PACKET_HUMAN_FINAL_RELEASE_AUTHORITY_OPERATION,
    input.organizationId,
    { allowedRoles: RECORD_GRANT_RESPONSE_PACKET_HUMAN_FINAL_RELEASE_AUTHORITY_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const decidedByRole = resolveAuthorizedHumanRole({
    actorContext: input.actorContext,
    auth,
    allowedRoles: RECORD_GRANT_RESPONSE_PACKET_HUMAN_FINAL_RELEASE_AUTHORITY_ROLES,
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
    dependencies.grantResponsePacketHumanAuthorityDecisionRepository
    || (await createDefaultGrantResponsePacketHumanAuthorityDecisionRepository());
  const result = await repository.recordDecision({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
    grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
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
  // public DTO is pinned by construction. Metadata-only: no manifest or
  // packet-bytes identity is ever produced or returned here.
  const data = {
    grantResponsePacketExportCandidateId: result.data.grantResponsePacketExportCandidateId,
    decisionType: result.data.decisionType,
    decisionAction: result.data.decisionAction,
    effective: result.data.effective,
    effectivenessReason: result.data.effectivenessReason,
    replayed: result.data.replayed,
  };

  return { ok: true, data, error: null };
}

export const __grantResponsePacketHumanFinalReleaseAuthorityServiceContract = Object.freeze({
  FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
  RECORD_GRANT_RESPONSE_PACKET_HUMAN_FINAL_RELEASE_AUTHORITY_OPERATION,
  RECORD_GRANT_RESPONSE_PACKET_HUMAN_FINAL_RELEASE_AUTHORITY_ROLES,
});

export const __grantResponsePacketHumanFinalReleaseAuthorityServiceTestables = Object.freeze({
  isRecordGrantResponsePacketHumanFinalReleaseAuthorityInput,
  isMappedHumanActor,
});
