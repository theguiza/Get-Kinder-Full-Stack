// P14-03 grant-response-packet-export-candidate canonical fingerprint.
//
// The ONLY authoritative input to this fingerprint is a
// composeGrantResponsePacketRenderModel(...) render model - never a raw DB
// row, never a caller-supplied shape. That render model is itself derived
// exclusively from getGrantResponsePacket (see
// kaiGrantResponsePacketRenderModelService.js), so this module has no
// database dependency of its own.
//
// Covered (material, semantic packet state):
//  - packetAudience (must be exactly "funder" - funder-only; anything else
//    is rejected by the caller before this module is reached, and this
//    module refuses to build a representation for anything else as a second,
//    independent guard)
//  - the ordered list of member generatedContentDraftIds (packet membership
//    order is exactly the render model's deterministic order - never
//    re-sorted here)
//  - ordered block identities (ordinal + generatedContentBlockId) per member
//  - ordered citation identities (claimId, evidenceItemId, sourceId,
//    sourceVersionId, generatedContentCitationId) per block
//  - material limitation/blocker state per citation (supportStrength,
//    claimReviewStatus, evidenceReviewStatus, currentEligible,
//    blockerCodes, affectedDimensionKeys, affectedObjectIds) and per member
//    (draftStatus, currentUseEligible)
//
// Explicitly EXCLUDED (unstable / non-structural, so two requests over the
// same semantic state converge to the same fingerprint):
//  - any timestamp (reviewUpdatedAt, exportManifestHistory[].createdAt, or
//    any other presentation timestamp)
//  - single-draft export-review/export-manifest track state
//    (reviewQueueItemId, queueStatus, reviewStatus, exportReviewQueueItemId,
//    exportReviewQueueStatus, exportReviewStatus, exportManifestId,
//    exportManifestHistory, exportReviewVisible, generationRunId) - that
//    track is separately governed per P3-16/P3-17/P3-18/P3-19/P3-20 and is
//    not part of what makes this PACKET candidate's structural/citation/
//    limitation state the same or different.

import crypto from "node:crypto";

export const GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_RENDER_MODEL_ERROR = Object.freeze({
  NOT_FUNDER_AUDIENCE: "not_funder_audience",
  INVALID_RENDER_MODEL: "invalid_render_model",
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function projectCitation(citation) {
  if (!isPlainObject(citation)) return null;
  return {
    claimId: citation.claimId,
    evidenceItemId: citation.evidenceItemId,
    sourceId: citation.sourceId,
    sourceVersionId: citation.sourceVersionId,
    generatedContentCitationId: Object.prototype.hasOwnProperty.call(citation, "generatedContentCitationId")
      ? citation.generatedContentCitationId
      : null,
    supportStrength: citation.supportStrength,
    claimReviewStatus: citation.claimReviewStatus,
    evidenceReviewStatus: citation.evidenceReviewStatus,
    currentEligible: citation.currentEligible,
    blockerCodes: Array.isArray(citation.blockerCodes) ? [...citation.blockerCodes] : null,
    affectedDimensionKeys: Array.isArray(citation.affectedDimensionKeys) ? [...citation.affectedDimensionKeys] : null,
    affectedObjectIds: Array.isArray(citation.affectedObjectIds) ? [...citation.affectedObjectIds] : null,
  };
}

function projectBlock(block) {
  if (!isPlainObject(block) || !Array.isArray(block.citations)) return null;
  const citations = block.citations.map(projectCitation);
  if (citations.some((citation) => citation === null)) return null;
  return {
    ordinal: block.ordinal,
    generatedContentBlockId: Object.prototype.hasOwnProperty.call(block, "generatedContentBlockId")
      ? block.generatedContentBlockId
      : null,
    citations,
  };
}

function projectMember(member) {
  if (!isPlainObject(member) || !Array.isArray(member.blocks)) return null;
  const blocks = member.blocks.map(projectBlock);
  if (blocks.some((block) => block === null)) return null;
  return {
    generatedContentDraftId: member.generatedContentDraftId,
    contentType: member.contentType,
    requestedAudience: member.requestedAudience,
    draftStatus: member.draftStatus,
    currentUseEligible: member.currentUseEligible,
    blocks,
  };
}

/**
 * Builds the canonical, fingerprint-ready representation of a Grant Response
 * Packet render model, or returns { representation: null, error } when the
 * render model is not exactly the funder-audience shape this package
 * supports. Never mutates the input render model.
 */
export function buildGrantResponsePacketExportCandidateRepresentation(renderModel) {
  if (!isPlainObject(renderModel) || !Array.isArray(renderModel.members)) {
    return { representation: null, error: GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_RENDER_MODEL_ERROR.INVALID_RENDER_MODEL };
  }
  if (renderModel.packetAudience !== "funder") {
    return { representation: null, error: GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_RENDER_MODEL_ERROR.NOT_FUNDER_AUDIENCE };
  }
  const members = renderModel.members.map(projectMember);
  if (members.some((member) => member === null)) {
    return { representation: null, error: GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_RENDER_MODEL_ERROR.INVALID_RENDER_MODEL };
  }

  return {
    representation: {
      organizationId: renderModel.organizationId,
      engagementId: renderModel.engagementId,
      packetAudience: renderModel.packetAudience,
      // Membership order is exactly the render model's own order - never
      // re-sorted, never re-derived from anything else.
      members,
    },
    error: null,
  };
}

export function canonicalFingerprint(representation) {
  return crypto.createHash("sha256").update(canonicalJson(representation)).digest("hex");
}

/**
 * Convenience wrapper: renderModel -> { fingerprint, representation, error }.
 * `orderedGeneratedContentDraftIds` is exposed alongside because the
 * repository needs the packet's exact member order to persist the member
 * snapshot - it must never re-derive or re-sort that order itself.
 */
export function composeGrantResponsePacketExportCandidateFingerprint(renderModel) {
  const { representation, error } = buildGrantResponsePacketExportCandidateRepresentation(renderModel);
  if (!representation) return { fingerprint: null, representation: null, orderedGeneratedContentDraftIds: null, error };
  return {
    fingerprint: canonicalFingerprint(representation),
    representation,
    orderedGeneratedContentDraftIds: representation.members.map((member) => member.generatedContentDraftId),
    error: null,
  };
}

export const __grantResponsePacketExportCandidateFingerprintServiceTestables = Object.freeze({
  buildGrantResponsePacketExportCandidateRepresentation,
  projectMember,
  projectBlock,
  projectCitation,
});
