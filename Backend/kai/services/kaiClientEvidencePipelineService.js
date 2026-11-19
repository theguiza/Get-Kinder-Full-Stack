import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES, KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import {
  validateActorCanPerformOperation,
  validateActorCanPerformSensitivityReview,
} from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  getClientEvidencePipelineEngagement,
  listClientEvidencePipelineFiles,
} from "../db/kaiClientEvidencePipelineReadModel.js";
import { listClientImpactFacts } from "./kaiClientImpactFactsService.js";
import { authorizeSourcePromotionDecision } from "./kaiSourcePromotionService.js";
import { authorizeSourceCandidateContinuation } from "./kaiSourceCandidateService.js";
import { __evidenceLineageServiceContract } from "./kaiEvidenceLineageService.js";
import { __claimProposalServiceContract } from "./kaiClaimProposalService.js";
import { __sourceMeasurementServiceContract } from "./kaiSourceMeasurementService.js";
import { __parserRunRepositoryContract } from "../parsing/postgresParserRunRepository.js";
import { evidenceExtractionCapability } from "../validators/kaiDocumentEvidenceValidators.js";

/**
 * Client-safe file preparation and independent next permitted action for a
 * Project. Preparation is derived from persisted upload, processing, permission,
 * source and evidence state; optional quality reviews are not stages.
 * Usable findings come only from the existing governed impact-facts service,
 * intersected with this Project's lineage. Its failures fail this read closed.
 * Admission uses active same-organization read_intake membership, tenant and
 * engagement checks. Step authority reuses the governing services; every write
 * re-authorizes. No review or progress state is written here.
 * Never returns raw content, sensitivity values, review notes or queue metadata.
 * The current source version id is returned only for this actor's Count records.
 */
const CLIENT_EVIDENCE_PIPELINE_OPERATION = "read_client_evidence_pipeline";
const CLIENT_EVIDENCE_PIPELINE_ALLOWED_ROLES = new Set(KAI_SPRINT2_P0_OPERATION_ROLES.read_intake);
const CLIENT_EVIDENCE_PIPELINE_FILE_LIMIT = 100;
const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;

// Ordered stages of the governed workflow, as the client sees them.
const PIPELINE_STAGES = Object.freeze([
  "upload",
  "security_check",
  "processing",
  "data_dictionary",
  "sensitivity_classification",
  "sensitivity_review",
  "source_review",
  "evidence_extraction",
]);

const STAGE_STATUS = Object.freeze({
  complete: "complete",
  inProgress: "in_progress",
  notStarted: "not_started",
  waitingForClient: "waiting_for_client",
  waitingForGetKinder: "waiting_for_get_kinder",
  failed: "failed",
  closed: "closed",
  notCurrentlyEligible: "not_currently_eligible",
  unknown: "unknown",
});

const RESPONSIBLE = Object.freeze({ kai: "kai", client: "client", getKinder: "get_kinder", none: "none" });

// Profile formats Count records measures (a single-table CSV file, or one
// selected worksheet of an Excel workbook).
const RECORD_COUNTABLE_FORMATS = new Set(["csv", "xlsx"]);

const NEXT_ACTION = Object.freeze({
  none: "none",
  waitForProcessing: "none_waiting_for_kai_processing",
  waitForGetKinder: "none_waiting_for_get_kinder",
  answerClientFollowups: "answer_client_followups",
  uploadNewFile: "upload_new_file",
  contactGetKinder: "contact_get_kinder",
  promoteSource: "promote_source",
  extractEvidence: "extract_evidence",
  continueSourcePreparation: "continue_source_preparation",
  reviewSensitivity: "review_sensitivity",
  askOrganizationAdministrator: "ask_organization_administrator",
  retrySecurityCheck: "retry_security_check",
  proposeClaims: "propose_claims",
  countRecords: "count_records",
});

// Non-policy security assessment outcomes (boundedFileSecurityAssessor.js,
// policyFailureEligible: false): no scan result exists, so the file stays
// pending and quarantined. Confirming the upload again re-attempts the
// assessment (applyConfirmedSecurityAssessment); nothing else can move it.
const SECURITY_CHECK_RETRY_CATEGORIES = new Set([
  "malware_scan_unavailable",
  "malware_scan_not_configured",
  "maximum_concurrent_pdf_assessor_workers_exceeded",
]);

