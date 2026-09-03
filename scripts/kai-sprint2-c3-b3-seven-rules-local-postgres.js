import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_c3_b3_seven_rules_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-c3-b3-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(59000 + Math.floor(Math.random() * 1000));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      DATABASE_URL: sentinelUrl,
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
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("C3.B3 seven-rules runner refused a non-loopback target before connecting");
  }
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
    if (row.database_name !== dbName) throw new Error("C3.B3 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`C3.B3 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("C3.B3 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("C3.B3 runner refused non-loopback listen_addresses");
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

  // Full dependency chain through C3.A4 (this package's dispatcher entries
  // read kai.impact_outcome_contexts, kai.conflict_groups, and
  // kai.claim_evidence_links in addition to everything C3.A3 already
  // required, and write into all three C3.A4 provenance tables).
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec(
    "ALTER TABLE kai.engagements ADD CONSTRAINT kai_c3_b3_engagements_id_org_unique UNIQUE (engagement_id, organization_id);",
  );
  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
  psqlFile("migrations/kai_sprint2_p1_parser_run_and_file_profile.sql");
  psqlFile("migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql");
  psqlFile("migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql");
  psqlFile("migrations/kai_sprint2_p1_06_review_queue.sql");
  psqlFile("migrations/kai_sprint2_p1_07_intake_source_candidate.sql");
  psqlFile("migrations/kai_sprint2_p1_08_source_promotion.sql");
  psqlFile("migrations/kai_sprint2_p2_01_evidence_lineage.sql");
  psqlFile("migrations/kai_sprint2_p2_03_claim_proposal.sql");
  psqlFile("migrations/kai_sprint2_a1_1_impact_outcome_context.sql");
  psqlFile("migrations/kai_sprint2_a1_2_impact_evaluation_framework_and_criteria.sql");
  psqlFile("migrations/kai_sprint2_a1_3_impact_evaluations_and_results.sql");
  psqlFile("migrations/kai_sprint2_a1_4_impact_evaluation_result_provenance_links.sql");
  psqlFile("migrations/kai_sprint2_b1_1_baseline_impact_requirements.sql");
  psqlFile("migrations/kai_sprint2_c2_1_requirement_assessment_persistence.sql");
  psqlFile("migrations/kai_sprint2_p2_04_claim_gap_followup.sql");
  psqlFile("migrations/kai_sprint2_p2_05_conflict_review_candidate.sql");
  psqlFile("migrations/kai_sprint2_p2_09_human_review_internal_approval.sql");
  psqlFile("migrations/kai_sprint2_p2_10_coverage_review_decision.sql");
  psqlFile("migrations/kai_sprint2_p2_11_client_followup_completion.sql");
  psqlFile("migrations/kai_sprint2_p2_12_human_review_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_c3_a3_requirement_assessment_decision_gap_provenance.sql");
  psqlFile("migrations/kai_sprint2_c3_a4_requirement_assessment_provenance_extension.sql");

  const commonTestEnv = {
    ...process.env,
    DATABASE_URL: "",
    DATABASE_URL_LOCAL: "",
    PGURL_LOCAL: "",
    RENDER_DATABASE_URL: "",
    PROD_DATABASE_URL: "",
    DB_HOST: "127.0.0.1",
    DB_PORT: port,
    DB_NAME: dbName,
    DB_USER: user,
    DB_PASSWORD: "",
    KAI_C3_B3_SEVEN_RULES_DATABASE_URL: targetUrl,
    KAI_C3_A4_PROVENANCE_DATABASE_URL: targetUrl,
    KAI_C3_A3_PROVENANCE_DATABASE_URL: targetUrl,
    KAI_C2_1_REQUIREMENT_ASSESSMENT_DATABASE_URL: targetUrl,
    KAI_C3_A3_B_IR_CONTRIB_002_REPAIR_DATABASE_URL: targetUrl,
    KAI_C3_B2_IR_COMM_002_DATABASE_URL: targetUrl,
    KAI_C3B2_C_CONCURRENT_CURRENTNESS_DATABASE_URL: targetUrl,
    KAI_REQUIREMENTS_ROLLUP_DATABASE_URL: targetUrl,
  };

  // Requirements-readiness-rollup proof runs FIRST, before every other
  // suite below - kai.requirements.requirement_key is only unique per
  // requirement_set (not globally: requirements_b1_1_identity_unique is
  // UNIQUE(requirement_set_id, requirement_key)), so this is the only point
  // in the whole run where kai.requirements is guaranteed empty and the
  // nine supported requirement keys can be proven to appear exactly once.
  // Every later suite's own fixture builders (e.g. C3.B3's own
  // makeRequirement) insert additional rows sharing these same keys in
  // their own, separate requirement_sets, which would make "exactly nine,
  // each appearing once" unprovable if this ran after them.
  const rollupResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-requirements-readiness-rollup.integration.spec.js",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: commonTestEnv,
  });
  if (rollupResult.status !== 0) throw new Error("requirements-readiness-rollup PostgreSQL integration proof failed");
  console.log("requirements-readiness-rollup PostgreSQL integration proof passed.");

  // Regression suites run FIRST, before the C3.B3 focused suite - BUT
  // split into two groups around the smoke-seed application, because
  // C2.1/C3.A3/C3.A4's own integration suites each TRUNCATE
  // kai.engagements, kai.organizations ... CASCADE in their beforeEach,
  // which deletes the fixed-id ORG_GAPS organization (and everything
  // cascading from it) entirely. C3.A3.B/C3.B2/C3.B2.C's suites - and the
  // C3.B3 focused suite below - all depend on ORG_GAPS's smoke-seeded real
  // is_current source_version still existing, so the truncating suites
  // must run to completion FIRST, then the smoke-seed chain is (re)applied
  // exactly once, then every suite that touches ORG_GAPS runs afterward
  // with no further organization-wide TRUNCATE in between. Each suite
  // still runs as its OWN `node --test` invocation (never combined - see
  // C3.A4's runner for why: concurrent TRUNCATE-based suites race on a
  // shared database).
  const truncatingRegressionSuites = [
    ["C2.1", [
      "__tests__/kai-sprint2-c2-1-requirement-assessment-persistence-schema-contract.spec.js",
      "__tests__/kai-sprint2-c2-1-requirement-assessment-persistence.integration.spec.js",
    ]],
    ["C3.A3", [
      "__tests__/kai-sprint2-c3-a3-requirement-assessment-decision-gap-provenance-schema-contract.spec.js",
      "__tests__/kai-sprint2-c3-a3-requirement-assessment-decision-gap-provenance.integration.spec.js",
    ]],
    ["C3.A4 (provenance extension)", [
      "__tests__/kai-sprint2-c3-a4-requirement-assessment-provenance-extension-schema-contract.spec.js",
      "__tests__/kai-sprint2-c3-a4-requirement-assessment-provenance-extension.integration.spec.js",
    ]],
  ];

  const orgGapsDependentRegressionSuites = [
    ["C3.A3.B (ir_contrib_002 repair)", [
      "__tests__/kai-sprint2-c3-a3-b-ir-contrib-002-repair-validators.spec.js",
      "__tests__/kai-sprint2-c3-a3-b-ir-contrib-002-repair.integration.spec.js",
    ]],
    ["C3.B2 (ir_comm_002)", [
      "__tests__/kai-sprint2-c3-b2-ir-comm-002-validators.spec.js",
      "__tests__/kai-sprint2-c3-b2-ir-comm-002.integration.spec.js",
    ]],
    ["C3.B2.C (concurrent currentness)", [
      "__tests__/kai-sprint2-c3b2-c-concurrent-currentness.integration.spec.js",
    ]],
  ];

  async function runSuites(suites) {
    for (const [label, files] of suites) {
      const result = spawnSync("node", ["--test", ...files], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: "inherit",
        env: commonTestEnv,
      });
      if (result.status !== 0) throw new Error(`${label} regression suite failed against the C3.B3-extended dispatcher`);
      console.log(`${label} regression suite passed against the C3.B3-extended dispatcher.`);
    }
  }

  await runSuites(truncatingRegressionSuites);

  // Smoke-seed chain (mirrors the C3.A3.B runner) giving the real
  // P2-01/P2-02/P2-04 service stack one pre-promoted, is_current
  // source_version to extract evidence from - needed so ir_data_002/
  // ir_contrib_003 tests can build claims with REAL, currently-applicable
  // kai.gap_log_items rows via the real production services, not a
  // hand-simulated snapshot (a raw INSERT into gap_log_items is never
  // recognized as current by filterCurrentOrganizationEvidenceGaps).
  // Applied here, AFTER every organization-wide-TRUNCATE suite above has
  // already run, so nothing downstream deletes it again.
  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-04-data-dictionary-quality-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-06-review-queue-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-07-source-candidate-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-08-source-promotion-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p2-01-evidence-lineage-smoke-seed.sql");

  await runSuites(orgGapsDependentRegressionSuites);

  // C3.A3.B's own B4 test deliberately flips every ORG_GAPS source_version
  // to is_current = false as its last step (proving stale gaps are
  // excluded) - restore currentness so the C3.B3 focused suite below,
  // which reuses the same fixed-id ORG_GAPS fixture for ir_data_002/
  // ir_contrib_003, still finds a real, currently-applicable gap universe
  // to work with.
  psqlExec("UPDATE kai.source_versions SET is_current = true WHERE organization_id = '00000000-0000-4000-8000-000000000001';");

  const focusedResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-c3-b3-seven-rules-validators.spec.js",
    "__tests__/kai-sprint2-c3-b3-seven-rules.integration.spec.js",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: commonTestEnv,
  });
  if (focusedResult.status !== 0) throw new Error("C3.B3 seven-rules tests failed");
  console.log("C3.B3 seven-rules local PostgreSQL proof passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`C3.B3 seven-rules ephemeral PostgreSQL workdir removed: ${workDir}`);
}
