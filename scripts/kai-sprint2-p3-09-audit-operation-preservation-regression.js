// Production-class regression for the P3-09 export-review-start migration.
//
// Reproduces the actual production failure class exposed when the P3-09
// forward migration replaced kai.upload_lifecycle_audit_gate_a_operation_check
// with a hand-reconstructed static allowlist instead of extending the
// validated predecessor predicate (the pattern P3-04/P3-05/P3-17 use). This
// builds a predecessor database state that legitimately admits one operation
// P3-09's static reconstruction does not enumerate ('evidence_review_completed',
// added out-of-band the same way P3-04/P3-05/P3-17 extend this constraint),
// inserts one real audit row using that operation, then applies the ACTUAL
// current migrations/kai_sprint2_p3_09_export_review_start.sql file.
//
// Before the P3-09 repair: the migration is expected to fail with SQLSTATE
// 23514 against upload_lifecycle_audit_gate_a_operation_check.
// After the P3-09 repair: the migration is expected to succeed, the
// predecessor row must remain untouched and its operation still admitted,
// the new export_review_started operation must be admitted, and an
// unrelated invalid operation must still be rejected.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p3_09_audit_operation_preservation_regression";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p3-09-audit-op-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(65000 + Math.floor(Math.random() * 500));
const user = process.env.USER || "postgres";
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";

const LEGITIMATE_PREDECESSOR_OPERATION = "evidence_review_completed";
const PREDECESSOR_AUDIT_ROW_ID = "30000000-0000-4000-8000-000000000001";
const PREDECESSOR_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PREDECESSOR_INTAKE_FILE_ID = "20000000-0000-4000-8000-000000000001";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: sentinelUrl },
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    const error = new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
    error.detail = detail;
    throw error;
  }
  return result.stdout;
}

function psqlFile(path) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path]);
}

