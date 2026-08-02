import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const defaultClientBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : defaultClientBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-gate-a-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const dbName = "kai_gate_a";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      PGHOST: socketDir,
      PGDATABASE: dbName,
      PGUSER: process.env.USER || "postgres",
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
    host: socketDir,
    database: dbName,
    user: process.env.USER || "postgres",
  };
}

async function withClient(callback) {
  const client = new Client(clientConfig());
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function runTwoSessionChecks() {
  const org = "00000000-0000-4000-8000-000000000001";
  const batch = "10000000-0000-4000-8000-000000000001";
  const replayFile = "20000000-0000-4000-8000-000000000010";
  const lockFile = "20000000-0000-4000-8000-000000000011";
  const ov = "ov_cccccccccccccccccccccccccccccccc";
  const checksum = "c".repeat(64);

  await withClient(async (client) => {
    await client.query(
      `INSERT INTO kai.intake_files (
         intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, upload_state_changed_at, upload_expires_at
       )
       VALUES
         ($1,$2,$3,'two-session-replay.pdf','two-session-replay.pdf',$4,'sha256','uploaded_unconfirmed',$5,'2026-08-02T14:00:00Z','2026-08-03T14:00:00Z'),
         ($6,$2,$3,'two-session-lock.pdf','two-session-lock.pdf',$7,'sha256','uploaded_unconfirmed',$8,'2026-08-02T14:00:00Z','2026-08-03T14:00:00Z')`,
      [replayFile, batch, org, "2".repeat(64), ov, lockFile, "3".repeat(64), "ov_dddddddddddddddddddddddddddddddd"],
    );
  });

  await withClient(async (first) => {
    await first.query(
      `UPDATE kai.intake_files
          SET upload_state = 'confirmed',
              verified_checksum = $4,
              verified_size_bytes = 84,
              verified_at = '2026-08-02T14:01:00Z',
              upload_state_changed_at = '2026-08-02T14:01:00Z'
        WHERE organization_id = $1
          AND intake_file_id = $2
          AND object_version_id = $3
          AND upload_state = 'uploaded_unconfirmed'`,
      [org, replayFile, ov, checksum],
    );
  });

  await withClient(async (second) => {
    const replay = await second.query(
      `UPDATE kai.intake_files
          SET upload_state = 'confirmed',
              verified_checksum = $4,
              verified_size_bytes = 84,
              verified_at = '2026-08-02T14:01:00Z',
              upload_state_changed_at = '2026-08-02T14:01:00Z'
        WHERE organization_id = $1
          AND intake_file_id = $2
          AND object_version_id = $3
          AND upload_state = 'confirmed'
          AND verified_checksum = $4
          AND verified_size_bytes = 84
        RETURNING intake_file_id`,
      [org, replayFile, ov, checksum],
    );
    if (replay.rowCount !== 1) throw new Error("two-session identical replay did not return one row");

    try {
      await second.query(
        `UPDATE kai.intake_files
            SET object_version_id = 'ov_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
          WHERE organization_id = $1
            AND intake_file_id = $2`,
        [org, replayFile],
      );
      throw new Error("two-session conflicting replay unexpectedly succeeded");
    } catch (error) {
      if (!String(error.message).includes("object-version identity is immutable")) throw error;
    }
  });

  const first = new Client(clientConfig());
  const second = new Client(clientConfig());
  await first.connect();
  await second.connect();
  try {
    await first.query("BEGIN");
    await first.query(
      `UPDATE kai.intake_files
          SET upload_state_changed_at = '2026-08-02T14:00:01Z'
        WHERE organization_id = $1
          AND intake_file_id = $2`,
      [org, lockFile],
    );
    await second.query("BEGIN");
    await second.query("SET LOCAL lock_timeout = '200ms'");
    try {
      await second.query(
        `UPDATE kai.intake_files
            SET upload_state = 'confirmed',
                verified_checksum = $3,
                verified_size_bytes = 85,
                verified_at = '2026-08-02T14:02:00Z',
                upload_state_changed_at = '2026-08-02T14:02:00Z'
          WHERE organization_id = $1
            AND intake_file_id = $2`,
        [org, lockFile, "d".repeat(64)],
      );
      throw new Error("two-session locking check unexpectedly acquired the row");
    } catch (error) {
      if (error.code !== "55P03") throw error;
    } finally {
      await second.query("ROLLBACK");
      await first.query("ROLLBACK");
    }
  } finally {
    await first.end();
    await second.end();
  }
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h ''`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", socketDir, dbName], { capture: true });

  const version = run(psql, ["-d", dbName, "-Atc", "SHOW server_version"], { capture: true }).stdout.trim();
  console.log(`Gate A ephemeral PostgreSQL version: ${version}`);

  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_persistent_upload_lifecycle.sql");
  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");

  const catalogOutput = psqlFile("scripts/kai-sprint2-gate-a-verifier.sql");
  const smokeOutput = psqlFile("scripts/kai-sprint2-gate-a-smoke-verifier.sql");
  assertNoFail("catalog verifier", catalogOutput);
  assertNoFail("smoke verifier", smokeOutput);
  await runTwoSessionChecks();

  psqlFile("migrations/kai_sprint2_gate_a_persistent_upload_lifecycle.rollback.sql");
  console.log("Gate A ephemeral PostgreSQL verification passed.");
} finally {
  if (started) {
    spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  }
  rmSync(workDir, { recursive: true, force: true });
}
