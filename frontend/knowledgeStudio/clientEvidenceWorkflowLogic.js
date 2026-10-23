import { errorText, isRouteUuid } from "../impactEvidenceLibraryLogic.js";
import { nextActionText } from "./clientEvidencePipelineLogic.js";

/**
 * Client organization-administrator evidence-to-draft workflow (owner
 * decision 2026-10-18): sensitivity review -> source candidate promotion ->
 * governed source -> evidence extraction -> evidence ->
 * claim proposal -> claim gap follow-ups (P2-04) -> claim selection ->
 * internal evidence summary / impact narrative. Every flag is the server's
 * access-capabilities answer; nothing here grants or infers authority.
 * Authorization and input readiness are kept separate: an authorized actor
 * can still be missing a Project or a claim, and is told which.
 */

// reviewSensitivity / promoteSource: the governed source preparation an
// organization administrator may complete itself (owner decisions 2026-10-12
// and 2026-10-18), shown in the same tab for the selected Project.
const WORKFLOW_OPERATION_KEYS = Object.freeze([
  "reviewSensitivity",
  "promoteSource",
  "extractEvidence",
  "proposeClaim",
  "generateClaimGapFollowups",
  "generateDrafts",
  "readInternalDrafts",
  // Plan A Prompt 8: record the P2-01M source record-count measurement, and
  // receive an internal report Get Kinder has already reviewed and released.
  "recordSourceMeasurement",
  "readReleasedInternalReports",
  // Owner amendment 2026-10-23: the organization administrator's factual
  // review of an ordinary internal evidence summary.
  "reviewInternalDraftFactualContent",
]);

// Terminal claim review outcome the generation repository always rejects
// (claim_reviewed_not_supported). Server-authoritative claimStrength.
const TERMINAL_NOT_SUPPORTED = "reviewed_not_supported";

export function clientEvidenceWorkflowAccess(capabilities) {
  const operations = capabilities?.workflowOperations || {};
  const access = Object.fromEntries(WORKFLOW_OPERATION_KEYS.map((key) => [key, operations[key] === true]));
  // The workflow is offered only to an actor outside the GK workspace (the
  // GK Knowledge Studio already carries these actions).
  const visible = capabilities?.internalKnowledgeWorkspace !== true && WORKFLOW_OPERATION_KEYS.some((key) => access[key]);
  return { visible, ...access };
}

export function claimInternalDraftSelectability(claim) {
  if (!isRouteUuid(claim?.claimId) || !isRouteUuid(claim?.evidenceItemId)) {
    return { selectable: false, reason: "invalid_claim" };
  }
  if (claim.claimStrength === TERMINAL_NOT_SUPPORTED) return { selectable: false, reason: "reviewed_not_supported" };
  return { selectable: true, reason: null };
}

export function internalDraftReadiness({ canGenerate, engagementId, selectedClaimIds }) {
  if (canGenerate !== true) return { ready: false, reason: "not_authorized" };
  if (!isRouteUuid(engagementId)) return { ready: false, reason: "no_project" };
  if (!Array.isArray(selectedClaimIds) || selectedClaimIds.length === 0) return { ready: false, reason: "no_claims_selected" };
  if (selectedClaimIds.length > 20) return { ready: false, reason: "too_many_claims" };
  return { ready: true, reason: null };
}

export const INTERNAL_DRAFT_READINESS_MESSAGES = Object.freeze({
  not_authorized: "Your role does not include internal draft generation for this organization.",
  no_project: "Select a Project above: each draft belongs to one Project.",
  no_claims_selected: "Select at least one claim below to draft from.",
  too_many_claims: "Select at most 20 claims for one draft.",
});

export function claimSelectabilityMessage(reason) {
  if (reason === "reviewed_not_supported") return "Get Kinder review found this claim not supported, so it cannot be used in a draft.";
  if (reason === "invalid_claim") return "This claim cannot be selected.";
  return "";
}

