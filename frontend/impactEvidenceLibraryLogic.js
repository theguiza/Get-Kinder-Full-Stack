export const LIBRARY_AUDIENCES = Object.freeze(["internal", "funder", "public"]);
export const BASE_PATH = "/api/kai/sprint2/intake";
const ROUTE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isRouteUuid(value) {
  return typeof value === "string" && ROUTE_UUID_PATTERN.test(value);
}

export function eligibleClaimsPath(organizationId, audience) {
  const params = new URLSearchParams({ requested_audience: audience, limit: "25" });
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/eligible-claims?${params.toString()}`;
}

export function claimLibraryCandidatesPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/claim-library/candidates?limit=25`;
}

// Client-safe Impact Home summary (aggregates only). Home and the Needs
// Attention bell use this instead of the GK-internal claim-library index and
// organization Review Queue; they call the Review Queue only when the server
// reports internalReviewAvailable for this actor.
export function impactHomeSummaryPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/impact-home/summary`;
}

// Projects exactly the summary fields Home and the bell render. Returns null
// (unknown - never a guessed zero) when the DTO is missing or malformed.
export function projectImpactHomeSummary(dto) {
  if (!dto || typeof dto !== "object" || Array.isArray(dto)) return null;
  const isCount = (value) => Number.isInteger(value) && value >= 0;
  if (!isCount(dto.reviewedImpactFactCount) || !isCount(dto.clientActionCount) || !Array.isArray(dto.clientActions)) {
    return null;
  }
  const clientActions = dto.clientActions
    .filter((action) => typeof action?.clientFollowupItemId === "string" && typeof action?.questionText === "string")
    .map((action) => ({ clientFollowupItemId: action.clientFollowupItemId, questionText: action.questionText }));
  return {
    reviewedImpactFactCount: dto.reviewedImpactFactCount,
    reviewedImpactFactCountIsLowerBound: dto.reviewedImpactFactCountIsLowerBound === true,
    clientActionCount: clientActions.length,
    clientActions,
    internalReviewAvailable: dto.internalReviewAvailable === true,
    isFirstTime: dto.isFirstTime === true,
  };
}

// The existing client follow-up review page (also linked from the
// organization workspace) is where a client reviewer completes these.
export const CLIENT_FOLLOWUP_REVIEW_HREF = "/kai/client-followups";

// Server-derived organization access capabilities. Each flag is the answer
// of an existing service policy for this actor and organization; the
// Impact Library client uses them instead of guessing roles or calling a
// GK-internal read and treating 403 as "not available".
export function organizationAccessCapabilitiesPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/access-capabilities`;
}

// Returns null (unknown) for a missing/malformed DTO. Callers treat unknown
// as "not available", so a failed read never mounts a GK-internal view.
export function projectOrganizationAccessCapabilities(dto) {
  if (!dto || typeof dto !== "object" || Array.isArray(dto)) return null;
  return {
    internalKnowledgeWorkspace: dto.internalKnowledgeWorkspace === true,
    intakeContribution: dto.intakeContribution === true,
    clientFollowupReview: dto.clientFollowupReview === true,
    projectManagement: dto.projectManagement === true,
    improvementPlanManagement: dto.improvementPlanManagement === true,
    organizationJoinReview: dto.organizationJoinReview === true,
  };
}

// Client-safe Funder Requirements for one engagement/project: governed
// applicability status, the project's own target, and per currently
// applicable requirement its catalogue label and readiness. Never the GK
// funder-requirements composition (review rows, assessment ids/text).
export function clientFunderRequirementsPath(organizationId, engagementId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/client-funder-requirements`;
}

export const CLIENT_FUNDER_REQUIREMENTS_STATUSES = Object.freeze([
  "no_target",
  "no_requirement_set",
  "not_applicable",
  "applicability_pending",
  "applicable",
]);

export const CLIENT_REQUIREMENT_READINESS = Object.freeze([
  "met",
  "partially_met",
  "not_met",
  "in_review",
  "not_yet_assessed",
]);

function nullableString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Returns null (unknown) for a missing/malformed DTO or any unknown status
// or readiness value, so the view never presents a guessed state.
export function projectClientFunderRequirements(dto) {
  if (!dto || typeof dto !== "object" || Array.isArray(dto)) return null;
  if (!CLIENT_FUNDER_REQUIREMENTS_STATUSES.includes(dto.status)) return null;
  if (!Array.isArray(dto.requirementSets)) return null;
  const target = dto.target && typeof dto.target === "object" && !Array.isArray(dto.target) ? dto.target : {};
  const requirementSets = [];
  for (const set of dto.requirementSets) {
    if (!set || typeof set !== "object" || typeof set.requirementSetId !== "string" || !Array.isArray(set.requirements)) return null;
    const requirements = [];
    for (const requirement of set.requirements) {
      if (!requirement || typeof requirement.requirementId !== "string") return null;
      if (!CLIENT_REQUIREMENT_READINESS.includes(requirement.readiness)) return null;
      requirements.push({
        requirementId: requirement.requirementId,
        label: nullableString(requirement.label),
        description: nullableString(requirement.description),
        readiness: requirement.readiness,
      });
    }
    requirementSets.push({
      requirementSetId: set.requirementSetId,
      name: nullableString(set.name),
      funderName: nullableString(set.funderName),
      frameworkName: nullableString(set.frameworkName),
      versionLabel: nullableString(set.versionLabel),
      requirements,
    });
  }
  return {
    status: dto.status,
    target: {
      funderId: nullableString(target.funderId),
      framework: nullableString(target.framework),
      grantProgram: nullableString(target.grantProgram),
      report: nullableString(target.report),
      reportingTemplate: nullableString(target.reportingTemplate),
      reportingPeriodStart: nullableString(target.reportingPeriodStart),
      reportingPeriodEnd: nullableString(target.reportingPeriodEnd),
    },
    requirementSets: dto.status === "applicable" ? requirementSets : [],
  };
}

// Client-safe Generated Drafts and packet previews for the selected
// engagement/project: only GK-reviewed, currently eligible drafts bound to
// it, as content type, audience, block text, and the cited claim ids (which
// match client impact-facts claim ids). Never the GK generated-drafts index,
// review packet, Grant Response Packet, or Board Reporting reads. The list is
// bounded per request; `cursor` is the server's opaque continuation token.
function clientEngagementBasePath(organizationId, engagementId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/engagements/${encodeURIComponent(engagementId)}`;
}

export function clientGeneratedDraftsPath(organizationId, engagementId, cursor = null) {
  const base = `${clientEngagementBasePath(organizationId, engagementId)}/client-generated-drafts`;
  return cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base;
}

export function clientGeneratedDraftPath(organizationId, engagementId, generatedContentDraftId) {
  return `${clientEngagementBasePath(organizationId, engagementId)}/client-generated-drafts/${encodeURIComponent(generatedContentDraftId)}`;
}

export function clientGrantResponsePacketPath(organizationId, engagementId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/client-grant-response-packet`;
}

export function clientBoardReportingPreviewPath(organizationId, engagementId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/client-board-reporting`;
}

export const CLIENT_GENERATED_CONTENT_TYPES = Object.freeze([
  "evidence_summary",
  "impact_narrative",
  "readiness_assessment",
  "data_gap_memo",
  "case_for_support",
  "board_update",
  "annual_report_section",
  "funder_outcome_table",
  "grant_response_paragraph",
]);
const CLIENT_GENERATED_AUDIENCES = Object.freeze(["internal", "funder", "public"]);

function isPlainClientObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isClientDraftHeader(item) {
  return isPlainClientObject(item)
    && typeof item.generatedContentDraftId === "string"
    && CLIENT_GENERATED_CONTENT_TYPES.includes(item.contentType)
    && CLIENT_GENERATED_AUDIENCES.includes(item.audience)
    && item.reviewState === "reviewed";
}

// Returns null (unknown) for any malformed DTO or unknown content type,
// audience, or review state.
export function projectClientGeneratedDraftList(dto) {
  if (!isPlainClientObject(dto) || !Array.isArray(dto.items) || !Number.isInteger(dto.awaitingClientInputCount)) return null;
  const items = [];
  for (const item of dto.items) {
    if (!isClientDraftHeader(item) || !Number.isInteger(item.blockCount)) return null;
    items.push({
      generatedContentDraftId: item.generatedContentDraftId,
      contentType: item.contentType,
      audience: item.audience,
      reviewState: item.reviewState,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : null,
      blockCount: item.blockCount,
    });
  }
  if (!(dto.nextCursor === null || (typeof dto.nextCursor === "string" && dto.nextCursor.length > 0))) return null;
  return { items, awaitingClientInputCount: dto.awaitingClientInputCount, nextCursor: dto.nextCursor };
}

export function projectClientGeneratedDraft(dto) {
  if (!isClientDraftHeader(dto) || !Array.isArray(dto.blocks) || dto.blocks.length === 0) return null;
  const blocks = [];
  for (const block of dto.blocks) {
    if (!isPlainClientObject(block) || !Number.isInteger(block.ordinal) || typeof block.text !== "string") return null;
    if (!Array.isArray(block.supportingClaimIds) || !block.supportingClaimIds.every((id) => typeof id === "string")) return null;
    blocks.push({ ordinal: block.ordinal, text: block.text, supportingClaimIds: [...block.supportingClaimIds] });
  }
  return {
    generatedContentDraftId: dto.generatedContentDraftId,
    contentType: dto.contentType,
    audience: dto.audience,
    reviewState: dto.reviewState,
    blocks,
  };
}

export function projectClientPacketPreview(dto, audience) {
  if (!isPlainClientObject(dto) || dto.audience !== audience || !Array.isArray(dto.drafts)) return null;
  if (!["available", "no_reviewed_drafts"].includes(dto.status)) return null;
  const drafts = [];
  for (const draft of dto.drafts) {
    const projected = projectClientGeneratedDraft(draft);
    if (!projected || projected.audience !== audience) return null;
    drafts.push(projected);
  }
  if ((dto.status === "available") !== (drafts.length > 0)) return null;
  return { status: dto.status, audience, drafts };
}

// Client-safe reviewed Impact Facts: claims the governed evaluator marks
// eligible for the internal audience, as claim id, statement, type, and
// accepted limitation dimensions only.
export function clientImpactFactsPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/impact-facts`;
}

export function projectClientImpactFacts(dto) {
  if (!dto || typeof dto !== "object" || !Array.isArray(dto.items)) return null;
  return {
    items: dto.items
      .filter((item) => isRouteUuid(item?.claimId))
      .map((item) => ({
        claimId: item.claimId,
        statement: typeof item.statement === "string" ? item.statement : "",
        claimType: typeof item.claimType === "string" ? item.claimType : "",
        limitationDimensionKeys: Array.isArray(item.limitationDimensionKeys)
          ? item.limitationDimensionKeys.filter((key) => typeof key === "string")
          : [],
      })),
    truncated: dto.truncated === true,
  };
}

// KAI Impact Library redesign, E1 correction: evidence is enumerated
// directly from kai.evidence_items, never through kai.claims - an evidence
// item can exist before any claim is proposed for it.
export function evidenceLibraryCandidatesPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/evidence-library/candidates?limit=25`;
}

export function projectEvidenceLibraryItems(dto) {
  return asArray(dto?.items).map((item) => ({
    evidenceItemId: item.evidenceItemId,
    sourceId: item.sourceId,
    sourceVersionId: item.sourceVersionId,
    evidenceType: item.evidenceType,
    dataClass: item.dataClass,
    supportStrength: item.supportStrength,
    statement: item.statement,
    evidenceReviewStatus: item.evidenceReviewStatus,
    internalOnly: item.internalOnly,
    publicUseAllowed: item.publicUseAllowed,
    funderUseAllowed: item.funderUseAllowed,
  })).filter((item) => isRouteUuid(item.evidenceItemId));
}

export function claimTraceabilityPath(organizationId, claimId, audience) {
  const params = new URLSearchParams({ requested_audience: audience });
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/claims/${encodeURIComponent(claimId)}/traceability?${params.toString()}`;
}

export function createEvidenceSummaryPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/generated-content-drafts/evidence-summary`;
}

// P14-09 frontend wiring: the governed FUNDER evidence-summary generation
// route (Backend/kai/routes/sprint2IntakeApi.js) - a distinct, additive
// sibling of createEvidenceSummaryPath above. The accepted request body is
// identical in shape (claim_ids, idempotency_key, engagement_id only); the
// browser never sends requested_audience or any other field, and the
// backend alone sets requestedAudience to "funder".
export function createFunderEvidenceSummaryPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/generated-content-drafts/evidence-summary/funder`;
}

export function createImpactNarrativePath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/generated-content-drafts/impact-narrative`;
}

export function createReadinessAssessmentPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/generated-content-drafts/readiness-assessment`;
}

export function createDataGapMemoPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/generated-content-drafts/data-gap-memo`;
}

export function generatedDraftLibraryIndexPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/generated-content-drafts?limit=25`;
}

export function generatedDraftReviewPacketPath(organizationId, generatedContentDraftId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/generated-content-drafts/${encodeURIComponent(generatedContentDraftId)}/review-packet`;
}

export function evidenceExtractionPath(organizationId, sourceVersionId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/source-versions/${encodeURIComponent(sourceVersionId)}/evidence-extraction`;
}

export function evidenceCoverageAssessmentPath(organizationId, sourceVersionId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/source-versions/${encodeURIComponent(sourceVersionId)}/evidence-coverage-assessment`;
}

export function claimProposalPath(organizationId, evidenceItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/evidence-items/${encodeURIComponent(evidenceItemId)}/claim-proposal`;
}

export function organizationRequirementsReadinessPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/requirements`;
}

