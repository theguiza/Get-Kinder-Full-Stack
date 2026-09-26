import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

/**
 * Local browser acceptance for the client Knowledge Studio (Funder
 * Requirements, Generated Drafts, Grant Response Packet / Board Reporting
 * previews, client follow-up completion) for client_admin, client_reviewer,
 * and client_contributor. Passing
 * __tests__/kai-web-intake-files-rehydration-browser-acceptance.integration.spec.js
 * as the first argument runs the Knowledge Studio Files persistence/
 * rehydration acceptance against the same fixture instead.
 *
 * - An ephemeral, loopback-only PostgreSQL cluster owned by this runner,
 *   with the union of the schemas the client product reads, applied in the
 *   canonical order the P14-09 funder-authority runner established, and the
 *   repository's synthetic smoke seeds. Removed afterwards.
 * - A child Node process (the acceptance spec) whose ambient pool
 *   (Backend/db/pg.js) points only at that cluster: every URL-style database
 *   variable is cleared, so .env can never redirect it.
 * - The spec seeds governed state through the real services, serves the real
 *   KAI routers and the real built bundle from a loopback Express app, and
 *   drives a real headless Chrome over the DevTools protocol.
 *
 * The only simulated layer is the Get Kinder session login: the harness app
 * sets req.user from a harness cookie, as the route tests set req.user. Every
 * KAI actor, membership, and authorization decision is the real one.
 */

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_client_browser_acceptance_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-client-browser-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(59800 + Math.floor(Math.random() * 100));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";
const chromePath = process.env.KAI_BROWSER_ACCEPTANCE_CHROME
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// The acceptance spec to run against this fixture (default: the client
// Knowledge Studio acceptance). Only the listed runner-owned specs may run.
const ACCEPTANCE_SPECS = Object.freeze([
  "__tests__/kai-client-knowledge-studio-browser-acceptance.integration.spec.js",
  "__tests__/kai-web-intake-files-rehydration-browser-acceptance.integration.spec.js",
]);
const acceptanceSpec = process.argv[2] || ACCEPTANCE_SPECS[0];
if (!ACCEPTANCE_SPECS.includes(acceptanceSpec)) {
  throw new Error(`browser acceptance runner refused an unlisted spec: ${acceptanceSpec}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, DATABASE_URL: sentinelUrl, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: dbName, PGUSER: user },
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
    const { rows } = await client.query(`
      SELECT current_database() AS database_name, inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port, current_setting('listen_addresses') AS listen_addresses`);
    const row = rows[0];
    if (row.database_name !== dbName) throw new Error("browser acceptance runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`browser acceptance runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("browser acceptance runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("browser acceptance runner refused non-loopback listen_addresses");
  } finally {
    await client.end();
  }
}

if (!existsSync(chromePath)) {
  throw new Error(`browser acceptance requires a local Chrome binary (set KAI_BROWSER_ACCEPTANCE_CHROME); not found: ${chromePath}`);
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();

  // Organizations/engagements/audit and the auth mirror the real
  // resolveKaiActorContext reads (Package 4 runner).
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec("ALTER TABLE kai.engagements ADD CONSTRAINT kai_client_browser_engagements_id_org_unique UNIQUE (engagement_id, organization_id);");
  psqlFile("scripts/kai-sprint2-package-4-impact-library-engagement-funder-requirements-auth-bootstrap-synthetic-schema.sql");
  // The Package 4 auth mirror lists the GK and reviewer roles only; the
  // client roles this acceptance signs in as are added as synthetic rows.
  psqlExec("INSERT INTO kai.roles (role_name) VALUES ('client_admin'), ('client_contributor') ON CONFLICT (role_name) DO NOTHING;");
  // orgScopeService selects public.organizations.status (the production
  // column the onboarding runner's bootstrap also adds).
  psqlExec("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS status text;");
  // Onboarding status reads public.org_applications (onboarding runner's
  // synthetic mirror of the columns it selects).
  psqlExec(`CREATE TABLE public.org_applications (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES public.userdata (id), org_name text NOT NULL,
    org_description text, org_website text, rep_role text, status text NOT NULL DEFAULT 'pending',
    submitted_at timestamptz DEFAULT now(), reviewed_at timestamptz, reviewed_by text);`);

  // Governed evidence/claim/review chain in the P14-09 runner's canonical
  // order (P3-01 right after P2-09, then the P2-09/P2-10/P2-11 forward
  // reconciliation), then the Phase-5, decision-ledger, and funder/public
  // authority migrations the real P2-06 evaluator reads.
  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  for (const migration of [
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
    "kai_sprint2_a1_1_impact_outcome_context",
    "kai_sprint2_a1_2_impact_evaluation_framework_and_criteria",
    "kai_sprint2_a1_3_impact_evaluations_and_results",
    "kai_sprint2_a1_4_impact_evaluation_result_provenance_links",
    "kai_sprint2_b1_1_baseline_impact_requirements",
    "kai_sprint2_package_2a_engagement_requirement_sets_authority",
    "kai_sprint2_c2_1_requirement_assessment_persistence",
    "kai_sprint2_p2_04_claim_gap_followup",
    "kai_sprint2_p2_05_conflict_review_candidate",
    "kai_sprint2_p2_09_human_review_internal_approval",
    "kai_sprint2_p3_01_generated_content_drafts",
    "kai_sprint2_p2_10_coverage_review_decision",
    "kai_sprint2_p2_11_client_followup_completion",
    "kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation",
    "kai_sprint2_p14_01_generation_run_engagement_binding",
    "kai_sprint2_b1a_02_phase5_allowed_use_decision_ledger",
    "kai_sprint2_p2_12_human_review_decision_ledger",
    "kai_sprint2_p2_10_funder_coverage_authority",
    "kai_sprint2_p2_10_public_coverage_authority",
    "kai_sprint2_c3_a3_requirement_assessment_decision_gap_provenance",
    "kai_sprint2_c3_a4_requirement_assessment_provenance_extension",
    "kai_sprint2_p13_01_impact_narrative_content_type",
    "kai_sprint2_p14_14_generated_content_type_evolution",
    "kai_sprint2_p3_04_generated_content_review_completion",
    "kai_sprint2_package_g_improvement_practices_foundation",
    "kai_sprint2_join_1_organization_join_requests",
    "kai_sprint2_gk_organization_tenant_binding",
  ]) {
    psqlFile(`migrations/${migration}.sql`);
  }
  // No repository migration creates kai.intake_batches (a pre-migration base
  // table, like kai.audit_events), and the synthetic kai.intake_files above
  // lacks some columns the file read models select. Knowledge Studio's Files
  // tab reads both on entry, so both get synthetic mirrors of exactly the
  // columns the batch/file read models select.
  psqlExec(`CREATE TABLE kai.intake_batches (
    intake_batch_id uuid PRIMARY KEY, organization_id uuid NOT NULL, engagement_id uuid, batch_code text,
    processing_status text, review_status text, idempotency_key text, source_system_name text, source_system_ref text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());`);
  psqlExec(`ALTER TABLE kai.intake_files
    ADD COLUMN IF NOT EXISTS engagement_id uuid, ADD COLUMN IF NOT EXISTS mime_type text, ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
    ADD COLUMN IF NOT EXISTS malware_scan_status text, ADD COLUMN IF NOT EXISTS review_status text,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();`);
  for (const seed of [
    "kai-sprint2-gate-a-smoke-seed",
    "kai-sprint2-p1-04-data-dictionary-quality-smoke-seed",
    "kai-sprint2-p1-05-intake-sensitivity-profile-smoke-seed",
    "kai-sprint2-p1-06-review-queue-smoke-seed",
    "kai-sprint2-p1-07-source-candidate-smoke-seed",
    "kai-sprint2-p1-08-source-promotion-smoke-seed",
    "kai-sprint2-p2-01-evidence-lineage-smoke-seed",
  ]) {
    psqlFile(`scripts/${seed}.sql`);
  }

  const testResult = spawnSync("node", ["--test", acceptanceSpec], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: {
      ...process.env,
      // No URL-style variable may reach the ambient pool (and dotenv never
      // overrides a key that is already set, even to "").
      DATABASE_URL: "",
      DATABASE_URL_LOCAL: "",
      PGURL_LOCAL: "",
      RENDER_DATABASE_URL: "",
      PROD_DATABASE_URL: "",
      NODE_ENV: "development",
      DB_HOST: "127.0.0.1",
      DB_PORT: port,
      DB_NAME: dbName,
      DB_USER: user,
      DB_PASSWORD: "",
      KAI_SPRINT2_ENABLED: "true",
      KAI_GENERATION_ENABLED: "true",
      KAI_CLIENT_BROWSER_ACCEPTANCE_DATABASE_URL: targetUrl,
      KAI_CLIENT_BROWSER_ACCEPTANCE_CHROME: chromePath,
      KAI_CLIENT_BROWSER_ACCEPTANCE_WORKDIR: workDir,
    },
  });
  if (testResult.status !== 0) throw new Error(`browser acceptance failed: ${acceptanceSpec}`);
  console.log(`Browser acceptance passed: ${acceptanceSpec}`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Client Knowledge Studio browser acceptance ephemeral workdir removed: ${workDir}`);
}
