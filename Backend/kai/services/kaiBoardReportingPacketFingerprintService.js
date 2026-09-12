import crypto from "node:crypto";

export const BOARD_REPORTING_PACKET_FINGERPRINT_ERROR = Object.freeze({
  NOT_INTERNAL_AUDIENCE: "not_internal_audience",
  NO_ELIGIBLE_MEMBERS: "no_eligible_members",
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

export function buildBoardReportingPacketRepresentation(renderModel) {
  if (!isPlainObject(renderModel) || !Array.isArray(renderModel.members)) {
    return { representation: null, error: BOARD_REPORTING_PACKET_FINGERPRINT_ERROR.INVALID_RENDER_MODEL };
  }
  if (renderModel.packetAudience !== "internal") {
    return { representation: null, error: BOARD_REPORTING_PACKET_FINGERPRINT_ERROR.NOT_INTERNAL_AUDIENCE };
  }
  if (renderModel.members.length === 0) {
    return { representation: null, error: BOARD_REPORTING_PACKET_FINGERPRINT_ERROR.NO_ELIGIBLE_MEMBERS };
  }
  const members = renderModel.members.map(projectMember);
  if (members.some((member) => member === null)) {
    return { representation: null, error: BOARD_REPORTING_PACKET_FINGERPRINT_ERROR.INVALID_RENDER_MODEL };
  }

  return {
    representation: {
      organizationId: renderModel.organizationId,
      engagementId: renderModel.engagementId,
      packetAudience: renderModel.packetAudience,
      supportedContentTypes: Array.isArray(renderModel.supportedContentTypes)
        ? [...renderModel.supportedContentTypes]
        : null,
      members,
    },
    error: null,
  };
}

export function canonicalFingerprint(representation) {
  return crypto.createHash("sha256").update(canonicalJson(representation)).digest("hex");
}

export function composeBoardReportingPacketFingerprint(renderModel) {
  const { representation, error } = buildBoardReportingPacketRepresentation(renderModel);
  if (!representation) return { fingerprint: null, representation: null, orderedGeneratedContentDraftIds: null, error };
  return {
    fingerprint: canonicalFingerprint(representation),
    representation,
    orderedGeneratedContentDraftIds: representation.members.map((member) => member.generatedContentDraftId),
    error: null,
  };
}

export const __boardReportingPacketFingerprintServiceTestables = Object.freeze({
  canonicalJson,
  projectMember,
  projectBlock,
  projectCitation,
});