export function organizationRequirementAssessmentPath(organizationId, requirementId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/requirements/${encodeURIComponent(requirementId)}/assessment`;
}

// KAI Package 4: the engagement-aware `/impact-library` Funder Requirements
// read. Distinct from organizationRequirementsReadinessPath above (the
// generic KAI baseline readiness rollup, engagement-independent) - this path
// is keyed by the selected engagement and returns the Package 1B/2A/2B
// applicability classification plus, only when a requirement set is
// currently applicable, each governed requirement's CURRENT engagement-scope
// assessment (Package 3A/3B). Never the source of KAI baseline requirements.
export function engagementFunderRequirementsPath(organizationId, engagementId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/funder-requirements`;
}

export const ENGAGEMENT_FUNDER_REQUIREMENTS_STATES = Object.freeze({
  noTargetSelected: "no_target_selected",
  targetSelectedNoAuthoritativeRequirementSet: "target_selected_no_authoritative_requirement_set",
  authoritativeRequirementSetNotApplicable: "authoritative_requirement_set_not_applicable",
  applicableRequirementSetAssessmentNotAvailable: "applicable_requirement_set_assessment_not_available",
});

// Grant Response Packet: the accepted read-only, engagement-scoped route
// (Backend/kai/routes/sprint2IntakeApi.js) - authoritative membership is
// resolved entirely server-side (generation_runs.engagement_id lineage,
// funder-audience filter, resolved review + currentUseEligible gating). This
// path is never assembled from individually-fetched member drafts.
export function grantResponsePacketPath(organizationId, engagementId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/grant-response-packet`;
}

// Grant Response Packet Markdown preview: the existing, accepted
// PREVIEW_READ_ONLY packet-level delivery route
// (Backend/kai/routes/sprint2IntakeApi.js). Keyed by exactly the same
// organizationId + engagementId as grantResponsePacketPath above - never a
// member generatedContentDraftId, exportManifestId, or exportCandidateId.
// This is a distinct, additive artifact from any per-member export-manifest
// download link and grants no export/finalization authority.
export function grantResponsePacketMarkdownPath(organizationId, engagementId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/grant-response-packet/markdown`;
}

// Grant Response Packet export-candidate workflow wiring (P14-04): the
// authenticated POST sibling of grantResponsePacketPath above. Keyed by
// exactly the same organizationId + engagementId - the browser sends no
// candidate composition (no packetAudience, membership, ordering, or
// fingerprint) and this path carries none either.
export function grantResponsePacketExportCandidatesPath(organizationId, engagementId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/grant-response-packet/export-candidates`;
}

// Explicit allowlist projection of the export-candidate creation response
// (kaiGrantResponsePacketExportCandidateService.js) - safe candidate
// metadata only, never a member list or ordering.
export function projectGrantResponsePacketExportCandidateResult(dto) {
  if (!dto || typeof dto !== "object") return null;
  return {
    organizationId: dto.organizationId,
    engagementId: dto.engagementId,
    grantResponsePacketExportCandidateId: dto.grantResponsePacketExportCandidateId,
    grantResponsePacketExportIdentityId: dto.grantResponsePacketExportIdentityId,
    fingerprintContractVersion: dto.fingerprintContractVersion,
    canonicalFingerprint: dto.canonicalFingerprint,
    memberCount: typeof dto.memberCount === "number" ? dto.memberCount : null,
    replayed: dto.replayed === true,
  };
}

// Grant Response Packet export-review binding (P14-05): the authenticated
// POST sibling of grantResponsePacketExportCandidatesPath above. Keyed by
// exactly organizationId + engagementId + the EXACT existing candidate id
// the server already returned - never a latest/newest/preferred candidate
// guess, and the browser sends no membership, fingerprint, memberCount, or
// manifest/approval identity either.
export function grantResponsePacketExportReviewRequestPath(organizationId, engagementId, grantResponsePacketExportCandidateId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/grant-response-packet/export-candidates`
    + `/${encodeURIComponent(grantResponsePacketExportCandidateId)}/export-review-request`;
}

// Grant Response Packet export-review START (P14-06A): the authenticated
// POST sibling of grantResponsePacketExportReviewRequestPath above. Keyed by
// exactly organizationId + engagementId + the EXACT existing candidate id +
// the EXACT existing review-queue item id the server already returned -
// never a latest/newest/preferred guess of either. Transitions
// open/needs_gk_review to in_progress/needs_gk_review only.
export function grantResponsePacketExportReviewStartPath(organizationId, engagementId, grantResponsePacketExportCandidateId, exportReviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/grant-response-packet/export-candidates`
    + `/${encodeURIComponent(grantResponsePacketExportCandidateId)}/export-review-queue`
    + `/${encodeURIComponent(exportReviewQueueItemId)}/start`;
}

// Grant Response Packet export-review COMPLETE (P14-06B): the authenticated
// POST sibling of grantResponsePacketExportReviewStartPath above. Same exact
// identity discipline. Transitions in_progress/needs_gk_review to
// resolved/resolved only - review complete, never final eligibility,
// approval, funder-readiness, final-release authority, or a manifest.
export function grantResponsePacketExportReviewCompletePath(organizationId, engagementId, grantResponsePacketExportCandidateId, exportReviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/grant-response-packet/export-candidates`
    + `/${encodeURIComponent(grantResponsePacketExportCandidateId)}/export-review-queue`
    + `/${encodeURIComponent(exportReviewQueueItemId)}/complete`;
}

// P14-07: governed human final-release authority application - the
// authenticated POST sibling of grantResponsePacketExportReviewCompletePath
// above. Keyed by exactly organizationId + engagementId + the EXACT existing
// candidate id the server already returned - never a latest/newest/
// preferred candidate guess. The browser sends only decision_action
// (grant|revoke) - never a fingerprint, members, memberCount, review state,
// eligibility, authority state, requestedAudience (a Grant Response
// Packet's audience is always exactly funder), or manifest identity.
export function grantResponsePacketHumanFinalReleaseAuthorityPath(organizationId, engagementId, grantResponsePacketExportCandidateId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/grant-response-packet/export-candidates`
    + `/${encodeURIComponent(grantResponsePacketExportCandidateId)}/final-release-authority`;
}

export function grantResponsePacketHumanFinalReleaseAuthorityBody(decisionAction) {
  return { decision_action: decisionAction };
}

// P14-08D: governed Grant Response Packet FINAL Markdown export-manifest
// create/reuse control - the authenticated POST sibling of
// grantResponsePacketHumanFinalReleaseAuthorityPath above. Keyed by exactly
// organizationId + engagementId + the EXACT existing candidate id the server
// already returned - never a latest/newest/preferred candidate guess. The
// browser sends the existing required EMPTY body only ({}) - no eligibility,
// authority, fingerprint, members, memberCount, review state, requested
// audience, or manifest id ever leaves this call. The backend's own P14-08B
// create/reuse convergence is authoritative: the browser never decides
// whether a manifest needs creating.
export function grantResponsePacketExportManifestsPath(organizationId, engagementId, grantResponsePacketExportCandidateId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/grant-response-packet/export-candidates`
    + `/${encodeURIComponent(grantResponsePacketExportCandidateId)}/export-manifests`;
}

