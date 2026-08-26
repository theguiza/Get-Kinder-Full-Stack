  import {
    areKaiSprint2GenerationFeaturesEnabled,
    isKaiSprint2Enabled,
    isKaiGenerationEnabled,
  } from "../config/kaiSprint2Config.js";
  import { buildKaiError } from "../errors/kaiErrors.js";
  import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
  import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";

  const GENERATED_CONTENT_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
  const GENERATED_CONTENT_REVIEW_ALLOWED_ROLES = new Set(["gk_admin", "gk_reviewer"]);
  const COMPLETE_GENERATED_CONTENT_REVIEW_ALLOWED_ROLES = new Set(["gk_reviewer", "gk_admin"]);
  const CREATE_EVIDENCE_SUMMARY_OPERATION = "create_evidence_summary_draft";
  const CREATE_IMPACT_NARRATIVE_OPERATION = "create_impact_narrative_draft";
  const GET_GENERATED_DRAFT_REVIEW_PACKET_OPERATION = "get_generated_draft_review_packet";
  const START_GENERATED_CONTENT_REVIEW_OPERATION = "start_generated_content_review";
  const COMPLETE_GENERATED_CONTENT_REVIEW_OPERATION = "complete_generated_content_review";
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const AUDIENCES = new Set(["internal", "funder", "public"]);
  const ALLOWED_GENERATED_CONTENT_TYPES = new Set(["evidence_summary", "impact_narrative"]);

  function hasExactKeys(value, allowed) {
    return Boolean(value)
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.keys(value).length === allowed.size
      && Object.keys(value).every((key) => allowed.has(key));
  }

  function isCreateEvidenceSummaryDraftInput(input) {
    if (!hasExactKeys(input, new Set(["organizationId", "requestedAudience", "claimIds", "idempotencyKey", "actorContext", "now"]))) {
      return false;
    }
    let normalizedNow = null;
    try {
      normalizedNow = new Date(input.now).toISOString();
    } catch {
      return false;
    }
    return UUID_PATTERN.test(input.organizationId)
      && AUDIENCES.has(input.requestedAudience)
      && Array.isArray(input.claimIds)
      && input.claimIds.length >= 1
      && input.claimIds.every((claimId) => typeof claimId === "string" && UUID_PATTERN.test(claimId))
      && input.claimIds.length === new Set(input.claimIds).size
      && input.claimIds.every((claimId, index, arr) => index === 0 || arr[index - 1] < claimId)
      && typeof input.idempotencyKey === "string"
      && input.idempotencyKey === input.idempotencyKey.trim()
      && /^[ -~]{8,128}$/.test(input.idempotencyKey)
      && Boolean(input.actorContext)
      && typeof input.actorContext === "object"
      && !Array.isArray(input.actorContext)
      && typeof input.now === "string"
      && normalizedNow === input.now;
  }

  function isCreateImpactNarrativeDraftInput(input) {
    return isCreateEvidenceSummaryDraftInput(input) && input.requestedAudience === "internal";
  }

  function isMappedHumanActor(actorContext) {
    return actorContext?.actorType === "human"
      && typeof actorContext?.actorUserId === "string"
      && actorContext.actorUserId.length > 0;
  }

  function isGeneratedDraftReviewPacketInput(input) {
    return hasExactKeys(input, new Set(["organizationId", "generatedContentDraftId", "actorContext"]))
      && UUID_PATTERN.test(input.organizationId)
      && UUID_PATTERN.test(input.generatedContentDraftId)
      && Boolean(input.actorContext)
      && typeof input.actorContext === "object"
      && !Array.isArray(input.actorContext);
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

  function isCompleteGeneratedContentReviewInput(input) {
    return hasExactKeys(input, new Set([
      "organizationId",
      "generatedContentDraftId",
      "reviewQueueItemId",
      "expectedUpdatedAt",
      "actorContext",
      "now",
    ]))
      && UUID_PATTERN.test(input.organizationId)
      && UUID_PATTERN.test(input.generatedContentDraftId)
      && UUID_PATTERN.test(input.reviewQueueItemId)
      && isCanonicalUtcTimestamp(input.expectedUpdatedAt)
      && isCanonicalUtcTimestamp(input.now)
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

  export async function createEvidenceSummaryDraft(input, dependencies = {}) {
    const env = dependencies.env || process.env;
    if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
    if (!isKaiGenerationEnabled(env) || !areKaiSprint2GenerationFeaturesEnabled(env)) {
      return buildKaiError("feature_disabled");
    }
    if (!isCreateEvidenceSummaryDraftInput(input)) {
      return buildKaiError("validation_blocker");
    }
    if (!isMappedHumanActor(input.actorContext)) {
      return buildKaiError("authorization_denied");
    }

    const auth = validateActorCanPerformOperation(
      input.actorContext,
      CREATE_EVIDENCE_SUMMARY_OPERATION,
      input.organizationId,
      { allowedRoles: GENERATED_CONTENT_ALLOWED_ROLES },
    );
    if (!auth.ok) {
      return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
    }

    const tenant = validateTenantBoundaryConsistency({
      expectedOrganizationId: input.organizationId,
      payload: { organization_id: input.organizationId },
    });
    if (tenant.severity === "blocker") {
      return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
    }

    const repository =
      dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
    const result = await repository.createEvidenceSummaryDraft(input, {
      draftGenerator: dependencies.draftGenerator,
      metadataOnlyAudit: dependencies.metadataOnlyAudit,
    });
    if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status });
    return { ok: true, data: result.data, error: null };
  }

  export async function createImpactNarrativeDraft(input, dependencies = {}) {
    const env = dependencies.env || process.env;
    if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
    if (!isKaiGenerationEnabled(env) || !areKaiSprint2GenerationFeaturesEnabled(env)) {
      return buildKaiError("feature_disabled");
    }
    if (!isCreateImpactNarrativeDraftInput(input)) {
      return buildKaiError("validation_blocker");
    }
    if (!isMappedHumanActor(input.actorContext)) {
      return buildKaiError("authorization_denied");
    }

    const auth = validateActorCanPerformOperation(
      input.actorContext,
      CREATE_IMPACT_NARRATIVE_OPERATION,
      input.organizationId,
      { allowedRoles: GENERATED_CONTENT_ALLOWED_ROLES },
    );
    if (!auth.ok) {
      return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
    }

    const tenant = validateTenantBoundaryConsistency({
      expectedOrganizationId: input.organizationId,
      payload: { organization_id: input.organizationId },
    });
    if (tenant.severity === "blocker") {
      return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
    }

    const repository =
      dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
    const result = await repository.createImpactNarrativeDraft(input, {
      draftGenerator: dependencies.draftGenerator,
      metadataOnlyAudit: dependencies.metadataOnlyAudit,
    });
    if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status });
    return { ok: true, data: result.data, error: null };
  }

  const PACKET_KEYS = new Set([
    "generationRunId",
    "generatedContentDraftId",
    "contentType",
    "draftStatus",
    "requestedAudience",
    "reviewQueueItemId",
    "queueStatus",
    "reviewStatus",
    "reviewUpdatedAt",
    "currentUseEligible",
    "blocks",
  ]);
  const BLOCK_KEYS = new Set(["ordinal", "text", "citations"]);
  const CITATION_KEYS = new Set([
    "claimId",
    "evidenceItemId",
    "sourceId",
    "sourceVersionId",
    "supportStrength",
    "claimReviewStatus",
    "evidenceReviewStatus",
    "currentEligible",
    "blockerCodes",
    "affectedDimensionKeys",
    "affectedObjectIds",
  ]);

  function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
  }

  function isGeneratedDraftReviewPacketDto(data) {
    if (!hasExactKeys(data, PACKET_KEYS)) return false;
    if (!UUID_PATTERN.test(data.generationRunId)) return false;
    if (!UUID_PATTERN.test(data.generatedContentDraftId)) return false;
    if (!ALLOWED_GENERATED_CONTENT_TYPES.has(data.contentType)) return false;
    if (data.draftStatus !== "draft") return false;
    if (!AUDIENCES.has(data.requestedAudience)) return false;
    if (!UUID_PATTERN.test(data.reviewQueueItemId)) return false;
    if (![
      "open/needs_gk_review",
      "in_progress/needs_gk_review",
      "resolved/resolved",
    ].includes(`${data.queueStatus}/${data.reviewStatus}`)) return false;
    if (!isCanonicalUtcTimestamp(data.reviewUpdatedAt)) return false;
    if (typeof data.currentUseEligible !== "boolean") return false;
    if (!Array.isArray(data.blocks) || data.blocks.length < 1 || data.blocks.length > 20) return false;
    for (const [index, block] of data.blocks.entries()) {
      if (!hasExactKeys(block, BLOCK_KEYS)) return false;
      if (block.ordinal !== index + 1) return false;
      if (typeof block.text !== "string" || block.text.length < 1 || block.text.length > 4000) return false;
      if (!Array.isArray(block.citations) || block.citations.length < 1) return false;
      for (const citation of block.citations) {
        if (!hasExactKeys(citation, CITATION_KEYS)) return false;
        if (!UUID_PATTERN.test(citation.claimId) || !UUID_PATTERN.test(citation.evidenceItemId)) return false;
        if (!UUID_PATTERN.test(citation.sourceId) || !UUID_PATTERN.test(citation.sourceVersionId)) return false;
        if (typeof citation.supportStrength !== "string") return false;
        if (typeof citation.claimReviewStatus !== "string" || typeof citation.evidenceReviewStatus !== "string") return false;
        if (typeof citation.currentEligible !== "boolean") return false;
        if (!isStringArray(citation.blockerCodes)) return false;
        if (!isStringArray(citation.affectedDimensionKeys)) return false;
        if (!isStringArray(citation.affectedObjectIds)) return false;
      }
    }
    return true;
  }

  export async function getGeneratedDraftReviewPacket(input, dependencies = {}) {
    const env = dependencies.env || process.env;
    if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
    if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
    if (!isGeneratedDraftReviewPacketInput(input)) return buildKaiError("validation_blocker", { data: null });
    if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

    const auth = validateActorCanPerformOperation(
      input.actorContext,
      GET_GENERATED_DRAFT_REVIEW_PACKET_OPERATION,
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

    const repository =
      dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
    const result = await repository.getGeneratedDraftReviewPacket({
      organizationId: input.organizationId,
      generatedContentDraftId: input.generatedContentDraftId,
    });
    if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });
    if (!isGeneratedDraftReviewPacketDto(result.data)) return buildKaiError("system_error", { data: null });
    return { ok: true, data: result.data, error: null };
  }

  export async function startGeneratedContentReview(input, dependencies = {}) {
    const env = dependencies.env || process.env;
    if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
    if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
    if (!isCompleteGeneratedContentReviewInput(input)) return buildKaiError("validation_blocker", { data: null });
    if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

    const auth = validateActorCanPerformOperation(
      input.actorContext,
      START_GENERATED_CONTENT_REVIEW_OPERATION,
      input.organizationId,
      { allowedRoles: COMPLETE_GENERATED_CONTENT_REVIEW_ALLOWED_ROLES },
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

    const repository =
      dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
    const result = await repository.startGeneratedContentReview(input, {
      metadataOnlyAudit: dependencies.metadataOnlyAudit,
    });
    if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });
    return { ok: true, data: result.data, error: null };
  }

  export async function completeGeneratedContentReview(input, dependencies = {}) {
    const env = dependencies.env || process.env;
    if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
    if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
    if (!isCompleteGeneratedContentReviewInput(input)) return buildKaiError("validation_blocker", { data: null });
    if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

    const auth = validateActorCanPerformOperation(
      input.actorContext,
      COMPLETE_GENERATED_CONTENT_REVIEW_OPERATION,
      input.organizationId,
      { allowedRoles: COMPLETE_GENERATED_CONTENT_REVIEW_ALLOWED_ROLES },
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

    const repository =
      dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
    const result = await repository.completeGeneratedContentReview(input, {
      metadataOnlyAudit: dependencies.metadataOnlyAudit,
    });
    if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });
    return { ok: true, data: result.data, error: null };
  }

  export const __generatedContentServiceContract = Object.freeze({
    GENERATED_CONTENT_ALLOWED_ROLES,
    GENERATED_CONTENT_REVIEW_ALLOWED_ROLES,
    COMPLETE_GENERATED_CONTENT_REVIEW_ALLOWED_ROLES,
    CREATE_EVIDENCE_SUMMARY_OPERATION,
    CREATE_IMPACT_NARRATIVE_OPERATION,
    GET_GENERATED_DRAFT_REVIEW_PACKET_OPERATION,
    START_GENERATED_CONTENT_REVIEW_OPERATION,
    COMPLETE_GENERATED_CONTENT_REVIEW_OPERATION,
    ALLOWED_GENERATED_CONTENT_TYPES,
  });

  export const __generatedContentReviewPacketServiceTestables = Object.freeze({
    isGeneratedDraftReviewPacketDto,
    isGeneratedDraftReviewPacketInput,
  });

  export const __completeGeneratedContentReviewServiceTestables = Object.freeze({
    isCompleteGeneratedContentReviewInput,
    isMappedHumanActor,
  });
