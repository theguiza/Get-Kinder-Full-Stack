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
 *
 * The organization internal release authority migration (owner amendment
 * 2026-10-23) is also proven here: its two role constraints before and after,
 * a replay that changes nothing, a rollback on the empty state that restores
 * the P3-16 / P3-17 definitions exactly, and, after the proof has recorded
 * real client_admin release decisions, a rollback that refuses and changes
 * nothing.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { MIGRATION_CHAIN, PRODUCTION_HISTORY_ONLY, verifyChainAgainstRepository } from "./kai-sprint2-plan-a-migration-chain.js";

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

const P2_01M_MIGRATION = "kai_sprint2_p2_01m_source_record_count_measurement";
const ORGANIZATION_RELEASE_MIGRATION = "kai_sprint2_plan_a_organization_internal_release_authority";
const releaseRoleConstraintsSql = `SELECT conrelid::regclass::text || '.' || conname AS name, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conname IN ('limitation_snapshots_p3_16_confirmed_by_role_check', 'human_authority_decisions_p3_17_role_by_type_check') ORDER BY 1`;
const releaseTriggersSql = `SELECT tgrelid::regclass::text || '.' || tgname AS name FROM pg_trigger
    WHERE tgname IN ('trg_organization_release_limitation_snapshot_scope', 'trg_organization_release_decision_scope') ORDER BY 1`;

const FACTUAL_REVIEW_MIGRATION = "kai_sprint2_plan_a_organization_internal_factual_review_authority";
const factualReviewConstraintsSql = `SELECT conrelid::regclass::text || '.' || conname AS name, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conname IN ('evidence_review_decisions_p2_12_role_check', 'claim_review_decisions_p2_12_role_check',
      'claim_review_decisions_organization_internal_audience_check', 'coverage_review_decisions_p2_10_decided_by_role_check') ORDER BY 1`;
const factualReviewTriggersSql = `SELECT tgrelid::regclass::text || '.' || tgname AS name FROM pg_trigger
    WHERE tgname IN ('trg_organization_factual_review_evidence_scope', 'trg_organization_factual_review_claim_scope',
      'trg_organization_factual_review_coverage_scope') ORDER BY 1`;

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

async function proveOrganizationReleaseMigration() {
  const original = await catalog(releaseRoleConstraintsSql);
  for (const row of original) console.log(`Plan A release migration: original ${row.name}: ${row.definition}`);
  if (original.length !== 2) throw new Error("both P3-16 / P3-17 role constraints must exist before the organization release migration");
  psqlFile(`migrations/${ORGANIZATION_RELEASE_MIGRATION}.sql`);
  const widened = await catalog(releaseRoleConstraintsSql);
  for (const row of widened) console.log(`Plan A release migration: resulting ${row.name}: ${row.definition}`);
  console.log(`Plan A release migration: triggers ${(await catalog(releaseTriggersSql)).map((row) => row.name).join(", ")}`);
  const applied = (await catalog(schemaFingerprintSql))[0].fingerprint;
  psqlFile(`migrations/${ORGANIZATION_RELEASE_MIGRATION}.sql`);
  if ((await catalog(schemaFingerprintSql))[0].fingerprint !== applied) throw new Error("re-applying the organization release migration changed the schema");
  console.log("Plan A release migration: a replay changed nothing.");
  psqlFile(`migrations/${ORGANIZATION_RELEASE_MIGRATION}.rollback.sql`);
  if (JSON.stringify(await catalog(releaseRoleConstraintsSql)) !== JSON.stringify(original) || (await catalog(releaseTriggersSql)).length !== 0) {
    throw new Error("the organization release rollback did not restore the P3-16 / P3-17 definitions exactly");
  }
  console.log("Plan A release migration: rollback on the empty state restored the original definitions exactly.");
  psqlFile(`migrations/${ORGANIZATION_RELEASE_MIGRATION}.sql`);
  if ((await catalog(schemaFingerprintSql))[0].fingerprint !== applied) throw new Error("re-applying after rollback did not converge");
  console.log("Plan A release migration: forward -> replay -> rollback -> forward converged.");
}

