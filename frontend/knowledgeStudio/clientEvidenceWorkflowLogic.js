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

// What the actor is told about a created draft: identity and status only.
// Draft text is shown under Generated Drafts once Get Kinder has reviewed it.
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
    return "Source preparation continued: the source candidate was created from your recorded sensitivity review. Review & promote it below. Your review was not changed.";
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
  sensitivity_decision_recorded_by_another_reviewer: "its current sensitivity review was not recorded by you as this organization's administrator",
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
