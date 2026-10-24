/**
 * KAI pgAdmin migration 05 delta packet (organization internal factual review
 * authority): capture, rehearsal and application compatibility, on disposable
 * loopback PostgreSQL clusters only. Never connects anywhere else.
 *
 *   node scripts/kai-sprint2-pgadmin-migration-05-packet-rehearsal-local-postgres.js capture
 *     Builds the repository's normal migration chain without migration 05,
 *     applies it, and writes the PostgreSQL-rendered definitions of every
 *     object it creates or changes, before and after, to
 *     KAI_PGADMIN_PRODUCTION_MIGRATION_05_DELTA_PACKET/support/expected_migration_05_catalog_pg16.json.
 *
 *   node scripts/kai-sprint2-pgadmin-migration-05-packet-rehearsal-local-postgres.js rehearse
 *     Builds the expected post-04 production baseline (a schema-only replica of
 *     the owner's 2026-09-16 capture, then the accepted 01-04 packet's own
 *     migration files, proven by that packet's 99 verifier), then runs the 05
 *     packet's files exactly as the operator would and asserts every
 *     REQUIRED / ALREADY_APPLIED / STOP_INCOMPATIBLE / PASS / FAIL outcome,
 *     replay, rollback precheck, guarded rollback, and the partial, drift and
 *     missing-prerequisite STOP cases.
 *
 *   node scripts/kai-sprint2-pgadmin-migration-05-packet-rehearsal-local-postgres.js compat
 *     Application compatibility on the repository chain migrated with the
 *     packet's 05 file: the previous application revision (96653f8, in a
 *     temporary `git clone --shared` checkout) runs its own GK measured-claim review to
 *     Markdown proof against the migrated schema; then the current revision's
 *     organization factual review refusals, the direct-insert scope matrix, the
 *     rollback precheck and guarded rollback with real client_admin rows, and
 *     the P2-06 difference an application rollback would reintroduce.
 *
 *   node scripts/kai-sprint2-pgadmin-migration-05-packet-rehearsal-local-postgres.js compat-browser <old|new>
 *     The assembled customer file-to-report browser acceptance
 *     (scripts/kai-sprint2-plan-a-assembled-file-to-report-local-postgres.js)
 *     on a schema that includes the packet's 05 file: `old` runs 96653f8's
 *     acceptance (GK makes the evidence, claim and coverage decisions) in a
 *     temporary clone where the packet file is added to the shared migration
 *     chain and committed in that clone only (the runner verifies chain order
 *     against git); `new` runs the current revision's runner unchanged (its
 *     migration 05 is byte-identical to the packet file, checked first).
 *
 * The temporary clone uses `git clone --shared`: it reads the repository's
 * objects but writes only its own, so the owner's repository, worktrees and
 * working tree never change.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { MIGRATION_CHAIN, PRODUCTION_HISTORY_ONLY } from "./kai-sprint2-plan-a-migration-chain.js";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const packetDir = join(repoRoot, "KAI_PGADMIN_PRODUCTION_MIGRATION_05_DELTA_PACKET");
const priorPacketDir = join(repoRoot, "KAI_PGADMIN_PRODUCTION_MIGRATION_PACKET");
const captureFile = join(packetDir, "support", "expected_migration_05_catalog_pg16.json");
const productionCapture = join(repoRoot, "artifacts", "kai-db-reconciliation-2026-09-16", "PRODUCTION_KAI_SCHEMA.json");
const binDir = process.env.PG_BIN_DIR || "/opt/homebrew/opt/postgresql@16/bin";
const SENTINEL_URL = "postgres://127.0.0.1:9/kai_sentinel";
const OLD_APP_REVISION = "96653f8";
const mode = process.argv[2];
if (!["capture", "rehearse", "compat", "compat-browser"].includes(mode)) throw new Error("usage: capture | rehearse | compat | compat-browser <old|new>");

export const MIGRATION_05 = "kai_sprint2_plan_a_organization_internal_factual_review_authority";
const PRIOR_PACKET_MIGRATIONS = [
  "kai_sprint2_p1_downstream_recovery_state",
  "kai_sprint2_b1a_02_client_admin_sensitivity_review",
  "kai_sprint2_p2_01m_source_record_count_measurement",
  "kai_sprint2_plan_a_organization_internal_release_authority",
];
const PRIOR_PACKET_FILES = [
  "01_MIGRATION_kai_sprint2_p1_downstream_recovery_state.sql",
  "02_MIGRATION_kai_sprint2_b1a_02_client_admin_sensitivity_review.sql",
  "03_MIGRATION_kai_sprint2_p2_01m_source_record_count_measurement.sql",
  "04_MIGRATION_kai_sprint2_plan_a_organization_internal_release_authority.sql",
];
const FILES = {
  preflight: "00_MIGRATION_05_PREFLIGHT_READ_ONLY.sql",
  migration: `05_MIGRATION_${MIGRATION_05}.sql`,
  verifier: "05V_VERIFY_AFTER_plan_a_organization_internal_factual_review_authority_READ_ONLY.sql",
  final: "99_MIGRATION_05_FINAL_SCHEMA_VERIFICATION_READ_ONLY.sql",
  rollbackPrecheck: "RP05_ROLLBACK_PRECHECK_READ_ONLY.sql",
  rollback: `rollback/R05_ROLLBACK_${MIGRATION_05}.rollback.sql`,
};

const workDir = mkdtempSync(join(tmpdir(), "kai-pgadmin-packet-05-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const port = String(64000 + Math.floor(Math.random() * 900));
const user = process.env.USER || "postgres";
let dbName = "";
const dbUrl = () => `postgresql://${user}@127.0.0.1:${port}/${dbName}`;

function run(command, args, { allowFailure = false, cwd = repoRoot, env = {}, inherit = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
    env: { ...process.env, DATABASE_URL: SENTINEL_URL, PGHOST: "127.0.0.1", PGPORT: port, PGUSER: user, ...env },
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
  return result;
}
const psql = (args, options) => run(join(binDir, "psql"), ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", dbName, ...args], options);
const psqlFile = (path, options) => psql(["-f", path], options);
const psqlExec = (sql, options) => psql(["-c", sql], options);
const scalar = (sql) => psql(["-At", "-c", sql]).stdout.trim();
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function createDatabase(name) {
  dbName = name;
  run(join(binDir, "createdb"), ["-h", "127.0.0.1", "-p", port, name]);
  const row = scalar("SELECT current_database() || '|' || inet_server_addr()::text || '|' || current_setting('listen_addresses')");
  if (row !== `${name}|127.0.0.1/32|127.0.0.1` && row !== `${name}|127.0.0.1|127.0.0.1`) {
    throw new Error(`refusing a non-loopback or unexpected target: ${row}`);
  }
}

// Each read-only packet file is a single SELECT; it runs here in a read-only
// session, so any write it attempted would fail the rehearsal. Returns rows.
function runPacketQuery(file) {
  const out = psql(["--csv", "-c", "SET default_transaction_read_only = on", "-f", join(packetDir, file)]).stdout.trim();
  const lines = parseCsv(out);
  const header = lines.shift();
  return lines.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index]])));
}
const runPriorPacketQuery = (file) => {
  const out = psql(["--csv", "-c", "SET default_transaction_read_only = on", "-f", join(priorPacketDir, file)]).stdout.trim();
  const lines = parseCsv(out);
  const header = lines.shift();
  return lines.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index]])));
};

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
const byId = (rows, id) => rows.find((row) => row.check_id === id);
let assertions = 0;
function expect(condition, message, rows) {
  assertions += 1;
  if (!condition) {
    const detail = rows ? `\n${rows.filter((row) => !["PASS", "INFO", "ALREADY_APPLIED", "REQUIRED"].includes(row.status)).map((row) => JSON.stringify(row)).join("\n")}` : "";
    throw new Error(`REHEARSAL FAILED: ${message}${detail}`);
  }
  console.log(`  ok ${assertions} - ${message}`);
}

// Every constraint, user trigger and function in kai: equal fingerprints mean
// no definition drifted and no object was added or duplicated.
const schemaFingerprint = () => scalar(`SELECT md5(concat_ws('#',
    (SELECT string_agg(c.relname || '.' || con.conname || '=' || pg_get_constraintdef(con.oid), '|' ORDER BY c.relname, con.conname)
       FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid WHERE c.relnamespace = 'kai'::regnamespace),
    (SELECT string_agg(c.relname || '.' || t.tgname || '=' || pg_get_triggerdef(t.oid) || t.tgenabled::text, '|' ORDER BY c.relname, t.tgname)
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'kai'::regnamespace AND NOT t.tgisinternal),
    (SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')=' || md5(p.prosrc), '|' ORDER BY p.proname, 2)
       FROM pg_proc p WHERE p.pronamespace = 'kai'::regnamespace)))`);
const factualReviewObjectCounts = () => scalar(`SELECT
    (SELECT count(*) FROM pg_proc WHERE pronamespace = 'kai'::regnamespace AND proname LIKE 'organization_factual_review_%') || '/' ||
    (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'trg_organization_factual_review_%') || '/' ||
    (SELECT count(*) FROM pg_constraint WHERE conname IN ('evidence_review_decisions_p2_12_role_check', 'claim_review_decisions_p2_12_role_check',
       'claim_review_decisions_organization_internal_audience_check', 'coverage_review_decisions_p2_10_decided_by_role_check'))`);
const clientAdminCounts = () => scalar(`SELECT
    (SELECT count(*) FROM kai.evidence_review_decisions WHERE decided_by_role = 'client_admin') || '/' ||
    (SELECT count(*) FROM kai.claim_review_decisions WHERE decided_by_role = 'client_admin') || '/' ||
    (SELECT count(*) FROM kai.coverage_review_decisions WHERE decided_by_role = 'client_admin')`);

// ---------------------------------------------------------------- chain
function bootstrapSyntheticBase() {
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec("ALTER TABLE kai.engagements ADD CONSTRAINT kai_plan_a_engagements_id_org_unique UNIQUE (engagement_id, organization_id);");
  psqlFile("scripts/kai-sprint2-join-1-organization-join-requests-bootstrap-synthetic-schema.sql");
  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
}

// The repository's normal chain in introduction order, without migration 05.
// beforeMigration(name) runs before each migration (the P2-01M legacy seed).
function buildChainWithout05({ beforeMigration = () => {} } = {}) {
  bootstrapSyntheticBase();
  for (const migration of MIGRATION_CHAIN) {
    if (migration === MIGRATION_05) continue;
    beforeMigration(migration);
    const refusal = PRODUCTION_HISTORY_ONLY.get(migration);
    if (!refusal) {
      psqlFile(`migrations/${migration}.sql`);
      continue;
    }
    const result = psqlFile(`migrations/${migration}.sql`, { allowFailure: true });
    if (result.status === 0 || !refusal.test(result.stderr)) throw new Error(`${migration} did not refuse the fresh state as designed\n${result.stderr}`);
  }
}

// ---------------------------------------------------------------- capture
const M05_TABLES = ["evidence_review_decisions", "claim_review_decisions", "coverage_review_decisions"];
const M05_CONSTRAINTS = ["evidence_review_decisions_p2_12_role_check", "claim_review_decisions_p2_12_role_check",
  "claim_review_decisions_organization_internal_audience_check", "coverage_review_decisions_p2_10_decided_by_role_check"];

function catalogJson() {
  return JSON.parse(scalar(`SELECT json_build_object(
    'postgresql_version', version(),
    'constraints', (SELECT coalesce(json_agg(json_build_object('table_name', c.relname, 'name', con.conname, 'type', con.contype,
        'definition', pg_get_constraintdef(con.oid, true), 'validated', con.convalidated) ORDER BY c.relname, con.conname), '[]')
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      WHERE c.relnamespace = 'kai'::regnamespace AND c.relname IN (${M05_TABLES.map((t) => `'${t}'`).join(", ")})),
    'triggers', (SELECT coalesce(json_agg(json_build_object('table_name', c.relname, 'name', t.tgname, 'definition', pg_get_triggerdef(t.oid, true),
        'enabled', t.tgenabled) ORDER BY c.relname, t.tgname), '[]')
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relnamespace = 'kai'::regnamespace AND c.relname IN (${M05_TABLES.map((t) => `'${t}'`).join(", ")}) AND NOT t.tgisinternal),
    'functions', (SELECT coalesce(json_agg(json_build_object('name', p.proname, 'identity_arguments', pg_get_function_identity_arguments(p.oid),
        'prosrc_md5', md5(p.prosrc), 'language', l.lanname, 'volatility', p.provolatile, 'result_type', pg_get_function_result(p.oid),
        'security_definer', p.prosecdef, 'nargs', p.pronargs) ORDER BY p.proname), '[]')
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.pronamespace = 'kai'::regnamespace AND p.proname LIKE 'organization_factual_review_%')
  )`));
}

function capture() {
  createDatabase("kai_pgadmin_packet_05_capture_synthetic");
  buildChainWithout05();
  const before = catalogJson();
  psqlFile(`migrations/${MIGRATION_05}.sql`);
  const after = catalogJson();
  mkdirSync(join(packetDir, "support"), { recursive: true });
  writeFileSync(captureFile, `${JSON.stringify({
    description: "PostgreSQL-rendered definitions of the three decision tables' constraints and user triggers, and of the organization_factual_review_* functions, before and after migration 05, captured from a disposable loopback cluster built from the repository's normal migration chain (every migration before 05, in introduction order).",
    migration: MIGRATION_05,
    before,
    after,
  }, null, 2)}\n`);
  console.log(`captured ${captureFile}`);
}

// ---------------------------------------------------------------- replica
// Schema-only replica of the owner-captured 2026-09-16 production schema
// (identical to the 01-04 packet rehearsal's replica).
function replicaDdl() {
  const cap = JSON.parse(readFileSync(productionCapture, "utf8"));
  const sql = ["SET check_function_bodies = off;", "CREATE EXTENSION IF NOT EXISTS citext;", "CREATE SCHEMA kai;",
    "CREATE SCHEMA kai_legacy_20260817;", "CREATE TABLE kai_legacy_20260817.source_locators (locator_id uuid PRIMARY KEY);",
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

// The expected post-04 production state: the capture replica plus the
// accepted 01-04 packet's own migration files, in order.
function buildPost04Replica(name, { through = 4 } = {}) {
  createDatabase(name);
  const file = join(workDir, `${name}.sql`);
  writeFileSync(file, replicaDdl());
  psqlFile(file);
  for (let i = 0; i < through; i += 1) psqlFile(join(priorPacketDir, PRIOR_PACKET_FILES[i]));
}

const applyPacket05 = () => psqlFile(join(packetDir, FILES.migration));
const preflightClass = (rows) => overall(rows).status;

// Synthetic client_admin rows inserted with triggers and foreign keys
// bypassed (session_replication_role = replica), as the 01-04 rehearsal does;
// the replica holds no lineage. Real, trigger-checked rows are the compat
// mode's.
const SYNTHETIC_ORG = "00000000-0000-4000-8000-0000000005a1";
function insertSyntheticClientAdminDecisions() {
  psqlExec(`SET session_replication_role = replica;
    INSERT INTO kai.evidence_review_decisions (decision_id, organization_id, evidence_item_id, review_queue_item_id, decision_outcome,
        decided_by, decided_by_role, target_updated_at, created_by_type, created_at)
      VALUES ('00000000-0000-4000-8000-0000000005e1', '${SYNTHETIC_ORG}', '00000000-0000-4000-8000-0000000005b1', '00000000-0000-4000-8000-0000000005c1',
        'supported', '00000000-0000-4000-8000-0000000005d1', 'client_admin', now(), 'human', now());
    INSERT INTO kai.claim_review_decisions (decision_id, organization_id, claim_id, review_queue_item_id, decision_outcome, approved_audiences,
        decided_by, decided_by_role, target_updated_at, created_by_type, created_at)
      VALUES ('00000000-0000-4000-8000-0000000005e2', '${SYNTHETIC_ORG}', '00000000-0000-4000-8000-0000000005b2', '00000000-0000-4000-8000-0000000005c2',
        'approved', ARRAY['internal'], '00000000-0000-4000-8000-0000000005d1', 'client_admin', now(), 'human', now());
    INSERT INTO kai.coverage_review_decisions (coverage_review_decision_id, organization_id, claim_id, dimension_key, decision, state_fingerprint,
        decided_by, decided_by_role, created_by_type, created_at)
      VALUES ('00000000-0000-4000-8000-0000000005e3', '${SYNTHETIC_ORG}', '00000000-0000-4000-8000-0000000005b2', 'small_cell_risk',
        'accepted_internal_with_limitation', repeat('a', 64), '00000000-0000-4000-8000-0000000005d1', 'client_admin', 'human', now());`);
}

function expectGuardedRollbackRefuses(context) {
  const fingerprint = schemaFingerprint();
  const counts = clientAdminCounts();
  const refused = psqlFile(join(packetDir, FILES.rollback), { allowFailure: true });
  expect(refused.status !== 0 && /organization internal factual review authority rollback refused: client_admin review decisions exist/.test(refused.stderr),
    `${context}: R05 refuses with "rollback refused: client_admin review decisions exist"`);
  expect(schemaFingerprint() === fingerprint && clientAdminCounts() === counts,
    `${context}: the refused R05 changed no definition and kept every client_admin decision (${counts} evidence/claim/coverage)`);
}

function rehearse() {
  const capture05 = JSON.parse(readFileSync(captureFile, "utf8"));
  for (const [file, source] of [[FILES.migration, `migrations/${MIGRATION_05}.sql`], [FILES.rollback, `migrations/${MIGRATION_05}.rollback.sql`]]) {
    expect(sha256(join(packetDir, file)) === sha256(join(repoRoot, source)), `${file} is byte-identical to ${source}`);
  }

  console.log("Scenario 1: expected post-04 production baseline (2026-09-16 capture replica + accepted 01-04 packet)");
  buildPost04Replica("kai_pgadmin_packet_05_post04_synthetic");
  let rows = runPriorPacketQuery("99_FINAL_SCHEMA_VERIFICATION_READ_ONLY.sql");
  expect(overall(rows).status === "PASS", "the accepted 01-04 packet's 99 verifier PASSES on the baseline (it is the verified post-04 state)", rows);
  const post04Fingerprint = schemaFingerprint();

  rows = runPacketQuery(FILES.preflight);
  expect(rows.length === 27 && rows[rows.length - 1].check_id === "OVERALL" && rows[rows.length - 2].check_id === "M05",
    `preflight grid has 27 rows ending M05, OVERALL (as RUN_IN_PGADMIN.md states; got ${rows.length})`, rows);
  expect(preflightClass(rows) === "REQUIRED", `1. preflight classifies the post-04 baseline REQUIRED (${overall(rows).observed})`, rows);
  expect(rows.filter((row) => /^[AB]/.test(row.section)).every((row) => ["PASS", "INFO"].includes(row.status)),
    "   every environment, prerequisite and baseline row PASSES", rows);
  expect(rows.filter((row) => row.section === "C_MIGRATION_05_STATE" && row.check_id !== "C09").every((row) => row.status === "REQUIRED")
    && byId(rows, "C09").status === "NONE", "   every migration 05 object row (C01-C08, M05) is REQUIRED and C09 finds no stray object", rows);
  rows = runPacketQuery(FILES.verifier);
  expect(overall(rows).status === "FAIL", "05V FAILS before the migration", rows);
  rows = runPacketQuery(FILES.final);
  expect(overall(rows).status === "FAIL", "99 (05) FAILS before the migration", rows);
  rows = runPacketQuery(FILES.rollbackPrecheck);
  expect(byId(rows, "R05").status === "NOT_APPLIED", "RP05 reports NOT_APPLIED before the migration", rows);

  applyPacket05();
  expect(true, "2. the packaged forward migration applies (psql ON_ERROR_STOP, one transaction)");
  rows = runPacketQuery(FILES.verifier);
  expect(overall(rows).status === "PASS" && rows.every((row) => ["PASS", "INFO"].includes(row.status)),
    `3. 05V: every check PASSES, OVERALL = PASS (${rows.filter((row) => row.status === "PASS").length - 1} checks)`, rows);
  expect(rows.length === 14 && byId(rows, "V05.13").status === "INFO", `05V grid has 14 rows with V05.13 INFO (got ${rows.length})`, rows);
  rows = runPacketQuery(FILES.final);
  expect(rows.length === 37, `99 (05) grid has 37 rows (got ${rows.length})`, rows);
  expect(overall(rows).status === "PASS" && rows.every((row) => ["PASS", "INFO"].includes(row.status)), `   99 (05): OVERALL = PASS (${rows.length - 1} rows)`, rows);
  rows = runPriorPacketQuery("99_FINAL_SCHEMA_VERIFICATION_READ_ONLY.sql");
  const staleRows = rows.filter((row) => row.status === "FAIL" && row.check_id !== "OVERALL").map((row) => row.check_id).sort();
  expect(JSON.stringify(staleRows) === JSON.stringify(["B_TABLE kai.claim_review_decisions", "B_TABLE kai.coverage_review_decisions", "B_TABLE kai.evidence_review_decisions"]),
    `   after 05 the 01-04 packet's 99 FAILS exactly on the three tables 05 changes (${staleRows.join(", ")}); it is superseded by 99 (05)`, rows);
  rows = runPacketQuery(FILES.preflight);
  expect(preflightClass(rows) === "ALREADY_APPLIED" && byId(rows, "M05").observed === "uniform: ALREADY_APPLIED", "4. a second preflight classifies ALREADY_APPLIED (M05 uniform)", rows);

  const appliedFingerprint = schemaFingerprint();
  const appliedCounts = factualReviewObjectCounts();
  applyPacket05();
  expect(schemaFingerprint() === appliedFingerprint && factualReviewObjectCounts() === appliedCounts && appliedCounts === "4/3/4",
    `5. a replay of the packaged migration converges: identical schema fingerprint, no duplicate objects (functions/triggers/constraints = ${appliedCounts})`);
  rows = runPacketQuery(FILES.preflight);
  expect(preflightClass(rows) === "ALREADY_APPLIED", "   preflight after the replay is still ALREADY_APPLIED", rows);

  rows = runPacketQuery(FILES.rollbackPrecheck);
  expect(byId(rows, "R05").status === "SAFE_TO_ROLL_BACK" && rows.length === 3 && overall(rows).status === "SAFE_TO_ROLL_BACK",
    "6. RP05 with no customer decisions: SAFE_TO_ROLL_BACK (3 rows; OVERALL repeats R05)", rows);

  insertSyntheticClientAdminDecisions();
  expect(clientAdminCounts() === "1/1/1", "7. synthetic client_admin evidence, claim and coverage decisions recorded");
  rows = runPacketQuery(FILES.rollbackPrecheck);
  expect(byId(rows, "R05").status === "UNSAFE_ROLLBACK_REFUSES" && /evidence=1; claim=1; coverage=1/.test(byId(rows, "R05").observed),
    `8. RP05 identifies the protected decisions: UNSAFE_ROLLBACK_REFUSES (${byId(rows, "R05").observed})`, rows);
  expectGuardedRollbackRefuses("9");
  rows = runPacketQuery(FILES.verifier);
  expect(overall(rows).status === "PASS", "   05V still PASSES after the refused rollback", rows);

  // Rollback on the empty state restores the post-04 baseline exactly, and
  // the forward migration converges again.
  psqlExec(`SET session_replication_role = replica;
    DELETE FROM kai.coverage_review_decisions WHERE organization_id = '${SYNTHETIC_ORG}';
    DELETE FROM kai.claim_review_decisions WHERE organization_id = '${SYNTHETIC_ORG}';
    DELETE FROM kai.evidence_review_decisions WHERE organization_id = '${SYNTHETIC_ORG}';`);
  psqlFile(join(packetDir, FILES.rollback));
  expect(schemaFingerprint() === post04Fingerprint, "R05 on the empty state restores the post-04 baseline exactly (schema fingerprint equal)");
  rows = runPacketQuery(FILES.preflight);
  expect(preflightClass(rows) === "REQUIRED", "   preflight after R05 classifies REQUIRED again", rows);
  rows = runPriorPacketQuery("99_FINAL_SCHEMA_VERIFICATION_READ_ONLY.sql");
  expect(overall(rows).status === "PASS", "   the 01-04 packet's 99 PASSES again after R05", rows);
  applyPacket05();
  expect(schemaFingerprint() === appliedFingerprint, "   forward after rollback converges to the same applied schema");
  rows = runPacketQuery(FILES.rollbackPrecheck);
  expect(byId(rows, "R05").status === "SAFE_TO_ROLL_BACK", "   RP05 is SAFE again after the synthetic rows are gone", rows);

  // ---- STOP cases
  const stopCase = (title, name, setup, { through = 4, check } = {}) => {
    console.log(`Scenario: ${title}`);
    buildPost04Replica(name, { through });
    setup();
    const result = runPacketQuery(FILES.preflight);
    expect(preflightClass(result) === "STOP_INCOMPATIBLE", `${title}: preflight is STOP_INCOMPATIBLE (${overall(result).observed})`, result);
    if (check) check(result);
    return result;
  };
  const m05Row = (result) => byId(result, "M05");

  stopCase("partial 05: only the evidence role CHECK widened", "kai_pgadmin_packet_05_partial_constraint_synthetic", () => {
    psqlExec(`ALTER TABLE kai.evidence_review_decisions DROP CONSTRAINT evidence_review_decisions_p2_12_role_check,
      ADD CONSTRAINT evidence_review_decisions_p2_12_role_check CHECK (decided_by_role IN ('gk_reviewer', 'gk_admin', 'client_admin'));`);
  }, { check: (result) => expect(m05Row(result).status === "STOP_INCOMPATIBLE" && /mixed/.test(m05Row(result).observed), "   M05 reports a mixed (partial) state", result) });

  stopCase("partial 05: functions and triggers present, constraints original", "kai_pgadmin_packet_05_partial_triggers_synthetic", () => {
    const body = readFileSync(join(packetDir, FILES.migration), "utf8");
    const objectsOnly = body.slice(body.indexOf("CREATE OR REPLACE FUNCTION kai.organization_factual_review_is_measurement_evidence"), body.lastIndexOf("COMMIT;"));
    const file = join(workDir, "objects_only.sql");
    writeFileSync(file, objectsOnly);
    psqlFile(file);
  });

  stopCase("05 applied, then one scope trigger disabled", "kai_pgadmin_packet_05_disabled_trigger_synthetic", () => {
    applyPacket05();
    psqlExec("ALTER TABLE kai.claim_review_decisions DISABLE TRIGGER trg_organization_factual_review_claim_scope;");
  }, { check: () => {
    const v = runPacketQuery(FILES.verifier);
    expect(overall(v).status === "FAIL" && byId(v, "V05.7").status === "FAIL", "   05V FAILS on the disabled claim scope trigger (V05.7)", v);
    const f = runPacketQuery(FILES.final);
    expect(overall(f).status === "FAIL", "   99 (05) FAILS", f);
  } });

  stopCase("05 applied, then a scope function body changed", "kai_pgadmin_packet_05_changed_function_synthetic", () => {
    applyPacket05();
    psqlExec(`CREATE OR REPLACE FUNCTION kai.organization_factual_review_enforce_coverage_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;`);
  }, { check: () => {
    const v = runPacketQuery(FILES.verifier);
    expect(overall(v).status === "FAIL" && byId(v, "V05.8").status === "FAIL", "   05V FAILS on the changed coverage scope function (V05.8)", v);
  } });

  stopCase("05 applied, then the coverage role CHECK broadened to gk_admin", "kai_pgadmin_packet_05_broadened_synthetic", () => {
    applyPacket05();
    psqlExec(`ALTER TABLE kai.coverage_review_decisions DROP CONSTRAINT coverage_review_decisions_p2_10_decided_by_role_check,
      ADD CONSTRAINT coverage_review_decisions_p2_10_decided_by_role_check CHECK (decided_by_role IN ('gk_reviewer', 'gk_admin')
        OR (decided_by_role = 'client_admin' AND decision = 'accepted_internal_with_limitation'
            AND dimension_key IN ('small_cell_risk', 'conflicting_source_indicators', 'requirement_alignment')));`);
  }, { check: () => {
    const v = runPacketQuery(FILES.verifier);
    expect(overall(v).status === "FAIL" && byId(v, "V05.4").status === "FAIL" && byId(v, "V05.12").status === "FAIL" && /gk_admin/.test(byId(v, "V05.12").observed),
      "   05V FAILS the exact coverage definition (V05.4) and the coverage matrix names the gk_admin broadening (V05.12)", v);
  } });

  stopCase("prerequisite missing: 04 not applied", "kai_pgadmin_packet_05_without_04_synthetic", () => {}, {
    through: 3,
    check: (result) => expect(byId(result, "B01.4").status === "FAIL", "   B01.4 (migration 04 state) FAILS", result),
  });

  stopCase("prerequisite missing: evidence_measurements absent (03 not applied)", "kai_pgadmin_packet_05_without_03_synthetic", () => {
    psqlFile(join(priorPacketDir, PRIOR_PACKET_FILES[0]));
    psqlFile(join(priorPacketDir, PRIOR_PACKET_FILES[1]));
  }, { through: 0, check: (result) => expect(byId(result, "B01.3").status === "FAIL" && byId(result, "B02").status === "FAIL", "   B01.3 and B02 FAIL", result) });

  stopCase("drift: unexpected CHECK on kai.claim_review_decisions", "kai_pgadmin_packet_05_drift_synthetic", () => {
    psqlExec("ALTER TABLE kai.claim_review_decisions ADD CONSTRAINT unexpected_drift_check CHECK (decided_by_role <> 'gk_admin');");
  }, { check: (result) => expect(byId(result, "B_TABLE kai.claim_review_decisions").status === "FAIL", "   the claim_review_decisions baseline row FAILS and names the drift", result) });

  stopCase("drift: append-only trigger removed from kai.evidence_review_decisions", "kai_pgadmin_packet_05_append_only_synthetic", () => {
    psqlExec("DROP TRIGGER evidence_review_decisions_p2_12_append_only ON kai.evidence_review_decisions;");
  }, { check: (result) => expect(/evidence_review_decisions_p2_12_append_only missing/.test(byId(result, "B_TABLE kai.evidence_review_decisions").observed), "   the baseline row names the missing append-only trigger", result) });

  console.log("Scenario: the repository's normal chain without 05 (fresh-environment shape, informational)");
  createDatabase("kai_pgadmin_packet_05_chain_synthetic");
  buildChainWithout05();
  rows = runPacketQuery(FILES.preflight);
  console.log(`  repository chain preflight: ${preflightClass(rows)}; non-PASS rows: ${rows.filter((row) => !["PASS", "INFO", "REQUIRED"].includes(row.status) && row.check_id !== "OVERALL").map((row) => `${row.check_id}=${row.status}`).join(", ") || "none"}`);
  applyPacket05();
  rows = runPacketQuery(FILES.verifier);
  expect(overall(rows).status === "PASS", "05V PASSES on the repository chain after the packet file too", rows);

  console.log(`capture used: ${capture05.after.postgresql_version}`);
  console.log(`migration 05 packet rehearsal passed: ${assertions} assertions.`);
}

// ---------------------------------------------------------------- compat
function createOldCheckout() {
  const path = join(workDir, `checkout-${OLD_APP_REVISION}`);
  run("git", ["clone", "--quiet", "--shared", "--no-checkout", repoRoot, path]);
  run("git", ["checkout", "--quiet", "--detach", OLD_APP_REVISION], { cwd: path });
  symlinkSync(join(repoRoot, "node_modules"), join(path, "node_modules"));
  return path;
}
function removeCheckout(path) {
  if (!path || !existsSync(path)) return;
  // Unlink the node_modules symlink first so removal can never follow it.
  rmSync(join(path, "node_modules"), { force: true });
  rmSync(path, { recursive: true, force: true });
}

const specEnv = () => ({
  DATABASE_URL: SENTINEL_URL,
  DATABASE_URL_LOCAL: "",
  PGURL_LOCAL: "",
  RENDER_DATABASE_URL: "",
  PROD_DATABASE_URL: "",
  DB_HOST: "127.0.0.1",
  DB_PORT: port,
  DB_NAME: dbName,
  DB_USER: user,
  DB_PASSWORD: "",
  KAI_P2_01M_MEASUREMENT_DATABASE_URL: dbUrl(),
  KAI_PLAN_A_NORMAL_CHAIN: "1",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "sk-placeholder-not-used",
});
function runSpec(label, cwd, spec, extraEnv = {}) {
  console.log(`--- ${label}: node --test ${spec} (cwd ${cwd === repoRoot ? "current revision" : OLD_APP_REVISION})`);
  const result = run("node", ["--test", "--test-concurrency=1", spec], { cwd, env: { ...specEnv(), ...extraEnv }, inherit: true, allowFailure: true });
  expect(result.status === 0, `${label} passed`);
}

async function withClient(callback) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: dbUrl(), ssl: false });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}
const query = (sql, params = []) => withClient(async (client) => (await client.query(sql, params)).rows);

// One INSERT in its own transaction, rolled back unless keep; returns null
// when it succeeded, else the PostgreSQL error (the normal-chain runner's
// established helper).
async function tryInsert(sql, params, { disableTrigger = null, keep = false } = {}) {
  return withClient(async (client) => {
    await client.query("BEGIN");
    if (disableTrigger) await client.query(`ALTER TABLE ${disableTrigger.table} DISABLE TRIGGER ${disableTrigger.trigger}`);
    try {
      await client.query(sql, params);
    } catch (error) {
      await client.query("ROLLBACK");
      return error;
    }
    await client.query(keep ? "COMMIT" : "ROLLBACK");
    return null;
  });
}

const evidenceInsert = `INSERT INTO kai.evidence_review_decisions (organization_id, evidence_item_id, review_queue_item_id, decision_outcome,
    decided_by, decided_by_role, target_updated_at, supersedes_decision_id)
  VALUES ($1::uuid, $2::uuid, gen_random_uuid(), 'supported', $3::uuid, $4, now(), $5::uuid)`;
const claimInsert = `INSERT INTO kai.claim_review_decisions (organization_id, claim_id, review_queue_item_id, decision_outcome, approved_audiences,
    decided_by, decided_by_role, target_updated_at, supersedes_decision_id)
  VALUES ($1::uuid, $2::uuid, gen_random_uuid(), 'approved', $3::text[], $4::uuid, $5, now(), $6::uuid)`;
const coverageInsert = `INSERT INTO kai.coverage_review_decisions (organization_id, claim_id, dimension_key, decision, state_fingerprint, decided_by, decided_by_role)
  VALUES ($1::uuid, $2::uuid, $3, $4, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), $5::uuid, $6)`;
const headOf = (table, column) => `(SELECT d.decision_id::text FROM kai.${table} d WHERE d.${column} = X
    AND NOT EXISTS (SELECT 1 FROM kai.${table} s WHERE s.supersedes_decision_id = d.decision_id) LIMIT 1)`;

async function reviewedClaims() {
  const [measured] = await query(`SELECT c.organization_id::text AS organization_id, c.claim_id::text AS claim_id, e.evidence_item_id::text AS evidence_item_id,
      ${headOf("evidence_review_decisions", "evidence_item_id").replace("X", "e.evidence_item_id")} AS evidence_head,
      ${headOf("claim_review_decisions", "claim_id").replace("X", "c.claim_id")} AS claim_head
    FROM kai.claims c JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id AND e.organization_id = c.organization_id
   WHERE e.evidence_type = 'source_record_count_measurement'
     AND EXISTS (SELECT 1 FROM kai.claim_review_decisions d WHERE d.claim_id = c.claim_id)
     AND EXISTS (SELECT 1 FROM kai.gap_log_items g WHERE g.claim_id = c.claim_id AND g.dimension_key = 'small_cell_risk')
   ORDER BY c.claim_id LIMIT 1`);
  const [presence] = await query(`SELECT c.organization_id::text AS organization_id, c.claim_id::text AS claim_id, e.evidence_item_id::text AS evidence_item_id,
      ${headOf("evidence_review_decisions", "evidence_item_id").replace("X", "e.evidence_item_id")} AS evidence_head,
      ${headOf("claim_review_decisions", "claim_id").replace("X", "c.claim_id")} AS claim_head
    FROM kai.claims c JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id AND e.organization_id = c.organization_id
   WHERE e.evidence_type = 'dictionary_field_presence_fact' ORDER BY c.claim_id LIMIT 1`);
  if (!measured?.evidence_head || !measured.claim_head || !presence) throw new Error(`no reviewed measured and field-presence claims: ${JSON.stringify({ measured, presence })}`);
  return { measured, presence };
}

const ACTOR = "00000000-0000-4000-8000-00000000c0a5";

// Step 10: in-scope and out-of-scope role, audience and decision cases,
// through the live constraints and triggers of the packet-migrated schema.
async function proveDirectInsertScope({ measured, presence }) {
  const claimScopeOff = { disableTrigger: { table: "kai.claim_review_decisions", trigger: "trg_organization_factual_review_claim_scope" } };
  const rejected = [
    ["client_admin evidence decision on field-presence evidence", evidenceInsert, [presence.organization_id, presence.evidence_item_id, ACTOR, "client_admin", presence.evidence_head], {}, /may only bind source-record-count measurement evidence/],
    ["client_admin evidence decision superseding a GK decision", evidenceInsert, [measured.organization_id, measured.evidence_item_id, ACTOR, "client_admin", measured.evidence_head], {}, /may not supersede a Get Kinder decision/],
    ["client_admin claim decision on a field-presence claim", claimInsert, [presence.organization_id, presence.claim_id, ["internal"], ACTOR, "client_admin", presence.claim_head], {}, /claim on source-record-count measurement evidence/],
    ["client_admin claim decision superseding a GK decision", claimInsert, [measured.organization_id, measured.claim_id, ["internal"], ACTOR, "client_admin", measured.claim_head], {}, /may not supersede a Get Kinder decision/],
    ["client_admin claim approval for internal+funder", claimInsert, [measured.organization_id, measured.claim_id, ["internal", "funder"], ACTOR, "client_admin", null], claimScopeOff, /claim_review_decisions_organization_internal_audience_check/],
    ["client_admin claim approval for public", claimInsert, [measured.organization_id, measured.claim_id, ["public"], ACTOR, "client_admin", null], claimScopeOff, /claim_review_decisions_organization_internal_audience_check/],
    ["client_admin claim approval for internal+funder with the scope trigger enabled", claimInsert, [measured.organization_id, measured.claim_id, ["internal", "funder"], ACTOR, "client_admin", null], {}, /claim_review_decisions_organization_internal_audience_check/],
    ["client_admin funder coverage acceptance", coverageInsert, [measured.organization_id, measured.claim_id, "small_cell_risk", "accepted_funder_with_limitation", ACTOR, "client_admin"], {}, /coverage_review_decisions_p2_10_decided_by_role_check/],
    ["client_admin public coverage acceptance", coverageInsert, [measured.organization_id, measured.claim_id, "small_cell_risk", "accepted_public_with_limitation", ACTOR, "client_admin"], {}, /coverage_review_decisions_p2_10_decided_by_role_check/],
    ["client_admin acceptance of a measurement-decided dimension (missingness)", coverageInsert, [measured.organization_id, measured.claim_id, "missingness", "accepted_internal_with_limitation", ACTOR, "client_admin"], {}, /coverage_review_decisions_p2_10_decided_by_role_check/],
    ["client_admin acceptance on a field-presence claim", coverageInsert, [presence.organization_id, presence.claim_id, "small_cell_risk", "accepted_internal_with_limitation", ACTOR, "client_admin"], {}, /claim on source-record-count measurement evidence/],
    ["client_reviewer evidence decision", evidenceInsert, [measured.organization_id, measured.evidence_item_id, ACTOR, "client_reviewer", measured.evidence_head], {}, /evidence_review_decisions_p2_12_role_check/],
    ["client_reviewer claim decision", claimInsert, [measured.organization_id, measured.claim_id, ["internal"], ACTOR, "client_reviewer", measured.claim_head], {}, /claim_review_decisions_p2_12_role_check/],
    ["gk_operator coverage acceptance", coverageInsert, [measured.organization_id, measured.claim_id, "small_cell_risk", "accepted_internal_with_limitation", ACTOR, "gk_operator"], {}, /coverage_review_decisions_p2_10_decided_by_role_check/],
    ["gk_admin coverage acceptance (P2-10 unchanged)", coverageInsert, [measured.organization_id, measured.claim_id, "small_cell_risk", "accepted_internal_with_limitation", ACTOR, "gk_admin"], {}, /coverage_review_decisions_p2_10_decided_by_role_check/],
  ];
  for (const [label, sql, params, options, pattern] of rejected) {
    const error = await tryInsert(sql, params, options);
    expect(error && error.code === "23514" && pattern.test(`${error.message} ${error.constraint || ""}`),
      `rejected (23514): ${label}${error ? ` [${error.constraint || error.message}]` : " [ACCEPTED]"}`);
  }
  const accepted = [
    ["gk_reviewer evidence decision superseding a GK decision", evidenceInsert, [measured.organization_id, measured.evidence_item_id, ACTOR, "gk_reviewer", measured.evidence_head]],
    ["gk_admin evidence decision superseding a GK decision", evidenceInsert, [measured.organization_id, measured.evidence_item_id, ACTOR, "gk_admin", measured.evidence_head]],
    ["gk_admin claim decision approving internal+funder", claimInsert, [measured.organization_id, measured.claim_id, ["internal", "funder"], ACTOR, "gk_admin", measured.claim_head]],
    ["gk_reviewer claim decision approving public", claimInsert, [measured.organization_id, measured.claim_id, ["public"], ACTOR, "gk_reviewer", measured.claim_head]],
    ["gk_reviewer funder coverage acceptance", coverageInsert, [measured.organization_id, measured.claim_id, "small_cell_risk", "accepted_funder_with_limitation", ACTOR, "gk_reviewer"]],
    ["gk_reviewer internal acceptance of missingness", coverageInsert, [measured.organization_id, measured.claim_id, "missingness", "accepted_internal_with_limitation", ACTOR, "gk_reviewer"]],
    ["client_admin internal acceptance of small_cell_risk on the measured claim", coverageInsert, [measured.organization_id, measured.claim_id, "small_cell_risk", "accepted_internal_with_limitation", ACTOR, "client_admin"]],
    ["client_admin internal acceptance of requirement_alignment on the measured claim", coverageInsert, [measured.organization_id, measured.claim_id, "requirement_alignment", "accepted_internal_with_limitation", ACTOR, "client_admin"]],
  ];
  for (const [label, sql, params] of accepted) {
    const error = await tryInsert(sql, params);
    expect(!error, `accepted (rolled back): ${label}${error ? ` [${error.code} ${error.message}]` : ""}`);
  }
}

// What an application rollback to 96653f8 would change while client_admin
// decisions exist: P2-06 (evaluateClaimTraceabilityInTransaction) in each
// revision, evaluated inside one rolled-back transaction in which the measured
// evidence's current decision is an organization (client_admin) decision and
// GK has approved the claim for funder use.
async function compareP206AcrossRevisions(oldCheckout, { measured }) {
  const load = async (root) => (await import(pathToFileURL(join(root, "Backend/kai/dictionary/postgresClaimTraceabilityRepository.js")).href)).evaluateClaimTraceabilityInTransaction;
  const evaluateOld = await load(oldCheckout);
  const evaluateNew = await load(repoRoot);
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("ALTER TABLE kai.evidence_review_decisions DISABLE TRIGGER trg_organization_factual_review_evidence_scope");
      await client.query(evidenceInsert, [measured.organization_id, measured.evidence_item_id, ACTOR, "client_admin", measured.evidence_head]);
      await client.query(claimInsert, [measured.organization_id, measured.claim_id, ["internal", "funder"], ACTOR, "gk_reviewer", measured.claim_head]);
      const reasons = async (evaluate, audience) => {
        await client.query("SAVEPOINT p206");
        const result = await evaluate(client, { organizationId: measured.organization_id, claimId: measured.claim_id, requestedAudience: audience });
        await client.query("ROLLBACK TO SAVEPOINT p206");
        if (!result.ok || !Array.isArray(result.data?.blockerCodes)) throw new Error(`P2-06 evaluation did not complete: ${JSON.stringify(result)}`);
        return { eligible: result.data.eligible, blockerCodes: result.data.blockerCodes,
          evidenceHeadRole: result.data.evidence_review_decision?.decided_by_role ?? null };
      };
      const out = {};
      for (const audience of ["internal", "funder"]) {
        out[audience] = { old: await reasons(evaluateOld, audience), new: await reasons(evaluateNew, audience) };
      }
      return out;
    } finally {
      await client.query("ROLLBACK");
    }
  });
}

async function compat() {
  for (const [file, source] of [[FILES.migration, `migrations/${MIGRATION_05}.sql`], [FILES.rollback, `migrations/${MIGRATION_05}.rollback.sql`]]) {
    expect(sha256(join(packetDir, file)) === sha256(join(repoRoot, source)), `${file} is byte-identical to ${source}`);
  }
  const migrationDiff = run("git", ["diff", "--name-status", OLD_APP_REVISION, "HEAD", "--", "migrations", "scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql",
    "scripts/kai-sprint2-join-1-organization-join-requests-bootstrap-synthetic-schema.sql", "scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql"]).stdout.trim();
  expect(migrationDiff === `A\tmigrations/${MIGRATION_05}.rollback.sql\nA\tmigrations/${MIGRATION_05}.sql`,
    `${OLD_APP_REVISION}..HEAD changes no migration or bootstrap file except adding migration 05 and its rollback`);
  let checkout = null;
  try {
    checkout = createOldCheckout();
    expect(run("git", ["rev-parse", "HEAD"], { cwd: checkout }).stdout.trim().startsWith(OLD_APP_REVISION), `temporary clone is at ${OLD_APP_REVISION}`);

    // ---- Rollout order: database migrated while the previous application serves.
    console.log(`Rollout database: chain through 04 (legacy seed by ${OLD_APP_REVISION}), then the packet's 05 file`);
    createDatabase("kai_pgadmin_packet_05_compat_rollout_synthetic");
    buildChainWithout05({ beforeMigration: (migration) => {
      if (migration === "kai_sprint2_p2_01m_source_record_count_measurement") {
        runSpec(`${OLD_APP_REVISION} P2-01M legacy seed`, checkout, "__tests__/kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js", { KAI_P2_01M_PHASE: "legacy_seed" });
      }
    } });
    let rows = runPacketQuery(FILES.preflight);
    console.log(`  preflight on the repository chain: ${preflightClass(rows)}`);
    applyPacket05();
    rows = runPacketQuery(FILES.verifier);
    expect(overall(rows).status === "PASS", "05V PASSES on the migrated repository chain", rows);
    rows = runPacketQuery(FILES.rollbackPrecheck);
    expect(byId(rows, "R05").status === "SAFE_TO_ROLL_BACK", "RP05 SAFE_TO_ROLL_BACK before any customer decision", rows);

    runSpec(`OLD APP ${OLD_APP_REVISION} on the migrated schema: GK evidence review, claim review and coverage acceptance to eligibility, generation, organization release and Markdown`,
      checkout, "__tests__/kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js");
    expect(clientAdminCounts() === "0/0/0", `${OLD_APP_REVISION} wrote no client_admin review decision`);

    // ---- The current application on the same database afterwards.
    runSpec("NEW APP (HEAD) organization factual review refusals on the same database", repoRoot, "__tests__/kai-organization-factual-review-authority.integration.spec.js");
    const claims = await reviewedClaims();
    await proveDirectInsertScope(claims);

    // Real, trigger-checked client_admin rows (step 7): one of each kind, each
    // the first decision of its lineage (the P2-12 root-per-lineage index
    // admits one root per evidence item or claim).
    const [undecidedEvidence] = await query(`SELECT e.organization_id::text AS organization_id, e.evidence_item_id::text AS evidence_item_id
        FROM kai.evidence_items e WHERE e.evidence_type = 'source_record_count_measurement'
         AND NOT EXISTS (SELECT 1 FROM kai.evidence_review_decisions d WHERE d.evidence_item_id = e.evidence_item_id) ORDER BY e.evidence_item_id LIMIT 1`);
    const [undecidedClaim] = await query(`SELECT c.organization_id::text AS organization_id, c.claim_id::text AS claim_id
        FROM kai.claims c JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id AND e.organization_id = c.organization_id
       WHERE e.evidence_type = 'source_record_count_measurement'
         AND NOT EXISTS (SELECT 1 FROM kai.claim_review_decisions d WHERE d.claim_id = c.claim_id) ORDER BY c.claim_id LIMIT 1`);
    if (!undecidedEvidence || !undecidedClaim) throw new Error(`no undecided measurement evidence or claim left by the proof: ${JSON.stringify({ undecidedEvidence, undecidedClaim })}`);
    for (const [label, sql, params] of [
      ["client_admin evidence decision (lineage root) on measurement evidence", evidenceInsert, [undecidedEvidence.organization_id, undecidedEvidence.evidence_item_id, ACTOR, "client_admin", null]],
      ["client_admin internal claim approval (lineage root) on a measured claim", claimInsert, [undecidedClaim.organization_id, undecidedClaim.claim_id, ["internal"], ACTOR, "client_admin", null]],
      ["client_admin internal acceptance of conflicting_source_indicators", coverageInsert, [claims.measured.organization_id, claims.measured.claim_id, "conflicting_source_indicators", "accepted_internal_with_limitation", ACTOR, "client_admin"]],
    ]) {
      const error = await tryInsert(sql, params, { keep: true });
      expect(!error, `kept through the live triggers: ${label}${error ? ` [${error.code} ${error.message}]` : ""}`);
    }
    rows = runPacketQuery(FILES.rollbackPrecheck);
    expect(byId(rows, "R05").status === "UNSAFE_ROLLBACK_REFUSES" && /evidence=1; claim=1; coverage=1/.test(byId(rows, "R05").observed),
      `RP05 identifies the protected decisions (${byId(rows, "R05").observed})`, rows);
    expectGuardedRollbackRefuses("compat");

    const p206 = await compareP206AcrossRevisions(checkout, claims);
    console.log(`P2-06 with a client_admin evidence head and a GK internal+funder claim approval: ${JSON.stringify(p206)}`);
    expect(p206.funder.new.blockerCodes.includes("evidence_review_unresolved") && !p206.internal.new.blockerCodes.includes("evidence_review_unresolved"),
      `HEAD P2-06: the organization evidence decision counts for internal use only (funder blockers: ${p206.funder.new.blockerCodes.join(", ")})`);
    expect(!p206.internal.old.blockerCodes.includes("evidence_review_unresolved"), `${OLD_APP_REVISION} P2-06 also counts it for internal use`);
    const oldCounts = !p206.funder.old.blockerCodes.includes("evidence_review_unresolved");
    console.log(`APP-ROLLBACK FINDING: ${OLD_APP_REVISION} P2-06 ${oldCounts ? "DOES" : "does not"} count a client_admin evidence decision as the evidence review for funder use `
      + `(funder blockers ${OLD_APP_REVISION}: ${p206.funder.old.blockerCodes.join(", ") || "none"}; HEAD: ${p206.funder.new.blockerCodes.join(", ")}).`);

    // ---- The current application on a fresh packet-migrated database.
    console.log("New-application database: chain through 04 (legacy seed by HEAD), then the packet's 05 file");
    createDatabase("kai_pgadmin_packet_05_compat_new_synthetic");
    buildChainWithout05({ beforeMigration: (migration) => {
      if (migration === "kai_sprint2_p2_01m_source_record_count_measurement") {
        runSpec("HEAD P2-01M legacy seed", repoRoot, "__tests__/kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js", { KAI_P2_01M_PHASE: "legacy_seed" });
      }
    } });
    applyPacket05();
    runSpec("NEW APP (HEAD) on the migrated schema: GK review path to eligibility, generation, organization release and Markdown", repoRoot,
      "__tests__/kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js");
    runSpec("NEW APP (HEAD) organization factual review refusals", repoRoot, "__tests__/kai-organization-factual-review-authority.integration.spec.js");
    rows = runPacketQuery(FILES.final);
    expect(overall(rows).status === "PASS", "99 (05) PASSES on the new-application database after its workflow", rows);
    console.log(`migration 05 packet compatibility passed: ${assertions} assertions.`);
  } finally {
    removeCheckout(checkout);
  }
}

// The assembled browser acceptance on a schema that includes the packet's 05.
function compatBrowser(which) {
  if (!["old", "new"].includes(which)) throw new Error("compat-browser needs old | new");
  const runner = "scripts/kai-sprint2-plan-a-assembled-file-to-report-local-postgres.js";
  const chainModule = "scripts/kai-sprint2-plan-a-migration-chain.js";
  expect(sha256(join(packetDir, FILES.migration)) === sha256(join(repoRoot, `migrations/${MIGRATION_05}.sql`)), "the packet's 05 file is byte-identical to the repository migration");
  if (which === "new") {
    expect(readFileSync(join(repoRoot, chainModule), "utf8").includes(`"${MIGRATION_05}",`), "the current chain applies migration 05 (the packet file's exact bytes)");
    const result = run("node", [runner], { inherit: true, allowFailure: true });
    expect(result.status === 0, "NEW APP (HEAD) assembled file-to-report browser acceptance passed on the 05 schema");
    return;
  }
  let checkout = null;
  try {
    checkout = createOldCheckout();
    // Test arrangement in the temporary clone only: the old chain ends at 04;
    // add the packet's 05 file after it and commit there, because the runner
    // verifies the chain against each migration's introducing commit.
    copyFileSync(join(packetDir, FILES.migration), join(checkout, `migrations/${MIGRATION_05}.sql`));
    const chainPath = join(checkout, chainModule);
    const source = readFileSync(chainPath, "utf8");
    const anchor = "  \"kai_sprint2_plan_a_organization_internal_release_authority\",\n];";
    if (!source.includes(anchor)) throw new Error(`the ${OLD_APP_REVISION} chain did not end where expected`);
    writeFileSync(chainPath, source.replace(anchor, `  "kai_sprint2_plan_a_organization_internal_release_authority",\n  "${MIGRATION_05}",\n];`));
    run("git", ["add", `migrations/${MIGRATION_05}.sql`, chainModule], { cwd: checkout });
    run("git", ["-c", "user.name=packet-05-rehearsal", "-c", "user.email=packet-05-rehearsal@localhost", "commit", "--quiet", "--no-verify",
      "-m", "temporary test arrangement: migration 05 packet file on the previous application"], { cwd: checkout });
    expect(run("git", ["rev-parse", "HEAD~1"], { cwd: checkout }).stdout.trim().startsWith(OLD_APP_REVISION), `old application code is ${OLD_APP_REVISION} plus only the packet file and its chain entry`);
    const result = run("node", [runner], { cwd: checkout, inherit: true, allowFailure: true,
      env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY || "sk-placeholder-not-used" } });
    expect(result.status === 0, `OLD APP ${OLD_APP_REVISION} assembled file-to-report browser acceptance (GK reviews) passed on the 05 schema`);
  } finally {
    removeCheckout(checkout);
  }
}

let started = false;
try {
  if (mode === "compat-browser") {
    compatBrowser(process.argv[3]);
  } else {
    mkdirSync(socketDir, { recursive: true });
    run(join(binDir, "initdb"), ["-D", dataDir, "--no-locale", "--encoding=UTF8"]);
    run(join(binDir, "pg_ctl"), ["-D", dataDir, "-l", join(workDir, "postgres.log"), "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "-w", "start"]);
    started = true;
    if (mode === "capture") capture();
    else if (mode === "rehearse") rehearse();
    else await compat();
  }
} finally {
  if (started) spawnSync(join(binDir, "pg_ctl"), ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8" });
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  console.log(`ephemeral workdir removed: ${workDir}`);
}