async function proveOrganizationFactualReviewMigration() {
  const original = await catalog(factualReviewConstraintsSql);
  for (const row of original) console.log(`Plan A factual review migration: original ${row.name}: ${row.definition}`);
  if (original.length !== 3) throw new Error("the three P2-12 / P2-10 decision-role constraints must exist before the organization factual review migration");
  psqlFile(`migrations/${FACTUAL_REVIEW_MIGRATION}.sql`);
  for (const row of await catalog(factualReviewConstraintsSql)) console.log(`Plan A factual review migration: resulting ${row.name}: ${row.definition}`);
  console.log(`Plan A factual review migration: triggers ${(await catalog(factualReviewTriggersSql)).map((row) => row.name).join(", ")}`);
  const applied = (await catalog(schemaFingerprintSql))[0].fingerprint;
  psqlFile(`migrations/${FACTUAL_REVIEW_MIGRATION}.sql`);
  if ((await catalog(schemaFingerprintSql))[0].fingerprint !== applied) throw new Error("re-applying the organization factual review migration changed the schema");
  console.log("Plan A factual review migration: a replay changed nothing.");
  psqlFile(`migrations/${FACTUAL_REVIEW_MIGRATION}.rollback.sql`);
  if (JSON.stringify(await catalog(factualReviewConstraintsSql)) !== JSON.stringify(original) || (await catalog(factualReviewTriggersSql)).length !== 0) {
    throw new Error("the organization factual review rollback did not restore the P2-12 / P2-10 definitions exactly");
  }
  console.log("Plan A factual review migration: rollback on the empty state restored the original definitions exactly.");
  psqlFile(`migrations/${FACTUAL_REVIEW_MIGRATION}.sql`);
  if ((await catalog(schemaFingerprintSql))[0].fingerprint !== applied) throw new Error("re-applying the factual review migration after rollback did not converge");
  console.log("Plan A factual review migration: forward -> replay -> rollback -> forward converged.");
}

// One INSERT inside its own transaction, always rolled back unless keep:
// returns null when it succeeded, else the PostgreSQL error.
async function tryInsert(sql, params, { disableTrigger = null, keep = false } = {}) {
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
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
  } finally {
    await client.end();
  }
}

