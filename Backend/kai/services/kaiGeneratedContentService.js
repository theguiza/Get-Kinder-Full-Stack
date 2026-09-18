  import {
    areKaiSprint2GenerationFeaturesEnabled,
    isKaiSprint2Enabled,
    isKaiGenerationEnabled,
  } from "../config/kaiSprint2Config.js";
  import { buildKaiError } from "../errors/kaiErrors.js";
  import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
  import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
  import { getEngagementForOrganization } from "../db/kaiQueries.js";
  import { EXPORT_REVIEW_LIFECYCLE_PROFILES } from "../dictionary/exportReviewQueueContract.js";
  import { __exportReviewServiceContract } from "./kaiExportReviewService.js";
  import { listOrganizationRequirementsReadiness } from "./kaiRequirementAssessmentService.js";

  const { EXPORT_REVIEW_ALLOWED_ROLES } = __exportReviewServiceContract;

  const GENERATED_CONTENT_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
  const GENERATED_CONTENT_REVIEW_ALLOWED_ROLES = new Set(["gk_admin", "gk_reviewer"]);
  const COMPLETE_GENERATED_CONTENT_REVIEW_ALLOWED_ROLES = new Set(["gk_reviewer", "gk_admin"]);
  const CREATE_EVIDENCE_SUMMARY_OPERATION = "create_evidence_summary_draft";
  const CREATE_IMPACT_NARRATIVE_OPERATION = "create_impact_narrative_draft";
  const CREATE_READINESS_ASSESSMENT_OPERATION = "create_readiness_assessment_draft";
  const CREATE_DATA_GAP_MEMO_OPERATION = "create_data_gap_memo_draft";
  const CREATE_CASE_FOR_SUPPORT_OPERATION = "create_case_for_support_draft";
  const CREATE_BOARD_UPDATE_OPERATION = "create_board_update_draft";
  const CREATE_ANNUAL_REPORT_SECTION_OPERATION = "create_annual_report_section_draft";
  const GET_GENERATED_DRAFT_REVIEW_PACKET_OPERATION = "get_generated_draft_review_packet";
  // Determines only whether the actor may see the export-review identity/
  // state this same read projects (below) - the identical role gate
  // kaiExportReviewService.js's own read/request/start/complete export-
  // review operations already enforce (gk_admin only, no combineGlobalRoles).
  // This is deliberately NOT the operation gating the read itself (that
  // remains GENERATED_CONTENT_REVIEW_ALLOWED_ROLES, unchanged) - it only
  // decides which of the two allowlisted DTO shapes below is returned.
  const PROJECT_EXPORT_REVIEW_VISIBILITY_OPERATION = "project_export_review_visibility_on_generated_draft_packet";
  const START_GENERATED_CONTENT_REVIEW_OPERATION = "start_generated_content_review";
  const COMPLETE_GENERATED_CONTENT_REVIEW_OPERATION = "complete_generated_content_review";
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const AUDIENCES = new Set(["internal", "funder", "public"]);
  const ALLOWED_GENERATED_CONTENT_TYPES = new Set(["evidence_summary", "impact_narrative", "readiness_assessment", "data_gap_memo", "case_for_support", "board_update", "annual_report_section"]);
  // P13-EXT-1: case_for_support is generation-time restricted to internal +
  // funder only - public is never an allowed requestedAudience for this
  // content type, rejected here at the service-level input validator (the
  // same fail-closed layer isCreateImpactNarrativeDraftInput/
  // isCreateReadinessAssessmentDraftInput/isCreateDataGapMemoDraftInput
  // already use to narrow evidence_summary's broader {internal, funder,
  // public} shape). All audiences remain subject to the existing claim-level
  // audience-authority gates (approvalForAudience / VAL-GEN-005) - this is
  // purely an input-shape restriction, not a new audience-authority
  // mechanism.
  const CASE_FOR_SUPPORT_AUDIENCES = new Set(["internal", "funder"]);
  const DATA_GAP_MEMO_GENERATION_CLAIM_LIMIT = 20;

  function hasExactKeys(value, allowed) {
    return Boolean(value)
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.keys(value).length === allowed.size
      && Object.keys(value).every((key) => allowed.has(key));
  }

  function isCreateEvidenceSummaryDraftInput(input) {
    if (!hasExactKeys(input, new Set(["organizationId", "engagementId", "requestedAudience", "claimIds", "idempotencyKey", "actorContext", "now"]))) {
      return false;
    }
    let normalizedNow = null;
    try {
      normalizedNow = new Date(input.now).toISOString();
    } catch {
      return false;
    }
    return UUID_PATTERN.test(input.organizationId)
      && UUID_PATTERN.test(input.engagementId)
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

  function isCreateReadinessAssessmentDraftInput(input) {
    return isCreateEvidenceSummaryDraftInput(input) && input.requestedAudience === "internal";
  }

  function isCreateDataGapMemoDraftInput(input) {
    if (!hasExactKeys(input, new Set(["organizationId", "engagementId", "requestedAudience", "idempotencyKey", "actorContext", "now"]))) {
      return false;
    }
    return isCreateEvidenceSummaryDraftInput({ ...input, claimIds: ["00000000-0000-4000-8000-000000000001"] })
      && input.requestedAudience === "internal";
  }

  function isCreateCaseForSupportDraftInput(input) {
    return isCreateEvidenceSummaryDraftInput(input) && CASE_FOR_SUPPORT_AUDIENCES.has(input.requestedAudience);
  }

  // P13-EXT-2: board_update is generation-time restricted to "internal"
  // only - funder and public are never allowed requestedAudience values for
  // this content type, mirroring isCreateImpactNarrativeDraftInput/
  // isCreateReadinessAssessmentDraftInput/isCreateDataGapMemoDraftInput's
  // internal-only shape above (not case_for_support's broader
  // internal+funder shape).
  function isCreateBoardUpdateDraftInput(input) {
    return isCreateEvidenceSummaryDraftInput(input) && input.requestedAudience === "internal";
  }

  function isCreateAnnualReportSectionDraftInput(input) {
    return isCreateEvidenceSummaryDraftInput(input);
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

    const readEngagement = dependencies.getEngagementForOrganization || getEngagementForOrganization;
    const engagementRecord = await readEngagement({
      organizationId: input.organizationId,
      engagementId: input.engagementId,
    });

    const tenant = validateTenantBoundaryConsistency({
      expectedOrganizationId: input.organizationId,
      payload: { organization_id: input.organizationId, engagement_id: input.engagementId },
      engagementRecord,
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
    if (!result.ok) {
      return buildKaiError(result.error.code, {
        status: result.error.status,
        ...(result.blockers ? { blockers: result.blockers } : {}),
      });
    }
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

    const readEngagement = dependencies.getEngagementForOrganization || getEngagementForOrganization;
    const engagementRecord = await readEngagement({
      organizationId: input.organizationId,
      engagementId: input.engagementId,
    });

    const tenant = validateTenantBoundaryConsistency({
      expectedOrganizationId: input.organizationId,
      payload: { organization_id: input.organizationId, engagement_id: input.engagementId },
      engagementRecord,
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
    if (!result.ok) {
      return buildKaiError(result.error.code, {
        status: result.error.status,
        ...(result.blockers ? { blockers: result.blockers } : {}),
      });
    }
    return { ok: true, data: result.data, error: null };
  }

  export async function createReadinessAssessmentDraft(input, dependencies = {}) {
    const env = dependencies.env || process.env;
    if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
    if (!isKaiGenerationEnabled(env) || !areKaiSprint2GenerationFeaturesEnabled(env)) {
      return buildKaiError("feature_disabled");
    }
    if (!isCreateReadinessAssessmentDraftInput(input)) {
      return buildKaiError("validation_blocker");
    }
    if (!isMappedHumanActor(input.actorContext)) {
      return buildKaiError("authorization_denied");
    }

    const auth = validateActorCanPerformOperation(
      input.actorContext,
      CREATE_READINESS_ASSESSMENT_OPERATION,
      input.organizationId,
      { allowedRoles: GENERATED_CONTENT_ALLOWED_ROLES },
    );
    if (!auth.ok) {
      return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
    }

    const readEngagement = dependencies.getEngagementForOrganization || getEngagementForOrganization;
    const engagementRecord = await readEngagement({
      organizationId: input.organizationId,
      engagementId: input.engagementId,
    });

    const tenant = validateTenantBoundaryConsistency({
      expectedOrganizationId: input.organizationId,
      payload: { organization_id: input.organizationId, engagement_id: input.engagementId },
      engagementRecord,
    });
    if (tenant.severity === "blocker") {
      return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
    }

    const readReadiness = dependencies.listOrganizationRequirementsReadiness || listOrganizationRequirementsReadiness;
    const readinessResult = await readReadiness(
      { organizationId: input.organizationId, actorContext: input.actorContext },
      dependencies.requirementsReadinessDependencies ? {
        ...dependencies.requirementsReadinessDependencies,
        env,
      } : { env },
    );
    if (!readinessResult.ok) {
      return buildKaiError(readinessResult.error.code, {
        status: readinessResult.error.status,
        ...(readinessResult.blockers ? { blockers: readinessResult.blockers } : {}),
      });
    }

    const repository =
      dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
    const result = await repository.createReadinessAssessmentDraft(input, {
      draftGenerator: dependencies.draftGenerator,
      metadataOnlyAudit: dependencies.metadataOnlyAudit,
      authoritativeReadiness: readinessResult.data,
    });
    if (!result.ok) {
      return buildKaiError(result.error.code, {
        status: result.error.status,
        ...(result.blockers ? { blockers: result.blockers } : {}),
      });
    }
    return { ok: true, data: result.data, error: null };
  }

  export async function createCaseForSupportDraft(input, dependencies = {}) {
    const env = dependencies.env || process.env;
    if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
    if (!isKaiGenerationEnabled(env) || !areKaiSprint2GenerationFeaturesEnabled(env)) {
      return buildKaiError("feature_disabled");
    }
    if (!isCreateCaseForSupportDraftInput(input)) {
      return buildKaiError("validation_blocker");
    }
    if (!isMappedHumanActor(input.actorContext)) {
      return buildKaiError("authorization_denied");
    }

    const auth = validateActorCanPerformOperation(
      input.actorContext,
      CREATE_CASE_FOR_SUPPORT_OPERATION,
      input.organizationId,
      { allowedRoles: GENERATED_CONTENT_ALLOWED_ROLES },
    );
    if (!auth.ok) {
      return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
    }

    const readEngagement = dependencies.getEngagementForOrganization || getEngagementForOrganization;
    const engagementRecord = await readEngagement({
      organizationId: input.organizationId,
      engagementId: input.engagementId,
    });

    const tenant = validateTenantBoundaryConsistency({
      expectedOrganizationId: input.organizationId,
      payload: { organization_id: input.organizationId, engagement_id: input.engagementId },
      engagementRecord,
    });
    if (tenant.severity === "blocker") {
      return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
    }

    const repository =
      dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
    const result = await repository.createCaseForSupportDraft(input, {
      draftGenerator: dependencies.draftGenerator,
      metadataOnlyAudit: dependencies.metadataOnlyAudit,
    });
    if (!result.ok) {
      return buildKaiError(result.error.code, {
        status: result.error.status,
        ...(result.blockers ? { blockers: result.blockers } : {}),
      });
    }
    return { ok: true, data: result.data, error: null };
  }

  export async function createBoardUpdateDraft(input, dependencies = {}) {
    const env = dependencies.env || process.env;
    if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
    if (!isKaiGenerationEnabled(env) || !areKaiSprint2GenerationFeaturesEnabled(env)) {
      return buildKaiError("feature_disabled");
    }
    if (!isCreateBoardUpdateDraftInput(input)) {
      return buildKaiError("validation_blocker");
    }
    if (!isMappedHumanActor(input.actorContext)) {
      return buildKaiError("authorization_denied");
    }

    const auth = validateActorCanPerformOperation(
      input.actorContext,
      CREATE_BOARD_UPDATE_OPERATION,
      input.organizationId,
      { allowedRoles: GENERATED_CONTENT_ALLOWED_ROLES },
    );
    if (!auth.ok) {
      return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
    }

    const readEngagement = dependencies.getEngagementForOrganization || getEngagementForOrganization;
    const engagementRecord = await readEngagement({
      organizationId: input.organizationId,
      engagementId: input.engagementId,
    });

    const tenant = validateTenantBoundaryConsistency({
      expectedOrganizationId: input.organizationId,
      payload: { organization_id: input.organizationId, engagement_id: input.engagementId },
      engagementRecord,
    });
    if (tenant.severity === "blocker") {
      return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
    }

    const repository =
      dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
    const result = await repository.createBoardUpdateDraft(input, {
      draftGenerator: dependencies.draftGenerator,
      metadataOnlyAudit: dependencies.metadataOnlyAudit,
    });
    if (!result.ok) {
      return buildKaiError(result.error.code, {
        status: result.error.status,
        ...(result.blockers ? { blockers: result.blockers } : {}),
      });
    }
    return { ok: true, data: result.data, error: null };
  }

  export async function createAnnualReportSectionDraft(input, dependencies = {}) {
    const env = dependencies.env || process.env;
    if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
    if (!isKaiGenerationEnabled(env) || !areKaiSprint2GenerationFeaturesEnabled(env)) {
      return buildKaiError("feature_disabled");
    }
    if (!isCreateAnnualReportSectionDraftInput(input)) {
      return buildKaiError("validation_blocker");
    }
    if (!isMappedHumanActor(input.actorContext)) {
      return buildKaiError("authorization_denied");
    }

    const auth = validateActorCanPerformOperation(
      input.actorContext,
      CREATE_ANNUAL_REPORT_SECTION_OPERATION,
      input.organizationId,
      { allowedRoles: GENERATED_CONTENT_ALLOWED_ROLES },
    );
    if (!auth.ok) {
      return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
    }

    const readEngagement = dependencies.getEngagementForOrganization || getEngagementForOrganization;
    const engagementRecord = await readEngagement({
      organizationId: input.organizationId,
      engagementId: input.engagementId,
    });

    const tenant = validateTenantBoundaryConsistency({
      expectedOrganizationId: input.organizationId,
      payload: { organization_id: input.organizationId, engagement_id: input.engagementId },
      engagementRecord,
    });
    if (tenant.severity === "blocker") {
      return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
    }

    const repository =
      dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
    const result = await repository.createAnnualReportSectionDraft(input, {
      draftGenerator: dependencies.draftGenerator,
      metadataOnlyAudit: dependencies.metadataOnlyAudit,
    });
    if (!result.ok) {
      return buildKaiError(result.error.code, {
        status: result.error.status,
        ...(result.blockers ? { blockers: result.blockers } : {}),
      });
    }
    return { ok: true, data: result.data, error: null };
  }

  function uniqueSortedClaimIdsFromGaps(items) {
    return [...new Set((items || []).map((item) => item.claim_id))].sort();
  }

  async function listCompleteAuthoritativeDataGaps({ organizationId, actorContext, env, readGaps, gapReadDependencies }) {
    const items = [];
    let afterGapLogItemId = null;
    do {
      const result = await readGaps({
        organizationId,
        limit: 25,
        afterGapLogItemId,
        actorContext,
      }, gapReadDependencies ? { ...gapReadDependencies, env } : { env });
      if (!result.ok) return result;
      items.push(...result.data.items);
      const claimIds = uniqueSortedClaimIdsFromGaps(items);
      if (claimIds.length > DATA_GAP_MEMO_GENERATION_CLAIM_LIMIT) {
        return buildKaiError("validation_blocker", {
          blockers: [{
            validator_key: "VAL-DGM-PAGE-001",
            severity: "blocker",
            blocking_reason: "data_gap_memo_generation_claim_bound_exceeded",
          }],
        });
      }
      afterGapLogItemId = result.data.truncated ? result.data.nextAfterGapLogItemId : null;
      if (result.data.truncated && !afterGapLogItemId) return buildKaiError("system_error");
    } while (afterGapLogItemId);

    if (items.length < 1) {
      return buildKaiError("validation_blocker", {
        blockers: [{
          validator_key: "VAL-DGM-PAGE-002",
          severity: "blocker",
          blocking_reason: "no_current_authoritative_data_gaps",
        }],
      });
    }

    return {
      ok: true,
      data: {
        items,
        claimIds: uniqueSortedClaimIdsFromGaps(items),
        truncated: false,
        nextAfterGapLogItemId: null,
      },
      error: null,
    };
  }

  export async function createDataGapMemoDraft(input, dependencies = {}) {
    const env = dependencies.env || process.env;
    if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
    if (!isKaiGenerationEnabled(env) || !areKaiSprint2GenerationFeaturesEnabled(env)) {
      return buildKaiError("feature_disabled");
    }
    if (!isCreateDataGapMemoDraftInput(input)) {
      return buildKaiError("validation_blocker");
    }
    if (!isMappedHumanActor(input.actorContext)) {
      return buildKaiError("authorization_denied");
    }

    const auth = validateActorCanPerformOperation(
      input.actorContext,
      CREATE_DATA_GAP_MEMO_OPERATION,
      input.organizationId,
      { allowedRoles: GENERATED_CONTENT_ALLOWED_ROLES },
    );
    if (!auth.ok) {
      return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
    }

    const readEngagement = dependencies.getEngagementForOrganization || getEngagementForOrganization;
    const engagementRecord = await readEngagement({
      organizationId: input.organizationId,
      engagementId: input.engagementId,
    });

    const tenant = validateTenantBoundaryConsistency({
      expectedOrganizationId: input.organizationId,
      payload: { organization_id: input.organizationId, engagement_id: input.engagementId },
      engagementRecord,
    });
    if (tenant.severity === "blocker") {
      return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
    }

    const readGaps = dependencies.listOrganizationEvidenceGapsForImpactLibrary || (await import("./kaiOrganizationEvidenceGapReadService.js")).listOrganizationEvidenceGapsForImpactLibrary;
    const gapResult = await listCompleteAuthoritativeDataGaps({
      organizationId: input.organizationId,
      actorContext: input.actorContext,
      env,
      readGaps,
      gapReadDependencies: dependencies.gapReadDependencies,
    });
    if (!gapResult.ok) return gapResult;

    const repository =
      dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
    const repositoryInput = {
      ...input,
      claimIds: gapResult.data.claimIds,
    };
    const result = await repository.createDataGapMemoDraft(repositoryInput, {
      draftGenerator: dependencies.draftGenerator,
      metadataOnlyAudit: dependencies.metadataOnlyAudit,
      authoritativeDataGaps: { items: gapResult.data.items },
    });
    if (!result.ok) {
      return buildKaiError(result.error.code, {
        status: result.error.status,
        ...(result.blockers ? { blockers: result.blockers } : {}),
      });
    }
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
    "exportReviewQueueItemId",
    "exportReviewQueueStatus",
    "exportReviewStatus",
    "blocks",
  ]);
  const BLOCK_KEYS = new Set(["ordinal", "text", "citations"]);
  const BLOCK_KEYS_WITH_ID = new Set(["generatedContentBlockId", ...BLOCK_KEYS]);
  const CITATION_KEYS = new Set([
    "claimId",
    "evidenceItemId",
    "sourceId",
    "sourceCode",
    "sourceVersionId",
    "supportStrength",
    "claimReviewStatus",
    "evidenceReviewStatus",
    "currentEligible",
    "blockerCodes",
    "affectedDimensionKeys",
    "affectedObjectIds",
    "approvedAudiences",
  ]);
  const CITATION_KEYS_WITH_ID = new Set(["generatedContentCitationId", ...CITATION_KEYS]);

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
    if (data.exportReviewQueueItemId === null) {
      if (data.exportReviewQueueStatus !== null || data.exportReviewStatus !== null) return false;
    } else {
      if (!UUID_PATTERN.test(data.exportReviewQueueItemId)) return false;
      if (!EXPORT_REVIEW_LIFECYCLE_PROFILES.some(
        (profile) => data.exportReviewQueueStatus === profile.queueStatus && data.exportReviewStatus === profile.reviewStatus,
      )) return false;
    }
    if (!Array.isArray(data.blocks) || data.blocks.length < 1 || data.blocks.length > 20) return false;
    for (const [index, block] of data.blocks.entries()) {
      const blockHasId = Object.prototype.hasOwnProperty.call(block, "generatedContentBlockId");
      if (!hasExactKeys(block, blockHasId ? BLOCK_KEYS_WITH_ID : BLOCK_KEYS)) return false;
      if (blockHasId && !UUID_PATTERN.test(block.generatedContentBlockId)) return false;
      if (block.ordinal !== index + 1) return false;
      if (typeof block.text !== "string" || block.text.length < 1 || block.text.length > 4000) return false;
      if (!Array.isArray(block.citations) || block.citations.length < 1) return false;
      for (const citation of block.citations) {
        const citationHasId = Object.prototype.hasOwnProperty.call(citation, "generatedContentCitationId");
        if (!hasExactKeys(citation, citationHasId ? CITATION_KEYS_WITH_ID : CITATION_KEYS)) return false;
        if (citationHasId && !UUID_PATTERN.test(citation.generatedContentCitationId)) return false;
        if (!UUID_PATTERN.test(citation.claimId) || !UUID_PATTERN.test(citation.evidenceItemId)) return false;
        if (!UUID_PATTERN.test(citation.sourceId) || !UUID_PATTERN.test(citation.sourceVersionId)) return false;
        if (citation.sourceCode !== null && typeof citation.sourceCode !== "string") return false;
        if (typeof citation.supportStrength !== "string") return false;
        if (typeof citation.claimReviewStatus !== "string" || typeof citation.evidenceReviewStatus !== "string") return false;
        if (typeof citation.currentEligible !== "boolean") return false;
        if (!isStringArray(citation.blockerCodes)) return false;
        if (!isStringArray(citation.affectedDimensionKeys)) return false;
        if (!isStringArray(citation.affectedObjectIds)) return false;
        // ALLOWED_AUDIENCE: the claim's current authoritative audience
        // approval, null when no decision (or no approved_audiences on the
        // decision) exists yet; otherwise a subset of the three known
        // audiences, never a client-supplied or generation-time value.
        if (citation.approvedAudiences !== null) {
          if (!isStringArray(citation.approvedAudiences)) return false;
          if (!citation.approvedAudiences.every((value) => AUDIENCES.has(value))) return false;
        }
      }
    }
    return true;
  }

  // Durable read recovery: the export-review identity/state toReviewPacket
  // now attaches is only ever surfaced to an actor who independently holds
  // export-review authority (the same EXPORT_REVIEW_ALLOWED_ROLES gate
  // kaiExportReviewService.js's own read/request/start/complete operations
  // enforce) - never to gk_reviewer, who may read this same packet but has
  // no export-review authority anywhere else in the accepted architecture.
  // When the actor lacks that authority, exportReviewVisible is false and
  // the three export-review fields are forced null - a distinct,
  // preserved "restricted" state, never conflated with the real "no export
  // review requested yet" absence.
  const PACKET_WITH_EXPORT_REVIEW_VISIBILITY_KEYS = new Set([...PACKET_KEYS, "exportReviewVisible"]);

  function isGeneratedDraftReviewPacketWithExportReviewVisibilityDto(data) {
    if (!hasExactKeys(data, PACKET_WITH_EXPORT_REVIEW_VISIBILITY_KEYS)) return false;
    if (typeof data.exportReviewVisible !== "boolean") return false;
    if (!data.exportReviewVisible) {
      if (data.exportReviewQueueItemId !== null || data.exportReviewQueueStatus !== null || data.exportReviewStatus !== null) {
        return false;
      }
    }
    const { exportReviewVisible, ...innerPacket } = data;
    return isGeneratedDraftReviewPacketDto(innerPacket);
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

    const exportReviewAuth = validateActorCanPerformOperation(
      input.actorContext,
      PROJECT_EXPORT_REVIEW_VISIBILITY_OPERATION,
      input.organizationId,
      { allowedRoles: EXPORT_REVIEW_ALLOWED_ROLES },
    );
    const exportReviewVisible = exportReviewAuth.ok;

    const repository =
      dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
    const result = await repository.getGeneratedDraftReviewPacket({
      organizationId: input.organizationId,
      generatedContentDraftId: input.generatedContentDraftId,
    });
    if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });
    if (!isGeneratedDraftReviewPacketDto(result.data)) return buildKaiError("system_error", { data: null });

    const projected = {
      ...result.data,
      exportReviewVisible,
      exportReviewQueueItemId: exportReviewVisible ? result.data.exportReviewQueueItemId : null,
      exportReviewQueueStatus: exportReviewVisible ? result.data.exportReviewQueueStatus : null,
      exportReviewStatus: exportReviewVisible ? result.data.exportReviewStatus : null,
    };
    if (!isGeneratedDraftReviewPacketWithExportReviewVisibilityDto(projected)) {
      return buildKaiError("system_error", { data: null });
    }
    return { ok: true, data: projected, error: null };
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
    if (!result.ok) {
      return buildKaiError(result.error.code, {
        status: result.error.status,
        blockers: result.blockers,
        data: null,
      });
    }
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
    CREATE_READINESS_ASSESSMENT_OPERATION,
    CREATE_DATA_GAP_MEMO_OPERATION,
    CREATE_CASE_FOR_SUPPORT_OPERATION,
    CREATE_BOARD_UPDATE_OPERATION,
    CREATE_ANNUAL_REPORT_SECTION_OPERATION,
    GET_GENERATED_DRAFT_REVIEW_PACKET_OPERATION,
    PROJECT_EXPORT_REVIEW_VISIBILITY_OPERATION,
    START_GENERATED_CONTENT_REVIEW_OPERATION,
    COMPLETE_GENERATED_CONTENT_REVIEW_OPERATION,
    ALLOWED_GENERATED_CONTENT_TYPES,
    DATA_GAP_MEMO_GENERATION_CLAIM_LIMIT,
  });

  export const __generatedContentReviewPacketServiceTestables = Object.freeze({
    isGeneratedDraftReviewPacketDto,
    isGeneratedDraftReviewPacketWithExportReviewVisibilityDto,
    isGeneratedDraftReviewPacketInput,
  });

  export const __completeGeneratedContentReviewServiceTestables = Object.freeze({
    isCompleteGeneratedContentReviewInput,
    isMappedHumanActor,
  });
