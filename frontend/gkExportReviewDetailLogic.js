/**
 * KAI P3-08 pure request/response logic for the read-only GK export-review
 * detail page. Kept free of JSX so it can be imported directly by both the
 * Vite bundle and plain Node test runs.
 */

export const BASE_PATH = "/api/kai/sprint2/intake";

export const SAFE_ERROR_CODES = new Set([
  "feature_disabled",
  "invalid_request",
  "unauthorized",
  "mapped_kai_user_required",
  "authorization_denied",
  "tenant_boundary_violation",
  "not_found",
  "conflict_current_state_changed",
  "system_error",
]);

export function packetPath(organizationId, generatedContentDraftId, exportReviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${organizationId}`
    + `/generated-content-drafts/${generatedContentDraftId}`
    + `/export-review-queue/${exportReviewQueueItemId}/packet`;
}

export function startPath(organizationId, generatedContentDraftId, exportReviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${organizationId}`
    + `/generated-content-drafts/${generatedContentDraftId}`
    + `/export-review-queue/${exportReviewQueueItemId}/start`;
}

export function completePath(organizationId, generatedContentDraftId, exportReviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${organizationId}`
    + `/generated-content-drafts/${generatedContentDraftId}`
    + `/export-review-queue/${exportReviewQueueItemId}/complete`;
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

// P3-12: issues the accepted P3-10 start transition. The request body is fixed
// to exactly { expected_updated_at } - no actorContext, no now, no other
// client-supplied authority data ever leaves this call.
export async function startReviewRequest(path, expectedUpdatedAt) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ expected_updated_at: expectedUpdatedAt }),
  });
  return { statusCode: response.status, body: await readJson(response) };
}

// P3-15: issues the accepted P3-14 completion transition. The request body is
// fixed to exactly { expected_updated_at } - no actorContext, no now, no
// other client-supplied authority data ever leaves this call.
export async function completeReviewRequest(path, expectedUpdatedAt) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ expected_updated_at: expectedUpdatedAt }),
  });
  return { statusCode: response.status, body: await readJson(response) };
}

export function errorText(result) {
  return result?.body?.error?.message || `Request failed (${result?.statusCode ?? "unknown"}).`;
}

// Explicit allowlist projection: only the P3-06 fields this page is authorized to
// show are ever read off the response. Any other field present on the response
// (extra, malformed, or otherwise) is never inspected or rendered - it is not
// "silently accepted", it is simply outside what this read-only view surfaces.
export function toRenderModel(data) {
  if (!data || typeof data !== "object") return null;
  const validatorResult = data.validatorResult && typeof data.validatorResult === "object"
    ? data.validatorResult
    : {};
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];
  return {
    requestedExportAudience: data.requestedExportAudience,
    draftStatus: data.draftStatus,
    generatedContentReviewStatus: data.generatedContentReviewStatus,
    exportReviewStatus: data.exportReviewStatus,
    currentUseEligible: data.currentUseEligible,
    exportEligible: data.exportEligible,
    // P3-12: retained for Start Review control-state logic only. Neither
    // field is rendered by this page - see gkExportReviewDetail.jsx.
    exportReviewQueueStatus: data.exportReviewQueueStatus,
    exportReviewUpdatedAt: data.exportReviewUpdatedAt,
    validatorSeverity: validatorResult.severity,
    validatorFailedGate: validatorResult.blocking_reason ?? null,
    blocks: blocks.map((block) => ({
      ordinal: block?.ordinal,
      text: block?.text,
      citations: Array.isArray(block?.citations) ? block.citations.map((citation) => ({
        claimId: citation?.claimId,
        evidenceItemId: citation?.evidenceItemId,
        sourceId: citation?.sourceId,
        sourceVersionId: citation?.sourceVersionId,
        supportStrength: citation?.supportStrength,
        claimReviewStatus: citation?.claimReviewStatus,
        evidenceReviewStatus: citation?.evidenceReviewStatus,
        currentEligible: citation?.currentEligible,
        blockerCodes: Array.isArray(citation?.blockerCodes) ? citation.blockerCodes : [],
        affectedDimensionKeys: Array.isArray(citation?.affectedDimensionKeys) ? citation.affectedDimensionKeys : [],
        affectedObjectIds: Array.isArray(citation?.affectedObjectIds) ? citation.affectedObjectIds : [],
      })) : [],
    })),
  };
}

// A single decision point for every fetch outcome. Any result that is not an
// explicit "ok:true, statusCode 200" success is treated as a rejection and
// never produces a render model - a malformed or ambiguous response is
// rejected, not silently ignored into a partially-rendered packet.
export function decideOutcome(result) {
  if (result?.statusCode === 200 && result?.body?.ok === true) {
    return { kind: "success", model: toRenderModel(result.body.data) };
  }
  return { kind: "error", message: errorText(result) };
}

// P3-12: the Start Review control shows only for the one queue/review state
// pair this ticket authorizes. Every other combination (including
// in_progress) shows none.
export function canStartReview(model) {
  return !!model
    && model.exportReviewQueueStatus === "open"
    && model.exportReviewStatus === "needs_gk_review";
}

// P3-12: a single decision point for the P3-10 start response. Success and
// conflict_current_state_changed both resolve by re-fetching the P3-07
// packet once (never by trusting this response body); every other outcome
// is a safe, displayable error with no partial mutation state.
export function decideStartResult(result) {
  if (result?.statusCode === 200 && result?.body?.ok === true) {
    return { kind: "success" };
  }
  if (result?.body?.error?.code === "conflict_current_state_changed") {
    return { kind: "conflict" };
  }
  return { kind: "error", message: errorText(result) };
}

// P3-15: the Complete Review control shows only for the one queue/review
// state pair this ticket authorizes. Every other combination (including
// open/needs_gk_review, where Start Review shows instead) shows none.
export function canCompleteReview(model) {
  return !!model
    && model.exportReviewQueueStatus === "in_progress"
    && model.exportReviewStatus === "needs_gk_review";
}

// P3-15: a single decision point for the P3-14 completion response. Success
// and conflict_current_state_changed both resolve by re-fetching the P3-07
// packet once (never by trusting this response body); every other outcome
// is a safe, displayable error with no partial mutation state.
export function decideCompleteResult(result) {
  if (result?.statusCode === 200 && result?.body?.ok === true) {
    return { kind: "success" };
  }
  if (result?.body?.error?.code === "conflict_current_state_changed") {
    return { kind: "conflict" };
  }
  return { kind: "error", message: errorText(result) };
}