// Direct database inserts against the real lineage the P2-01M proof
// created (GK-reviewed measured and field-presence claims): the client_admin
// scope the migration pins, and GK inserts unchanged. The real
// organization decisions through the routes are proven by the assembled
// browser acceptance.
async function proveOrganizationFactualReviewScope() {
  const [measured] = await catalog(`SELECT c.organization_id::text AS organization_id, c.claim_id::text AS claim_id, e.evidence_item_id::text AS evidence_item_id,
      (SELECT d.decision_id::text FROM kai.evidence_review_decisions d WHERE d.evidence_item_id = e.evidence_item_id
        AND NOT EXISTS (SELECT 1 FROM kai.evidence_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)) AS evidence_head,
      (SELECT d.decided_by_role FROM kai.evidence_review_decisions d WHERE d.evidence_item_id = e.evidence_item_id
        AND NOT EXISTS (SELECT 1 FROM kai.evidence_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)) AS evidence_head_role,
      (SELECT d.decision_id::text FROM kai.claim_review_decisions d WHERE d.claim_id = c.claim_id
        AND NOT EXISTS (SELECT 1 FROM kai.claim_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)) AS claim_head
    FROM kai.claims c JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id AND e.organization_id = c.organization_id
   WHERE e.evidence_type = 'source_record_count_measurement'
     AND EXISTS (SELECT 1 FROM kai.claim_review_decisions d WHERE d.claim_id = c.claim_id)
     AND EXISTS (SELECT 1 FROM kai.gap_log_items g WHERE g.claim_id = c.claim_id AND g.dimension_key = 'small_cell_risk')
   ORDER BY c.claim_id LIMIT 1`);
  const [presence] = await catalog(`SELECT c.organization_id::text AS organization_id, c.claim_id::text AS claim_id, e.evidence_item_id::text AS evidence_item_id
    FROM kai.claims c JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id AND e.organization_id = c.organization_id
   WHERE e.evidence_type = 'dictionary_field_presence_fact' ORDER BY c.claim_id LIMIT 1`);
  if (!measured?.evidence_head || !measured.claim_head || !presence) throw new Error(`the P2-01M proof left no reviewed measured and field-presence claims: ${JSON.stringify({ measured, presence })}`);
  if (!["gk_reviewer", "gk_admin"].includes(measured.evidence_head_role)) throw new Error(`the measured evidence head is not a GK decision: ${measured.evidence_head_role}`);
  const actor = "00000000-0000-4000-8000-00000000c0a1";
  const evidenceInsert = `INSERT INTO kai.evidence_review_decisions (organization_id, evidence_item_id, review_queue_item_id, decision_outcome,
      decided_by, decided_by_role, target_updated_at, supersedes_decision_id)
    VALUES ($1::uuid, $2::uuid, gen_random_uuid(), 'supported', $3::uuid, $4, now(), $5::uuid)`;
  const claimInsert = `INSERT INTO kai.claim_review_decisions (organization_id, claim_id, review_queue_item_id, decision_outcome, approved_audiences,
      decided_by, decided_by_role, target_updated_at, supersedes_decision_id)
    VALUES ($1::uuid, $2::uuid, gen_random_uuid(), 'approved', $3::text[], $4::uuid, $5, now(), $6::uuid)`;
  const coverageInsert = `INSERT INTO kai.coverage_review_decisions (organization_id, claim_id, dimension_key, decision, state_fingerprint, decided_by, decided_by_role)
    VALUES ($1::uuid, $2::uuid, $3, $4, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), $5::uuid, $6)`;
  const presenceEvidenceHead = (await catalog(`SELECT d.decision_id::text AS id FROM kai.evidence_review_decisions d WHERE d.evidence_item_id = $1::uuid
      AND NOT EXISTS (SELECT 1 FROM kai.evidence_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)`, [presence.evidence_item_id]))[0]?.id ?? null;
  const presenceClaimHead = (await catalog(`SELECT d.decision_id::text AS id FROM kai.claim_review_decisions d WHERE d.claim_id = $1::uuid
      AND NOT EXISTS (SELECT 1 FROM kai.claim_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)`, [presence.claim_id]))[0]?.id ?? null;

  const rejected = [
    ["client_admin evidence decision on field-presence evidence", evidenceInsert,
      [presence.organization_id, presence.evidence_item_id, actor, "client_admin", presenceEvidenceHead], {}, /may only bind source-record-count measurement evidence/],
    ["client_admin evidence decision superseding a GK decision", evidenceInsert,
      [measured.organization_id, measured.evidence_item_id, actor, "client_admin", measured.evidence_head], {}, /may not supersede a Get Kinder decision/],
    ["client_admin claim decision on a field-presence claim", claimInsert,
      [presence.organization_id, presence.claim_id, ["internal"], actor, "client_admin", presenceClaimHead], {}, /claim on source-record-count measurement evidence/],
    ["client_admin claim decision superseding a GK decision", claimInsert,
      [measured.organization_id, measured.claim_id, ["internal"], actor, "client_admin", measured.claim_head], {}, /may not supersede a Get Kinder decision/],
    ["client_admin claim approval for funder", claimInsert,
      [measured.organization_id, measured.claim_id, ["internal", "funder"], actor, "client_admin", measured.claim_head],
      { disableTrigger: { table: "kai.claim_review_decisions", trigger: "trg_organization_factual_review_claim_scope" } }, /claim_review_decisions_organization_internal_audience_check/],
    ["client_admin claim approval for public", claimInsert,
      [measured.organization_id, measured.claim_id, ["public"], actor, "client_admin", measured.claim_head],
      { disableTrigger: { table: "kai.claim_review_decisions", trigger: "trg_organization_factual_review_claim_scope" } }, /claim_review_decisions_organization_internal_audience_check/],
    ["client_admin funder coverage acceptance", coverageInsert,
      [measured.organization_id, measured.claim_id, "small_cell_risk", "accepted_funder_with_limitation", actor, "client_admin"], {}, /coverage_review_decisions_p2_10_decided_by_role_check/],
    ["client_admin public coverage acceptance", coverageInsert,
      [measured.organization_id, measured.claim_id, "small_cell_risk", "accepted_public_with_limitation", actor, "client_admin"], {}, /coverage_review_decisions_p2_10_decided_by_role_check/],
    ["client_admin acceptance of a measurement-decided dimension", coverageInsert,
      [measured.organization_id, measured.claim_id, "missingness", "accepted_internal_with_limitation", actor, "client_admin"], {}, /coverage_review_decisions_p2_10_decided_by_role_check/],
    ["client_admin acceptance on a field-presence claim", coverageInsert,
      [presence.organization_id, presence.claim_id, "small_cell_risk", "accepted_internal_with_limitation", actor, "client_admin"], {}, /claim on source-record-count measurement evidence/],
    ["client_reviewer evidence decision", evidenceInsert,
      [measured.organization_id, measured.evidence_item_id, actor, "client_reviewer", measured.evidence_head], {}, /evidence_review_decisions_p2_12_role_check/],
    ["gk_operator coverage acceptance", coverageInsert,
      [measured.organization_id, measured.claim_id, "small_cell_risk", "accepted_internal_with_limitation", actor, "gk_operator"], {}, /coverage_review_decisions_p2_10_decided_by_role_check/],
    ["gk_admin coverage acceptance (P2-10 unchanged)", coverageInsert,
      [measured.organization_id, measured.claim_id, "small_cell_risk", "accepted_internal_with_limitation", actor, "gk_admin"], {}, /coverage_review_decisions_p2_10_decided_by_role_check/],
  ];
  for (const [label, sql, params, options, pattern] of rejected) {
    const error = await tryInsert(sql, params, options);
    if (!error || error.code !== "23514" || !pattern.test(`${error.message} ${error.constraint || ""}`)) {
      throw new Error(`direct insert was not rejected as expected (${label}): ${error ? `${error.code} ${error.message}` : "accepted"}`);
    }
    console.log(`Plan A factual review scope: rejected ${label} (${error.constraint || error.message})`);
  }
  const accepted = [
    ["gk_reviewer evidence decision superseding a GK decision", evidenceInsert,
      [measured.organization_id, measured.evidence_item_id, actor, "gk_reviewer", measured.evidence_head]],
    ["gk_admin claim decision approving funder", claimInsert,
      [measured.organization_id, measured.claim_id, ["internal", "funder"], actor, "gk_admin", measured.claim_head]],
    ["gk_reviewer funder coverage acceptance", coverageInsert,
      [measured.organization_id, measured.claim_id, "small_cell_risk", "accepted_funder_with_limitation", actor, "gk_reviewer"]],
  ];
  for (const [label, sql, params] of accepted) {
    const error = await tryInsert(sql, params);
    if (error) throw new Error(`a GK insert was refused (${label}): ${error.code} ${error.message}`);
    console.log(`Plan A factual review scope: accepted (rolled back) ${label}`);
  }
  // Kept: the client_admin row the rollback refusal below needs. Its random
  // fingerprint never matches the claim's current state, so P2-06 never
  // counts it.
  const kept = await tryInsert(coverageInsert,
    [measured.organization_id, measured.claim_id, "small_cell_risk", "accepted_internal_with_limitation", actor, "client_admin"], { keep: true });
  if (kept) throw new Error(`the in-scope client_admin coverage acceptance was refused: ${kept.code} ${kept.message}`);
  console.log("Plan A factual review scope: accepted (kept) client_admin internal acceptance of small_cell_risk on the measured claim");

  const fingerprint = (await catalog(schemaFingerprintSql))[0].fingerprint;
  let refused = false;
  try {
    psqlFile(`migrations/${FACTUAL_REVIEW_MIGRATION}.rollback.sql`);
  } catch (error) {
    refused = /rollback refused: client_admin review decisions exist/.test(String(error.message));
    if (!refused) throw error;
  }
  if (!refused) throw new Error("the organization factual review rollback did not refuse with a client_admin decision present");
  if ((await catalog(schemaFingerprintSql))[0].fingerprint !== fingerprint) throw new Error("the refused factual review rollback changed the schema");
  console.log("Plan A factual review migration: rollback refused with a client_admin decision present; nothing changed.");
}

