import test from "node:test";
import assert from "node:assert/strict";

import {
  createIntakeBatch,
  reserveIntakeFileMetadata,
  requestUploadUrl,
} from "../Backend/kai/services/kaiIntakeService.js";

const actorContext = {
  actorType: "human",
  actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
  kaiRoles: ["gk_operator"],
  organizationMemberships: [
    {
      organization_id: "a5d17c5a-c55f-43af-9b21-fe63aafe733f",
      role_name: "gk_operator",
      membership_status: "active",
    },
  ],
};

const ids = {
  organizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f",
  engagementId: "2e426ea1-2be3-4e48-b80f-9783ddbacda0",
  intakeBatchId: "8e426ea1-2be3-4e48-b80f-9783ddbacda0",
  intakeFileId: "9fe568b1-5c05-4c42-bb1f-6e20de216c7b",
};

test("feature flag disabled blocks Sprint 2 service entry", async () => {
  const result = await createIntakeBatch({ actorContext }, { env: { KAI_SPRINT2_ENABLED: "false" } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("createIntakeBatch writes metadata through service dependency when enabled", async () => {
  let inserted = null;
  const result = await createIntakeBatch(
    {
      actorContext,
      organizationId: ids.organizationId,
      engagementId: ids.engagementId,
      batchCode: "NCWS-001",
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getEngagementTenantState() {
        return { engagement_id: ids.engagementId, organization_id: ids.organizationId };
      },
      async insertIntakeBatchMetadata(batch) {
        inserted = batch;
        return { intake_batch_id: ids.intakeBatchId, batch_code: batch.batchCode };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(inserted.processing_status, undefined);
  assert.equal(inserted.createdBy, actorContext.actorUserId);
  assert.equal(inserted.batchMetadata.p0_pass, "pass2_admin_metadata_intake_verification");
  assert.equal(result.data.batch_code, "NCWS-001");
});

test("reserveIntakeFileMetadata returns validator blocker as ok false without raw upload", async () => {
  const result = await reserveIntakeFileMetadata(
    {
      actorContext,
      organizationId: ids.organizationId,
      engagementId: ids.engagementId,
      intakeBatchId: ids.intakeBatchId,
      safeFilename: "../unsafe.csv",
      checksum: "abc",
    },
    {
      env: { KAI_SPRINT2_ENABLED: "1" },
      async getIntakeBatchTenantState() {
        return {
          intake_batch_id: ids.intakeBatchId,
          organization_id: ids.organizationId,
          engagement_id: ids.engagementId,
        };
      },
      async insertBlockedAttemptAuditEvent() {
        return { ok: true, skipped: true };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.error.status, 422);
  assert.equal(result.blockers[0].validator_key, "VAL-STO-004");
  assert.equal(result.blockers[0].blocking_reason, "unsafe_filename");
});

test("reserveIntakeFileMetadata stores metadata defaults without issuing signed URL", async () => {
  let inserted = null;
  const result = await reserveIntakeFileMetadata(
    {
      actorContext,
      organizationId: ids.organizationId,
      engagementId: ids.engagementId,
      intakeBatchId: ids.intakeBatchId,
      intakeFileId: ids.intakeFileId,
      originalFilename: "safe.csv",
      storageBucket: "private-ca-bucket",
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchTenantState() {
        return {
          intake_batch_id: ids.intakeBatchId,
          organization_id: ids.organizationId,
          engagement_id: ids.engagementId,
        };
      },
      async insertIntakeFileMetadata(file) {
        inserted = file;
        return {
          intake_file_id: file.intakeFileId,
          intake_batch_id: file.intakeBatchId,
          organization_id: file.organizationId,
          engagement_id: file.engagementId,
          safe_filename: file.safeFilename,
          storage_provider: file.storageProvider,
          storage_object_key: file.storageObjectKey,
          file_policy_status: file.filePolicyStatus,
          malware_scan_status: file.malwareScanStatus,
          processing_status: "quarantined",
          parse_status: "quarantined",
          review_status: "proposed",
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(inserted.storageProvider, "gcs");
  assert.equal(inserted.filePolicyStatus, "skipped");
  assert.equal(inserted.malwareScanStatus, "skipped");
  assert.equal(inserted.rawFileRetained, false);
  assert.equal(inserted.fileMetadata.p0_pass, "pass2_admin_metadata_intake_verification");
  assert.equal(inserted.fileMetadata.checksum_scope, "metadata_reservation_no_raw_file");
  assert.match(result.data.storage_object_key, /^kai\/org\//);
});

test("reserveIntakeFileMetadata blocks cross-org intake batch before file insert", async () => {
  let inserted = false;
  const result = await reserveIntakeFileMetadata(
    {
      actorContext,
      organizationId: ids.organizationId,
      engagementId: ids.engagementId,
      intakeBatchId: ids.intakeBatchId,
      intakeFileId: ids.intakeFileId,
      safeFilename: "safe.csv",
      checksum: "sha256abc",
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchTenantState() {
        return {
          intake_batch_id: ids.intakeBatchId,
          organization_id: "00000000-0000-4000-8000-000000000000",
          engagement_id: ids.engagementId,
        };
      },
      async insertIntakeFileMetadata() {
        inserted = true;
      },
      async insertBlockedAttemptAuditEvent() {
        return { ok: true, skipped: true };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers[0].validator_key, "VAL-TEN-001");
  assert.equal(inserted, false);
});

test("reserveIntakeFileMetadata blocks invalid constrained DB vocabulary before insert", async () => {
  for (const field of [
    { storageProvider: "google_cloud_storage", blocker: "invalid_storage_provider" },
    { malwareScanStatus: "manual", blocker: "invalid_malware_scan_status" },
    { malwareScanStatus: "stub", blocker: "invalid_malware_scan_status" },
  ]) {
    let inserted = false;
    const result = await reserveIntakeFileMetadata(
      {
        actorContext,
        organizationId: ids.organizationId,
        engagementId: ids.engagementId,
        intakeBatchId: ids.intakeBatchId,
        intakeFileId: ids.intakeFileId,
        safeFilename: "safe.csv",
        checksum: "sha256abc",
        ...field,
      },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        async getIntakeBatchTenantState() {
          return {
            intake_batch_id: ids.intakeBatchId,
            organization_id: ids.organizationId,
            engagement_id: ids.engagementId,
          };
        },
        async insertIntakeFileMetadata() {
          inserted = true;
        },
        async insertBlockedAttemptAuditEvent() {
          return { ok: true, skipped: true };
        },
      },
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(result.blockers[0].blocking_reason, field.blocker);
    assert.equal(inserted, false);
  }
});

test("requestUploadUrl remains disabled in P0", async () => {
  const result = await requestUploadUrl({ env: { KAI_SPRINT2_ENABLED: "true" } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "storage_provider_not_configured");
});
