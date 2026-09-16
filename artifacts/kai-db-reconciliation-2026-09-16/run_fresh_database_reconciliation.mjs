import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const outDir = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_db_reconciliation_20260916";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-db-reconciliation-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(61000 + Math.floor(Math.random() * 2000));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";

const constructionPath = [
  { kind: "bootstrap", path: "scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql" },
  { kind: "bootstrap", path: "scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-converge.sql" },
  { kind: "bootstrap", path: "scripts/kai-sprint2-package-4-impact-library-engagement-funder-requirements-auth-bootstrap-synthetic-schema.sql" },
  { kind: "bootstrap", path: "scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_gate_a_p0_upload_lifecycle_enforcement_forward_repair.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_gate_a_p0_required_index_forward_repair.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p1_parser_run_and_file_profile.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p1_06_review_queue.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p1_07_intake_source_candidate.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p1_08_source_promotion.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_b1a_02_phase5_allowed_use_decision_ledger.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p2_01_evidence_lineage.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p2_03_claim_proposal.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p2_04_claim_gap_followup.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p2_05_conflict_review_candidate.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p2_09_human_review_internal_approval.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p2_10_coverage_review_decision.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p2_11_client_followup_completion.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p2_12_human_review_decision_ledger.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p2_10_funder_coverage_authority.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p2_10_public_coverage_authority.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_a1_1_impact_outcome_context.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_a1_2_impact_evaluation_framework_and_criteria.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_a1_3_impact_evaluations_and_results.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_a1_4_impact_evaluation_result_provenance_links.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_b1_1_baseline_impact_requirements.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_b1_3_accepted_catalogue_persistence.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_package_2a_engagement_requirement_sets_authority.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_c2_1_requirement_assessment_persistence.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_c3_a3_requirement_assessment_decision_gap_provenance.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_c3_a4_requirement_assessment_provenance_extension.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p3_01_generated_content_drafts.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p13_01_impact_narrative_content_type.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p14_01_generation_run_engagement_binding.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p14_14_generated_content_type_evolution.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p3_04_generated_content_review_completion.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_generated_content_review_start_audit_contract.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p3_05_export_review_request.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p3_09_export_review_start.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p3_13_export_review_completion.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p14_10_review_queue_target_object_type_repair.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p3_16_export_candidate_foundation.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p14_15_export_candidate_content_type_evolution.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p3_17_human_authority_decision_ledger.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p3_17_authority_audit_gate_a_operation_repair.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p3_19_export_manifest_foundation.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p3_20_export_manifest_review_binding.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p14_02_grant_response_packet_export_identity_foundation.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p14_03_grant_response_packet_export_candidate_foundation.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p14_05_grant_response_packet_export_review_binding.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p14_07_b1_grant_response_packet_human_authority_decision_ledger.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_p14_08_a_grant_response_packet_export_manifest_foundation.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_br_02_board_reporting_candidate_foundation.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_br_03a_board_reporting_candidate_review_request.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_br_03b_board_reporting_candidate_review_lifecycle.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_br_04_board_reporting_candidate_human_authority_decision_ledger.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_board_reporting_candidate_export_manifest_foundation.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_gate_c1_gcs_generation_binding.sql" },
  { kind: "migration", path: "migrations/kai_sprint2_gk_organization_tenant_binding.sql" }
];