async function proveOrganizationReleaseRollbackRefuses() {
  const counts = `SELECT (SELECT count(*) FROM kai.limitation_snapshots WHERE confirmed_by_role = 'client_admin')::int AS snapshots,
      (SELECT count(*) FROM kai.human_authority_decisions WHERE decided_by_role = 'client_admin')::int AS decisions`;
  const before = (await catalog(counts))[0];
  if (before.snapshots < 1 || before.decisions < 1) throw new Error(`the proof recorded no client_admin release decision: ${JSON.stringify(before)}`);
  const fingerprint = (await catalog(schemaFingerprintSql))[0].fingerprint;
  let refused = false;
  try {
    psqlFile(`migrations/${ORGANIZATION_RELEASE_MIGRATION}.rollback.sql`);
  } catch (error) {
    refused = /rollback refused: client_admin release decisions exist/.test(String(error.message));
    if (!refused) throw error;
  }
  if (!refused) throw new Error("the organization release rollback did not refuse with client_admin decisions present");
  if ((await catalog(schemaFingerprintSql))[0].fingerprint !== fingerprint || JSON.stringify((await catalog(counts))[0]) !== JSON.stringify(before)) {
    throw new Error("the refused organization release rollback changed the schema or the decisions");
  }
  console.log(`Plan A release migration: rollback refused with ${before.snapshots} client_admin snapshot(s) and ${before.decisions} decision(s); nothing changed.`);
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
  verifyChainAgainstRepository(repoRoot);
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
    if (migration === ORGANIZATION_RELEASE_MIGRATION) {
      await proveOrganizationReleaseMigration();
      continue;
    }
    if (migration === FACTUAL_REVIEW_MIGRATION) {
      await proveOrganizationFactualReviewMigration();
      continue;
    }
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
  await proveOrganizationReleaseRollbackRefuses();
  await proveOrganizationFactualReviewScope();
  console.log("Plan A normal-chain proof passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Plan A normal-chain ephemeral PostgreSQL workdir removed: ${workDir}`);
}