// P14-08C: governed FINAL Markdown delivery - authorized solely by the exact
// grantResponsePacketExportManifestId taken from the authoritative packet
// GET's finalDeliveryState.grantResponsePacketExportManifests (see
// projectGrantResponsePacketFinalDeliveryState below) - never a member
// exportManifestId/exportCandidateId, and never a latest/newest/preferred
// selection among multiple manifests. Distinct from, and never a substitute
// for, grantResponsePacketMarkdownPath's engagement-scoped PREVIEW.
export function grantResponsePacketExportManifestMarkdownPath(organizationId, grantResponsePacketExportManifestId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/grant-response-packet/export-manifests/${encodeURIComponent(grantResponsePacketExportManifestId)}/markdown`;
}

// The packet START/COMPLETE request body reuses the existing
// reviewTransitionBody({expected_updated_at}) helper below unchanged - no
// actorContext, no now, no other client-supplied authority data ever leaves
// this call.

// Explicit allowlist projection of the export-review-request/start/complete
// response (kaiGrantResponsePacketExportReviewService.js) - safe review-queue
// identity/status/CAS metadata only, never approval/final-release/manifest
// state. `reviewUpdatedAt` is the exact CAS token the next START/COMPLETE
// call must echo back as expectedUpdatedAt - never guessed, never derived
// from a client-side clock.
export function projectGrantResponsePacketExportReviewResult(dto) {
  if (!dto || typeof dto !== "object") return null;
  return {
    organizationId: dto.organizationId,
    engagementId: dto.engagementId,
    grantResponsePacketExportCandidateId: dto.grantResponsePacketExportCandidateId,
    reviewQueueItemId: dto.reviewQueueItemId,
    queueStatus: dto.queueStatus,
    reviewStatus: dto.reviewStatus,
    reviewUpdatedAt: typeof dto.reviewUpdatedAt === "string" ? dto.reviewUpdatedAt : null,
    replayed: dto.replayed === true,
  };
}

// P14-06 closure: the packet-level export-review lifecycle UI state
// machine, driven entirely by the exact server-returned
// queueStatus/reviewStatus pair on the current
// grantResponsePacketExportReviewResult (never client-derived, never a
// latest/newest/preferred guess). "requestable" only applies once the
// packet's own P14-04 candidate already exists (see the existing candidate
// card/state) but no review has been requested for it yet - the Request
// control itself predates this package and is unchanged. Mirrors
// gkExportReviewDetailLogic.js#canStartReview/canCompleteReview's one-state-
// one-control discipline: every combination shows at most one control.
export const GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES = Object.freeze({
  requestable: "requestable",
  startable: "startable",
  completable: "completable",
  resolved: "resolved",
  unknown: "unknown",
});

export function grantResponsePacketExportReviewLifecycleState(reviewResult) {
  if (!reviewResult) return GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.requestable;
  if (reviewResult.queueStatus === "open" && reviewResult.reviewStatus === "needs_gk_review") {
    return GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.startable;
  }
  if (reviewResult.queueStatus === "in_progress" && reviewResult.reviewStatus === "needs_gk_review") {
    return GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.completable;
  }
  if (reviewResult.queueStatus === "resolved" && reviewResult.reviewStatus === "resolved") {
    return GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.resolved;
  }
  return GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.unknown;
}

// P14-07: the packet-level final-release-authority control state, driven
// entirely by the exact server-returned queueStatus/reviewStatus/
// finalReleaseAuthorityEffective fields on the current projectGrantResponsePacket
// result (never client-derived, never a latest/newest/preferred guess).
// "none" whenever there is no current candidate or its export review is not
// yet resolved/resolved - "grantable" once review is resolved and no
// effective grant exists - "revocable" once an effective grant exists. Every
// combination shows at most one control, mirroring
// grantResponsePacketExportReviewLifecycleState's one-state-one-control
// discipline above.
export const GRANT_RESPONSE_PACKET_FINAL_RELEASE_AUTHORITY_CONTROL_STATES = Object.freeze({
  none: "none",
  grantable: "grantable",
  revocable: "revocable",
});

export function grantResponsePacketFinalReleaseAuthorityControlState(packet) {
  if (!packet || typeof packet.grantResponsePacketExportCandidateId !== "string") {
    return GRANT_RESPONSE_PACKET_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.none;
  }
  if (packet.queueStatus !== "resolved" || packet.reviewStatus !== "resolved") {
    return GRANT_RESPONSE_PACKET_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.none;
  }
  return packet.finalReleaseAuthorityEffective === true
    ? GRANT_RESPONSE_PACKET_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.revocable
    : GRANT_RESPONSE_PACKET_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.grantable;
}

// A Grant Response Packet response may be applied only if it belongs to the
// generation, organization, AND engagement still current when it resolves -
// same late-response-protection convention as
// shouldApplyCandidateResponse/shouldApplyEligibilityResponse above, so a
// late response for a previously selected engagement can never overwrite the
// newly selected engagement's packet.
export function shouldApplyGrantResponsePacketResponse({
  requestGeneration,
  currentGeneration,
  requestOrganizationId,
  currentOrganizationId,
  requestEngagementId,
  currentEngagementId,
}) {
  return (
    requestGeneration === currentGeneration
    && requestOrganizationId === currentOrganizationId
    && requestEngagementId === currentEngagementId
  );
}

// Explicit allowlist projection of the accepted Grant Response Packet DTO
// (kaiGrantResponsePacketService.js#getGrantResponsePacket): each member
// draft carries exactly the same governed single-draft review-packet fields
// projectGeneratedDraftPacket already trusts, plus the full per-citation
// traceability field set the gk-export-review detail page already renders
// (gkExportReviewDetailLogic.js#toRenderModel) - no new packet-shape
// vocabulary, no raw source/evidence content, no client-side eligibility
// recomputation.
// P14-08D: allowlisted projection of the authoritative packet DTO's
// finalDeliveryState (kaiGrantResponsePacketService.js) - the SOLE browser
// source for final Grant Response Packet Markdown manifests. Each manifest
// carries exactly its own grantResponsePacketExportManifestId - no member
// exportManifestId/exportCandidateId is ever accepted here, and this
// function never picks a "latest/newest/preferred" one: every valid manifest
// in the authoritative list is returned, in the server's own order.
function projectGrantResponsePacketFinalDeliveryState(finalDeliveryState) {
  if (!finalDeliveryState || typeof finalDeliveryState !== "object") return null;
  return {
    finalMarkdownAvailable: finalDeliveryState.finalMarkdownAvailable === true,
    grantResponsePacketExportManifests: asArray(finalDeliveryState.grantResponsePacketExportManifests)
      .map((manifest) => ({
        grantResponsePacketExportManifestId: manifest?.grantResponsePacketExportManifestId,
        createdAt: typeof manifest?.createdAt === "string" ? manifest.createdAt : null,
      }))
      .filter((manifest) => isRouteUuid(manifest.grantResponsePacketExportManifestId)),
  };
}

export function projectGrantResponsePacket(dto) {
  if (!dto || typeof dto !== "object") return null;
  const exportReviewVisible = dto.exportReviewVisible === true;
  const grantResponsePacketExportCandidateId = exportReviewVisible && typeof dto.grantResponsePacketExportCandidateId === "string"
    ? dto.grantResponsePacketExportCandidateId
    : null;
  const reviewQueueItemId = grantResponsePacketExportCandidateId && typeof dto.reviewQueueItemId === "string"
    ? dto.reviewQueueItemId
    : null;
  // P14-07: final-release authority state/effectiveness and final-export
  // eligibility PASS/BLOCKED for the exact current candidate above - null
  // whenever there is no current candidate, mirroring the existing
  // review-state null-linkage exactly. Never a client-side recomputation:
  // these are exactly the server's own authoritative fields.
  const finalReleaseAuthorityEffective = grantResponsePacketExportCandidateId
    && typeof dto.finalReleaseAuthorityEffective === "boolean"
    ? dto.finalReleaseAuthorityEffective
    : null;
  const finalExportEligible = grantResponsePacketExportCandidateId && typeof dto.finalExportEligible === "boolean"
    ? dto.finalExportEligible
    : null;
  return {
    organizationId: dto.organizationId,
    engagementId: dto.engagementId,
    packetAudience: dto.packetAudience,
    exportReviewVisible,
    grantResponsePacketExportCandidateId,
    reviewQueueItemId,
    queueStatus: reviewQueueItemId && typeof dto.queueStatus === "string" ? dto.queueStatus : null,
    reviewStatus: reviewQueueItemId && typeof dto.reviewStatus === "string" ? dto.reviewStatus : null,
    reviewUpdatedAt: reviewQueueItemId && typeof dto.reviewUpdatedAt === "string" ? dto.reviewUpdatedAt : null,
    finalReleaseAuthorityEffective,
    finalReleaseAuthorityReason: grantResponsePacketExportCandidateId && typeof dto.finalReleaseAuthorityReason === "string"
      ? dto.finalReleaseAuthorityReason
      : null,
    finalExportEligible,
    finalExportEligibilityBlockedReasons: grantResponsePacketExportCandidateId
      ? asArray(dto.finalExportEligibilityBlockedReasons).filter((reason) => typeof reason === "string")
      : [],
    // P14-08D: null whenever there is no current candidate, mirroring the
    // existing final-release-authority/final-export-eligibility null-linkage
    // above - never a client-side recomputation of manifest membership.
    finalDeliveryState: grantResponsePacketExportCandidateId
      ? projectGrantResponsePacketFinalDeliveryState(dto.finalDeliveryState)
      : null,
    drafts: asArray(dto.drafts).map((draft) => ({
      generatedContentDraftId: draft?.generatedContentDraftId,
      generationRunId: draft?.generationRunId,
      contentType: draft?.contentType,
      draftStatus: draft?.draftStatus,
      requestedAudience: draft?.requestedAudience,
      reviewQueueItemId: draft?.reviewQueueItemId,
      queueStatus: draft?.queueStatus,
      reviewStatus: draft?.reviewStatus,
      reviewUpdatedAt: draft?.reviewUpdatedAt,
      currentUseEligible: draft?.currentUseEligible === true,
      // Same durable "restricted" vs "no export review yet" distinction as
      // projectGeneratedDraftPacket - exportReviewVisible===false must never
      // be conflated with a genuine absence of export review.
      exportReviewVisible: draft?.exportReviewVisible === true,
      exportReviewQueueItemId: typeof draft?.exportReviewQueueItemId === "string" ? draft.exportReviewQueueItemId : null,
      exportReviewQueueStatus: typeof draft?.exportReviewQueueStatus === "string" ? draft.exportReviewQueueStatus : null,
      exportReviewStatus: typeof draft?.exportReviewStatus === "string" ? draft.exportReviewStatus : null,
      exportManifestId: draft?.exportReviewVisible === true && typeof draft?.exportManifestId === "string"
        ? draft.exportManifestId
        : null,
      exportManifestHistory: draft?.exportReviewVisible === true
        ? asArray(draft?.exportManifestHistory).map((entry) => ({
          exportManifestId: entry?.exportManifestId,
          exportCandidateId: entry?.exportCandidateId,
          createdAt: entry?.createdAt,
        }))
        : [],
      blocks: asArray(draft?.blocks).map((block) => ({
        ordinal: block?.ordinal,
        text: block?.text,
        citations: asArray(block?.citations).map((citation) => ({
          claimId: citation?.claimId,
          evidenceItemId: citation?.evidenceItemId,
          sourceId: citation?.sourceId,
          sourceVersionId: citation?.sourceVersionId,
          supportStrength: citation?.supportStrength,
          claimReviewStatus: citation?.claimReviewStatus,
          evidenceReviewStatus: citation?.evidenceReviewStatus,
          currentEligible: citation?.currentEligible === true,
          blockerCodes: asArray(citation?.blockerCodes),
          affectedDimensionKeys: asArray(citation?.affectedDimensionKeys),
          affectedObjectIds: asArray(citation?.affectedObjectIds),
        })),
      })),
    })).filter((draft) => typeof draft.generatedContentDraftId === "string"),
  };
}

// P14-06E1: deterministic read-model hydration from the authoritative
// P14-06D Grant Response Packet GET projection only. This helper accepts no
// prior browser candidate/review state, never scans members/manifests for a
// latest/newest/preferred candidate, and treats authoritative null/hidden
// identity as null.
export function hydrateGrantResponsePacketExportReviewReadModel(projectedPacket) {
  if (!projectedPacket || typeof projectedPacket !== "object") {
    return {
      packet: null,
      candidateResult: null,
      exportReviewResult: null,
    };
  }

  const candidateId = typeof projectedPacket.grantResponsePacketExportCandidateId === "string"
    ? projectedPacket.grantResponsePacketExportCandidateId
    : null;
  if (!candidateId) {
    return {
      packet: projectedPacket,
      candidateResult: null,
      exportReviewResult: null,
    };
  }

  const candidateResult = {
    organizationId: projectedPacket.organizationId,
    engagementId: projectedPacket.engagementId,
    grantResponsePacketExportCandidateId: candidateId,
  };
  const reviewQueueItemId = typeof projectedPacket.reviewQueueItemId === "string"
    ? projectedPacket.reviewQueueItemId
    : null;

  return {
    packet: projectedPacket,
    candidateResult,
    exportReviewResult: reviewQueueItemId
      ? {
        organizationId: projectedPacket.organizationId,
        engagementId: projectedPacket.engagementId,
        grantResponsePacketExportCandidateId: candidateId,
        reviewQueueItemId,
        queueStatus: projectedPacket.queueStatus,
        reviewStatus: projectedPacket.reviewStatus,
        reviewUpdatedAt: typeof projectedPacket.reviewUpdatedAt === "string" ? projectedPacket.reviewUpdatedAt : null,
      }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Board Reporting: the browser-facing analogue of Grant Response Packet above,
// over Backend/kai/services/kaiBoardReportingPacketService.js,
// kaiBoardReportingCandidateService.js,
// kaiBoardReportingCandidateWorkflowStateService.js,
// kaiBoardReportingCandidateHumanFinalReleaseAuthorityService.js, and
// kaiBoardReportingCandidateExportManifestService.js. Unlike Grant Response
// Packet, the Board Reporting packet GET carries no prior candidate id of its
// own (see kaiBoardReportingPacketService.js#getBoardReportingPacket) - it is
// the same eligible-member packet the BR-02 candidate create/reuse route
// already reads, plus that packet's own current authoritative composition
// identity (fingerprintContractVersion + canonicalFingerprint - the EXACT
// same composeBoardReportingPacketFingerprint computation BR-02 candidate
// create/reuse already relies on, never a new algorithm, never computed in
// the browser). The exact candidate identity recovery mechanism here is
// therefore NOT hydrated from the packet GET: it is retained in React state
// (ImpactEvidenceLibrary.jsx) from the create/reuse POST response, keyed to
// organizationId + engagementId + the packet's current canonicalFingerprint,
// and cleared whenever the selected organization or engagement changes -
// never a latest/newest/first/last/array-order guess. A true fresh mount (or
// hard reload) also clears that React state, but ImpactEvidenceLibrary.jsx
// recovers the exact same candidate id automatically once the packet
// reloads, by replaying the same deterministic create/reuse idempotency key
// (boardReportingCreateCandidateIdempotencyKey below is a pure function of
// the packet's own current canonicalFingerprint only) - the backend's
// existing create/reuse convergence (see
// postgresBoardReportingCandidateRepository.js) resolves that replay back to
// the SAME existing candidate row when the composition is unchanged
// (replayed: true), and to a NEW candidate once the authoritative composition
// - and therefore canonicalFingerprint - has changed, so no second,
// browser-side persistence mechanism, and no stale candidate is ever silently
// treated as current.
// ---------------------------------------------------------------------------

export function boardReportingPacketPath(organizationId, engagementId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/board-reporting`;
}

// BR-02 candidate create/reuse: keyed by exactly organizationId + engagementId
// - the browser sends only its own idempotency_key (see
// boardReportingCreateCandidateBody/boardReportingCreateCandidateIdempotencyKey
// below). Membership, fingerprint, review outcome, authority, eligibility,
// and manifest data are never accepted from the client - the backend resolves
// the current eligible packet and derives candidate membership/fingerprint
// itself.
export function boardReportingCandidatesPath(organizationId, engagementId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/board-reporting/candidates`;
}

// A deterministic, composition-scoped idempotency key so an identical
// create/reuse replay against the same current authoritative Board
// composition returns the same existing candidate (replayed: true), while a
// changed composition (a different canonicalFingerprint) always derives a
// different key - matches the BOARD_REPORTING candidate idempotency_key
// contract (/^[A-Za-z0-9._:-]{8,128}$/) exactly. `canonicalFingerprint` must
// be the packet's own server-derived identity (projectBoardReportingPacket
// above) - the browser never computes this fingerprint itself, only formats
// it into a key. organizationId/engagementId are not repeated in the key text
// itself: the backend's own idempotency_key uniqueness is already scoped by
// organization_id + engagement_id, and canonicalFingerprint alone is already
// specific to this exact organization/engagement/member composition (it is
// computed over the members' own generatedContentDraftId values, which are
// globally unique).
export function boardReportingCreateCandidateIdempotencyKey(canonicalFingerprint) {
  return `board-reporting-${canonicalFingerprint}`;
}

export function boardReportingCreateCandidateBody(idempotencyKey) {
  return { idempotency_key: idempotencyKey };
}

// BR-02 exact candidate read: authorized solely by the EXACT existing
// boardReportingCandidateId the create/reuse POST above already returned -
// never organizationId+engagementId alone, and never a latest/newest/
// preferred selection.
export function boardReportingCandidatePath(organizationId, engagementId, boardReportingCandidateId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/board-reporting/candidates`
    + `/${encodeURIComponent(boardReportingCandidateId)}`;
}

// The single browser-facing authoritative read surface for one exact Board
// Reporting candidate's full governed lifecycle - current BR-03 review
// state, effective BR-04 final-release authority, current Board final
// eligibility (with structured failedGates/blockers/currentnessGate), and
// this candidate's export-manifest history (see
// kaiBoardReportingCandidateWorkflowStateService.js). Keyed by exactly the
// same EXACT existing boardReportingCandidateId as boardReportingCandidatePath
// above.
export function boardReportingWorkflowStatePath(organizationId, engagementId, boardReportingCandidateId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/board-reporting/candidates`
    + `/${encodeURIComponent(boardReportingCandidateId)}/workflow-state`;
}

export function boardReportingReviewRequestPath(organizationId, engagementId, boardReportingCandidateId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/board-reporting/candidates`
    + `/${encodeURIComponent(boardReportingCandidateId)}/review-request`;
}

// BR-03B START: keyed by exactly the EXACT existing candidate id + the EXACT
// existing review-queue item id the workflow-state GET already returned -
// never a latest/newest/preferred guess of either. The request body is the
// existing reviewTransitionBody({expected_updated_at}) helper unchanged - the
// exact CAS token the workflow-state GET last observed on the queue item.
export function boardReportingReviewStartPath(organizationId, engagementId, boardReportingCandidateId, reviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/board-reporting/candidates`
    + `/${encodeURIComponent(boardReportingCandidateId)}/review-queue`
    + `/${encodeURIComponent(reviewQueueItemId)}/start`;
}

// BR-03B COMPLETE: same exact identity discipline as START above.
export function boardReportingReviewCompletePath(organizationId, engagementId, boardReportingCandidateId, reviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/board-reporting/candidates`
    + `/${encodeURIComponent(boardReportingCandidateId)}/review-queue`
    + `/${encodeURIComponent(reviewQueueItemId)}/complete`;
}

