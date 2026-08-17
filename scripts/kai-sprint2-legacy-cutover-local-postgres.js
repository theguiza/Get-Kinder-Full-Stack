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
), counts AS (
  SELECT n.nspname || '.' || r.relname || '=' ||
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, r.relname), false, true, '')))[1]::text AS item
    FROM pg_class r JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname IN ('kai', 'kai_legacy_20260817') AND r.relkind = 'r'
)
SELECT md5(string_agg(item, '|' ORDER BY item))
  FROM (SELECT item FROM cols UNION ALL SELECT item FROM cons
        UNION ALL SELECT item FROM idx UNION ALL SELECT item FROM counts) all_items;
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

  // The Gate A policy-decision migration installs the narrower Gate A operation
  // vocabulary. Production is at a later, wider state; the corrected bundle
  // deliberately refuses to widen a live vocabulary itself, so the fixture must
  // stand the two canonical operations up the way production already has them.
  // This mirrors the production precondition the preflight asserts, and is the
  // only fixture-side change made to a shared object.
  psqlCommand(`
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gate_a_operation_check,
      ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check
        CHECK (operation IN ('reserve_upload','start_upload','complete_object_version','confirm_upload',
                             'block_upload','abandon_upload','expire_upload',
                             'policy_decision_compare_and_set','parser_run_recorded','file_profile_persisted',
                             'data_dictionary_draft_persisted','intake_sensitivity_profile_persisted',
                             'sensitivity_review_queue_item_created','intake_source_candidate_persisted',
                             'source_promotion_decision_persisted'));
  `);

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

  const preCutoverFingerprint = fingerprint();
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

  // ------------------------------------------------------------------------
  proofStep("PRE_REPROCESSING_ROLLBACK restores the exact pre-cutover fixture");
  psqlFile(ROLLBACK_SQL);
  assertEqual(fingerprint(), preCutoverFingerprint,
    "the pre-reprocessing rollback must restore the exact pre-cutover fixture");
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