// Only these parser error codes are ever written (parserProfileWorkerOrchestration.js);
// anything else is reported as the generic category.
const PARSER_FAILURE_CATEGORY = Object.freeze({
  safe_parser_error: "file_could_not_be_read",
  byte_source_unavailable: "file_content_unavailable",
});

// Evidence tab explanation codes, in the order they are listed.
const PIPELINE_REASONS = Object.freeze([
  "waiting_for_client",
  "security_check_retry_ready",
  "failed",
  "processing",
  "waiting_for_get_kinder_review",
  "sensitivity_review_ready",
  "organization_administrator_action_ready",
  "allowed_use_not_allowed",
  "waiting_for_source_promotion",
  "source_promotion_ready",
  "source_preparation_ready",
  "source_candidate_missing",
  "source_promotion_blocked",
  "evidence_extraction_ready",
  "evidence_extraction_pending",
  "no_extractable_evidence",
  "document_evidence_not_enabled",
  "no_supportable_statements",
  "claim_proposal_ready",
  "source_measurement_ready",
  "worksheet_measurement_remaining",
  "service_measurement_remaining",
  "not_currently_eligible",
  "source_not_promoted",
  "unknown",
  "complete",
]);

class ClientPipelineProjectionError extends Error {}

const NO_CLIENT_AUTHORITY = Object.freeze({
  promoteSource: false,
  extractEvidence: false,
  continueSourcePreparation: false,
  reviewSensitivity: false,
  proposeClaims: false,
  recordSourceMeasurement: false,
  getKinderViewer: false,
});
const GK_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const EXTRACTION_ROLES = [...__evidenceLineageServiceContract.EVIDENCE_LINEAGE_ALLOWED_ROLES];
const CLIENT_EXTRACTION_ROLES = new Set(EXTRACTION_ROLES.filter((role) => role.startsWith("client_")));
const GK_EXTRACTION_ROLES = new Set(EXTRACTION_ROLES.filter((role) => !role.startsWith("client_")));
const PROPOSAL_ROLES = [...__claimProposalServiceContract.CLAIM_PROPOSAL_ALLOWED_ROLES];
const CLIENT_PROPOSAL_ROLES = new Set(PROPOSAL_ROLES.filter((role) => role.startsWith("client_")));
const GK_PROPOSAL_ROLES = new Set(PROPOSAL_ROLES.filter((role) => !role.startsWith("client_")));

/**
 * The organization-scoped client authority the requesting actor holds for a
 * pipeline step, from each governing service's own predicate: P1-08's
 * authorizeSourcePromotionDecision (its organization-administrator half only -
 * a GK decider is still Get Kinder), and P2-01's
 * role set restricted to its client roles (client_admin) for an actor that
 * does not also pass it as Get Kinder; and the source-preparation
 * continuation's authorizeSourceCandidateContinuation (organization
 * administrator only), and the sensitivity review's organization-administrator
 * half. `getKinderViewer` (any GK role in this organization, global or
 * organization-scoped) keeps the Get Kinder wording for a Get Kinder viewer of
 * the client surface. Object eligibility is still decided per file from
 * persisted state, and every write re-authorizes.
 */