// BR-04: governed human final-release authority application for the EXACT
// existing candidate id. Unlike Grant Response Packet's analogous route, the
// Board route ALSO requires the EXACT existing review_queue_item_id (the
// bound 'board_reporting_candidate_review' queue row the caller asserts is
// resolved) in the body - never a requested_audience (a Board Reporting
// candidate's audience is always exactly "internal"), fingerprint, members,
// memberCount, review state, eligibility, authority state, or manifest
// identity.
export function boardReportingFinalReleaseAuthorityPath(organizationId, engagementId, boardReportingCandidateId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/board-reporting/candidates`
    + `/${encodeURIComponent(boardReportingCandidateId)}/final-release-authority`;
}

export function boardReportingFinalReleaseAuthorityBody(reviewQueueItemId, decisionAction) {
  return { review_queue_item_id: reviewQueueItemId, decision_action: decisionAction };
}

// Board Reporting candidate export-manifest create/reuse: keyed by exactly
// the EXACT existing candidate id - the request body is the existing
// required EMPTY body only ({}), no eligibility/authority/fingerprint/
// member/review-state/manifest-identity field ever leaves this call. The
// backend's own create/reuse convergence is authoritative: the browser never
// decides whether a manifest needs creating.
export function boardReportingExportManifestsPath(organizationId, engagementId, boardReportingCandidateId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/board-reporting/candidates`
    + `/${encodeURIComponent(boardReportingCandidateId)}/export-manifests`;
}

// Governed FINAL Board Summary Markdown delivery - authorized solely by the
// EXACT boardReportingCandidateExportManifestId the workflow-state GET's own
// exportManifests list carries - never a candidate id without its manifest,
// and never a latest/newest/preferred selection among multiple manifests.
// Org-scoped only (not engagement-scoped), matching the analogous
// grantResponsePacketExportManifestMarkdownPath above exactly.
export function boardReportingExportManifestMarkdownPath(organizationId, boardReportingCandidateExportManifestId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/board-reporting/export-manifests/${encodeURIComponent(boardReportingCandidateExportManifestId)}/markdown`;
}

// A Board Reporting response (packet or workflow-state) may be applied only
// if it belongs to the organization AND engagement still current when it
// resolves - same late-response-protection convention as
// shouldApplyGrantResponsePacketResponse above, so a late response for a
// previously selected engagement can never overwrite the newly selected
// engagement's Board Reporting state.
export function shouldApplyBoardReportingResponse({
  requestGeneration,
  currentGeneration,
  requestOrganizationId,
  currentOrganizationId,
  requestEngagementId,
  currentEngagementId,
}) {
  return (
    requestGeneration === currentGeneration
    && requestOrganizationId === currentOrganizationId
    && requestEngagementId === currentEngagementId
  );
}

// Explicit allowlist projection of the authoritative Board Reporting packet
// DTO (kaiBoardReportingPacketService.js#getBoardReportingPacket): read-only,
// engagement-scoped regrouping of already-governed, internal-audience
// evidence_summary/impact_narrative drafts. No client-side eligibility
// recomputation, no raw source/evidence content.
export function projectBoardReportingPacket(dto) {
  if (!dto || typeof dto !== "object") return null;
  return {
    organizationId: dto.organizationId,
    engagementId: dto.engagementId,
    packetAudience: dto.packetAudience,
    supportedContentTypes: asArray(dto.supportedContentTypes).filter((entry) => typeof entry === "string"),
    // The packet's own current authoritative Board composition identity -
    // the EXACT same fingerprint BR-02 candidate create/reuse computes and
    // validates replay against (see module header comment above). Both null
    // together whenever there are currently no eligible members.
    fingerprintContractVersion: typeof dto.fingerprintContractVersion === "string" ? dto.fingerprintContractVersion : null,
    canonicalFingerprint: typeof dto.canonicalFingerprint === "string" ? dto.canonicalFingerprint : null,
    members: asArray(dto.members).map((member) => ({
      generationRunId: member?.generationRunId,
      generatedContentDraftId: member?.generatedContentDraftId,
      contentType: member?.contentType,
      draftStatus: member?.draftStatus,
      requestedAudience: member?.requestedAudience,
      reviewQueueItemId: member?.reviewQueueItemId,
      queueStatus: member?.queueStatus,
      reviewStatus: member?.reviewStatus,
      reviewUpdatedAt: member?.reviewUpdatedAt,
      currentUseEligible: member?.currentUseEligible === true,
      blocks: asArray(member?.blocks),
    })).filter((member) => typeof member.generatedContentDraftId === "string"),
  };
}

// Explicit allowlist projection of the BR-02 create/reuse response
// (kaiBoardReportingCandidateService.js#createBoardReportingCandidate) - safe
// candidate metadata only, never a member list or ordering. This is the SOLE
// source of the exact boardReportingCandidateId retained in React state (see
// module header comment above) - never a latest/newest/preferred guess.
export function projectBoardReportingCandidateResult(dto) {
  if (!dto || typeof dto !== "object") return null;
  return {
    organizationId: dto.organizationId,
    engagementId: dto.engagementId,
    boardReportingCandidateId: dto.boardReportingCandidateId,
    packetAudience: dto.packetAudience,
    fingerprintContractVersion: dto.fingerprintContractVersion,
    canonicalFingerprint: dto.canonicalFingerprint,
    memberCount: typeof dto.memberCount === "number" ? dto.memberCount : null,
    replayed: dto.replayed === true,
  };
}

// Explicit allowlist projection of the BR-02 exact-candidate read response
// (kaiBoardReportingCandidateService.js#readBoardReportingCandidate) - the
// immutable member snapshot captured at creation time, not the current
// packet.
export function projectBoardReportingCandidateSnapshot(dto) {
  if (!dto || typeof dto !== "object") return null;
  return {
    boardReportingCandidateId: dto.boardReportingCandidateId,
    organizationId: dto.organizationId,
    engagementId: dto.engagementId,
    packetAudience: dto.packetAudience,
    fingerprintContractVersion: dto.fingerprintContractVersion,
    canonicalFingerprint: dto.canonicalFingerprint,
    candidateStatus: dto.candidateStatus,
    createdAt: typeof dto.createdAt === "string" ? dto.createdAt : null,
    members: asArray(dto.members).map((member) => ({
      boardReportingCandidateMemberId: member?.boardReportingCandidateMemberId,
      generatedContentDraftId: member?.generatedContentDraftId,
      ordinal: typeof member?.ordinal === "number" ? member.ordinal : null,
      createdAt: typeof member?.createdAt === "string" ? member.createdAt : null,
    })),
  };
}

// Explicit allowlist projection of the authoritative workflow-state DTO
// (kaiBoardReportingCandidateWorkflowStateService.js#readBoardReportingCandidateWorkflowState).
// This defensive projector reads ONLY server-provided fields and never
// fabricates, sorts, dedupes, or picks a "latest" export manifest -
// exportManifests is returned in exactly the server's own order.
export function projectBoardReportingWorkflowState(dto) {
  if (!dto || typeof dto !== "object") return null;
  const reviewState = dto.reviewState && typeof dto.reviewState === "object" ? dto.reviewState : {};
  const effectiveAuthority = dto.effectiveAuthority && typeof dto.effectiveAuthority === "object" ? dto.effectiveAuthority : {};
  const finalEligibility = dto.finalEligibility && typeof dto.finalEligibility === "object" ? dto.finalEligibility : {};
  return {
    organizationId: dto.organizationId,
    engagementId: dto.engagementId,
    boardReportingCandidateId: dto.boardReportingCandidateId,
    reviewState: {
      reviewQueueItemId: typeof reviewState.reviewQueueItemId === "string" ? reviewState.reviewQueueItemId : null,
      queueStatus: typeof reviewState.queueStatus === "string" ? reviewState.queueStatus : null,
      reviewStatus: typeof reviewState.reviewStatus === "string" ? reviewState.reviewStatus : null,
      reviewUpdatedAt: typeof reviewState.reviewUpdatedAt === "string" ? reviewState.reviewUpdatedAt : null,
    },
    effectiveAuthority: {
      decisionType: effectiveAuthority.decisionType ?? null,
      effective: effectiveAuthority.effective === true,
      reason: typeof effectiveAuthority.reason === "string" ? effectiveAuthority.reason : null,
      headDecisionId: typeof effectiveAuthority.headDecisionId === "string" ? effectiveAuthority.headDecisionId : null,
    },
    finalEligibility: {
      finalEligibility: finalEligibility.finalEligibility === true,
      failedGates: asArray(finalEligibility.failedGates),
      blockers: asArray(finalEligibility.blockers),
      currentnessGate: finalEligibility.currentnessGate ?? null,
    },
    exportManifests: asArray(dto.exportManifests)
      .map((manifest) => ({
        boardReportingCandidateExportManifestId: manifest?.boardReportingCandidateExportManifestId,
        boardReportingCandidateId: manifest?.boardReportingCandidateId,
        effectiveAuthorityDecisionId: manifest?.effectiveAuthorityDecisionId ?? null,
        effectiveAuthorityDecisionType: manifest?.effectiveAuthorityDecisionType ?? null,
        fingerprintContractVersion: manifest?.fingerprintContractVersion ?? null,
        canonicalFingerprint: manifest?.canonicalFingerprint ?? null,
        createdAt: typeof manifest?.createdAt === "string" ? manifest.createdAt : null,
      }))
      .filter((manifest) => isRouteUuid(manifest.boardReportingCandidateExportManifestId)),
  };
}

// The candidate review lifecycle UI state machine, driven entirely by the
// exact server-returned queueStatus/reviewStatus pair on the current
// workflow-state's reviewState (never client-derived, never a latest/newest/
// preferred guess). Mirrors
// grantResponsePacketExportReviewLifecycleState's one-state-one-control
// discipline exactly: every combination shows at most one control.
// "requestable" applies whenever a candidate exists but no review has yet
// been requested for it (reviewQueueItemId null).
export const BOARD_REPORTING_REVIEW_LIFECYCLE_STATES = Object.freeze({
  requestable: "requestable",
  startable: "startable",
  completable: "completable",
  resolved: "resolved",
  unknown: "unknown",
});

export function boardReportingReviewLifecycleState(reviewState) {
  if (!reviewState || typeof reviewState.reviewQueueItemId !== "string") {
    return BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.requestable;
  }
  if (reviewState.queueStatus === "open" && reviewState.reviewStatus === "needs_gk_review") {
    return BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.startable;
  }
  if (reviewState.queueStatus === "in_progress" && reviewState.reviewStatus === "needs_gk_review") {
    return BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.completable;
  }
  if (reviewState.queueStatus === "resolved" && reviewState.reviewStatus === "resolved") {
    return BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.resolved;
  }
  return BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.unknown;
}

// The candidate final-release-authority control state, driven entirely by
// the exact server-returned reviewState/effectiveAuthority fields on the
// current workflow-state (never client-derived, never a latest/newest/
// preferred guess). "none" whenever review is not yet resolved/resolved -
// "grantable" once review is resolved and no effective grant exists -
// "revocable" once an effective grant exists. Mirrors
// grantResponsePacketFinalReleaseAuthorityControlState's one-state-one-
// control discipline exactly.
export const BOARD_REPORTING_FINAL_RELEASE_AUTHORITY_CONTROL_STATES = Object.freeze({
  none: "none",
  grantable: "grantable",
  revocable: "revocable",
});

export function boardReportingFinalReleaseAuthorityControlState(workflowState) {
  const reviewState = workflowState?.reviewState;
  if (!reviewState || reviewState.queueStatus !== "resolved" || reviewState.reviewStatus !== "resolved") {
    return BOARD_REPORTING_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.none;
  }
  return workflowState?.effectiveAuthority?.effective === true
    ? BOARD_REPORTING_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.revocable
    : BOARD_REPORTING_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.grantable;
}

// Whether the governed FINAL Board Summary action may be attempted for an
// explicitly-selected boardReportingCandidateExportManifestId. This is a UX
// nicety only - the server (kaiBoardReportingCandidateExportManifestMarkdownSerializer.js)
// remains the sole enforcement authority regardless of this function's
// result. Requires: an explicit (non-empty) manifest id selection, that
// exact manifest id present in the current workflow-state's own
// exportManifests list (never inferred/first/last), final eligibility
// currently true, and effective authority currently granted.
export function boardReportingFinalSummaryFetchable(workflowState, selectedManifestId) {
  if (!workflowState || typeof selectedManifestId !== "string" || selectedManifestId.length === 0) return false;
  if (workflowState.finalEligibility?.finalEligibility !== true) return false;
  if (workflowState.effectiveAuthority?.effective !== true) return false;
  return asArray(workflowState.exportManifests).some(
    (manifest) => manifest.boardReportingCandidateExportManifestId === selectedManifestId,
  );
}

// Projects the Package 4 composition DTO into exactly what the Funder
// Requirements card renders: the applicability state, the engagement's
// current target (for display only - never editable here), and, only for
// the applicable state, the flattened list of governed requirements with
// their current engagement-scope assessment (or null - never a fallback to
// the generic organization-scope assessment, and never a stale one: the
// server never returns a non-current row through this path).
export function projectEngagementFunderRequirements(dto) {
  const state = dto?.state || null;
  const requirementSets = asArray(dto?.applicable_requirement_sets);
  const requirements = requirementSets.flatMap((requirementSet) =>
    asArray(requirementSet.requirements).map((requirement) => ({
      requirementId: requirement.requirement_id,
      requirementKey: requirement.requirement_key,
      requirementSetId: requirementSet.requirement_set_id,
      requirementSetKey: requirementSet.set_key,
      requirementSource: {
        sourceType: requirementSet.requirement_source?.source_type || null,
        sourceCode: requirementSet.requirement_source?.source_code || null,
      },
      requirementFrameworkVersion: {
        frameworkCode: requirementSet.requirement_framework_version?.framework_code || null,
        versionLabel: requirementSet.requirement_framework_version?.version_label || null,
        frameworkStatus: requirementSet.requirement_framework_version?.framework_status || null,
      },
      currentAssessment: requirement.current_assessment ? {
        requirementAssessmentId: requirement.current_assessment.assessment?.requirement_assessment_id || null,
        assessmentState: requirement.current_assessment.assessment?.assessment_state || null,
        assessmentExplanation: requirement.current_assessment.assessment?.assessment_explanation || null,
        assessedAt: requirement.current_assessment.assessment?.created_at || null,
      } : null,
    })),
  );
  return {
    state,
    target: isPlainObjectForProjection(dto?.target) ? dto.target : {},
    requirements,
  };
}

function isPlainObjectForProjection(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function organizationReviewQueuePath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/review-queue`;
}