const verificationPath = [
  "scripts/kai-sprint2-gate-a-verifier.sql",
  "scripts/kai-sprint2-gate-a-upload-lifecycle-enforcement-repair-verifier.sql",
  "scripts/kai-sprint2-gate-a-required-index-verifier.sql",
  "scripts/kai-sprint2-p1-parser-run-file-profile-verifier.sql",
  "scripts/kai-sprint2-p1-04-data-dictionary-quality-verifier.sql",
  "scripts/kai-sprint2-p1-05-intake-sensitivity-profile-verifier.sql",
  "scripts/kai-sprint2-p1-06-review-queue-verifier.sql",
  "scripts/kai-sprint2-p1-07-source-candidate-verifier.sql",
  "scripts/kai-sprint2-p1-08-source-promotion-verifier.sql",
  "scripts/kai-sprint2-p2-01-evidence-lineage-verifier.sql",
  "scripts/kai-sprint2-p2-03-claim-proposal-verifier.sql",
  "scripts/kai-sprint2-p2-04-claim-gap-followup-verifier.sql",
  "scripts/kai-sprint2-p2-05-conflict-review-candidate-verifier.sql",
  "scripts/kai-sprint2-p2-09-human-review-verifier.sql",
  "scripts/kai-sprint2-p2-10-coverage-review-decision-verifier.sql",
  "scripts/kai-sprint2-p2-11-client-followup-completion-verifier.sql",
  "scripts/kai-sprint2-p2-12-human-review-decision-ledger-verifier.sql",
  "scripts/kai-sprint2-p3-01-generated-content-drafts-verifier.sql",
  "scripts/kai-sprint2-p13-01-impact-narrative-content-type-verifier.sql",
  "scripts/kai-sprint2-p14-01-generation-run-engagement-binding-verifier.sql",
  "scripts/kai-sprint2-p14-14-generated-content-type-evolution-verifier.sql",
  "scripts/kai-sprint2-generated-content-review-start-audit-contract-verifier.sql",
  "scripts/kai-sprint2-p3-04-generated-content-review-completion-verifier.sql",
  "scripts/kai-sprint2-p3-05-export-review-request-verifier.sql",
  "scripts/kai-sprint2-p3-09-export-review-start-verifier.sql",
  "scripts/kai-sprint2-p3-13-export-review-completion-verifier.sql",
  "scripts/kai-sprint2-p14-10-review-queue-target-object-type-repair-verifier.sql",
  "scripts/kai-sprint2-p3-16-export-candidate-foundation-verifier.sql",
  "scripts/kai-sprint2-p14-15-export-candidate-content-type-evolution-verifier.sql",
  "scripts/kai-sprint2-p3-17-human-authority-decision-ledger-verifier.sql",
  "scripts/kai-sprint2-p3-19-export-manifest-foundation-verifier.sql",
  "scripts/kai-sprint2-p3-20-export-manifest-review-binding-verifier.sql",
  "scripts/kai-sprint2-p14-02-grant-response-packet-export-identity-foundation-verifier.sql",
  "scripts/kai-sprint2-p14-03-grant-response-packet-export-candidate-foundation-verifier.sql",
  "scripts/kai-sprint2-p14-05-grant-response-packet-export-review-binding-verifier.sql",
  "scripts/kai-sprint2-p14-07-b1-grant-response-packet-human-authority-decision-ledger-verifier.sql",
  "scripts/kai-sprint2-p14-08-a-grant-response-packet-export-manifest-foundation-verifier.sql",
  "scripts/kai-sprint2-br-02-board-reporting-candidate-foundation-verifier.sql",
  "scripts/kai-sprint2-br-03a-board-reporting-candidate-review-request-verifier.sql",
  "scripts/kai-sprint2-br-03b-board-reporting-candidate-review-lifecycle-verifier.sql",
  "scripts/kai-sprint2-br-04-board-reporting-candidate-human-authority-decision-ledger-verifier.sql",
  "scripts/kai-sprint2-board-reporting-candidate-export-manifest-foundation-verifier.sql",
  "scripts/kai-sprint2-gate-c1-gcs-generation-binding-verifier.sql",
  "scripts/kai-sprint2-gk-organization-tenant-binding-verifier.sql"
].filter((path) => existsSync(join(repoRoot, path)));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DATABASE_URL: sentinelUrl,
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGDATABASE: dbName,
      PGUSER: user,
    },
  });
  return result;
}

function applySql(path) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path]);
}

function psqlCsv(path) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-q", "--csv", "-d", dbName, "-f", path]);
}

function psqlScalar(sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-At", "-d", dbName, "-c", sql]).stdout.trim();
}

