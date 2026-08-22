import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const user = process.env.USER || "postgres";

const chain = Object.freeze([
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
  "migrations/kai_sprint2_p2_09_human_review_internal_approval.sql",
  "migrations/kai_sprint2_p2_10_coverage_review_decision.sql",
  "migrations/kai_sprint2_p2_11_client_followup_completion.sql",
  "migrations/kai_sprint2_p3_01_generated_content_drafts.sql",
  "migrations/kai_sprint2_p3_04_generated_content_review_completion.sql",
  "migrations/kai_sprint2_p3_05_export_review_request.sql",
  "migrations/kai_sprint2_p3_09_export_review_start.sql",
  "migrations/kai_sprint2_p3_13_export_review_completion.sql",
  "migrations/kai_sprint2_p3_16_export_candidate_foundation.sql",
  "migrations/kai_sprint2_p3_17_human_authority_decision_ledger.sql",
]);

function run(command, args, context, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      DATABASE_URL: "postgres://127.0.0.1:9/kai_sentinel",
      DATABASE_URL_LOCAL: "",
      PGURL_LOCAL: "",
      RENDER_DATABASE_URL: "",
      PROD_DATABASE_URL: "",
      PGHOST: "127.0.0.1",
      PGPORT: context.port,
      PGDATABASE: context.dbName,
      PGUSER: user,
    },
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(context, path) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", context.dbName, "-f", path], context, { capture: true }).stdout;
}

function psqlCommand(context, sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", context.dbName, "-c", sql], context, { capture: true }).stdout;
}

async function withPostgres(label, fn) {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const workDir = mkdtempSync(join("/tmp", `kai-recon-${safeLabel}-`));
  const dataDir = join(workDir, "data");
  const socketDir = join(workDir, "socket");
  const logFile = join(workDir, "postgres.log");
  const port = String(62000 + Math.floor(Math.random() * 1000));
  const dbName = `kai_forward_recon_${safeLabel}`;
  const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
  const context = { workDir, dataDir, socketDir, logFile, port, dbName, targetUrl };
  let started = false;
  try {
    mkdirSync(socketDir, { recursive: true });
    run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], context, { capture: true });
    try {
      run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], context, { capture: true });
    } catch (error) {
      const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
      throw new Error(`${error.message}${log ? `\nPostgreSQL log:\n${log}` : ""}`);
    }
    started = true;
    run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], context, { capture: true });
    await proveRunnerOwnedTarget(context);
    await fn(context);
    console.log(`${label}: PASS`);
  } finally {
    if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
    rmSync(workDir, { recursive: true, force: true });
    console.log(`${label}: ephemeral PostgreSQL workdir removed: ${workDir}`);
  }
}

