import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.KAI_CONFIRM_UPLOAD_METADATA_BOUNDARY_DATABASE_URL) {
  test("confirm-upload metadata-boundary integration requires the runner-owned database", { skip: true }, () => {});
} else {
  await runConfirmUploadMetadataBoundarySuite();
}

async function runConfirmUploadMetadataBoundarySuite() {
  const { Pool } = await import("pg");
  const { getIntakeFileUploadMetadata } = await import("../Backend/kai/db/kaiReadModels.js");
  const { confirmUpload } = await import("../Backend/kai/services/kaiIntakeService.js");

  const DATABASE_URL = process.env.KAI_CONFIRM_UPLOAD_METADATA_BOUNDARY_DATABASE_URL;
  const ORG = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
  const BATCH = "8e426ea1-2be3-4e48-b80f-9783ddbacda0";
  const FILE = "9fe568b1-5c05-4c42-bb1f-6e20de216c7b";
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
    await pool.query("TRUNCATE kai.upload_lifecycle_audit, kai.intake_files");
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
}