// Claims already proposed for an evidence item, from the loaded Claim Library page.
export function claimIdsByEvidenceItem(claims) {
  const byEvidence = new Map();
  for (const claim of Array.isArray(claims) ? claims : []) {
    if (!isRouteUuid(claim?.evidenceItemId) || !isRouteUuid(claim?.claimId)) continue;
    byEvidence.set(claim.evidenceItemId, [...(byEvidence.get(claim.evidenceItemId) || []), claim.claimId]);
  }
  return byEvidence;
}

// Drops selections the current claim list no longer admits.
export function retainSelectableClaimIds(selectedClaimIds, claims) {
  const admitted = new Set((Array.isArray(claims) ? claims : [])
    .filter((claim) => claimInternalDraftSelectability(claim).selectable)
    .map((claim) => claim.claimId));
  return (Array.isArray(selectedClaimIds) ? selectedClaimIds : []).filter((claimId) => admitted.has(claimId));
}

export function internalDraftRequestBody({ claimIds, idempotencyKey, engagementId }) {
  return { claim_ids: [...claimIds].sort(), idempotency_key: idempotencyKey, engagement_id: engagementId };
}

export function extractionResultMessage(data) {
  const created = Array.isArray(data?.evidenceItems) ? data.evidenceItems.length : 0;
  return data?.replayed === true
    ? `Evidence was already extracted from this source version (${created} evidence item(s)). Nothing new was written.`
    : `Evidence extracted: ${created} evidence item(s) created, awaiting Get Kinder evidence review.`;
}

export function claimProposalResultMessage(data) {
  return data?.replayed === true
    ? "A claim was already proposed for this evidence. Nothing new was written."
    : "Claim proposed. It is internal-only and awaits Get Kinder claim review.";
}

// P2-04 outcome: counts only. Generation records open gaps and open client
// follow-up questions; it answers, resolves, and approves nothing.
export function gapFollowupResultMessage(data) {
  const gaps = Array.isArray(data?.gapItems) ? data.gapItems.length : 0;
  const followups = Array.isArray(data?.clientFollowupItems) ? data.clientFollowupItems.length : 0;
  const counts = `${gaps} open gap(s) and ${followups} client follow-up question(s)`;
  return data?.replayed === true
    ? `Gap follow-ups were already generated for this claim (${counts}). Nothing new was written.`
    : `Gap follow-ups generated: ${counts} recorded. They stay open until answered and reviewed; the claim is not approved.`;
}

// Why a P2-04 request wrote nothing, from the server's own refusal.
export function gapFollowupFailureMessage(result) {
  const code = result?.body?.error?.code;
  if (code === "not_found") {
    return "This claim or part of its evidence lineage was not found in this organization. Nothing was written.";
  }
  if (code === "conflict_current_state_changed") {
    return "This claim's gap follow-up state changed or no longer matches its evidence. Refresh and try again. Nothing new was written.";
  }
  if (code === "validation_blocker") {
    const reason = result?.body?.blockers?.[0]?.blocking_reason;
    const detail = typeof reason === "string" && /^[a-z0-9_]+$/.test(reason) ? ` (${reason.replace(/_/g, " ")})` : "";
    return `Gap follow-ups cannot be generated for this claim: it did not pass validation${detail}. Nothing was written.`;
  }
  return errorText(result);
}

// Why an authorized internal-draft request created nothing, from the
// server's own refusal. Generation revalidates each claim's traceability,
// which fails until the claim's gap follow-ups exist (or for another
// traceability reason the server does not detail here).
export function internalDraftFailureMessage(result, { canGenerateGapFollowups = false } = {}) {
  const blockingReason = result?.body?.blockers?.[0]?.blocking_reason;
  if (blockingReason === "traceability_result_contract_invalid") {
    return canGenerateGapFollowups
      ? "A selected claim cannot be drafted from yet: its traceability checks did not pass. If you have not generated "
        + "its gap follow-ups, use \"Generate gap follow-ups\" on the claim, then try again. Nothing was created."
      : "A selected claim cannot be drafted from yet: Get Kinder has not completed its traceability checks "
        + "(such as generating its coverage gap follow-ups). Nothing was created.";
  }
  if (result?.body?.error?.code === "claim_reviewed_not_supported") {
    return "A selected claim was found not supported by Get Kinder review and cannot be used in a draft. Nothing was created.";
  }
  return errorText(result);
}