function resolveClientAuthority(actorContext, organizationId) {
  const promotion = authorizeSourcePromotionDecision(actorContext, organizationId);
  const passesExtraction = (allowedRoles) => allowedRoles.size > 0 && validateActorCanPerformOperation(
    actorContext, __evidenceLineageServiceContract.EVIDENCE_LINEAGE_OPERATION, organizationId, { allowedRoles },
  ).ok === true;
  const passesProposal = (allowedRoles) => allowedRoles.size > 0 && validateActorCanPerformOperation(
    actorContext, __claimProposalServiceContract.CLAIM_PROPOSAL_OPERATION, organizationId, { allowedRoles },
  ).ok === true;
  return {
    promoteSource: promotion.ok === true && promotion.organizationAdminAuthorized === true,
    extractEvidence: passesExtraction(CLIENT_EXTRACTION_ROLES) && !passesExtraction(GK_EXTRACTION_ROLES),
    proposeClaims: passesProposal(CLIENT_PROPOSAL_ROLES) && !passesProposal(GK_PROPOSAL_ROLES),
    // The organization's own Count records (the same check its control
    // uses), by a client role of this organization - as proposeClaims and
    // extractEvidence decide it, a Get Kinder role held in the organization
    // is not told it is their step.
    recordSourceMeasurement: validateActorCanPerformOperation(
      actorContext, __sourceMeasurementServiceContract.SOURCE_MEASUREMENT_OPERATION, organizationId,
      { allowedRoles: new Set([...__sourceMeasurementServiceContract.SOURCE_MEASUREMENT_ALLOWED_ROLES].filter((role) => role.startsWith("client_"))) },
    ).ok === true && validateActorCanPerformOperation(
      actorContext, __sourceMeasurementServiceContract.SOURCE_MEASUREMENT_OPERATION, organizationId,
      { allowedRoles: new Set([...__sourceMeasurementServiceContract.SOURCE_MEASUREMENT_ALLOWED_ROLES].filter((role) => !role.startsWith("client_"))) },
    ).ok !== true,
    continueSourcePreparation: authorizeSourceCandidateContinuation(actorContext, organizationId).ok === true,
    reviewSensitivity: validateActorCanPerformSensitivityReview(
      actorContext, "record_sensitivity_allowed_use_decision", organizationId, GK_ROLES, { globalRolesOnly: true },
    ).organizationAdminAuthorized === true,
    getKinderViewer: validateActorCanPerformOperation(
      actorContext, "read_intake", organizationId, { allowedRoles: GK_ROLES, combineGlobalRoles: true },
    ).ok === true,
  };
}

/**
 * Who a step the organization's administrator may take waits on, for a
 * viewer who cannot take it (owner decision 2026-10-19): the organization's
 * administrator when the organization has one (`organization_administrator_available`,
 * never returned) and the viewer is not Get Kinder; otherwise the existing
 * Get Kinder state.
 */
