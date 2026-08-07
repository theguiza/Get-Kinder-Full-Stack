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
