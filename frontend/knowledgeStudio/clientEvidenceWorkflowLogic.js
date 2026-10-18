import { errorText, isRouteUuid } from "../impactEvidenceLibraryLogic.js";

/**
 * Client organization-administrator evidence-to-draft workflow (owner
 * decision 2026-10-18): governed source -> evidence extraction -> evidence ->
 * claim proposal -> claim gap follow-ups (P2-04) -> claim selection ->
 * internal evidence summary / impact narrative. Every flag is the server's
 * access-capabilities answer; nothing here grants or infers authority.
 * Authorization and input readiness are kept separate: an authorized actor
 * can still be missing a Project or a claim, and is told which.
 */

const WORKFLOW_OPERATION_KEYS = Object.freeze(["extractEvidence", "proposeClaim", "generateClaimGapFollowups", "generateDrafts"]);

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
