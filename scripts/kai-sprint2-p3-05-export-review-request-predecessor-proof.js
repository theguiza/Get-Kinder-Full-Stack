import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Bounded SQL-level proof for the P3-05 repair: predecessor-preservation on
// upload_lifecycle_audit_gate_a_operation_check and the new fail-closed
// review_queue_items_p1_06_queue_type_check guard, plus the verifier's
// fail-closed behavior. These are exactly the scenarios the app-level
// Backend test suite cannot exercise, because they are about DDL evolution
// across an expanded/absent predecessor, not repository/service behavior.

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p3-05-predecessor-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(64000 + Math.floor(Math.random() * 1000));
const user = process.env.USER || "postgres";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  return result;
}

function runOrThrow(command, args, label) {
  const result = run(command, args);
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${label} failed unexpectedly\n${detail}`);
  }
  return result;
}

function psqlFile(dbName, path) {
  return runOrThrow(psql, ["-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", port, "-U", user, "-d", dbName, "-f", path], `psql -f ${path} against ${dbName}`);
}

function psqlCommand(dbName, sql) {
  return runOrThrow(psql, ["-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", port, "-U", user, "-d", dbName, "-c", sql], `psql -c against ${dbName}`);
}

function psqlFileExpectFailure(dbName, path, label) {
  const result = run(psql, ["-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", port, "-U", user, "-d", dbName, "-f", path]);
  if (result.status === 0) {
    throw new Error(`${label}: expected failure but psql exited 0\n${result.stdout}`);
  }
  return result;
}

function psqlFileCaptureFailure(dbName, path) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", port, "-U", user, "-d", dbName, "-f", path]);
}

const BASE_MIGRATIONS = [
  "scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql",
  "migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql",
  "migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql",
  "migrations/kai_sprint2_p1_parser_run_and_file_profile.sql",
  "migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql",
  "migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql",
  "migrations/kai_sprint2_p1_06_review_queue.sql",
  "migrations/kai_sprint2_p1_07_intake_source_candidate.sql",
  "migrations/kai_sprint2_p1_08_source_promotion.sql",
  "migrations/kai_sprint2_p2_01_evidence_lineage.sql",
  "migrations/kai_sprint2_p2_03_claim_proposal.sql",
  "migrations/kai_sprint2_p2_04_claim_gap_followup.sql",
  "migrations/kai_sprint2_p2_05_conflict_review_candidate.sql",
  "migrations/kai_sprint2_p3_01_generated_content_drafts.sql",
  "migrations/kai_sprint2_p3_04_generated_content_review_completion.sql",
];

function buildBaseline(dbName) {
  runOrThrow(createdb, ["-h", "127.0.0.1", "-p", port, "-U", user, dbName], `createdb ${dbName}`);
  for (const file of BASE_MIGRATIONS) {
    psqlFile(dbName, file);
  }
}

let started = false;
const failures = [];

function check(label, fn) {
  try {
    fn();
    console.log(`PASS: ${label}`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    console.error(`FAIL: ${label}: ${error.message}`);
  }
}

try {
  mkdirSync(socketDir, { recursive: true });
  runOrThrow(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], "initdb");
  runOrThrow(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], "pg_ctl start");
  started = true;

  // --- Scenario A: ordinary validated predecessor -> P3-05 forward PASS ---
  check("A: ordinary predecessor -> P3-05 forward migration PASS", () => {
    buildBaseline("p3_05_scenario_a");
    psqlFile("p3_05_scenario_a", "migrations/kai_sprint2_p3_05_export_review_request.sql");
    psqlFile("p3_05_scenario_a", "scripts/kai-sprint2-p3-05-export-review-request-verifier.sql");
  });

  // --- Scenario B: expanded legitimate predecessor operation contract ---
  check("B: expanded predecessor operation contract -> P3-05 PASS, existing rows/ops preserved, export_review_requested admitted", () => {
    const db = "p3_05_scenario_b";
    buildBaseline(db);

    psqlCommand(db, `
      INSERT INTO kai.intake_files (
        intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
        checksum, hash_algorithm, force_new_version, processing_status, parse_status, file_policy_status
      ) VALUES (
        gen_random_uuid(), gen_random_uuid(), '00000000-0000-4000-8000-000000000001'::uuid,
        'fixture.csv', 'fixture.csv', repeat('a', 64), 'sha256', false, 'confirmed', 'confirmed', 'approved'
      );
    `);

    // Simulate a broader-than-repo-history validated production predecessor by
    // widening upload_lifecycle_audit_gate_a_operation_check to admit two
    // additional operations the migration history never encodes, then insert an
    // audit row using one of them.
    psqlCommand(db, `
      ALTER TABLE kai.upload_lifecycle_audit
        DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check,
        ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check
          CHECK (operation IN (
            'reserve_upload','start_upload','complete_object_version','confirm_upload',
            'block_upload','abandon_upload','expire_upload','policy_decision_compare_and_set',
            'parser_run_recorded','file_profile_persisted','data_dictionary_draft_persisted',
            'intake_sensitivity_profile_persisted','sensitivity_review_queue_item_created',
            'intake_source_candidate_persisted','source_promotion_decision_persisted',
            'evidence_lineage_extracted','claim_proposed','claim_gap_and_followup_generated',
            'conflict_review_candidate_created','generated_content_draft_created',
            'generated_content_review_completed',
            'production_only_operation_alpha','production_only_operation_beta'
          ));
    `);
    psqlCommand(db, `
      INSERT INTO kai.upload_lifecycle_audit (organization_id, intake_file_id, operation, to_state, outcome, metadata)
      SELECT '00000000-0000-4000-8000-000000000001'::uuid, intake_file_id, 'production_only_operation_alpha', 'confirmed', 'success', '{}'::jsonb
        FROM kai.intake_files LIMIT 1;
    `);
    const before = run(psql, ["-h", "127.0.0.1", "-p", port, "-U", user, "-d", db, "-t", "-A", "-c",
      `SELECT count(*) FROM kai.upload_lifecycle_audit WHERE operation = 'production_only_operation_alpha'`]).stdout.trim();
    if (before !== "1") throw new Error(`expected fixture row before migration, got count=${before}`);

    psqlFile(db, "migrations/kai_sprint2_p3_05_export_review_request.sql");
    psqlFile(db, "scripts/kai-sprint2-p3-05-export-review-request-verifier.sql");

    const after = run(psql, ["-h", "127.0.0.1", "-p", port, "-U", user, "-d", db, "-t", "-A", "-c",
      `SELECT count(*) FROM kai.upload_lifecycle_audit WHERE operation = 'production_only_operation_alpha'`]).stdout.trim();
    if (after !== "1") throw new Error(`production-only fixture row was rewritten/removed, count=${after}`);

    // The expanded predecessor operations, plus the P3-04 predecessor, plus the
    // new P3-05 operation must all still be insertable without violating the check.
    psqlCommand(db, `
      INSERT INTO kai.upload_lifecycle_audit (organization_id, intake_file_id, operation, to_state, outcome, metadata)
      SELECT '00000000-0000-4000-8000-000000000001'::uuid, intake_file_id, 'production_only_operation_beta', 'confirmed', 'success', '{}'::jsonb
        FROM kai.intake_files LIMIT 1;
    `);
    psqlCommand(db, `
      INSERT INTO kai.upload_lifecycle_audit (organization_id, intake_file_id, operation, to_state, outcome, metadata)
      SELECT '00000000-0000-4000-8000-000000000001'::uuid, intake_file_id, 'export_review_requested', 'confirmed', 'success',
             '{"contract":"x","organization_id":"x","generated_content_draft_id":"x","review_queue_item_id":"x","requested_export_audience":"internal","actor_id":"x","actor_type":"human","requested_timestamp":"2026-01-01T00:00:00.000Z","validator_key":"x","failed_gates":[]}'::jsonb
        FROM kai.intake_files LIMIT 1;
    `);
  });

  // --- Scenario C: predecessor operation constraint absent/unacceptable -> FAIL CLOSED ---
  check("C: predecessor audit-operation constraint absent -> P3-05 forward migration FAILS CLOSED", () => {
    const db = "p3_05_scenario_c";
    buildBaseline(db);
    psqlCommand(db, `ALTER TABLE kai.upload_lifecycle_audit DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;`);
    const result = psqlFileCaptureFailure(db, "migrations/kai_sprint2_p3_05_export_review_request.sql");
    if (result.status === 0) throw new Error("expected migration to fail closed, but it succeeded");
    if (!/upload_lifecycle_audit_gate_a_operation_check is required/.test(result.stderr)) {
      throw new Error(`unexpected failure reason:\n${result.stderr}`);
    }
    const columnExists = run(psql, ["-h", "127.0.0.1", "-p", port, "-U", user, "-d", db, "-t", "-A", "-c",
      `SELECT count(*) FROM pg_constraint WHERE conname = 'review_queue_items_p3_05_export_review_contract_check'`]).stdout.trim();
    if (columnExists !== "0") throw new Error("P3-05 DDL was created despite the missing predecessor guard failing first");
  });

  // --- Scenario D: predecessor queue_type contract admits export_review -> PASS (already proven by A, re-asserted explicitly) ---
  check("D: predecessor queue_type contract admits export_review -> P3-05 forward migration PASS", () => {
    const db = "p3_05_scenario_d";
    buildBaseline(db);
    const predicate = run(psql, ["-h", "127.0.0.1", "-p", port, "-U", user, "-d", db, "-t", "-A", "-c",
      `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'review_queue_items_p1_06_queue_type_check'`]).stdout;
    if (!predicate.includes("export_review")) throw new Error("fixture assumption violated: predecessor does not mention export_review");
    psqlFile(db, "migrations/kai_sprint2_p3_05_export_review_request.sql");
  });

  // --- Scenario E: predecessor queue_type contract does not admit export_review -> FAILS CLOSED before P3-05 state ---
  check("E: predecessor queue_type contract does not admit export_review -> P3-05 forward migration FAILS CLOSED before any P3-05 state is created", () => {
    const db = "p3_05_scenario_e";
    buildBaseline(db);
    psqlCommand(db, `
      ALTER TABLE kai.review_queue_items
        DROP CONSTRAINT review_queue_items_p1_06_queue_type_check,
        ADD CONSTRAINT review_queue_items_p1_06_queue_type_check
          CHECK (queue_type IN (
            'intake_file_review','source_candidate_review','sensitivity_review',
            'data_dictionary_review','evidence_review','claim_review','client_followup',
            'conflict_resolution','generated_content_review'
          ));
    `);
    const result = psqlFileCaptureFailure(db, "migrations/kai_sprint2_p3_05_export_review_request.sql");
    if (result.status === 0) throw new Error("expected migration to fail closed, but it succeeded");
    if (!/queue_type_check does not admit export_review/.test(result.stderr)) {
      throw new Error(`unexpected failure reason:\n${result.stderr}`);
    }
    const indexExists = run(psql, ["-h", "127.0.0.1", "-p", port, "-U", user, "-d", db, "-t", "-A", "-c",
      `SELECT count(*) FROM pg_indexes WHERE indexname = 'ux_review_queue_items_p3_05_export_review_identity'`]).stdout.trim();
    if (indexExists !== "0") throw new Error("P3-05 unique index was created despite the queue_type guard failing first");
    const checkExists = run(psql, ["-h", "127.0.0.1", "-p", port, "-U", user, "-d", db, "-t", "-A", "-c",
      `SELECT count(*) FROM pg_constraint WHERE conname = 'upload_lifecycle_audit_gate_a_operation_check_p3_05'`]).stdout.trim();
    if (checkExists !== "0") throw new Error("audit-operation evolution ran despite the queue_type guard failing first");
  });

  // --- Verifier fail-closed: a broken post-migration state must be rejected before visible PASS output ---
  check("G: verifier rejects a broken P3-05 state before any visible PASS output", () => {
    const db = "p3_05_scenario_g";
    buildBaseline(db);
    psqlFile(db, "migrations/kai_sprint2_p3_05_export_review_request.sql");
    psqlCommand(db, `DROP INDEX kai.ux_review_queue_items_p3_05_export_review_identity;`);
    const result = psqlFileCaptureFailure(db, "scripts/kai-sprint2-p3-05-export-review-request-verifier.sql");
    if (result.status === 0) throw new Error("expected verifier to fail closed, but it succeeded");
    if (!/verifier failed/.test(result.stderr)) throw new Error(`unexpected failure reason:\n${result.stderr}`);
    if (/\bPASS\b/.test(result.stdout)) {
      throw new Error(`verifier printed a PASS row before/around the failure; visible output was not fully suppressed:\n${result.stdout}`);
    }
  });

  // --- Replay/convergence: re-running the forward migration is idempotent ---
  check("H: replay - re-running the P3-05 forward migration twice converges with no error and an unchanged operation check", () => {
    const db = "p3_05_scenario_h";
    buildBaseline(db);
    psqlFile(db, "migrations/kai_sprint2_p3_05_export_review_request.sql");
    const firstDef = run(psql, ["-h", "127.0.0.1", "-p", port, "-U", user, "-d", db, "-t", "-A", "-c",
      `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'upload_lifecycle_audit_gate_a_operation_check'`]).stdout;
    psqlFile(db, "migrations/kai_sprint2_p3_05_export_review_request.sql");
    const secondDef = run(psql, ["-h", "127.0.0.1", "-p", port, "-U", user, "-d", db, "-t", "-A", "-c",
      `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'upload_lifecycle_audit_gate_a_operation_check'`]).stdout;
    if (firstDef !== secondDef) throw new Error("replay changed the audit-operation check definition");
    psqlFile(db, "scripts/kai-sprint2-p3-05-export-review-request-verifier.sql");
  });

  if (failures.length > 0) {
    console.error(`\n${failures.length} scenario(s) failed:`);
    for (const f of failures) console.error(` - ${f}`);
    process.exitCode = 1;
  } else {
    console.log("\nAll P3-05 predecessor-repair proof scenarios passed.");
  }
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P3-05 predecessor-proof ephemeral PostgreSQL workdir removed: ${workDir}`);
}
