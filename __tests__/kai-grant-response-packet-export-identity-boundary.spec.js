import test from "node:test";
import assert from "node:assert/strict";

import {
  __grantResponsePacketExportIdentityRepositoryTestables,
} from "../Backend/kai/dictionary/postgresGrantResponsePacketExportIdentityRepository.js";

const { isGetOrCreateGrantResponsePacketExportIdentityInput, PACKET_AUDIENCE } =
  __grantResponsePacketExportIdentityRepositoryTestables;

const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "14020000-0000-4000-8000-000000000001";
const ACTOR = Object.freeze({ actorType: "human", actorUserId: "00000000-0000-4000-8000-000000000910" });

function baseInput(overrides = {}) {
  return { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: ACTOR, ...overrides };
}

test("PACKET_AUDIENCE is pinned to the single existing supported Grant Response Packet audience", () => {
  assert.equal(PACKET_AUDIENCE, "funder");
});

test("accepts the exact-keys organizationId + engagementId + actorContext input", () => {
  assert.equal(isGetOrCreateGrantResponsePacketExportIdentityInput(baseInput()), true);
});

test("rejects a non-UUID organizationId", () => {
  assert.equal(isGetOrCreateGrantResponsePacketExportIdentityInput(baseInput({ organizationId: "not-a-uuid" })), false);
});

test("rejects a non-UUID engagementId", () => {
  assert.equal(isGetOrCreateGrantResponsePacketExportIdentityInput(baseInput({ engagementId: "not-a-uuid" })), false);
});

test("rejects a non-human actorContext", () => {
  assert.equal(
    isGetOrCreateGrantResponsePacketExportIdentityInput(baseInput({ actorContext: { actorType: "ai", actorUserId: "x" } })),
    false,
  );
});

test("rejects a missing actorContext.actorUserId", () => {
  assert.equal(
    isGetOrCreateGrantResponsePacketExportIdentityInput(baseInput({ actorContext: { actorType: "human" } })),
    false,
  );
});

test("rejects an extra, client-supplied packetAudience key - audience is always pinned, never taken from the caller", () => {
  assert.equal(
    isGetOrCreateGrantResponsePacketExportIdentityInput(baseInput({ packetAudience: "funder" })),
    false,
  );
});

test("rejects an extra, client-supplied grantResponsePacketExportIdentityId key - identity is always minted or looked up, never client-assigned", () => {
  assert.equal(
    isGetOrCreateGrantResponsePacketExportIdentityInput(
      baseInput({ grantResponsePacketExportIdentityId: "00000000-0000-4000-8000-000000000301" }),
    ),
    false,
  );
});

test("rejects a client-supplied exportCandidateId or exportManifestId - member export identity is never promoted to packet identity", () => {
  assert.equal(isGetOrCreateGrantResponsePacketExportIdentityInput(baseInput({ exportCandidateId: ORG })), false);
  assert.equal(isGetOrCreateGrantResponsePacketExportIdentityInput(baseInput({ exportManifestId: ORG })), false);
});

test("rejects null and non-object input", () => {
  assert.equal(isGetOrCreateGrantResponsePacketExportIdentityInput(null), false);
  assert.equal(isGetOrCreateGrantResponsePacketExportIdentityInput("string"), false);
  assert.equal(isGetOrCreateGrantResponsePacketExportIdentityInput(undefined), false);
});
