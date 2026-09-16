import { isKaiSprint2Enabled, isKaiGenerationEnabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { __generatedContentServiceContract, __generatedContentReviewPacketServiceTestables } from "./kaiGeneratedContentService.js";
import { __exportReviewServiceContract, __exportReviewServiceTestables } from "./kaiExportReviewService.js";

const {
  GENERATED_CONTENT_REVIEW_ALLOWED_ROLES,
  PROJECT_EXPORT_REVIEW_VISIBILITY_OPERATION,
} = __generatedContentServiceContract;
const { isGeneratedDraftReviewPacketDto } = __generatedContentReviewPacketServiceTestables;
const { EXPORT_REVIEW_ALLOWED_ROLES } = __exportReviewServiceContract;
// Reuses the exact P3-20 export-manifest-history shape/validator the
// single-draft export-review packet already exposes - no second manifest
// vocabulary invented for the Grant Response Packet.
const { isExportManifestHistoryDto } = __exportReviewServiceTestables;

// Deliberately reuses the exact single-draft review-packet operation/role
// gate (GENERATED_CONTENT_REVIEW_ALLOWED_ROLES, gk_admin/gk_reviewer) - a
// Grant Response Packet is a read-only regrouping of the same governed
// per-draft packets an actor with that authority can already read one at a
// time, never a broader or narrower authority surface.
const GET_GRANT_RESPONSE_PACKET_OPERATION = "get_grant_response_packet";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

function isGetGrantResponsePacketInput(input) {
  return Boolean(input)
    && typeof input === "object"
    && !Array.isArray(input)
    && Object.keys(input).length === 3
    && Object.keys(input).every((key) => key === "organizationId" || key === "engagementId" || key === "actorContext")
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

async function createDefaultGeneratedContentRepository() {
  const { createPostgresGeneratedContentRepository } = await import(
    "../dictionary/postgresGeneratedContentRepository.js"
  );
  return createPostgresGeneratedContentRepository();
}

async function createDefaultGrantResponsePacketExportCandidateRepository() {
  const { createPostgresGrantResponsePacketExportCandidateRepository } = await import(
    "../dictionary/postgresGrantResponsePacketExportCandidateRepository.js"
  );
  return createPostgresGrantResponsePacketExportCandidateRepository();
}

async function createDefaultGrantResponsePacketHumanAuthorityDecisionRepository() {
  const { createPostgresGrantResponsePacketHumanAuthorityDecisionRepository } = await import(
    "../dictionary/postgresGrantResponsePacketHumanAuthorityDecisionRepository.js"
  );
  return createPostgresGrantResponsePacketHumanAuthorityDecisionRepository();
}

// P14-08C: read-only packet-manifest state lookup, reusing the exact,
// already-proven P14-08A repository's resolveExportManifestStateForCandidate
// - no new manifest read/selection logic is added here.
async function createDefaultGrantResponsePacketExportManifestRepository() {
  const { createPostgresGrantResponsePacketExportManifestRepository } = await import(
    "../dictionary/postgresGrantResponsePacketExportManifestRepository.js"
  );
  return createPostgresGrantResponsePacketExportManifestRepository();
}

async function defaultEvaluateGrantResponsePacketFinalExportEligibility(input, dependencies) {
  const { evaluateGrantResponsePacketFinalExportEligibility } = await import(
    "./kaiGrantResponsePacketFinalExportEligibilityGateService.js"
  );
  return evaluateGrantResponsePacketFinalExportEligibility(input, dependencies);
}

async function composeCurrentGrantResponsePacketRenderModel(packet) {
  const { composeGrantResponsePacketRenderModelFromPacket } = await import(
    "./kaiGrantResponsePacketRenderModelService.js"
  );
  return composeGrantResponsePacketRenderModelFromPacket(packet);
}

// The composite grants no approval/finalization authority of its own - it
// is a read-only regrouping of drafts each already individually eligible
// per the existing single-draft review-packet contract
// (isGeneratedDraftReviewPacketDto), never a second packet-shape
// vocabulary. Membership order is exactly the repository's deterministic
// generated_content_draft_id ASC order - never re-sorted here.
//
// Export/reuse foundation: each member additionally carries exportManifestId
// / exportManifestHistory - the exact P3-20 durable-read recovery
// (loadExportManifestIdentityForReviewQueueItemInTransaction /
// loadExportManifestHistoryForReviewQueueItemInTransaction) the single-draft
// export-review packet already exposes, reused unmodified. This grants no
// new export/finalization authority: it only lets an actor who can already
// see a member's export-review state (exportReviewVisible) also see which
// already-governed single-draft export manifest(s), if any, that member's
// own export-review history has produced - so the existing single-draft
// Markdown/CSV/PDF/DOCX render/export routes
// (/export-manifests/:exportManifestId/{markdown,csv,pdf,docx}) can be
// reached per member without inventing a second, composite manifest
// identity. Nulled/emptied whenever exportReviewVisible is false, exactly
// like the other export-review-scoped fields above.
function projectPacketDraft(packet, exportReviewVisible) {
  const exportManifestId = exportReviewVisible ? (packet.exportManifestId ?? null) : null;
  const exportManifestHistory = exportReviewVisible ? (packet.exportManifestHistory ?? []) : [];
  if (!(exportManifestId === null || UUID_PATTERN.test(exportManifestId))) return null;
  if (!isExportManifestHistoryDto(exportManifestHistory)) return null;

  const projected = {
    ...packet,
    exportReviewQueueItemId: exportReviewVisible ? packet.exportReviewQueueItemId : null,
    exportReviewQueueStatus: exportReviewVisible ? packet.exportReviewQueueStatus : null,
    exportReviewStatus: exportReviewVisible ? packet.exportReviewStatus : null,
  };
  delete projected.exportManifestId;
  delete projected.exportManifestHistory;
  if (!isGeneratedDraftReviewPacketDto(projected)) return null;
  return { ...projected, exportManifestId, exportManifestHistory, exportReviewVisible };
}

// P14-08C: minimum safe packet-manifest read state for the exact current
// candidate the packet DTO already resolved above - grantResponsePacketExportManifestId
// + createdAt only (never raw authority rows, fingerprint, or effective-
// authority-decision internals), and never a latest/newest/preferred
// selection - the array is exactly the P14-08A repository's own
// created_at-ASC presentation order over every manifest bound to this exact
// candidate.
function isFinalDeliveryStateDto(value) {
  if (value === null) return true;
  if (!(Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === 2
    && Object.keys(value).every((key) => key === "grantResponsePacketExportManifests" || key === "finalMarkdownAvailable")
    && Array.isArray(value.grantResponsePacketExportManifests)
    && typeof value.finalMarkdownAvailable === "boolean")) {
    return false;
  }
  if (value.finalMarkdownAvailable !== (value.grantResponsePacketExportManifests.length > 0)) return false;
  return value.grantResponsePacketExportManifests.every((manifest) => (
    Boolean(manifest)
    && typeof manifest === "object"
    && !Array.isArray(manifest)
    && Object.keys(manifest).length === 2
    && Object.keys(manifest).every((key) => key === "grantResponsePacketExportManifestId" || key === "createdAt")
    && UUID_PATTERN.test(manifest.grantResponsePacketExportManifestId)
    && typeof manifest.createdAt === "string"
    && !Number.isNaN(Date.parse(manifest.createdAt))
  ));
}

function isGrantResponsePacketDto(data) {
  if (!(Boolean(data)
    && typeof data === "object"
    && !Array.isArray(data)
    && Object.keys(data).length === 15
    && Object.keys(data).every((key) => (
      key === "organizationId"
      || key === "engagementId"
      || key === "packetAudience"
      || key === "drafts"
      || key === "exportReviewVisible"
      || key === "grantResponsePacketExportCandidateId"
      || key === "reviewQueueItemId"
      || key === "queueStatus"
      || key === "reviewStatus"
      || key === "reviewUpdatedAt"
      || key === "finalReleaseAuthorityEffective"
      || key === "finalReleaseAuthorityReason"
      || key === "finalExportEligible"
      || key === "finalExportEligibilityBlockedReasons"
      || key === "finalDeliveryState"
    ))
    && isFinalDeliveryStateDto(data.finalDeliveryState)
    && UUID_PATTERN.test(data.organizationId)
    && UUID_PATTERN.test(data.engagementId)
    && data.packetAudience === "funder"
    && typeof data.exportReviewVisible === "boolean"
    && (
      data.grantResponsePacketExportCandidateId === null
      || UUID_PATTERN.test(data.grantResponsePacketExportCandidateId)
    )
    && (
      data.reviewQueueItemId === null
      || UUID_PATTERN.test(data.reviewQueueItemId)
    )
    && (data.queueStatus === null || ["open", "in_progress", "resolved"].includes(data.queueStatus))
    && (data.reviewStatus === null || ["needs_gk_review", "resolved"].includes(data.reviewStatus))
    && (
      data.reviewUpdatedAt === null
      || (typeof data.reviewUpdatedAt === "string" && !Number.isNaN(Date.parse(data.reviewUpdatedAt)))
    )
    && (data.finalReleaseAuthorityEffective === null || typeof data.finalReleaseAuthorityEffective === "boolean")
    && (data.finalReleaseAuthorityReason === null || typeof data.finalReleaseAuthorityReason === "string")
    && (data.finalExportEligible === null || typeof data.finalExportEligible === "boolean")
    && (
      data.finalExportEligibilityBlockedReasons === null
      || (Array.isArray(data.finalExportEligibilityBlockedReasons)
        && data.finalExportEligibilityBlockedReasons.every((reason) => typeof reason === "string"))
    )
    && Array.isArray(data.drafts))) {
    return false;
  }
  if (!data.exportReviewVisible) {
    if (data.grantResponsePacketExportCandidateId !== null) return false;
    if (data.reviewQueueItemId !== null) return false;
    if (data.queueStatus !== null) return false;
    if (data.reviewStatus !== null) return false;
    if (data.reviewUpdatedAt !== null) return false;
    if (data.finalDeliveryState !== null) return false;
  }
  if (data.grantResponsePacketExportCandidateId === null) {
    if (data.reviewQueueItemId !== null) return false;
    if (data.queueStatus !== null) return false;
    if (data.reviewStatus !== null) return false;
    if (data.reviewUpdatedAt !== null) return false;
    if (data.finalReleaseAuthorityEffective !== null) return false;
    if (data.finalReleaseAuthorityReason !== null) return false;
    if (data.finalExportEligible !== null) return false;
    if (data.finalExportEligibilityBlockedReasons !== null) return false;
    if (data.finalDeliveryState !== null) return false;
  } else {
    if (typeof data.finalReleaseAuthorityEffective !== "boolean") return false;
    if (typeof data.finalExportEligible !== "boolean") return false;
    if (!Array.isArray(data.finalExportEligibilityBlockedReasons)) return false;
  }
  if (data.reviewQueueItemId === null) {
    if (data.queueStatus !== null) return false;
    if (data.reviewStatus !== null) return false;
    if (data.reviewUpdatedAt !== null) return false;
  }
  if (data.queueStatus === "open" && data.reviewStatus !== "needs_gk_review") return false;
  if (data.queueStatus === "in_progress" && data.reviewStatus !== "needs_gk_review") return false;
  if (data.queueStatus === "resolved" && data.reviewStatus !== "resolved") return false;
  for (const draft of data.drafts) {
    if (!(Boolean(draft)
      && typeof draft === "object"
      && !Array.isArray(draft)
      && typeof draft.exportReviewVisible === "boolean"
      && (
        draft.exportManifestId === null
        || UUID_PATTERN.test(draft.exportManifestId)
      )
      && isExportManifestHistoryDto(draft.exportManifestHistory))) {
      return false;
    }
    const { exportManifestId, exportManifestHistory, exportReviewVisible, ...singleDraftPacket } = draft;
    if (!isGeneratedDraftReviewPacketDto(singleDraftPacket)) return false;
  }
  return true;
}

export async function getGrantResponsePacket(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isGetGrantResponsePacketInput(input)) return buildKaiError("validation_blocker", { data: null });
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    GET_GRANT_RESPONSE_PACKET_OPERATION,
    input.organizationId,
    {
      allowedRoles: GENERATED_CONTENT_REVIEW_ALLOWED_ROLES,
      combineGlobalRoles: true,
    },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant], data: null });
  }

  const exportReviewAuth = validateActorCanPerformOperation(
    input.actorContext,
    PROJECT_EXPORT_REVIEW_VISIBILITY_OPERATION,
    input.organizationId,
    { allowedRoles: EXPORT_REVIEW_ALLOWED_ROLES },
  );
  const exportReviewVisible = exportReviewAuth.ok;

  const repository =
    dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
  const result = await repository.getGrantResponsePacket({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
  });
  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      blockers: result.blockers,
      message: result.blockers?.[0]?.message,
      data: null,
    });
  }

  const drafts = [];
  for (const packet of result.data.drafts) {
    const projected = projectPacketDraft(packet, exportReviewVisible);
    if (!projected) return buildKaiError("system_error", { data: null });
    drafts.push(projected);
  }

  let currentExportCandidateReviewState = {
    grantResponsePacketExportCandidateId: null,
    reviewQueueItemId: null,
    queueStatus: null,
    reviewStatus: null,
    reviewUpdatedAt: null,
  };
  // P14-07: final-release authority state/effectiveness and final-export
  // eligibility PASS/BLOCKED for the exact current candidate above - null
  // whenever no exportReviewVisible actor, or no current candidate exists,
  // mirroring the existing review-state null-linkage exactly. Computed from
  // the SAME already-composed authoritative render model/candidate state
  // below - never a second fingerprint/membership recomputation, and never
  // exposes the raw validatorResult object (object_type/object_id/message)
  // this package's evaluator produces internally.
  let finalReleaseAuthorityEffective = null;
  let finalReleaseAuthorityReason = null;
  let finalExportEligible = null;
  let finalExportEligibilityBlockedReasons = null;
  // P14-08C: minimum safe packet-manifest read state for the exact current
  // candidate above - null whenever no exportReviewVisible actor or no
  // current candidate exists, mirroring the existing null-linkage exactly.
  // Reuses the already-proven P14-08A
  // resolveExportManifestStateForCandidate exact-candidate lookup verbatim -
  // never a latest/newest/preferred manifest selection.
  let finalDeliveryState = null;
  if (exportReviewVisible) {
    const currentRenderModel = await composeCurrentGrantResponsePacketRenderModel({
      organizationId: result.data.organizationId,
      engagementId: result.data.engagementId,
      packetAudience: result.data.packetAudience,
      exportReviewVisible,
      grantResponsePacketExportCandidateId: null,
      reviewQueueItemId: null,
      queueStatus: null,
      reviewStatus: null,
      reviewUpdatedAt: null,
      finalReleaseAuthorityEffective: null,
      finalReleaseAuthorityReason: null,
      finalExportEligible: null,
      finalExportEligibilityBlockedReasons: null,
      finalDeliveryState: null,
      drafts,
    });
    if (!currentRenderModel) return buildKaiError("system_error", { data: null });
    const candidateRepository = dependencies.grantResponsePacketExportCandidateRepository
      || (await createDefaultGrantResponsePacketExportCandidateRepository());
    const composeRenderModelForCurrentState = dependencies.composeRenderModel
      || (async () => ({ ok: true, data: currentRenderModel, error: null }));
    const candidateStateResult = await candidateRepository.readCurrentGrantResponsePacketExportCandidateReviewState({
      organizationId: input.organizationId,
      engagementId: input.engagementId,
      actorContext: input.actorContext,
    }, {
      composeRenderModel: composeRenderModelForCurrentState,
      renderModelDependencies: dependencies.renderModelDependencies,
    });
    if (!candidateStateResult.ok) {
      return buildKaiError(candidateStateResult.error.code, {
        status: candidateStateResult.error.status,
        data: null,
      });
    }
    currentExportCandidateReviewState = {
      grantResponsePacketExportCandidateId: candidateStateResult.data.grantResponsePacketExportCandidateId,
      reviewQueueItemId: candidateStateResult.data.reviewQueueItemId,
      queueStatus: candidateStateResult.data.queueStatus,
      reviewStatus: candidateStateResult.data.reviewStatus,
      reviewUpdatedAt: candidateStateResult.data.reviewUpdatedAt,
    };

    if (currentExportCandidateReviewState.grantResponsePacketExportCandidateId) {
      const authorityRepository = dependencies.grantResponsePacketHumanAuthorityDecisionRepository
        || (await createDefaultGrantResponsePacketHumanAuthorityDecisionRepository());
      const evaluateEligibility = dependencies.evaluateGrantResponsePacketFinalExportEligibility
        || defaultEvaluateGrantResponsePacketFinalExportEligibility;
      const eligibilityResult = await evaluateEligibility({
        organizationId: input.organizationId,
        engagementId: input.engagementId,
        grantResponsePacketExportCandidateId: currentExportCandidateReviewState.grantResponsePacketExportCandidateId,
        actorContext: input.actorContext,
      }, {
        candidateRepository,
        authorityRepository,
        composeRenderModel: composeRenderModelForCurrentState,
        renderModelDependencies: dependencies.renderModelDependencies,
      });
      if (!eligibilityResult.ok) {
        return buildKaiError(eligibilityResult.error.code, {
          status: eligibilityResult.error.status,
          data: null,
        });
      }
      finalReleaseAuthorityEffective = eligibilityResult.data.effectiveHumanExportAuthority;
      finalReleaseAuthorityReason = eligibilityResult.data.effectivenessReason;
      finalExportEligible = eligibilityResult.data.finalExportEligible;
      finalExportEligibilityBlockedReasons = Array.isArray(eligibilityResult.data.validatorResult?.evidence?.failed_gates)
        ? eligibilityResult.data.validatorResult.evidence.failed_gates
        : [];

      const manifestRepository = dependencies.grantResponsePacketExportManifestRepository
        || (await createDefaultGrantResponsePacketExportManifestRepository());
      const manifestStateResult = await manifestRepository.resolveExportManifestStateForCandidate({
        organizationId: input.organizationId,
        grantResponsePacketExportCandidateId: currentExportCandidateReviewState.grantResponsePacketExportCandidateId,
      });
      if (!manifestStateResult.ok) {
        return buildKaiError(manifestStateResult.error.code, {
          status: manifestStateResult.error.status,
          data: null,
        });
      }
      const grantResponsePacketExportManifests = manifestStateResult.data.manifests.map((manifest) => ({
        grantResponsePacketExportManifestId: manifest.grantResponsePacketExportManifestId,
        createdAt: manifest.createdAt,
      }));
      finalDeliveryState = {
        grantResponsePacketExportManifests,
        finalMarkdownAvailable: grantResponsePacketExportManifests.length > 0,
      };
    }
  }

  const data = {
    organizationId: result.data.organizationId,
    engagementId: result.data.engagementId,
    packetAudience: result.data.packetAudience,
    exportReviewVisible,
    ...currentExportCandidateReviewState,
    finalReleaseAuthorityEffective,
    finalReleaseAuthorityReason,
    finalExportEligible,
    finalExportEligibilityBlockedReasons,
    finalDeliveryState,
    drafts,
  };
  if (!isGrantResponsePacketDto(data)) return buildKaiError("system_error", { data: null });

  return {
    ok: true,
    data,
    error: null,
  };
}

export const __grantResponsePacketServiceContract = Object.freeze({
  GET_GRANT_RESPONSE_PACKET_OPERATION,
  GENERATED_CONTENT_REVIEW_ALLOWED_ROLES,
});

export const __grantResponsePacketServiceTestables = Object.freeze({
  isGetGrantResponsePacketInput,
  isMappedHumanActor,
  isGrantResponsePacketDto,
  projectPacketDraft,
});
