import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_etsip_engagements_tenant_safe_identity_prerequisite_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-etsip-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(63000 + Math.floor(Math.random() * 1000));
const user = process.env.USER || "postgres";
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

function psqlFile(path, options = {}) {
  const result = spawnSync(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: sentinelUrl, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: dbName, PGUSER: user },
  });
  console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  if (options.expectFailure) {
    if (result.status === 0) throw new Error(`${path} was expected to fail but succeeded`);
    return result;
  }
  if (result.status !== 0) throw new Error(`${path} failed`);
  return result;
}

function psqlExec(sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-t", "-A", "-c", sql], { capture: true }).stdout.trim();
}

function countTenantSafeIdentityConstraints() {
  return psqlExec(`
    SELECT count(*) FROM pg_constraint c
     WHERE c.conrelid = 'kai.engagements'::regclass
       AND c.contype = 'u'
       AND (
         SELECT array_agg(a.attname ORDER BY a.attname)
         FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       ) = ARRAY['engagement_id', 'organization_id']::name[];
  `);
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });

  // ---------------------------------------------------------------------
  // CASE A: no pre-existing tenant-safe-identity constraint (a fresh
  // synthetic environment, exactly as this repository's other
  // local-postgres runners build kai.engagements from scratch).
  // ---------------------------------------------------------------------
  console.log("=== CASE A: no pre-existing constraint ===");
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");

  console.log("-- verifier before converge (expect FAIL) --");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-verifier.sql", { expectFailure: true });

  console.log("-- converge (forward) --");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-converge.sql");

  console.log("-- verifier after converge (expect PASS) --");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-verifier.sql");

  let constraintCount = countTenantSafeIdentityConstraints();
  if (constraintCount !== "1") throw new Error(`CASE A: expected exactly 1 tenant-safe-identity constraint after converge, found ${constraintCount}`);

  console.log("-- converge re-applied (expect idempotent no-op) --");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-converge.sql");
  constraintCount = countTenantSafeIdentityConstraints();
  if (constraintCount !== "1") throw new Error(`CASE A: expected exactly 1 tenant-safe-identity constraint after re-applying converge, found ${constraintCount}`);
  console.log("CASE A converge is idempotent: exactly one qualifying constraint after two applications.");

  console.log("-- smoke seed / smoke verifier / failure checks --");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-smoke-verifier.sql");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-failure-checks.sql");

  console.log("-- rollback (this package created the constraint - must remove it) --");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-rollback.sql");
  constraintCount = countTenantSafeIdentityConstraints();
  if (constraintCount !== "0") throw new Error(`CASE A: expected 0 tenant-safe-identity constraints after rollback, found ${constraintCount}`);

  console.log("-- verifier after rollback (expect FAIL again) --");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-verifier.sql", { expectFailure: true });

  console.log("CASE A (no pre-existing constraint): converge creates it, rollback removes exactly what it created. PASS.");

  // ---------------------------------------------------------------------
  // CASE B: a compatible UNIQUE(engagement_id, organization_id) constraint
  // already exists under a DIFFERENT name before this package ever runs -
  // the real-production shape (USER_CONFIRMED already present in
  // production, under production's own name, never this package's name).
  // ---------------------------------------------------------------------
  console.log("=== CASE B: pre-existing compatible constraint under a different name ===");
  run(psql, ["-h", "127.0.0.1", "-p", port, dbName, "-c", "DROP SCHEMA kai CASCADE;"], { capture: true });
  run(psql, ["-h", "127.0.0.1", "-p", port, dbName, "-c", "DROP TABLE IF EXISTS public.organizations;"], { capture: true });
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec("ALTER TABLE kai.engagements ADD CONSTRAINT some_preexisting_production_named_constraint UNIQUE (engagement_id, organization_id);");

  console.log("-- verifier before converge (expect PASS already) --");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-verifier.sql");

  console.log("-- converge (forward, expect no-op) --");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-converge.sql");

  constraintCount = countTenantSafeIdentityConstraints();
  if (constraintCount !== "1") throw new Error(`CASE B: expected exactly 1 tenant-safe-identity constraint after converge no-op, found ${constraintCount}`);
  const stillPreexisting = psqlExec(`
    SELECT count(*) FROM pg_constraint
     WHERE conrelid = 'kai.engagements'::regclass
       AND conname = 'some_preexisting_production_named_constraint';
  `);
  if (stillPreexisting !== "1") throw new Error("CASE B: converge must not replace or rename the pre-existing constraint");
  const ownNameShouldNotExist = psqlExec(`
    SELECT count(*) FROM pg_constraint
     WHERE conrelid = 'kai.engagements'::regclass
       AND conname = 'kai_engagements_tenant_safe_identity_prerequisite_unique';
  `);
  if (ownNameShouldNotExist !== "0") throw new Error("CASE B: converge must not create its own-named constraint when a compatible one already exists");
  console.log("CASE B converge correctly no-ops: the pre-existing, differently-named constraint is untouched and no duplicate constraint was added.");

  console.log("-- rollback (this package created nothing here - must NOT drop the pre-existing constraint) --");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-rollback.sql");
  const afterRollbackStillPreexisting = psqlExec(`
    SELECT count(*) FROM pg_constraint
     WHERE conrelid = 'kai.engagements'::regclass
       AND conname = 'some_preexisting_production_named_constraint';
  `);
  if (afterRollbackStillPreexisting !== "1") throw new Error("CASE B: rollback must not drop a pre-existing constraint this package never created");

  console.log("-- verifier after rollback (expect PASS - pre-existing constraint still satisfies the prerequisite) --");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-verifier.sql");

  console.log("CASE B (pre-existing compatible constraint under a different name): converge no-ops, rollback leaves it fully intact. PASS.");

  console.log("engagements-tenant-safe-identity-prerequisite local-postgres proof passed both directions.");
} finally {
  if (started) {
    run(pgCtl, ["-D", dataDir, "-m", "fast", "stop"], { capture: true });
  }
  rmSync(workDir, { recursive: true, force: true });
}
