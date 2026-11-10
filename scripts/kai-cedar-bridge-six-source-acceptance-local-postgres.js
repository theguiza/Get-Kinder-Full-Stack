/**
 * KAI Cedar Bridge six-source assembled impact-evidence acceptance, on a
 * disposable loopback PostgreSQL cluster only.
 *
 * Schema: exactly the customer XLSX runner's - the synthetic pre-migration
 * base of production-owned tables, production-shaped intake tables, then the
 * Plan A normal migration chain in repository introduction order, with no
 * schema adjustment. No browser and no previous revision is needed.
 *
 * The six original synthetic files are read from outside the repository:
 *   KAI_CEDAR_BRIDGE_PACKAGE=<.../KAI_Synthetic_Impact_Evidence_Project>
 * Optional, for the spec's Stage E narrative-document journey (passed through):
 *   KAI_CEDAR_BRIDGE_SURVEY_PDF, KAI_CEDAR_BRIDGE_ORIGINAL_PDF
 * The spec verifies them against the package's integrity manifest, uploads
 * them through the real intake API, and compares KAI's results with the
 * package's independent answer key only after KAI has produced them. Nothing
 * from the package is copied into the repository.
 *
 * Then it runs
 * __tests__/kai-cedar-bridge-six-source-assembled-acceptance.integration.spec.js
 * in a child Node process whose ambient pool points only at this cluster.
 *
 * The same disposable schema also serves the synthetic Community Impact
 * Project B cross-source acceptance (owner Package 2, 2026-11-10): with
 *   KAI_COMMUNITY_PROJECT_B_PACKAGE=<.../KAI_Synthetic_Community_Impact_Project_B>
 * and no KAI_CEDAR_BRIDGE_PACKAGE, it runs
 * __tests__/kai-community-project-b-cross-source-acceptance.integration.spec.js
 * instead, against the same migration chain and verifiers.
 *
 * Owner Package 3 (2026-11-10), governed measurement-to-draft usability: with
 * KAI_COMMUNITY_PROJECT_B_PACKAGE and KAI_PROJECT_B_PROVISIONAL_DRAFT=true it
 * runs
 * __tests__/kai-community-project-b-provisional-draft-acceptance.integration.spec.js
 * instead. That spec also drives the built application in a local headless
 * Chrome (KAI_BROWSER_ACCEPTANCE_CHROME, default the macOS Google Chrome), and
 * loads the last revision before the Package 1 integrity repair
 * (LEGACY_REVISION, checked out by `git clone --shared` into the work
 * directory, removed with it) so a genuine pre-repair record-count claim is
 * written by that revision's own code.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { MIGRATION_CHAIN, PRODUCTION_HISTORY_ONLY, verifyChainAgainstRepository } from "./kai-sprint2-plan-a-migration-chain.js";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const cedarPackage = process.env.KAI_CEDAR_BRIDGE_PACKAGE;
const projectBPackage = cedarPackage ? null : process.env.KAI_COMMUNITY_PROJECT_B_PACKAGE;
const provisionalDraft = Boolean(projectBPackage) && process.env.KAI_PROJECT_B_PROVISIONAL_DRAFT === "true";
const dbName = provisionalDraft ? "kai_project_b_provisional_draft_synthetic"
  : projectBPackage ? "kai_community_project_b_synthetic" : "kai_cedar_bridge_six_source_synthetic";
// The last revision before the Package 1 measurement-to-claim integrity repair (44950111).
const LEGACY_REVISION = "58c4e0d9";
const chromePath = process.env.KAI_BROWSER_ACCEPTANCE_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
// Keep the prefix short: the Unix-socket path has a length limit on macOS.
const workDir = mkdtempSync(join(tmpdir(), "kai-cb6-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(62100 + Math.floor(Math.random() * 400));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";
const spec = provisionalDraft
  ? "__tests__/kai-community-project-b-provisional-draft-acceptance.integration.spec.js"
  : projectBPackage
    ? "__tests__/kai-community-project-b-cross-source-acceptance.integration.spec.js"
    : "__tests__/kai-cedar-bridge-six-source-assembled-acceptance.integration.spec.js";
const legacyCheckout = join(workDir, `checkout-${LEGACY_REVISION}`);
const packageRoot = projectBPackage || cedarPackage;
const reportPath = process.env.KAI_CEDAR_BRIDGE_REPORT || join(workDir, projectBPackage ? "community-project-b-report.json" : "cedar-bridge-six-source-report.json");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
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

async function catalog(sql, params = []) {
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

async function proveRunnerOwnedTarget() {
  const [row] = await catalog(`
    SELECT current_database() AS database_name, inet_server_addr()::text AS server_addr,
           inet_server_port()::text AS server_port, current_setting('listen_addresses') AS listen_addresses`);
  if (row.database_name !== dbName) throw new Error("Cedar Bridge runner refused non-synthetic database name");
  if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
    throw new Error(`Cedar Bridge runner refused non-loopback server address: ${row.server_addr}`);
  }
  if (row.server_port !== port) throw new Error("Cedar Bridge runner refused unexpected PostgreSQL port");
  if (row.listen_addresses !== "127.0.0.1") throw new Error("Cedar Bridge runner refused non-loopback listen_addresses");
}

const schemaFingerprintSql = `SELECT md5(string_agg(x, '|' ORDER BY x)) AS fingerprint FROM (
    SELECT c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) AS x
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname LIKE 'kai%' AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) FROM pg_constraint
     WHERE connamespace IN (SELECT oid FROM pg_namespace WHERE nspname LIKE 'kai%')
  ) t`;

if (!packageRoot || !existsSync(join(packageRoot, "01_UPLOAD_TO_KAI"))) {
  throw new Error("Cedar Bridge runner requires KAI_CEDAR_BRIDGE_PACKAGE or KAI_COMMUNITY_PROJECT_B_PACKAGE (the directory holding 01_UPLOAD_TO_KAI)");
}

let started = false;
try {
  verifyChainAgainstRepository(repoRoot);
  if (provisionalDraft) {
    if (!existsSync(chromePath)) throw new Error(`Package 3 acceptance requires a local Chrome binary (set KAI_BROWSER_ACCEPTANCE_CHROME); not found: ${chromePath}`);
    if (!existsSync(join(repoRoot, "public", "js", "bundles", "entry.js"))) throw new Error("Package 3 acceptance requires the built bundle: run npm run build first");
    run("git", ["clone", "--quiet", "--shared", "--no-checkout", repoRoot, legacyCheckout], { capture: true });
    run("git", ["checkout", "--quiet", "--detach", LEGACY_REVISION], { cwd: legacyCheckout, capture: true });
    symlinkSync(join(repoRoot, "node_modules"), join(legacyCheckout, "node_modules"));
  }
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();

  // Pre-migration base, identical to the customer XLSX runner's.
  psqlExec("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec("ALTER TABLE kai.engagements ADD CONSTRAINT kai_plan_a_assembled_engagements_id_org_unique UNIQUE (engagement_id, organization_id);");
  psqlFile("scripts/kai-sprint2-package-4-impact-library-engagement-funder-requirements-auth-bootstrap-synthetic-schema.sql");
  psqlExec("INSERT INTO kai.roles (role_name) VALUES ('client_admin'), ('client_contributor') ON CONFLICT (role_name) DO NOTHING;");
  psqlExec("ALTER TABLE public.userdata ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT true, ADD COLUMN IF NOT EXISTS is_suspended boolean DEFAULT false;");
  psqlExec("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS status text, ADD COLUMN IF NOT EXISTS logo_url text;");
  psqlExec(`CREATE TABLE public.org_applications (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES public.userdata (id), org_name text NOT NULL,
    org_description text, org_website text, rep_role text, status text NOT NULL DEFAULT 'pending',
    submitted_at timestamptz DEFAULT now(), reviewed_at timestamptz, reviewed_by text);`);
  psqlFile("scripts/kai-sprint2-intake-duplicate-resolution-production-shape-synthetic-schema.sql");

  // The Measurement MVP migration is additive: the schema it is applied to is
  // exactly what its rollback restores on an unused installation.
  const derivedMigration = "kai_sprint2_measurement_mvp_source_derived_measurements";
  let beforeDerived = null;
  for (const migration of MIGRATION_CHAIN) {
    const refusal = PRODUCTION_HISTORY_ONLY.get(migration);
    if (migration === derivedMigration) beforeDerived = (await catalog(schemaFingerprintSql))[0].fingerprint;
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
    if (!refused) throw new Error(`${migration} unexpectedly applied to the fresh assembled schema`);
    if ((await catalog(schemaFingerprintSql))[0].fingerprint !== before) throw new Error(`${migration} refusal changed the schema`);
  }
  console.log(`Cedar Bridge acceptance: applied ${MIGRATION_CHAIN.length - PRODUCTION_HISTORY_ONLY.size} migrations in introduction order with no schema adjustment.`);
  if (!beforeDerived) throw new Error(`${derivedMigration} is not in the migration chain`);
  // The cross-source migration builds on the derived one, so both roll back
  // in reverse order: each rollback restores the schema before it, and both
  // re-apply identically.
  const crossMigration = "kai_sprint2_measurement_mvp_cross_source_reach";
  if (!MIGRATION_CHAIN.includes(crossMigration)) throw new Error(`${crossMigration} is not in the migration chain`);
  // The reconciliation job table builds on the cross-source migration: it rolls back first and re-applies last.
  const jobsMigration = "kai_sprint2_measurement_mvp_cross_source_reconciliation_jobs";
  if (!MIGRATION_CHAIN.includes(jobsMigration)) throw new Error(`${jobsMigration} is not in the migration chain`);
  // The document-statement migration widens CHECKs the derived rollback
  // restores, so it rolls back first and re-applies last.
  const documentMigration = "kai_sprint2_document_statement_evidence";
  if (MIGRATION_CHAIN.at(-1) !== documentMigration) throw new Error(`${documentMigration} is not the last migration in the chain`);
  const afterDocument = (await catalog(schemaFingerprintSql))[0].fingerprint;
  psqlFile(`migrations/${documentMigration}.rollback.sql`);
  const afterJobs = (await catalog(schemaFingerprintSql))[0].fingerprint;
  psqlFile(`migrations/${jobsMigration}.rollback.sql`);
  const afterCross = (await catalog(schemaFingerprintSql))[0].fingerprint;
  psqlFile(`migrations/${crossMigration}.rollback.sql`);
  const afterDerived = (await catalog(schemaFingerprintSql))[0].fingerprint;
  psqlFile(`migrations/${derivedMigration}.rollback.sql`);
  if ((await catalog(schemaFingerprintSql))[0].fingerprint !== beforeDerived) throw new Error(`${derivedMigration} rollback did not restore the prior schema`);
  psqlFile(`migrations/${derivedMigration}.sql`);
  if ((await catalog(schemaFingerprintSql))[0].fingerprint !== afterDerived) throw new Error(`${derivedMigration} re-apply changed the schema`);
  psqlFile(`migrations/${crossMigration}.sql`);
  if ((await catalog(schemaFingerprintSql))[0].fingerprint !== afterCross) throw new Error(`${crossMigration} re-apply changed the schema`);
  psqlFile(`migrations/${jobsMigration}.sql`);
  if ((await catalog(schemaFingerprintSql))[0].fingerprint !== afterJobs) throw new Error(`${jobsMigration} re-apply changed the schema`);
  psqlFile(`migrations/${documentMigration}.sql`);
  if ((await catalog(schemaFingerprintSql))[0].fingerprint !== afterDocument) throw new Error(`${documentMigration} re-apply changed the schema`);
  console.log(`Cedar Bridge acceptance: ${documentMigration}, ${jobsMigration}, ${crossMigration} and ${derivedMigration} rolled back to the prior schema fingerprints and re-applied identically.`);
  for (const verifier of ["scripts/kai-sprint2-p2-01m-xlsx-worksheet-method-verify-read-only.sql", "scripts/kai-measurement-mvp-derived-measurements-verify-read-only.sql"]) {
    const rows = run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-tA", "-F", "|", "-f", verifier], { capture: true }).stdout.trim().split("\n");
    if (rows.find((row) => row.startsWith("99|OVERALL|"))?.split("|")[2] !== "PASS") throw new Error(`${verifier} failed:\n${rows.join("\n")}`);
  }
  console.log("Cedar Bridge acceptance: XLSX method and derived-measurement verifiers OVERALL PASS.");
  console.log(`Cedar Bridge acceptance schema fingerprint: ${(await catalog(schemaFingerprintSql))[0].fingerprint}`);

  const testResult = spawnSync("node", ["--test", "--test-concurrency=1", "--test-timeout=600000", spec], {
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
      KAI_FILE_UPLOAD_ENABLED: "true",
      KAI_WORKER_ENABLED: "true",
      KAI_GENERATION_ENABLED: "true",
      KAI_CEDAR_ACCEPTANCE_DATABASE_URL: targetUrl,
      KAI_CEDAR_ACCEPTANCE_DATABASE_NAME: dbName,
      ...(projectBPackage ? { KAI_COMMUNITY_PROJECT_B_PACKAGE: projectBPackage } : { KAI_CEDAR_BRIDGE_PACKAGE: cedarPackage }),
      ...(provisionalDraft ? {
        KAI_PROJECT_B_PROVISIONAL_DRAFT: "true",
        KAI_P3_CHROME: chromePath,
        KAI_P3_WORKDIR: workDir,
        KAI_P3_LEGACY_CHECKOUT: legacyCheckout,
        KAI_P3_LEGACY_REVISION: LEGACY_REVISION,
      } : {}),
      KAI_CEDAR_BRIDGE_REPORT: reportPath,
    },
  });
  if (testResult.status !== 0) throw new Error(`Cedar Bridge six-source acceptance failed: ${spec}`);
  console.log(`Cedar Bridge six-source acceptance passed: ${spec}`);
  console.log(`Cedar Bridge boundary report: ${reportPath}`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  // The report is kept when it was written outside the work directory.
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Cedar Bridge acceptance ephemeral PostgreSQL workdir removed: ${workDir}`);
}
