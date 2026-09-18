// METADATA-ONLY AUDIT EXPORT-PATH ALLOWLIST REGRESSION
//
// Horizontal proof, across all three export-manifest audit-composition
// adapters in Backend/kai/services/kaiMetadataOnlyAuditComposition.js
// (ordinary final export manifest, Grant Response Packet export manifest,
// Board Reporting candidate export manifest), that the metadata payload
// actually persisted through insertRequiredSuccessfulAuditEvent:
//   1. Contains only an allowlisted, actor/action/object-id/reason-code-
//      shaped set of keys - never generated block text, raw evidence/claim
//      text, prompts, raw client data, PII, credentials, signed URLs, or raw
//      storage locations.
//   2. Never absorbs extra caller-supplied payload fields via a spread -
//      even when a caller-shaped payload tries to smuggle content-shaped
//      fields in (block_text, prompt_text, raw_evidence_text, pii,
//      credentials, signed_url, storage_location, etc.), none of those keys
//      or values reach the persisted metadata object.
//
// Pure unit-level test: no database, no real client data, synthetic UUIDs
// only, consistent with this repository's existing metadata-only-audit test
// fixtures (see kai-sprint2-p3-19-export-manifest-foundation.integration.spec.js).

import test from "node:test";
import assert from "node:assert/strict";

import {
  createProductionMetadataOnlyAuditForExportManifest,
  createProductionMetadataOnlyAuditForGrantResponsePacketExportManifest,
  createProductionMetadataOnlyAuditForBoardReportingCandidateExportManifest,
} from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000919";
const NOW = "2026-09-06T10:15:00.000Z";
const HUMAN_ACTOR = { actorType: "human", actorUserId: "00000000-0000-4000-8000-0000000000aa", requestId: "req-1" };

// The complete allowlist every export-path metadata-only audit payload must
// stay within. Every key here is actor/action/object-id/reason-code-shaped
// (identity, actor, operation label, boolean content-exclusion flags,
// timestamps, route label) - never generated content, evidence, prompts, or
// storage/credential material.
const ALLOWED_KEYS = new Set([
  "organization_id",
  "engagement_id",
  "object_type",
  "target_object_type",
  "object_id",
  "export_manifest_id",
  "export_candidate_id",
  "grant_response_packet_export_manifest_id",
  "grant_response_packet_export_candidate_id",
  "board_reporting_candidate_export_manifest_id",
  "board_reporting_candidate_id",
  "operation",
  "operation_type",
  "validator_key",
  "actor_type",
  "actor_user_id",
  "request_id",
  "route",
  "created_at",
  "metadata_only",
  "contains_raw_file_content",
  "contains_raw_parsed_rows",
  "contains_client_pii",
  "contains_prompt_text",
  "contains_unsafe_generated_text",
  "contains_signed_urls",
  "contains_storage_credentials",
]);

// Content-shaped field names an attacker/bug might try to smuggle into a
// payload, hoping a careless composer spreads the whole payload into the
// audit metadata. None of these should ever appear as a key, or as a
// substring of any string value, in the persisted metadata.
const FORBIDDEN_CONTENT_FIELDS = [
  "block_text",
  "generated_text",
  "raw_evidence_text",
  "raw_claim_text",
  "prompt",
  "prompt_text",
  "raw_client_data",
  "pii",
  "ssn",
  "credentials",
  "api_key",
  "signed_url",
  "storage_location",
  "gcs_uri",
  "s3_uri",
];

const FORBIDDEN_VALUE_SNIPPETS = [
  "Once upon a grant narrative",
  "Dear Program Officer, this evidence shows",
  "system_prompt:",
  "sk-live-",
  "https://storage.googleapis.com/signed",
  "gs://kai-real-bucket/objects/",
  "123-45-6789",
];

function poisonedPayload(basePayload) {
  return {
    ...basePayload,
    block_text: "Once upon a grant narrative that should never be audited verbatim.",
    generated_text: "Dear Program Officer, this evidence shows outcomes.",
    raw_evidence_text: "Client disclosed sensitive raw evidence detail here.",
    prompt_text: "system_prompt: you are a grant writer for this client",
    pii: "123-45-6789",
    credentials: "sk-live-abcdefghijklmnopqrstuvwx",
    signed_url: "https://storage.googleapis.com/signed?token=abc",
    storage_location: "gs://kai-real-bucket/objects/client-file.pdf",
  };
}

function assertAllowlistedAndUncontaminated(metadata) {
  for (const key of Object.keys(metadata)) {
    assert.equal(ALLOWED_KEYS.has(key), true, `unexpected key "${key}" in metadata-only audit payload`);
  }
  for (const forbiddenField of FORBIDDEN_CONTENT_FIELDS) {
    assert.equal(Object.hasOwn(metadata, forbiddenField), false, `forbidden content-shaped key "${forbiddenField}" leaked into metadata-only audit payload`);
  }
  const serialized = JSON.stringify(metadata);
  for (const snippet of FORBIDDEN_VALUE_SNIPPETS) {
    assert.equal(serialized.includes(snippet), false, `forbidden content-shaped value "${snippet}" leaked into metadata-only audit payload`);
  }
  // Every allow-listed content-exclusion flag must be affirmatively false -
  // the composer must assert non-containment, not merely omit the fields.
  for (const flag of [
    "contains_raw_file_content",
    "contains_raw_parsed_rows",
    "contains_client_pii",
    "contains_prompt_text",
    "contains_unsafe_generated_text",
    "contains_signed_urls",
    "contains_storage_credentials",
  ]) {
    assert.equal(metadata[flag], false, `expected ${flag} to be false`);
  }
}

