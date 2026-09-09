import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBlockedAttemptAuditEventRecord,
  buildSuccessfulMutationAuditEventRecord,
  insertBlockedAttemptAuditEvent,
  sanitizeAuditMetadataForStorage,
} from "../Backend/kai/db/kaiAuditQueries.js";
import { recordBlockedAttempt } from "../Backend/kai/services/kaiAuditService.js";

const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const actorUserId = "7fe568b1-5c05-4c42-bb1f-6e20de216c7b";

test("blocked audit insert maps conceptual event type to action and event metadata to metadata", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("information_schema.columns")) {
        return {
          rows: [
            "audit_event_id",
            "organization_id",
            "actor_user_id",
            "actor_type",
            "action",
            "metadata",
            "object_type",
            "reason_code",
            "reason_text",
          ].map((column_name) => ({ column_name })),
        };
      }
      if (sql.includes("pg_enum")) {
        return { rows: [{ enumlabel: "other" }] };
      }
      return { rows: [{ audit_event_id: "11111111-1111-4111-8111-111111111111" }] };
    },
  };

  const result = await insertBlockedAttemptAuditEvent(
    {
      eventType: "validator_blocked_attempt",
      eventMetadata: {
        operation: "create_intake_file",
        validator_key: "VAL-STO-002",
        blocker_code: "unsafe_filename",
      },
      organization_id: organizationId,
      actor_user_id: actorUserId,
      actor_type: "human",
      object_type: "other",
      target_object_type: "intake_file",
      safe_message: "Filename failed safety validation.",
      raw_file_content: "do not store",
      prompt_text: "do not store",
      signed_url: "https://example.test/file?X-Goog-Signature=abc",
      storage_credentials: { secret: "do not store" },
    },
    db,
  );

  assert.equal(result.ok, true);
  const insert = calls.find((call) => call.sql.includes("INSERT INTO kai.audit_events"));
  assert.ok(insert);
  assert.match(insert.sql, /\baction\b/);
  assert.match(insert.sql, /\bmetadata\b/);
  assert.doesNotMatch(insert.sql, new RegExp("event" + "_type"));
  assert.doesNotMatch(insert.sql, new RegExp("event" + "_metadata"));
  assert.equal(insert.params[3], "validator_blocked_attempt");
  assert.equal(insert.params[5], "other");

  const storedMetadata = JSON.parse(insert.params[4]);
  assert.equal(storedMetadata.operation, "create_intake_file");
  assert.equal(storedMetadata.target_object_type, "intake_file");
  assert.equal(storedMetadata.validator_key, "VAL-STO-002");
  assert.equal(storedMetadata.blocker_code, "unsafe_filename");
  assert.equal(storedMetadata.raw_file_content, undefined);
  assert.equal(storedMetadata.prompt_text, undefined);
  assert.equal(storedMetadata.signed_url, undefined);
  assert.equal(storedMetadata.storage_credentials, undefined);
  assert.equal(storedMetadata.contains_raw_file_content, false);
  assert.equal(storedMetadata.contains_raw_parsed_rows, false);
  assert.equal(storedMetadata.contains_client_pii, false);
  assert.equal(storedMetadata.contains_prompt_text, false);
  assert.equal(storedMetadata.contains_unsafe_generated_text, false);
  assert.equal(storedMetadata.contains_signed_urls, false);
  assert.equal(storedMetadata.contains_storage_credentials, false);
});

test("sanitizeAuditMetadataForStorage retains a valid canonical_fingerprint and member_count", () => {
  const sanitized = sanitizeAuditMetadataForStorage({
    canonical_fingerprint: "a".repeat(64),
    member_count: 3,
  });
  assert.equal(sanitized.canonical_fingerprint, "a".repeat(64));
  assert.equal(sanitized.member_count, 3);
});

