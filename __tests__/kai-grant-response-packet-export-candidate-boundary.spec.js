import test from "node:test";
import assert from "node:assert/strict";

import {
  __grantResponsePacketExportCandidateRepositoryTestables,
} from "../Backend/kai/dictionary/postgresGrantResponsePacketExportCandidateRepository.js";
import {
  buildGrantResponsePacketExportCandidateRepresentation,
  canonicalFingerprint,
  composeGrantResponsePacketExportCandidateFingerprint,
  GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_RENDER_MODEL_ERROR,
} from "../Backend/kai/services/kaiGrantResponsePacketExportCandidateFingerprintService.js";

const { isCreateGrantResponsePacketExportCandidateInput } = __grantResponsePacketExportCandidateRepositoryTestables;

const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "14030000-0000-4000-8000-000000000001";
const DRAFT_A = "14030000-0000-4000-8000-0000000000a1";
const DRAFT_B = "14030000-0000-4000-8000-0000000000a2";
const ACTOR = Object.freeze({ actorType: "human", actorUserId: "00000000-0000-4000-8000-000000000910" });
const NOW = "2026-09-09T12:00:00.000Z";

function baseInput(overrides = {}) {
  return { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: ACTOR, now: NOW, ...overrides };
}

function baseCitation(overrides = {}) {
  return {
    claimId: "14030000-0000-4000-8000-0000000000c1",
    evidenceItemId: "14030000-0000-4000-8000-0000000000e1",
    sourceId: "14030000-0000-4000-8000-0000000000s1",
    sourceVersionId: "14030000-0000-4000-8000-0000000000v1",
    generatedContentCitationId: "14030000-0000-4000-8000-0000000000cc1",
    supportStrength: "strong",
    claimReviewStatus: "resolved",
    evidenceReviewStatus: "resolved",
    currentEligible: true,
    blockerCodes: [],
    affectedDimensionKeys: [],
    affectedObjectIds: [],
    ...overrides,
  };
}

function baseBlock(overrides = {}) {
  return {
    ordinal: 0,
    generatedContentBlockId: "14030000-0000-4000-8000-0000000000b1",
    text: "Some block text - not part of the fingerprint representation.",
    citations: [baseCitation()],
    ...overrides,
  };
}

function baseMember(overrides = {}) {
  return {
    generatedContentDraftId: DRAFT_A,
    contentType: "evidence_summary",
    requestedAudience: "funder",
    draftStatus: "client_reviewed",
    reviewUpdatedAt: "2026-01-01T00:00:00.000Z",
    currentUseEligible: true,
    exportManifestId: null,
    exportManifestHistory: [],
    blocks: [baseBlock()],
    ...overrides,
  };
}