let capturedMetadata;
async function insertAuditEvent(metadata) {
  capturedMetadata = metadata;
  return { ok: true, data: { auditEventId: "00000000-0000-4000-8000-0000000000ff" } };
}

test("metadata-only audit for ordinary final export manifest stays within the actor/action/object-id allowlist even when the payload attempts to smuggle content-shaped fields", async () => {
  const exportCandidateId = "00000000-0000-4000-8000-000000000501";
  const exportManifestId = "00000000-0000-4000-8000-000000000601";
  const audit = createProductionMetadataOnlyAuditForExportManifest({
    organizationId: ORG,
    exportCandidateId,
    actorContext: HUMAN_ACTOR,
    now: NOW,
    insertAuditEvent,
  });

  const prepared = audit.prepareMetadataOnlyAudit({
    payload: poisonedPayload({
      export_manifest_id: exportManifestId,
      export_candidate_id: exportCandidateId,
      attempted_operation: "export_manifest_created",
    }),
    db: null,
  });
  assert.equal(prepared.ok, true);
  await prepared.publish();

  assertAllowlistedAndUncontaminated(capturedMetadata);
  assert.equal(capturedMetadata.object_type, "export_manifest");
  assert.equal(capturedMetadata.object_id, exportManifestId);
  assert.equal(capturedMetadata.actor_user_id, HUMAN_ACTOR.actorUserId);
});

test("metadata-only audit for Grant Response Packet export manifest stays within the actor/action/object-id allowlist even when the payload attempts to smuggle content-shaped fields", async () => {
  const grantResponsePacketExportCandidateId = "00000000-0000-4000-8000-000000000502";
  const grantResponsePacketExportManifestId = "00000000-0000-4000-8000-000000000602";
  const audit = createProductionMetadataOnlyAuditForGrantResponsePacketExportManifest({
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    grantResponsePacketExportCandidateId,
    actorContext: HUMAN_ACTOR,
    now: NOW,
    insertAuditEvent,
  });

  const prepared = audit.prepareMetadataOnlyAudit({
    payload: poisonedPayload({
      grant_response_packet_export_manifest_id: grantResponsePacketExportManifestId,
      grant_response_packet_export_candidate_id: grantResponsePacketExportCandidateId,
      attempted_operation: "grant_response_packet_export_manifest_created",
    }),
    db: null,
  });
  assert.equal(prepared.ok, true);
  await prepared.publish();

  assertAllowlistedAndUncontaminated(capturedMetadata);
  assert.equal(capturedMetadata.object_type, "grant_response_packet_export_manifest");
  assert.equal(capturedMetadata.object_id, grantResponsePacketExportManifestId);
  assert.equal(capturedMetadata.engagement_id, ENGAGEMENT);
});

test("metadata-only audit for Board Reporting candidate export manifest stays within the actor/action/object-id allowlist even when the payload attempts to smuggle content-shaped fields", async () => {
  const boardReportingCandidateId = "00000000-0000-4000-8000-000000000503";
  const boardReportingCandidateExportManifestId = "00000000-0000-4000-8000-000000000603";
  const audit = createProductionMetadataOnlyAuditForBoardReportingCandidateExportManifest({
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    boardReportingCandidateId,
    actorContext: HUMAN_ACTOR,
    now: NOW,
    insertAuditEvent,
  });

  const prepared = audit.prepareMetadataOnlyAudit({
    payload: poisonedPayload({
      board_reporting_candidate_export_manifest_id: boardReportingCandidateExportManifestId,
      board_reporting_candidate_id: boardReportingCandidateId,
      attempted_operation: "board_reporting_candidate_export_manifest_created",
    }),
    db: null,
  });
  assert.equal(prepared.ok, true);
  await prepared.publish();

  assertAllowlistedAndUncontaminated(capturedMetadata);
  assert.equal(capturedMetadata.object_type, "board_reporting_candidate_export_manifest");
  assert.equal(capturedMetadata.object_id, boardReportingCandidateExportManifestId);
  assert.equal(capturedMetadata.engagement_id, ENGAGEMENT);
});

test("metadata-only audit adapters reject a payload whose identity fields do not match the bound construction identity (fails closed, never falls back to trusting the payload's own claimed identity)", async () => {
  const auditForExportManifest = createProductionMetadataOnlyAuditForExportManifest({
    organizationId: ORG,
    exportCandidateId: "00000000-0000-4000-8000-000000000501",
    actorContext: HUMAN_ACTOR,
    now: NOW,
    insertAuditEvent,
  });
  const mismatched = auditForExportManifest.prepareMetadataOnlyAudit({
    payload: {
      export_manifest_id: "00000000-0000-4000-8000-000000000601",
      export_candidate_id: "00000000-0000-4000-8000-000000000999",
      attempted_operation: "export_manifest_created",
    },
    db: null,
  });
  assert.equal(mismatched.ok, false);
});