function psqlInline(sql) {
  const file = join(workDir, `inline-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(file, sql);
  return psqlFile(file);
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"]);
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"]);
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName]);

  process.env.PGHOST = "127.0.0.1";
  process.env.PGPORT = port;
  process.env.PGDATABASE = dbName;
  process.env.PGUSER = user;

  // Predecessor chain identical to the P3-09 local-postgres runner, up to
  // and including the real, currently-committed P3-05 migration. This is the
  // exact state the P3-09 forward migration is required to run against.
  for (const file of [
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
    "migrations/kai_sprint2_p3_05_export_review_request.sql",
  ]) {
    psqlFile(file);
  }

  // Legitimately widen the validated predecessor operation predicate by
  // exactly one real, already-shipped operation name
  // ('evidence_review_completed', from kai_sprint2_p2_09_human_review_internal_approval.sql),
  // using the SAME additive NOT VALID / VALIDATE / rename mechanism P3-04,
  // P3-05, and P3-17 use. This represents production reality: the validated
  // predecessor predicate P3-09 will actually encounter can admit operations
  // beyond the ones enumerated in P3-09's own file.
  psqlInline(`
BEGIN;
DO $$
DECLARE
  existing_predicate text;
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO existing_predicate
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
     AND c.convalidated;

  IF existing_predicate IS NULL THEN
    RAISE EXCEPTION 'regression setup requires a validated predecessor upload_lifecycle_audit_gate_a_operation_check';
  END IF;

  EXECUTE format(
    'ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_regsetup CHECK ((%s) OR operation = ''${LEGITIMATE_PREDECESSOR_OPERATION}'') NOT VALID',
    existing_predicate
  );
  ALTER TABLE kai.upload_lifecycle_audit
    VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_regsetup;
  ALTER TABLE kai.upload_lifecycle_audit
    DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
  ALTER TABLE kai.upload_lifecycle_audit
    RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_regsetup
    TO upload_lifecycle_audit_gate_a_operation_check;
END $$;
COMMIT;
`);

  // One real, legitimate predecessor audit row using that operation. Every
  // other applicable audit constraint (state/outcome/metadata-object) is
  // satisfied so the only thing under test is the operation allowlist.
  psqlInline(`
INSERT INTO kai.upload_lifecycle_audit (
  upload_lifecycle_audit_id, organization_id, intake_file_id, operation,
  from_state, to_state, outcome, metadata
) VALUES (
  '${PREDECESSOR_AUDIT_ROW_ID}'::uuid, '${PREDECESSOR_ORGANIZATION_ID}'::uuid, '${PREDECESSOR_INTAKE_FILE_ID}'::uuid,
  '${LEGITIMATE_PREDECESSOR_OPERATION}', 'confirmed', 'confirmed', 'success', '{}'::jsonb
);
`);

  let migrationError = null;
  try {
    psqlFile("migrations/kai_sprint2_p3_09_export_review_start.sql");
  } catch (error) {
    migrationError = error;
  }

  if (migrationError) {
    const detail = migrationError.detail || migrationError.message;
    const isExpectedFailureClass = /check constraint "upload_lifecycle_audit_gate_a_operation_check" of relation "upload_lifecycle_audit" is violated by some row/.test(detail);
    console.log(`PRODUCTION_CLASS_REGRESSION_RESULT: FAIL${isExpectedFailureClass ? " (expected failure class: 23514 on upload_lifecycle_audit_gate_a_operation_check)" : " (UNEXPECTED failure class)"}`);
    console.log(detail);
    process.exitCode = isExpectedFailureClass ? 1 : 2;
  } else {
    console.log("PRODUCTION_CLASS_REGRESSION_RESULT: PASS (P3-09 migration applied successfully)");

    const predecessorRow = psqlInline(`
      SELECT operation, from_state, to_state, outcome, metadata::text
        FROM kai.upload_lifecycle_audit
       WHERE upload_lifecycle_audit_id = '${PREDECESSOR_AUDIT_ROW_ID}'::uuid;
    `);
    const predecessorRowUnchanged = predecessorRow.includes(LEGITIMATE_PREDECESSOR_OPERATION)
      && predecessorRow.includes("confirmed")
      && predecessorRow.includes("success");
    console.log(`predecessor_row_unchanged: ${predecessorRowUnchanged ? "PASS" : "FAIL"}`);

    let predecessorOperationStillAdmitted = true;
    try {
      psqlInline(`
        INSERT INTO kai.upload_lifecycle_audit (
          organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
        ) VALUES (
          '${PREDECESSOR_ORGANIZATION_ID}'::uuid, '${PREDECESSOR_INTAKE_FILE_ID}'::uuid,
          '${LEGITIMATE_PREDECESSOR_OPERATION}', 'confirmed', 'confirmed', 'success', '{}'::jsonb
        );
      `);
    } catch (error) {
      predecessorOperationStillAdmitted = false;
    }
    console.log(`predecessor_operation_still_admitted: ${predecessorOperationStillAdmitted ? "PASS" : "FAIL"}`);

    let newOperationAdmitted = true;
    const exportReviewStartedMetadata = JSON.stringify({
      contract: "kai.export_review_start.v1",
      organization_id: PREDECESSOR_ORGANIZATION_ID,
      generated_content_draft_id: "40000000-0000-4000-8000-000000000001",
      review_queue_item_id: "40000000-0000-4000-8000-000000000002",
      actor_id: "40000000-0000-4000-8000-000000000003",
      actor_type: "human",
      expected_updated_at: "2026-08-06T09:00:00.000Z",
      requested_start_timestamp: "2026-08-06T10:00:00.000Z",
      previous_queue_status: "open",
      resulting_queue_status: "in_progress",
      previous_review_status: "needs_gk_review",
      resulting_review_status: "needs_gk_review",
      validator_keys: [],
    }).replace(/'/g, "''");
    try {
      psqlInline(`
        INSERT INTO kai.upload_lifecycle_audit (
          organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
        ) VALUES (
          '${PREDECESSOR_ORGANIZATION_ID}'::uuid, '${PREDECESSOR_INTAKE_FILE_ID}'::uuid,
          'export_review_started', 'confirmed', 'confirmed', 'success', '${exportReviewStartedMetadata}'::jsonb
        );
      `);
    } catch (error) {
      newOperationAdmitted = false;
    }
    console.log(`new_operation_admitted: ${newOperationAdmitted ? "PASS" : "FAIL"}`);

    let invalidOperationStillRejected = false;
    try {
      psqlInline(`
        INSERT INTO kai.upload_lifecycle_audit (
          organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
        ) VALUES (
          '${PREDECESSOR_ORGANIZATION_ID}'::uuid, '${PREDECESSOR_INTAKE_FILE_ID}'::uuid,
          'not_a_real_operation', 'confirmed', 'confirmed', 'success', '{}'::jsonb
        );
      `);
    } catch (error) {
      invalidOperationStillRejected = /violates check constraint "upload_lifecycle_audit_gate_a_operation_check"/.test(error.detail || error.message);
    }
    console.log(`invalid_operation_still_rejected: ${invalidOperationStillRejected ? "PASS" : "FAIL"}`);

    const constraintValidated = psqlInline(`
      SELECT convalidated::text
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai'
         AND r.relname = 'upload_lifecycle_audit'
         AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check';
    `);
    const isValidated = /^\s*true\s*$/m.test(constraintValidated);
    console.log(`resulting_constraint_validated: ${isValidated ? "PASS" : "FAIL"}`);

    const allPass = predecessorRowUnchanged && predecessorOperationStillAdmitted && newOperationAdmitted && invalidOperationStillRejected && isValidated;
    process.exitCode = allPass ? 0 : 3;
  }
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P3-09 audit-operation-preservation regression ephemeral PostgreSQL workdir removed: ${workDir}`);
}