function baseRenderModel(overrides = {}) {
  return {
    renderModelContractVersion: "kai-sprint2-grant-response-packet-render-model-v1",
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    packetAudience: "funder",
    members: [baseMember()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Repository input-contract: proves the accepted input shape and that the
// service can never accept caller-supplied membership/candidate/manifest
// fields - this IS the "browser cannot supply membership" proof, at the type
// level of the function signature itself.
// ---------------------------------------------------------------------------

test("accepts the exact-keys organizationId + engagementId + actorContext + now input", () => {
  assert.equal(isCreateGrantResponsePacketExportCandidateInput(baseInput()), true);
});

test("rejects a non-UUID organizationId", () => {
  assert.equal(isCreateGrantResponsePacketExportCandidateInput(baseInput({ organizationId: "not-a-uuid" })), false);
});

test("rejects a non-UUID engagementId", () => {
  assert.equal(isCreateGrantResponsePacketExportCandidateInput(baseInput({ engagementId: "not-a-uuid" })), false);
});

test("rejects a non-canonical now timestamp", () => {
  assert.equal(isCreateGrantResponsePacketExportCandidateInput(baseInput({ now: "not-a-timestamp" })), false);
  assert.equal(isCreateGrantResponsePacketExportCandidateInput(baseInput({ now: "2026-09-09" })), false);
});

test("rejects a non-human actorContext", () => {
  assert.equal(
    isCreateGrantResponsePacketExportCandidateInput(baseInput({ actorContext: { actorType: "ai", actorUserId: "x" } })),
    false,
  );
});

test("rejects a client-supplied memberIds field", () => {
  assert.equal(isCreateGrantResponsePacketExportCandidateInput(baseInput({ memberIds: [DRAFT_A] })), false);
});

test("rejects a client-supplied generatedContentDraftIds field", () => {
  assert.equal(
    isCreateGrantResponsePacketExportCandidateInput(baseInput({ generatedContentDraftIds: [DRAFT_A, DRAFT_B] })),
    false,
  );
});

test("rejects a client-supplied exportCandidateId field", () => {
  assert.equal(isCreateGrantResponsePacketExportCandidateInput(baseInput({ exportCandidateId: ORG })), false);
});

test("rejects a client-supplied exportManifestId field", () => {
  assert.equal(isCreateGrantResponsePacketExportCandidateInput(baseInput({ exportManifestId: ORG })), false);
});

test("rejects a client-supplied canonicalFingerprint field", () => {
  assert.equal(
    isCreateGrantResponsePacketExportCandidateInput(baseInput({ canonicalFingerprint: "a".repeat(64) })),
    false,
  );
});

test("rejects a client-supplied grantResponsePacketExportCandidateId field", () => {
  assert.equal(
    isCreateGrantResponsePacketExportCandidateInput(baseInput({ grantResponsePacketExportCandidateId: ORG })),
    false,
  );
});

test("rejects null and non-object input", () => {
  assert.equal(isCreateGrantResponsePacketExportCandidateInput(null), false);
  assert.equal(isCreateGrantResponsePacketExportCandidateInput("string"), false);
  assert.equal(isCreateGrantResponsePacketExportCandidateInput(undefined), false);
});

// ---------------------------------------------------------------------------
// Fingerprint composition: funder-only enforcement, ordered membership,
// exclusion of unstable timestamps and single-draft export-review/manifest
// track state.
// ---------------------------------------------------------------------------

test("rejects a non-funder render model - funder-only audience enforced", () => {
  const result = buildGrantResponsePacketExportCandidateRepresentation(baseRenderModel({ packetAudience: "internal" }));
  assert.equal(result.representation, null);
  assert.equal(result.error, GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_RENDER_MODEL_ERROR.NOT_FUNDER_AUDIENCE);
});

test("composeGrantResponsePacketExportCandidateFingerprint refuses a non-funder render model", () => {
  const result = composeGrantResponsePacketExportCandidateFingerprint(baseRenderModel({ packetAudience: "public" }));
  assert.equal(result.fingerprint, null);
  assert.equal(result.orderedGeneratedContentDraftIds, null);
});

test("identical semantic state converges to the identical fingerprint", () => {
  const first = composeGrantResponsePacketExportCandidateFingerprint(baseRenderModel());
  const second = composeGrantResponsePacketExportCandidateFingerprint(baseRenderModel());
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(/^[a-f0-9]{64}$/.test(first.fingerprint), true);
});

test("changed material citation state (blockerCodes) produces a different fingerprint", () => {
  const first = composeGrantResponsePacketExportCandidateFingerprint(baseRenderModel());
  const changed = composeGrantResponsePacketExportCandidateFingerprint(
    baseRenderModel({
      members: [
        baseMember({
          blocks: [baseBlock({ citations: [baseCitation({ blockerCodes: ["missing_citation"] })] })],
        }),
      ],
    }),
  );
  assert.notEqual(first.fingerprint, changed.fingerprint);
});

test("changed member order produces a different fingerprint", () => {
  const forward = composeGrantResponsePacketExportCandidateFingerprint(
    baseRenderModel({
      members: [baseMember({ generatedContentDraftId: DRAFT_A }), baseMember({ generatedContentDraftId: DRAFT_B })],
    }),
  );
  const reversed = composeGrantResponsePacketExportCandidateFingerprint(
    baseRenderModel({
      members: [baseMember({ generatedContentDraftId: DRAFT_B }), baseMember({ generatedContentDraftId: DRAFT_A })],
    }),
  );
  assert.notEqual(forward.fingerprint, reversed.fingerprint);
  assert.deepEqual(forward.orderedGeneratedContentDraftIds, [DRAFT_A, DRAFT_B]);
  assert.deepEqual(reversed.orderedGeneratedContentDraftIds, [DRAFT_B, DRAFT_A]);
});

test("an unstable presentation timestamp (reviewUpdatedAt) does not affect the fingerprint", () => {
  const first = composeGrantResponsePacketExportCandidateFingerprint(
    baseRenderModel({ members: [baseMember({ reviewUpdatedAt: "2026-01-01T00:00:00.000Z" })] }),
  );
  const second = composeGrantResponsePacketExportCandidateFingerprint(
    baseRenderModel({ members: [baseMember({ reviewUpdatedAt: "2027-06-15T08:30:00.000Z" })] }),
  );
  assert.equal(first.fingerprint, second.fingerprint);
});

test("single-draft export-manifest track churn (exportManifestId/History) does not affect the fingerprint", () => {
  const first = composeGrantResponsePacketExportCandidateFingerprint(
    baseRenderModel({ members: [baseMember({ exportManifestId: null, exportManifestHistory: [] })] }),
  );
  const second = composeGrantResponsePacketExportCandidateFingerprint(
    baseRenderModel({
      members: [
        baseMember({
          exportManifestId: "14030000-0000-4000-8000-0000000000f1",
          exportManifestHistory: [
            { exportManifestId: "14030000-0000-4000-8000-0000000000f1", exportCandidateId: ORG, createdAt: "2026-05-01T00:00:00.000Z" },
          ],
        }),
      ],
    }),
  );
  assert.equal(first.fingerprint, second.fingerprint);
});

test("canonicalFingerprint is a deterministic function of the representation (key order independence)", () => {
  const representationA = { z: 1, a: { y: 2, x: 3 } };
  const representationB = { a: { x: 3, y: 2 }, z: 1 };
  assert.equal(canonicalFingerprint(representationA), canonicalFingerprint(representationB));
});
