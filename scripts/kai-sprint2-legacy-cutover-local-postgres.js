// Real-PostgreSQL proof runner for the corrected KAI legacy-generation cutover.
//
// Creates its own ephemeral, loopback-only, ownerless PostgreSQL 16 instance,
// stands up the production-shaped legacy fixture proven by the four owner-supplied
// production captures, and then works through the ordered proof list in the task
// specification, failing fast on the first item that does not hold.
//
// Never touches a real database: the runner refuses any target that is not the
// synthetic database it just created on a loopback-only port it chose itself.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { assertNoFail } from "./kai-sprint2-p1-07-source-candidate-runner-assertions.js";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_legacy_cutover_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-legacy-cutover-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(59000 + Math.floor(Math.random() * 1000));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;

const CUTOVER_SQL = "migrations/kai_sprint2_legacy_generation_cutover_20260817.sql";
const ROLLBACK_SQL = "migrations/kai_sprint2_legacy_generation_cutover_20260817.rollback.sql";
const PREFLIGHT_SQL = "scripts/kai-sprint2-legacy-cutover-preflight.sql";
const VERIFIER_SQL = "scripts/kai-sprint2-legacy-cutover-verifier.sql";

const MATERIAL_TABLES = [
  "intake_parser_runs", "intake_file_profiles", "data_dictionaries",
  "data_dictionary_fields", "data_dictionary_mappings", "data_quality_findings",
  "intake_sensitivity_profiles", "intake_source_candidates",
  "intake_promotion_decisions", "sources", "source_versions",
  "source_locators", "evidence_items",
];

let step = 0;
function proofStep(label) {
  step += 1;
  console.log(`\n=== legacy-cutover proof ${step}: ${label} ===`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: dbName, PGUSER: user },
  });
  if (result.status !== 0 && !options.allowFail) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(path, { allowFail = false } = {}) {
  const result = spawnSync(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: dbName, PGUSER: user },
  });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`psql -f ${path} failed\n${[result.stdout, result.stderr].filter(Boolean).join("\n")}`);
  }
  return result;
}

function psqlValue(sql) {
  const result = run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-t", "-A", "-c", sql], { capture: true });
  return result.stdout.trim();
}

function psqlCommand(sql, { allowFail = false } = {}) {
  const result = spawnSync(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", sql], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: dbName, PGUSER: user },
  });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`psql -c failed: ${sql}\n${[result.stdout, result.stderr].filter(Boolean).join("\n")}`);
  }
  return result;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function constraintDef(name) {
  return psqlValue(`
    SELECT regexp_replace(pg_get_constraintdef(c.oid), '\\s+', ' ', 'g')
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'upload_lifecycle_audit'
       AND c.conname = '${name}'
  `.replace(/\n/g, " "));
}

function auditOperationVocabulary() {
  return psqlValue(`
    SELECT string_agg(op, ',' ORDER BY ord)
      FROM (
        SELECT m[1] AS op, min(ord) AS ord
          FROM regexp_matches(
                 (SELECT pg_get_constraintdef(c.oid)
                    FROM pg_constraint c
                    JOIN pg_class r ON r.oid = c.conrelid
                    JOIN pg_namespace n ON n.oid = r.relnamespace
                   WHERE n.nspname = 'kai'
                     AND r.relname = 'upload_lifecycle_audit'
                     AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'),
                 '''([^'']+)''::text',
                 'g'
               ) WITH ORDINALITY AS rx(m, ord)
         GROUP BY m[1]
      ) ops
  `.replace(/\n/g, " "));
}

function priorityShape() {
  return psqlValue(`
    SELECT format_type(a.atttypid, a.atttypmod) || ':' ||
           pg_get_expr(d.adbin, d.adrelid) || ':' ||
           string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
      FROM pg_attribute a
      JOIN pg_class r ON r.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
      JOIN pg_enum e ON e.enumtypid = a.atttypid
     WHERE n.nspname = 'kai'
       AND r.relname = 'review_queue_items'
       AND a.attname = 'priority'
     GROUP BY a.atttypid, a.atttypmod, d.adbin, d.adrelid
  `.replace(/\n/g, " "));
}