function waitingOnAdministratorOr(row, clientAuthority, key, fallback) {
  if (row.organization_administrator_available === true && clientAuthority.getKinderViewer !== true) {
    return stage(key, STAGE_STATUS.waitingForClient, RESPONSIBLE.client, {
      ...(fallback.count === undefined ? {} : { count: fallback.count }),
      detail: "organization_administrator_action_ready",
    });
  }
  return fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalUuid(value) {
  return typeof value === "string" && value === value.toLowerCase() && UUID_RE.test(value);
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && typeof actorContext?.actorUserId === "string" && actorContext.actorUserId.length > 0;
}

function isClientEvidencePipelineInput(value) {
  const allowedKeys = new Set(["organizationId", "engagementId", "actorContext"]);
  return (
    isPlainObject(value)
    && Object.keys(value).every((key) => allowedKeys.has(key))
    && isCanonicalUuid(value.organizationId)
    && isCanonicalUuid(value.engagementId)
    && isPlainObject(value.actorContext)
  );
}

function count(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new ClientPipelineProjectionError("invalid count");
  return n;
}

function stage(key, status, responsible, extra = {}) {
  return { key, status, responsible, ...extra };
}

/**
 * Derives the ordered stage list from one lineage row. Stages after the
 * first blocking stage are "not_started" (nothing downstream can exist
 * without it); a downstream object that exists anyway is still counted.
 */
function deriveFileStages(row, clientAuthority = NO_CLIENT_AUTHORITY) {
  const stages = [];
  const upload = row.upload_state;
  if (upload === "confirmed") stages.push(stage("upload", STAGE_STATUS.complete, RESPONSIBLE.none));
  else if (upload === "policy_blocked") {
    stages.push(stage("upload", STAGE_STATUS.failed, RESPONSIBLE.client, { failureCategory: "file_blocked_by_policy" }));
  } else if (upload === "abandoned" || upload === "expired") {
    stages.push(stage("upload", STAGE_STATUS.failed, RESPONSIBLE.client, { failureCategory: "upload_not_completed" }));
  } else if (["reserved", "upload_started", "uploaded_unconfirmed"].includes(upload) && row.upload_window_lapsed === true) {
    // Its upload window ended: it can never be continued, only uploaded again.
    stages.push(stage("upload", STAGE_STATUS.failed, RESPONSIBLE.client, { failureCategory: "upload_not_completed" }));
  } else if (["reserved", "upload_started", "uploaded_unconfirmed"].includes(upload)) {
    stages.push(stage("upload", STAGE_STATUS.inProgress, RESPONSIBLE.client));
  } else {
    stages.push(stage("upload", STAGE_STATUS.unknown, RESPONSIBLE.none));
  }
  if (stages.at(-1).status !== STAGE_STATUS.complete) return stages;

  const policy = row.file_policy_status;
  if (policy === "passed") stages.push(stage("security_check", STAGE_STATUS.complete, RESPONSIBLE.none));
  else if (policy === "blocked") {
    stages.push(stage("security_check", STAGE_STATUS.failed, RESPONSIBLE.client, { failureCategory: "file_blocked_by_policy" }));
  } else if (policy === "failed") {
    // The assessment itself did not complete; replacing the file is not a
    // remedy the client can be told to apply.
    stages.push(stage("security_check", STAGE_STATUS.failed, RESPONSIBLE.getKinder, { failureCategory: "security_check_failed" }));
  } else if ((policy === null || policy === undefined || policy === "pending")
    && SECURITY_CHECK_RETRY_CATEGORIES.has(row.security_assessment_pending_category)) {
    // The check could not run; the file is not passed and stays quarantined.
    // Not "KAI is processing": nothing will happen until it is re-attempted.
    stages.push(stage("security_check", STAGE_STATUS.waitingForClient, RESPONSIBLE.client, {
      detail: "security_check_retry_ready",
      failureCategory: "security_check_unavailable",
    }));
  } else if (policy === null || policy === undefined || policy === "pending") {
    stages.push(stage("security_check", STAGE_STATUS.inProgress, RESPONSIBLE.kai));
  } else {
    stages.push(stage("security_check", STAGE_STATUS.unknown, RESPONSIBLE.none));
  }
  if (stages.at(-1).status !== STAGE_STATUS.complete) return stages;

  const parser = row.parser_status;
  if (parser === "completed" && row.file_profile_complete === true) {
    stages.push(stage("processing", STAGE_STATUS.complete, RESPONSIBLE.none));
  } else if (parser === null || parser === undefined) {
    stages.push(stage("processing", STAGE_STATUS.notStarted, RESPONSIBLE.kai));
  } else if (parser === "queued" || parser === "running") {
    stages.push(stage("processing", STAGE_STATUS.inProgress, RESPONSIBLE.kai));
  } else if (
    parser === "failed"
    && __parserRunRepositoryContract.AUTOMATIC_PARSER_RETRY_ERROR_CODES.includes(row.parser_error_code)
    && Number(row.parser_retry_count) < __parserRunRepositoryContract.MAX_PARSER_RETRY_COUNT
  ) {
    // An infrastructure-only read failure with retry budget left: the P1
    // worker retries it automatically after its cooldown.
    stages.push(stage("processing", STAGE_STATUS.inProgress, RESPONSIBLE.kai));
  } else if (parser === "failed" || parser === "cancelled") {
    stages.push(stage("processing", STAGE_STATUS.failed, RESPONSIBLE.getKinder, {
      failureCategory: parser === "cancelled"
        ? "processing_cancelled"
        : (PARSER_FAILURE_CATEGORY[row.parser_error_code] || "processing_failed"),
    }));
  } else {
    stages.push(stage("processing", STAGE_STATUS.unknown, RESPONSIBLE.none));
  }
  if (stages.at(-1).status !== STAGE_STATUS.complete) return stages;

  // P1-04 and P1-05 run in the same automatic worker pass after the profile.
  stages.push(row.data_dictionary_complete === true
    ? stage("data_dictionary", STAGE_STATUS.complete, RESPONSIBLE.none)
    : stage("data_dictionary", STAGE_STATUS.inProgress, RESPONSIBLE.kai));
  if (stages.at(-1).status !== STAGE_STATUS.complete) return stages;
  stages.push(row.sensitivity_profile_complete === true
    ? stage("sensitivity_classification", STAGE_STATUS.complete, RESPONSIBLE.none)
    : stage("sensitivity_classification", STAGE_STATUS.inProgress, RESPONSIBLE.kai));
  if (stages.at(-1).status !== STAGE_STATUS.complete) return stages;

  // Human gates from here on. The decision outcome itself is never returned.
  // The sensitivity review is the organization administrator's own step
  // (owner decisions 2026-10-12 and 2026-10-19).
  if (row.sensitivity_decision_outcome === "reviewed") {
    stages.push(stage("sensitivity_review", STAGE_STATUS.complete, RESPONSIBLE.none));
  } else if (clientAuthority.reviewSensitivity) {
    stages.push(stage("sensitivity_review", STAGE_STATUS.waitingForClient, RESPONSIBLE.client, { detail: "sensitivity_review_ready" }));
  } else {
    stages.push(waitingOnAdministratorOr(row, clientAuthority, "sensitivity_review",
      stage("sensitivity_review", STAGE_STATUS.waitingForGetKinder, RESPONSIBLE.getKinder)));
  }
  if (stages.at(-1).status !== STAGE_STATUS.complete) return stages;

  // VAL-KAI-B1A-02-003: a file whose effective allowed use is not_allowed is
  // intentionally not prepared as a source; only a new human sensitivity
  // decision changes that. Nobody's next action, and not a Get Kinder wait.
  const allowedUseClosed = row.effective_allowed_use_not_allowed === true;

  const promoted = count(row.source_candidate_promoted_count);
  const candidates = count(row.source_candidate_count);
  const rejected = count(row.source_candidate_rejected_count);
  if (promoted > 0 && count(row.source_version_count) > 0) {
    stages.push(stage("source_review", STAGE_STATUS.complete, RESPONSIBLE.none));
  } else if (allowedUseClosed) {
    stages.push(stage("source_review", STAGE_STATUS.closed, RESPONSIBLE.none, { detail: "allowed_use_not_allowed" }));
  } else if (candidates > 0 && rejected === candidates) {
    stages.push(stage("source_review", STAGE_STATUS.closed, RESPONSIBLE.none));
  } else if (candidates === 0) {
    // A reviewed sensitivity decision with no P1-07 candidate: nothing exists
    // to promote; the handoff did not create one. Any organization
    // administrator can continue a file whose committed state makes it eligible.
    const continuable = row.source_candidate_continuation_ready === true && row.sensitivity_permission_predicate === true;
    const missing = stage("source_review", STAGE_STATUS.waitingForGetKinder, RESPONSIBLE.getKinder, { detail: "source_candidate_missing" });
    if (continuable && clientAuthority.continueSourcePreparation) {
      stages.push(stage("source_review", STAGE_STATUS.waitingForClient, RESPONSIBLE.client, { detail: "source_preparation_ready" }));
    } else {
      stages.push(continuable ? waitingOnAdministratorOr(row, clientAuthority, "source_review", missing) : missing);
    }
  } else if (row.sensitivity_permission_predicate !== true) {
    // VAL-KAI-P1-08-002 would refuse any promotion of this candidate.
    stages.push(stage("source_review", STAGE_STATUS.waitingForGetKinder, RESPONSIBLE.getKinder, { detail: "source_promotion_blocked" }));
  } else if (count(row.source_candidate_actionable_count) > 0) {
    stages.push(clientAuthority.promoteSource
      ? stage("source_review", STAGE_STATUS.waitingForClient, RESPONSIBLE.client, { detail: "source_promotion_ready" })
      : waitingOnAdministratorOr(row, clientAuthority, "source_review",
        stage("source_review", STAGE_STATUS.waitingForGetKinder, RESPONSIBLE.getKinder)));
  } else {
    // A candidate exists but no P1-08 decision can act on it now (for example
    // a promoted candidate whose source version is not current).
    stages.push(stage("source_review", STAGE_STATUS.waitingForGetKinder, RESPONSIBLE.getKinder, { detail: "source_promotion_blocked" }));
  }
  if (stages.at(-1).status !== STAGE_STATUS.complete) return stages;

  const evidence = count(row.evidence_item_count);
  const extractionCapability = evidenceExtractionCapability({
    profileFormat: row.current_profile_format,
    dictionaryFieldCount: row.current_dictionary_field_count,
    documentEvidenceSupported: row.document_evidence_supported,
    documentStatementsNoneFound: row.current_document_statements_none_found,
  });
  if (allowedUseClosed) {
    // A source promoted before its allowed use became not_allowed: P2-01 refuses it.
    stages.push(stage("evidence_extraction", STAGE_STATUS.closed, RESPONSIBLE.none, { count: 0, detail: "allowed_use_not_allowed" }));
  } else if (evidence > 0) {
    stages.push(stage("evidence_extraction", STAGE_STATUS.complete, RESPONSIBLE.none, { count: evidence }));
  } else if (extractionCapability === "document_statements_not_enabled") {
    // A PDF or plain-text document is read for its statements; until the
    // document-evidence schema change is installed that extraction cannot
    // write, so it is not offered as a step waiting on anyone.
    stages.push(stage("evidence_extraction", STAGE_STATUS.closed, RESPONSIBLE.none, { count: 0, detail: "document_evidence_not_enabled" }));
  } else if (extractionCapability === "document_statements_none_found") {
    // The document's text was already read by this extractor method and held
    // no complete statement it could cite: extracting again would write nothing.
    stages.push(stage("evidence_extraction", STAGE_STATUS.closed, RESPONSIBLE.none, { count: 0, detail: "no_supportable_statements" }));
  } else if (extractionCapability === "none") {
    // Not a document, and no committed data-dictionary field: P2-01 composes
    // one evidence item per field, so extraction could never write anything.
    stages.push(stage("evidence_extraction", STAGE_STATUS.closed, RESPONSIBLE.none, { count: 0, detail: "no_extractable_evidence" }));
  } else if (clientAuthority.extractEvidence) {
    stages.push(stage("evidence_extraction", STAGE_STATUS.waitingForClient, RESPONSIBLE.client, { count: 0, detail: "evidence_extraction_ready" }));
  } else {
    stages.push(waitingOnAdministratorOr(row, clientAuthority, "evidence_extraction",
      stage("evidence_extraction", STAGE_STATUS.waitingForGetKinder, RESPONSIBLE.getKinder, { count: 0 })));
  }
  if (stages.at(-1).status !== STAGE_STATUS.complete) return stages;

  return stages;
}

// Preparation and subsequent work are independent. Optional evidence/claim
// reviews and questions never manufacture an incomplete preparation stage.
// All writes still enforce their own authority, lineage and permission rules.
function nextEvidenceWork(row, usableFactCount, clientAuthority) {
  // Substantive service-delivery findings (a CSV service log, or a worksheet
  // counted in unmeasured_worksheet_count) remain until their required set is
  // saved; they come before a raw-count claim proposal or completion.
  const serviceRemaining = count(row.service_worksheet_remaining_count ?? 0) > 0 || row.csv_service_measurement_remaining === true;
  const remainingWorksheets = count(row.unmeasured_worksheet_count) > 0 || serviceRemaining;
  if (usableFactCount > 0 && !remainingWorksheets) return null;
  const incompletePlans = count(row.incomplete_planning_worksheet_count ?? 0) > 0;
  const proposalReady = !incompletePlans && !serviceRemaining && count(row.evidence_unclaimed_proposable_count) > 0;
  const measurementReady = !proposalReady && (count(row.claim_count) === 0 || remainingWorksheets)
    && RECORD_COUNTABLE_FORMATS.has(row.current_profile_format)
    && isCanonicalUuid(row.current_source_version_id);
  if (!proposalReady && !measurementReady) return null;
  const authorized = proposalReady ? clientAuthority.proposeClaims : clientAuthority.recordSourceMeasurement;
  return {
    nextAction: authorized ? (proposalReady ? NEXT_ACTION.proposeClaims : NEXT_ACTION.countRecords)
      : NEXT_ACTION.askOrganizationAdministrator,
    reason: authorized ? (proposalReady ? "claim_proposal_ready" : serviceRemaining ? "service_measurement_remaining"
      : remainingWorksheets && count(row.claim_count) > 0 ? "worksheet_measurement_remaining" : "source_measurement_ready")
      : "organization_administrator_action_ready",
    responsibleParty: RESPONSIBLE.client,
  };
}

function reasonForCurrentStage(current) {
  if (!current) return "complete";
  const { key, status } = current;
  if (status === STAGE_STATUS.complete) return "complete";
  if (current.detail) return current.detail;
  if (status === STAGE_STATUS.failed) return "failed";
  if (status === STAGE_STATUS.waitingForClient) return "waiting_for_client";
  if (status === STAGE_STATUS.unknown) return "unknown";
  if (status === STAGE_STATUS.inProgress || status === STAGE_STATUS.notStarted) return "processing";
  if (key === "sensitivity_review") return "waiting_for_get_kinder_review";
  if (key === "source_review") return status === STAGE_STATUS.closed ? "source_not_promoted" : "waiting_for_source_promotion";
  if (key === "evidence_extraction") return "evidence_extraction_pending";
  return "unknown";
}

function nextActionFor(current) {
  if (!current || current.status === STAGE_STATUS.complete) return NEXT_ACTION.none;
  switch (current.status) {
    case STAGE_STATUS.waitingForClient:
      if (current.detail === "source_promotion_ready") return NEXT_ACTION.promoteSource;
      if (current.detail === "source_preparation_ready") return NEXT_ACTION.continueSourcePreparation;
      if (current.detail === "evidence_extraction_ready") return NEXT_ACTION.extractEvidence;
      if (current.detail === "sensitivity_review_ready") return NEXT_ACTION.reviewSensitivity;
      if (current.detail === "organization_administrator_action_ready") return NEXT_ACTION.askOrganizationAdministrator;
      if (current.detail === "security_check_retry_ready") return NEXT_ACTION.retrySecurityCheck;
      return NEXT_ACTION.answerClientFollowups;
    case STAGE_STATUS.failed:
      return current.responsible === RESPONSIBLE.getKinder ? NEXT_ACTION.contactGetKinder : NEXT_ACTION.uploadNewFile;
    case STAGE_STATUS.inProgress:
    case STAGE_STATUS.notStarted:
      return current.responsible === RESPONSIBLE.kai ? NEXT_ACTION.waitForProcessing : NEXT_ACTION.none;
    case STAGE_STATUS.waitingForGetKinder:
      if (current.detail === "source_candidate_missing" || current.detail === "source_promotion_blocked") {
        return NEXT_ACTION.contactGetKinder;
      }
      return NEXT_ACTION.waitForGetKinder;
    case STAGE_STATUS.notCurrentlyEligible:
      return NEXT_ACTION.waitForGetKinder;
    default:
      return NEXT_ACTION.none;
  }
}

/**
 * Pure projection of one lineage row plus the set of governed-eligible claim
 * ids. Exported for tests.
 */
function projectPipelineFile(row, eligibleClaimIds, clientAuthority = NO_CLIENT_AUTHORITY) {
  if (!isPlainObject(row) || !isCanonicalUuid(row.intake_file_id)) {
    throw new ClientPipelineProjectionError("invalid file row");
  }
  const claimIds = Array.isArray(row.claim_ids) ? row.claim_ids : [];
  const reviewedImpactFactClaimIds = claimIds.filter((claimId) => eligibleClaimIds.has(claimId));
  const stages = deriveFileStages(row, clientAuthority);
  const current = stages.find((entry) => entry.status !== STAGE_STATUS.complete) || null;
  const evidenceWork = current ? null : nextEvidenceWork(row, reviewedImpactFactClaimIds.length, clientAuthority);
  const nextAction = evidenceWork?.nextAction ?? nextActionFor(current);
  // `detail` is internal to the derivation (it becomes `reason`); stages carry
  // only key, status, responsible, and the optional count / failure category.
  const fullStages = PIPELINE_STAGES.map((key) => stages.find((entry) => entry.key === key)
    || stage(key, STAGE_STATUS.notStarted, RESPONSIBLE.none))
    .map(({ detail, ...rest }) => rest);
  return {
    file: {
      intakeFileId: row.intake_file_id,
      safeFilename: typeof row.safe_filename === "string" ? row.safe_filename : null,
      uploadedAt: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ?? null),
      stages: fullStages,
      currentStage: current ? current.key : null,
      currentStatus: current ? current.status : STAGE_STATUS.complete,
      responsibleParty: current ? current.responsible : (evidenceWork?.responsibleParty ?? RESPONSIBLE.none),
      nextAction,
      failureCategory: current?.failureCategory || null,
      reason: evidenceWork?.reason ?? reasonForCurrentStage(current),
      evidenceItemCount: count(row.evidence_item_count),
      reviewedImpactFactCount: reviewedImpactFactClaimIds.length,
      // Only on this actor's own Count records step: the source version that
      // step opens. No other file or reader receives a source version id.
      ...(nextAction === NEXT_ACTION.countRecords && isCanonicalUuid(row.current_source_version_id)
        ? { currentSourceVersionId: row.current_source_version_id } : {}),
    },
    reviewedImpactFactClaimIds,
  };
}

