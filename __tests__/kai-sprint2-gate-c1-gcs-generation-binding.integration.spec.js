import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P0_POSTGRES_ADAPTER_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`Gate C-1 integration suite refused a non-loopback KAI_P0_POSTGRES_ADAPTER_DATABASE_URL host: ${host}`);
  }
}

test("Gate C-1 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("Gate C-1 gcs-generation-binding integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runGateC1IntegrationSuite();
}

async function runGateC1IntegrationSuite() {
  const { Client } = await import("pg");
  const { createPostgresUploadLifecycleRepository } = await import("../Backend/kai/upload/postgresUploadLifecycleRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-08T10:00:00.000Z";

  async function withClient(callback) {
    const client = new Client({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false });
    await client.connect();
    try {
      return await callback(client);
    } finally {
      await client.end();
    }
  }

  async function resetTables() {
    await withClient((client) => client.query("TRUNCATE kai.upload_lifecycle_audit, kai.upload_policy_decision_replay, kai.intake_files"));
  }

  async function seedUploadedUnconfirmedFile(fileId, objectVersionId) {
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_files (
         intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, $5, 'sha256', 'uploaded_unconfirmed', $6, $7::timestamptz)`,
      [fileId, BATCH, ORG, `fixture-${fileId}.txt`, "a".repeat(64), objectVersionId, NOW],
    ));
  }

  function repo() {
    return createPostgresUploadLifecycleRepository();
  }

  test("Gate C-1 exposes exactly bindGcsGeneration and resolveGcsGenerationBinding beyond the base contract", async () => {
    await resetTables();
    const keys = Object.keys(repo());
    assert.ok(keys.includes("bindGcsGeneration"));
    assert.ok(keys.includes("resolveGcsGenerationBinding"));
  });

  test("Gate C-1 generation is absent before the lifecycle point at which binding is valid", async () => {
    await resetTables();
    const fileId = "20000000-0000-4000-8000-000000000101";
    await seedUploadedUnconfirmedFile(fileId, "ov_" + "a1".repeat(16));
    const result = await repo().resolveGcsGenerationBinding({ organizationId: ORG, intakeFileId: fileId });
    assert.equal(result.ok, true);
    assert.equal(result.data.gcs_generation, null);
  });

  test("Gate C-1 a valid generation persists exactly once and is immutable once bound", async () => {
    await resetTables();
    const fileId = "20000000-0000-4000-8000-000000000102";
    const objectVersionId = "ov_" + "b2".repeat(16);
    await seedUploadedUnconfirmedFile(fileId, objectVersionId);

    const bindOnce = await repo().bindGcsGeneration({
      organizationId: ORG,
      intakeFileId: fileId,
      objectVersionId,
      gcsGeneration: "1700000000000001",
      now: NOW,
    });
    assert.equal(bindOnce.ok, true);
    assert.equal(bindOnce.data.replayed, false);

    const replay = await repo().bindGcsGeneration({
      organizationId: ORG,
      intakeFileId: fileId,
      objectVersionId,
      gcsGeneration: "1700000000000001",
      now: NOW,
    });
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);

    const changeAttempt = await repo().bindGcsGeneration({
      organizationId: ORG,
      intakeFileId: fileId,
      objectVersionId,
      gcsGeneration: "1700000000000002",
      now: NOW,
    });
    assert.equal(changeAttempt.ok, false);
    assert.equal(changeAttempt.error.code, "conflict_current_state_changed");

    const resolved = await repo().resolveGcsGenerationBinding({ organizationId: ORG, intakeFileId: fileId });
    assert.equal(resolved.data.gcs_generation, "1700000000000001");
  });

  test("Gate C-1 malformed generation is rejected", async () => {
    await resetTables();
    const fileId = "20000000-0000-4000-8000-000000000103";
    const objectVersionId = "ov_" + "c3".repeat(16);
    await seedUploadedUnconfirmedFile(fileId, objectVersionId);

    for (const malformed of ["0", "-5", "abc", "", "01", "9".repeat(21)]) {
      const result = await repo().bindGcsGeneration({
        organizationId: ORG,
        intakeFileId: fileId,
        objectVersionId,
        gcsGeneration: malformed,
        now: NOW,
      });
      assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(malformed)}`);
      assert.equal(result.error.code, "validation_blocker");
    }
  });

  test("Gate C-1 provider-neutral objectVersionId mismatch is rejected", async () => {
    await resetTables();
    const fileId = "20000000-0000-4000-8000-000000000104";
    await seedUploadedUnconfirmedFile(fileId, "ov_" + "d4".repeat(16));

    const result = await repo().bindGcsGeneration({
      organizationId: ORG,
      intakeFileId: fileId,
      objectVersionId: "ov_" + "ff".repeat(16),
      gcsGeneration: "1700000000000003",
      now: NOW,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "conflict_current_state_changed");
  });

  test("Gate C-1 existing Gate A lifecycle transition semantics remain unchanged", async () => {
    await resetTables();
    const fileId = "20000000-0000-4000-8000-000000000105";
    const objectVersionId = "ov_" + "e5".repeat(16);
    await seedUploadedUnconfirmedFile(fileId, objectVersionId);
    await repo().bindGcsGeneration({
      organizationId: ORG,
      intakeFileId: fileId,
      objectVersionId,
      gcsGeneration: "1700000000000004",
      now: NOW,
    });

    const confirmed = await repo().transitionUploadLifecycle({
      organizationId: ORG,
      intakeFileId: fileId,
      expectedUploadState: "uploaded_unconfirmed",
      newUploadState: "confirmed",
      now: "2026-08-08T10:05:00.000Z",
      objectVersionId,
      verifiedChecksum: "a".repeat(64),
      verifiedSizeBytes: 12345,
    });
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.data.record.upload_state, "confirmed");
    assert.equal("gcs_generation" in confirmed.data.record, false);
  });

  test("Gate C-1 ordinary record surfaces never include gcs_generation", async () => {
    await resetTables();
    const fileId = "20000000-0000-4000-8000-000000000106";
    const objectVersionId = "ov_" + "f6".repeat(16);
    await seedUploadedUnconfirmedFile(fileId, objectVersionId);
    await repo().bindGcsGeneration({
      organizationId: ORG,
      intakeFileId: fileId,
      objectVersionId,
      gcsGeneration: "1700000000000005",
      now: NOW,
    });

    const read = await repo().getUploadLifecycle({ organizationId: ORG, intakeFileId: fileId });
    assert.equal(read.ok, true);
    assert.equal("gcs_generation" in read.data.record, false);
  });

  test("Gate C-1 tenant boundary: a mismatched organizationId cannot bind or resolve", async () => {
    await resetTables();
    const fileId = "20000000-0000-4000-8000-000000000107";
    const objectVersionId = "ov_" + "07".repeat(16);
    await seedUploadedUnconfirmedFile(fileId, objectVersionId);
    const OTHER_ORG = "00000000-0000-4000-8000-000000000002";

    const bindResult = await repo().bindGcsGeneration({
      organizationId: OTHER_ORG,
      intakeFileId: fileId,
      objectVersionId,
      gcsGeneration: "1700000000000006",
      now: NOW,
    });
    assert.equal(bindResult.ok, false);
    assert.equal(bindResult.error.code, "not_found");

    const resolveResult = await repo().resolveGcsGenerationBinding({ organizationId: OTHER_ORG, intakeFileId: fileId });
    assert.equal(resolveResult.ok, false);
    assert.equal(resolveResult.error.code, "not_found");
  });
}