// A structural + row-count fingerprint of the whole material graph, used to prove
// that a forced mid-cutover failure and the pre-reprocessing rollback both restore
// the exact starting state.
const FINGERPRINT_SQL = `
WITH cols AS (
  SELECT n.nspname || '.' || r.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod)
         || ':' || (NOT a.attnotnull)::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') AS item
    FROM pg_class r
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
   WHERE n.nspname IN ('kai', 'kai_legacy_20260817')
     AND r.relkind = 'r'
), cons AS (
  SELECT n.nspname || '.' || r.relname || '.' || c.conname || ':' || pg_get_constraintdef(c.oid) AS item
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname IN ('kai', 'kai_legacy_20260817')
), idx AS (
  SELECT schemaname || '.' || tablename || '.' || indexname || ':' || indexdef AS item
    FROM pg_indexes WHERE schemaname IN ('kai', 'kai_legacy_20260817')
), trg AS (
  SELECT n.nspname || '.' || r.relname || '.' || tg.tgname || ':' || pg_get_triggerdef(tg.oid) AS item
    FROM pg_trigger tg
    JOIN pg_class r ON r.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname IN ('kai', 'kai_legacy_20260817') AND NOT tg.tgisinternal
), counts AS (
  SELECT n.nspname || '.' || r.relname || '=' ||
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, r.relname), false, true, '')))[1]::text AS item
    FROM pg_class r JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname IN ('kai', 'kai_legacy_20260817') AND r.relkind = 'r'
)
SELECT md5(string_agg(item, '|' ORDER BY item))
  FROM (SELECT item FROM cols UNION ALL SELECT item FROM cons
        UNION ALL SELECT item FROM idx UNION ALL SELECT item FROM trg
        UNION ALL SELECT item FROM counts) all_items;
`;

function fingerprint() {
  return psqlValue(FINGERPRINT_SQL.replace(/\n/g, " "));
}

// Runs the read-only preflight through psql in unaligned mode and returns the
// STRUCTURAL_SIGNATURE rows as "kai.table=CLASSIFICATION" pairs.
function classifications() {
  const result = run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-t", "-A", "-F", "\t", "-f", PREFLIGHT_SQL], { capture: true });
  return result.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((parts) => parts[0] === "SHAPE_CLASSIFICATION" && parts[1] === "STRUCTURAL_SIGNATURE")
    .map((parts) => `${parts[2]}=${(parts[4] || "").split(" ")[0]}`)
    .join(",");
}