// What the actor is told about a created draft: identity and status. The
// persisted draft itself is then read back and shown under "Your internal
// drafts" (owner decision 2026-10-19), never from this response.
export function internalDraftResultSummary(data, contentType) {
  if (!data || !isRouteUuid(data.generatedContentDraftId)) return null;
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];
  const citedClaimIds = new Set(blocks.flatMap((block) => (Array.isArray(block?.citations) ? block.citations : []))
    .map((citation) => citation?.claimId)
    .filter(isRouteUuid));
  return {
    generatedContentDraftId: data.generatedContentDraftId,
    contentType,
    audience: data.requestedAudience === "internal" ? "internal" : null,
    draftStatus: typeof data.draftStatus === "string" ? data.draftStatus : null,
    reviewStatus: typeof data.reviewStatus === "string" ? data.reviewStatus : null,
    blockCount: blocks.length,
    citedClaimCount: citedClaimIds.size,
    replayed: data.replayed === true,
  };
}

/**
 * The selected Project's files whose next step is governed source
 * preparation, from the client evidence pipeline (server-derived stage and
 * next action). Sensitivity review is listed only for an actor the
 * capabilities admit; a source_review file is always listed so the actor sees
 * its actual state (promotable by this actor, or the server's blocker).
 */
export function sourcePreparationFiles(pipelineData, access) {
  const files = Array.isArray(pipelineData?.files) ? pipelineData.files : [];
  return files.filter((file) => (
    (file.currentStage === "sensitivity_review" && access?.reviewSensitivity === true && file.currentStatus !== "failed")
    || file.currentStage === "source_review"
    || (file.currentStage === "evidence_extraction" && file.nextAction === "extract_evidence")
  ));
}

/**
 * The selected Project's files whose sensitivity & allowed-use review is
 * complete, offered for a corrective re-review ("Review processing
 * permissions") to an actor the capabilities admit to that review. The
 * pipeline marks the stage complete only while the file's current decision is
 * a human 'reviewed' one, so a file at any later stage - promoted, with
 * evidence, or closed as not_allowed - stays listed, and a needs-more-
 * information file returns to Source preparation. Each row is the pipeline's
 * own intake file, so the panel opens on that file's identity, never on one
 * derived from a source. Exception recovery only: no file needs it to
 * continue.
 */
export function processingPermissionReviewFiles(pipelineData, access) {
  if (access?.reviewSensitivity !== true) return [];
  const files = Array.isArray(pipelineData?.files) ? pipelineData.files : [];
  return files.filter((file) => Array.isArray(file?.stages)
    && file.stages.some((stage) => stage?.key === "sensitivity_review" && stage.status === "complete"));
}

// The decision response, as one line: what was recorded and what the
// server-side evidence extraction handoff did. Counts only.
export function sourcePromotionResultMessage(data) {
  const status = data?.promotion_decision?.decision_status;
  const handoff = data?.evidence_extraction_handoff;
  const replayed = data?.replayed === true ? " (already recorded; nothing new was written)" : "";
  if (status === "promoted") {
    if (handoff?.status === "created" || handoff?.status === "replayed") {
      return `Source promoted${replayed}. Evidence extraction ${handoff.status === "created" ? "created" : "already had"} ${handoff.evidence_item_count ?? 0} evidence item(s), awaiting Get Kinder evidence review.`;
    }
    if (handoff?.status === "not_created") {
      return `Source promoted${replayed}. Evidence was not created automatically (${handoff.error_code || "unknown"}); use "Extract evidence" on the source below.`;
    }
    return `Source promoted${replayed}.`;
  }
  if (status === "rejected") return `Source candidate rejected${replayed}. No source or evidence will be created from this file.`;
  if (status === "needs_more_information") return `Marked as needing more information${replayed}. The candidate stays open; nothing was promoted.`;
  return "Decision recorded.";
}