function sanitizeResult(result) {
  return {
    status: result.status,
    signal: result.signal,
    stdout_tail: (result.stdout || "").slice(-4000),
    stderr_tail: (result.stderr || "").slice(-4000),
  };
}

async function proveEmptyAndLoopback() {
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    const target = await client.query(`
      SELECT current_database() AS database_name,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port,
             current_setting('listen_addresses') AS listen_addresses,
             current_setting('server_version') AS server_version
    `);
    const objects = await client.query(`
      SELECT count(*)::int AS object_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'kai'
    `);
    return { target: target.rows[0], initial_kai_object_count: objects.rows[0].object_count };
  } finally {
    await client.end();
  }
}

async function introspectSchema() {
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    const query = async (sql) => (await client.query(sql)).rows;
    return {
      tables: await query(`
        SELECT c.relname AS name, c.relkind AS kind
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'kai' AND c.relkind IN ('r','p')
        ORDER BY c.relname
      `),
      columns: await query(`
        SELECT c.relname AS table_name, a.attnum, a.attname AS column_name,
               pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
               a.attnotnull AS not_null, a.attidentity AS identity_kind,
               a.attgenerated AS generated_kind,
               pg_get_expr(ad.adbin, ad.adrelid) AS default
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE n.nspname = 'kai' AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY c.relname, a.attnum
      `),
      constraints: await query(`
        SELECT c.relname AS table_name, con.conname AS name, con.contype AS type,
               pg_get_constraintdef(con.oid, true) AS definition, con.convalidated AS validated
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'kai'
        ORDER BY c.relname, con.contype, con.conname
      `),
      indexes: await query(`
        SELECT tablename AS table_name, indexname AS name, indexdef AS definition
        FROM pg_indexes
        WHERE schemaname = 'kai'
        ORDER BY tablename, indexname
      `),
      functions: await query(`
        SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments,
               pg_get_function_result(p.oid) AS result_type,
               p.provolatile AS volatility,
               regexp_replace(pg_get_functiondef(p.oid), '\\\\s+', ' ', 'g') AS normalized_definition
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'kai'
        ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
      `),
      triggers: await query(`
        SELECT c.relname AS table_name, t.tgname AS name,
               pg_get_triggerdef(t.oid, true) AS definition, t.tgenabled AS enabled
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'kai' AND NOT t.tgisinternal
        ORDER BY c.relname, t.tgname
      `),
      types: await query(`
        SELECT t.typname AS name, t.typtype AS kind, e.enumlabel AS enum_label, e.enumsortorder AS enum_sort_order
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        LEFT JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = 'kai' AND t.typtype IN ('e','d','c')
        ORDER BY t.typname, e.enumsortorder NULLS LAST
      `),
      sequences: await query(`
        SELECT sequence_name, data_type, start_value, minimum_value, maximum_value, increment, cycle_option
        FROM information_schema.sequences
        WHERE sequence_schema = 'kai'
        ORDER BY sequence_name
      `),
      views: await query(`
        SELECT schemaname AS schema_name, viewname AS name, regexp_replace(definition, '\\\\s+', ' ', 'g') AS definition
        FROM pg_views
        WHERE schemaname = 'kai'
        ORDER BY viewname
      `),
    };
  } finally {
    await client.end();
  }
}