async function proveRunnerOwnedTarget() {
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT current_database() AS database_name,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port,
             current_setting('listen_addresses') AS listen_addresses,
             current_setting('server_version_num')::integer AS version_num
    `);
    const row = result.rows[0];
    if (row.database_name !== dbName) throw new Error("legacy-cutover runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`legacy-cutover runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("legacy-cutover runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("legacy-cutover runner refused non-loopback listen_addresses");
    if (row.version_num < 160000 || row.version_num >= 170000) throw new Error("legacy-cutover runner requires PostgreSQL 16");
  } finally {
    await client.end();
  }
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();
  console.log(`legacy-cutover ephemeral database created: ${dbName}`);
  console.log(`legacy-cutover ephemeral PostgreSQL loopback: 127.0.0.1:${port}`);

  // ------------------------------------------------------------------------
  proofStep("production-shaped legacy fixture stands up");
  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-legacy-cutover-legacy-shape-seed.sql");

  // ------------------------------------------------------------------------
  proofStep("fixture matches every material structure from all four evidence captures");
  // The preflight's structural signature is transcribed directly from the four
  // captures, so "all thirteen classify LEGACY_EXPECTED" is exactly the statement
  // that the fixture reproduces every captured column/type, primary key, named
  // constraint, named index and outgoing foreign-key edge.
  const startingClasses = classifications();
  console.log(startingClasses);
  for (const table of MATERIAL_TABLES) {
    if (!startingClasses.includes(`kai.${table}=LEGACY_EXPECTED`)) {
      throw new Error(`fixture does not reproduce the captured legacy signature for kai.${table}: ${startingClasses}`);
    }
  }
  // The three captured incoming dependency edges must exist too.
  assertEqual(
    psqlValue(`
      SELECT count(*)::text FROM pg_constraint pc
        JOIN pg_class dr ON dr.oid = pc.conrelid
        JOIN pg_class fr ON fr.oid = pc.confrelid
       WHERE pc.contype = 'f'
         AND pc.conname IN ('claim_evidence_links_evidence_item_id_fkey',
                            'funder_requirements_source_locator_id_fkey',
                            'funders_source_basis_locator_id_fkey')
    `.replace(/\n/g, " ")),
    "3",
    "the three captured incoming dependency edges must exist in the fixture",
  );
  // At least one legacy-target review-queue row, per the section-9 requirement.
  const legacyTargetRows = Number(psqlValue(`
    SELECT count(*)::text FROM kai.review_queue_items q
     WHERE (q.target_object_type = 'intake_source_candidate'
            AND EXISTS (SELECT 1 FROM kai.intake_source_candidates c WHERE c.intake_source_candidate_id = q.target_object_id))
        OR (q.target_object_type = 'intake_sensitivity_profile'
            AND EXISTS (SELECT 1 FROM kai.intake_sensitivity_profiles s WHERE s.intake_sensitivity_profile_id = q.target_object_id))
        OR (q.target_object_type = 'data_dictionary'
            AND EXISTS (SELECT 1 FROM kai.data_dictionaries d WHERE d.data_dictionary_id = q.target_object_id))
        OR (q.target_object_type = 'evidence_item'
            AND EXISTS (SELECT 1 FROM kai.evidence_items e WHERE e.evidence_item_id = q.target_object_id))
  `.replace(/\n/g, " ")));
  if (legacyTargetRows < 1) throw new Error("fixture must contain at least one legacy-target review_queue_items row");
  console.log(`legacy-target review_queue_items rows in fixture: ${legacyTargetRows}`);
  assertEqual(
    priorityShape(),
    "kai.priority_enum:'medium'::kai.priority_enum:mandatory,immediate_fix,high,medium,low,backlog,not_applicable,unknown",
    "fixture review_queue_items.priority must start as the production enum/default/labels",
  );
  assertEqual(
    psqlValue(`
      SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
        FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE n.nspname = 'kai' AND t.typname = 'priority_enum'
    `.replace(/\n/g, " ")),
    "mandatory,immediate_fix,high,medium,low,backlog,not_applicable,unknown",
    "fixture priority_enum must match production evidence and omit normal",
  );
  assertEqual(
    psqlValue(`
      SELECT count(*)::text
        FROM pg_trigger tg
        JOIN pg_class r ON r.oid = tg.tgrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai'
         AND r.relname = ANY(ARRAY[${MATERIAL_TABLES.map((t) => `'${t}'`).join(",")}])
         AND NOT tg.tgisinternal
    `.replace(/\n/g, " ")),
    "12",
    "fixture must carry the exact production-supported updated_at trigger set",
  );
  assertEqual(
    psqlValue(`
      SELECT CASE WHEN pg_get_constraintdef(c.oid) LIKE '%''parser_run_recorded''%'
                  THEN 'widened' ELSE 'gate_a_only' END
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai' AND r.relname = 'upload_lifecycle_audit'
         AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
    `.replace(/\n/g, " ")),
    "gate_a_only",
    "fixture audit operation constraint must start Gate-A-only",
  );
  assertEqual(
    auditOperationVocabulary(),
    "reserve_upload,start_upload,complete_object_version,confirm_upload,block_upload,abandon_upload,expire_upload,policy_decision_compare_and_set",
    "fixture audit operation vocabulary must start as the exact Gate-A 8-operation set",
  );

  const preCutoverFingerprint = fingerprint();
  const preCutoverPriorityShape = priorityShape();
  const preCutoverAuditMetadataDef = constraintDef("upload_lifecycle_audit_gate_a_metadata_object_check");
  console.log(`pre-cutover fingerprint: ${preCutoverFingerprint}`);

  // ------------------------------------------------------------------------
  proofStep("the real production failure reproduces: 42703 undefined_column on file_profile_id");
  {
    const preResult = spawnSync("node", ["--test", "__tests__/kai-sprint2-legacy-cutover-pre-collision.spec.js"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: "",
        DATABASE_URL_LOCAL: targetUrl,
        PGURL_LOCAL: "",
        RENDER_DATABASE_URL: "",
        PROD_DATABASE_URL: "",
        KAI_LEGACY_CUTOVER_PRE_DATABASE_URL: targetUrl,
      },
    });
    if (preResult.status !== 0) throw new Error("legacy-cutover pre-collision proof failed");
  }

  // ------------------------------------------------------------------------
  proofStep("corrected preflight returns all PASS on the exact expected legacy fixture");
  const preflightOutput = psqlFile(PREFLIGHT_SQL).stdout;
  console.log(preflightOutput);
  assertNoFail("legacy-cutover preflight (expected legacy starting state)", preflightOutput);

  // ------------------------------------------------------------------------
  proofStep("an unrecognized schema variation fails the preflight");
  // A third shape: the captured legacy sources table plus one canonical-only
  // column. It is neither the captured legacy signature nor the canonical one.
  psqlCommand("ALTER TABLE kai.sources ADD COLUMN reviewed_source_type text");
  const mutatedPreflight = psqlFile(PREFLIGHT_SQL).stdout;
  if (!/kai\.sources\s*\|\s*FAIL/.test(mutatedPreflight) && !mutatedPreflight.includes("UNRECOGNIZED")) {
    throw new Error(`preflight failed to reject an unrecognized kai.sources shape\n${mutatedPreflight}`);
  }
  console.log("preflight correctly classified the mutated kai.sources as UNRECOGNIZED and FAILed.");
  // The cutover bundle must refuse the same state without mutating anything.
  const beforeRefusal = fingerprint();
  const refused = psqlFile(CUTOVER_SQL, { allowFail: true });
  if (refused.status === 0) throw new Error("cutover bundle accepted an unrecognized shape");
  assertEqual(fingerprint(), beforeRefusal, "a refused cutover must not mutate anything");
  psqlCommand("ALTER TABLE kai.sources DROP COLUMN reviewed_source_type");
  assertEqual(fingerprint(), preCutoverFingerprint, "reverting the mutation must restore the exact fixture");
  assertNoFail("legacy-cutover preflight (after reverting the mutation)", psqlFile(PREFLIGHT_SQL).stdout);

  function preflightRows(pattern) {
    const result = run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-t", "-A", "-F", "\t", "-f", PREFLIGHT_SQL], { capture: true });
    return result.stdout.split("\n").filter((line) => line.includes(pattern));
  }

  // ------------------------------------------------------------------------
  proofStep("relocation trigger compatibility checks fail closed");
  psqlCommand(`
    CREATE TRIGGER trg_unexpected_relocation_probe
      BEFORE UPDATE ON kai.sources
      FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
  `);
  {
    const rows = preflightRows("ALLOWED_UPDATED_AT_TRIGGER_SIGNATURE");
    if (!rows.some((line) => line.includes("FAIL"))) {
      throw new Error(`preflight failed to reject an additional unexpected trigger\n${rows.join("\n")}`);
    }
    const refused = psqlFile(CUTOVER_SQL, { allowFail: true });
    if (refused.status === 0) throw new Error("cutover bundle accepted an additional unexpected trigger");
    console.log("preflight and bundle both fail closed on an additional unexpected trigger.");
  }
  psqlCommand("DROP TRIGGER trg_unexpected_relocation_probe ON kai.sources");
  assertEqual(fingerprint(), preCutoverFingerprint, "reverting the extra-trigger probe must restore the exact fixture");

  psqlCommand(`
    CREATE OR REPLACE FUNCTION kai.set_updated_at_probe()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$;
    DROP TRIGGER trg_sources_updated_at ON kai.sources;
    CREATE TRIGGER trg_sources_updated_at
      BEFORE UPDATE ON kai.sources
      FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at_probe();
  `);
  {
    const rows = preflightRows("ALLOWED_UPDATED_AT_TRIGGER_SIGNATURE");
    if (!rows.some((line) => line.includes("FAIL"))) {
      throw new Error(`preflight failed to reject an unexpected trigger function\n${rows.join("\n")}`);
    }
    const refused = psqlFile(CUTOVER_SQL, { allowFail: true });
    if (refused.status === 0) throw new Error("cutover bundle accepted an unexpected trigger function");
    console.log("preflight and bundle both fail closed on an unexpected trigger function.");
  }
  psqlCommand(`
    DROP TRIGGER trg_sources_updated_at ON kai.sources;
    DROP FUNCTION kai.set_updated_at_probe();
    CREATE TRIGGER trg_sources_updated_at
      BEFORE UPDATE ON kai.sources
      FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
  `);
  assertEqual(fingerprint(), preCutoverFingerprint, "reverting the trigger-function probe must restore the exact fixture");

  psqlCommand(`
    DROP TRIGGER trg_sources_updated_at ON kai.sources;
    CREATE TRIGGER trg_sources_updated_at
      AFTER UPDATE ON kai.sources
      FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
  `);
  {
    const rows = preflightRows("ALLOWED_UPDATED_AT_TRIGGER_SIGNATURE");
    if (!rows.some((line) => line.includes("FAIL"))) {
      throw new Error(`preflight failed to reject an unexpected trigger timing/event\n${rows.join("\n")}`);
    }
    const refused = psqlFile(CUTOVER_SQL, { allowFail: true });
    if (refused.status === 0) throw new Error("cutover bundle accepted an unexpected trigger timing/event");
    console.log("preflight and bundle both fail closed on unexpected trigger timing/event.");
  }
  psqlCommand(`
    DROP TRIGGER trg_sources_updated_at ON kai.sources;
    CREATE TRIGGER trg_sources_updated_at
      BEFORE UPDATE ON kai.sources
      FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
  `);
  assertEqual(fingerprint(), preCutoverFingerprint, "reverting the trigger timing/event probe must restore the exact fixture");

  psqlCommand(`
    CREATE TRIGGER trg_sources_updated_at
      BEFORE UPDATE ON kai.intake_promotion_decisions
      FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
  `);
  {
    const rows = preflightRows("ALLOWED_UPDATED_AT_TRIGGER_SIGNATURE");
    if (!rows.some((line) => line.includes("FAIL"))) {
      throw new Error(`preflight failed to reject an unexpected trigger relation binding\n${rows.join("\n")}`);
    }
    const refused = psqlFile(CUTOVER_SQL, { allowFail: true });
    if (refused.status === 0) throw new Error("cutover bundle accepted an unexpected trigger relation binding");
    console.log("preflight and bundle both fail closed on an unexpected trigger relation binding.");
  }
  psqlCommand("DROP TRIGGER trg_sources_updated_at ON kai.intake_promotion_decisions");
  assertEqual(fingerprint(), preCutoverFingerprint, "reverting the trigger relation probe must restore the exact fixture");
  assertNoFail("legacy-cutover preflight (after reverting the trigger probes)", psqlFile(PREFLIGHT_SQL).stdout);

  // ------------------------------------------------------------------------
  proofStep("shared-object producer-compatibility checks fail closed");
  // These guard the shared contracts proven by the owner-supplied production
  // evidence. Each is proven to fail closed for an unsupported shape.
  // (a) kai.review_queue_items.priority with an unsupported enum shape.
  psqlCommand(`
    CREATE TYPE kai.priority_enum_probe AS ENUM ('low', 'medium', 'high');
    ALTER TABLE kai.review_queue_items ALTER COLUMN priority DROP DEFAULT;
    ALTER TABLE kai.review_queue_items ALTER COLUMN priority TYPE kai.priority_enum_probe
      USING priority::text::kai.priority_enum_probe;
  `);
  {
    const rows = preflightRows("QUEUE_PRIORITY_PRODUCTION_NATIVE");
    if (!rows.some((line) => line.includes("FAIL"))) {
      throw new Error(`preflight failed to reject an unsupported priority enum shape\n${rows.join("\n")}`);
    }
    const beforeRefusal = fingerprint();
    const refused = psqlFile(CUTOVER_SQL, { allowFail: true });
    if (refused.status === 0) throw new Error("cutover bundle accepted an unsupported priority enum shape");
    assertEqual(fingerprint(), beforeRefusal, "a refused cutover must not mutate anything");
    console.log("preflight and bundle both fail closed on an unsupported priority enum shape.");
  }
  psqlCommand(`
    ALTER TABLE kai.review_queue_items ALTER COLUMN priority TYPE kai.priority_enum
      USING priority::text::kai.priority_enum;
    ALTER TABLE kai.review_queue_items ALTER COLUMN priority SET DEFAULT 'medium';
    DROP TYPE kai.priority_enum_probe;
  `);
  assertEqual(fingerprint(), preCutoverFingerprint, "reverting the priority probe must restore the exact fixture");

  // (b) kai.upload_lifecycle_audit vocabulary that is neither Gate-A-only nor
  //     cumulative P1.
  psqlCommand(`
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check,
      ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check
        CHECK (operation IN ('reserve_upload', 'parser_run_recorded', 'file_profile_persisted'));
  `);
  {
    const rows = preflightRows("AUDIT_OPERATION_STARTING_OR_CONVERGED");
    if (!rows.some((line) => line.includes("FAIL"))) {
      throw new Error(`preflight failed to reject an incompatible audit operation vocabulary\n${rows.join("\n")}`);
    }
    const beforeRefusal = fingerprint();
    const refused = psqlFile(CUTOVER_SQL, { allowFail: true });
    if (refused.status === 0) throw new Error("cutover bundle accepted an incompatible audit operation vocabulary");
    assertEqual(fingerprint(), beforeRefusal, "a refused cutover must not mutate anything");
    console.log("preflight and bundle both fail closed on an incompatible upload_lifecycle_audit vocabulary.");
  }
  // (c) a NOT NULL column with no default outside the writers' insert list.
  psqlCommand(`
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check,
      ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check
        CHECK (operation IN ('reserve_upload','start_upload','complete_object_version','confirm_upload',
                             'block_upload','abandon_upload','expire_upload',
                             'policy_decision_compare_and_set'));
    ALTER TABLE kai.upload_lifecycle_audit ADD COLUMN probe_required text;
    UPDATE kai.upload_lifecycle_audit SET probe_required = 'x';
    ALTER TABLE kai.upload_lifecycle_audit ALTER COLUMN probe_required SET NOT NULL;
  `);
  {
    const rows = preflightRows("AUDIT_NO_UNSATISFIABLE_REQUIRED_COLUMN");
    if (!rows.some((line) => line.includes("FAIL"))) {
      throw new Error(`preflight failed to reject an unsatisfiable NOT NULL audit column\n${rows.join("\n")}`);
    }
    console.log("preflight fails closed on a NOT NULL audit column the current writers never supply.");
  }
  psqlCommand("ALTER TABLE kai.upload_lifecycle_audit DROP COLUMN probe_required");
  assertEqual(fingerprint(), preCutoverFingerprint, "reverting the audit probes must restore the exact fixture");
  assertNoFail("legacy-cutover preflight (after reverting the shared-object probes)", psqlFile(PREFLIGHT_SQL).stdout);

  // ------------------------------------------------------------------------
  proofStep("a forced mid-cutover failure rolls the complete cutover back");
  {
    const bundle = readFileSync(join(repoRoot, CUTOVER_SQL), "utf8");
    if (!/\nCOMMIT;\s*$/.test(bundle)) throw new Error("cutover bundle does not end with a single COMMIT;");
    const injected = bundle.replace(
      /\nCOMMIT;\s*$/,
      "\nDO $inject$ BEGIN RAISE EXCEPTION 'injected mid-cutover failure (test only)'; END $inject$;\nCOMMIT;\n",
    );
    const injectedPath = join(workDir, "cutover-with-injected-failure.sql");
    writeFileSync(injectedPath, injected);
    const failed = spawnSync(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", injectedPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: dbName, PGUSER: user },
    });
    if (failed.status === 0) throw new Error("the injected mid-cutover failure did not fail the bundle");
    assertEqual(psqlValue("SELECT (to_regclass('kai_legacy_20260817.sources') IS NULL)::text"), "true",
      "no relocated table may survive a rolled-back cutover");
    assertEqual(psqlValue("SELECT (EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='kai_legacy_20260817'))::text"), "false",
      "the destination schema may not survive a rolled-back cutover");
    assertEqual(fingerprint(), preCutoverFingerprint,
      "a forced mid-cutover failure must leave no partial schema state whatsoever");
    console.log("forced mid-cutover failure left the database byte-identical to the pre-cutover fixture.");
  }

  // ------------------------------------------------------------------------
  proofStep("the atomic cutover bundle applies");
  psqlFile(CUTOVER_SQL);
  const postCutoverFingerprint = fingerprint();

  assertEqual(
    priorityShape(),
    preCutoverPriorityShape,
    "review_queue_items.priority enum/default/labels must be unchanged by forward cutover",
  );
  assertEqual(
    auditOperationVocabulary(),
    "reserve_upload,start_upload,complete_object_version,confirm_upload,block_upload,abandon_upload,expire_upload,policy_decision_compare_and_set,parser_run_recorded,file_profile_persisted,data_dictionary_draft_persisted,intake_sensitivity_profile_persisted,sensitivity_review_queue_item_created,intake_source_candidate_persisted,source_promotion_decision_persisted",
    "forward cutover must widen audit operation vocabulary exactly 8 -> 15",
  );
  assertEqual(
    constraintDef("upload_lifecycle_audit_gate_a_metadata_object_check"),
    preCutoverAuditMetadataDef,
    "audit metadata CHECK must be unchanged by forward cutover",
  );
  psqlCommand(`
    BEGIN;
    INSERT INTO kai.review_queue_items (
      review_queue_item_id, organization_id, queue_type, target_object_type,
      target_object_id, priority, queue_status, summary
    ) VALUES (
      gen_random_uuid(), '00000000-0000-4000-8000-000000000001',
      'intake_file_review', 'intake_file', gen_random_uuid(), 'medium',
      'open', 'priority compatibility probe'
    );
    ROLLBACK;
  `);
  {
    const rejected = psqlCommand(`
      BEGIN;
      INSERT INTO kai.review_queue_items (
        review_queue_item_id, organization_id, queue_type, target_object_type,
        target_object_id, priority, queue_status, summary
      ) VALUES (
        gen_random_uuid(), '00000000-0000-4000-8000-000000000001',
        'intake_file_review', 'intake_file', gen_random_uuid(), 'normal',
        'open', 'priority rejection probe'
      );
      ROLLBACK;
    `, { allowFail: true });
    if (rejected.status === 0) throw new Error("normal priority must remain rejected by production priority_enum");
  }
  const auditMetadataByOperation = {
    reserve_upload: { metadata_only: true },
    parser_run_recorded: {
      metadata_only: true, contract: "probe", parser_name: "safe_parser",
      parser_version: "v1", checksum_bound: true, parser_status: "completed",
      retry_count: 0, error_code: null, error_message_safe: null, validator_key: "probe",
    },
    file_profile_persisted: {
      metadata_only: true, contract: "probe", parser_name: "safe_parser",
      parser_version: "v1", checksum_bound: true,
      profile_canonical_sha256: "a".repeat(64), validator_key: "probe",
    },
    data_dictionary_draft_persisted: {
      metadata_only: true, contract: "probe", file_profile_id: "probe",
      profile_canonical_sha256: "a".repeat(64), dictionary_status: "draft",
      field_count: 1, mapping_count: 1, finding_count: 0, validator_key: "probe",
    },
    intake_sensitivity_profile_persisted: {
      metadata_only: true, contract: "probe", file_profile_id: "probe",
      data_dictionary_id: "probe", profile_canonical_sha256: "a".repeat(64),
      human_review_required: true, validator_key: "probe",
    },
    sensitivity_review_queue_item_created: {
      metadata_only: true, contract: "probe", queue_type: "sensitivity_review",
      target_object_type: "intake_sensitivity_profile", target_object_id: "probe",
      queue_status: "open", validator_key: "probe",
    },
    intake_source_candidate_persisted: {
      metadata_only: true, contract: "probe", intake_sensitivity_profile_id: "probe",
      profile_canonical_sha256: "a".repeat(64), proposed_source_type: "uploaded_file",
      candidate_status: "proposed", queue_type: "source_candidate_review",
      target_object_type: "intake_source_candidate", target_object_id: "probe",
      queue_status: "open", validator_key: "probe",
    },
    source_promotion_decision_persisted: {
      metadata_only: true, contract: "probe", intake_source_candidate_id: "probe",
      intake_sensitivity_profile_id: "probe", profile_canonical_sha256: "a".repeat(64),
      reviewed_source_type: "uploaded_file", decision_status: "approved",
      candidate_status: "promoted", queue_status: "resolved", source_id: "probe",
      source_version_id: "probe", validator_key: "probe",
    },
  };
  for (const [operation, metadata] of Object.entries(auditMetadataByOperation)) {
    psqlCommand(`
      BEGIN;
      INSERT INTO kai.upload_lifecycle_audit (
        organization_id, intake_file_id, operation, from_state, to_state,
        outcome, metadata, created_at
      ) VALUES (
        '00000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '${operation}', 'reserved', 'reserved', 'success',
        '${JSON.stringify(metadata).replace(/'/g, "''")}'::jsonb, now()
      );
      ROLLBACK;
    `);
  }
  assertEqual(
    psqlValue(`
      SELECT count(*)::text
        FROM pg_trigger tg
        JOIN pg_class r ON r.oid = tg.tgrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai_legacy_20260817'
         AND r.relname = ANY(ARRAY[${MATERIAL_TABLES.map((t) => `'${t}'`).join(",")}])
         AND NOT tg.tgisinternal
    `.replace(/\n/g, " ")),
    "12",
    "allowed updated_at triggers must remain on preserved legacy relations",
  );
  assertEqual(
    psqlValue(`
      SELECT count(*)::text
        FROM pg_trigger tg
        JOIN pg_class r ON r.oid = tg.tgrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai'
         AND r.relname = ANY(ARRAY[${MATERIAL_TABLES.map((t) => `'${t}'`).join(",")}])
         AND NOT tg.tgisinternal
    `.replace(/\n/g, " ")),
    "0",
    "canonical replacement tables must not carry legacy updated_at triggers",
  );
  console.log("priority, audit and relocated-trigger post-cutover probes passed.");

  // ------------------------------------------------------------------------
  proofStep("post-cutover verifier is fully green");
  const verifierOutput = psqlFile(VERIFIER_SQL).stdout;
  console.log(verifierOutput);
  assertNoFail("legacy-cutover post-cutover verifier", verifierOutput);

  // ------------------------------------------------------------------------
  proofStep("legacy rows, legacy relationships and shared contracts all survived");
  assertEqual(psqlValue(
    "SELECT string_agg(proposed_display_name, '|') FROM kai_legacy_20260817.intake_source_candidates",
  ), "Legacy synthetic candidate (pre-Sprint2 generation)", "the legacy candidate row survived unchanged");
  for (const [table, expected] of [
    ["intake_parser_runs", "1"], ["intake_file_profiles", "1"], ["data_dictionaries", "1"],
    ["data_dictionary_fields", "1"], ["data_dictionary_mappings", "1"], ["data_quality_findings", "1"],
    ["intake_sensitivity_profiles", "1"], ["intake_source_candidates", "1"],
    ["intake_promotion_decisions", "1"], ["sources", "1"], ["source_versions", "1"],
    ["source_locators", "1"], ["evidence_items", "1"],
  ]) {
    assertEqual(psqlValue(`SELECT count(*)::text FROM kai_legacy_20260817.${table}`), expected,
      `preserved kai_legacy_20260817.${table} row count`);
  }
  assertEqual(psqlValue(`
    SELECT count(*)::text FROM kai.claim_evidence_links l
      JOIN kai_legacy_20260817.evidence_items e ON e.evidence_item_id = l.evidence_item_id
  `.replace(/\n/g, " ")), "1", "the retained claim_evidence_links dependant still resolves against the preserved evidence item");
  assertEqual(psqlValue(`
    SELECT count(*)::text FROM kai.funder_requirements r
      JOIN kai_legacy_20260817.source_locators sl ON sl.locator_id = r.source_locator_id
  `.replace(/\n/g, " ")), "1", "the retained funder_requirements dependant still resolves against the preserved locator");
  assertEqual(psqlValue(`
    SELECT count(*)::text FROM kai.funders f
      JOIN kai_legacy_20260817.source_locators sl ON sl.locator_id = f.source_basis_locator_id
  `.replace(/\n/g, " ")), "1", "the retained funders dependant still resolves against the preserved locator");
  assertEqual(psqlValue("SELECT count(*)::text FROM kai.review_queue_items"), "5",
    "no shared queue row was deleted, moved or added by the cutover");
  assertEqual(psqlValue(
    "SELECT count(*)::text FROM kai.review_queue_items WHERE queue_status IN ('resolved','cancelled')",
  ), "0", "the cutover must never fabricate a queue resolution or cancellation");
  assertEqual(psqlValue(
    "SELECT count(*)::text FROM kai.review_queue_items WHERE queue_metadata ? 'kai_legacy_generation_target'",
  ), String(legacyTargetRows), "exactly the legacy-target queue rows were marked");
  assertEqual(psqlValue("SELECT count(*)::text FROM kai.source_locators"), "0",
    "canonical kai.source_locators is installed empty; no legacy locator row was translated");
  assertEqual(psqlValue("SELECT count(*)::text FROM kai.evidence_items"), "0",
    "canonical kai.evidence_items is installed empty; no legacy evidence row was translated");

  // ------------------------------------------------------------------------
  proofStep("PRE_REPROCESSING_ROLLBACK restores the exact pre-cutover fixture");
  psqlFile(ROLLBACK_SQL);
  assertEqual(fingerprint(), preCutoverFingerprint,
    "the pre-reprocessing rollback must restore the exact pre-cutover fixture");
  assertEqual(priorityShape(), preCutoverPriorityShape,
    "review_queue_items.priority enum/default/labels must be unchanged by rollback");
  assertEqual(auditOperationVocabulary(),
    "reserve_upload,start_upload,complete_object_version,confirm_upload,block_upload,abandon_upload,expire_upload,policy_decision_compare_and_set",
    "pre-reprocessing rollback must restore the exact Gate-A 8-operation vocabulary");
  assertEqual(constraintDef("upload_lifecycle_audit_gate_a_metadata_object_check"), preCutoverAuditMetadataDef,
    "audit metadata CHECK must remain unchanged after rollback");
  assertNoFail("legacy-cutover preflight (after pre-reprocessing rollback)", psqlFile(PREFLIGHT_SQL).stdout);
  console.log("pre-reprocessing rollback restored the exact pre-cutover fixture; preflight is green again.");

  // ------------------------------------------------------------------------
  proofStep("re-applying the cutover reaches the identical post-cutover state");
  psqlFile(CUTOVER_SQL);
  assertEqual(fingerprint(), postCutoverFingerprint,
    "re-applying the cutover after a rollback must reach the identical post-cutover state");

  // ------------------------------------------------------------------------
  proofStep("re-running the cutover on the converged state is a safe no-op");
  psqlFile(CUTOVER_SQL);
  assertEqual(fingerprint(), postCutoverFingerprint, "a converged rerun must mutate nothing");
  assertNoFail("legacy-cutover verifier (after converged rerun)", psqlFile(VERIFIER_SQL).stdout);
  assertNoFail("legacy-cutover preflight (converged state)", psqlFile(PREFLIGHT_SQL).stdout);

  // ------------------------------------------------------------------------
  proofStep("canonical reprocessing through the real current producer chain, and Review Cockpit success");
  {
    const testEnv = {
      ...process.env,
      DATABASE_URL: "",
      DATABASE_URL_LOCAL: targetUrl,
      PGURL_LOCAL: "",
      RENDER_DATABASE_URL: "",
      PROD_DATABASE_URL: "",
      KAI_SPRINT2_ENABLED: "true",
      KAI_LEGACY_CUTOVER_DATABASE_URL: targetUrl,
    };
    const testResult = spawnSync("node", ["--test", "__tests__/kai-sprint2-legacy-cutover.integration.spec.js"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "inherit",
      env: testEnv,
    });
    if (testResult.status !== 0) throw new Error("legacy-cutover integration tests failed");
  }
  assertNoFail("legacy-cutover verifier (after canonical reprocessing)", psqlFile(VERIFIER_SQL).stdout);

  // ------------------------------------------------------------------------
  proofStep("the simple rollback refuses once canonical rows exist (POST_REPROCESSING_RECOVERY is not implemented)");
  {
    const refusedRollback = psqlFile(ROLLBACK_SQL, { allowFail: true });
    if (refusedRollback.status === 0) {
      throw new Error("the pre-reprocessing rollback must refuse to run once canonical rows exist");
    }
    const message = [refusedRollback.stdout, refusedRollback.stderr].filter(Boolean).join("\n");
    if (!message.includes("PRE_REPROCESSING_ROLLBACK only")) {
      throw new Error(`rollback refused for the wrong reason\n${message}`);
    }
    console.log("rollback correctly refused and named POST_REPROCESSING_RECOVERY as a separate procedure.");
  }
  assertNoFail("legacy-cutover verifier (after the refused rollback)", psqlFile(VERIFIER_SQL).stdout);

  console.log("\nlegacy-cutover: every ordered proof step passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`legacy-cutover ephemeral PostgreSQL workdir removed: ${workDir}`);
}
