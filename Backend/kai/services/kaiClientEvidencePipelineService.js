import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES, KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  getClientEvidencePipelineEngagement,
  listClientEvidencePipelineFiles,
} from "../db/kaiClientEvidencePipelineReadModel.js";
import { listClientImpactFacts } from "./kaiClientImpactFactsService.js";

/**
 * Client-safe evidence pipeline for one organization + engagement/project:
 * where each of the Project's uploaded files currently is in the governed
 * intake -> source -> evidence -> reviewed Impact Fact workflow, who it is
 * waiting on, and the reviewed Impact Facts that descend from those files.
 *
 * Every stage is derived from persisted objects only (the file's upload and
 * policy state, its current parser run, profile, data dictionary,
 * sensitivity profile, current sensitivity decision, source candidates,
 * current source versions, evidence items, claims, and open client
 * follow-ups; see kaiClientEvidencePipelineReadModel.js). No stage is
 * advanced here and no review is performed. The GK review gates stay GK
 * work: the client is told only that a Get Kinder review is pending.
 *
 * Never returned: file content, profile/dictionary/sensitivity values,
 * sensitivity decision outcomes, evidence or claim statements for anything
 * not governed-eligible, reviewer identities, notes, queue ids or metadata,
 * source/version/evidence ids, or parser error messages. Parser failures are
 * reduced to a fixed safe category.
 *
 * Reviewed Impact Facts come only from listClientImpactFacts (the same
 * P2-08 governed internal-audience evaluator and projection as the client
 * impact-facts read), intersected with the claims in this Project's file
 * lineage. A failure of that read fails this read closed; it is never
 * reported as zero.
 *
 * Admission reuses the read_intake role set for an active same-org member,
 * then tenant validation, then the engagement is checked against the
 * organization before any file read. No role, membership, or review
 * authority is granted here.
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
  "evidence_review",
  "impact_fact_review",
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

const NEXT_ACTION = Object.freeze({
  none: "none",
  waitForProcessing: "none_waiting_for_kai_processing",
  waitForGetKinder: "none_waiting_for_get_kinder",
  answerClientFollowups: "answer_client_followups",
  uploadNewFile: "upload_new_file",
  contactGetKinder: "contact_get_kinder",
});

// Only these parser error codes are ever written (parserProfileWorkerOrchestration.js);
// anything else is reported as the generic category.
const PARSER_FAILURE_CATEGORY = Object.freeze({
  safe_parser_error: "file_could_not_be_read",
  byte_source_unavailable: "file_content_unavailable",
});

// Evidence tab explanation codes, in the order they are listed.
const PIPELINE_REASONS = Object.freeze([
  "waiting_for_client",
  "failed",
  "processing",
  "waiting_for_get_kinder_review",
  "waiting_for_source_promotion",
  "evidence_extraction_pending",
  "evidence_awaiting_review",
  "impact_fact_review_pending",
  "not_currently_eligible",
  "source_not_promoted",
  "unknown",
  "complete",
]);

class ClientPipelineProjectionError extends Error {}

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
function deriveFileStages(row, reviewedImpactFactCount) {
  const stages = [];
  const upload = row.upload_state;
  if (upload === "confirmed") stages.push(stage("upload", STAGE_STATUS.complete, RESPONSIBLE.none));
  else if (upload === "policy_blocked") {
    stages.push(stage("upload", STAGE_STATUS.failed, RESPONSIBLE.client, { failureCategory: "file_blocked_by_policy" }));
  } else if (upload === "abandoned" || upload === "expired") {
    stages.push(stage("upload", STAGE_STATUS.failed, RESPONSIBLE.client, { failureCategory: "upload_not_completed" }));
  } else if (["reserved", "upload_started", "uploaded_unconfirmed"].includes(upload)) {
    stages.push(stage("upload", STAGE_STATUS.inProgress, RESPONSIBLE.client));
  } else {
    stages.push(stage("upload", STAGE_STATUS.unknown, RESPONSIBLE.none));
  }
  if (stages.at(-1).status !== STAGE_STATUS.complete) return stages;

  const policy = row.file_policy_status;
  if (policy === "passed") stages.push(stage("security_check", STAGE_STATUS.complete, RESPONSIBLE.none));
  else if (policy === "blocked" || policy === "failed") {
    stages.push(stage("security_check", STAGE_STATUS.failed, RESPONSIBLE.client, {
      failureCategory: policy === "blocked" ? "file_blocked_by_policy" : "security_check_failed",
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
  stages.push(row.sensitivity_decision_outcome === "reviewed"
    ? stage("sensitivity_review", STAGE_STATUS.complete, RESPONSIBLE.none)
    : stage("sensitivity_review", STAGE_STATUS.waitingForGetKinder, RESPONSIBLE.getKinder));
  if (stages.at(-1).status !== STAGE_STATUS.complete) return stages;

  const promoted = count(row.source_candidate_promoted_count);
  const candidates = count(row.source_candidate_count);
  const rejected = count(row.source_candidate_rejected_count);
  if (promoted > 0 && count(row.source_version_count) > 0) {
    stages.push(stage("source_review", STAGE_STATUS.complete, RESPONSIBLE.none));
  } else if (candidates > 0 && rejected === candidates) {
    stages.push(stage("source_review", STAGE_STATUS.closed, RESPONSIBLE.none));
  } else {
    stages.push(stage("source_review", STAGE_STATUS.waitingForGetKinder, RESPONSIBLE.getKinder));
  }
  if (stages.at(-1).status !== STAGE_STATUS.complete) return stages;

  const evidence = count(row.evidence_item_count);
  stages.push(evidence > 0
    ? stage("evidence_extraction", STAGE_STATUS.complete, RESPONSIBLE.none, { count: evidence })
    : stage("evidence_extraction", STAGE_STATUS.waitingForGetKinder, RESPONSIBLE.getKinder, { count: 0 }));
  if (stages.at(-1).status !== STAGE_STATUS.complete) return stages;

  const evidenceNeedsReview = count(row.evidence_needs_review_count);
  stages.push(evidenceNeedsReview > 0
    ? stage("evidence_review", STAGE_STATUS.waitingForGetKinder, RESPONSIBLE.getKinder, { count: evidenceNeedsReview })
    : stage("evidence_review", STAGE_STATUS.complete, RESPONSIBLE.none, { count: count(row.evidence_reviewed_count) }));
  if (stages.at(-1).status !== STAGE_STATUS.complete) return stages;

  const openFollowups = count(row.open_client_followup_count);
  const claims = count(row.claim_count);
  // An open client follow-up is client work still to do, even when another
  // claim from the same file is already usable.
  if (openFollowups > 0) {
    stages.push(stage("impact_fact_review", STAGE_STATUS.waitingForClient, RESPONSIBLE.client, { count: openFollowups }));
  } else if (reviewedImpactFactCount > 0) {
    stages.push(stage("impact_fact_review", STAGE_STATUS.complete, RESPONSIBLE.none, { count: reviewedImpactFactCount }));
  } else if (claims === 0 || count(row.claim_needs_review_count) > 0) {
    stages.push(stage("impact_fact_review", STAGE_STATUS.waitingForGetKinder, RESPONSIBLE.getKinder, { count: 0 }));
  } else {
    // Every claim is reviewed and none is currently governed-eligible; the
    // evaluator's blocker detail is GK-internal and is not returned.
    stages.push(stage("impact_fact_review", STAGE_STATUS.notCurrentlyEligible, RESPONSIBLE.getKinder, { count: 0 }));
  }
  return stages;
}

function reasonForCurrentStage(current) {
  if (!current) return "complete";
  const { key, status } = current;
  if (status === STAGE_STATUS.complete) return "complete";
  if (status === STAGE_STATUS.failed) return "failed";
  if (status === STAGE_STATUS.waitingForClient) return "waiting_for_client";
  if (status === STAGE_STATUS.unknown) return "unknown";
  if (status === STAGE_STATUS.inProgress || status === STAGE_STATUS.notStarted) return "processing";
  if (key === "sensitivity_review") return "waiting_for_get_kinder_review";
  if (key === "source_review") return status === STAGE_STATUS.closed ? "source_not_promoted" : "waiting_for_source_promotion";
  if (key === "evidence_extraction") return "evidence_extraction_pending";
  if (key === "evidence_review") return "evidence_awaiting_review";
  if (key === "impact_fact_review") {
    return status === STAGE_STATUS.notCurrentlyEligible ? "not_currently_eligible" : "impact_fact_review_pending";
  }
  return "unknown";
}

function nextActionFor(current) {
  if (!current || current.status === STAGE_STATUS.complete) return NEXT_ACTION.none;
  switch (current.status) {
    case STAGE_STATUS.waitingForClient:
      return NEXT_ACTION.answerClientFollowups;
    case STAGE_STATUS.failed:
      return current.key === "processing" ? NEXT_ACTION.contactGetKinder : NEXT_ACTION.uploadNewFile;
    case STAGE_STATUS.inProgress:
    case STAGE_STATUS.notStarted:
      return current.responsible === RESPONSIBLE.kai ? NEXT_ACTION.waitForProcessing : NEXT_ACTION.none;
    case STAGE_STATUS.waitingForGetKinder:
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
function projectPipelineFile(row, eligibleClaimIds) {
  if (!isPlainObject(row) || !isCanonicalUuid(row.intake_file_id)) {
    throw new ClientPipelineProjectionError("invalid file row");
  }
  const claimIds = Array.isArray(row.claim_ids) ? row.claim_ids : [];
  const reviewedImpactFactClaimIds = claimIds.filter((claimId) => eligibleClaimIds.has(claimId));
  const stages = deriveFileStages(row, reviewedImpactFactClaimIds.length);
  const current = stages.find((entry) => entry.status !== STAGE_STATUS.complete) || null;
  const fullStages = PIPELINE_STAGES.map((key) => stages.find((entry) => entry.key === key)
    || stage(key, STAGE_STATUS.notStarted, RESPONSIBLE.none));
  return {
    file: {
      intakeFileId: row.intake_file_id,
      safeFilename: typeof row.safe_filename === "string" ? row.safe_filename : null,
      uploadedAt: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ?? null),
      stages: fullStages,
      currentStage: current ? current.key : null,
      currentStatus: current ? current.status : STAGE_STATUS.complete,
      responsibleParty: current ? current.responsible : RESPONSIBLE.none,
      nextAction: nextActionFor(current),
      failureCategory: current?.failureCategory || null,
      reason: reasonForCurrentStage(current),
      evidenceItemCount: count(row.evidence_item_count),
      reviewedImpactFactCount: reviewedImpactFactClaimIds.length,
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

  const rows = await readFiles(organizationId, engagementId, { limit: CLIENT_EVIDENCE_PIPELINE_FILE_LIMIT + 1 });
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

  try {
    const files = [];
    const projectClaimIds = new Set();
    for (const row of pageRows) {
      const projected = projectPipelineFile(row, eligibleClaimIds);
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
});