// KAI Data Sources completion package: organization-scoped browse read of
// governed kai.sources + kai.source_versions rows, so a user can discover a
// source_version_id instead of already knowing one.
export function organizationSourcesPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/sources`;
}

// Projects the Data Sources DTO into exactly what the section renders: each
// governed source with its own governed source_versions, using only the
// safe fields the server already returns (source_code/reviewed_source_type/
// is_current/created_at) - never a frontend-computed currentness or
// eligibility rule. `isCurrent`/`createdAt` are display-only facts, not used
// here to disable any action.
export function projectOrganizationSources(dto) {
  return asArray(dto?.sources).map((source) => ({
    sourceId: source.source_id,
    sourceCode: source.source_code,
    reviewedSourceType: source.reviewed_source_type,
    createdAt: source.created_at,
    sourceVersions: asArray(source.source_versions).map((version) => ({
      sourceVersionId: version.source_version_id,
      sourceId: version.source_id,
      isCurrent: version.is_current === true,
      createdAt: version.created_at,
    })),
  }));
}

// KAI Review Queue: what currently needs human attention, derived from the
// SAME per-claim traceability DTO shape the Traceability panel already
// projects (projectTraceability) - never a second blocker system. A queue
// item exists here only because the server-recomputed blockerCodes were
// non-empty; a resolved review_queue_items lifecycle row never suppresses
// it. `claimId` is read from the raw dto since projectTraceability does not
// hoist it to the top level.
export function projectReviewQueue(dto) {
  return asArray(dto?.items).map((item) => ({
    claimId: item.claim?.claim_id || null,
    ...projectTraceability(item),
  }));
}

// KAI Review Queue: completeness metadata for the organization-scope rollup,
// projected separately from projectReviewQueue so existing callers of that
// function (which returns a plain item array) are unaffected. `truncated`
// means listOrganizationClaimIds hit REVIEW_QUEUE_CLAIM_LIMIT and claims
// beyond the cap were never evaluated at all; `evaluationErrorCount` counts
// claims whose per-claim evaluateClaimTraceabilityInTransaction call failed
// and were excluded from `items` (see postgresClaimTraceabilityRepository.js
// listOrganizationReviewQueue). Either condition means `items` cannot be
// treated as the full current-attention set for the organization.
export function projectReviewQueueCompleteness(dto) {
  return {
    truncated: dto?.truncated === true,
    evaluationErrorCount: Number.isInteger(dto?.evaluationErrorCount) ? dto.evaluationErrorCount : 0,
  };
}

// True only when the rollup that produced `completeness` covered every
// organization claim without any per-claim evaluation failure - i.e. an
// empty `items` list under this completeness may be reported as a real,
// conclusive zero.
export function reviewQueueIsComplete(completeness) {
  return completeness?.truncated !== true && (completeness?.evaluationErrorCount || 0) === 0;
}

// KAI Review Queue closure: the SINGLE authority for whether the organization
// truly has nothing needing attention across BOTH current-attention sources -
// claim-traceability and sensitivity/allowed-use. Deliberately takes a
// `reviewQueueRequestState` (not just `reviewQueueCompleteness`) so a
// missing/malformed DTO can never by itself establish a successful,
// complete read: `reviewQueueIsComplete(projectReviewQueueCompleteness(null))`
// is true, but that can only ever surface here paired with
// `reviewQueueRequestState !== "success"`, which fails this gate regardless.
// Every input is request-state-first: "idle"/"loading"/"error" always return
// false, matching sensitivityReviewQueueAttention's existing
// never-show-0-while-unknown rule for the sensitivity half.
export function reviewQueueIsConclusivelyEmpty({
  reviewQueueRequestState,
  reviewQueueCompleteness,
  reviewQueueItemsLength,
  sensitivityCapabilityRequestState,
  sensitivityCapability,
  sensitivityAttentionStatus,
  sensitivityAttentionItemsLength,
}) {
  const claimConclusiveZero =
    reviewQueueRequestState === "success"
    && reviewQueueIsComplete(reviewQueueCompleteness)
    && reviewQueueItemsLength === 0;

  const sensitivityConclusiveZero =
    sensitivityCapabilityRequestState === "success"
    && sensitivityCapability === true
    && sensitivityAttentionStatus === "ready"
    && sensitivityAttentionItemsLength === 0;

  return claimConclusiveZero && sensitivityConclusiveZero;
}

// Presentation-only actionability derivation for one Review Queue item's
// blocker code. Deterministic and pure - never persisted, never a new
// workflow authority. Reuses the exact same gates the Traceability panel
// already uses to decide whether to render its existing decision controls
// (canCompleteEvidenceReview/canCompleteClaimReview) so this never diverges
// from what the reviewer can actually do once they select the claim below.
export function reviewQueueBlockerActionability(blockerCode, item) {
  if (blockerCode === "evidence_review_unresolved") {
    return canCompleteEvidenceReview(item.evidence, item.evidenceReviewDecision) ? "ACTION_REQUIRED" : "BLOCKED";
  }
  if (blockerCode === "claim_review_unresolved") {
    // A claim cannot be independently reviewed until its linked evidence
    // item's own decision-lineage head is a terminal outcome (the same
    // prerequisite postgresHumanReviewRepository.js's recordClaimReviewDecision
    // enforces). That is a dependency on other lawful work, not a genuine
    // validator/governance hard blocker - present it with the same "WAITING"
    // vocabulary already used for client-followup dependency, never BLOCKED.
    if (!claimReviewEvidencePrerequisiteSatisfied(item.evidence, item.evidenceReviewDecision)) {
      return "WAITING";
    }
    return canCompleteClaimReview(item.evidence, item.claimReview, item.evidenceReviewDecision, item.claimReviewDecision)
      ? "ACTION_REQUIRED"
      : "BLOCKED";
  }
  if (blockerCode === "coverage_dimension_unresolved") {
    // The existing "Accept internal limitation for selected dimension"
    // control (Claim & evidence workflow card) is reachable as soon as a
    // claim is selected - no further current-state gate exists for it today.
    return "ACTION_REQUIRED";
  }
  if (blockerCode === "client_followup_unresolved") {
    const waitingOnClient = asArray(item.clientFollowupWorkflows).some(
      (workflow) => workflow.workflowStatus === "waiting_on_client",
    );
    return waitingOnClient ? "WAITING" : "BLOCKED";
  }
  return "BLOCKED";
}

export function blockerDisplayText(blockerCode, requestedAudience) {
  if (blockerCode === "requirement_authority_absent" && requestedAudience === "funder") {
    return "Funder audience authority is not currently established: requires current claim-review approval for funder use and effective Phase-5 funder authority.";
  }
  return blockerCode;
}

// Capability B: organization-level Gaps and Risks. This is a pure
// re-composition of state the Review Queue rollup already fetched and
// projected (projectReviewQueue -> projectTraceability per claim) - no new
// fetch, no new backend read. Package 5 repair: membership/currentness for
// every category is read directly from server-authoritative fields
// (postgresClaimTraceabilityRepository.js) - `gapItems[].is_current`,
// `potentialConflictGroups[].is_current`, `clientFollowupWorkflows[].isCurrent`,
// and the pre-existing `dimensions[].blocksRequestedAudience` - never
// re-derived from raw status/queue-status strings here. `gap_items` (governed
// kai.gap_log_items rows) and coverage/dimension findings (the fixed
// DIMENSION_KEYS computation) are kept as two distinct categories - a
// dimension can be a current coverage finding with no persisted gap_log_item
// yet, and a persisted gap_log_item is never treated as a coverage-dimension
// finding.
export function projectOrganizationGapsAndRisks(reviewQueueItems) {
  const gapItems = [];
  const coverageFindings = [];
  const conflicts = [];
  const followups = [];
  for (const item of asArray(reviewQueueItems)) {
    const claimId = item.claimId;
    for (const gap of asArray(item.gapItems)) {
      if (gap.is_current === true) {
        gapItems.push({
          claimId,
          gapLogItemId: gap.gap_log_item_id,
          dimensionKey: gap.dimension_key,
          assessmentStatus: gap.assessment_status,
          validatorKey: gap.validator_key,
        });
      }
    }
    for (const dimension of asArray(item.dimensions)) {
      if (dimension.blocksRequestedAudience === true) {
        coverageFindings.push({
          claimId,
          dimensionKey: dimension.dimensionKey,
          assessmentStatus: dimension.assessmentStatus,
          validatorKey: dimension.validatorKey,
        });
      }
    }
    for (const group of asArray(item.potentialConflictGroups)) {
      if (group.is_current === true) {
        conflicts.push({
          claimId,
          conflictGroupId: group.conflict_group_id,
          lowerClaimId: group.lower_claim_id,
          higherClaimId: group.higher_claim_id,
          basisCode: group.basis_code,
          reviewStatus: group.review_status,
          workflowStatus: group.workflow_status,
        });
      }
    }
    for (const followup of asArray(item.clientFollowupWorkflows)) {
      if (followup.isCurrent === true) {
        followups.push({
          claimId,
          clientFollowupItemId: followup.clientFollowupItemId,
          dimensionKey: followup.dimensionKey,
          workflowStatus: followup.workflowStatus,
          reviewStatus: followup.reviewStatus,
        });
      }
    }
  }
  return { gapItems, coverageFindings, conflicts, followups };
}

// True only when the same rollup that feeds the Review Queue conclusively
// covered every organization claim (reviewQueueIsComplete) AND every one of
// the four Gaps and Risks categories above is genuinely empty. Deliberately
// independent of reviewQueueIsConclusivelyEmpty (which also folds in the
// separate Phase-5 sensitivity/allowed-use rollup - out of scope here): this
// section reports only claim-traceability-derived evidence-health state.
export function organizationGapsAndRisksIsConclusivelyEmpty({
  reviewQueueRequestState,
  reviewQueueCompleteness,
  gapsAndRisks,
}) {
  return (
    reviewQueueRequestState === "success"
    && reviewQueueIsComplete(reviewQueueCompleteness)
    && (gapsAndRisks?.gapItems?.length || 0) === 0
    && (gapsAndRisks?.coverageFindings?.length || 0) === 0
    && (gapsAndRisks?.conflicts?.length || 0) === 0
    && (gapsAndRisks?.followups?.length || 0) === 0
  );
}

// KAI Review Queue: composes the EXISTING Phase-5 sensitivity/allowed-use
// review state (already fetched via sensitivityCapabilitiesPath/
// sensitivityReviewQueuePath, projected via projectSensitivityReviewQueueItems)
// into the same current-attention product surface as the claim-traceability
// rollup above - without introducing any new sensitivity authority, decision
// state, or queue row. This is a pure presentation projection over state the
// caller already holds; it never fetches anything itself.
//
// `status` distinguishes the reasons a count can be absent so the caller
// never has to guess whether "no items" means zero actionable work or merely
// "not known yet":
//   "unavailable" - actor lacks (or capability is not yet confirmed for) the
//                    existing sensitivity-review capability; preserve the
//                    existing authorization behavior (hide), never show 0.
//   "loading"      - the authoritative queue read is in flight; never show 0.
//   "error"        - the authoritative queue read failed; never show 0, and
//                    never treat the whole Review Queue as empty because of it.
//   "ready"        - an authorized, successful read completed; `items` is the
//                    authoritative current list (possibly empty, i.e. a real 0).
export function sensitivityReviewQueueAttention({
  sensitivityCapability,
  loadingSensitivityReviewQueue,
  sensitivityReviewQueueError,
  sensitivityReviewQueueItems,
}) {
  if (sensitivityCapability !== true) {
    return { status: "unavailable", items: [] };
  }
  if (loadingSensitivityReviewQueue) {
    return { status: "loading", items: [] };
  }
  if (sensitivityReviewQueueError) {
    return { status: "error", items: [], error: sensitivityReviewQueueError };
  }
  return { status: "ready", items: asArray(sensitivityReviewQueueItems) };
}

export function projectRequirementsReadiness(dto) {
  return asArray(dto?.requirements).map((requirement) => ({
    requirementId: requirement.requirement_id,
    requirementKey: requirement.requirement_key,
    requirementLabel: requirement.requirement_label,
    requirementDescription: requirement.requirement_description || null,
    displayOrder: Number.isInteger(requirement.display_order) ? requirement.display_order : null,
    requirementSet: {
      requirementSetId: requirement.requirement_set?.requirement_set_id || null,
      setKey: requirement.requirement_set?.set_key || null,
      setName: requirement.requirement_set?.set_name || null,
    },
    requirementFrameworkVersion: {
      requirementFrameworkVersionId: requirement.requirement_framework_version?.requirement_framework_version_id || null,
      frameworkCode: requirement.requirement_framework_version?.framework_code || null,
      frameworkName: requirement.requirement_framework_version?.framework_name || null,
      versionLabel: requirement.requirement_framework_version?.version_label || null,
      frameworkStatus: requirement.requirement_framework_version?.framework_status || null,
    },
    requirementSource: {
      requirementSourceId: requirement.requirement_source?.requirement_source_id || null,
      sourceType: requirement.requirement_source?.source_type || null,
      sourceCode: requirement.requirement_source?.source_code || null,
      sourceName: requirement.requirement_source?.source_name || null,
    },
    assessed: requirement.assessed === true,
    assessmentId: requirement.assessment?.requirement_assessment_id || null,
    assessmentState: requirement.assessment?.assessment_state || null,
    assessmentExplanation: requirement.assessment?.assessment_explanation || null,
    assessmentFingerprint: requirement.assessment?.state_fingerprint || null,
    assessedAt: requirement.assessment?.created_at || null,
    assessmentProvenance: requirement.assessment_provenance ? {
      evidenceItemIds: asArray(requirement.assessment_provenance.evidence_item_ids),
      claimIds: asArray(requirement.assessment_provenance.claim_ids),
      evidenceReviewDecisionIds: asArray(requirement.assessment_provenance.evidence_review_decision_ids),
      claimReviewDecisionIds: asArray(requirement.assessment_provenance.claim_review_decision_ids),
      currentGapLogItemIds: asArray(requirement.assessment_provenance.current_gap_log_item_ids),
      outcomeContextIds: asArray(requirement.assessment_provenance.outcome_context_ids),
      sourcePromotionEvidenceItemIds: asArray(requirement.assessment_provenance.source_promotion_evidence_item_ids),
      conflictResolutionPairs: asArray(requirement.assessment_provenance.conflict_resolution_pairs),
    } : null,
  }));
}

export function claimGapFollowupsPath(organizationId, claimId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/claims/${encodeURIComponent(claimId)}/claim-gap-followups`;
}

