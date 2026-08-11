import test from "node:test";
import assert from "node:assert/strict";

import {
  createIntakeBatch,
  listIntakeBatchesForOrganization,
  reserveIntakeFileMetadata,
} from "../Backend/kai/services/kaiIntakeService.js";

const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const engagementId = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const otherOrganizationId = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";
const otherEngagementId = "3e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeBatchId = "8e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeFileId = "9fe568b1-5c05-4c42-bb1f-6e20de216c7b";
const declaredChecksum = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const actorContext = {
  actorType: "human",
  actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
  kaiRoles: ["gk_operator"],
  organizationMemberships: [
    { organization_id: organizationId, role_name: "gk_operator", membership_status: "active" },
  ],
};

test("list intake batches returns feature_disabled before actor or read-model access", async () => {
  let readModelCalled = false;
  const result = await listIntakeBatchesForOrganization(
    { organizationId },
    {
      env: { KAI_SPRINT2_ENABLED: "false" },
      async listIntakeBatchesForOrganization() {
        readModelCalled = true;
        return [];
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
  assert.equal(result.error.status, 403);
  assert.equal(readModelCalled, false);
});

test("list intake batches authorizes an active organization member and returns restricted summaries", async () => {
  let readOrganizationId = null;
  const result = await listIntakeBatchesForOrganization(
    { actorContext, organizationId },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async listIntakeBatchesForOrganization(requestedOrganizationId) {
        readOrganizationId = requestedOrganizationId;
        return [
          {
            intake_batch_id: intakeBatchId,
            organization_id: organizationId,
            engagement_id: engagementId,
            batch_code: "BATCH-SUMMARY-001",
            processing_status: "received",
            review_status: "proposed",
            created_at: "2026-07-12T10:00:00.000Z",
            updated_at: "2026-07-12T11:00:00.000Z",
            raw_content: "raw-content-sentinel",
            storage_uri: "storage-path-sentinel",
            storage_object_key: "storage-object-key-sentinel",
            signed_url: "signed-url-sentinel",
            credentials: "credential-sentinel",
            contact_email: "pii-sentinel@example.test",
            batch_metadata: { unrestricted: "metadata-sentinel" },
          },
        ];
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(readOrganizationId, organizationId);
  assert.deepEqual(result.data, {
    organization_id: organizationId,
    batches: [
      {
        intake_batch_id: intakeBatchId,
        organization_id: organizationId,
        engagement_id: engagementId,
        batch_code: "BATCH-SUMMARY-001",
        processing_status: "received",
        review_status: "proposed",
        created_at: "2026-07-12T10:00:00.000Z",
        updated_at: "2026-07-12T11:00:00.000Z",
      },
    ],
  });
  assert.deepEqual(result.warnings, []);

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "raw-content-sentinel",
    "storage-path-sentinel",
    "storage-object-key-sentinel",
    "signed-url-sentinel",
    "credential-sentinel",
    "pii-sentinel",
    "metadata-sentinel",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("list intake batches auto-provisions a missing KAI actor mapping then rejects for missing org membership", async () => {
  let readModelCalled = false;
  let created = false;
  const result = await listIntakeBatchesForOrganization(
    {
      req: { user: { id: 46 } },
      organizationId,
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId }) {
        created = true;
        return {
          user_id: "jit-kai-user-46",
          legacy_identity_source: "public.userdata",
          legacy_public_userdata_id: legacyPublicUserdataId,
          status: "active",
          email: null,
        };
      },
      async listKaiRolesForUser() {
        return [];
      },
      async listOrganizationMembershipsForUser() {
        return [];
      },
      async listIntakeBatchesForOrganization() {
        readModelCalled = true;
        return [];
      },
    },
  );

  assert.equal(created, true);
  assert.equal(result.ok, false);
  assert.notEqual(result.error.code, "mapped_kai_user_required");
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(result.error.status, 403);
  assert.equal(readModelCalled, false);
});

test("list intake batches rejects an organization role that cannot read intake", async () => {
  let readModelCalled = false;
  const result = await listIntakeBatchesForOrganization(
    {
      actorContext: {
        ...actorContext,
        organizationMemberships: [
          { organization_id: organizationId, role_name: "external_viewer", membership_status: "active" },
        ],
      },
      organizationId,
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async listIntakeBatchesForOrganization() {
        readModelCalled = true;
        return [];
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(result.error.status, 403);
  assert.equal(result.blockers[0].blocking_reason, "role_not_allowed");
  assert.equal(readModelCalled, false);
});

test("list intake batches rejects missing and inactive organization memberships", async (t) => {
  for (const membershipState of ["missing", "inactive"]) {
    await t.test(membershipState, async () => {
      let readModelCalled = false;
      const organizationMemberships = membershipState === "missing"
        ? []
        : [{ organization_id: organizationId, role_name: "gk_operator", membership_status: "inactive" }];
      const result = await listIntakeBatchesForOrganization(
        {
          actorContext: { ...actorContext, organizationMemberships },
          organizationId,
        },
        {
          env: { KAI_SPRINT2_ENABLED: "true" },
          async listIntakeBatchesForOrganization() {
            readModelCalled = true;
            return [];
          },
        },
      );

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "authorization_denied");
      assert.equal(result.blockers[0].blocking_reason, "missing_active_organization_membership");
      assert.equal(readModelCalled, false);
    });
  }
});

test("list intake batches rejects a cross-tenant organization request before read-model access", async () => {
  let readModelCalled = false;
  const result = await listIntakeBatchesForOrganization(
    { actorContext, organizationId: otherOrganizationId },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async listIntakeBatchesForOrganization() {
        readModelCalled = true;
        return [];
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(result.blockers[0].blocking_reason, "missing_active_organization_membership");
  assert.equal(readModelCalled, false);
});

test("list intake batches blocks a cross-tenant row returned by the scoped read model", async () => {
  const result = await listIntakeBatchesForOrganization(
    { actorContext, organizationId },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async listIntakeBatchesForOrganization() {
        return [{ intake_batch_id: intakeBatchId, organization_id: otherOrganizationId }];
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.error.status, 422);
  assert.equal(result.blockers[0].blocking_reason, "cross_organization_payload");
  assert.equal("data" in result, false);
});

test("list intake batches rejects missing or invalid organization_id without reading batches", async (t) => {
  for (const candidate of [undefined, "not-a-uuid"]) {
    await t.test(candidate === undefined ? "missing" : "invalid", async () => {
      let readModelCalled = false;
      const result = await listIntakeBatchesForOrganization(
        { actorContext, organizationId: candidate },
        {
          env: { KAI_SPRINT2_ENABLED: "true" },
          async listIntakeBatchesForOrganization() {
            readModelCalled = true;
            return [];
          },
        },
      );

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "invalid_request");
      assert.equal(result.error.status, 400);
      assert.equal(result.error.message, "organization_id must be a valid UUID.");
      assert.equal(readModelCalled, false);
    });
  }
});

test("create batch writes metadata-only row with stable Pass 2 markers", async () => {
  let inserted = null;
  const result = await createIntakeBatch(
    {
      actorContext,
      organizationId,
      engagementId,
      batchCode: "NCWS-P0-PASS2-METADATA-001",
      payload: {
        idempotency_key: "kai-p0-pass2-ncws-batch-001",
        notes: "P0 Pass 2 metadata-only admin route verification. No raw files.",
      },
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getEngagementTenantState() {
        return { engagement_id: engagementId, organization_id: organizationId };
      },
      async findIntakeBatchByIdempotencyKey() {
        return null;
      },
      async insertIntakeBatchMetadata(batch) {
        inserted = batch;
        return {
          intake_batch_id: intakeBatchId,
          organization_id: batch.organizationId,
          engagement_id: batch.engagementId,
          batch_code: batch.batchCode,
          processing_status: "received",
          review_status: "proposed",
          idempotency_key: batch.idempotencyKey,
          batch_metadata: batch.batchMetadata,
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.metadata_only, true);
  assert.equal(inserted.batchMetadata.p0_pass, "pass2_admin_metadata_intake_verification");
  assert.equal(inserted.batchMetadata.gate_plan, "KAI_MVP_Sprint2_P0_Pass2_Production_Synthetic_Metadata_Write_Gate_Plan_v0.1.1");
  assert.equal(inserted.batchMetadata.raw_upload_enabled, false);
  assert.equal(inserted.batchMetadata.signed_url_enabled, false);
  assert.equal(inserted.batchMetadata.parser_worker_enabled, false);
});

test("create batch preserves valid identical replay and conflicting payload behavior", async () => {
  let inserted = null;
  const input = {
    actorContext,
    organizationId,
    engagementId,
    batchCode: "NCWS-P0-PASS2-REPLAY-001",
    payload: { idempotency_key: "same-key" },
  };
  const baseDependencies = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async getEngagementTenantState() {
      return { engagement_id: engagementId, organization_id: organizationId };
    },
  };

  const created = await createIntakeBatch(input, {
    ...baseDependencies,
    async findIntakeBatchByIdempotencyKey() {
      return null;
    },
    async insertIntakeBatchMetadata(batch) {
      inserted = batch;
      return {
        intake_batch_id: intakeBatchId,
        organization_id: batch.organizationId,
        engagement_id: batch.engagementId,
        batch_code: batch.batchCode,
        processing_status: "received",
        review_status: "proposed",
        batch_metadata: batch.batchMetadata,
      };
    },
  });
  assert.equal(created.ok, true);
  assert.match(inserted.batchMetadata.normalized_payload_hash, /^[0-9a-f]{64}$/);

  const existing = {
    intake_batch_id: intakeBatchId,
    organization_id: organizationId,
    engagement_id: engagementId,
    batch_code: input.batchCode,
    processing_status: "received",
    review_status: "proposed",
    batch_metadata: inserted.batchMetadata,
  };
  const replay = await createIntakeBatch(input, {
    ...baseDependencies,
    async findIntakeBatchByIdempotencyKey() {
      return existing;
    },
    async insertIntakeBatchMetadata() {
      assert.fail("identical replay must not insert");
    },
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.data.intake_batch_id, intakeBatchId);

  const conflict = await createIntakeBatch(
    { ...input, payload: { ...input.payload, notes: "changed payload" } },
    {
      ...baseDependencies,
      async findIntakeBatchByIdempotencyKey() {
        return existing;
      },
      async insertIntakeBatchMetadata() {
        assert.fail("conflicting replay must not insert");
      },
    },
  );
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, "duplicate_conflict");
  assert.equal(conflict.error.status, 409);
});

test("create batch fails closed for missing or malformed stored fingerprints", async (t) => {
  let inserted = null;
  const input = {
    actorContext,
    organizationId,
    engagementId,
    batchCode: "NCWS-P0-PASS2-MALFORMED-001",
    payload: { idempotency_key: "malformed-batch-key" },
  };
  const baseDependencies = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async getEngagementTenantState() {
      return { engagement_id: engagementId, organization_id: organizationId };
    },
  };
  const created = await createIntakeBatch(input, {
    ...baseDependencies,
    async findIntakeBatchByIdempotencyKey() {
      return null;
    },
    async insertIntakeBatchMetadata(batch) {
      inserted = batch;
      return {
        intake_batch_id: intakeBatchId,
        organization_id: batch.organizationId,
        engagement_id: batch.engagementId,
        batch_code: batch.batchCode,
        processing_status: "received",
        review_status: "proposed",
        batch_metadata: batch.batchMetadata,
      };
    },
  });
  assert.equal(created.ok, true);

  const { normalized_payload_hash: validFingerprint, ...metadataWithoutFingerprint } = inserted.batchMetadata;
  assert.match(validFingerprint, /^[0-9a-f]{64}$/);
  for (const { name, batchMetadata } of [
    { name: "missing", batchMetadata: metadataWithoutFingerprint },
    { name: "null", batchMetadata: { ...metadataWithoutFingerprint, normalized_payload_hash: null } },
    { name: "empty", batchMetadata: { ...metadataWithoutFingerprint, normalized_payload_hash: "" } },
    { name: "non-string", batchMetadata: { ...metadataWithoutFingerprint, normalized_payload_hash: 64 } },
    { name: "wrong-length", batchMetadata: { ...metadataWithoutFingerprint, normalized_payload_hash: "a".repeat(63) } },
    { name: "non-hexadecimal", batchMetadata: { ...metadataWithoutFingerprint, normalized_payload_hash: "g".repeat(64) } },
    { name: "uppercase", batchMetadata: { ...metadataWithoutFingerprint, normalized_payload_hash: "A".repeat(64) } },
  ]) {
    await t.test(name, async () => {
      const result = await createIntakeBatch(input, {
        ...baseDependencies,
        async findIntakeBatchByIdempotencyKey() {
          return {
            intake_batch_id: intakeBatchId,
            organization_id: organizationId,
            engagement_id: engagementId,
            batch_code: input.batchCode,
            processing_status: "received",
            review_status: "proposed",
            batch_metadata: batchMetadata,
          };
        },
        async insertIntakeBatchMetadata() {
          assert.fail("invalid stored fingerprint must not be repaired or overwritten");
        },
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "duplicate_conflict");
      assert.equal(result.error.status, 409);
    });
  }
});

test("create batch blocks missing and invalid idempotency keys before lookup or insert", async (t) => {
  for (const { name, idempotencyKey, blockingReason } of [
    { name: "missing", idempotencyKey: undefined, blockingReason: "missing_idempotency_key" },
    { name: "invalid", idempotencyKey: "short", blockingReason: "invalid_idempotency_key" },
  ]) {
    await t.test(name, async () => {
      let lookupCalled = false;
      let insertCalled = false;
      const payload = idempotencyKey === undefined ? {} : { idempotency_key: idempotencyKey };
      const result = await createIntakeBatch(
        {
          actorContext,
          organizationId,
          engagementId,
          batchCode: `NCWS-P0-PASS2-IDEMPOTENCY-${name.toUpperCase()}`,
          payload,
        },
        {
          env: { KAI_SPRINT2_ENABLED: "true" },
          async getEngagementTenantState() {
            return { engagement_id: engagementId, organization_id: organizationId };
          },
          async findIntakeBatchByIdempotencyKey() {
            lookupCalled = true;
            return null;
          },
          async insertIntakeBatchMetadata() {
            insertCalled = true;
          },
        },
      );

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "validation_blocker");
      assert.equal(result.error.status, 422);
      assert.ok(result.blockers.some((blocker) => blocker.blocking_reason === blockingReason));
      assert.equal(lookupCalled, false);
      assert.equal(insertCalled, false);
    });
  }
});

test("create batch blocks missing engagement tenant state without insert", async () => {
  let inserted = false;
  let auditCompleted = false;
  const result = await createIntakeBatch(
    {
      actorContext,
      organizationId,
      engagementId,
      batchCode: "NCWS-P0-PASS2-METADATA-MISSING-ENGAGEMENT",
      payload: { idempotency_key: "kai-p0-pass2-missing-engagement" },
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getEngagementTenantState() {
        return null;
      },
      async insertIntakeBatchMetadata() {
        inserted = true;
      },
      async insertBlockedAttemptAuditEvent() {
        await Promise.resolve();
        auditCompleted = true;
        return { ok: true, auditEventId: "audit-missing-engagement" };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.status, 422);
  assert.equal(result.blockers[0].blocking_reason, "missing_engagement_tenant_state");
  assert.equal(inserted, false);
  assert.equal(auditCompleted, true);
  assert.equal(result.audit_context.blocked_attempt_audit.ok, true);
  assert.equal(result.audit_context.blocked_attempt_audit.audit_event_id, "audit-missing-engagement");
});

test("create batch blocks missing engagement_id without insert", async () => {
  let inserted = false;
  let auditMetadata = null;
  const result = await createIntakeBatch(
    {
      actorContext,
      organizationId,
      batchCode: "NCWS-P0-PASS2-METADATA-MISSING-ENGAGEMENT-ID",
      payload: { idempotency_key: "kai-p0-pass2-missing-engagement-id" },
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getEngagementTenantState() {
        throw new Error("engagement lookup should not run for missing engagement_id");
      },
      async insertIntakeBatchMetadata() {
        inserted = true;
      },
      async insertBlockedAttemptAuditEvent(metadata) {
        auditMetadata = metadata;
        return { ok: true, auditEventId: "audit-create-missing-engagement-id" };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.status, 422);
  assert.equal(result.blockers[0].blocking_reason, "missing_engagement_id");
  assert.equal(inserted, false);
  assert.equal(result.audit_context.blocked_attempt_audit.ok, true);
  assert.equal(result.audit_context.blocked_attempt_audit.audit_event_id, "audit-create-missing-engagement-id");
  assert.equal(auditMetadata.object_type, "other");
  assert.equal(auditMetadata.target_object_type, "intake_batch");
  assert.equal(auditMetadata.metadata_only, true);
  assert.equal(auditMetadata.contains_raw_file_content, false);
  assert.equal(auditMetadata.contains_signed_urls, false);
  assert.equal(auditMetadata.contains_storage_credentials, false);
});

test("create batch blocks engagement from another organization without insert", async () => {
  let inserted = false;
  const result = await createIntakeBatch(
    {
      actorContext,
      organizationId,
      engagementId,
      batchCode: "NCWS-P0-PASS2-METADATA-CROSS-ORG",
      payload: { idempotency_key: "kai-p0-pass2-cross-org-engagement" },
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getEngagementTenantState() {
        return { engagement_id: engagementId, organization_id: otherOrganizationId };
      },
      async insertIntakeBatchMetadata() {
        inserted = true;
      },
      async insertBlockedAttemptAuditEvent() {
        return { ok: true, auditEventId: "audit-cross-org-engagement" };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.status, 422);
  assert.equal(result.blockers[0].blocking_reason, "cross_organization_payload");
  assert.equal(inserted, false);
  assert.equal(result.audit_context.blocked_attempt_audit.ok, true);
});

test("file reservation writes no raw object and uses pending policy with no configured malware scanner", async () => {
  let inserted = null;
  const result = await reserveIntakeFileMetadata(
    {
      actorContext,
      organizationId,
      engagementId,
      intakeBatchId,
      intakeFileId,
      payload: {
        idempotency_key: "kai-p0-pass2-ncws-file-reservation-001",
        original_filename: "NCWS P0 Pass2 metadata-only reservation.csv",
        mime_type: "text/csv",
        file_extension: ".csv",
        file_size_bytes: 0,
        checksum: declaredChecksum.toUpperCase(),
        hash_algorithm: "sha256",
      },
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchTenantState() {
        return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
      },
      async findIntakeFileReservationByIdempotencyKey() {
        return null;
      },
      async findIntakeFileReservationByChecksum() {
        return null;
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
          storage_bucket: file.storageBucket,
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
  assert.equal(result.data.safe_filename, "ncws_p0_pass2_metadata_only_reservation.csv");
  assert.equal(inserted.rawFileRetained, false);
  assert.equal(inserted.filePolicyStatus, "pending");
  assert.equal(inserted.malwareScanStatus, "not_configured");
  assert.equal(inserted.fileMetadata.p0_pass, "pass2_admin_metadata_intake_verification");
  assert.equal(inserted.fileMetadata.gate_plan, "KAI_MVP_Sprint2_P0_Pass2_Production_Synthetic_Metadata_Write_Gate_Plan_v0.1.1");
  assert.equal(inserted.fileMetadata.checksum_scope, "metadata_reservation_no_raw_file");
  assert.equal(inserted.fileMetadata.checksum_source, "caller_declared");
  assert.equal(inserted.fileMetadata.checksum_verification_status, "unverified");
  assert.equal(inserted.checksum, declaredChecksum);
  assert.equal(inserted.hashAlgorithm, "sha256");
  assert.equal(result.data.processing_status, "quarantined");
  assert.equal(result.data.parse_status, "quarantined");
  assert.equal("storage_provider" in result.data, false);
  assert.equal("storage_bucket" in result.data, false);
  assert.equal("storage_object_key" in result.data, false);
  assert.equal("storage_uri" in result.data, false);
  assert.match(inserted.storageUri, /^reservation:\/\/kai\/gcs\/org\//);
});

test("file reservation enforces the committed extension MIME matrix", async (t) => {
  async function reserveWithMetadata({ fileExtension, mimeType, idempotencyKey }) {
    let inserted = null;
    const result = await reserveIntakeFileMetadata(
      {
        actorContext,
        organizationId,
        engagementId,
        intakeBatchId,
        intakeFileId,
        payload: {
          idempotency_key: idempotencyKey,
          original_filename: `safe${fileExtension}`,
          mime_type: mimeType,
          file_extension: fileExtension,
          file_size_bytes: 0,
          checksum: declaredChecksum,
          hash_algorithm: "sha256",
        },
      },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        async getIntakeBatchTenantState() {
          return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
        },
        async findIntakeFileReservationByIdempotencyKey() {
          return null;
        },
        async findIntakeFileReservationByChecksum() {
          return null;
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
            storage_bucket: file.storageBucket,
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
    return { result, inserted };
  }

  for (const [fileExtension, mimeType] of [
    [".txt", "application/json"],
    [".txt", "application/octet-stream"],
    [".txt", "application/xml"],
    [".xlsx", "text/plain"],
    [".pdf", "text/plain"],
    [".md", "application/pdf"],
  ]) {
    await t.test(`rejects ${fileExtension} ${mimeType}`, async () => {
      const { result, inserted } = await reserveWithMetadata({
        fileExtension,
        mimeType,
        idempotencyKey: `kai-p0-runtime-block-${fileExtension.slice(1)}-${mimeType.replace(/[^a-z0-9]/gi, "-")}`,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "validation_blocker");
      assert.equal(result.error.status, 422);
      assert.equal(result.blockers[0].validator_key, "VAL-STO-005");
      assert.equal(result.blockers[0].object_code, "mime_type");
      assert.equal(result.blockers[0].blocking_reason, "unsupported_mime_type");
      assert.deepEqual(result.blockers[0].evidence, { file_extension: fileExtension, mime_type: mimeType });
      assert.equal(inserted, null);
    });
  }

  for (const [fileExtension, mimeType] of [
    [".csv", "text/csv"],
    [".csv", "application/csv"],
    [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    [".md", "text/markdown"],
    [".md", "text/plain"],
    [".txt", "text/plain"],
    [".pdf", "application/pdf"],
  ]) {
    await t.test(`accepts ${fileExtension} ${mimeType}`, async () => {
      const { result, inserted } = await reserveWithMetadata({
        fileExtension,
        mimeType,
        idempotencyKey: `kai-p0-runtime-allow-${fileExtension.slice(1)}-${mimeType.replace(/[^a-z0-9]/gi, "-")}`,
      });

      assert.equal(result.ok, true);
      assert.equal(inserted.mimeType, mimeType);
      assert.equal(inserted.fileExtension, fileExtension);
      assert.equal(result.data.safe_filename, `safe${fileExtension}`);
    });
  }
});

test("file reservation blocks missing and invalid idempotency keys before lookup or insert", async (t) => {
  for (const { name, idempotencyKey, blockingReason } of [
    { name: "missing", idempotencyKey: undefined, blockingReason: "missing_idempotency_key" },
    { name: "invalid", idempotencyKey: "bad key", blockingReason: "invalid_idempotency_key" },
  ]) {
    await t.test(name, async () => {
      let lookupCalled = false;
      let duplicateLookupCalled = false;
      let insertCalled = false;
      const payload = {
        ...(idempotencyKey === undefined ? {} : { idempotency_key: idempotencyKey }),
        original_filename: "safe.csv",
        mime_type: "text/csv",
        file_extension: ".csv",
        file_size_bytes: 0,
      };
      const result = await reserveIntakeFileMetadata(
        {
          actorContext,
          organizationId,
          engagementId,
          intakeBatchId,
          intakeFileId,
          payload,
        },
        {
          env: { KAI_SPRINT2_ENABLED: "true" },
          async getIntakeBatchTenantState() {
            return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
          },
          async findIntakeFileReservationByIdempotencyKey() {
            lookupCalled = true;
            return null;
          },
          async findIntakeFileReservationByChecksum() {
            duplicateLookupCalled = true;
            return null;
          },
          async insertIntakeFileMetadata() {
            insertCalled = true;
          },
        },
      );

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "validation_blocker");
      assert.equal(result.error.status, 422);
      assert.ok(result.blockers.some((blocker) => blocker.blocking_reason === blockingReason));
      assert.equal(lookupCalled, false);
      assert.equal(duplicateLookupCalled, false);
      assert.equal(insertCalled, false);
    });
  }
});

test("file reservation blocks missing or invalid checksum metadata before replay, duplicate, or insert", async (t) => {
  for (const { name, checksum, hashAlgorithm, blockingReason } of [
    { name: "missing checksum", checksum: undefined, hashAlgorithm: "sha256", blockingReason: "missing_checksum" },
    { name: "invalid checksum", checksum: "not-a-sha256", hashAlgorithm: "sha256", blockingReason: "invalid_checksum" },
    { name: "missing algorithm", checksum: declaredChecksum, hashAlgorithm: undefined, blockingReason: "missing_hash_algorithm" },
    { name: "unsupported algorithm", checksum: declaredChecksum, hashAlgorithm: "sha512", blockingReason: "unsupported_hash_algorithm" },
  ]) {
    await t.test(name, async () => {
      let replayLookups = 0;
      let duplicateLookups = 0;
      let inserts = 0;
      const result = await reserveIntakeFileMetadata(
        {
          actorContext,
          organizationId,
          engagementId,
          intakeBatchId,
          intakeFileId,
          payload: {
            idempotency_key: `kai-p0-checksum-${name.replace(/\s/g, "-")}`,
            original_filename: "safe.csv",
            mime_type: "text/csv",
            file_extension: ".csv",
            ...(checksum === undefined ? {} : { checksum }),
            ...(hashAlgorithm === undefined ? {} : { hash_algorithm: hashAlgorithm }),
          },
        },
        {
          env: { KAI_SPRINT2_ENABLED: "true" },
          async getIntakeBatchTenantState() {
            return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
          },
          async findIntakeFileReservationByIdempotencyKey() {
            replayLookups += 1;
            return null;
          },
          async findIntakeFileReservationByChecksum() {
            duplicateLookups += 1;
            return null;
          },
          async insertIntakeFileMetadata() {
            inserts += 1;
          },
        },
      );

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "validation_blocker");
      assert.equal(result.error.status, 422);
      assert.ok(result.blockers.some((blocker) => blocker.blocking_reason === blockingReason));
      assert.equal(replayLookups, 0);
      assert.equal(duplicateLookups, 0);
      assert.equal(inserts, 0);
    });
  }
});

test("file reservation preserves identical replay and rejects conflicting checksum replay", async () => {
  let inserted = null;
  let duplicateLookups = 0;
  const payload = {
    idempotency_key: "kai-p0-checksum-replay-001",
    original_filename: "safe.csv",
    mime_type: "text/csv",
    file_extension: ".csv",
    checksum: declaredChecksum,
    hash_algorithm: "sha256",
  };
  const baseDependencies = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async getIntakeBatchTenantState() {
      return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
    },
    async findIntakeFileReservationByChecksum() {
      duplicateLookups += 1;
      return null;
    },
  };

  const created = await reserveIntakeFileMetadata(
    { actorContext, organizationId, engagementId, intakeBatchId, intakeFileId, payload },
    {
      ...baseDependencies,
      async findIntakeFileReservationByIdempotencyKey() {
        return null;
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
  assert.equal(created.ok, true);
  assert.ok(inserted);

  const existing = {
    intake_file_id: intakeFileId,
    intake_batch_id: intakeBatchId,
    organization_id: organizationId,
    engagement_id: engagementId,
    safe_filename: inserted.safeFilename,
    storage_provider: inserted.storageProvider,
    storage_object_key: inserted.storageObjectKey,
    file_policy_status: inserted.filePolicyStatus,
    malware_scan_status: inserted.malwareScanStatus,
    processing_status: "quarantined",
    parse_status: "quarantined",
    review_status: "proposed",
    file_metadata: inserted.fileMetadata,
  };
  const replay = await reserveIntakeFileMetadata(
    { actorContext, organizationId, engagementId, intakeBatchId, intakeFileId, payload },
    {
      ...baseDependencies,
      async findIntakeFileReservationByIdempotencyKey() {
        return existing;
      },
      async insertIntakeFileMetadata() {
        assert.fail("identical replay must not insert");
      },
    },
  );
  assert.equal(replay.ok, true);
  assert.equal(replay.data.intake_file_id, intakeFileId);
  assert.equal(duplicateLookups, 1);

  const conflict = await reserveIntakeFileMetadata(
    {
      actorContext,
      organizationId,
      engagementId,
      intakeBatchId,
      intakeFileId,
      payload: { ...payload, checksum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    },
    {
      ...baseDependencies,
      async findIntakeFileReservationByIdempotencyKey() {
        return existing;
      },
      async insertIntakeFileMetadata() {
        assert.fail("conflicting replay must not insert");
      },
    },
  );
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, "duplicate_conflict");
  assert.equal(conflict.error.status, 409);
  assert.equal(duplicateLookups, 1);
});

test("file reservation fails closed for missing or malformed stored fingerprints", async (t) => {
  let inserted = null;
  const payload = {
    idempotency_key: "kai-p0-malformed-file-replay-001",
    original_filename: "safe.csv",
    mime_type: "text/csv",
    file_extension: ".csv",
    checksum: declaredChecksum,
    hash_algorithm: "sha256",
  };
  const baseDependencies = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async getIntakeBatchTenantState() {
      return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
    },
    async findIntakeFileReservationByChecksum() {
      return null;
    },
  };
  const created = await reserveIntakeFileMetadata(
    { actorContext, organizationId, engagementId, intakeBatchId, intakeFileId, payload },
    {
      ...baseDependencies,
      async findIntakeFileReservationByIdempotencyKey() {
        return null;
      },
      async insertIntakeFileMetadata(file) {
        inserted = file;
        return {
          intake_file_id: file.intakeFileId,
          intake_batch_id: file.intakeBatchId,
          organization_id: file.organizationId,
          engagement_id: file.engagementId,
          safe_filename: file.safeFilename,
          file_policy_status: file.filePolicyStatus,
          malware_scan_status: file.malwareScanStatus,
          processing_status: "quarantined",
          parse_status: "quarantined",
          review_status: "proposed",
        };
      },
    },
  );
  assert.equal(created.ok, true);

  const { reservation_payload_hash: validFingerprint, ...metadataWithoutFingerprint } = inserted.fileMetadata;
  assert.match(validFingerprint, /^[0-9a-f]{64}$/);
  for (const { name, fileMetadata } of [
    { name: "missing", fileMetadata: metadataWithoutFingerprint },
    { name: "null", fileMetadata: { ...metadataWithoutFingerprint, reservation_payload_hash: null } },
    { name: "empty", fileMetadata: { ...metadataWithoutFingerprint, reservation_payload_hash: "" } },
    { name: "non-string", fileMetadata: { ...metadataWithoutFingerprint, reservation_payload_hash: 64 } },
    { name: "wrong-length", fileMetadata: { ...metadataWithoutFingerprint, reservation_payload_hash: "a".repeat(63) } },
    { name: "non-hexadecimal", fileMetadata: { ...metadataWithoutFingerprint, reservation_payload_hash: "g".repeat(64) } },
    { name: "uppercase", fileMetadata: { ...metadataWithoutFingerprint, reservation_payload_hash: "A".repeat(64) } },
  ]) {
    await t.test(name, async () => {
      const result = await reserveIntakeFileMetadata(
        { actorContext, organizationId, engagementId, intakeBatchId, intakeFileId, payload },
        {
          ...baseDependencies,
          async findIntakeFileReservationByIdempotencyKey() {
            return {
              intake_file_id: intakeFileId,
              intake_batch_id: intakeBatchId,
              organization_id: organizationId,
              engagement_id: engagementId,
              safe_filename: inserted.safeFilename,
              file_policy_status: inserted.filePolicyStatus,
              malware_scan_status: inserted.malwareScanStatus,
              processing_status: "quarantined",
              parse_status: "quarantined",
              review_status: "proposed",
              file_metadata: fileMetadata,
            };
          },
          async findIntakeFileReservationByChecksum() {
            assert.fail("invalid stored fingerprint must fail before duplicate-checksum lookup");
          },
          async insertIntakeFileMetadata() {
            assert.fail("invalid stored fingerprint must not be repaired or overwritten");
          },
        },
      );
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "duplicate_conflict");
      assert.equal(result.error.status, 409);
    });
  }
});

test("file reservation blocks preliminary duplicate declared checksums without verification or insert", async () => {
  let inserted = false;
  let duplicateLookupInput = null;
  const result = await reserveIntakeFileMetadata(
    {
      actorContext,
      organizationId,
      engagementId,
      intakeBatchId,
      intakeFileId,
      payload: {
        idempotency_key: "kai-p0-checksum-duplicate-001",
        original_filename: "safe.csv",
        mime_type: "text/csv",
        file_extension: ".csv",
        checksum: declaredChecksum,
        hash_algorithm: "sha256",
      },
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchTenantState() {
        return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
      },
      async findIntakeFileReservationByIdempotencyKey() {
        return null;
      },
      async findIntakeFileReservationByChecksum(input) {
        duplicateLookupInput = input;
        return { checksum: declaredChecksum };
      },
      async insertIntakeFileMetadata() {
        inserted = true;
      },
      async insertBlockedAttemptAuditEvent() {
        return { ok: true, auditEventId: "audit-preliminary-duplicate" };
      },
    },
  );

  assert.deepEqual(duplicateLookupInput, { organizationId, checksum: declaredChecksum });
  assert.equal(result.ok, false);
  assert.equal(result.error.status, 422);
  assert.equal(result.blockers[0].blocking_reason, "duplicate_checksum");
  assert.equal(result.blockers[0].evidence.duplicate_evaluation, "preliminary_declared_checksum_match");
  assert.equal(result.blockers[0].evidence.storage_checksum_verified, false);
  assert.equal(inserted, false);
});

test("file reservation blocks missing request engagement_id when parent batch has engagement", async () => {
  let inserted = false;
  let auditMetadata = null;
  const result = await reserveIntakeFileMetadata(
    {
      actorContext,
      organizationId,
      intakeBatchId,
      payload: {
        idempotency_key: "kai-p0-pass2-file-missing-request-engagement",
        original_filename: "NCWS P0 Pass2 metadata-only reservation.csv",
        mime_type: "text/csv",
        file_extension: ".csv",
        file_size_bytes: 0,
      },
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchTenantState() {
        return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
      },
      async insertIntakeFileMetadata() {
        inserted = true;
      },
      async insertBlockedAttemptAuditEvent(metadata) {
        auditMetadata = metadata;
        return { ok: true, auditEventId: "audit-file-missing-request-engagement" };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.status, 422);
  assert.equal(result.blockers[0].blocking_reason, "engagement_batch_tenant_mismatch");
  assert.equal(result.blockers[0].evidence.requested_engagement_id, null);
  assert.equal(result.blockers[0].evidence.batch_engagement_id, engagementId);
  assert.equal(inserted, false);
  assert.equal(result.audit_context.blocked_attempt_audit.ok, true);
  assert.equal(result.audit_context.blocked_attempt_audit.audit_event_id, "audit-file-missing-request-engagement");
  assert.equal(auditMetadata.object_type, "other");
  assert.equal(auditMetadata.target_object_type, "intake_file");
  assert.equal(auditMetadata.metadata_only, true);
  assert.equal(auditMetadata.contains_raw_file_content, false);
  assert.equal(auditMetadata.contains_signed_urls, false);
  assert.equal(auditMetadata.contains_storage_credentials, false);
});

test("file reservation blocks request engagement that crosses parent batch engagement without insert", async () => {
  let inserted = false;
  let auditMetadata = null;
  const result = await reserveIntakeFileMetadata(
    {
      actorContext,
      organizationId,
      engagementId: otherEngagementId,
      intakeBatchId,
      payload: {
        idempotency_key: "kai-p0-pass2-file-cross-engagement",
        original_filename: "NCWS P0 Pass2 metadata-only reservation.csv",
        mime_type: "text/csv",
        file_extension: ".csv",
        file_size_bytes: 0,
      },
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchTenantState() {
        return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
      },
      async insertIntakeFileMetadata() {
        inserted = true;
      },
      async insertBlockedAttemptAuditEvent(metadata) {
        auditMetadata = metadata;
        return { ok: true, auditEventId: "audit-file-cross-engagement" };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.status, 422);
  assert.equal(result.blockers[0].blocking_reason, "engagement_batch_tenant_mismatch");
  assert.equal(inserted, false);
  assert.equal(result.audit_context.blocked_attempt_audit.ok, true);
  assert.equal(auditMetadata.object_type, "other");
  assert.equal(auditMetadata.target_object_type, "intake_file");
  assert.equal(auditMetadata.metadata_only, true);
  assert.equal(auditMetadata.contains_signed_urls, false);
  assert.equal(auditMetadata.contains_storage_credentials, false);
});

test("blocked-attempt audit failure is represented on validator response", async () => {
  const result = await reserveIntakeFileMetadata(
    {
      actorContext,
      organizationId,
      engagementId,
      intakeBatchId,
      payload: {
        idempotency_key: "kai-p0-pass2-audit-failure",
        original_filename: "../unsafe.csv",
        mime_type: "text/csv",
        file_extension: ".csv",
        file_size_bytes: 0,
      },
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchTenantState() {
        return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
      },
      async insertBlockedAttemptAuditEvent() {
        throw new Error("audit unavailable");
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.status, 422);
  assert.equal(result.blockers[0].blocking_reason, "unsafe_filename");
  assert.equal(result.audit_context.blocked_attempt_audit.ok, false);
  assert.equal(result.audit_context.blocked_attempt_audit.reason, "audit_insert_failed");
  assert.equal(result.warnings[0].code, "blocked_attempt_audit_failed");
});
