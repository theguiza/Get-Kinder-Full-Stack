import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p1_parser_run_file_profile_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p1-02-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(55000 + Math.floor(Math.random() * 1000));
const user = process.env.USER || "postgres";

function isLoopbackAddress(value) {
  return value === "127.0.0.1" || value === "127.0.0.1/32" || value === "::1" || value === "::ffff:127.0.0.1";
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
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

function assertNoFail(label, output) {
  if (/\|\s*FAIL\s*\|/.test(output) || /\sFAIL\s/.test(output)) {
    throw new Error(`${label} reported FAIL\n${output}`);
  }
}

function clientConfig() {
  return {
    host: "127.0.0.1",
    port: Number(port),
    database: dbName,
    user,
  };
}

async function proveRunnerOwnedTarget() {
  const client = new Client(clientConfig());
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
    if (row.database_name !== dbName) throw new Error("P1-02 runner refused non-synthetic database name");
    if (!isLoopbackAddress(row.server_addr)) {
      throw new Error(`P1-02 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P1-02 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P1-02 runner refused non-loopback listen_addresses");
    if (row.version_num < 160000 || row.version_num >= 170000) throw new Error("P1-02 runner requires PostgreSQL 16");
  } finally {
    await client.end();
  }
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, [
    "-D", dataDir,
    "-l", logFile,
    "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`,
    "start",
  ], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();

  console.log(`P1-02 ephemeral database created: ${dbName}`);
  console.log(`P1-02 ephemeral PostgreSQL loopback: 127.0.0.1:${port}`);

  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
  psqlFile("migrations/kai_sprint2_p1_parser_run_and_file_profile.sql");
  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-parser-run-file-profile-smoke-seed.sql");

  const catalogOutput = psqlFile("scripts/kai-sprint2-p1-parser-run-file-profile-verifier.sql");
  const failureOutput = psqlFile("scripts/kai-sprint2-p1-parser-run-file-profile-failure-checks.sql");
  const smokeOutput = psqlFile("scripts/kai-sprint2-p1-parser-run-file-profile-smoke-verifier.sql");
  assertNoFail("P1-02 catalog verifier", catalogOutput);
  assertNoFail("P1-02 read-only failure checks", failureOutput);
  assertNoFail("P1-02 smoke verifier", smokeOutput);

  psqlFile("migrations/kai_sprint2_p1_parser_run_and_file_profile.rollback.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.rollback.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.rollback.sql");
  console.log("P1-02 ephemeral PostgreSQL verification passed.");
} finally {
  if (started) {
    spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  }
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P1-02 ephemeral PostgreSQL workdir removed: ${workDir}`);
}