async function proveRunnerOwnedTarget(context) {
  const client = new Client({ connectionString: context.targetUrl, ssl: false });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT current_database() AS database_name,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port,
             current_setting('listen_addresses') AS listen_addresses
    `);
    const row = rows[0];
    if (row.database_name !== context.dbName) throw new Error("runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== context.port) throw new Error("runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("runner refused non-loopback listen_addresses");
  } finally {
    await client.end();
  }
}

function applyCanonicalChain(context) {
  for (const file of chain) psqlFile(context, file);
}

function applyGovernedIncomingAuditVocabulary(context) {
  psqlCommand(context, `
    DO $$
    DECLARE
      old_expr text;
      pre_ops text[];
      governed_ops text[];
    BEGIN
      SELECT pg_get_expr(c.conbin, c.conrelid)
        INTO old_expr
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai'
         AND r.relname = 'upload_lifecycle_audit'
         AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check';

      SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
        INTO pre_ops
        FROM regexp_matches(old_expr, '''([^'']+)''', 'g') AS m;

      SELECT array_agg(op ORDER BY op)
        INTO governed_ops
        FROM (
          SELECT unnest(pre_ops) AS op
          UNION
          SELECT 'coverage_review_decision_accepted_internal_with_limitation'
        ) ops
       WHERE op NOT IN (
         'evidence_review_completed',
         'claim_review_completed_internal_approval',
         'client_followup_completed'
       );

      EXECUTE format(
        'ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_governed CHECK (operation = ANY (%L::text[])) NOT VALID',
        governed_ops
      );
      ALTER TABLE kai.upload_lifecycle_audit
        VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_governed;
      ALTER TABLE kai.upload_lifecycle_audit
        DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
      ALTER TABLE kai.upload_lifecycle_audit
        RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_governed
        TO upload_lifecycle_audit_gate_a_operation_check;
    END $$;
  `);
}

function captureProtectedObjects(context) {
  return psqlCommand(context, `
    SELECT jsonb_pretty(jsonb_object_agg(name, definition ORDER BY name))
      FROM (
        SELECT c.conname AS name, pg_get_expr(c.conbin, c.conrelid) AS definition
          FROM pg_constraint c
          JOIN pg_class r ON r.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
         WHERE n.nspname = 'kai'
           AND c.conname IN (
             'upload_lifecycle_audit_gate_a_operation_check',
             'review_queue_items_p2_04_client_followup_contract_check',
             'evidence_items_p2_01_support_strength_check',
             'claims_p2_03_claim_strength_check'
           )
        UNION ALL
        SELECT t.tgname, pg_get_triggerdef(t.oid)
          FROM pg_trigger t
          JOIN pg_class r ON r.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
         WHERE n.nspname = 'kai'
           AND r.relname = 'coverage_review_decisions'
           AND t.tgname = 'trg_p2_10_coverage_review_decisions_append_only'
      ) s;
  `);
}

function captureP210Objects(context) {
  return psqlCommand(context, `
    WITH p2_10_objects AS (
      SELECT 'table' AS kind,
             to_regclass('kai.coverage_review_decisions')::text AS name,
             to_regclass('kai.coverage_review_decisions') IS NOT NULL AS present,
             NULL::text AS definition
      UNION ALL
      SELECT 'trigger',
             t.tgname,
             t.tgenabled = 'O',
             pg_get_triggerdef(t.oid)
        FROM pg_trigger t
        JOIN pg_class r ON r.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai'
         AND r.relname = 'coverage_review_decisions'
         AND t.tgname = 'trg_p2_10_coverage_review_decisions_append_only'
      UNION ALL
      SELECT 'operation',
             'coverage_review_decision_accepted_internal_with_limitation',
             bool_or('coverage_review_decision_accepted_internal_with_limitation' = ANY (ops.operations)),
             NULL::text
        FROM (
          SELECT array_agg(DISTINCT op ORDER BY op) AS operations
            FROM (
              SELECT regexp_split_to_table(
                       CASE WHEN m[1] LIKE '{%' THEN trim(both '{}' from m[1]) ELSE m[1] END,
                       CASE WHEN m[1] LIKE '{%' THEN ',' ELSE E'\\x1f' END
                     ) AS op
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace,
                     regexp_matches(pg_get_expr(c.conbin, c.conrelid), '''([^'']+)''', 'g') AS m
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
            ) parsed_ops
        ) ops
    )
    SELECT jsonb_pretty(jsonb_agg(to_jsonb(p2_10_objects) ORDER BY kind, name)) AS snapshot
      FROM p2_10_objects;
  `);
}

function assertP210Snapshot(snapshot, label) {
  if (!snapshot.includes("kai.coverage_review_decisions")) {
    throw new Error(`${label}: kai.coverage_review_decisions is absent\n${snapshot}`);
  }
  if (!snapshot.includes("trg_p2_10_coverage_review_decisions_append_only")) {
    throw new Error(`${label}: P2-10 append-only trigger is absent\n${snapshot}`);
  }
  if (!snapshot.includes("coverage_review_decision_accepted_internal_with_limitation")) {
    throw new Error(`${label}: P2-10 audit operation is absent\n${snapshot}`);
  }
  if (!snapshot.includes('"kind": "table"') || !snapshot.includes('"present": true')) {
    throw new Error(`${label}: P2-10 table presence proof failed\n${snapshot}`);
  }
}

function runVerifier(context) {
  const output = psqlFile(context, "scripts/kai-sprint2-p2-09-p2-10-p2-11-forward-reconciliation-verifier.sql");
  if (/\|\s*FAIL\s*\|/.test(output)) throw new Error(`forward reconciliation verifier returned FAIL\n${output}`);
  return output;
}

function simulateProductionDrift(context) {
  psqlCommand(context, `
    ALTER TABLE kai.evidence_items
      DROP CONSTRAINT evidence_items_p2_01_support_strength_check,
      ADD CONSTRAINT evidence_items_p2_01_support_strength_check CHECK (support_strength = 'unassessed');
    ALTER TABLE kai.claims
      DROP CONSTRAINT claims_p2_03_claim_strength_check,
      ADD CONSTRAINT claims_p2_03_claim_strength_check CHECK (claim_strength = 'unassessed');
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check,
      DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_09_claim_review_metadata_object_check,
      DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check;
    ALTER TABLE kai.review_queue_items
      DROP CONSTRAINT review_queue_items_p2_04_client_followup_contract_check,
      ADD CONSTRAINT review_queue_items_p2_04_client_followup_contract_check
      CHECK (
        queue_type <> 'client_followup'
        OR (
          target_object_type = 'client_followup_item'
          AND queue_status = 'waiting_on_client'
          AND review_status = 'proposed'
          AND priority = 'medium'
          AND summary = 'Client clarification is required for an unresolved claim gap.'
          AND assigned_to IS NULL
          AND due_at IS NULL
          AND required_action IN (
            'Confirm the business meaning of the unresolved field or measure.',
            'Confirm the denominator and how it is calculated.',
            'Confirm the reporting period represented by this source.',
            'Confirm the entity level represented by the unresolved field or measure.'
          )
        )
      );
  `);
}

await withPostgres("Scenario A", async (context) => {
  applyCanonicalChain(context);
  applyGovernedIncomingAuditVocabulary(context);
  const before = captureProtectedObjects(context);
  const p210Before = captureP210Objects(context);
  assertP210Snapshot(p210Before, "Scenario A before reconciliation");
  psqlFile(context, "migrations/kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.sql");
  runVerifier(context);
  const after = captureProtectedObjects(context);
  const p210After = captureP210Objects(context);
  assertP210Snapshot(p210After, "Scenario A after reconciliation");
  if (p210Before !== p210After) {
    throw new Error("Scenario A mutated P2-10 protected objects");
  }
  if (!before.includes("export_candidate_created") || !after.includes("export_candidate_created")) {
    throw new Error("Scenario A did not preserve later P3 audit operation evidence");
  }
});

await withPostgres("Scenario B", async (context) => {
  applyCanonicalChain(context);
  applyGovernedIncomingAuditVocabulary(context);
  const p210Before = captureP210Objects(context);
  assertP210Snapshot(p210Before, "Scenario B before drift");
  simulateProductionDrift(context);
  const p210AfterDrift = captureP210Objects(context);
  if (p210Before !== p210AfterDrift) {
    throw new Error("Scenario B drift mutated P2-10 protected objects");
  }
  psqlFile(context, "migrations/kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.sql");
  runVerifier(context);
  const p210After = captureP210Objects(context);
  assertP210Snapshot(p210After, "Scenario B after reconciliation");
  if (p210Before !== p210After) {
    throw new Error("Scenario B reconciliation mutated P2-10 protected objects");
  }
});

console.log("P2-09 repaired: PASS");
console.log("P2-11 repaired: PASS");
console.log("P2-10 unchanged: PASS");
console.log("later audit vocabulary preserved: PASS");
console.log("P2-09/P2-11 forward reconciliation local PostgreSQL proof passed.");
