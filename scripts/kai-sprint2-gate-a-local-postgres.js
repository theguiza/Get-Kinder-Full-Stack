import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_gate_a_p0_upload_lifecycle_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-gate-a-p0-pg-"));
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

async function withClient(callback) {
  const client = new Client(clientConfig());
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function proveRunnerOwnedTarget() {
  await withClient(async (client) => {
    const result = await client.query(`
      SELECT current_database() AS database_name,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port,
             current_setting('listen_addresses') AS listen_addresses,
             current_setting('server_version_num')::integer AS version_num
    `);
    const row = result.rows[0];
    if (row.database_name !== dbName) throw new Error("Gate A runner refused non-synthetic database name");
    if (!isLoopbackAddress(row.server_addr)) {
      throw new Error(`Gate A runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("Gate A runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("Gate A runner refused non-loopback listen_addresses");
    if (row.version_num < 160000 || row.version_num >= 170000) throw new Error("Gate A runner requires PostgreSQL 16");
  });
}

async function runTwoSessionChecks() {
  const org = "00000000-0000-4000-8000-000000000001";
  const batch = "10000000-0000-4000-8000-000000000020";
  const replayFile = "20000000-0000-4000-8000-000000000020";
  const lockFile = "20000000-0000-4000-8000-000000000021";
  const identicalPolicyFile = "20000000-0000-4000-8000-000000000022";
  const conflictingPolicyFile = "20000000-0000-4000-8000-000000000023";
  const checksum = "c".repeat(64);
  const otherChecksum = "d".repeat(64);
  const policyChecksum = "e".repeat(64);
  const conflictChecksum = "f".repeat(64);
  const ov = "provider-object:two-session#version-1";

  await withClient(async (client) => {
    await client.query(
      `INSERT INTO kai.intake_files (
         intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes,
         verified_at, upload_state_changed_at, upload_expires_at
       )
       VALUES
         ($1,$2,$3,'two-session-replay.pdf','two-session-replay.pdf',$4,'sha256','uploaded_unconfirmed',$5,NULL,NULL,NULL,'2026-08-02T14:00:00Z','2026-08-03T14:00:00Z'),
         ($6,$2,$3,'two-session-lock.pdf','two-session-lock.pdf',$7,'sha256','uploaded_unconfirmed',$8,NULL,NULL,NULL,'2026-08-02T14:00:00Z','2026-08-03T14:00:00Z'),
         ($9,$2,$3,'two-session-policy-identical.txt','two-session-policy-identical.txt',$10,'sha256','confirmed',$11,$10,17,'2026-08-02T14:00:00Z','2026-08-02T14:00:00Z','2026-08-03T14:00:00Z'),
         ($12,$2,$3,'two-session-policy-conflict.txt','two-session-policy-conflict.txt',$13,'sha256','confirmed',$14,$13,18,'2026-08-02T14:00:00Z','2026-08-02T14:00:00Z','2026-08-03T14:00:00Z')`,
      [
        replayFile,
        batch,
        org,
        checksum,
        ov,
        lockFile,
        otherChecksum,
        "provider-object:two-session-lock#version-1",
        identicalPolicyFile,
        policyChecksum,
        "provider-object:two-session-policy#version-1",
        conflictingPolicyFile,
        conflictChecksum,
        "provider-object:two-session-conflict#version-1",
      ],
    );
  });

  await withClient(async (first) => {
    const confirm = await first.query(
      `UPDATE kai.intake_files
          SET upload_state = 'confirmed',
              verified_checksum = $4,
              verified_size_bytes = 84,
              verified_at = '2026-08-02T14:01:00Z',
              upload_state_changed_at = '2026-08-02T14:01:00Z'
        WHERE organization_id = $1
          AND intake_file_id = $2
          AND object_version_id = $3
          AND upload_state = 'uploaded_unconfirmed'
          AND checksum = $4`,
      [org, replayFile, ov, checksum],
    );
    if (confirm.rowCount !== 1) throw new Error("two-session initial confirmation did not transition exactly one row");
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
    if (replay.rowCount !== 1) throw new Error("two-session identical replay did not return exactly one row");
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
        [org, lockFile, otherChecksum],
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

  async function writePolicyDecision(client, { fileId, checksumValue, sizeBytes, status, category }) {
    const result = await client.query(
      `WITH input AS (
         SELECT $1::uuid AS organization_id,
                $2::uuid AS intake_file_id,
                $3::text AS object_version_id,
                $4::text AS verified_checksum,
                $5::bigint AS verified_size_bytes,
                $6::text AS file_policy_status,
                $7::jsonb AS sanitized_result
       ),
       updated AS (
         UPDATE kai.intake_files f
            SET file_policy_status = input.file_policy_status,
                upload_state = CASE WHEN input.file_policy_status = 'blocked' THEN 'policy_blocked' ELSE f.upload_state END,
                upload_state_changed_at = '2026-08-02T14:10:00Z'
           FROM input
          WHERE f.organization_id = input.organization_id
            AND f.intake_file_id = input.intake_file_id
            AND f.upload_state = 'confirmed'
            AND f.file_policy_status = 'pending'
            AND f.object_version_id = input.object_version_id
            AND f.verified_checksum = input.verified_checksum
            AND f.verified_size_bytes = input.verified_size_bytes
            AND NOT EXISTS (
              SELECT 1 FROM kai.upload_policy_decision_replay r
               WHERE r.organization_id = f.organization_id AND r.intake_file_id = f.intake_file_id
            )
          RETURNING f.organization_id, f.intake_file_id, f.object_version_id, f.verified_checksum, f.verified_size_bytes,
                    input.file_policy_status, input.sanitized_result
       ),
       replay_insert AS (
         INSERT INTO kai.upload_policy_decision_replay (
           organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes,
           declared_mime, extension, file_policy_status, sanitized_result, sanitized_result_canonical_sha256
         )
         SELECT organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes,
                'text/plain', '.txt', file_policy_status, sanitized_result,
                encode(digest(sanitized_result::text, 'sha256'), 'hex')
           FROM updated
         ON CONFLICT (organization_id, intake_file_id) DO NOTHING
         RETURNING organization_id, intake_file_id, file_policy_status
       ),
       audit_insert AS (
         INSERT INTO kai.upload_lifecycle_audit (
           organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
         )
         SELECT organization_id, intake_file_id, 'policy_decision_compare_and_set', 'confirmed',
                CASE WHEN file_policy_status = 'blocked' THEN 'policy_blocked' ELSE 'confirmed' END,
                'success',
                jsonb_build_object(
                  'metadata_only', true,
                  'contract', 'owner_decision_post_b_policy_transition_v1',
                  'file_policy_status', file_policy_status,
                  'policy_decision_outcome', file_policy_status,
                  'object_version_bound', true,
                  'verified_checksum_bound', true,
                  'verified_size_bytes_bound', true,
                  'declared_mime', 'text/plain',
                  'extension', '.txt',
                  'replay_contract_version', 'in_memory_policy_replay_v1',
                  'validator_key', 'VAL-KAI-POLICY-C1-001'
                ),
                '2026-08-02T14:10:00Z'
           FROM replay_insert
         RETURNING 1
       )
       SELECT (SELECT count(*) FROM replay_insert)::integer AS replay_writes,
              (SELECT count(*) FROM audit_insert)::integer AS audit_writes`,
      [
        org,
        fileId,
        fileId === identicalPolicyFile
          ? "provider-object:two-session-policy#version-1"
          : "provider-object:two-session-conflict#version-1",
        checksumValue,
        sizeBytes,
        status,
        JSON.stringify(status === "passed"
          ? { policy: "pass", category }
          : { status, category }),
      ],
    );
    return result.rows[0];
  }

  const identicalFirst = new Client(clientConfig());
  const identicalSecond = new Client(clientConfig());
  await identicalFirst.connect();
  await identicalSecond.connect();
  try {
    const outcomes = await Promise.all([
      writePolicyDecision(identicalFirst, {
        fileId: identicalPolicyFile,
        checksumValue: policyChecksum,
        sizeBytes: 17,
        status: "passed",
        category: "encoding_gate_pass",
      }),
      writePolicyDecision(identicalSecond, {
        fileId: identicalPolicyFile,
        checksumValue: policyChecksum,
        sizeBytes: 17,
        status: "passed",
        category: "encoding_gate_pass",
      }),
    ]);
    const writes = outcomes.reduce((sum, row) => sum + row.replay_writes, 0);
    const audits = outcomes.reduce((sum, row) => sum + row.audit_writes, 0);
    if (writes !== 1 || audits !== 1) {
      throw new Error(`concurrent identical policy decisions did not converge on one write: ${JSON.stringify(outcomes)}`);
    }
  } finally {
    await identicalFirst.end();
    await identicalSecond.end();
  }

  const conflictFirst = new Client(clientConfig());
  const conflictSecond = new Client(clientConfig());
  await conflictFirst.connect();
  await conflictSecond.connect();
  try {
    const outcomes = await Promise.all([
      writePolicyDecision(conflictFirst, {
        fileId: conflictingPolicyFile,
        checksumValue: conflictChecksum,
        sizeBytes: 18,
        status: "passed",
        category: "encoding_gate_pass",
      }),
      writePolicyDecision(conflictSecond, {
        fileId: conflictingPolicyFile,
        checksumValue: conflictChecksum,
        sizeBytes: 18,
        status: "failed",
        category: "assessor_failed",
      }),
    ]);
    const writes = outcomes.reduce((sum, row) => sum + row.replay_writes, 0);
    const audits = outcomes.reduce((sum, row) => sum + row.audit_writes, 0);
    const winner = await withClient((client) => client.query(
      `SELECT count(*)::integer AS replay_count,
              count(DISTINCT file_policy_status)::integer AS distinct_statuses
         FROM kai.upload_policy_decision_replay
        WHERE organization_id = $1 AND intake_file_id = $2`,
      [org, conflictingPolicyFile],
    ));
    if (writes !== 1 || audits !== 1 || winner.rows[0].replay_count !== 1 || winner.rows[0].distinct_statuses !== 1) {
      throw new Error(`concurrent conflicting policy decisions did not produce exactly one winner: ${JSON.stringify(outcomes)}`);
    }
  } finally {
    await conflictFirst.end();
    await conflictSecond.end();
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

  console.log(`Gate A ephemeral database created: ${dbName}`);
  console.log(`Gate A ephemeral PostgreSQL loopback: 127.0.0.1:${port}`);

  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");

  const catalogOutput = psqlFile("scripts/kai-sprint2-gate-a-verifier.sql");
  const failureOutput = psqlFile("scripts/kai-sprint2-gate-a-failure-checks.sql");
  const smokeOutput = psqlFile("scripts/kai-sprint2-gate-a-smoke-verifier.sql");
  assertNoFail("catalog verifier", catalogOutput);
  assertNoFail("read-only failure checks", failureOutput);
  assertNoFail("smoke verifier", smokeOutput);
  await runTwoSessionChecks();

  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.rollback.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.rollback.sql");
  console.log("Gate A ephemeral PostgreSQL verification passed.");
} finally {
  if (started) {
    spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  }
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Gate A ephemeral PostgreSQL workdir removed: ${workDir}`);
}
