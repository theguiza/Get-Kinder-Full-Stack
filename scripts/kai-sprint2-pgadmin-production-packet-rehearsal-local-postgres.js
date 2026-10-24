/**
 * KAI pgAdmin production migration packet: capture and rehearsal, on a
 * disposable loopback PostgreSQL cluster only. Never connects anywhere else.
 *
 *   node scripts/kai-sprint2-pgadmin-production-packet-rehearsal-local-postgres.js capture
 *     Builds the repository's normal migration chain without the packet's four
 *     migrations, applies them, and writes the PostgreSQL-rendered definitions
 *     of every object they create or change to
 *     KAI_PGADMIN_PRODUCTION_MIGRATION_PACKET/support/expected_post_migration_catalog_pg16.json.
 *
 *   node scripts/kai-sprint2-pgadmin-production-packet-rehearsal-local-postgres.js rehearse
 *     Builds a schema-only replica of the owner-captured production schema
 *     (artifacts/kai-db-reconciliation-2026-09-16/PRODUCTION_KAI_SCHEMA.json),
 *     then runs the packet's SQL files exactly as an operator would, in order,
 *     and asserts every PASS / FAIL / REQUIRED / STOP outcome, including
 *     partial-application, drift, rollback, and rollback-refusal cases.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { MIGRATION_CHAIN, PRODUCTION_HISTORY_ONLY } from "./kai-sprint2-plan-a-migration-chain.js";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const packetDir = join(repoRoot, "KAI_PGADMIN_PRODUCTION_MIGRATION_PACKET");
const captureFile = join(packetDir, "support", "expected_post_migration_catalog_pg16.json");
const productionCapture = join(repoRoot, "artifacts", "kai-db-reconciliation-2026-09-16", "PRODUCTION_KAI_SCHEMA.json");
const binDir = process.env.PG_BIN_DIR || "/opt/homebrew/opt/postgresql@16/bin";
const mode = process.argv[2];
if (!["capture", "rehearse"].includes(mode)) throw new Error("usage: capture | rehearse");

export const PACKET_MIGRATIONS = [
  "kai_sprint2_p1_downstream_recovery_state",
  "kai_sprint2_b1a_02_client_admin_sensitivity_review",
  "kai_sprint2_p2_01m_source_record_count_measurement",
  "kai_sprint2_plan_a_organization_internal_release_authority",
];

const workDir = mkdtempSync(join(tmpdir(), "kai-pgadmin-packet-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const port = String(63000 + Math.floor(Math.random() * 900));
const user = process.env.USER || "postgres";
let dbName = "";

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "postgres://127.0.0.1:9/kai_sentinel", PGHOST: "127.0.0.1", PGPORT: port, PGUSER: user },
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}
const psql = (args, options) => run(join(binDir, "psql"), ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", dbName, ...args], options);
const psqlFile = (path, options) => psql(["-f", path], options);
const psqlExec = (sql) => psql(["-c", sql]);
const scalar = (sql) => psql(["-At", "-c", sql]).stdout.trim();

function createDatabase(name) {
  dbName = name;
  run(join(binDir, "createdb"), ["-h", "127.0.0.1", "-p", port, name]);
  const row = scalar("SELECT current_database() || '|' || inet_server_addr()::text || '|' || current_setting('listen_addresses')");
  if (row !== `${name}|127.0.0.1/32|127.0.0.1` && row !== `${name}|127.0.0.1|127.0.0.1`) {
    throw new Error(`refusing a non-loopback or unexpected target: ${row}`);
  }
}

// Each packet file is a single read-only SELECT; it runs here in a read-only
// session, so any write it attempted would fail the rehearsal. Returns rows.
const timings = [];
function runPacketQuery(file) {
  const started = Date.now();
  const out = psql(["--csv", "-c", "SET default_transaction_read_only = on", "-f", join(packetDir, file)]).stdout.trim();
  timings.push([file, Date.now() - started]);
  const lines = parseCsv(out);
  const header = lines.shift();
  return lines.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index]])));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === "\"" && text[i + 1] === "\"") { cell += "\""; i += 1; } else if (ch === "\"") quoted = false; else cell += ch;
    } else if (ch === "\"") quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

const overall = (rows) => rows.find((row) => row.check_id === "OVERALL");
let assertions = 0;
function expect(condition, message, rows) {
  assertions += 1;
  if (!condition) {
    const detail = rows ? `\n${rows.filter((row) => !["PASS", "INFO", "ALREADY_APPLIED"].includes(row.status)).map((row) => JSON.stringify(row)).join("\n")}` : "";
    throw new Error(`REHEARSAL FAILED: ${message}${detail}`);
  }
  console.log(`  ok ${assertions} - ${message}`);
}

function migrationStates(rows) {
  return Object.fromEntries(rows.filter((row) => row.section === "C_MIGRATION_STATE").map((row) => [row.check_id, row.status]));
}

// ---------------------------------------------------------------- capture
function buildChainWithout(excluded) {
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec("ALTER TABLE kai.engagements ADD CONSTRAINT kai_plan_a_engagements_id_org_unique UNIQUE (engagement_id, organization_id);");
  psqlFile("scripts/kai-sprint2-join-1-organization-join-requests-bootstrap-synthetic-schema.sql");
  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  // Migrations introduced after the packet's last one build on the packet
  // (migration 05 requires 03's evidence_measurements) and ship in their own
  // delta packets, so the chain stops there.
  const last = Math.max(...PACKET_MIGRATIONS.map((migration) => MIGRATION_CHAIN.indexOf(migration)));
  for (const migration of MIGRATION_CHAIN.slice(0, last + 1)) {
    if (excluded.includes(migration) || PRODUCTION_HISTORY_ONLY.has(migration)) continue;
    psqlFile(`migrations/${migration}.sql`);
  }
}

const CAPTURE_TABLES = [
  "evidence_items", "source_locators", "intake_sensitivity_review_decisions", "limitation_snapshots",
  "human_authority_decisions", "intake_p1_downstream_attempts", "source_measurement_definitions", "evidence_measurements",
];

function catalogJson() {
  const tables = CAPTURE_TABLES.map((name) => `'${name}'`).join(",");
  return JSON.parse(scalar(`SELECT json_build_object(
    'postgresql_version', version(),
    'constraints', (SELECT json_agg(json_build_object('table_name', c.relname, 'name', con.conname, 'type', con.contype,
        'definition', pg_get_constraintdef(con.oid, true)) ORDER BY c.relname, con.conname)
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      WHERE c.relnamespace = 'kai'::regnamespace AND c.relname IN (${tables})),
    'columns', (SELECT json_agg(json_build_object('table_name', c.relname, 'column_name', a.attname, 'attnum', a.attnum,
        'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull, 'default', pg_get_expr(ad.adbin, ad.adrelid)) ORDER BY c.relname, a.attnum)
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE c.relnamespace = 'kai'::regnamespace AND c.relname IN ('intake_p1_downstream_attempts', 'source_measurement_definitions', 'evidence_measurements')
        AND a.attnum > 0 AND NOT a.attisdropped),
    'indexes', (SELECT json_agg(json_build_object('table_name', tablename, 'name', indexname, 'definition', indexdef) ORDER BY tablename, indexname)
      FROM pg_indexes WHERE schemaname = 'kai' AND tablename IN ('intake_p1_downstream_attempts', 'source_measurement_definitions', 'evidence_measurements')),
    'triggers', (SELECT json_agg(json_build_object('table_name', c.relname, 'name', t.tgname, 'definition', pg_get_triggerdef(t.oid, true), 'enabled', t.tgenabled) ORDER BY c.relname, t.tgname)
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND t.tgname IN ('trg_organization_release_limitation_snapshot_scope', 'trg_organization_release_decision_scope')),
    'functions', (SELECT json_agg(json_build_object('name', p.proname, 'prosrc_md5', md5(p.prosrc), 'language', l.lanname,
        'result_type', pg_get_function_result(p.oid)) ORDER BY p.proname)
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.pronamespace = 'kai'::regnamespace AND p.proname IN ('organization_release_enforce_snapshot_scope', 'organization_release_enforce_decision_scope'))
  )`));
}

function capture() {
  createDatabase("kai_pgadmin_packet_capture_synthetic");
  buildChainWithout(PACKET_MIGRATIONS);
  const before = catalogJson();
  for (const migration of PACKET_MIGRATIONS) psqlFile(`migrations/${migration}.sql`);
  const after = catalogJson();
  mkdirSync(join(packetDir, "support"), { recursive: true });
  writeFileSync(captureFile, `${JSON.stringify({
    description: "PostgreSQL-rendered definitions before and after the four packet migrations, captured from a disposable loopback cluster built from the repository's normal migration chain. 'before' reflects the repository chain (which already admits client_admin in the B1A-02 role CHECK through a later edit of a historical migration); the production starting state comes from the owner's 2026-09-16 capture instead.",
    migrations: PACKET_MIGRATIONS,
    before,
    after,
  }, null, 2)}\n`);
  console.log(`captured ${captureFile}`);
}

// ---------------------------------------------------------------- replica
// Schema-only replica of the owner-captured 2026-09-16 production schema.
function replicaDdl() {
  const cap = JSON.parse(readFileSync(productionCapture, "utf8"));
  const sql = ["SET check_function_bodies = off;", "CREATE EXTENSION IF NOT EXISTS citext;", "CREATE SCHEMA kai;",
    // Two non-workflow production tables (funders, funder_requirements) reference
    // the legacy schema the 2026-08-17 cutover created; the capture covers kai only.
    "CREATE SCHEMA kai_legacy_20260817;", "CREATE TABLE kai_legacy_20260817.source_locators (locator_id uuid PRIMARY KEY);",
    // kai.gk_organization_bindings references the Get Kinder application's public.organizations.
    "CREATE TABLE public.organizations (id integer PRIMARY KEY);"];
  const enums = new Map();
  for (const type of cap.types.filter((t) => t.kind === "e")) {
    if (!enums.has(type.name)) enums.set(type.name, []);
    enums.get(type.name).push(type);
  }
  for (const [name, labels] of enums) {
    labels.sort((a, b) => a.enum_sort_order - b.enum_sort_order);
    sql.push(`CREATE TYPE kai.${name} AS ENUM (${labels.map((l) => `'${l.enum_label.replace(/'/g, "''")}'`).join(", ")});`);
  }
  for (const fn of cap.functions) sql.push(`${fn.normalized_definition.trim()};`);
  const columns = new Map();
  for (const column of cap.columns) {
    if (!columns.has(column.table_name)) columns.set(column.table_name, []);
    columns.get(column.table_name).push(column);
  }
  for (const table of cap.tables) {
    const cols = (columns.get(table.name) || []).sort((a, b) => a.attnum - b.attnum)
      .map((c) => `  "${c.column_name}" ${c.type}${c.default ? ` DEFAULT ${c.default}` : ""}${c.not_null ? " NOT NULL" : ""}`);
    sql.push(`CREATE TABLE kai.${table.name} (\n${cols.join(",\n")}\n);`);
  }
  // Keys first, then standalone indexes (some foreign keys reference a unique
  // index rather than a unique constraint), then CHECKs and foreign keys.
  const constraintNames = new Set(cap.constraints.map((c) => c.name));
  const addConstraints = (kinds) => {
    for (const kind of kinds) {
      for (const con of cap.constraints.filter((c) => c.type === kind)) {
        sql.push(`ALTER TABLE kai.${con.table_name} ADD CONSTRAINT "${con.name}" ${con.definition};`);
      }
    }
  };
  addConstraints(["p", "u", "x"]);
  for (const index of cap.indexes) if (!constraintNames.has(index.name)) sql.push(`${index.definition};`);
  addConstraints(["c", "f"]);
  for (const trigger of cap.triggers) {
    sql.push(`${trigger.definition};`);
    if (trigger.enabled === "D") sql.push(`ALTER TABLE kai.${trigger.table_name} DISABLE TRIGGER ${trigger.name};`);
  }
  return sql.join("\n");
}

function buildReplica(name) {
  createDatabase(name);
  const file = join(workDir, `${name}.sql`);
  writeFileSync(file, replicaDdl());
  psqlFile(file);
}

const packetMigrationFile = (index) => [
  "01_MIGRATION_kai_sprint2_p1_downstream_recovery_state.sql",
  "02_MIGRATION_kai_sprint2_b1a_02_client_admin_sensitivity_review.sql",
  "03_MIGRATION_kai_sprint2_p2_01m_source_record_count_measurement.sql",
  "04_MIGRATION_kai_sprint2_plan_a_organization_internal_release_authority.sql",
][index];
const verifierFile = (index) => [
  "01V_VERIFY_AFTER_p1_downstream_recovery_state_READ_ONLY.sql",
  "02V_VERIFY_AFTER_b1a_02_client_admin_sensitivity_review_READ_ONLY.sql",
  "03V_VERIFY_AFTER_p2_01m_source_record_count_measurement_READ_ONLY.sql",
  "04V_VERIFY_AFTER_plan_a_organization_internal_release_authority_READ_ONLY.sql",
][index];
const rollbackFile = (index) => [
  "rollback/R01_ROLLBACK_kai_sprint2_p1_downstream_recovery_state.rollback.sql",
  "rollback/R02_ROLLBACK_kai_sprint2_b1a_02_client_admin_sensitivity_review.rollback.sql",
  "rollback/R03_ROLLBACK_kai_sprint2_p2_01m_source_record_count_measurement.rollback.sql",
  "rollback/R04_ROLLBACK_kai_sprint2_plan_a_organization_internal_release_authority.rollback.sql",
][index];

function rehearse() {
  // Scenario 1: the 2026-09-16 production state, full forward run.
  console.log("Scenario 1: replica of the owner-captured production schema; full forward run");
  buildReplica("kai_pgadmin_packet_replica_forward_synthetic");
  let rows = runPacketQuery("00_RECONCILED_PRODUCTION_PREFLIGHT_READ_ONLY.sql");
  expect(rows.filter((row) => row.status === "FAIL").length === 0, "preflight on the captured production state has no FAIL row", rows);
  expect(JSON.stringify(migrationStates(rows)) === JSON.stringify({ M01: "REQUIRED", M02: "REQUIRED", M03: "REQUIRED", M04: "REQUIRED" }),
    "preflight reports all four packet migrations REQUIRED on the captured production state", rows);
  expect(overall(rows).status === "READY", `preflight OVERALL is READY (${overall(rows).observed})`, rows);
  expect(/run in order: 01, 02, 03, 04$/.test(overall(rows).observed), "preflight OVERALL lists 01, 02, 03, 04 in order", rows);
  rows = runPacketQuery("99_FINAL_SCHEMA_VERIFICATION_READ_ONLY.sql");
  expect(overall(rows).status === "FAIL", "final verification FAILS before any migration", rows);
  for (let i = 0; i < 4; i += 1) {
    rows = runPacketQuery(verifierFile(i));
    expect(overall(rows).status === "FAIL", `${verifierFile(i)} FAILS before its migration`, rows);
    psqlFile(join(packetDir, packetMigrationFile(i)));
    rows = runPacketQuery(verifierFile(i));
    expect(overall(rows).status === "PASS" && rows.every((row) => row.status === "PASS"), `${verifierFile(i)} PASSES after ${packetMigrationFile(i)}`, rows);
  }
  rows = runPacketQuery("99_FINAL_SCHEMA_VERIFICATION_READ_ONLY.sql");
  expect(overall(rows).status === "PASS" && rows.every((row) => ["PASS", "INFO"].includes(row.status)), "final verification PASSES after the four migrations", rows);
  rows = runPacketQuery("00_RECONCILED_PRODUCTION_PREFLIGHT_READ_ONLY.sql");
  expect(JSON.stringify(migrationStates(rows)) === JSON.stringify({ M01: "ALREADY_APPLIED", M02: "ALREADY_APPLIED", M03: "ALREADY_APPLIED", M04: "ALREADY_APPLIED" }),
    "a second preflight reports every migration ALREADY_APPLIED", rows);
  expect(overall(rows).status === "NOTHING_TO_RUN", "a second preflight OVERALL is NOTHING_TO_RUN", rows);
  rows = runPacketQuery("RP_ROLLBACK_PRECHECK_READ_ONLY.sql");
  expect(rows.filter((row) => row.check_id.startsWith("R0")).every((row) => row.status === "SAFE_TO_ROLL_BACK"), "rollback precheck: every rollback SAFE with no recorded rows", rows);

  // Rollback refusal with real organization decisions recorded (local rows only).
  const org = "00000000-0000-4000-8000-0000000000a1";
  psqlExec(`SET session_replication_role = replica;
    INSERT INTO kai.limitation_snapshots (organization_id, generated_content_draft_id, confirmed_by, confirmed_by_role, entries_fingerprint)
      VALUES ('${org}', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1', 'client_admin', repeat('a', 64));
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
      VALUES ('${org}', '00000000-0000-4000-8000-0000000000d1', 'export_authority_granted', 'grant', '00000000-0000-4000-8000-0000000000c1', 'client_admin');`);
  rows = runPacketQuery("RP_ROLLBACK_PRECHECK_READ_ONLY.sql");
  expect(rows.find((row) => row.check_id === "R04").status === "UNSAFE_ROLLBACK_REFUSES", "rollback precheck reports R04 refuses with client_admin decisions", rows);
  const fingerprint = scalar("SELECT md5(string_agg(conname || pg_get_constraintdef(oid), '|' ORDER BY conname)) FROM pg_constraint WHERE connamespace = 'kai'::regnamespace");
  const refused = psqlFile(join(packetDir, rollbackFile(3)), { allowFailure: true });
  expect(refused.status !== 0 && /rollback refused: client_admin release decisions exist/.test(refused.stderr), "R04 rollback refuses with client_admin decisions present");
  psqlExec("ROLLBACK;");
  expect(scalar("SELECT md5(string_agg(conname || pg_get_constraintdef(oid), '|' ORDER BY conname)) FROM pg_constraint WHERE connamespace = 'kai'::regnamespace") === fingerprint
    && scalar("SELECT count(*) FROM kai.human_authority_decisions WHERE decided_by_role = 'client_admin'") === "1", "the refused R04 rollback changed no constraint and kept the decision");
  psqlExec("SET session_replication_role = replica; DELETE FROM kai.human_authority_decisions; DELETE FROM kai.limitation_snapshots;");

  // Full rollback in reverse order returns the captured production state.
  for (let i = 3; i >= 0; i -= 1) psqlFile(join(packetDir, rollbackFile(i)));
  rows = runPacketQuery("00_RECONCILED_PRODUCTION_PREFLIGHT_READ_ONLY.sql");
  expect(JSON.stringify(migrationStates(rows)) === JSON.stringify({ M01: "REQUIRED", M02: "REQUIRED", M03: "REQUIRED", M04: "REQUIRED" })
    && overall(rows).status === "READY", "after R04..R01 the preflight again reports the captured production state", rows);

  // Scenario 2: 01 and 02 applied earlier by the owner; only 03 and 04 remain.
  console.log("Scenario 2: production already has 01 and 02");
  buildReplica("kai_pgadmin_packet_replica_partial_history_synthetic");
  psqlFile(join(packetDir, packetMigrationFile(0)));
  psqlFile(join(packetDir, packetMigrationFile(1)));
  psqlExec(`ALTER TABLE kai.review_queue_items
    ADD CONSTRAINT review_queue_items_p2_01_evidence_review_required_action_check
    CHECK (queue_type <> 'evidence_review'::text OR required_action IS NOT NULL
      AND length(btrim(required_action)) >= 1 AND length(btrim(required_action)) <= 2000);`);
  rows = runPacketQuery("00_RECONCILED_PRODUCTION_PREFLIGHT_READ_ONLY.sql");
  expect(rows.find((row) => row.check_id === "B_TABLE kai.review_queue_items").status === "PASS",
    "row 324 PASSES with the exact additional P2-01 evidence-review CHECK", rows);
  expect(JSON.stringify(migrationStates(rows)) === JSON.stringify({ M01: "ALREADY_APPLIED", M02: "ALREADY_APPLIED", M03: "REQUIRED", M04: "REQUIRED" })
    && overall(rows).status === "READY" && /run in order: 03, 04$/.test(overall(rows).observed),
    "preflight is READY for only 03, 04 when 01 and 02 and the documented P2-01 CHECK are present", rows);

  console.log("Scenario 2b: same constraint name with a different definition remains drift");
  buildReplica("kai_pgadmin_packet_replica_constraint_drift_synthetic");
  psqlExec(`ALTER TABLE kai.review_queue_items
    ADD CONSTRAINT review_queue_items_p2_01_evidence_review_required_action_check
    CHECK (queue_type <> 'evidence_review'::text OR required_action IS NOT NULL);`);
  rows = runPacketQuery("00_RECONCILED_PRODUCTION_PREFLIGHT_READ_ONLY.sql");
  expect(rows.find((row) => row.check_id === "B_TABLE kai.review_queue_items").status === "FAIL"
    && overall(rows).status === "STOP",
    "row 324 still FAILS for a same-name P2-01 CHECK with a different definition", rows);

  console.log("Scenario 2c: missing captured constraint remains drift");
  buildReplica("kai_pgadmin_packet_replica_missing_constraint_synthetic");
  psqlExec("ALTER TABLE kai.review_queue_items DROP CONSTRAINT review_queue_items_p2_03_claim_review_required_action_check;");
  rows = runPacketQuery("00_RECONCILED_PRODUCTION_PREFLIGHT_READ_ONLY.sql");
  expect(rows.find((row) => row.check_id === "B_TABLE kai.review_queue_items").status === "FAIL"
    && /review_queue_items_p2_03_claim_review_required_action_check missing/.test(rows.find((row) => row.check_id === "B_TABLE kai.review_queue_items").observed)
    && overall(rows).status === "STOP",
    "row 324 still detects a missing captured CHECK", rows);

  // Scenario 3: a half-applied release migration must STOP.
  console.log("Scenario 3: partial release-authority state");
  buildReplica("kai_pgadmin_packet_replica_partial_release_synthetic");
  psqlExec(`ALTER TABLE kai.limitation_snapshots DROP CONSTRAINT limitation_snapshots_p3_16_confirmed_by_role_check,
    ADD CONSTRAINT limitation_snapshots_p3_16_confirmed_by_role_check CHECK (confirmed_by_role IN ('gk_reviewer', 'gk_admin', 'client_admin'));`);
  rows = runPacketQuery("00_RECONCILED_PRODUCTION_PREFLIGHT_READ_ONLY.sql");
  expect(migrationStates(rows).M04 === "STOP_INCOMPATIBLE" && overall(rows).status === "STOP", "a widened snapshot CHECK without the decision CHECK and triggers is STOP_INCOMPATIBLE", rows);

  // Scenario 4: drift on a workflow table must STOP.
  console.log("Scenario 4: unexpected constraint on a workflow table");
  buildReplica("kai_pgadmin_packet_replica_drift_synthetic");
  psqlExec("ALTER TABLE kai.generated_content_drafts ADD CONSTRAINT unexpected_drift_check CHECK (requested_audience <> 'internal');");
  rows = runPacketQuery("00_RECONCILED_PRODUCTION_PREFLIGHT_READ_ONLY.sql");
  expect(rows.find((row) => row.check_id === "B_TABLE kai.generated_content_drafts").status === "FAIL" && overall(rows).status === "STOP",
    "an extra CHECK on kai.generated_content_drafts FAILS the baseline and STOPS", rows);

  // Scenario 5: a narrowed audit operation vocabulary must STOP.
  console.log("Scenario 5: audit operation vocabulary missing a required operation");
  buildReplica("kai_pgadmin_packet_replica_audit_synthetic");
  const opDef = scalar("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'upload_lifecycle_audit_gate_a_operation_check'");
  psqlExec(`ALTER TABLE kai.upload_lifecycle_audit DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
    ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check ${opDef.replace(" OR (operation = ANY (ARRAY['limitation_snapshot_confirmed'::text, 'export_candidate_created'::text]))", "")};`);
  rows = runPacketQuery("00_RECONCILED_PRODUCTION_PREFLIGHT_READ_ONLY.sql");
  expect(rows.find((row) => row.check_id === "B04").status === "FAIL" && /limitation_snapshot_confirmed/.test(rows.find((row) => row.check_id === "B04").observed) && overall(rows).status === "STOP",
    "B04 FAILS and names limitation_snapshot_confirmed when the audit vocabulary lacks it", rows);

  // Scenario 6: the repository's own normal chain (fresh-environment shape).
  console.log("Scenario 6: the repository's normal chain without the packet migrations");
  createDatabase("kai_pgadmin_packet_chain_synthetic");
  buildChainWithout(PACKET_MIGRATIONS);
  rows = runPacketQuery("00_RECONCILED_PRODUCTION_PREFLIGHT_READ_ONLY.sql");
  const chainStates = migrationStates(rows);
  expect(chainStates.M01 === "REQUIRED" && chainStates.M02 === "ALREADY_APPLIED" && chainStates.M03 === "REQUIRED" && chainStates.M04 === "REQUIRED",
    "on the repository chain the preflight sees B1A-02 already admitted by the edited historical migration", rows);
  console.log(`Repository-chain preflight baseline rows that differ from the 2026-09-16 production capture (expected; production-legacy shapes): ${rows.filter((row) => row.status === "FAIL" || row.status === "WARN").map((row) => row.check_id).join(", ")}`);

  const slowest = new Map();
  for (const [file, ms] of timings) slowest.set(file, Math.max(ms, slowest.get(file) || 0));
  console.log(`slowest read-only run per file (ms, local PostgreSQL 16): ${[...slowest].map(([file, ms]) => `${file.split("_")[0]}=${ms}`).join(", ")}`);
  console.log(`pgAdmin packet rehearsal passed: ${assertions} assertions.`);
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(join(binDir, "initdb"), ["-D", dataDir, "--no-locale", "--encoding=UTF8"]);
  run(join(binDir, "pg_ctl"), ["-D", dataDir, "-l", join(workDir, "postgres.log"), "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "-w", "start"]);
  started = true;
  if (mode === "capture") capture();
  else rehearse();
} finally {
  if (started) spawnSync(join(binDir, "pg_ctl"), ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8" });
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  console.log(`ephemeral PostgreSQL workdir removed: ${workDir}`);
}
