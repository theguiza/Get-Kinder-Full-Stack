/**
 * KAI Plan A assembled customer file-to-report acceptance (Prompt 9), on a
 * disposable loopback PostgreSQL cluster only.
 *
 * Schema: the synthetic pre-migration base of production-owned tables no
 * repository migration creates, with kai.intake_batches / kai.intake_files in
 * the production-shaped form of the 2026-09-16 capture (storage columns,
 * enums, both partial declared-checksum indexes, lineage self-FKs; the same
 * file the duplicate-resolution proof uses), then the Plan A normal migration
 * chain (scripts/kai-sprint2-plan-a-migration-chain.js): every non-rollback
 * kai_sprint2_* migration once, unmodified, in repository introduction order
 * reconstructed from git, with no CHECK union, constraint patch, or table
 * mirror between or after migrations. The two production-history repairs
 * must refuse this fresh state and leave it unchanged.
 *
 * Then it runs the assembled browser acceptance
 * (__tests__/kai-customer-file-to-report-assembled-browser-acceptance.integration.spec.js)
 * in a child Node process whose ambient pool points only at this cluster.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { MIGRATION_CHAIN, PRODUCTION_HISTORY_ONLY, verifyChainAgainstRepository } from "./kai-sprint2-plan-a-migration-chain.js";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_plan_a_assembled_file_to_report_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-plan-a-assembled-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(62100 + Math.floor(Math.random() * 400));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";
const chromePath = process.env.KAI_BROWSER_ACCEPTANCE_CHROME
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const spec = "__tests__/kai-customer-file-to-report-assembled-browser-acceptance.integration.spec.js";

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
  if (row.database_name !== dbName) throw new Error("assembled runner refused non-synthetic database name");
  if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
    throw new Error(`assembled runner refused non-loopback server address: ${row.server_addr}`);
  }
  if (row.server_port !== port) throw new Error("assembled runner refused unexpected PostgreSQL port");
  if (row.listen_addresses !== "127.0.0.1") throw new Error("assembled runner refused non-loopback listen_addresses");
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
  throw new Error(`assembled runner requires a local Chrome binary (set KAI_BROWSER_ACCEPTANCE_CHROME); not found: ${chromePath}`);
}

let started = false;
try {
  verifyChainAgainstRepository(repoRoot);
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
    console.log(`Plan A assembled: ${migration} refused the fresh state as designed; schema unchanged.`);
  }
  console.log(`Plan A assembled: applied ${MIGRATION_CHAIN.length - PRODUCTION_HISTORY_ONLY.size} migrations in introduction order with no schema adjustment.`);
  const storageColumns = (await catalog(
    `SELECT string_agg(column_name, ',' ORDER BY column_name) AS columns FROM information_schema.columns
      WHERE table_schema = 'kai' AND table_name = 'intake_files'
        AND column_name IN ('storage_uri', 'storage_bucket', 'storage_object_key', 'gcs_generation', 'object_version_id', 'verified_checksum', 'upload_state')`))[0].columns;
  console.log(`Plan A assembled: kai.intake_files storage/lifecycle columns: ${storageColumns}`);
  console.log(`Plan A assembled schema fingerprint: ${(await catalog(schemaFingerprintSql))[0].fingerprint}`);

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
      KAI_PLAN_A_ASSEMBLED_DATABASE_URL: targetUrl,
      KAI_PLAN_A_ASSEMBLED_DATABASE_NAME: dbName,
      KAI_PLAN_A_ASSEMBLED_CHROME: chromePath,
      KAI_PLAN_A_ASSEMBLED_WORKDIR: workDir,
    },
  });
  if (testResult.status !== 0) throw new Error(`assembled file-to-report acceptance failed: ${spec}`);
  console.log(`Plan A assembled file-to-report acceptance passed: ${spec}`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Plan A assembled ephemeral PostgreSQL workdir removed: ${workDir}`);
}