test("sanitizeAuditMetadataForStorage drops a malformed canonical_fingerprint or member_count", () => {
  const notHex = sanitizeAuditMetadataForStorage({ canonical_fingerprint: "not-a-hex-digest" });
  assert.equal(notHex.canonical_fingerprint, undefined);

  const tooShort = sanitizeAuditMetadataForStorage({ canonical_fingerprint: "a".repeat(63) });
  assert.equal(tooShort.canonical_fingerprint, undefined);

  const negativeCount = sanitizeAuditMetadataForStorage({ member_count: -1 });
  assert.equal(negativeCount.member_count, undefined);

  const nonIntegerCount = sanitizeAuditMetadataForStorage({ member_count: 1.5 });
  assert.equal(nonIntegerCount.member_count, undefined);

  const nonNumericString = sanitizeAuditMetadataForStorage({ member_count: "not-a-number" });
  assert.equal(nonNumericString.member_count, undefined);
});

test("sanitizeAuditMetadataForStorage never lets member_count/canonical_fingerprint carry raw content", () => {
  const sanitized = sanitizeAuditMetadataForStorage({
    canonical_fingerprint: "a".repeat(64),
    member_count: 2,
    members: [{ generatedContentDraftId: "should-not-persist" }],
    blocks: [{ text: "raw block text should not persist" }],
    citations: [{ claimId: "should-not-persist" }],
  });
  assert.equal(sanitized.canonical_fingerprint, "a".repeat(64));
  assert.equal(sanitized.member_count, 2);
  assert.equal(sanitized.members, undefined);
  assert.equal(sanitized.blocks, undefined);
  assert.equal(sanitized.citations, undefined);
});

// P14-06A: the packet export-review START transition's safe scalar fields -
// same allowlist discipline as canonical_fingerprint/member_count above.
test("sanitizeAuditMetadataForStorage retains valid P14-06A start-transition fields", () => {
  const sanitized = sanitizeAuditMetadataForStorage({
    review_queue_item_id: "14060000-0000-4000-8000-0000000000a1",
    expected_updated_at: "2026-09-09T12:00:00.000Z",
    previous_queue_status: "open",
    resulting_queue_status: "in_progress",
    previous_review_status: "needs_gk_review",
    resulting_review_status: "needs_gk_review",
  });
  assert.equal(sanitized.review_queue_item_id, "14060000-0000-4000-8000-0000000000a1");
  assert.equal(sanitized.expected_updated_at, "2026-09-09T12:00:00.000Z");
  assert.equal(sanitized.previous_queue_status, "open");
  assert.equal(sanitized.resulting_queue_status, "in_progress");
  assert.equal(sanitized.previous_review_status, "needs_gk_review");
  assert.equal(sanitized.resulting_review_status, "needs_gk_review");
});

test("sanitizeAuditMetadataForStorage drops malformed P14-06A start-transition fields", () => {
  const badId = sanitizeAuditMetadataForStorage({ review_queue_item_id: "not-a-uuid" });
  assert.equal(badId.review_queue_item_id, undefined);

  const badTimestamp = sanitizeAuditMetadataForStorage({ expected_updated_at: "not-a-timestamp" });
  assert.equal(badTimestamp.expected_updated_at, undefined);

  const badStatus = sanitizeAuditMetadataForStorage({ previous_queue_status: "DROP TABLE kai.review_queue_items" });
  assert.equal(badStatus.previous_queue_status, undefined);
});

test("blocked audit insert skips when object_type enum cannot confirm a safe value", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("information_schema.columns")) {
        return {
          rows: [
            "organization_id",
            "actor_user_id",
            "actor_type",
            "action",
            "metadata",
            "object_type",
            "reason_code",
            "reason_text",
          ].map((column_name) => ({ column_name })),
        };
      }
      if (sql.includes("pg_enum")) {
        return { rows: [] };
      }
      throw new Error("insert should not run");
    },
  };

  const result = await insertBlockedAttemptAuditEvent(
    {
      operation: "create_intake_file",
      organization_id: organizationId,
      actor_user_id: actorUserId,
      actor_type: "human",
    object_type: "other",
    target_object_type: "intake_file",
    },
    db,
  );

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "audit_object_type_enum_unavailable");
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO kai.audit_events")), false);
});