function summarize(files) {
  const counts = new Map();
  for (const file of files) counts.set(file.reason, (counts.get(file.reason) || 0) + 1);
  return PIPELINE_REASONS.filter((reason) => counts.has(reason)).map((reason) => ({ reason, fileCount: counts.get(reason) }));
}

export async function getClientEvidencePipeline(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isClientEvidencePipelineInput(input)) {
    return buildKaiError("validation_blocker");
  }
  const { actorContext, organizationId, engagementId } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }
  const auth = validateActorCanPerformOperation(
    actorContext,
    CLIENT_EVIDENCE_PIPELINE_OPERATION,
    organizationId,
    { allowedRoles: CLIENT_EVIDENCE_PIPELINE_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }
  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const readEngagement = dependencies.getClientEvidencePipelineEngagement || getClientEvidencePipelineEngagement;
  const readFiles = dependencies.listClientEvidencePipelineFiles || listClientEvidencePipelineFiles;
  const readImpactFacts = dependencies.listClientImpactFacts || listClientImpactFacts;

  const engagement = await readEngagement(organizationId, engagementId);
  if (!engagement || engagement.organization_id !== organizationId || engagement.engagement_id !== engagementId) {
    return buildKaiError("not_found");
  }

  const rows = await readFiles(organizationId, engagementId, {
    limit: CLIENT_EVIDENCE_PIPELINE_FILE_LIMIT + 1,
    actorUserId: actorContext.actorUserId,
  });
  if (!Array.isArray(rows)) return buildKaiError("system_error");
  const truncated = rows.length > CLIENT_EVIDENCE_PIPELINE_FILE_LIMIT;
  const pageRows = rows.slice(0, CLIENT_EVIDENCE_PIPELINE_FILE_LIMIT);

  // The governed eligible-claim read runs only when this Project's lineage
  // has a claim at all; its failure fails this read closed.
  let eligibleFacts = [];
  let factsTruncated = false;
  if (pageRows.some((row) => Array.isArray(row?.claim_ids) && row.claim_ids.length > 0)) {
    const factsResult = await readImpactFacts({ organizationId, actorContext }, dependencies);
    if (!factsResult?.ok) return buildKaiError(factsResult?.error?.code || "system_error");
    eligibleFacts = Array.isArray(factsResult.data?.items) ? factsResult.data.items : null;
    if (!eligibleFacts) return buildKaiError("system_error");
    factsTruncated = factsResult.data.truncated === true;
  }
  const eligibleClaimIds = new Set(eligibleFacts.map((fact) => fact.claimId));

  const clientAuthority = resolveClientAuthority(actorContext, organizationId);
  try {
    const files = [];
    const projectClaimIds = new Set();
    for (const row of pageRows) {
      const projected = projectPipelineFile(row, eligibleClaimIds, clientAuthority);
      files.push(projected.file);
      for (const claimId of projected.reviewedImpactFactClaimIds) projectClaimIds.add(claimId);
    }
    const reviewedImpactFacts = eligibleFacts
      .filter((fact) => projectClaimIds.has(fact.claimId))
      .map((fact) => ({
        claimId: fact.claimId,
        statement: fact.statement ?? null,
        claimType: fact.claimType ?? null,
        limitationDimensionKeys: Array.isArray(fact.limitationDimensionKeys) ? [...fact.limitationDimensionKeys] : [],
      }));
    return {
      ok: true,
      data: {
        engagementId,
        files,
        truncated,
        summary: {
          fileCount: files.length,
          reasons: summarize(files),
          reviewedImpactFactCount: reviewedImpactFacts.length,
        },
        reviewedImpactFacts,
        reviewedImpactFactsTruncated: factsTruncated,
      },
      error: null,
    };
  } catch (error) {
    if (error instanceof ClientPipelineProjectionError) return buildKaiError("system_error");
    throw error;
  }
}

export const __clientEvidencePipelineServiceContract = Object.freeze({
  CLIENT_EVIDENCE_PIPELINE_OPERATION,
  CLIENT_EVIDENCE_PIPELINE_ALLOWED_ROLES,
  CLIENT_EVIDENCE_PIPELINE_FILE_LIMIT,
  PIPELINE_STAGES,
  STAGE_STATUS,
  RESPONSIBLE,
  NEXT_ACTION,
  PIPELINE_REASONS,
  PARSER_FAILURE_CATEGORY,
  projectPipelineFile,
  resolveClientAuthority,
});
