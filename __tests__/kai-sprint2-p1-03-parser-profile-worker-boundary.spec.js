import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import {
  createParserProfileWorkerOrchestration,
  __parserProfileWorkerContract,
  __parserProfileWorkerTestables,
} from "../Backend/kai/parsing/parserProfileWorkerOrchestration.js";
import { __parserRunRepositoryContract } from "../Backend/kai/parsing/postgresParserRunRepository.js";

const ORCHESTRATION_PATH = "Backend/kai/parsing/parserProfileWorkerOrchestration.js";
const REPOSITORY_PATH = "Backend/kai/parsing/postgresParserRunRepository.js";
const MIGRATION_PATH = "migrations/kai_sprint2_p1_parser_run_and_file_profile.sql";

const orchestrationSource = readFileSync(new URL(`../${ORCHESTRATION_PATH}`, import.meta.url), "utf8");
const repositorySource = readFileSync(new URL(`../${REPOSITORY_PATH}`, import.meta.url), "utf8");
const migrationSource = readFileSync(new URL(`../${MIGRATION_PATH}`, import.meta.url), "utf8");
const kaiBarrelSource = readFileSync(new URL("../Backend/kai/index.js", import.meta.url), "utf8");

const ORG = "00000000-0000-4000-8000-000000000001";
const FILE = "20000000-0000-4000-8000-000000000001";
const CHECKSUM = "a".repeat(64);
const NOW = "2026-08-04T10:00:00.000Z";

function trustedFileFacts(overrides = {}) {
  return {
    organizationId: ORG,
    intakeFileId: FILE,
    objectVersionId: "object-version-1",
    checksum: CHECKSUM,
    verifiedSizeBytes: 11,
    declaredMime: "text/plain",
    extension: ".txt",
    ...overrides,
  };
}

function createProbes() {
  const repositoryCalls = [];
  const byteReads = [];
  const auditPrepares = [];
  return {
    repositoryCalls,
    byteReads,
    auditPrepares,
    parserRunRepository: {
      async ensureQueuedParserRun(input) {
        repositoryCalls.push(["ensureQueuedParserRun", input]);
        return { ok: true, data: { run: null, replayed: false }, error: null };
      },
      async claimQueuedParserRun(input) {
        repositoryCalls.push(["claimQueuedParserRun", input]);
        return { ok: true, data: { run: { parser_run_id: "run-1" }, claimed: true }, error: null };
      },
      async completeParserRunWithProfile(input) {
        repositoryCalls.push(["completeParserRunWithProfile", input]);
        return { ok: true, data: { run: null, replayed: false }, error: null };
      },
      async failParserRunSafely(input) {
        repositoryCalls.push(["failParserRunSafely", input]);
        return { ok: true, data: { run: null, replayed: false }, error: null };
      },
      async requeueFailedParserRunForRetry(input) {
        repositoryCalls.push(["requeueFailedParserRunForRetry", input]);
        return { ok: true, data: { run: null, requeued: true, requires_manual_review: false }, error: null };
      },
    },
    objectVersionByteSource: {
      async readObjectVersion(input) {
        byteReads.push(input);
        return { ok: true, data: { object_version_id: input.objectVersionId, size_bytes: 0, bytes: new Uint8Array(0) } };
      },
    },
    metadataOnlyAudit: {
      prepareMetadataOnlyAudit(input) {
        auditPrepares.push(input);
        return { ok: true, publish() {} };
      },
    },
  };
}

test("P1-03 disabled KAI_SPRINT2_ENABLED returns the canonical disabled result with zero claims, writes, byte reads, profiler calls, or audit writes", async () => {
  for (const env of [{}, { KAI_SPRINT2_ENABLED: "false" }, { KAI_SPRINT2_ENABLED: "0" }]) {
    const probes = createProbes();
    const worker = createParserProfileWorkerOrchestration({
      parserRunRepository: probes.parserRunRepository,
      objectVersionByteSource: probes.objectVersionByteSource,
      env,
    });

    const queued = await worker.queueParserProfileWork({ trustedFileFacts: trustedFileFacts(), now: NOW });
    const ran = await worker.runQueuedParserProfileWork({
      trustedFileFacts: trustedFileFacts(),
      now: NOW,
      metadataOnlyAudit: probes.metadataOnlyAudit,
    });
    const retried = await worker.retryParserProfileWork({
      trustedFileFacts: trustedFileFacts(),
      now: NOW,
      metadataOnlyAudit: probes.metadataOnlyAudit,
    });

    for (const result of [queued, ran, retried]) {
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "feature_disabled");
      assert.equal(result.error.status, 403);
    }
    assert.deepEqual(probes.repositoryCalls, []);
    assert.deepEqual(probes.byteReads, []);
    assert.deepEqual(probes.auditPrepares, []);
  }
});

