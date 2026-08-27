import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.KAI_CONFIRM_UPLOAD_METADATA_BOUNDARY_DATABASE_URL) {
  test("confirm-upload metadata-boundary integration requires the runner-owned database", { skip: true }, () => {});
} else {
  await runConfirmUploadMetadataBoundarySuite();
}

async function runConfirmUploadMetadataBoundarySuite() {
  const { Pool } = await import("pg");
  const { getIntakeFileUploadMetadata, getScopedLatestSecurityAssessmentAuditProjection } = await import("../Backend/kai/db/kaiReadModels.js");
  const { confirmUpload, __testables: intakeServiceTestables } = await import("../Backend/kai/services/kaiIntakeService.js");
  const { casSecurityAssessmentFilePolicyDecision, getScopedIntakeFileSecurityAssessmentFacts } = await import("../Backend/kai/db/kaiIntakeQueries.js");
  const { insertRequiredSuccessfulAuditEvent } = await import("../Backend/kai/db/kaiAuditQueries.js");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const applyConfirmedSecurityAssessment = intakeServiceTestables.applyConfirmedSecurityAssessment;
  const securityAssessmentProjection = intakeServiceTestables.securityAssessmentProjection;

  const DATABASE_URL = process.env.KAI_CONFIRM_UPLOAD_METADATA_BOUNDARY_DATABASE_URL;
  const ORG = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
  const OTHER_ORG = "b6e28d6b-d66f-4eb2-8caf-2c1e11b1b6ff";
  const BATCH = "8e426ea1-2be3-4e48-b80f-9783ddbacda0";
  const FILE = "9fe568b1-5c05-4c42-bb1f-6e20de216c7b";
  const FILE2 = "1fe568b1-5c05-4c42-bb1f-6e20de216c7c";
  const CHECKSUM = "c".repeat(64);
  const NOW = "2026-08-12T10:00:00.000Z";
  const enabledUploadEnv = { KAI_SPRINT2_ENABLED: "true", KAI_FILE_UPLOAD_ENABLED: "true" };

  const actorContext = {
    actorType: "human",
    actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
    kaiRoles: ["gk_operator"],
    organizationMemberships: [
      { organization_id: ORG, role_name: "gk_operator", membership_status: "active" },
    ],
  };

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 4 });
  test.after(async () => {
    await pool.end();
  });

  async function resetTables() {
    await pool.query("TRUNCATE kai.upload_lifecycle_audit, kai.intake_files, kai.audit_events");
  }

  async function seedReservation({ fileSizeBytes = 17 } = {}) {
    await pool.query(
      `INSERT INTO kai.intake_files (
         intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         storage_provider, storage_bucket, storage_object_key, mime_type, file_size_bytes,
         checksum, hash_algorithm, force_new_version, processing_status, parse_status,
         review_status, file_policy_status, malware_scan_status, created_at
       )
       VALUES ($1,$2,$3,NULL,'fixture.pdf','fixture.pdf','local','fixture-bucket','fixture-key',
               'application/pdf',$4,$5,'sha256',true,'quarantined','quarantined','proposed','pending','not_configured',$6::timestamptz)`,
      [FILE, BATCH, ORG, fileSizeBytes, CHECKSUM, NOW],
    );
  }

  // A synthetic file already through Gate A's `confirmed` upload state (the
  // only state the state_fact_consistency trigger allows object_version_id/
  // verified_checksum/verified_size_bytes/verified_at to be set in), still
  // `file_policy_status = 'pending'` - i.e. exactly the row shape Gate C's
  // post-confirm security-assessment handoff operates on.
  async function seedConfirmedPendingFile({
    intakeFileId,
    organizationId = ORG,
    objectVersionId,
    verifiedChecksum,
    verifiedSizeBytes,
    mimeType = "text/plain",
    fileExtension = ".txt",
    malwareScanStatus = "not_configured",
  }) {
    await pool.query(
      `INSERT INTO kai.intake_files (
         intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         storage_provider, storage_bucket, storage_object_key, mime_type, file_extension, file_size_bytes,
         checksum, hash_algorithm, force_new_version, processing_status, parse_status,
         review_status, file_policy_status, malware_scan_status, created_at,
         upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at
       )
       VALUES ($1,$2,$3,NULL,'fixture.txt','fixture.txt','gcs','fixture-bucket','fixture-key',
               $4,$5,$6,$7,'sha256',true,'quarantined','quarantined','proposed','pending',$8,$9::timestamptz,
               'confirmed',$10,$7,$6,$9::timestamptz)`,
      [
        intakeFileId,
        BATCH,
        organizationId,
        mimeType,
        fileExtension,
        verifiedSizeBytes,
        verifiedChecksum,
        malwareScanStatus,
        NOW,
        objectVersionId,
      ],
    );
  }

  async function readFilePolicyRow(organizationId, intakeFileId) {
    const { rows } = await pool.query(
      "SELECT file_policy_status, malware_scan_status FROM kai.intake_files WHERE organization_id = $1 AND intake_file_id = $2",
      [organizationId, intakeFileId],
    );
    return rows[0] || null;
  }

  async function insertSyntheticAuditEvent({
    organizationId,
    intakeFileId,
    action,
    reasonCode,
    assessmentCategory,
    createdAt,
    extraMetadata = {},
  }) {
    const metadata = {
      object_id: intakeFileId,
      object_type: "intake_file",
      target_object_type: "intake_file",
      assessment_category: assessmentCategory,
      ...extraMetadata,
    };
    await pool.query(
      `INSERT INTO kai.audit_events (organization_id, actor_user_id, actor_type, action, metadata, object_type, reason_code, reason_text, created_at)
       VALUES ($1,NULL,'system',$2,$3::jsonb,'other',$4,'synthetic fixture',$5::timestamptz)`,
      [organizationId, action, JSON.stringify(metadata), reasonCode, createdAt],
    );
  }

  test("PostgreSQL returns file_size_bytes as a bigint string for the raw row", async () => {
    await resetTables();
    await seedReservation({ fileSizeBytes: 17 });
    const { rows } = await pool.query(
      "SELECT file_size_bytes FROM kai.intake_files WHERE organization_id = $1 AND intake_file_id = $2",
      [ORG, FILE],
    );
    assert.equal(typeof rows[0].file_size_bytes, "string");
    assert.equal(rows[0].file_size_bytes, "17");
  });

  test("getIntakeFileUploadMetadata normalizes the real Postgres row to a JS-safe-integer file_size_bytes", async () => {
    await resetTables();
    await seedReservation({ fileSizeBytes: 17 });
    const row = await getIntakeFileUploadMetadata(ORG, FILE, pool);
    assert.equal(row.organization_id, ORG);
    assert.equal(row.intake_file_id, FILE);
    assert.equal(typeof row.file_size_bytes, "number");
    assert.equal(row.file_size_bytes, 17);
    assert.equal(Number.isSafeInteger(row.file_size_bytes), true);
  });

  test("getIntakeFileUploadMetadata handles zero-byte files without weakening validation", async () => {
    await resetTables();
    await seedReservation({ fileSizeBytes: 0 });
    const row = await getIntakeFileUploadMetadata(ORG, FILE, pool);
    assert.equal(row.file_size_bytes, 0);
    assert.equal(Number.isSafeInteger(row.file_size_bytes), true);
  });

  test("confirmUpload's metadata boundary accepts the real Postgres-returned row instead of returning invalid_request", async () => {
    await resetTables();
    await seedReservation({ fileSizeBytes: 17 });

    const result = await confirmUpload(
      {
        organizationId: ORG,
        intakeFileId: FILE,
        actorContext,
        now: NOW,
      },
      {
        env: enabledUploadEnv,
        async getIntakeFileMetadata(organizationId, intakeFileId) {
          return getIntakeFileUploadMetadata(organizationId, intakeFileId, pool);
        },
        // Deliberately no uploadLifecycleRepository: if validConfirmUploadMetadata
        // still rejected the real DB row, confirmUpload would never reach this
        // check and would return invalid_request instead.
      },
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "storage_provider_not_configured");
  });

  // --- A. Policy decision CAS against real PostgreSQL ---

  test("casSecurityAssessmentFilePolicyDecision durably transitions file_policy_status and malware_scan_status, and the CAS guard rejects a second attempt", async () => {
    await resetTables();
    const objectVersionId = "ov_11111111111111111111111111111111";
    const verifiedChecksum = "d".repeat(64);
    await seedConfirmedPendingFile({ intakeFileId: FILE, objectVersionId, verifiedChecksum, verifiedSizeBytes: 57 });

    const updated = await casSecurityAssessmentFilePolicyDecision(
      { organizationId: ORG, intakeFileId: FILE, objectVersionId, verifiedChecksum, verifiedSizeBytes: 57, newFilePolicyStatus: "passed", newMalwareScanStatus: "passed" },
      pool,
    );
    assert.ok(updated);
    assert.equal(updated.file_policy_status, "passed");
    assert.equal(updated.malware_scan_status, "passed");

    const persisted = await readFilePolicyRow(ORG, FILE);
    assert.equal(persisted.file_policy_status, "passed");
    assert.equal(persisted.malware_scan_status, "passed");

    // Retrying the exact same CAS now that the file is no longer pending is a
    // no-op: the compare-and-set guard rejects it (0 rows), it is never a
    // silent overwrite.
    const replay = await casSecurityAssessmentFilePolicyDecision(
      { organizationId: ORG, intakeFileId: FILE, objectVersionId, verifiedChecksum, verifiedSizeBytes: 57, newFilePolicyStatus: "passed", newMalwareScanStatus: "passed" },
      pool,
    );
    assert.equal(replay, null);
  });

  test("casSecurityAssessmentFilePolicyDecision leaves malware_scan_status untouched (COALESCE) when the derived value is null", async () => {
    await resetTables();
    const objectVersionId = "ov_22222222222222222222222222222222";
    const verifiedChecksum = "e".repeat(64);
    await seedConfirmedPendingFile({
      intakeFileId: FILE2,
      objectVersionId,
      verifiedChecksum,
      verifiedSizeBytes: 12,
      malwareScanStatus: "not_configured",
    });

    const updated = await casSecurityAssessmentFilePolicyDecision(
      { organizationId: ORG, intakeFileId: FILE2, objectVersionId, verifiedChecksum, verifiedSizeBytes: 12, newFilePolicyStatus: "blocked", newMalwareScanStatus: null },
      pool,
    );
    assert.ok(updated);
    assert.equal(updated.file_policy_status, "blocked");
    assert.equal(updated.malware_scan_status, "not_configured");

    const persisted = await readFilePolicyRow(ORG, FILE2);
    assert.equal(persisted.malware_scan_status, "not_configured");
  });

  test("organization/file/immutable-fact CAS guards remain enforced against real PostgreSQL: any mismatch is a no-op, never an overwrite", async () => {
    await resetTables();
    const objectVersionId = "ov_33333333333333333333333333333333";
    const verifiedChecksum = "f".repeat(64);
    await seedConfirmedPendingFile({ intakeFileId: FILE, objectVersionId, verifiedChecksum, verifiedSizeBytes: 9 });

    const wrongOrg = await casSecurityAssessmentFilePolicyDecision(
      { organizationId: OTHER_ORG, intakeFileId: FILE, objectVersionId, verifiedChecksum, verifiedSizeBytes: 9, newFilePolicyStatus: "passed", newMalwareScanStatus: "passed" },
      pool,
    );
    assert.equal(wrongOrg, null);

    const wrongChecksum = await casSecurityAssessmentFilePolicyDecision(
      { organizationId: ORG, intakeFileId: FILE, objectVersionId, verifiedChecksum: "a".repeat(64), verifiedSizeBytes: 9, newFilePolicyStatus: "passed", newMalwareScanStatus: "passed" },
      pool,
    );
    assert.equal(wrongChecksum, null);

    const wrongObjectVersion = await casSecurityAssessmentFilePolicyDecision(
      { organizationId: ORG, intakeFileId: FILE, objectVersionId: "ov_99999999999999999999999999999999", verifiedChecksum, verifiedSizeBytes: 9, newFilePolicyStatus: "passed", newMalwareScanStatus: "passed" },
      pool,
    );
    assert.equal(wrongObjectVersion, null);

    const persisted = await readFilePolicyRow(ORG, FILE);
    assert.equal(persisted.file_policy_status, "pending");
    assert.equal(persisted.malware_scan_status, "not_configured");
  });

  // --- B. Security assessment audit projection against real PostgreSQL ---

  test("getScopedLatestSecurityAssessmentAuditProjection selects the latest allowlisted event scoped to organization and file, ignoring other actions/files/organizations", async () => {
    await resetTables();
    await insertSyntheticAuditEvent({
      organizationId: ORG, intakeFileId: FILE, action: "apply_security_assessment_policy_decision",
      reasonCode: "passed", assessmentCategory: null, createdAt: "2026-08-12T10:00:00.000Z",
    });
    await insertSyntheticAuditEvent({
      organizationId: ORG, intakeFileId: FILE, action: "record_security_assessment_diagnostic",
      reasonCode: "no_policy_decision", assessmentCategory: "malware_scan_not_configured", createdAt: "2026-08-12T10:05:00.000Z",
    });
    // Latest by created_at, but not an allowlisted security-assessment action: must be ignored.
    await insertSyntheticAuditEvent({
      organizationId: ORG, intakeFileId: FILE, action: "mark_file_policy_blocked",
      reasonCode: "blocked", assessmentCategory: "malware_failed", createdAt: "2026-08-12T10:10:00.000Z",
    });
    // A different file in the same organization must not interfere.
    await insertSyntheticAuditEvent({
      organizationId: ORG, intakeFileId: FILE2, action: "apply_security_assessment_policy_decision",
      reasonCode: "blocked", assessmentCategory: "malware_failed", createdAt: "2026-08-12T10:15:00.000Z",
    });
    // A different organization's event for the SAME file id must not leak in.
    await insertSyntheticAuditEvent({
      organizationId: OTHER_ORG, intakeFileId: FILE, action: "apply_security_assessment_policy_decision",
      reasonCode: "blocked", assessmentCategory: "malware_failed", createdAt: "2026-08-12T10:20:00.000Z",
    });

    const row = await getScopedLatestSecurityAssessmentAuditProjection(ORG, FILE, pool);
    assert.ok(row);
    assert.equal(row.action, "record_security_assessment_diagnostic");
    assert.equal(row.reason_code, "no_policy_decision");
    assert.equal(row.assessment_category, "malware_scan_not_configured");
    assert.deepEqual(securityAssessmentProjection(row), { category: "malware_scan_not_configured", policy_outcome: null });
  });

  test("a persisted policy-decision event projects category and policy_outcome from a real PostgreSQL row", async () => {
    await resetTables();
    await insertSyntheticAuditEvent({
      organizationId: ORG, intakeFileId: FILE, action: "apply_security_assessment_policy_decision",
      reasonCode: "failed", assessmentCategory: "malware_scan_failed", createdAt: NOW,
    });

    const row = await getScopedLatestSecurityAssessmentAuditProjection(ORG, FILE, pool);
    assert.deepEqual(securityAssessmentProjection(row), { category: "malware_scan_failed", policy_outcome: "failed" });
  });

  test("another organization's security-assessment audit event can never be retrieved for this organization/file", async () => {
    await resetTables();
    await insertSyntheticAuditEvent({
      organizationId: OTHER_ORG, intakeFileId: FILE, action: "apply_security_assessment_policy_decision",
      reasonCode: "blocked", assessmentCategory: "malware_failed", createdAt: NOW,
    });

    const row = await getScopedLatestSecurityAssessmentAuditProjection(ORG, FILE, pool);
    assert.equal(row, null);
    assert.deepEqual(securityAssessmentProjection(row), { category: null, policy_outcome: null });
  });

  test("no raw metadata is exposed by the service DTO even when the underlying audit row's metadata carries extra fields", async () => {
    await resetTables();
    await insertSyntheticAuditEvent({
      organizationId: ORG, intakeFileId: FILE, action: "apply_security_assessment_policy_decision",
      reasonCode: "blocked", assessmentCategory: "malware_failed", createdAt: NOW,
      extraMetadata: { storage_object_key: "storage-object-key-sentinel", raw_error: "raw-error-sentinel" },
    });

    const row = await getScopedLatestSecurityAssessmentAuditProjection(ORG, FILE, pool);
    assert.deepEqual(Object.keys(row).sort(), ["action", "assessment_category", "reason_code"]);
    const dto = securityAssessmentProjection(row);
    assert.deepEqual(Object.keys(dto).sort(), ["category", "policy_outcome"]);
    assert.equal(JSON.stringify(dto).includes("sentinel"), false);
  });

  // --- End-to-end: Gate C's post-confirm handoff driving both new SQL paths together ---

  test("applyConfirmedSecurityAssessment drives casSecurityAssessmentFilePolicyDecision to a real committed policy pass", async () => {
    await resetTables();
    const objectVersionId = "ov_44444444444444444444444444444444";
    const verifiedChecksum = "1".repeat(64);
    await seedConfirmedPendingFile({ intakeFileId: FILE, objectVersionId, verifiedChecksum, verifiedSizeBytes: 5 });

    await applyConfirmedSecurityAssessment(
      { organizationId: ORG, intakeFileId: FILE, objectVersionId, verifiedChecksum, verifiedSizeBytes: 5, requestId: "request_pg_1", actorContext: { actorUserId: actorContext.actorUserId, actorType: "human" } },
      {
        now: () => NOW,
        runInTransaction: (callback) => withTransaction(callback, pool),
        async getScopedIntakeFileSecurityAssessmentFacts(identity) {
          return getScopedIntakeFileSecurityAssessmentFacts(identity, pool);
        },
        async runProductionSecurityAssessment() {
          return { ok: true, data: { assessmentResult: { policy: "pass" }, policyDecisionOutcome: "passed" } };
        },
        casSecurityAssessmentFilePolicyDecision,
        async insertRequiredSuccessfulAuditEvent(metadata, transactionContext) {
          return insertRequiredSuccessfulAuditEvent(metadata, transactionContext);
        },
      },
    );

    const persisted = await readFilePolicyRow(ORG, FILE);
    assert.equal(persisted.file_policy_status, "passed");
    assert.equal(persisted.malware_scan_status, "passed");

    const auditRow = await getScopedLatestSecurityAssessmentAuditProjection(ORG, FILE, pool);
    assert.deepEqual(securityAssessmentProjection(auditRow), { category: null, policy_outcome: "passed" });
  });

  test("applyConfirmedSecurityAssessment persists a durable diagnostic audit row for malware_scan_not_configured, leaving file_policy_status pending", async () => {
    await resetTables();
    const objectVersionId = "ov_55555555555555555555555555555555";
    const verifiedChecksum = "2".repeat(64);
    await seedConfirmedPendingFile({ intakeFileId: FILE2, objectVersionId, verifiedChecksum, verifiedSizeBytes: 3 });

    await applyConfirmedSecurityAssessment(
      { organizationId: ORG, intakeFileId: FILE2, objectVersionId, verifiedChecksum, verifiedSizeBytes: 3, requestId: "request_pg_2", actorContext: { actorUserId: actorContext.actorUserId, actorType: "human" } },
      {
        now: () => NOW,
        runInTransaction: (callback) => withTransaction(callback, pool),
        async getScopedIntakeFileSecurityAssessmentFacts(identity) {
          return getScopedIntakeFileSecurityAssessmentFacts(identity, pool);
        },
        async runProductionSecurityAssessment() {
          return { ok: true, data: { assessmentResult: { status: "failed", category: "malware_scan_not_configured" }, policyDecisionOutcome: null } };
        },
        casSecurityAssessmentFilePolicyDecision,
        async insertRequiredSuccessfulAuditEvent(metadata, transactionContext) {
          return insertRequiredSuccessfulAuditEvent(metadata, transactionContext);
        },
      },
    );

    const persisted = await readFilePolicyRow(ORG, FILE2);
    assert.equal(persisted.file_policy_status, "pending");

    const auditRow = await getScopedLatestSecurityAssessmentAuditProjection(ORG, FILE2, pool);
    assert.ok(auditRow);
    assert.equal(auditRow.action, "record_security_assessment_diagnostic");
    assert.deepEqual(securityAssessmentProjection(auditRow), { category: "malware_scan_not_configured", policy_outcome: null });
  });
}