test("audit metadata sanitizer keeps only metadata-safe fields", () => {
  const metadata = sanitizeAuditMetadataForStorage({
    operation: "create_intake_file",
    validator_key: "VAL-STO-002",
    raw_file_content: "raw csv",
    raw_parsed_rows: [{ email: "client@example.test" }],
    client_pii: "client@example.test",
    prompt_text: "prompt",
    unsafe_generated_text: "model output",
    signed_urls: ["https://example.test?X-Goog-Signature=abc"],
    storage_credentials: { token: "secret" },
    contains_raw_file_content: true,
    contains_raw_parsed_rows: true,
    contains_client_pii: true,
    contains_prompt_text: true,
    contains_unsafe_generated_text: true,
    contains_signed_urls: true,
    contains_storage_credentials: true,
  });

  assert.equal(metadata.operation, "create_intake_file");
  assert.equal(metadata.validator_key, "VAL-STO-002");
  assert.equal(metadata.raw_file_content, undefined);
  assert.equal(metadata.raw_parsed_rows, undefined);
  assert.equal(metadata.client_pii, undefined);
  assert.equal(metadata.prompt_text, undefined);
  assert.equal(metadata.unsafe_generated_text, undefined);
  assert.equal(metadata.signed_urls, undefined);
  assert.equal(metadata.storage_credentials, undefined);
  assert.equal(metadata.contains_raw_file_content, false);
  assert.equal(metadata.contains_raw_parsed_rows, false);
  assert.equal(metadata.contains_client_pii, false);
  assert.equal(metadata.contains_prompt_text, false);
  assert.equal(metadata.contains_unsafe_generated_text, false);
  assert.equal(metadata.contains_signed_urls, false);
  assert.equal(metadata.contains_storage_credentials, false);
});

// Regression: a policy-decision audit event (e.g.
// applyConfirmedSecurityAssessment's "apply_security_assessment_policy_decision")
// supplies reason_code (not blocking_reason_code) as the outcome. If the
// sanitizer silently dropped reason_code, buildSuccessfulMutationAuditEventRecord
// would fall back to the generic "state_transition_completed" default instead
// of the real outcome, breaking the operator-visible policy_outcome
// projection for every persisted policy decision.
test("audit metadata sanitizer keeps reason_code (distinct from blocking_reason_code)", () => {
  const metadata = sanitizeAuditMetadataForStorage({ reason_code: "passed" });
  assert.equal(metadata.reason_code, "passed");
});

test("buildSuccessfulMutationAuditEventRecord uses metadata.reason_code as the stored reason_code when no blocking_reason_code is present", () => {
  const record = buildSuccessfulMutationAuditEventRecord(
    {
      operation: "apply_security_assessment_policy_decision",
      object_type: "intake_file",
      target_object_type: "intake_file",
      reason_code: "passed",
    },
    "other",
  );
  assert.equal(record.reason_code, "passed");
});

test("recordBlockedAttempt passes sanitized action/metadata shape to the audit dependency", async () => {
  let received = null;
  const result = await recordBlockedAttempt({
    actorContext: { actorType: "human", actorUserId },
    operation: "create_intake_file",
    blockers: [
      {
        validator_key: "VAL-STO-002",
        object_type: "intake_file",
        blocking_reason: "unsafe_filename",
        message: "Filename failed safety validation.",
      },
    ],
    metadata: {
      organization_id: organizationId,
      prompt_text: "do not store",
      contains_prompt_text: true,
    },
    dependencies: {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async insertBlockedAttemptAuditEvent(metadata) {
        received = metadata;
        const record = buildBlockedAttemptAuditEventRecord(metadata, "other");
        return { ok: true, record };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.record.action, "validator_blocked_attempt");
  assert.equal(result.record.metadata.operation, "create_intake_file");
  assert.equal(result.record.object_type, "other");
  assert.equal(result.record.metadata.target_object_type, "intake_file");
  assert.equal(result.record.metadata.blocker_code, "unsafe_filename");
  assert.equal(result.record.metadata.prompt_text, undefined);
  assert.equal(result.record.metadata.contains_prompt_text, false);
  assert.equal(received.eventType, undefined);
  assert.equal(received.eventMetadata, undefined);
});