// Why a P1-08 decision wrote nothing, from the server's own structured
// refusal (error code, blockers, and the repository's diagnostic phase).
const SOURCE_PROMOTION_PHASE_MESSAGES = Object.freeze({
  source_promotion_permission_predicate_failed:
    "this file's recorded sensitivity and allowed-use restrictions do not permit promotion",
  source_promotion_allowed_use_not_allowed: "this file's effective allowed use is not_allowed",
  source_promotion_reviewed_source_type_invalid: "the reviewed source type is not one of the allowed types",
  source_promotion_candidate_review_incomplete: "the candidate or its review item is not in a state that can take this decision",
});

export function sourcePromotionFailureMessage(result) {
  const code = result?.body?.error?.code;
  const phase = result?.body?.data?.exact_verification_phase;
  if (code === "validation_blocker" && SOURCE_PROMOTION_PHASE_MESSAGES[phase]) {
    return `Source not promoted: ${SOURCE_PROMOTION_PHASE_MESSAGES[phase]} (${phase}). Nothing was written.`;
  }
  if (code === "conflict_current_state_changed") {
    return "Source not promoted: this candidate changed since it was loaded. The refreshed state is shown. Nothing new was written.";
  }
  const reason = result?.body?.blockers?.[0]?.blocking_reason;
  if (code === "authorization_denied" && typeof reason === "string" && /^[a-z0-9_]+$/.test(reason)) {
    return `Source not promoted: your account may not record this decision (${reason}). Nothing was written.`;
  }
  return errorText(result);
}

// The source-preparation continuation response, as one line (owner decision
// 2026-10-19): the P1-07 handoff status the server reports. Ids are not shown.
export function sourcePreparationContinuationMessage(data) {
  const status = data?.source_candidate_handoff?.status;
  if (status === "created") {
    return "Source preparation continued: the source candidate was created from the file's recorded sensitivity review. Review & promote it below. The review and its reviewer were not changed.";
  }
  if (status === "replayed" || status === "existing") {
    return "This file already has its source candidate. Nothing new was written.";
  }
  return "Source preparation continued.";
}

// Why the continuation wrote nothing, from the server's structured blocker or
// the P1-07 handoff's own refusal code.
const SOURCE_PREPARATION_BLOCKER_MESSAGES = Object.freeze({
  file_policy_not_passed: "the file has not passed the upload file policy",
  sensitivity_profile_not_ready: "the file has no complete sensitivity profile yet",
  sensitivity_decision_lineage_ambiguous: "the file's sensitivity decision history has no single current decision",
  sensitivity_review_not_complete: "the file's current sensitivity review is not a completed 'reviewed' decision",
  sensitivity_decision_invalid: "the file's current sensitivity decision does not meet the review rules",
  allowed_use_not_allowed: "the file's recorded allowed use is not_allowed",
});

export function sourcePreparationContinuationFailureMessage(result) {
  const reason = result?.body?.blockers?.[0]?.blocking_reason;
  if (typeof reason === "string" && SOURCE_PREPARATION_BLOCKER_MESSAGES[reason]) {
    return `Source preparation not continued: ${SOURCE_PREPARATION_BLOCKER_MESSAGES[reason]} (${reason}). Nothing was written.`;
  }
  const handoffCode = result?.body?.data?.source_candidate_handoff?.error_code;
  if (typeof handoffCode === "string" && /^[a-z0-9_]+$/.test(handoffCode)) {
    return `Source preparation not continued: the source candidate step refused (${handoffCode}). Nothing was written.`;
  }
  return errorText(result);
}

// The guidance line for one source-preparation file. The pipeline's file
// sensitivity stage names Get Kinder's review; an actor the capabilities
// admit to that review is told it is theirs to do here.
export function sourcePreparationGuidance(file, access) {
  if (file?.currentStage === "sensitivity_review" && access?.reviewSensitivity === true) {
    return "Your action is needed: review this file's sensitivity & allowed use. Recording a \"reviewed\" decision creates its source candidate.";
  }
  return nextActionText(file);
}

