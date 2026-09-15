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

// Governed export finalization: three existing, separately-authorized
// operations chained in the UI - P3-16 candidate preparation, the explicit
// human P3-17 final-release-authority grant, and the P3-19 manifest
// finalization (which enforces VAL-EXP-001/finalGate inside its own
// transaction). Each route below is the exact accepted backend route; none of
// these paths encodes eligibility, authority, or manifest-selection logic.

export function exportCandidatePath(organizationId, generatedContentDraftId) {
  return `${BASE_PATH}/admin/organizations/${organizationId}`
    + `/generated-content-drafts/${generatedContentDraftId}/export-candidates`;
}

export function limitationSnapshotPath(organizationId, generatedContentDraftId) {
  return `${BASE_PATH}/admin/organizations/${organizationId}`
    + `/generated-content-drafts/${generatedContentDraftId}/limitation-snapshot`;
}

export function finalReleaseAuthorityPath(organizationId, exportCandidateId) {
  return `${BASE_PATH}/admin/organizations/${organizationId}`
    + `/export-candidates/${exportCandidateId}/final-release-authority`;
}

export function exportManifestsPath(organizationId, exportCandidateId) {
  return `${BASE_PATH}/admin/organizations/${organizationId}`
    + `/export-candidates/${exportCandidateId}/export-manifests`;
}

export function exportManifestMarkdownPath(organizationId, exportManifestId) {
  return `${BASE_PATH}/admin/organizations/${organizationId}`
    + `/export-manifests/${exportManifestId}/markdown`;
}

export function exportManifestCsvPath(organizationId, exportManifestId) {
  return `${BASE_PATH}/admin/organizations/${organizationId}`
    + `/export-manifests/${exportManifestId}/csv`;
}

export function exportManifestPdfPath(organizationId, exportManifestId) {
  return `${BASE_PATH}/admin/organizations/${organizationId}`
    + `/export-manifests/${exportManifestId}/pdf`;
}

export function exportManifestDocxPath(organizationId, exportManifestId) {
  return `${BASE_PATH}/admin/organizations/${organizationId}`
    + `/export-manifests/${exportManifestId}/docx`;
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

// The confirmation request body is fixed to exactly {} - no client-curated
// claim/evidence/limitation-code entries ever leave this call; entries are
// derived server-side, exclusively from the draft's own persisted citations.
export async function confirmLimitationSnapshotRequest(path) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return { statusCode: response.status, body: await readJson(response) };
}

// The candidate-preparation request body is fixed to exactly {} - no
// client-supplied audience, fingerprint, or currentness data ever leaves this
// call; the existing P3-16 service derives all of that itself.
export async function createExportCandidateRequest(path) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return { statusCode: response.status, body: await readJson(response) };
}

// The authority-decision request body is fixed to exactly
// { requested_audience, decision_action } - this is the one place this page
// ever asks a human to explicitly grant/revoke P3-17 final-release authority;
// it is never inferred or changed automatically.
async function recordFinalReleaseAuthorityRequest(path, requestedAudience, decisionAction) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ requested_audience: requestedAudience, decision_action: decisionAction }),
  });
  return { statusCode: response.status, body: await readJson(response) };
}

export async function grantFinalReleaseAuthorityRequest(path, requestedAudience) {
  return recordFinalReleaseAuthorityRequest(path, requestedAudience, "grant");
}

export async function revokeFinalReleaseAuthorityRequest(path, requestedAudience) {
  return recordFinalReleaseAuthorityRequest(path, requestedAudience, "revoke");
}

