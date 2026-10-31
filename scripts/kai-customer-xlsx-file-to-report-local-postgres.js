/**
 * KAI customer Excel workbook to internal report acceptance (P2-01M XLSX
 * worksheet method), on a disposable loopback PostgreSQL cluster only.
 *
 * Schema: exactly the assembled file-to-report runner's - the synthetic
 * pre-migration base of production-owned tables, production-shaped intake
 * tables, then the Plan A normal migration chain in repository introduction
 * order (now ending with kai_sprint2_p2_01m_xlsx_worksheet_record_count_method),
 * with no schema adjustment.
 *
 * The previous application revision (LEGACY_REVISION, the last one before
 * the worksheet record-count basis) is checked out by `git clone --shared`
 * into the runner's temporary directory, so the spec can load it in the same
 * process and let it upload, profile and promote the legacy workbook exactly
 * as that revision did. The clone shares the repository's object store and
 * is removed with the work directory.
 *
 * Then it runs
 * __tests__/kai-customer-xlsx-file-to-report-browser-acceptance.integration.spec.js
 * in a child Node process whose ambient pool points only at this cluster.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { MIGRATION_CHAIN, PRODUCTION_HISTORY_ONLY, verifyChainAgainstRepository } from "./kai-sprint2-plan-a-migration-chain.js";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_customer_xlsx_file_to_report_synthetic";
// The last revision before the P1 worksheet record-count basis.
const LEGACY_REVISION = "4e41090";
// The last revision whose count-only Evidence Summary was model-drafted; its
// own code writes the historical count-only draft case K must not deliver.
const PRE_COMPOSED_FINDING_REVISION = "d3984e7";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-xlsx-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(62100 + Math.floor(Math.random() * 400));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";
const chromePath = process.env.KAI_BROWSER_ACCEPTANCE_CHROME
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const spec = "__tests__/kai-customer-xlsx-file-to-report-browser-acceptance.integration.spec.js";
const legacyCheckout = join(workDir, `checkout-${LEGACY_REVISION}`);
const preComposedCheckout = join(workDir, `checkout-${PRE_COMPOSED_FINDING_REVISION}`);

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
  if (row.database_name !== dbName) throw new Error("XLSX runner refused non-synthetic database name");
  if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
    throw new Error(`XLSX runner refused non-loopback server address: ${row.server_addr}`);
  }
  if (row.server_port !== port) throw new Error("XLSX runner refused unexpected PostgreSQL port");
  if (row.listen_addresses !== "127.0.0.1") throw new Error("XLSX runner refused non-loopback listen_addresses");
}

const schemaFingerprintSql = `SELECT md5(string_agg(x, '|' ORDER BY x)) AS fingerprint FROM (
    SELECT c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) AS x
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname LIKE 'kai%' AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) FROM pg_constraint
     WHERE connamespace IN (SELECT oid FROM pg_namespace WHERE nspname LIKE 'kai%')
  ) t`;

if (!existsSync(chromePath)) {
  throw new Error(`XLSX runner requires a local Chrome binary (set KAI_BROWSER_ACCEPTANCE_CHROME); not found: ${chromePath}`);
}

let started = false;
try {
  verifyChainAgainstRepository(repoRoot);
  run("git", ["clone", "--quiet", "--shared", "--no-checkout", repoRoot, legacyCheckout], { capture: true });
  run("git", ["checkout", "--quiet", "--detach", LEGACY_REVISION], { cwd: legacyCheckout, capture: true });
  symlinkSync(join(repoRoot, "node_modules"), join(legacyCheckout, "node_modules"));
  if (existsSync(join(legacyCheckout, "migrations", "kai_sprint2_p2_01m_xlsx_worksheet_record_count_method.sql"))) {
    throw new Error(`${LEGACY_REVISION} unexpectedly already has the XLSX worksheet method`);
  }
  run("git", ["clone", "--quiet", "--shared", "--no-checkout", repoRoot, preComposedCheckout], { capture: true });
  run("git", ["checkout", "--quiet", "--detach", PRE_COMPOSED_FINDING_REVISION], { cwd: preComposedCheckout, capture: true });
  symlinkSync(join(repoRoot, "node_modules"), join(preComposedCheckout, "node_modules"));
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();

  // Pre-migration base: synthetic mirrors of the production-owned tables no
  // repository migration creates. The auth mirror (kai.users, roles,
  // memberships, Get Kinder accounts and organization memberships) is the one
  // the real resolveKaiActorContext reads, as in the browser-acceptance runner.
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
  // Production-shaped intake tables, with the storage columns the upload,
  // confirmation, and security re-check write.
  psqlFile("scripts/kai-sprint2-intake-duplicate-resolution-production-shape-synthetic-schema.sql");

  for (const migration of MIGRATION_CHAIN) {
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
    if (!refused) throw new Error(`${migration} unexpectedly applied to the fresh assembled schema`);
    if ((await catalog(schemaFingerprintSql))[0].fingerprint !== before) throw new Error(`${migration} refusal changed the schema`);
    console.log(`XLSX acceptance: ${migration} refused the fresh state as designed; schema unchanged.`);
  }
  console.log(`XLSX acceptance: applied ${MIGRATION_CHAIN.length - PRODUCTION_HISTORY_ONLY.size} migrations in introduction order with no schema adjustment.`);
  const storageColumns = (await catalog(
    `SELECT string_agg(column_name, ',' ORDER BY column_name) AS columns FROM information_schema.columns
      WHERE table_schema = 'kai' AND table_name = 'intake_files'
        AND column_name IN ('storage_uri', 'storage_bucket', 'storage_object_key', 'gcs_generation', 'object_version_id', 'verified_checksum', 'upload_state')`))[0].columns;
  console.log(`XLSX acceptance: kai.intake_files storage/lifecycle columns: ${storageColumns}`);
  console.log(`XLSX acceptance schema fingerprint: ${(await catalog(schemaFingerprintSql))[0].fingerprint}`);
  const verifier = run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-tA", "-F", "|", "-f", "scripts/kai-sprint2-p2-01m-xlsx-worksheet-method-verify-read-only.sql"], { capture: true }).stdout.trim();
  if (!/^99\|OVERALL\|PASS\|/m.test(verifier)) throw new Error(`P2-01M XLSX worksheet method verifier failed:\n${verifier}`);
  console.log(`XLSX acceptance: read-only method verifier OVERALL PASS`);

  const testResult = spawnSync("node", ["--test", "--test-timeout=600000", spec], {
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
      KAI_XLSX_ACCEPTANCE_DATABASE_URL: targetUrl,
      KAI_XLSX_ACCEPTANCE_DATABASE_NAME: dbName,
      KAI_XLSX_ACCEPTANCE_CHROME: chromePath,
      KAI_XLSX_ACCEPTANCE_WORKDIR: workDir,
      KAI_XLSX_ACCEPTANCE_LEGACY_CHECKOUT: legacyCheckout,
      KAI_XLSX_ACCEPTANCE_LEGACY_REVISION: LEGACY_REVISION,
      KAI_XLSX_ACCEPTANCE_PRE_COMPOSED_CHECKOUT: preComposedCheckout,
      KAI_XLSX_ACCEPTANCE_PRE_COMPOSED_REVISION: PRE_COMPOSED_FINDING_REVISION,
    },
  });
  if (testResult.status !== 0) throw new Error(`XLSX file-to-report acceptance failed: ${spec}`);
  console.log(`XLSX file-to-report acceptance passed: ${spec}`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  // Unlink the checkout's node_modules symlink first so removal can never follow it.
  rmSync(join(legacyCheckout, "node_modules"), { force: true });
  rmSync(join(preComposedCheckout, "node_modules"), { force: true });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`XLSX acceptance ephemeral PostgreSQL workdir removed: ${workDir}`);
}
