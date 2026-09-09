// P14-04: proves the fixed P14-03 audit-metadata gap - the metadata-only
// packet-candidate audit now retains canonical_fingerprint and member_count
// end-to-end (adapter -> sanitizeAuditMetadataForStorage), while every raw/
// content-bearing field a caller might attempt to pass through the same
// payload is still excluded, and the generic metadata-only security boundary
// (contains_* flags, no member/block/citation/credential/signed-url/storage
// path) is unchanged.

import test from "node:test";
import assert from "node:assert/strict";

import { createProductionMetadataOnlyAuditForGrantResponsePacketExportCandidate } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";
import { sanitizeAuditMetadataForStorage } from "../Backend/kai/db/kaiAuditQueries.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const engagementId = "14040000-0000-4000-8000-000000000001";
const candidateId = "14040000-0000-4000-8000-000000000002";
const identityId = "14040000-0000-4000-8000-000000000003";
const canonicalFingerprint = "c".repeat(64);
const actorContext = Object.freeze({ actorType: "human", actorUserId: "90000000-0000-4000-8000-000000000001" });
const now = "2026-09-09T12:00:00.000Z";

function baseFactory(overrides = {}) {
  const captured = [];
  const insertAuditEvent = async (metadata) => {
    captured.push(metadata);
    return { ok: true };
  };
  const audit = createProductionMetadataOnlyAuditForGrantResponsePacketExportCandidate({
    organizationId,
    engagementId,
    actorContext,
    now,
    insertAuditEvent,
    ...overrides,
  });
  return { audit, captured };
}

test("audit retains canonical_fingerprint and member_count through the full sanitize pipeline", async () => {
  const { audit, captured } = baseFactory();
  const prepared = audit.prepareMetadataOnlyAudit({
    payload: {
      grant_response_packet_export_candidate_id: candidateId,
      engagement_id: engagementId,
      grant_response_packet_export_identity_id: identityId,
      canonical_fingerprint: canonicalFingerprint,
      member_count: 4,
    },
  });
  assert.equal(prepared.ok, true);
  await prepared.publish();

  assert.equal(captured.length, 1);
  assert.equal(captured[0].canonical_fingerprint, canonicalFingerprint);
  assert.equal(captured[0].member_count, 4);

  const sanitized = sanitizeAuditMetadataForStorage(captured[0]);
  assert.equal(sanitized.canonical_fingerprint, canonicalFingerprint);
  assert.equal(sanitized.member_count, 4);
  assert.equal(sanitized.object_id, candidateId);
  assert.equal(sanitized.object_type, "grant_response_packet_export_candidate");
});

test("audit excludes raw/content-bearing fields even when a caller attempts to pass them through payload", async () => {
  const { audit, captured } = baseFactory();
  const prepared = audit.prepareMetadataOnlyAudit({
    payload: {
      grant_response_packet_export_candidate_id: candidateId,
      canonical_fingerprint: canonicalFingerprint,
      member_count: 2,
      members: [{ generatedContentDraftId: "should-not-persist" }],
      blocks: [{ text: "raw block text should not persist" }],
      citations: [{ claimId: "should-not-persist" }],
      evidence: { text: "raw evidence body should not persist" },
      source: "gs://bucket/should-not-persist",
      storage_credentials: { secret: "do-not-store" },
      signed_url: "https://example.test/file?X-Goog-Signature=abc",
      client_pii: "jane@example.test",
    },
  });
  assert.equal(prepared.ok, true);
  await prepared.publish();

  const metadata = captured[0];
  assert.equal(metadata.members, undefined);
  assert.equal(metadata.blocks, undefined);
  assert.equal(metadata.citations, undefined);
  assert.equal(metadata.evidence, undefined);
  assert.equal(metadata.source, undefined);
  assert.equal(metadata.storage_credentials, undefined);
  assert.equal(metadata.signed_url, undefined);
  assert.equal(metadata.client_pii, undefined);
  assert.equal(metadata.contains_raw_file_content, false);
  assert.equal(metadata.contains_raw_parsed_rows, false);
  assert.equal(metadata.contains_client_pii, false);
  assert.equal(metadata.contains_prompt_text, false);
  assert.equal(metadata.contains_unsafe_generated_text, false);
  assert.equal(metadata.contains_signed_urls, false);
  assert.equal(metadata.contains_storage_credentials, false);

  const sanitized = sanitizeAuditMetadataForStorage(metadata);
  assert.equal(sanitized.members, undefined);
  assert.equal(sanitized.blocks, undefined);
  assert.equal(sanitized.citations, undefined);
  assert.equal(sanitized.evidence, undefined);
  assert.equal(sanitized.source, undefined);
  assert.equal(sanitized.storage_credentials, undefined);
  assert.equal(sanitized.signed_url, undefined);
  assert.equal(sanitized.client_pii, undefined);
  // Only the safe scalar fields survive.
  assert.equal(sanitized.canonical_fingerprint, canonicalFingerprint);
  assert.equal(sanitized.member_count, 2);
});

test("audit drops a malformed canonical_fingerprint or member_count rather than fabricating one", async () => {
  const { audit, captured } = baseFactory();
  const prepared = audit.prepareMetadataOnlyAudit({
    payload: {
      grant_response_packet_export_candidate_id: candidateId,
      canonical_fingerprint: "not-a-hex-digest",
      member_count: -1,
    },
  });
  assert.equal(prepared.ok, true);
  await prepared.publish();

  assert.equal(captured[0].canonical_fingerprint, null);
  assert.equal(captured[0].member_count, null);
});

test("audit still refuses a payload missing the candidate id, unchanged from P14-03", () => {
  const { audit } = baseFactory();
  assert.equal(audit.prepareMetadataOnlyAudit({ payload: {} }).ok, false);
  assert.equal(audit.prepareMetadataOnlyAudit({ payload: null }).ok, false);
});
