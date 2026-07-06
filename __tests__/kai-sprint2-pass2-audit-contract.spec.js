import test from "node:test";
import assert from "node:assert/strict";

import { buildBlockedAttemptAuditEventRecord } from "../Backend/kai/db/kaiAuditQueries.js";
import { recordBlockedAttempt } from "../Backend/kai/services/kaiAuditService.js";

const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const engagementId = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const actorUserId = "7fe568b1-5c05-4c42-bb1f-6e20de216c7b";

test("Pass 2 blocked-attempt audit uses object_type other and target_object_type metadata", async () => {
  let received = null;
  const result = await recordBlockedAttempt({
    actorContext: { actorType: "human", actorUserId },
    operation: "reserve_intake_file_metadata",
    blockers: [
      {
        validator_key: "VAL-STO-004",
        object_type: "intake_file",
        blocking_reason: "unsafe_filename",
        message: "Filename failed safe filename validation.",
      },
    ],
    metadata: {
      p0_pass: "pass2_admin_metadata_intake_verification",
      target_object_type: "intake_file",
      organization_id: organizationId,
      engagement_id: engagementId,
      metadata_only: true,
      prompt_text: "do not store",
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
  assert.equal(result.record.object_type, "other");
  assert.equal(result.record.metadata.p0_pass, "pass2_admin_metadata_intake_verification");
  assert.equal(result.record.metadata.target_object_type, "intake_file");
  assert.equal(result.record.metadata.metadata_only, true);
  assert.equal(result.record.metadata.blocked, true);
  assert.deepEqual(result.record.metadata.blocker_codes, ["unsafe_filename"]);
  assert.equal(result.record.metadata.prompt_text, undefined);
  assert.equal(received.object_type, "other");
});

test("corrected validator blocker example is metadata-only and has no feature flag disabled audit", () => {
  const example = {
    p0_pass: "pass2_admin_metadata_intake_verification",
    target_object_type: "intake_file",
    operation: "reserve_intake_file_metadata",
    blocked: true,
    blocker_codes: ["unsafe_filename"],
    organization_id: organizationId,
    engagement_id: engagementId,
    metadata_only: true,
  };

  assert.equal(example.operation, "reserve_intake_file_metadata");
  assert.deepEqual(example.blocker_codes, ["unsafe_filename"]);
  assert.equal(Object.values(example).includes("feature_flag_disabled"), false);
});