export function potentialConflictsPath(organizationId, firstClaimId, secondClaimId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/claims/${encodeURIComponent(firstClaimId)}/potential-conflicts/${encodeURIComponent(secondClaimId)}`;
}

export function coverageInternalAcceptancePath(organizationId, claimId, dimensionKey) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/claims/${encodeURIComponent(claimId)}/coverage-dimensions/${encodeURIComponent(dimensionKey)}/internal-acceptance`;
}

// KAI P2-10 funder coverage-dimension acceptance, the funder-audience sibling
// of coverageInternalAcceptancePath above - same path shape, same empty-body
// convention, distinct terminal segment matching the existing governed
// funder-acceptance route (sprint2IntakeApi.js).
export function coverageFunderAcceptancePath(organizationId, claimId, dimensionKey) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/claims/${encodeURIComponent(claimId)}/coverage-dimensions/${encodeURIComponent(dimensionKey)}/funder-acceptance`;
}

export function evidenceReviewCompletePath(organizationId, evidenceItemId, reviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/evidence-items/${encodeURIComponent(evidenceItemId)}/evidence-review/${encodeURIComponent(reviewQueueItemId)}/complete`;
}

export function claimReviewCompletePath(organizationId, claimId, reviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/claims/${encodeURIComponent(claimId)}/claim-review/${encodeURIComponent(reviewQueueItemId)}/complete`;
}

// The server (postgresHumanReviewRepository.js, updateReviewQueueCompareAndSet)
// targets open/needs_gk_review for any non-terminal decision outcome
// (needs_more_information) -- this is how a previously-resolved review is
// "reopened": it lands back in exactly this same open/needs_gk_review state,
// not a distinct one. So a review that is outstanding for the first time and
// a review that is outstanding again after being reopened are already the
// same, single observable state here; no separate reopened state exists to
// gate on.
function isReviewOutstanding(queueStatus, reviewStatus) {
  return queueStatus === "open" && reviewStatus === "needs_gk_review";
}

function isResolvedQueueState(queueStatus, reviewStatus) {
  return queueStatus === "resolved" && reviewStatus === "resolved";
}

// Mirrors Backend/kai/dictionary/humanReviewDecisionContract.js's
// EVIDENCE_REVIEW_TERMINAL_OUTCOMES exactly (same mirroring convention this
// file already uses for EVIDENCE_REVIEW_DECISIONS/CLAIM_REVIEW_DECISIONS
// below) - the vocabulary of evidence-review outcomes that resolve the
// review, as opposed to needs_more_information which reopens it.
const EVIDENCE_REVIEW_TERMINAL_OUTCOMES = Object.freeze([
  "supported",
  "supported_with_limitation",
  "not_supported",
]);

function isTerminalEvidenceReviewDecision(evidenceReviewDecision) {
  return (
    Boolean(evidenceReviewDecision)
    && EVIDENCE_REVIEW_TERMINAL_OUTCOMES.includes(evidenceReviewDecision.decisionOutcome)
  );
}

// Mirrors Backend/kai/dictionary/humanReviewDecisionContract.js's
// CLAIM_REVIEW_TERMINAL_OUTCOMES exactly. Unlike legacy repair (no current
// decision head), a resolved/resolved claim review with one of these heads is
// a deliberate terminal re-review candidate: the backend accepts this as the
// governed "re-review" CAS branch and supersedes the current decision.
const CLAIM_REVIEW_TERMINAL_OUTCOMES = Object.freeze([
  "approved",
  "approved_with_limitation",
  "rejected",
]);

function isTerminalClaimReviewDecision(claimReviewDecision) {
  return (
    Boolean(claimReviewDecision)
    && CLAIM_REVIEW_TERMINAL_OUTCOMES.includes(claimReviewDecision.decisionOutcome)
  );
}

// KAI P2-12 legacy-repair recognition: `queue_status/review_status =
// resolved` alone was the ENTIRE old pre-P2-12 proof of review - a queue row
// can be sitting in that state with no decision ever recorded (see
// postgresHumanReviewRepository.js's resolved/resolved CAS branch, proven by
// the "resolved queue without a decision head" integration test). That state
// is exactly as lawfully reviewable as a fresh open/needs_gk_review row: the
// backend accepts a genuine first decision as a lineage root against it. Once
// a real decision head exists, the row is no longer a repair candidate - a
// terminal outcome means it is genuinely done, and needs_more_information
// means the row is (or will be) back in the ordinary open/needs_gk_review
// path, not this one.
function isLegacyRepairCandidate(queueStatus, reviewStatus, currentDecision) {
  return isResolvedQueueState(queueStatus, reviewStatus) && currentDecision == null;
}

function isTerminalClaimRereviewCandidate(queueStatus, reviewStatus, currentDecision) {
  return isResolvedQueueState(queueStatus, reviewStatus) && isTerminalClaimReviewDecision(currentDecision);
}

export function canCompleteEvidenceReview(evidence, evidenceReviewDecision) {
  if (!evidence) return false;
  if (isReviewOutstanding(evidence.review_queue_status, evidence.review_status)) return true;
  return isLegacyRepairCandidate(evidence.review_queue_status, evidence.review_status, evidenceReviewDecision);
}

// The claim-review prerequisite this repository's write layer enforces
// (postgresHumanReviewRepository.js recordClaimReviewDecision): the linked
// evidence item's own decision-lineage head must already be a TERMINAL
// outcome - never absent, never needs_more_information. `evidence.review_status
// === "resolved"` alone (the pre-P2-12 signal) is not sufficient proof by
// itself; it must be paired with a genuine terminal decision head.
export function claimReviewEvidencePrerequisiteSatisfied(evidence, evidenceReviewDecision) {
  return evidence?.review_status === "resolved" && isTerminalEvidenceReviewDecision(evidenceReviewDecision);
}

export function canCompleteClaimReview(evidence, claimReview, evidenceReviewDecision, claimReviewDecision) {
  if (!claimReviewEvidencePrerequisiteSatisfied(evidence, evidenceReviewDecision)) return false;
  if (!claimReview) return false;
  if (isReviewOutstanding(claimReview.queue_status, claimReview.review_status)) return true;
  if (isLegacyRepairCandidate(claimReview.queue_status, claimReview.review_status, claimReviewDecision)) return true;
  return isTerminalClaimRereviewCandidate(claimReview.queue_status, claimReview.review_status, claimReviewDecision);
}

export const EVIDENCE_REVIEW_DECISIONS = Object.freeze([
  "supported",
  "supported_with_limitation",
  "not_supported",
  "needs_more_information",
]);

export const CLAIM_REVIEW_DECISIONS = Object.freeze([
  "approved",
  "approved_with_limitation",
  "rejected",
  "needs_more_information",
]);

export const APPROVED_AUDIENCE_VALUES = Object.freeze(["internal", "funder", "public"]);

export function seedClaimApprovedAudiencesFromDecision(claimReviewDecision) {
  return asArray(claimReviewDecision?.approvedAudiences)
    .filter((audience) => APPROVED_AUDIENCE_VALUES.includes(audience));
}

export function decisionRequiresLimitationNotes(decision) {
  return decision === "supported_with_limitation" || decision === "approved_with_limitation";
}

export function decisionRequiresApprovedAudiences(decision) {
  return decision === "approved" || decision === "approved_with_limitation";
}

// Splits a free-text textarea's contents into one array entry per non-blank
// line, trimmed. This is the "clean" limitation-notes array the server
// requires: non-empty array of non-empty strings.
export function cleanLimitationNotes(rawText) {
  return String(rawText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Builds the evidence-review decision POST body. `limitation_notes` is
// included only when the decision requires it - never sent as null/empty
// for any other decision, since the server rejects the key entirely
// (`unexpected_limitation_notes`) when it isn't applicable.
export function evidenceReviewDecisionBody({ expectedUpdatedAt, decision, limitationNotes }) {
  const body = { expected_updated_at: expectedUpdatedAt, decision };
  if (decisionRequiresLimitationNotes(decision)) {
    body.limitation_notes = cleanLimitationNotes(limitationNotes);
  }
  return body;
}

// Builds the claim-review decision POST body. `limitation_notes` and
// `approved_audiences` are each included only when the chosen decision
// requires them, per the same omit-unless-applicable rule as above.
export function claimReviewDecisionBody({ expectedUpdatedAt, decision, limitationNotes, approvedAudiences }) {
  const body = { expected_updated_at: expectedUpdatedAt, decision };
  if (decisionRequiresLimitationNotes(decision)) {
    body.limitation_notes = cleanLimitationNotes(limitationNotes);
  }
  if (decisionRequiresApprovedAudiences(decision)) {
    body.approved_audiences = Array.isArray(approvedAudiences) ? [...approvedAudiences] : [];
  }
  return body;
}

// Client-side defense in depth only - the server independently validates the
// same rules. Returns "" when the decision's required fields are satisfied,
// or a short human-readable reason otherwise.
export function evidenceReviewDecisionValidationError({ decision, limitationNotes }) {
  if (!EVIDENCE_REVIEW_DECISIONS.includes(decision)) return "Select an evidence review decision.";
  if (decisionRequiresLimitationNotes(decision) && cleanLimitationNotes(limitationNotes).length === 0) {
    return "Enter at least one limitation note.";
  }
  return "";
}

export function claimReviewDecisionValidationError({ decision, limitationNotes, approvedAudiences }) {
  if (!CLAIM_REVIEW_DECISIONS.includes(decision)) return "Select a claim review decision.";
  if (decisionRequiresLimitationNotes(decision) && cleanLimitationNotes(limitationNotes).length === 0) {
    return "Enter at least one limitation note.";
  }
  if (decisionRequiresApprovedAudiences(decision) && (!Array.isArray(approvedAudiences) || approvedAudiences.length === 0)) {
    return "Select at least one approved audience.";
  }
  return "";
}

export const COVERAGE_DIMENSION_KEYS = Object.freeze([
  "missingness",
  "duplicates",
  "definition_clarity",
  "denominator_clarity",
  "time_period_clarity",
  "entity_level_clarity",
  "small_cell_risk",
  "conflicting_source_indicators",
  "requirement_alignment",
  "coverage_gaps",
]);

export function generatedContentReviewStartPath(organizationId, generatedContentDraftId, reviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/generated-content-drafts/${encodeURIComponent(generatedContentDraftId)}`
    + `/generated-content-review-queue/${encodeURIComponent(reviewQueueItemId)}/start`;
}

export function generatedContentReviewCompletePath(organizationId, generatedContentDraftId, reviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/generated-content-drafts/${encodeURIComponent(generatedContentDraftId)}`
    + `/generated-content-review-queue/${encodeURIComponent(reviewQueueItemId)}/complete`;
}

// P3-08's gk_admin-only export-review packet/start/complete/finalization
// surface (frontend/gkExportReviewDetail.jsx) is a real, already-built page,
// but it is only reachable by a caller who already holds its three path
// identifiers - it is deliberately kept out of general navigation. The
// export-review-request route below is the existing, accepted, gk_admin-only
// way to obtain the third identifier (exportReviewQueueItemId) for a draft
// whose generated-content review is already resolved/resolved: this
// generates (or replays) the export_review queue row without duplicating
// any P3-16/P3-17/P3-18/P3-19 eligibility logic. `gkExportReviewDetailPagePath`
// below builds the exact page route (not an API path) index.js already
// serves for that page, so the Impact Evidence Library can link straight to
// it once the id is known.

export function exportReviewRequestPath(organizationId, generatedContentDraftId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/generated-content-drafts/${encodeURIComponent(generatedContentDraftId)}/export-review-request`;
}

export function exportReviewRequestBody(requestedExportAudience) {
  return { requested_export_audience: requestedExportAudience };
}

export function gkExportReviewDetailPagePath(organizationId, generatedContentDraftId, exportReviewQueueItemId) {
  return `/gk-admin/organizations/${encodeURIComponent(organizationId)}`
    + `/generated-content-drafts/${encodeURIComponent(generatedContentDraftId)}`
    + `/export-review-queue/${encodeURIComponent(exportReviewQueueItemId)}`;
}

// Mirrors canCompleteGeneratedContentReview's pattern: a pure, server-state-
// only readiness gate. Export review can only ever be requested once the
// generated-content review itself is fully resolved - never derived from
// draftStatus or any other field.
export function canRequestGeneratedDraftExportReview(packet) {
  return !!packet && packet.queueStatus === "resolved" && packet.reviewStatus === "resolved";
}

// Durable read recovery: classifies the packet's own already-recovered
// export-review state (never the transient post-POST result) into exactly
// the states the card renders, so "no review yet" and "not visible to your
// role" can never be conflated - one reload-safe read replaces what used to
// only exist as in-memory POST-response state.
export const EXPORT_REVIEW_DISPLAY_STATES = Object.freeze({
  restricted: "restricted",
  existing: "existing",
  requestable: "requestable",
  notRequestable: "not_requestable",
});

export function generatedDraftExportReviewDisplayState(packet) {
  if (!packet || packet.exportReviewVisible !== true) return EXPORT_REVIEW_DISPLAY_STATES.restricted;
  if (typeof packet.exportReviewQueueItemId === "string") return EXPORT_REVIEW_DISPLAY_STATES.existing;
  return canRequestGeneratedDraftExportReview(packet)
    ? EXPORT_REVIEW_DISPLAY_STATES.requestable
    : EXPORT_REVIEW_DISPLAY_STATES.notRequestable;
}

// Projects the exact seven-key export-review-request result DTO
// (kaiExportReviewService.js's EXPORT_REVIEW_RESULT_KEYS) into the minimal
// shape this page renders - never a passthrough spread.
export function projectExportReviewRequestResult(dto) {
  if (!dto || typeof dto !== "object") return null;
  return {
    accepted: dto.exportReviewRequestAccepted === true,
    exportReviewQueueItemId: typeof dto.reviewQueueItemId === "string" ? dto.reviewQueueItemId : null,
    validatorResult: dto.validatorResult ?? null,
  };
}

// KAI B1A-3B: Phase-5 sensitivity/consent/allowed-use review, reusing the
// existing B1A-2/B1A-2R review-cockpit backend authority as-is. These three
// routes take `organization_id` as a QUERY STRING parameter (the review-
// cockpit sub-tree's own convention), unlike every other path builder above
// (which embeds organizationId as a path segment) - this is a deliberate
// mismatch inherited from the reused backend, not an inconsistency to "fix".
const REVIEW_COCKPIT_BASE_PATH = `${BASE_PATH}/admin/review-cockpit`;

export function sensitivityCapabilitiesPath(organizationId) {
  const params = new URLSearchParams({ organization_id: organizationId });
  return `${REVIEW_COCKPIT_BASE_PATH}/capabilities?${params.toString()}`;
}

export function sensitivityProfilePath(organizationId, intakeSensitivityProfileId) {
  const params = new URLSearchParams({ organization_id: organizationId });
  return `${REVIEW_COCKPIT_BASE_PATH}/sensitivity-profiles/${encodeURIComponent(intakeSensitivityProfileId)}?${params.toString()}`;
}

export function sensitivityReviewWorkPath(organizationId, intakeSensitivityProfileId) {
  const params = new URLSearchParams({ organization_id: organizationId });
  return `${REVIEW_COCKPIT_BASE_PATH}/sensitivity-profiles/${encodeURIComponent(intakeSensitivityProfileId)}/review-work?${params.toString()}`;
}

export function sensitivityDecisionPath(organizationId, intakeSensitivityProfileId) {
  const params = new URLSearchParams({ organization_id: organizationId });
  return `${REVIEW_COCKPIT_BASE_PATH}/sensitivity-profiles/${encodeURIComponent(intakeSensitivityProfileId)}/decision?${params.toString()}`;
}

// KAI B1A-3B-R1: pre-claim reachability. This is the SAME organization-scoped,
// same-capability-gated review-cockpit queue the admin cockpit already lists
// (queue_type='sensitivity_review'), reused as-is so an authorized reviewer can
// discover a P1-05 sensitivity profile that needs review directly from
// /impact-library - with no claim, no claim traceability, no evidence item, and
// no source promotion required. `target_object_id` on a 'sensitivity_review' /
// 'intake_sensitivity_profile' row IS the server-grounded intake_sensitivity_profile_id;
// the browser never derives or fabricates it.
export function sensitivityReviewQueuePath(organizationId) {
  const params = new URLSearchParams({
    organization_id: organizationId,
    queue_type: "sensitivity_review",
    queue_status: "open",
  });
  return `${REVIEW_COCKPIT_BASE_PATH}/queue?${params.toString()}`;
}

export function projectSensitivityReviewQueueItems(dto) {
  return asArray(dto?.items)
    .filter((item) => item?.queue_type === "sensitivity_review" && item?.target_object_type === "intake_sensitivity_profile")
    .map((item) => ({
      reviewQueueItemId: item.review_queue_item_id,
      intakeSensitivityProfileId: item.target_object_id,
      queueStatus: item.queue_status,
      summary: item.summary,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }))
    .filter((item) => isRouteUuid(item.reviewQueueItemId) && isRouteUuid(item.intakeSensitivityProfileId));
}

// The nine presence dimensions (unknown|present|absent), in the exact backend
// field-name order - used to render the form and to validate a submitted
// snapshot carries exactly these keys, with zero risk of name drift from the
// backend contract (sensitivityAllowedUseDecisionContract.js).
export const SENSITIVITY_PRESENCE_FIELDS = Object.freeze([
  "reviewed_personal_data_status",
  "reviewed_minor_data_status",
  "reviewed_health_housing_justice_immigration_status",
  "reviewed_indigenous_governance_status",
  "reviewed_staff_notes_status",
  "reviewed_story_testimonial_status",
  "reviewed_small_cell_risk_status",
  "reviewed_financial_records_status",
  "reviewed_consent_basis_status",
]);

export const SENSITIVITY_ALLOWED_USE_FIELD = "reviewed_allowed_use_status";

export const SENSITIVITY_PERMISSION_FIELDS = Object.freeze([
  "reviewed_llm_processing_allowed",
  "reviewed_product_learning_allowed",
  "reviewed_public_use_allowed",
  "reviewed_funder_use_allowed",
]);

export const SENSITIVITY_PRESENCE_VALUES = Object.freeze(["unknown", "present", "absent"]);
export const SENSITIVITY_ALLOWED_USE_VALUES = Object.freeze(["unknown", "allowed", "not_allowed"]);

export const SENSITIVITY_DECISION_OUTCOMES = Object.freeze(["reviewed", "needs_more_information"]);

// The internal-only default: every presence dimension and the allowed-use
// status start at "unknown" (never coerced to "absent"/"safe"), and every
// permission starts false. A reviewer must positively choose each value.
export function defaultSensitivityReviewFormState() {
  const state = { [SENSITIVITY_ALLOWED_USE_FIELD]: "unknown" };
  for (const field of SENSITIVITY_PRESENCE_FIELDS) state[field] = "unknown";
  for (const field of SENSITIVITY_PERMISSION_FIELDS) state[field] = false;
  return state;
}

// Client-side defense in depth only, mirroring (never replacing) the
// server's fail-closed VAL-KAI-B1A-02-001 rule: llm/product-learning/funder
// permission may only be enabled once allowed-use is explicitly "allowed".
export function restrictedPermissionEligible(formState) {
  return formState?.[SENSITIVITY_ALLOWED_USE_FIELD] === "allowed";
}

// Client-side defense in depth only, mirroring (never replacing) the
// server's fail-closed VAL-KAI-B1A-02-002 rule: public use additionally
// requires an explicitly present consent basis AND an explicitly absent
// Indigenous/governance-sensitive status. "unknown" never satisfies either.
export function publicUseAllowedEligible(formState) {
  return (
    restrictedPermissionEligible(formState)
    && formState?.reviewed_consent_basis_status === "present"
    && formState?.reviewed_indigenous_governance_status === "absent"
  );
}

// Builds the exact 14-key reviewed_snapshot object a "reviewed" decision
// requires - nothing added, nothing omitted, and every permission the
// client-side gate would disable is force-cleared to false so an invalid
// combination can never be sent even if a disabled control's stale value
// lingers in form state.
export function buildReviewedSnapshotBody(formState) {
  const snapshot = {};
  for (const field of SENSITIVITY_PRESENCE_FIELDS) snapshot[field] = formState?.[field] ?? "unknown";
  snapshot[SENSITIVITY_ALLOWED_USE_FIELD] = formState?.[SENSITIVITY_ALLOWED_USE_FIELD] ?? "unknown";
  const restrictedEligible = restrictedPermissionEligible(snapshot);
  const publicEligible = publicUseAllowedEligible(snapshot);
  snapshot.reviewed_llm_processing_allowed = restrictedEligible && formState?.reviewed_llm_processing_allowed === true;
  snapshot.reviewed_product_learning_allowed = restrictedEligible && formState?.reviewed_product_learning_allowed === true;
  snapshot.reviewed_funder_use_allowed = restrictedEligible && formState?.reviewed_funder_use_allowed === true;
  snapshot.reviewed_public_use_allowed = publicEligible && formState?.reviewed_public_use_allowed === true;
  return snapshot;
}

// Builds the POST decision request body. `reviewed_snapshot` is included only
// for a "reviewed" outcome - the server rejects it outright
// (unexpected_reviewed_snapshot) for needs_more_information.
export function buildSensitivityDecisionRequestBody({ decision, expectedUpdatedAt, reviewQueueItemId, formState }) {
  const body = {
    expected_updated_at: expectedUpdatedAt,
    review_queue_item_id: reviewQueueItemId,
    decision,
  };
  if (decision === "reviewed") {
    body.reviewed_snapshot = buildReviewedSnapshotBody(formState);
  }
  return body;
}

// Light projection of the GET sensitivity-profile detail response. Kept
// deliberately close to the raw shape (unlike projectTraceability's fuller
// reshaping) since every field name here already IS the reviewer-facing
// contract this component renders directly.
export function projectSensitivityDetail(dto) {
  if (!dto || typeof dto !== "object") return null;
  return {
    sensitivityPosture: dto.sensitivity_posture || null,
    allowedUseRestrictions: dto.allowed_use_restrictions || null,
    reviewQueueItem: dto.sensitivity_review_queue_item || null,
    currentDecision: dto.current_decision || null,
    decisionControlsEnabled: dto.decision_controls_enabled === true,
  };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function getJson(path) {
  const response = await fetch(path, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return { statusCode: response.status, body: await readJson(response) };
}

export async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { statusCode: response.status, body: await readJson(response) };
}

export function reviewTransitionBody(expectedUpdatedAt) {
  return { expected_updated_at: expectedUpdatedAt };
}

export function errorText(result) {
  return result?.body?.error?.message || `Request failed (${result?.statusCode ?? "unknown"}).`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function projectEligibleClaims(dto) {
  return asArray(dto?.eligibleClaims).map((claim) => ({
    claimId: claim.claimId,
    evidenceItemId: claim.evidenceItemId,
    claimType: claim.claimType,
    claimStatus: claim.claimStatus,
    claimReviewStatus: claim.claimReviewStatus,
    supportStrength: claim.supportStrength,
    sourceId: claim.sourceId,
    sourceVersionId: claim.sourceVersionId,
    requestedAudience: claim.requestedAudience,
    libraryStatus: "usable",
  })).filter((claim) => (
    isRouteUuid(claim.claimId)
    && isRouteUuid(claim.evidenceItemId)
    && claim.requestedAudience === dto?.requestedAudience
  ));
}

export function projectCandidateClaims(dto) {
  return asArray(dto?.items).map((claim) => ({
    claimId: claim.claimId,
    evidenceItemId: claim.evidenceItemId,
    claimType: claim.claimType,
    claimStatus: claim.claimStatus,
    claimReviewStatus: claim.claimReviewStatus,
    claimStrength: claim.claimStrength,
    reviewQueueItems: asArray(claim.reviewQueueItems).map((item) => ({
      reviewQueueItemId: item.review_queue_item_id,
      queueType: item.queue_type,
      targetObjectType: item.target_object_type,
      targetObjectId: item.target_object_id,
      queueStatus: item.queue_status,
      reviewStatus: item.review_status,
    })),
    libraryStatus: "needs_review",
    // KAI Impact Library redesign, E1: the claim's own governed assertion -
    // the real Impact Fact headline. Distinct from evidenceStatement below,
    // which is supporting provenance, never the headline itself.
    claimStatement: claim.claimStatement ?? null,
    // KAI Impact Library redesign, D-Correction 1 / Package E: the real,
    // governed evidence item behind this claim (statement/strength/review
    // status/source lineage/use-authority) - never a claim field relabeled.
    evidenceStatement: claim.evidenceStatement ?? null,
    evidenceSupportStrength: claim.evidenceSupportStrength ?? null,
    evidenceReviewStatus: claim.evidenceReviewStatus ?? null,
    evidenceSourceId: claim.evidenceSourceId ?? null,
    evidenceSourceVersionId: claim.evidenceSourceVersionId ?? null,
    evidenceInternalOnly: claim.evidenceInternalOnly ?? null,
    evidencePublicUseAllowed: claim.evidencePublicUseAllowed ?? null,
    evidenceFunderUseAllowed: claim.evidenceFunderUseAllowed ?? null,
  })).filter((claim) => isRouteUuid(claim.claimId) && isRouteUuid(claim.evidenceItemId));
}

export function mergeClaims(usableClaims, candidateClaims) {
  const byId = new Map();
  for (const claim of candidateClaims) byId.set(claim.claimId, claim);
  for (const claim of usableClaims) byId.set(claim.claimId, { ...byId.get(claim.claimId), ...claim });
  return [...byId.values()].sort((a, b) => a.claimId.localeCompare(b.claimId));
}

// Governed internal availability and audience eligibility are independent
// dimensions: a claim's presence in the all-state Claim Library (candidateClaims,
// from claim-library/candidates) is not derived from, and must not be gated by,
// whether it is also present in the audience-scoped eligible-claims response.
export function annotateGovernedAvailability(mergedClaims, candidateClaims, eligibleClaims, eligibleRequestState) {
  const candidateIds = new Set(candidateClaims.map((claim) => claim.claimId));
  const eligibleIds = new Set(eligibleClaims.map((claim) => claim.claimId));
  return mergedClaims.map((claim) => ({
    ...claim,
    governedAvailable: candidateIds.has(claim.claimId),
    audienceEligibility:
      eligibleRequestState !== "success"
        ? "eligibility_unavailable"
        : eligibleIds.has(claim.claimId) ? "eligible" : "not_eligible",
  }));
}

// Package 14-05: internal evidence-summary draft generation is gated on
// governed internal availability (presence in the all-state Claim Library),
// not on audience/use eligibility. A claim that is governed but currently
// ineligible for its audience may still be selected for INTERNAL generation;
// funder/public audiences may never select for generation regardless of
// governed availability. This function must not infer admission from
// libraryStatus, audienceEligibility, eligible, review status, support
// strength, blocker count, coverage state, or client-followup state.
export function canSelectClaimForInternalGeneration(claim, audience) {
  return audience === "internal" && claim?.governedAvailable === true;
}

// P14-09: funder Evidence Summary generation admission is DELIBERATELY
// stricter than canSelectClaimForInternalGeneration above and must never
// reuse its "governed but not currently eligible" semantics. A claim is
// selectable for funder generation only when it is BOTH present in the
// governed Claim Library (governedAvailable) AND reported as currently
// eligible by the real, authoritative funder eligible-claims response
// (audienceEligibility === "eligible", derived in annotateGovernedAvailability
// solely from the server's own eligible-claims result) - never inferred from
// libraryStatus, display status, review strings, blocker counts, or any
// other frontend-computed authority.
export function canSelectClaimForFunderGeneration(claim, audience) {
  return (
    audience === "funder"
    && claim?.governedAvailable === true
    && claim?.audienceEligibility === "eligible"
  );
}

// Organization change invalidates both the governed Claim Library and the
// audience-scoped eligibility dimension: every piece of organization-scoped
// state (including both loading flags) is reset here, in the transition
// itself, because no replacement request is automatically dispatched
// (the UX is click-to-load) and a stale response must not be relied on to
// restore a loading flag it no longer owns.
export function nextLibraryStateForOrganizationChange() {
  return {
    candidateClaims: [],
    eligibleClaims: [],
    candidateClaimsError: "",
    eligibleClaimsError: "",
    eligibleRequestState: "idle",
    loadingCandidateClaims: false,
    loadingEligibleClaims: false,
    selectedClaimId: "",
    selectedGenerationClaimIds: [],
    traceability: null,
    generatedDraftPacket: null,
  };
}

// Audience change invalidates only the audience-scoped eligibility
// dimension. The governed Claim Library (candidateClaims) is untouched:
// callers must not include it in the state they apply from this transition.
export function nextLibraryStateForAudienceChange() {
  return {
    eligibleClaims: [],
    eligibleClaimsError: "",
    eligibleRequestState: "idle",
    loadingEligibleClaims: false,
  };
}

// A Claim Library response may be applied only if it belongs to the
// generation and organization still current when it resolves.
export function shouldApplyCandidateResponse({
  requestGeneration,
  currentGeneration,
  requestOrganizationId,
  currentOrganizationId,
}) {
  return (
    requestGeneration === currentGeneration
    && requestOrganizationId === currentOrganizationId
  );
}

// An eligibility response may be applied only if it belongs to the
// generation, organization, AND audience still current when it resolves,
// so a late response from one audience can never be attached to another.
export function shouldApplyEligibilityResponse({
  requestGeneration,
  currentGeneration,
  requestOrganizationId,
  currentOrganizationId,
  requestAudience,
  currentAudience,
}) {
  return (
    requestGeneration === currentGeneration
    && requestOrganizationId === currentOrganizationId
    && requestAudience === currentAudience
  );
}

export function projectTraceability(dto) {
  if (!dto || typeof dto !== "object") return null;
  const dimensions = Object.entries(dto.dimensions || {}).map(([dimensionKey, value]) => ({
    dimensionKey,
    assessmentStatus: value?.assessment_status,
    validatorKey: value?.validator_key,
    internalLimitationAccepted: value?.internal_limitation_accepted === true,
    funderLimitationAccepted: value?.funder_limitation_accepted === true,
    blocksRequestedAudience: value?.blocks_requested_audience === true,
    displayStatus:
      value?.assessment_status === "unresolved" && value?.internal_limitation_accepted === true
        ? "known_limitation"
        : value?.assessment_status,
  }));
  return {
    requestedAudience: dto.requestedAudience,
    eligible: dto.eligible === true,
    blockerCodes: asArray(dto.blockerCodes),
    affectedDimensionKeys: asArray(dto.affectedDimensionKeys),
    affectedObjectIds: asArray(dto.affectedObjectIds),
    audienceGates: dto.claim?.audience_gates || {},
    claim: dto.claim || null,
    // KAI B1A-3B: intake_sensitivity_profile_id is server-grounded here - the
    // browser never manufactures it. null when the traceability DTO carries
    // no candidate object at all (should not happen for a valid response,
    // but this component must never fabricate an id if it did).
    candidate: dto.candidate || null,
    evidence: dto.evidence || null,
    source: dto.source || null,
    sourceVersion: dto.source_version || null,
    locator: dto.locator || null,
    claimReview: dto.claim_review || null,
    evidenceReviewDecision: dto.evidence_review_decision
      ? {
          decisionId: dto.evidence_review_decision.decision_id,
          decisionOutcome: dto.evidence_review_decision.decision_outcome,
        }
      : null,
    claimReviewDecision: dto.claim_review_decision
      ? {
          decisionId: dto.claim_review_decision.decision_id,
          decisionOutcome: dto.claim_review_decision.decision_outcome,
          approvedAudiences: asArray(dto.claim_review_decision.approved_audiences),
        }
      : null,
    dimensions,
    gapItems: asArray(dto.gap_items),
    clientFollowupWorkflows: asArray(dto.client_followup_workflows).map((item) => ({
      clientFollowupItemId: item.client_followup_item_id,
      gapLogItemId: item.gap_log_item_id,
      dimensionKey: item.dimension_key,
      workflowStatus: item.workflow_status,
      reviewStatus: item.review_status,
      reviewQueueItemId: item.review_queue_item_id,
      workflowDisposition: item.review_status === "resolved" ? "completed_workflow_obligation" : item.review_status,
      // Server-authoritative (postgresClaimTraceabilityRepository.js#safeFollowupRows)
      // - never re-derived here.
      isCurrent: item.is_current === true,
    })),
    potentialConflictGroups: asArray(dto.potential_conflict_groups),
    libraryStatus: dto.eligible === true ? "usable" : (asArray(dto.blockerCodes).length ? "blocked" : "needs_review"),
    truncated: dto.truncated === true,
  };
}

export function projectCoverageAssessment(dto) {
  if (!dto || typeof dto !== "object") return null;
  return {
    sourceVersionId: dto.source_version_id,
    dataDictionaryId: dto.data_dictionary_id,
    profileChecksum: dto.profile_canonical_sha256,
    dimensions: Object.entries(dto.dimensions || {}).map(([dimensionKey, value]) => ({
      dimensionKey,
      assessmentStatus: value?.assessment_status,
      summary: JSON.stringify(value),
    })),
  };
}

export function projectGeneratedDraftPacket(dto) {
  if (!dto || typeof dto !== "object") return null;
  return {
    generatedContentDraftId: dto.generatedContentDraftId,
    contentType: dto.contentType,
    draftStatus: dto.draftStatus,
    requestedAudience: dto.requestedAudience,
    reviewQueueItemId: dto.reviewQueueItemId,
    queueStatus: dto.queueStatus,
    reviewStatus: dto.reviewStatus,
    reviewUpdatedAt: dto.reviewUpdatedAt,
    currentUseEligible: dto.currentUseEligible === true,
    // Durable read recovery: the server's own already-recovered export-review
    // identity/state, allowlisted straight from this same read - never
    // re-derived from a prior POST response. `exportReviewVisible` is a
    // distinct, preserved "restricted" state (server withheld it because
    // this actor lacks export-review authority) - it must never be treated
    // the same as "no export review requested yet".
    exportReviewVisible: dto.exportReviewVisible === true,
    exportReviewQueueItemId: typeof dto.exportReviewQueueItemId === "string" ? dto.exportReviewQueueItemId : null,
    exportReviewQueueStatus: typeof dto.exportReviewQueueStatus === "string" ? dto.exportReviewQueueStatus : null,
    exportReviewStatus: typeof dto.exportReviewStatus === "string" ? dto.exportReviewStatus : null,
    blocks: asArray(dto.blocks).map((block) => ({
      ordinal: block?.ordinal,
      text: block?.text,
      citations: asArray(block?.citations).map((citation) => ({
        claimId: citation?.claimId,
        evidenceItemId: citation?.evidenceItemId,
        sourceId: citation?.sourceId,
        sourceCode: typeof citation?.sourceCode === "string" ? citation.sourceCode : null,
        sourceVersionId: citation?.sourceVersionId,
        supportStrength: citation?.supportStrength,
        claimReviewStatus: citation?.claimReviewStatus,
        evidenceReviewStatus: citation?.evidenceReviewStatus,
        currentEligible: citation?.currentEligible === true,
        blockerCodes: asArray(citation?.blockerCodes),
        affectedDimensionKeys: asArray(citation?.affectedDimensionKeys),
        affectedObjectIds: asArray(citation?.affectedObjectIds),
        // ALLOWED_AUDIENCE: the claim's current authoritative audience
        // approval - null (no decision/no approved_audiences yet) is a
        // distinct, preserved state, never coerced to an empty array.
        approvedAudiences: Array.isArray(citation?.approvedAudiences) ? asArray(citation.approvedAudiences) : null,
      })),
    })),
  };
}

export function projectGeneratedDraftLibraryItems(dto) {
  return asArray(dto?.items).map((item) => ({
    generatedContentDraftId: item.generatedContentDraftId,
    contentType: item.contentType,
    requestedAudience: item.requestedAudience,
    draftStatus: item.draftStatus,
    reviewQueueItemId: item.reviewQueueItemId,
    queueStatus: item.queueStatus,
    reviewStatus: item.reviewStatus,
    createdAt: item.createdAt,
    // Same allowlisted, server-already-recovered export-review identity/state
    // the single-draft packet carries (projectGeneratedDraftPacket above) -
    // never re-derived from any POST response, and exportReviewVisible stays
    // a distinct "restricted" state from the genuine "no export review yet"
    // absence (visible=true, id=null).
    exportReviewVisible: item.exportReviewVisible === true,
    exportReviewQueueItemId: typeof item.exportReviewQueueItemId === "string" ? item.exportReviewQueueItemId : null,
    exportReviewQueueStatus: typeof item.exportReviewQueueStatus === "string" ? item.exportReviewQueueStatus : null,
    exportReviewStatus: typeof item.exportReviewStatus === "string" ? item.exportReviewStatus : null,
  })).filter((item) => typeof item.generatedContentDraftId === "string");
}

export function generatedDraftReviewLabel(queueStatus, reviewStatus) {
  const key = `${queueStatus}/${reviewStatus}`;
  if (key === "open/needs_gk_review") return "Needs review";
  if (key === "in_progress/needs_gk_review") return "In review";
  if (key === "resolved/resolved") return "Review completed";
  return "Unknown review state";
}

export function generatedDraftContentTypeLabel(contentType, requestedAudience) {
  const audienceLabel = requestedAudience === "internal" ? "Internal" : requestedAudience || "Unknown audience";
  if (contentType === "evidence_summary") return `Evidence Summary · ${audienceLabel}`;
  if (contentType === "impact_narrative") return `Impact Narrative · ${audienceLabel}`;
  if (contentType === "readiness_assessment") return `Readiness Assessment · ${audienceLabel}`;
  if (contentType === "data_gap_memo") return `Data Gap Memo · ${audienceLabel}`;
  if (contentType === "case_for_support") return `Case for Support · ${audienceLabel}`;
  if (contentType === "board_update") return `Board Update · ${audienceLabel}`;
  if (contentType === "annual_report_section") return `Annual Report Section · ${audienceLabel}`;
  if (contentType === "funder_outcome_table") return `Funder Outcome Table · ${audienceLabel}`;
  if (contentType === "grant_response_paragraph") return `Grant Response Paragraph · ${audienceLabel}`;
  return `${contentType || "Generated draft"} · ${audienceLabel}`;
}

export function canStartGeneratedContentReview(packet) {
  return !!packet && packet.queueStatus === "open" && packet.reviewStatus === "needs_gk_review";
}

export function canCompleteGeneratedContentReview(packet) {
  return !!packet && packet.queueStatus === "in_progress" && packet.reviewStatus === "needs_gk_review";
}
