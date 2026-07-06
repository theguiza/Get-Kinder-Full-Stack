import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBlockedAttemptAuditEventRecord,
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