test("P1-03 orchestration contains no SQL, no database pool import, and no route, listener, scheduler, or startup wiring", () => {
  assert.doesNotMatch(orchestrationSource, /\bfrom\s+["'][^"']*db\/kaiDb\.js["']/);
  assert.doesNotMatch(orchestrationSource, /\bfrom\s+["'][^"']*db\/pg\.js["']/);
  assert.doesNotMatch(orchestrationSource, /\bfrom\s+["']pg["']/);
  assert.doesNotMatch(orchestrationSource, /\b(SELECT|INSERT INTO|UPDATE\s+kai\.|DELETE FROM|BEGIN;|COMMIT;|FOR UPDATE|SKIP LOCKED|ON CONFLICT)\b/);
  assert.doesNotMatch(orchestrationSource, /withTransaction|\.query\(/);
  assert.doesNotMatch(orchestrationSource, /express|Router|app\.(get|post|patch|put|delete)|addListener|\.on\(|setInterval|setTimeout|cron|process\.on/);
  assert.doesNotMatch(orchestrationSource, /kai\.[a-z_]+/);
});

test("P1-03 repository keeps SQL and row locking inside the authorized adapter and reuses only existing audit vocabulary", () => {
  assert.match(repositorySource, /import \{ withTransaction \} from "\.\.\/db\/kaiDb\.js";/);
  assert.match(repositorySource, /FOR UPDATE OF r/);
  assert.match(repositorySource, /SKIP LOCKED/);
  assert.match(repositorySource, /ON CONFLICT ON CONSTRAINT intake_parser_runs_p1_identity_unique DO NOTHING/);
  assert.match(repositorySource, /encode\(digest\(\$7::jsonb::text, 'sha256'\), 'hex'\)/);

  const auditOperations = new Set(
    [...repositorySource.matchAll(/operation\s*=\s*"([a-z_]+)"|_AUDIT_OPERATION = "([a-z_]+)"/g)]
      .map((match) => match[1] || match[2]),
  );
  assert.deepEqual([...auditOperations].sort(), ["file_profile_persisted", "parser_run_recorded"]);
  assert.match(migrationSource, /'parser_run_recorded'/);
  assert.match(migrationSource, /'file_profile_persisted'/);

  for (const forbidden of ["CREATE TABLE", "ALTER TABLE", "CREATE INDEX", "DROP TABLE", "CREATE SCHEMA"]) {
    assert.equal(repositorySource.includes(forbidden), false, forbidden);
  }
  for (const forbidden of [
    "kai.intake_sensitivity",
    "kai.intake_data_dictionar",
    "kai.review_queue",
    "kai.source",
    "kai.evidence",
    "kai.claims",
  ]) {
    assert.equal(repositorySource.includes(forbidden), false, forbidden);
  }

  const referencedTables = new Set(
    [...repositorySource.matchAll(/kai\.([a-z_]+)/g)].map((match) => match[1]),
  );
  assert.deepEqual([...referencedTables].sort(), [
    "intake_file_profiles",
    "intake_files",
    "intake_parser_runs",
    "upload_lifecycle_audit",
  ]);
});

test("P1-03 audit metadata keys exactly match the already-installed P1-02 audit metadata contract", () => {
  const requiredKeys = (operation) => {
    const branch = migrationSource.split(`operation <> '${operation}'`)[1].split("      )")[0];
    return [...branch.matchAll(/(?<!NOT )metadata \? '([a-z0-9_]+)'/g)].map((match) => match[1]).sort();
  };
  const builderKeys = (builderName) => {
    const body = repositorySource.split(`function ${builderName}(`)[1].split("\n}")[0];
    return [...body.matchAll(/^\s{4}([a-z0-9_]+):/gm)].map((match) => match[1]).sort();
  };

  assert.deepEqual(builderKeys("buildParserRunAuditMetadata"), requiredKeys("parser_run_recorded"));
  assert.deepEqual(builderKeys("buildFileProfileAuditMetadata"), requiredKeys("file_profile_persisted"));
  assert.equal(__parserRunRepositoryContract.PARSER_RUN_AUDIT_OPERATION, "parser_run_recorded");
  assert.equal(__parserRunRepositoryContract.FILE_PROFILE_AUDIT_OPERATION, "file_profile_persisted");
  assert.equal(__parserRunRepositoryContract.PARSER_RUN_AUDIT_CONTRACT, "p1_parser_run_and_file_profile_v1");
  assert.equal(__parserRunRepositoryContract.PARSER_RUN_AUDIT_VALIDATOR_KEY, "VAL-KAI-P1-02-001");
  assert.equal(__parserRunRepositoryContract.MAX_PARSER_RETRY_COUNT, 3);
  assert.deepEqual(__parserRunRepositoryContract.PARSER_STATUSES, [
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
  ]);
});

test("P1-03 adds no barrel export, no production composition, and no schema change", () => {
  assert.equal(kaiBarrelSource.includes("parsing/"), false);
  assert.equal(kaiBarrelSource.includes("parserProfileWorkerOrchestration"), false);
  assert.equal(kaiBarrelSource.includes("postgresParserRunRepository"), false);

  const migrationFiles = readdirSync(new URL("../migrations", import.meta.url));
  assert.equal(migrationFiles.some((name) => /p1_03|p1-03/.test(name)), false);
  assert.equal(migrationFiles.includes("kai_sprint2_p1_parser_run_and_file_profile.sql"), true);
});

test("P1-03 registry routes exactly the five authorized deterministic profilers and derives no new parser", () => {
  assert.deepEqual(Object.keys(__parserProfileWorkerContract.PARSER_REGISTRY).sort(), [
    ".csv",
    ".md",
    ".pdf",
    ".txt",
    ".xlsx",
  ]);
  for (const extension of [".csv", ".xlsx", ".md", ".txt"]) {
    assert.deepEqual(
      __parserProfileWorkerContract.PARSER_REGISTRY[extension],
      __parserProfileWorkerContract.LOCAL_PROFILING_KERNEL_PARSER,
    );
  }
  assert.deepEqual(
    __parserProfileWorkerContract.PARSER_REGISTRY[".pdf"],
    __parserProfileWorkerContract.PDF_PROFILING_WORKER_PARSER,
  );
  assert.match(orchestrationSource, /import \{ profileLocalTrustedFile \} from "\.\.\/profiling\/localProfilingKernel\.js";/);
  assert.match(
    orchestrationSource,
    /import \{ runPdfProfilingWorkerBoundary \} from "\.\.\/validators\/pdfAssessorWorkerBoundary\.js";/,
  );
});

test("P1-03 safe failure facts reject unsafe codes and messages before they can reach persistence", () => {
  const { safeErrorCode, safeErrorMessage, profilerOutcome } = __parserProfileWorkerTestables;
  assert.equal(safeErrorCode("pdf_no_extractable_text"), "pdf_no_extractable_text");
  assert.equal(safeErrorCode("Bad Code With Spaces"), "safe_parser_error");
  assert.equal(safeErrorCode(undefined), "safe_parser_error");
  assert.equal(
    safeErrorMessage("Local profiling could not safely parse this file."),
    "Local profiling could not safely parse this file.",
  );
  for (const unsafe of [
    "failed reading https://example.invalid/private",
    "failed reading /Users/mikewoz/private.csv",
    "bearer token rejected",
    "Error: boom\n  at Object.<anonymous>",
  ]) {
    assert.equal(safeErrorMessage(unsafe), "Deterministic profiling could not safely profile this file.");
  }

  const notProfilable = profilerOutcome({ status: "not_profilable", format: "pdf", reason: "pdf_no_extractable_text" });
  assert.equal(notProfilable.profiled, false);
  assert.equal(notProfilable.errorCode, "pdf_no_extractable_text");
  assert.equal(notProfilable.profile, undefined);

  const failed = profilerOutcome({
    status: "failed",
    format: "csv",
    error: { category: "safe_parser_error", safe_message: "Local profiling could not safely parse this file." },
  });
  assert.equal(failed.profiled, false);
  assert.equal(failed.errorCode, "safe_parser_error");
  assert.equal(failed.profile, undefined);

  const profiled = profilerOutcome({ status: "profiled", format: "txt" });
  assert.equal(profiled.profiled, true);
  assert.equal(profiled.profile.status, "profiled");
});

test("P1-03 orchestration requires injected persistence and byte-source seams and selects no repository itself", () => {
  assert.throws(() => createParserProfileWorkerOrchestration(), TypeError);
  assert.throws(() => createParserProfileWorkerOrchestration({ parserRunRepository: {} }), TypeError);
  assert.throws(
    () => createParserProfileWorkerOrchestration({ parserRunRepository: createProbes().parserRunRepository }),
    TypeError,
  );
  assert.equal(orchestrationSource.includes("createPostgresParserRunRepository"), false);
  assert.equal(orchestrationSource.includes("localDevStorageAdapter"), false);
});
