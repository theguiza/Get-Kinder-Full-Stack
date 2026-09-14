import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p14_14_generated_content_type_evolution_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p14-14-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(65000 + Math.floor(Math.random() * 500));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture || options.allowFail ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      DATABASE_URL: sentinelUrl,
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGDATABASE: dbName,
      PGUSER: user,
    },
  });
  if (!options.allowFail && result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(path, options = {}) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], { capture: true, ...options });
}

function psqlScalar(sql, options = {}) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-At", "-d", dbName, "-c", sql], { capture: true, ...options });
}

function assertNoFail(output, label) {
  if (/(^|\s)FAIL(\s|$)/.test(output)) {
    throw new Error(`${label} reported FAIL\n${output}`);
  }
}

async function proveRunnerOwnedTarget() {
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("P14-14 runner refused non-loopback target before connection");
  }
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT version() AS version,
             current_database() AS database_name,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port,
             current_setting('listen_addresses') AS listen_addresses
    `);
    const row = result.rows[0];
    console.log(`P14-14 PostgreSQL version: ${row.version}`);
    if (row.database_name !== dbName) throw new Error("P14-14 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P14-14 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P14-14 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P14-14 runner refused non-loopback listen_addresses");
  } finally {
    await client.end();
  }
}

function constraintStates() {
  return psqlScalar(`
    SELECT string_agg(relname || ':' || conname || ':' || pg_get_constraintdef(c.oid), E'\n' ORDER BY relname, conname)
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND relname IN ('generation_runs', 'generated_content_drafts')
       AND conname IN ('generation_runs_p3_01_content_type_check', 'generated_content_drafts_p3_01_content_type_check')
  `).stdout.trim();
}

const ORG = "00000000-0000-4000-8000-000000000001";

function insertGenerationRun(idempotencyKey, contentType, fingerprintSeed) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", dbName, "-c", `
    INSERT INTO kai.generation_runs (
      organization_id, idempotency_key, request_fingerprint, content_type, requested_audience, created_by_type
    ) VALUES (
      '${ORG}', '${idempotencyKey}', repeat('${fingerprintSeed}', 64), '${contentType}', 'internal', 'system'
    );
  `], { capture: true, allowFail: true });
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();

  // Same organization/engagement foundation the existing P13-01 runner
  // establishes, required transitively by P14-01's generation_runs FK.
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlScalar(
    "ALTER TABLE kai.engagements ADD CONSTRAINT kai_p14_14_engagements_id_org_unique UNIQUE (engagement_id, organization_id);",
  );

  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
  psqlFile("migrations/kai_sprint2_p1_parser_run_and_file_profile.sql");
  psqlFile("migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql");
  psqlFile("migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql");
  psqlFile("migrations/kai_sprint2_p1_06_review_queue.sql");
  psqlFile("migrations/kai_sprint2_p1_07_intake_source_candidate.sql");
  psqlFile("migrations/kai_sprint2_p1_08_source_promotion.sql");
  psqlFile("migrations/kai_sprint2_p2_01_evidence_lineage.sql");
  psqlFile("migrations/kai_sprint2_p2_03_claim_proposal.sql");
  psqlFile("migrations/kai_sprint2_p2_04_claim_gap_followup.sql");
  psqlFile("migrations/kai_sprint2_p2_05_conflict_review_candidate.sql");
  psqlFile("migrations/kai_sprint2_p2_10_coverage_review_decision.sql");
  psqlFile("migrations/kai_sprint2_p3_01_generated_content_drafts.sql");
  psqlFile("migrations/kai_sprint2_p14_01_generation_run_engagement_binding.sql");
  psqlFile("migrations/kai_sprint2_p13_01_impact_narrative_content_type.sql");
  console.log("P14-14 predecessor chain (through P13-01) applied.");

  // --- Pre-migration proof: readiness_assessment/data_gap_memo are real,
  // reproducible drift against the schema as it stands through P13-01. ---
  const preConstraints = constraintStates();
  console.log(`P14-14 pre-migration content_type constraints:\n${preConstraints}`);

  const preDataGapMemo = insertGenerationRun("p14-14-pre-data-gap-memo", "data_gap_memo", "1");
  if (preDataGapMemo.status === 0) {
    throw new Error("P14-14 pre-migration insert of content_type='data_gap_memo' unexpectedly succeeded before the fix migration");
  }
  const preDataGapMemoDetail = [preDataGapMemo.stdout, preDataGapMemo.stderr].filter(Boolean).join("\n");
  if (!preDataGapMemoDetail.includes("23514") || !preDataGapMemoDetail.includes("generation_runs_p3_01_content_type_check")) {
    throw new Error(`P14-14 pre-migration data_gap_memo insert did not fail with the expected SQLSTATE 23514 on generation_runs_p3_01_content_type_check:\n${preDataGapMemoDetail}`);
  }
  console.log(`P14-14 reproduced pre-migration failure (expected):\n${preDataGapMemoDetail}`);

  const preReadiness = insertGenerationRun("p14-14-pre-readiness-assessment", "readiness_assessment", "2");
  if (preReadiness.status === 0) {
    throw new Error("P14-14 pre-migration insert of content_type='readiness_assessment' unexpectedly succeeded before the fix migration");
  }
  const preReadinessDetail = [preReadiness.stdout, preReadiness.stderr].filter(Boolean).join("\n");
  if (!preReadinessDetail.includes("23514") || !preReadinessDetail.includes("generation_runs_p3_01_content_type_check")) {
    throw new Error(`P14-14 pre-migration readiness_assessment insert did not fail with the expected SQLSTATE 23514 on generation_runs_p3_01_content_type_check:\n${preReadinessDetail}`);
  }
  console.log(`P14-14 reproduced pre-migration failure (expected):\n${preReadinessDetail}`);

  // --- Apply the fix migration. ---
  psqlFile("migrations/kai_sprint2_p14_14_generated_content_type_evolution.sql");
  console.log("P14-14 forward migration applied.");

  const postConstraints = constraintStates();
  console.log(`P14-14 post-migration content_type constraints:\n${postConstraints}`);

  const verifierOutput = psqlFile("scripts/kai-sprint2-p14-14-generated-content-type-evolution-verifier.sql").stdout;
  assertNoFail(verifierOutput, "P14-14 verifier");
  console.log(verifierOutput);

  // --- Post-migration proof: all four application content types succeed at
  // kai.generation_runs, and an unknown type is still rejected. ---
  const contentTypes = ["evidence_summary", "impact_narrative", "readiness_assessment", "data_gap_memo"];
  contentTypes.forEach((contentType, index) => {
    const seed = String(3 + index);
    const result = insertGenerationRun(`p14-14-post-${contentType}`, contentType, seed);
    if (result.status !== 0) {
      throw new Error(`P14-14 post-migration insert of content_type='${contentType}' unexpectedly failed:\n${[result.stdout, result.stderr].filter(Boolean).join("\n")}`);
    }
  });
  console.log("P14-14 post-migration: all four application content types accepted at kai.generation_runs.");

  const unknownRunResult = insertGenerationRun("p14-14-post-unknown-type", "not_a_real_type", "9");
  if (unknownRunResult.status === 0) {
    throw new Error("P14-14 post-migration insert of an unknown content_type unexpectedly succeeded at kai.generation_runs");
  }
  const unknownRunDetail = [unknownRunResult.stdout, unknownRunResult.stderr].filter(Boolean).join("\n");
  if (!unknownRunDetail.includes("23514") || !unknownRunDetail.includes("generation_runs_p3_01_content_type_check")) {
    throw new Error(`P14-14 unknown-type insert did not fail with SQLSTATE 23514 on generation_runs_p3_01_content_type_check:\n${unknownRunDetail}`);
  }
  console.log("P14-14 post-migration: unknown content_type rejected at kai.generation_runs.");

  // Now prove the same four types (plus rejection) at
  // kai.generated_content_drafts, each bound to its own generation_run.
  const draftIds = {};
  for (const contentType of contentTypes) {
    const runIdResult = run(psql, ["-v", "ON_ERROR_STOP=1", "-At", "-d", dbName, "-c",
      `SELECT generation_run_id FROM kai.generation_runs WHERE idempotency_key = 'p14-14-post-${contentType}';`], { capture: true });
    const runId = runIdResult.stdout.trim();
    const draftResult = run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", `
      INSERT INTO kai.generated_content_drafts (
        generation_run_id, organization_id, content_type, requested_audience, draft_status, review_status, validator_results, created_by_type
      ) VALUES (
        '${runId}', '${ORG}', '${contentType}', 'internal', 'draft', 'needs_gk_review', '[]'::jsonb, 'system'
      ) RETURNING generated_content_draft_id;
    `], { capture: true, allowFail: true });
    if (draftResult.status !== 0) {
      throw new Error(`P14-14 post-migration insert of content_type='${contentType}' unexpectedly failed at kai.generated_content_drafts:\n${[draftResult.stdout, draftResult.stderr].filter(Boolean).join("\n")}`);
    }
    draftIds[contentType] = draftResult.stdout;
  }
  console.log("P14-14 post-migration: all four application content types accepted at kai.generated_content_drafts.");

  const evidenceSummaryRunIdResult = run(psql, ["-v", "ON_ERROR_STOP=1", "-At", "-d", dbName, "-c",
    `SELECT generation_run_id FROM kai.generation_runs WHERE idempotency_key = 'p14-14-post-evidence_summary';`], { capture: true });
  const evidenceSummaryRunId = evidenceSummaryRunIdResult.stdout.trim();
  const unknownDraftResult = run(psql, ["-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", dbName, "-c", `
    INSERT INTO kai.generated_content_drafts (
      generation_run_id, organization_id, content_type, requested_audience, draft_status, review_status, validator_results, created_by_type
    ) VALUES (
      '${evidenceSummaryRunId}', '${ORG}', 'not_a_real_type', 'internal', 'draft', 'needs_gk_review', '[]'::jsonb, 'system'
    );
  `], { capture: true, allowFail: true });
  if (unknownDraftResult.status === 0) {
    throw new Error("P14-14 post-migration insert of an unknown content_type unexpectedly succeeded at kai.generated_content_drafts");
  }
  const unknownDraftDetail = [unknownDraftResult.stdout, unknownDraftResult.stderr].filter(Boolean).join("\n");
  if (!unknownDraftDetail.includes("23514") || !unknownDraftDetail.includes("generated_content_drafts_p3_01_content_type_check")) {
    throw new Error(`P14-14 unknown-type insert did not fail with SQLSTATE 23514 on generated_content_drafts_p3_01_content_type_check:\n${unknownDraftDetail}`);
  }
  console.log("P14-14 post-migration: unknown content_type rejected at kai.generated_content_drafts.");

  // --- Rollback proof: refused with readiness_assessment/data_gap_memo
  // rows present, then succeeds after they are removed. ---
  const beforeRollbackConstraints = constraintStates();
  const incompatibleRollback = psqlFile("migrations/kai_sprint2_p14_14_generated_content_type_evolution.rollback.sql", { allowFail: true });
  if (incompatibleRollback.status === 0) {
    throw new Error("P14-14 rollback unexpectedly succeeded with synthetic readiness_assessment/data_gap_memo rows present");
  }
  const afterFailedRollbackConstraints = constraintStates();
  if (afterFailedRollbackConstraints !== beforeRollbackConstraints) {
    throw new Error("P14-14 rollback left a partial target constraint transition after incompatible-data failure");
  }
  console.log(`P14-14 incompatible-data rollback failed cleanly; constraints unchanged:\n${afterFailedRollbackConstraints}`);

  run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", `
    DELETE FROM kai.generated_content_drafts WHERE content_type IN ('readiness_assessment', 'data_gap_memo');
    DELETE FROM kai.generation_runs WHERE content_type IN ('readiness_assessment', 'data_gap_memo');
  `], { capture: true });

  psqlFile("migrations/kai_sprint2_p14_14_generated_content_type_evolution.rollback.sql");
  const restoredConstraints = constraintStates();
  if (!restoredConstraints.includes("evidence_summary") || !restoredConstraints.includes("impact_narrative") || restoredConstraints.includes("readiness_assessment") || restoredConstraints.includes("data_gap_memo")) {
    throw new Error(`P14-14 rollback did not restore the P13-01 content_type contract:\n${restoredConstraints}`);
  }
  console.log(`P14-14 compatible clean rollback restored P13-01 constraints:\n${restoredConstraints}`);
  console.log("P14-14 generated-content type-evolution package verification passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P14-14 generated-content type-evolution ephemeral PostgreSQL workdir removed: ${workDir}`);
}