// ---------------------------------------------------------------------------
// "Use for impact" (owner decision 2026-10-19): one contextual action that
// takes a file through the existing governed steps, from persisted state
// only. Automated steps are the existing authorized operations (P1-07
// continuation, P2-01 extraction); a human decision (the sensitivity review,
// the source authorization) is opened for the person, never made for them.
// ---------------------------------------------------------------------------

export const USE_FOR_IMPACT_MAX_STEPS = 4;

export function useForImpactStep(file, access) {
  if (!file || typeof file !== "object") return { kind: "blocked", text: "This file's status is not available." };
  const action = file.nextAction;
  if (action === "review_sensitivity" && access?.reviewSensitivity === true) return { kind: "review_sensitivity" };
  if (file.currentStage === "sensitivity_review" && file.currentStatus !== "failed" && access?.reviewSensitivity === true) {
    return { kind: "review_sensitivity" };
  }
  if (action === "continue_source_preparation" && access?.promoteSource === true) return { kind: "continue" };
  if (action === "promote_source" && access?.promoteSource === true) return { kind: "confirm_promotion" };
  if (action === "extract_evidence" && access?.extractEvidence === true) return { kind: "extract" };
  if (file.currentStatus === "complete" || ["evidence_review", "impact_fact_review"].includes(file.currentStage)) {
    return { kind: "done" };
  }
  return { kind: "blocked", text: nextActionText(file) };
}

// Offered on a file when its next governed step is one this actor may take.
export function isUseForImpactCandidate(file, access) {
  return ["review_sensitivity", "continue", "confirm_promotion", "extract"].includes(useForImpactStep(file, access).kind);
}

export const USE_FOR_IMPACT_MESSAGES = Object.freeze({
  review_sensitivity: "Use for impact: this file first needs your sensitivity & allowed-use review. Record your decision below; nothing is decided for you.",
  confirm_promotion: "Use for impact: confirm the source authorization below, then choose the reviewed source type and promote. Nothing is promoted without your confirmation.",
  done: "Use for impact: this file's evidence exists. Propose claims from it below, generate their gap follow-ups, then internal drafts.",
  interrupted: "Use for impact stopped. Every completed step is kept; use the action again to continue from the current state.",
});

// The restrictions a promotion keeps, from the file's current sensitivity
// decision (the existing review read). Lines only; nothing is inferred.
const PRESENCE_LABELS = Object.freeze({
  reviewed_personal_data_status: "personal information",
  reviewed_minor_data_status: "information about minors",
  reviewed_health_housing_justice_immigration_status: "health, housing, justice, or immigration information",
  reviewed_indigenous_governance_status: "Indigenous or governance-sensitive information",
  reviewed_staff_notes_status: "staff notes",
  reviewed_story_testimonial_status: "stories or testimonials",
  reviewed_small_cell_risk_status: "small-cell re-identification risk",
  reviewed_financial_records_status: "financial records",
});

export function sourceRestrictionLines(decision) {
  if (!decision || decision.decision_outcome !== "reviewed") {
    return ["No completed sensitivity & allowed-use review is recorded for this file."];
  }
  const permission = (value) => (value === true ? "permitted" : "not permitted");
  const present = Object.entries(PRESENCE_LABELS).filter(([key]) => decision[key] === "present").map(([, label]) => label);
  return [
    `Allowed use: ${decision.reviewed_allowed_use_status || "unknown"}; consent basis: ${decision.reviewed_consent_basis_status || "unknown"}.`,
    `Funder use: ${permission(decision.reviewed_funder_use_allowed)}; public use: ${permission(decision.reviewed_public_use_allowed)}; `
      + `product learning: ${permission(decision.reviewed_product_learning_allowed)}; recorded AI processing permission: ${permission(decision.reviewed_llm_processing_allowed)}.`,
    present.length > 0 ? `Recorded as present: ${present.join(", ")}.` : "No sensitive category is recorded as present.",
  ];
}

