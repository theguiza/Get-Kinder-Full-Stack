import { isRouteUuid } from "../impactEvidenceLibraryLogic.js";
import { INTAKE_READ_STATUS } from "../kaiWebIntakeLogic.js";

// Client-safe evidence pipeline for the selected project: per uploaded file,
// the governed workflow stage it has reached, who it is waiting on, and the
// next permitted action, plus the reviewed Impact Facts (the same governed
// client projection as the impact-facts read) that descend from the
// project's files. Never a GK queue, source, or evidence-library read.
const BASE_PATH = "/api/kai/sprint2/intake";

export const PIPELINE_REQUEST_STATUS = INTAKE_READ_STATUS;

export function clientEvidencePipelinePath(organizationId, engagementId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/engagements/${encodeURIComponent(engagementId)}/client-evidence-pipeline`;
}

export const PIPELINE_STAGE_LABELS = Object.freeze({
  upload: "Uploaded",
  security_check: "Security check",
  processing: "Processing",
  data_dictionary: "Data dictionary",
  sensitivity_classification: "Sensitivity classification",
  sensitivity_review: "Sensitivity review",
  source_review: "Source review",
  evidence_extraction: "Evidence creation",
  evidence_review: "Evidence review",
  impact_fact_review: "Impact Fact review",
});

const STAGE_KEYS = Object.keys(PIPELINE_STAGE_LABELS);

const STAGE_STATUSES = new Set([
  "complete",
  "in_progress",
  "not_started",
  "waiting_for_client",
  "waiting_for_get_kinder",
  "failed",
  "closed",
  "not_currently_eligible",
  "unknown",
]);

const RESPONSIBLE_PARTIES = new Set(["kai", "client", "get_kinder", "none"]);

export const PIPELINE_NEXT_ACTIONS = Object.freeze([
  "none",
  "none_waiting_for_kai_processing",
  "none_waiting_for_get_kinder",
  "answer_client_followups",
  "upload_new_file",
  "contact_get_kinder",
  "promote_source",
  "extract_evidence",
  "continue_source_preparation",
]);

export const PIPELINE_REASONS = Object.freeze([
  "waiting_for_client",
  "failed",
  "processing",
  "waiting_for_get_kinder_review",
  "waiting_for_source_promotion",
  "source_promotion_ready",
  "source_preparation_ready",
  "source_candidate_missing",
  "source_promotion_blocked",
  "evidence_extraction_ready",
  "evidence_extraction_pending",
  "evidence_awaiting_review",
  "impact_fact_review_pending",
  "not_currently_eligible",
  "source_not_promoted",
  "unknown",
  "complete",
]);

export const PIPELINE_FAILURE_MESSAGES = Object.freeze({
  file_blocked_by_policy: "The file was blocked by the file safety policy.",
  upload_not_completed: "The upload was not completed.",
  security_check_failed: "The file security check did not complete successfully.",
  file_could_not_be_read: "KAI could not read this file's contents.",
  file_content_unavailable: "The file's stored contents were not available for processing.",
  processing_cancelled: "Processing was cancelled.",
  processing_failed: "Processing failed.",
});

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function projectStage(stage) {
  if (!stage || typeof stage !== "object") return null;
  if (!STAGE_KEYS.includes(stage.key) || !STAGE_STATUSES.has(stage.status) || !RESPONSIBLE_PARTIES.has(stage.responsible)) return null;
  return {
    key: stage.key,
    status: stage.status,
    responsible: stage.responsible,
    count: isCount(stage.count) ? stage.count : null,
    failureCategory: Object.hasOwn(PIPELINE_FAILURE_MESSAGES, stage.failureCategory) ? stage.failureCategory : null,
  };
}

function projectFile(file) {
  if (!file || typeof file !== "object" || !isRouteUuid(file.intakeFileId)) return null;
  const stages = Array.isArray(file.stages) ? file.stages.map(projectStage) : [];
  if (stages.length !== STAGE_KEYS.length || stages.some((stage, index) => !stage || stage.key !== STAGE_KEYS[index])) return null;
  if (!PIPELINE_NEXT_ACTIONS.includes(file.nextAction) || !PIPELINE_REASONS.includes(file.reason)) return null;
  if (!STAGE_STATUSES.has(file.currentStatus) || !RESPONSIBLE_PARTIES.has(file.responsibleParty)) return null;
  if (file.currentStage !== null && !STAGE_KEYS.includes(file.currentStage)) return null;
  return {
    intakeFileId: file.intakeFileId,
    safeFilename: typeof file.safeFilename === "string" && file.safeFilename ? file.safeFilename : "Unnamed file",
    stages,
    currentStage: file.currentStage,
    currentStatus: file.currentStatus,
    responsibleParty: file.responsibleParty,
    nextAction: file.nextAction,
    failureCategory: Object.hasOwn(PIPELINE_FAILURE_MESSAGES, file.failureCategory) ? file.failureCategory : null,
    reason: file.reason,
    evidenceItemCount: isCount(file.evidenceItemCount) ? file.evidenceItemCount : 0,
    reviewedImpactFactCount: isCount(file.reviewedImpactFactCount) ? file.reviewedImpactFactCount : 0,
  };
}

// Returns null for a missing/malformed DTO: the caller renders an error,
// never an empty project.
export function projectClientEvidencePipeline(dto, expectedEngagementId) {
  if (!dto || typeof dto !== "object" || dto.engagementId !== expectedEngagementId) return null;
  if (!Array.isArray(dto.files) || !Array.isArray(dto.reviewedImpactFacts)) return null;
  const files = dto.files.map(projectFile);
  if (files.some((file) => !file)) return null;
  const reasons = Array.isArray(dto.summary?.reasons)
    ? dto.summary.reasons.filter((entry) => PIPELINE_REASONS.includes(entry?.reason) && isCount(entry?.fileCount))
      .map((entry) => ({ reason: entry.reason, fileCount: entry.fileCount }))
    : [];
  const reviewedImpactFacts = dto.reviewedImpactFacts
    .filter((fact) => isRouteUuid(fact?.claimId))
    .map((fact) => ({
      claimId: fact.claimId,
      statement: typeof fact.statement === "string" ? fact.statement : "",
      claimType: typeof fact.claimType === "string" ? fact.claimType : "",
      limitationDimensionKeys: Array.isArray(fact.limitationDimensionKeys)
        ? fact.limitationDimensionKeys.filter((key) => typeof key === "string")
        : [],
    }));
  return {
    engagementId: dto.engagementId,
    files,
    truncated: dto.truncated === true,
    reasons,
    reviewedImpactFacts,
    reviewedImpactFactsTruncated: dto.reviewedImpactFactsTruncated === true,
  };
}

// One read of the project pipeline. `getJsonFn` is the shared getJson.
export async function readClientEvidencePipeline(getJsonFn, organizationId, engagementId) {
  try {
    const result = await getJsonFn(clientEvidencePipelinePath(organizationId, engagementId));
    const data = result.statusCode === 200 && result.body?.ok
      ? projectClientEvidencePipeline(result.body.data, engagementId)
      : null;
    if (!data) {
      return { status: PIPELINE_REQUEST_STATUS.ERROR, data: null, error: `HTTP ${result.statusCode}` };
    }
    const hasData = data.files.length > 0 || data.reviewedImpactFacts.length > 0;
    return {
      status: hasData ? PIPELINE_REQUEST_STATUS.SUCCESS_WITH_DATA : PIPELINE_REQUEST_STATUS.SUCCESS_EMPTY,
      data,
      error: null,
    };
  } catch {
    return { status: PIPELINE_REQUEST_STATUS.ERROR, data: null, error: "network error" };
  }
}

export function isPipelineSuccess(status) {
  return status === PIPELINE_REQUEST_STATUS.SUCCESS_EMPTY || status === PIPELINE_REQUEST_STATUS.SUCCESS_WITH_DATA;
}

export function stageStatusLabel(stage) {
  switch (stage.status) {
    case "complete":
      return "Complete";
    case "in_progress":
      return "In progress";
    case "not_started":
      return stage.responsible === "kai" ? "Queued" : "Not available yet";
    case "waiting_for_client":
      return "Waiting for your organization";
    case "waiting_for_get_kinder":
      return "Waiting for Get Kinder";
    case "failed":
      return "Failed";
    case "closed":
      return "Not promoted";
    case "not_currently_eligible":
      return "Not currently usable";
    default:
      return "Unknown";
  }
}

/**
 * One file's processing status, as text, from a project pipeline request
 * (Files: KaiWebIntake's file status and batch list). With no `stageKey`, the
 * file's current stage; otherwise that stage's status. A file the pipeline
 * does not list (no project selected, another project, or past the read's
 * bound) is "not available", never inferred.
 */
export function pipelineFileStatusText(request, intakeFileId, stageKey = null) {
  const status = request?.status || PIPELINE_REQUEST_STATUS.NOT_STARTED;
  if (status === PIPELINE_REQUEST_STATUS.LOADING) return "loading";
  if (status === PIPELINE_REQUEST_STATUS.ERROR) return "unavailable";
  const file = isPipelineSuccess(status) && Array.isArray(request.data?.files)
    ? request.data.files.find((entry) => entry.intakeFileId === intakeFileId)
    : null;
  if (!file) return "not available";
  if (stageKey) {
    const stage = file.stages.find((entry) => entry.key === stageKey);
    return stage ? stageStatusLabel(stage) : "not available";
  }
  if (!file.currentStage) return "Complete";
  const current = file.stages.find((entry) => entry.key === file.currentStage);
  return `${PIPELINE_STAGE_LABELS[file.currentStage]}: ${current ? stageStatusLabel(current) : "Unknown"}`;
}

function pluralFiles(count) {
  return count === 1 ? "1 file" : `${count} files`;
}

// The file's next action, as text. Only actions the product already offers
// are named; everything else says who the file is waiting on.
export function nextActionText(file, { canReviewFollowups = false, canContribute = false } = {}) {
  const stageLabel = file.currentStage ? PIPELINE_STAGE_LABELS[file.currentStage].toLowerCase() : "";
  switch (file.nextAction) {
    case "none_waiting_for_kai_processing":
      return "No action required from you. KAI is processing this file.";
    case "none_waiting_for_get_kinder":
      return `No action required from you. Waiting for Get Kinder ${stageLabel}.`;
    case "answer_client_followups":
      return canReviewFollowups
        ? "Answer the follow-up questions Get Kinder sent about this file's evidence."
        : "A client reviewer in your organization needs to answer follow-up questions about this file's evidence.";
    case "upload_new_file":
      return canContribute ? "Upload a corrected file." : "A client admin in your organization can upload a corrected file.";
    case "contact_get_kinder":
      if (file.reason === "source_candidate_missing") {
        return "Contact Get Kinder. The sensitivity review is recorded, but no source candidate was created for this file, so there is nothing to promote yet.";
      }
      if (file.reason === "source_promotion_blocked") {
        return "Contact Get Kinder. This file's source candidate cannot be promoted in its current state (for example, its allowed-use restrictions no longer permit it).";
      }
      return file.currentStage === "security_check"
        ? "Contact Get Kinder for help with this file's security check."
        : "Contact Get Kinder. Processing cannot be retried from here.";
    case "promote_source":
      return "Your action is needed: review this file's source candidate and promote it as a source in Data Sources. Evidence can only be created from a promoted source.";
    case "extract_evidence":
      return "Your action is needed: this file's source is promoted. Extract evidence from it in Data Sources.";
    case "continue_source_preparation":
      return "Your action is needed: this file's sensitivity review is recorded, but its source candidate was not created. Continue source preparation in Data Sources to create it; the review is not changed.";
    default:
      return file.currentStatus === "complete" ? "No action required. Reviewed evidence from this file is available." : "No action required from you.";
  }
}

const REASON_MESSAGES = Object.freeze({
  waiting_for_client: (n) => `${pluralFiles(n)} need an answer from a client reviewer in your organization before evidence can be used.`,
  failed: (n) => `${pluralFiles(n)} could not be processed. See Files for details.`,
  processing: (n) => `${pluralFiles(n)} ${n === 1 ? "is" : "are"} still being processed by KAI.`,
  waiting_for_get_kinder_review: (n) => `Your data has been processed and is waiting for Get Kinder review (${pluralFiles(n)}).`,
  waiting_for_source_promotion: (n) => `${pluralFiles(n)} passed the Get Kinder sensitivity review and ${n === 1 ? "is" : "are"} waiting for Get Kinder to review and promote ${n === 1 ? "it" : "them"} as a source. Evidence can only be created from a promoted source.`,
  source_promotion_ready: (n) => `${pluralFiles(n)} passed the sensitivity review and ${n === 1 ? "is a source candidate" : "are source candidates"} you can review and promote in Data Sources. Evidence can only be created from a promoted source.`,
  source_preparation_ready: (n) => `${pluralFiles(n)} passed the sensitivity review, but ${n === 1 ? "its source candidate was" : "their source candidates were"} not created. Continue source preparation in Data Sources; evidence can only be created from a promoted source.`,
  source_candidate_missing: (n) => `${pluralFiles(n)} passed the sensitivity review, but no source candidate was created, so ${n === 1 ? "it" : "they"} cannot be promoted yet. Contact Get Kinder.`,
  source_promotion_blocked: (n) => `${pluralFiles(n)} ${n === 1 ? "has a source candidate that" : "have source candidates that"} cannot be promoted in ${n === 1 ? "its" : "their"} current state. Contact Get Kinder.`,
  evidence_extraction_ready: (n) => `The source from ${pluralFiles(n)} has been promoted. Extract evidence from it in Data Sources.`,
  evidence_extraction_pending: (n) => `The source from ${pluralFiles(n)} has been promoted. Get Kinder has not yet created evidence from it.`,
  evidence_awaiting_review: (n) => `Evidence has been created from ${pluralFiles(n)} and is waiting for Get Kinder evidence review.`,
  impact_fact_review_pending: (n) => `Evidence from ${pluralFiles(n)} has been reviewed. Get Kinder has not yet completed the Impact Fact review.`,
  not_currently_eligible: (n) => `Evidence from ${pluralFiles(n)} was reviewed but is not currently usable as an Impact Fact. Contact Get Kinder for details.`,
  source_not_promoted: (n) => `${pluralFiles(n)} ${n === 1 ? "was" : "were"} reviewed by Get Kinder and not promoted as a source, so no evidence will be created from ${n === 1 ? "it" : "them"}.`,
  unknown: (n) => `The status of ${pluralFiles(n)} could not be determined.`,
  complete: (n) => `${pluralFiles(n)} ${n === 1 ? "has" : "have"} reviewed evidence shown here.`,
});

export function pipelineReasonMessage(reason, fileCount) {
  return REASON_MESSAGES[reason](fileCount);
}

// What each Get Kinder-owned stage is, for the Reviews tab, so a file's
// sensitivity review is never read as an Evidence or Impact Fact review.
export const GET_KINDER_STAGE_DESCRIPTIONS = Object.freeze({
  sensitivity_review: "Get Kinder confirms how the file's information may be used (sensitivity, consent, and allowed use) before it can become a source. This is not an Evidence or Impact Fact review.",
  source_review: "Get Kinder decides whether the file becomes a source that evidence can be created from.",
  evidence_extraction: "Get Kinder creates evidence from the file's promoted source.",
  evidence_review: "Get Kinder reviews the evidence created from the file.",
  impact_fact_review: "Get Kinder reviews whether the file's reviewed evidence supports an Impact Fact.",
});

/**
 * Whether this actor may perform Get Kinder reviews for the organization, as
 * text. `access` is the existing review-cockpit capabilities answer
 * ("allowed" / "not_allowed" / "unknown"); `membershipKnown` is whether the
 * organization access-capabilities read succeeded. The client Knowledge
 * Studio is mounted only when that read did not report the GK workspace, so
 * an "allowed" actor here holds a global Get Kinder role over a non-Get
 * Kinder membership in this organization. Such an actor completes the file
 * sensitivity review from Reviews (owner decision 2026-10-11); the other Get
 * Kinder reviews stay in Get Kinder's own workspace.
 */
export function getKinderReviewAccessText(access, membershipKnown) {
  if (!membershipKnown || (access !== "allowed" && access !== "not_allowed")) {
    return "Your sensitivity-review access could not be confirmed, so no review action is offered here.";
  }
  if (access === "not_allowed") {
    return "Your account does not have sensitivity-review access for this organization, so no review action is offered here.";
  }
  return "Your organization-scoped review access can complete this organization's sensitivity reviews here: use \u201cReview sensitivity & allowed use\u201d "
    + "next to a file waiting for sensitivity review. This access is limited to this organization; "
    + "the other Get Kinder reviews are completed in Get Kinder's own review workspace.";
}

/**
 * Whether a file's governed pipeline state is the file sensitivity review -
 * the one Get Kinder review the client Studio can open, and only for an
 * actor whose review-cockpit capability for this organization is "allowed".
 */
export function sensitivityReviewActionAvailable(file) {
  return file?.currentStage === "sensitivity_review" && file?.responsibleParty === "get_kinder" && file?.currentStatus !== "failed";
}

/**
 * What the Reviews tab says this actor must do, from a ready reviewsTabView.
 * Client follow-ups and the Get Kinder sensitivity review are separate work:
 * follow-ups need clientFollowupReview, and a sensitivity review counts only
 * where the per-file action is offered (canReviewSensitivity and
 * sensitivityReviewActionAvailable). "No action" is said only when neither
 * applies.
 */
export function reviewsTabMessages(view, { canReviewFollowups = false, canReviewSensitivity = false } = {}) {
  const clientCount = view.waitingForClient.length;
  const sensitivityCount = canReviewSensitivity ? view.waitingForGetKinder.filter(sensitivityReviewActionAvailable).length : 0;
  const messages = [];
  if (clientCount > 0 && canReviewFollowups) {
    messages.push({
      key: "client_followups",
      heading: "Your action is needed",
      detail: `Get Kinder sent follow-up questions about evidence from ${pluralFiles(clientCount)} in this project. Evidence cannot be used until they are answered.`,
    });
  }
  if (sensitivityCount > 0) {
    messages.push({
      key: "sensitivity_review",
      heading: "Get Kinder sensitivity review needed",
      detail: `${pluralFiles(sensitivityCount)} in this project ${sensitivityCount === 1 ? "is" : "are"} waiting for the Get Kinder sensitivity review, which your organization-scoped review access can complete here. Use \u201cReview sensitivity & allowed use\u201d next to ${sensitivityCount === 1 ? "the file" : "each file"} below.`,
    });
  }
  if (clientCount > 0 && !canReviewFollowups) {
    messages.push({
      key: "client_followups_elsewhere",
      heading: sensitivityCount > 0 ? "Waiting for a client reviewer" : "No action is currently required from you.",
      detail: `Follow-up questions about evidence from ${pluralFiles(clientCount)} are waiting for a client reviewer in your organization.`,
    });
  }
  const sourceCount = Array.isArray(view.sourceWork) ? view.sourceWork.length : 0;
  if (sourceCount > 0) {
    messages.push({
      key: "source_work",
      heading: "Your action is needed",
      detail: `${pluralFiles(sourceCount)} in this project ${sourceCount === 1 ? "is" : "are"} ready for source preparation, source promotion, or evidence extraction, which your role can complete in Data Sources.`,
    });
  }
  if (clientCount === 0 && sensitivityCount === 0 && sourceCount === 0) {
    messages.push({ key: "none", heading: "No action is currently required from you.", detail: null });
  }
  return messages;
}

/**
 * What the Evidence tab shows for the selected project, from the explicit
 * request state. Only a successful read can produce a zero; an error is an
 * error.
 */
export function evidenceTabView(request) {
  const status = request?.status || PIPELINE_REQUEST_STATUS.NOT_STARTED;
  if (status === PIPELINE_REQUEST_STATUS.ERROR) return { kind: "error" };
  if (!isPipelineSuccess(status) || !request.data) return { kind: "loading" };
  const { files, reasons, reviewedImpactFacts } = request.data;
  if (files.length === 0 && reviewedImpactFacts.length === 0) return { kind: "no_files" };
  const upstream = reasons.filter((entry) => entry.reason !== "complete");
  if (reviewedImpactFacts.length > 0) return { kind: "facts", facts: reviewedImpactFacts, upstream };
  return { kind: "explained_empty", upstream };
}

// Files the client's own organization must act on, and files waiting on Get Kinder.
export function reviewsTabView(request) {
  if (request?.status === PIPELINE_REQUEST_STATUS.ERROR) return { kind: "error" };
  if (!isPipelineSuccess(request?.status) || !request.data) return { kind: "loading" };
  const files = request.data.files;
  return {
    kind: "ready",
    waitingForClient: files.filter((file) => file.nextAction === "answer_client_followups"),
    sourceWork: files.filter(isClientSourceWork),
    waitingForGetKinder: files.filter((file) => file.responsibleParty === "get_kinder" && file.currentStatus !== "failed"),
  };
}

/**
 * Source preparation the requesting actor itself may do (owner decision
 * 2026-10-18, 2026-10-19): the server reports promote_source /
 * extract_evidence / continue_source_preparation only for an actor holding
 * that organization-scoped authority and an eligible file.
 */
export function isClientSourceWork(file) {
  return file?.responsibleParty === "client"
    && (file.nextAction === "promote_source" || file.nextAction === "extract_evidence" || file.nextAction === "continue_source_preparation");
}
