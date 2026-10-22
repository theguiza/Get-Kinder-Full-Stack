/**
 * KAI Plan A normal migration chain (Prompt 7), on a disposable loopback
 * PostgreSQL cluster only.
 *
 * Builds the schema the way a fresh environment would get it: the synthetic
 * pre-migration base (the production-owned tables no repository migration
 * creates: kai.organizations, kai.engagements, kai.audit_events, kai.users,
 * kai.intake_files), then EVERY non-rollback kai_sprint2_* migration, each
 * applied once, unmodified, in the order the repository introduced them (the
 * commit that first added each file; verified against git below). There is
 * no CHECK union, no constraint patch, and no table mirror between or after
 * migrations. Two migrations are production-history repairs that accept only
 * a legacy production starting state or their own converged state; they are
 * still applied, must refuse this fresh state, and must leave it unchanged.
 *
 * Then it prints the pg_catalog objects the measured-claim, generation,
 * review, export, and Markdown path depend on, and runs the P2-01M proof
 * (legacy seed before the P2-01M migration, as in its own runner) with
 * KAI_PLAN_A_NORMAL_CHAIN=1, which enables the review-to-Markdown proof.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_plan_a_normal_chain_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-plan-a-chain-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(61000 + Math.floor(Math.random() * 1000));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      DATABASE_URL: "postgres://127.0.0.1:9/kai_sentinel",
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGDATABASE: dbName,
      PGUSER: user,
    },
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(path) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], { capture: true }).stdout;
}

function psqlExec(sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", sql], { capture: true }).stdout;
}

async function proveRunnerOwnedTarget() {
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT current_database() AS database_name,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port,
             current_setting('listen_addresses') AS listen_addresses
    `);
    const row = result.rows[0];
    if (row.database_name !== dbName) throw new Error("Plan A normal-chain runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`Plan A normal-chain runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("Plan A normal-chain runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("Plan A normal-chain runner refused non-loopback listen_addresses");
  } finally {
    await client.end();
  }
}

// Repository introduction order: `git log --diff-filter=A` of each file,
// oldest first. Same-commit pairs keep the browser-acceptance runner's order.
const MIGRATION_CHAIN = [
  "kai_sprint2_gate_a_p0_upload_lifecycle",
  "kai_sprint2_gate_a_p0_policy_decision_replay",
  "kai_sprint2_p1_parser_run_and_file_profile",
  "kai_sprint2_p1_04_data_dictionary_and_quality",
  "kai_sprint2_p1_05_intake_sensitivity_profile",
  "kai_sprint2_p1_06_review_queue",
  "kai_sprint2_p1_07_intake_source_candidate",
  "kai_sprint2_p1_08_source_promotion",
  "kai_sprint2_p2_01_evidence_lineage",
  "kai_sprint2_p2_03_claim_proposal",
  "kai_sprint2_p2_04_claim_gap_followup",
  "kai_sprint2_p2_05_conflict_review_candidate",
  "kai_sprint2_p3_01_generated_content_drafts",
  "kai_sprint2_p3_04_generated_content_review_completion",
  "kai_sprint2_p3_05_export_review_request",
  "kai_sprint2_p3_09_export_review_start",
  "kai_sprint2_p3_13_export_review_completion",
  "kai_sprint2_p3_16_export_candidate_foundation",
  "kai_sprint2_p3_17_human_authority_decision_ledger",
  "kai_sprint2_gate_c1_gcs_generation_binding",
  "kai_sprint2_gk_organization_tenant_binding",
  "kai_sprint2_p2_09_human_review_internal_approval",
  "kai_sprint2_p2_10_coverage_review_decision",
  "kai_sprint2_p2_11_client_followup_completion",
  "kai_sprint2_legacy_generation_cutover_20260817",
  "kai_sprint2_p1_06_review_status_column_repair",
  "kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation",
  "kai_sprint2_p13_01_impact_narrative_content_type",
  "kai_sprint2_b1a_02_phase5_allowed_use_decision_ledger",
  "kai_sprint2_p2_12_human_review_decision_ledger",
  "kai_sprint2_a1_1_impact_outcome_context",
  "kai_sprint2_a1_2_impact_evaluation_framework_and_criteria",
  "kai_sprint2_a1_3_impact_evaluations_and_results",
  "kai_sprint2_a1_4_impact_evaluation_result_provenance_links",
  "kai_sprint2_b1_1_baseline_impact_requirements",
  "kai_sprint2_b1_3_accepted_catalogue_persistence",
  "kai_sprint2_c2_1_requirement_assessment_persistence",
  "kai_sprint2_c3_a3_requirement_assessment_decision_gap_provenance",
  "kai_sprint2_c3_a4_requirement_assessment_provenance_extension",
  "kai_sprint2_p2_10_funder_coverage_authority",
  "kai_sprint2_package_2a_engagement_requirement_sets_authority",
  "kai_sprint2_p3_17_authority_audit_gate_a_operation_repair",
  "kai_sprint2_p3_19_export_manifest_foundation",
  "kai_sprint2_gate_a_p0_upload_lifecycle_enforcement_forward_repair",
  "kai_sprint2_gate_a_p0_required_index_forward_repair",
  "kai_sprint2_p3_20_export_manifest_review_binding",
  "kai_sprint2_p14_01_generation_run_engagement_binding",
  "kai_sprint2_p14_02_grant_response_packet_export_identity_foundation",
  "kai_sprint2_p14_03_grant_response_packet_export_candidate_foundation",
  "kai_sprint2_p14_05_grant_response_packet_export_review_binding",
  "kai_sprint2_p14_07_b1_grant_response_packet_human_authority_decision_ledger",
  "kai_sprint2_p14_08_a_grant_response_packet_export_manifest_foundation",
  "kai_sprint2_p14_10_review_queue_target_object_type_repair",
  "kai_sprint2_generated_content_review_start_audit_contract",
  "kai_sprint2_br_02_board_reporting_candidate_foundation",
  "kai_sprint2_br_03a_board_reporting_candidate_review_request",
  "kai_sprint2_br_03b_board_reporting_candidate_review_lifecycle",
  "kai_sprint2_br_04_board_reporting_candidate_human_authority_decision_ledger",
  "kai_sprint2_board_reporting_candidate_export_manifest_foundation",
  "kai_sprint2_p14_14_generated_content_type_evolution",
  "kai_sprint2_p14_12_review_queue_type_check_legacy_repair",
  "kai_sprint2_p14_15_export_candidate_content_type_evolution",
  "kai_sprint2_p2_10_public_coverage_authority",
  "kai_sprint2_gate_a_p0_policy_decision_replay_object_facts_index_repair",
  "kai_sprint2_p13_ext1_case_for_support_content_type_evolution",
  "kai_sprint2_p13_ext1_case_for_support_export_candidate_content_type_evolution",
  "kai_sprint2_p13_ext2_board_update_content_type_evolution",
  "kai_sprint2_p13_ext2_board_update_export_candidate_content_type_evolution",
  "kai_sprint2_p13_ext3_annual_report_section_content_type_evolution",
  "kai_sprint2_p13_ext3_annual_report_section_export_candidate_content_type_evolution",
  "kai_sprint2_p13_ext4_funder_outcome_table_content_type_evolution",
  "kai_sprint2_p13_ext4_funder_outcome_table_export_candidate_content_type_evolution",
  "kai_sprint2_p13_ext5_grant_response_paragraph_content_type_evolution",
  "kai_sprint2_p13_ext5_grant_response_paragraph_export_candidate_content_type_evolution",
  "kai_sprint2_package_g_improvement_practices_foundation",
  "kai_sprint2_join_1_organization_join_requests",
  "kai_sprint2_p1_downstream_recovery_state",
  "kai_sprint2_b1a_02_client_admin_sensitivity_review",
  "kai_sprint2_p2_01m_source_record_count_measurement",];
const PRODUCTION_HISTORY_ONLY = new Map([
  ["kai_sprint2_legacy_generation_cutover_20260817", /only accepts a fully-legacy pre-cutover state or its own fully-converged post-cutover state/],
  ["kai_sprint2_p1_06_review_status_column_repair", /converged-state check failed: expected exactly 1 CHECK constraint governing review_status/],
]);
const P2_01M_MIGRATION = "kai_sprint2_p2_01m_source_record_count_measurement";

function verifyChainAgainstRepository() {
  const onDisk = readdirSync(join(repoRoot, "migrations"))
    .filter((name) => /^kai_sprint2_.*\.sql$/.test(name) && !name.endsWith(".rollback.sql"))
    .map((name) => name.replace(/\.sql$/, ""))
    .sort();
  const listed = [...MIGRATION_CHAIN].sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(listed)) {
    throw new Error(`migration chain does not list exactly the repository's migrations: missing ${onDisk.filter((m) => !listed.includes(m))}, extra ${listed.filter((m) => !onDisk.includes(m))}`);
  }
  let previous = 0;
  for (const migration of MIGRATION_CHAIN) {
    const added = execFileSync("git", ["log", "--diff-filter=A", "--format=%at", "--", `migrations/${migration}.sql`], { cwd: repoRoot, encoding: "utf8" })
      .trim().split("\n").filter(Boolean).map(Number).pop();
    if (!Number.isFinite(added)) throw new Error(`no introducing commit for ${migration}`);
    if (added < previous) throw new Error(`${migration} is listed after a migration introduced later`);
    previous = added;
  }
  console.log(`Plan A chain: ${MIGRATION_CHAIN.length} migrations, order matches repository introduction order.`);
}

async function catalog(sql, params = []) {
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

const schemaFingerprintSql = `SELECT md5(string_agg(x, '|' ORDER BY x)) AS fingerprint FROM (
    SELECT c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) AS x
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname LIKE 'kai%' AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) FROM pg_constraint
     WHERE connamespace IN (SELECT oid FROM pg_namespace WHERE nspname LIKE 'kai%')
  ) t`;

async function printCatalog() {
  const tables = [
    "intake_files", "sources", "source_versions", "source_locators", "evidence_items", "claims",
    "source_measurement_definitions", "evidence_measurements", "intake_sensitivity_profiles", "intake_sensitivity_review_decisions",
    "evidence_review_decisions", "claim_review_decisions", "coverage_review_decisions", "gap_log_items", "client_followup_items",
    "generation_runs", "generated_content_drafts", "generated_content_blocks", "generated_content_citations",
    "review_queue_items", "limitation_snapshots", "limitation_snapshot_entries", "export_candidates", "human_authority_decisions",
    "export_manifests", "upload_lifecycle_audit", "audit_events", "engagements",
  ];
  const present = await catalog(
    "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'kai' AND c.relkind = 'r' AND relname = ANY($1::text[])",
    [tables]);
  const presentNames = new Set(present.map((row) => row.relname));
  console.log(`Plan A catalog: present ${[...presentNames].sort().join(", ")}`);
  console.log(`Plan A catalog: absent ${tables.filter((name) => !presentNames.has(name)).join(", ") || "(none)"}`);
  const checks = await catalog(
    `SELECT conrelid::regclass::text AS relation, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE contype = 'c' AND conrelid::regclass::text IN ('kai.upload_lifecycle_audit', 'kai.evidence_items', 'kai.source_locators', 'kai.generated_content_drafts', 'kai.review_queue_items', 'kai.export_candidates', 'kai.export_manifests', 'kai.human_authority_decisions')
      ORDER BY 1, 2`);
  for (const row of checks) console.log(`Plan A catalog CHECK ${row.relation}.${row.conname}: ${row.definition.length > 400 ? `${row.definition.slice(0, 400)}...(${row.definition.length} chars)` : row.definition}`);
  const operations = (await catalog(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'kai.upload_lifecycle_audit'::regclass AND conname = 'upload_lifecycle_audit_gate_a_operation_check'`))[0]?.definition || "";
  const literals = [...new Set([...operations.matchAll(/'([a-z0-9_]+)'::text/g)].map((match) => match[1]))].sort();
  console.log(`Plan A catalog: upload_lifecycle_audit operation CHECK admits ${literals.length} operations: ${literals.join(", ")}`);
  const fks = await catalog(
    `SELECT conrelid::regclass::text AS relation, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE contype = 'f' AND conrelid::regclass::text IN ('kai.evidence_measurements', 'kai.source_measurement_definitions', 'kai.generated_content_citations', 'kai.export_candidates', 'kai.export_manifests', 'kai.evidence_review_decisions', 'kai.human_authority_decisions')
      ORDER BY 1, 2`);
  for (const row of fks) console.log(`Plan A catalog FK ${row.relation}.${row.conname}: ${row.definition}`);
  if (process.env.KAI_PLAN_A_CATALOG_OUT) {
    const { writeFileSync } = await import("node:fs");
    const auditChecks = await catalog(
      `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid = 'kai.upload_lifecycle_audit'::regclass AND contype = 'c' ORDER BY conname`);
    writeFileSync(process.env.KAI_PLAN_A_CATALOG_OUT, JSON.stringify(auditChecks, null, 2));
  }
}

const testEnv = {
  ...process.env,
  DATABASE_URL: "postgres://127.0.0.1:9/kai_sentinel",
  DATABASE_URL_LOCAL: "",
  PGURL_LOCAL: "",
  RENDER_DATABASE_URL: "",
  PROD_DATABASE_URL: "",
  DB_HOST: "127.0.0.1",
  DB_PORT: port,
  DB_NAME: dbName,
  DB_USER: user,
  DB_PASSWORD: "",
  KAI_P2_01M_MEASUREMENT_DATABASE_URL: targetUrl,
  KAI_PLAN_A_NORMAL_CHAIN: "1",
};

let started = false;
try {
  verifyChainAgainstRepository();
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();

  // Pre-migration base only (before the first migration): the synthetic
  // mirrors of production-owned tables no repository migration creates. The
  // engagement (id, organization) key is required by A1-1's composite
  // foreign key, exactly as the browser-acceptance runner declares it.
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec("ALTER TABLE kai.engagements ADD CONSTRAINT kai_plan_a_engagements_id_org_unique UNIQUE (engagement_id, organization_id);");
  psqlFile("scripts/kai-sprint2-join-1-organization-join-requests-bootstrap-synthetic-schema.sql");
  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");

  for (const migration of MIGRATION_CHAIN) {
    if (migration === P2_01M_MIGRATION) {
      // The P2-01M migration is the newest; seed legacy field-presence
      // lineage through the real P2-01/P2-03 paths before it, as its own
      // runner does.
      const seed = spawnSync("node", ["--test", "__tests__/kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js"],
        { cwd: repoRoot, encoding: "utf8", stdio: "inherit", env: { ...testEnv, KAI_P2_01M_PHASE: "legacy_seed" } });
      if (seed.status !== 0) throw new Error("P2-01M legacy seed phase failed on the normal chain");
    }
    const refusal = PRODUCTION_HISTORY_ONLY.get(migration);
    if (!refusal) {
      psqlFile(`migrations/${migration}.sql`);
      continue;
    }
    const before = (await catalog(schemaFingerprintSql))[0].fingerprint;
    let refused = false;
    try {
      psqlFile(`migrations/${migration}.sql`);
    } catch (error) {
      refused = refusal.test(String(error.message));
      if (!refused) throw error;
    }
    if (!refused) throw new Error(`${migration} unexpectedly applied to a fresh canonical schema`);
    if ((await catalog(schemaFingerprintSql))[0].fingerprint !== before) throw new Error(`${migration} refusal changed the schema`);
    console.log(`Plan A chain: ${migration} refused the fresh canonical state as designed; schema unchanged.`);
  }
  console.log(`Plan A chain: applied ${MIGRATION_CHAIN.length - PRODUCTION_HISTORY_ONLY.size} migrations in order with no schema adjustment.`);
  await printCatalog();
  console.log(`Plan A chain schema fingerprint: ${(await catalog(schemaFingerprintSql))[0].fingerprint}`);

  const testResult = spawnSync("node", ["--test", "--test-concurrency=1", "__tests__/kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js"],
    { cwd: repoRoot, encoding: "utf8", stdio: "inherit", env: testEnv });
  if (testResult.status !== 0) throw new Error("Plan A normal-chain measured-claim to Markdown proof failed");
  console.log(`Plan A chain schema fingerprint after the proof: ${(await catalog(schemaFingerprintSql))[0].fingerprint}`);
  console.log("Plan A normal-chain proof passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Plan A normal-chain ephemeral PostgreSQL workdir removed: ${workDir}`);
}