export const SOURCE_AUTHORIZATION_INTENDED_USE =
  "Internal impact evidence for this organization: evidence items, proposed claims, gap follow-ups, and internal drafts. "
  + "Promotion keeps the restrictions above and approves no evidence, claim, funder or public use, export, or release.";

export const INTERNAL_DRAFT_REVIEW_STATE_LABELS = Object.freeze({
  awaiting_get_kinder_review: "Awaiting Get Kinder review",
  in_get_kinder_review: "In Get Kinder review",
  awaiting_organization_review: "Awaiting your factual review",
  reviewed_by_get_kinder: "Reviewed by Get Kinder",
  reviewed_by_your_organization: "Factual review completed by your organization",
});

// Owner amendment 2026-10-23: why a draft is held for Get Kinder review, or
// blocked for everyone, from the server's factualReview reason codes.
export const INTERNAL_DRAFT_FACTUAL_REVIEW_REASON_MESSAGES = Object.freeze({
  content_type_requires_get_kinder_review: "Only internal evidence summaries can be reviewed by your organization; Get Kinder reviews this type.",
  audience_requires_get_kinder_review: "Only internal drafts can be reviewed by your organization.",
  sensitivity_review_not_complete: "A cited source has no completed sensitivity and allowed-use review.",
  personal_information_not_cleared: "A cited source is not recorded as free of personal information.",
  minor_information_not_cleared: "A cited source is not recorded as free of information about minors.",
  sensitive_information_not_cleared: "A cited source is not recorded as free of health, housing, justice, or immigration information.",
  indigenous_governance_not_cleared: "A cited source is not recorded as free of Indigenous or governance-sensitive information.",
  story_testimonial_not_cleared: "A cited source is not recorded as free of stories or testimonials.",
  small_cell_risk_not_cleared: "A cited source is not recorded as free of small-cell re-identification risk.",
  cited_claims_not_currently_eligible: "At least one cited claim is not currently eligible for internal use.",
  source_version_not_current: "A cited source has been replaced by a newer version.",
  processing_permission_not_established: "A cited source no longer permits this use or AI processing.",
});

export const INTERNAL_DRAFT_LIMITATION_MESSAGES = Object.freeze({
  internal_use_only: "Internal use only.",
  not_approved_for_external_use: "Not approved for funder or public use, export, or release.",
  awaiting_get_kinder_review: "Get Kinder has not reviewed this draft.",
  awaiting_organization_review: "Nobody has completed the factual review of this draft yet.",
  cited_claims_not_currently_eligible: "At least one cited claim is not yet eligible for use (for example, it awaits Get Kinder claim review).",
});

// Plan A Prompt 8: the server's release state for a reviewed internal draft.
export const INTERNAL_DRAFT_RELEASE_STATE_LABELS = Object.freeze({
  awaiting_get_kinder_review: "Awaiting Get Kinder review",
  awaiting_organization_review: "Awaiting your factual review",
  awaiting_get_kinder_release: "Reviewed; awaiting Get Kinder release",
  released_for_internal_use: "Released by Get Kinder for internal use",
  release_no_longer_valid: "Released earlier; no longer available",
  release_status_unavailable: "Release status not available",
});

export const INTERNAL_DRAFT_RELEASE_STATE_MESSAGES = Object.freeze({
  awaiting_get_kinder_review: "Get Kinder reviews a draft before it can be released.",
  awaiting_organization_review: "A draft's factual review is completed before Get Kinder can release it.",
  awaiting_get_kinder_release: "The factual review of this draft is complete. Get Kinder has not released it yet; there is nothing to download.",
  released_for_internal_use: "Get Kinder released this report for your organization's internal use. It is not approved for funders or the public.",
  release_no_longer_valid: "This release can no longer be opened: Get Kinder withdrew it, or a source or claim it relies on changed. Ask Get Kinder to review it again.",
  release_status_unavailable: "Released reports cannot be opened from here right now.",
});
