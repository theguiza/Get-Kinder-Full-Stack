/**
 * KAI document-statement evidence acceptance, on a disposable loopback
 * PostgreSQL cluster only (created in a temporary directory, listening on
 * 127.0.0.1, removed at the end).
 *
 * Schema: exactly the Cedar Bridge six-source runner's - the synthetic
 * pre-migration base, production-shaped intake tables, then the Plan A
 * normal migration chain in repository introduction order, now ending with
 * kai_sprint2_document_statement_evidence. It proves that migration's
 * rollback and re-apply by schema fingerprint, leaves it rolled back, and
 * runs __tests__/kai-document-statement-evidence.integration.spec.js, which
 * reads the "not installed" state first and then applies it.
 *
 * Synthetic fixtures are read from outside the repository and never copied:
 *   KAI_CEDAR_BRIDGE_PACKAGE=<.../KAI_Synthetic_Impact_Evidence_Project>
 *   KAI_CEDAR_BRIDGE_SURVEY_PDF=<.../Cedar_Bridge_Survey_Results_Verified.pdf>
 *   KAI_CEDAR_BRIDGE_ORIGINAL_PDF=<.../Cedar_Bridge_Survey_Results_FY2025-26.pdf>
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { MIGRATION_CHAIN, PRODUCTION_HISTORY_ONLY, verifyChainAgainstRepository } from "./kai-sprint2-plan-a-migration-chain.js";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_document_statement_evidence_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
// Keep the prefix short: the Unix-socket path has a length limit on macOS.
const workDir = mkdtempSync(join(tmpdir(), "kai-dse-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(62600 + Math.floor(Math.random() * 300));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";
const spec = "__tests__/kai-document-statement-evidence.integration.spec.js";
const cedarPackage = process.env.KAI_CEDAR_BRIDGE_PACKAGE;
const surveyPdf = process.env.KAI_CEDAR_BRIDGE_SURVEY_PDF;
const originalPdf = process.env.KAI_CEDAR_BRIDGE_ORIGINAL_PDF;

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
  if (row.database_name !== dbName) throw new Error("document evidence runner refused non-synthetic database name");
  if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
    throw new Error(`document evidence runner refused non-loopback server address: ${row.server_addr}`);
  }
  if (row.server_port !== port) throw new Error("document evidence runner refused unexpected PostgreSQL port");
  if (row.listen_addresses !== "127.0.0.1") throw new Error("document evidence runner refused non-loopback listen_addresses");
}

const schemaFingerprintSql = `SELECT md5(string_agg(x, '|' ORDER BY x)) AS fingerprint FROM (
    SELECT c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) AS x
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname LIKE 'kai%' AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) FROM pg_constraint
     WHERE connamespace IN (SELECT oid FROM pg_namespace WHERE nspname LIKE 'kai%')
  ) t`;

if (!cedarPackage || !existsSync(join(cedarPackage, "01_UPLOAD_TO_KAI")) || !surveyPdf || !existsSync(surveyPdf) || !originalPdf || !existsSync(originalPdf)) {
  throw new Error("document evidence runner requires KAI_CEDAR_BRIDGE_PACKAGE, KAI_CEDAR_BRIDGE_SURVEY_PDF and KAI_CEDAR_BRIDGE_ORIGINAL_PDF");
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
  let beforeDocument = null;
  for (const migration of MIGRATION_CHAIN) {
    const refusal = PRODUCTION_HISTORY_ONLY.get(migration);
    if (migration === derivedMigration) beforeDerived = (await catalog(schemaFingerprintSql))[0].fingerprint;
    if (migration === "kai_sprint2_document_statement_evidence") beforeDocument = (await catalog(schemaFingerprintSql))[0].fingerprint;
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
  console.log(`Document evidence: applied ${MIGRATION_CHAIN.length - PRODUCTION_HISTORY_ONLY.size} migrations in introduction order with no schema adjustment.`);
  if (!beforeDerived) throw new Error(`${derivedMigration} is not in the migration chain`);
  // The document-statement migration is last in the chain: the verifiers
  // still pass with it applied, its rollback restores the prior schema
  // exactly and its re-apply is identical. The spec then starts from the
  // rolled-back state (phase A) and applies it itself (phase B).
  const documentMigration = "kai_sprint2_document_statement_evidence";
  if (MIGRATION_CHAIN.at(-1) !== documentMigration) throw new Error(`${documentMigration} is not the last migration in the chain`);
  if (!beforeDocument) throw new Error(`${documentMigration} was not applied`);
  for (const verifier of ["scripts/kai-sprint2-p2-01m-xlsx-worksheet-method-verify-read-only.sql", "scripts/kai-measurement-mvp-derived-measurements-verify-read-only.sql"]) {
    const rows = run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-tA", "-F", "|", "-f", verifier], { capture: true }).stdout.trim().split("\n");
    if (rows.find((row) => row.startsWith("99|OVERALL|"))?.split("|")[2] !== "PASS") throw new Error(`${verifier} failed:\n${rows.join("\n")}`);
  }
  console.log("Document evidence: XLSX method and derived-measurement verifiers OVERALL PASS with the document-statement migration applied.");
  const afterDocument = (await catalog(schemaFingerprintSql))[0].fingerprint;
  if (afterDocument === beforeDocument) throw new Error(`${documentMigration} changed nothing`);
  psqlFile(`migrations/${documentMigration}.rollback.sql`);
  if ((await catalog(schemaFingerprintSql))[0].fingerprint !== beforeDocument) throw new Error(`${documentMigration} rollback did not restore the prior schema`);
  psqlFile(`migrations/${documentMigration}.sql`);
  if ((await catalog(schemaFingerprintSql))[0].fingerprint !== afterDocument) throw new Error(`${documentMigration} re-apply changed the schema`);
  psqlFile(`migrations/${documentMigration}.rollback.sql`);
  if ((await catalog(schemaFingerprintSql))[0].fingerprint !== beforeDocument) throw new Error(`${documentMigration} second rollback did not restore the prior schema`);
  console.log(`Document evidence: ${documentMigration} rollback restored ${beforeDocument}, re-apply reproduced ${afterDocument}; left rolled back for phase A.`);

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
      KAI_DOCUMENT_EVIDENCE_DATABASE_URL: targetUrl,
      KAI_DOCUMENT_EVIDENCE_DATABASE_NAME: dbName,
      KAI_CEDAR_BRIDGE_PACKAGE: cedarPackage,
      KAI_CEDAR_BRIDGE_SURVEY_PDF: surveyPdf,
      KAI_CEDAR_BRIDGE_ORIGINAL_PDF: originalPdf,
    },
  });
  if (testResult.status !== 0) throw new Error(`document evidence acceptance failed: ${spec}`);
  console.log(`Document evidence acceptance passed: ${spec}`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Document evidence ephemeral PostgreSQL workdir removed: ${workDir}`);
}