const report = {
  generated_at: "2026-09-16",
  dbName,
  target: "runner-owned loopback disposable PostgreSQL",
  binDir,
  constructionPath,
  verificationPath,
  applied: [],
  verifiers: [],
  zero_build_result: "NOT_RUN",
  first_failure: null,
  expected_executable_schema: null,
};

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  let result = run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"]);
  if (result.status !== 0) throw new Error(`initdb failed\n${result.stderr}`);
  result = run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"]);
  if (result.status !== 0) throw new Error(`pg_ctl start failed\n${result.stderr}\n${existsSync(logFile) ? readFileSync(logFile, "utf8") : ""}`);
  started = true;
  result = run(createdb, ["-h", "127.0.0.1", "-p", port, dbName]);
  if (result.status !== 0) throw new Error(`createdb failed\n${result.stderr}`);

  report.preflight = await proveEmptyAndLoopback();

  for (const step of constructionPath) {
    const result = applySql(step.path);
    const appliedStep = { ...step, result: sanitizeResult(result) };
    report.applied.push(appliedStep);
    if (result.status !== 0) {
      report.zero_build_result = "FAIL";
      report.first_failure = appliedStep;
      break;
    }
  }

  if (!report.first_failure) {
    report.expected_executable_schema = await introspectSchema();
    writeFileSync(join(outDir, "EXPECTED_EXECUTABLE_SCHEMA.json"), JSON.stringify(report.expected_executable_schema, null, 2) + "\n");
    const summary = [
      "# EXPECTED_EXECUTABLE_SCHEMA summary",
      "",
      `tables: ${report.expected_executable_schema.tables.length}`,
      `columns: ${report.expected_executable_schema.columns.length}`,
      `constraints: ${report.expected_executable_schema.constraints.length}`,
      `indexes: ${report.expected_executable_schema.indexes.length}`,
      `functions: ${report.expected_executable_schema.functions.length}`,
      `triggers: ${report.expected_executable_schema.triggers.length}`,
      `types: ${report.expected_executable_schema.types.length}`,
      `sequences: ${report.expected_executable_schema.sequences.length}`,
      `views: ${report.expected_executable_schema.views.length}`,
    ];
    writeFileSync(join(outDir, "EXPECTED_EXECUTABLE_SCHEMA.summary.md"), summary.join("\n") + "\n");

    for (const path of verificationPath) {
      const result = psqlCsv(path);
      const stdout = result.stdout || "";
      const lines = stdout.trim().split("\n").filter(Boolean);
      const header = (lines[0] || "").split(",");
      const statusIndex = header.indexOf("status");
      const statuses = statusIndex >= 0
        ? lines.slice(1).map((line) => line.split(",")[statusIndex]).filter(Boolean)
        : [];
      const accepted = result.status === 0 && statuses.length > 0 && statuses.every((status) => status === "PASS");
      const verifier = { path, result: sanitizeResult(result), row_count: Math.max(lines.length - 1, 0), accepted };
      report.verifiers.push(verifier);
      if (!accepted && !report.first_failure) {
        report.zero_build_result = "FAIL";
        report.first_failure = { kind: "verifier", path, verifier };
      }
    }
  }

  if (!report.first_failure) {
    report.zero_build_result = "PASS";
  }
} catch (error) {
  report.zero_build_result = "FAIL";
  report.first_failure ||= { kind: "runner", message: error.message };
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  report.workDirRemoved = workDir;
  rmSync(workDir, { recursive: true, force: true });
  writeFileSync(join(outDir, "fresh_database_reconciliation_result.json"), JSON.stringify(report, null, 2) + "\n");
  const lines = [
    "# Fresh database reconciliation result",
    "",
    `zero_build_result: ${report.zero_build_result}`,
    `postgres_bin_dir: ${binDir}`,
    `preflight_database_empty: ${report.preflight ? report.preflight.initial_kai_object_count === 0 : "NOT_CONFIRMED"}`,
    `applied_steps: ${report.applied.length}`,
  ];
  if (report.first_failure) {
    lines.push(`first_failure_kind: ${report.first_failure.kind}`);
    lines.push(`first_failure_path: ${report.first_failure.path || "n/a"}`);
    const stderr = report.first_failure.result?.stderr_tail || report.first_failure.verifier?.result?.stderr_tail || report.first_failure.message || "";
    lines.push("first_failure_evidence:");
    lines.push("```");
    lines.push(stderr.trim());
    lines.push("```");
  }
  writeFileSync(join(outDir, "fresh_database_reconciliation_result.md"), lines.join("\n") + "\n");
  console.log(JSON.stringify({ zero_build_result: report.zero_build_result, first_failure: report.first_failure?.path || report.first_failure?.message || null }, null, 2));
}