// The manifest-finalization request body is fixed to exactly
// { export_review_queue_item_id } - no client-supplied finalGate, authority,
// or eligibility data ever leaves this call; the existing P3-19
// createExportManifest transaction is the sole authority for whether a
// manifest is created, and for the exact exportManifestId returned.
export async function createExportManifestRequest(path, exportReviewQueueItemId) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ export_review_queue_item_id: exportReviewQueueItemId }),
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
    limitationSnapshotConfirmed: data.limitationSnapshotConfirmed,
    candidateReadyToPrepare: data.candidateReadyToPrepare,
    // P3-12: retained for Start Review control-state logic only. Neither
    // field is rendered by this page - see gkExportReviewDetail.jsx.
    exportReviewQueueStatus: data.exportReviewQueueStatus,
    exportReviewUpdatedAt: data.exportReviewUpdatedAt,
    // Compatibility-only: the singular backend field collapses to null
    // whenever more than one manifest exists for this review item. This
    // page no longer uses this field to restore active workflow state - see
    // exportManifestHistory below for the authoritative persisted history.
    exportManifestId: data.exportManifestId ?? null,
    // Authoritative persisted history: every exact manifest ever finalized
    // for this review item (0 -> [], 1 -> [A], N -> all N). Projected as
    // exactly exportManifestId/exportCandidateId/createdAt per entry - never
    // derived, re-ordered, or filtered down to a single "current" one here.
    exportManifestHistory: Array.isArray(data.exportManifestHistory)
      ? data.exportManifestHistory.map((entry) => ({
        exportManifestId: entry?.exportManifestId,
        exportCandidateId: entry?.exportCandidateId,
        createdAt: entry?.createdAt,
      }))
      : [],
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

// Phase-14: the packet now exposes the P3-16 limitation-snapshot currentness
// prerequisite directly (candidateReadyToPrepare), computed server-side from
// export-review resolution, current-snapshot existence, authorized content
// type, and VAL-EXP-001 exportEligible - so this UI can gate Prepare Export
// Candidate on the real, authoritative readiness state instead of the
// conservative exportEligible-only approximation. No currentness, fingerprint,
// or eligibility computation happens here.
export function canPrepareExportCandidate(model) {
  return !!model && model.candidateReadyToPrepare === true;
}

// Phase-14: shows the limitation-snapshot confirmation control whenever
// export review is resolved (the same prerequisite createExportCandidate
// itself requires before it ever reaches the snapshot check) but the
// server-derived packet reports no current snapshot yet.
export function canConfirmLimitationSnapshot(model) {
  return !!model
    && model.exportReviewQueueStatus === "resolved"
    && model.exportReviewStatus === "resolved"
    && model.limitationSnapshotConfirmed === false;
}

// P3-16 limitation-snapshot confirmation: success/conflict both resolve by
// re-fetching the P3-07 packet once (never by trusting this response body),
// exactly like decideStartResult/decideCompleteResult above.
export function decideConfirmLimitationSnapshotResult(result) {
  if (result?.statusCode === 201 && result?.body?.ok === true) {
    return { kind: "success" };
  }
  if (result?.body?.error?.code === "conflict_current_state_changed") {
    return { kind: "conflict" };
  }
  return { kind: "error", message: errorText(result) };
}

// P3-16 candidate preparation: success returns the exact exportCandidateId
// this page then carries into the P3-17 and P3-19 steps; nothing here is
// ever discovered by re-querying historical candidates.
export function decideCreateExportCandidateResult(result) {
  if (result?.statusCode === 201 && result?.body?.ok === true) {
    return { kind: "success", exportCandidateId: result.body.data?.exportCandidateId ?? null };
  }
  return { kind: "error", message: errorText(result) };
}

// P3-17 final-release authority: success reports whether the grant is
// currently effective; this page never infers effectiveness itself.
export function decideGrantFinalReleaseAuthorityResult(result) {
  if (result?.statusCode === 201 && result?.body?.ok === true) {
    return { kind: "success", effective: result.body.data?.effective === true };
  }
  return { kind: "error", message: errorText(result) };
}

// P3-19 manifest finalization: success returns the exact exportManifestId
// this finalization produced; that id is what Download Markdown uses, never
// a manifest discovered afterward by any other means. A conflict means the
// existing P3-18/VAL-EXP-001 gate or currentness check inside the manifest
// transaction rejected the attempt - no manifest was created.
export function decideCreateExportManifestResult(result) {
  if (result?.statusCode === 201 && result?.body?.ok === true) {
    return { kind: "success", exportManifestId: result.body.data?.exportManifestId ?? null };
  }
  if (result?.body?.error?.code === "conflict_current_state_changed") {
    return { kind: "conflict", message: errorText(result) };
  }
  return { kind: "error", message: errorText(result) };
}
