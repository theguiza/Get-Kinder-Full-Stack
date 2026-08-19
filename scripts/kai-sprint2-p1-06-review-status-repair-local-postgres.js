import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { assertNoFail } from "./kai-sprint2-p1-06-review-status-repair-runner-assertions.js";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p1_06_review_status_repair_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p1-06-rs-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(59000 + Math.floor(Math.random() * 1000));
const user = process.env.USER || "postgres";

const FORWARD_MIGRATION = "migrations/kai_sprint2_p1_06_review_status_column_repair.sql";
const ROLLBACK_MIGRATION = "migrations/kai_sprint2_p1_06_review_status_column_repair.rollback.sql";
const FIXTURE = "scripts/kai-sprint2-p1-06-review-status-repair-legacy-fixture.sql";
const CONTRACT_CHECK = "scripts/kai-sprint2-p1-06-review-status-column-contract-check.sql";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: dbName, PGUSER: user },
  });
  if (options.allowFailure) return result;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(path, options = {}) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], { capture: true, ...options });
}

function psqlCommand(sql, options = {}) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", sql], { capture: true, ...options });
}

function resetDatabase() {
  run(psql, ["-h", "127.0.0.1", "-p", port, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS ${dbName}`], { capture: true });
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
}

function extractLiteralResolveUpdate() {
  const source = readFileSync(join(repoRoot, "Backend/kai/dictionary/postgresSourcePromotionRepository.js"), "utf8");
  const anchor = "SOURCE_PROMOTION_QUERY_STAGE.REVIEW_QUEUE_RESOLVE,";
  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex === -1) throw new Error("could not locate REVIEW_QUEUE_RESOLVE tagged query in postgresSourcePromotionRepository.js");
  const backtickStart = source.indexOf("`", anchorIndex);
  const backtickEnd = source.indexOf("`", backtickStart + 1);
  if (backtickStart === -1 || backtickEnd === -1) throw new Error("could not extract the literal REVIEW_QUEUE_RESOLVE SQL text");
  return source.slice(backtickStart + 1, backtickEnd);
}

async function proveActualResolveUpdateSucceeds() {
  const literalSql = extractLiteralResolveUpdate();
  const client = new Client({
    host: "127.0.0.1",
    port: Number(port),
    database: dbName,
    user,
  });
  await client.connect();
  try {
    const result = await client.query(literalSql, [
      "22222222-2222-2222-2222-222222222222",
      "11111111-1111-1111-1111-111111111111",
      "resolved",
      "resolved",
      "waiting_on_client",
    ]);
    if (result.rows.length !== 1) throw new Error(`actual P1-08 resolve UPDATE returned ${result.rows.length} row(s), expected 1`);
    const row = result.rows[0];
    if (row.queue_status !== "resolved" || row.review_status !== "resolved") {
      throw new Error(`actual P1-08 resolve UPDATE row has unexpected state: ${JSON.stringify(row)}`);
    }
    console.log("Actual P1-08 review-queue resolve UPDATE (extracted verbatim from postgresSourcePromotionRepository.js) succeeded:", row);
  } finally {
    await client.end();
  }
}

async function captureRepairedStateSnapshot() {
  const client = new Client({ host: "127.0.0.1", port: Number(port), database: dbName, user });
  await client.connect();
  try {
    const typeRow = await client.query(
      `SELECT ty.typname, ty.typtype, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_expr
         FROM pg_attribute a
         JOIN pg_class r ON r.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = r.relnamespace
         JOIN pg_type ty ON ty.oid = a.atttypid
         LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
        WHERE n.nspname='kai' AND r.relname='review_queue_items' AND a.attname='review_status'`,
    );
    const checkRow = await client.query(
      `SELECT conname, convalidated, pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
         JOIN pg_class r ON r.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname='kai' AND r.relname='review_queue_items' AND c.contype = 'c'
          AND c.conkey @> (SELECT array_agg(attnum) FROM pg_attribute WHERE attrelid = r.oid AND attname = 'review_status')`,
    );
    const dataRows = await client.query(
      `SELECT review_queue_item_id, review_status FROM kai.review_queue_items ORDER BY review_queue_item_id`,
    );
    const enumLabels = await client.query(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'kai' AND t.typname = 'review_status_enum' ORDER BY e.enumsortorder`,
    );
    const indexRows = await client.query(
      `SELECT indexrelid::regclass::text AS index_name, indisvalid, indisready FROM pg_index i JOIN pg_class r ON r.oid = i.indrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname='kai' AND r.relname='review_queue_items' ORDER BY index_name`,
    );
    return {
      type: typeRow.rows[0],
      checks: checkRow.rows,
      rows: dataRows.rows,
      enumLabels: enumLabels.rows.map((r) => r.enumlabel),
      indexes: indexRows.rows,
    };
  } finally {
    await client.end();
  }
}

async function captureLegacyStateSnapshot() {
  const client = new Client({ host: "127.0.0.1", port: Number(port), database: dbName, user });
  await client.connect();
  try {
    const typeRow = await client.query(
      `SELECT ty.typname, ty.typtype, tn.nspname, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_expr
         FROM pg_attribute a
         JOIN pg_class r ON r.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = r.relnamespace
         JOIN pg_type ty ON ty.oid = a.atttypid
         JOIN pg_namespace tn ON tn.oid = ty.typnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
        WHERE n.nspname='kai' AND r.relname='review_queue_items' AND a.attname='review_status'`,
    );
    const checkCountRow = await client.query(
      `SELECT count(*) AS n
         FROM pg_constraint c
         JOIN pg_class r ON r.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname='kai' AND r.relname='review_queue_items' AND c.contype = 'c'
          AND c.conkey @> (SELECT array_agg(attnum) FROM pg_attribute WHERE attrelid = r.oid AND attname = 'review_status')`,
    );
    const dataRows = await client.query(
      `SELECT review_queue_item_id, review_status::text AS review_status FROM kai.review_queue_items ORDER BY review_queue_item_id`,
    );
    const enumLabels = await client.query(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'kai' AND t.typname = 'review_status_enum' ORDER BY e.enumsortorder`,
    );
    const indexRows = await client.query(
      `SELECT indexrelid::regclass::text AS index_name, indisvalid, indisready FROM pg_index i JOIN pg_class r ON r.oid = i.indrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname='kai' AND r.relname='review_queue_items' ORDER BY index_name`,
    );
    return {
      type: typeRow.rows[0],
      governingCheckCount: Number(checkCountRow.rows[0].n),
      rows: dataRows.rows,
      enumLabels: enumLabels.rows.map((r) => r.enumlabel),
      indexes: indexRows.rows,
    };
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
  console.log(`P1-06 review-status-repair ephemeral database created: ${dbName}`);
  console.log(`P1-06 review-status-repair ephemeral PostgreSQL loopback: 127.0.0.1:${port}`);

  // ------------------------------------------------------------------
  // FORWARD ACCEPTANCE
  // ------------------------------------------------------------------
  psqlFile(FIXTURE);
  console.log("Legacy enum-backed review_status fixture installed.");

  psqlFile(FORWARD_MIGRATION);
  console.log("Actual forward migration artifact applied:", FORWARD_MIGRATION);

  const contractOutput = psqlFile(CONTRACT_CHECK).stdout;
  console.log(contractOutput);
  assertNoFail("P1-06 review_status column contract check (post-forward)", contractOutput);

  const preservedRow = await (async () => {
    const client = new Client({ host: "127.0.0.1", port: Number(port), database: dbName, user });
    await client.connect();
    try {
      const result = await client.query(
        `SELECT review_status, pg_typeof(review_status)::text AS type_name FROM kai.review_queue_items WHERE review_queue_item_id = $1`,
        ["11111111-1111-1111-1111-111111111111"],
      );
      return result.rows[0];
    } finally {
      await client.end();
    }
  })();
  if (!preservedRow || preservedRow.review_status !== "needs_gk_review" || preservedRow.type_name !== "text") {
    throw new Error(`preexisting needs_gk_review row not preserved correctly: ${JSON.stringify(preservedRow)}`);
  }
  console.log("Preexisting needs_gk_review row preserved with type=text:", preservedRow);

  for (const value of ["proposed", "needs_gk_review", "resolved"]) {
    psqlCommand(`INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary, review_status) VALUES ('22222222-2222-2222-2222-222222222222','intake_file_review','intake_file','${value === "proposed" ? "44444444-4444-4444-4444-444444444444" : value === "needs_gk_review" ? "55555555-5555-5555-5555-555555555555" : "66666666-6666-6666-6666-666666666666"}','vocabulary probe','${value}')`);
  }
  console.log("proposed, needs_gk_review and resolved values all accepted by the migrated CHECK.");

  const invalidAttempt = psqlCommand(
    `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary, review_status) VALUES ('22222222-2222-2222-2222-222222222222','intake_file_review','intake_file','77777777-7777-7777-7777-777777777777','vocabulary probe','bogus_value')`,
    { allowFailure: true },
  );
  if (invalidAttempt.status === 0) throw new Error("an invalid review_status value was unexpectedly accepted after the forward migration");
  console.log("Arbitrary invalid review_status value correctly rejected by the migrated CHECK.");

  psqlCommand(
    `UPDATE kai.review_queue_items SET queue_status = 'resolved', review_status = 'resolved' WHERE review_queue_item_id = '88888888-8888-8888-8888-888888888888'`,
    { allowFailure: true },
  );
  psqlCommand(
    `INSERT INTO kai.review_queue_items (review_queue_item_id, organization_id, queue_type, target_object_type, target_object_id, queue_status, review_status, summary) VALUES ('88888888-8888-8888-8888-888888888888','22222222-2222-2222-2222-222222222222','client_followup','intake_file','99999999-9999-9999-9999-999999999999','waiting_on_client','needs_gk_review','queue_status=resolved probe row')`,
  );
  psqlCommand(
    `UPDATE kai.review_queue_items SET queue_status = 'resolved', review_status = 'resolved' WHERE review_queue_item_id = '88888888-8888-8888-8888-888888888888'`,
  );
  console.log("queue_status='resolved' + review_status='resolved' UPDATE succeeded.");

  await proveActualResolveUpdateSucceeds();

  const enumCheckOutput = (
    await (async () => {
      const client = new Client({ host: "127.0.0.1", port: Number(port), database: dbName, user });
      await client.connect();
      try {
        const labels = await client.query(
          `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'kai' AND t.typname = 'review_status_enum' ORDER BY e.enumsortorder`,
        );
        const priorityType = await client.query(
          `SELECT ty.typname, ty.typtype FROM pg_attribute a JOIN pg_class r ON r.oid = a.attrelid JOIN pg_namespace n ON n.oid = r.relnamespace JOIN pg_type ty ON ty.oid = a.atttypid WHERE n.nspname='kai' AND r.relname='review_queue_items' AND a.attname='priority'`,
        );
        return { labels: labels.rows.map((r) => r.enumlabel), priority: priorityType.rows[0] };
      } finally {
        await client.end();
      }
    })()
  );
  if (enumCheckOutput.labels.includes("resolved")) throw new Error("kai.review_status_enum unexpectedly gained 'resolved'");
  if (enumCheckOutput.priority.typname !== "priority_enum" || enumCheckOutput.priority.typtype !== "e") {
    throw new Error(`unrelated enum-backed column priority is no longer enum-backed: ${JSON.stringify(enumCheckOutput.priority)}`);
  }
  console.log("Shared kai.review_status_enum unchanged (no 'resolved' label); unrelated priority column remains enum-backed.", enumCheckOutput);

  const unrelatedConsumerType = await (async () => {
    const client = new Client({ host: "127.0.0.1", port: Number(port), database: dbName, user });
    await client.connect();
    try {
      const result = await client.query(
        `SELECT ty.typname, ty.typtype, tn.nspname
           FROM pg_attribute a
           JOIN pg_class r ON r.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = r.relnamespace
           JOIN pg_type ty ON ty.oid = a.atttypid
           JOIN pg_namespace tn ON tn.oid = ty.typnamespace
          WHERE n.nspname = 'kai' AND r.relname = 'unrelated_review_status_enum_consumer' AND a.attname = 'legacy_status'`,
      );
      return result.rows[0];
    } finally {
      await client.end();
    }
  })();
  if (
    !unrelatedConsumerType ||
    unrelatedConsumerType.typname !== "review_status_enum" ||
    unrelatedConsumerType.nspname !== "kai" ||
    unrelatedConsumerType.typtype !== "e"
  ) {
    throw new Error(
      `unrelated shared kai.review_status_enum consumer no longer enum-backed after the forward repair: ${JSON.stringify(unrelatedConsumerType)}`,
    );
  }
  console.log(
    "Unrelated shared kai.review_status_enum consumer (kai.unrelated_review_status_enum_consumer.legacy_status) remains enum-backed after the forward repair.",
    unrelatedConsumerType,
  );

  const indexValidityAfterForward = await (async () => {
    const client = new Client({ host: "127.0.0.1", port: Number(port), database: dbName, user });
    await client.connect();
    try {
      const result = await client.query(
        `SELECT indexrelid::regclass::text AS index_name, indisvalid, indisready FROM pg_index i JOIN pg_class r ON r.oid = i.indrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname='kai' AND r.relname='review_queue_items'`,
      );
      return result.rows;
    } finally {
      await client.end();
    }
  })();
  if (indexValidityAfterForward.some((row) => !row.indisvalid || !row.indisready)) {
    throw new Error(`an index on review_queue_items is not valid/ready after the forward migration: ${JSON.stringify(indexValidityAfterForward)}`);
  }
  console.log("All indexes on kai.review_queue_items remain valid/ready after the forward migration.", indexValidityAfterForward);

  console.log("FORWARD ACCEPTANCE: all checks passed.");

  // ------------------------------------------------------------------
  // FORWARD NO-OP - B. repaired -> forward converged no-op (same database,
  // still on the state left by FORWARD ACCEPTANCE above)
  // ------------------------------------------------------------------
  const preNoOpState = await captureRepairedStateSnapshot();
  psqlFile(FORWARD_MIGRATION);
  console.log("Actual forward migration artifact applied a second time against the already-repaired schema.");
  const postNoOpState = await captureRepairedStateSnapshot();
  if (JSON.stringify(preNoOpState) !== JSON.stringify(postNoOpState)) {
    throw new Error(
      `forward migration was not an exact converged no-op: before=${JSON.stringify(preNoOpState)} after=${JSON.stringify(postNoOpState)}`,
    );
  }
  const contractAfterNoOp = psqlFile(CONTRACT_CHECK).stdout;
  assertNoFail("P1-06 review_status column contract check (after forward no-op)", contractAfterNoOp);
  console.log("FORWARD NO-OP (repaired -> forward converged no-op): all checks passed.", postNoOpState);

  // ------------------------------------------------------------------
  // ROLLBACK ACCEPTANCE - A. lossless case (fresh fixture, no resolved rows)
  // ------------------------------------------------------------------
  resetDatabase();
  psqlFile(FIXTURE);
  psqlFile(FORWARD_MIGRATION);
  psqlFile(ROLLBACK_MIGRATION);
  console.log("Actual rollback artifact applied to a lossless (no-'resolved'-rows) repaired schema:", ROLLBACK_MIGRATION);

  const losslessState = await (async () => {
    const client = new Client({ host: "127.0.0.1", port: Number(port), database: dbName, user });
    await client.connect();
    try {
      const typeRow = await client.query(
        `SELECT ty.typname, ty.typtype, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_expr
           FROM pg_attribute a
           JOIN pg_class r ON r.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = r.relnamespace
           JOIN pg_type ty ON ty.oid = a.atttypid
           LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
          WHERE n.nspname='kai' AND r.relname='review_queue_items' AND a.attname='review_status'`,
      );
      const checkRow = await client.query(
        `SELECT count(*) AS n FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='kai' AND r.relname='review_queue_items' AND c.conname='review_queue_items_p1_06_review_status_check'`,
      );
      const dataRow = await client.query(
        `SELECT review_status::text AS review_status FROM kai.review_queue_items WHERE review_queue_item_id='11111111-1111-1111-1111-111111111111'`,
      );
      const indexRows = await client.query(
        `SELECT indexrelid::regclass::text AS index_name, indisvalid, indisready FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='kai' AND r.relname='review_queue_items'`,
      );
      return { type: typeRow.rows[0], checkCount: Number(checkRow.rows[0].n), preservedRow: dataRow.rows[0], indexes: indexRows.rows };
    } finally {
      await client.end();
    }
  })();
  if (losslessState.type.typname !== "review_status_enum" || losslessState.type.typtype !== "e") {
    throw new Error(`lossless rollback did not restore the enum type: ${JSON.stringify(losslessState.type)}`);
  }
  if (losslessState.type.default_expr !== "'needs_gk_review'::kai.review_status_enum") {
    throw new Error(`lossless rollback default is wrong: ${losslessState.type.default_expr}`);
  }
  if (!losslessState.type.attnotnull) throw new Error("lossless rollback lost NOT NULL");
  if (losslessState.checkCount !== 0) throw new Error("lossless rollback left the P1-06 text CHECK constraint in place");
  if (losslessState.preservedRow.review_status !== "needs_gk_review") throw new Error("lossless rollback altered row data");
  if (losslessState.indexes.some((row) => !row.indisvalid || !row.indisready)) {
    throw new Error(`lossless rollback left an invalid/not-ready index: ${JSON.stringify(losslessState.indexes)}`);
  }
  console.log("ROLLBACK ACCEPTANCE A (lossless): all checks passed.", losslessState);

  // ------------------------------------------------------------------
  // ROLLBACK ACCEPTANCE - B. fail-closed case (a legitimate 'resolved' row exists)
  // ------------------------------------------------------------------
  resetDatabase();
  psqlFile(FIXTURE);
  psqlFile(FORWARD_MIGRATION);
  psqlCommand(
    `UPDATE kai.review_queue_items SET queue_status='resolved', review_status='resolved' WHERE review_queue_item_id='11111111-1111-1111-1111-111111111111'`,
  );
  console.log("Legitimate resolved/resolved row created on the repaired schema.");

  const rollbackAttempt = psqlFile(ROLLBACK_MIGRATION, { allowFailure: true });
  if (rollbackAttempt.status === 0) {
    throw new Error("the actual rollback artifact unexpectedly succeeded while a legitimate 'resolved' row exists");
  }
  console.log("Actual rollback artifact correctly refused (nonzero exit) while a legitimate 'resolved' row exists.");
  console.log(rollbackAttempt.stderr);

  const postFailureState = await (async () => {
    const client = new Client({ host: "127.0.0.1", port: Number(port), database: dbName, user });
    await client.connect();
    try {
      const typeRow = await client.query(
        `SELECT ty.typname, ty.typtype, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_expr
           FROM pg_attribute a
           JOIN pg_class r ON r.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = r.relnamespace
           JOIN pg_type ty ON ty.oid = a.atttypid
           LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
          WHERE n.nspname='kai' AND r.relname='review_queue_items' AND a.attname='review_status'`,
      );
      const checkRow = await client.query(
        `SELECT convalidated FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='kai' AND r.relname='review_queue_items' AND c.conname='review_queue_items_p1_06_review_status_check'`,
      );
      const dataRow = await client.query(
        `SELECT queue_status, review_status FROM kai.review_queue_items WHERE review_queue_item_id='11111111-1111-1111-1111-111111111111'`,
      );
      const indexRows = await client.query(
        `SELECT indexrelid::regclass::text AS index_name, indisvalid, indisready FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='kai' AND r.relname='review_queue_items'`,
      );
      return { type: typeRow.rows[0], checkRow: checkRow.rows[0], row: dataRow.rows[0], indexes: indexRows.rows };
    } finally {
      await client.end();
    }
  })();
  if (postFailureState.type.typname !== "text") throw new Error("failure atomicity broke: column is not text after the refused rollback");
  if (!postFailureState.checkRow || !postFailureState.checkRow.convalidated) {
    throw new Error("failure atomicity broke: P1-06 CHECK missing/invalidated after the refused rollback");
  }
  if (postFailureState.type.default_expr !== "'needs_gk_review'::text") {
    throw new Error(`failure atomicity broke: default is wrong after the refused rollback: ${postFailureState.type.default_expr}`);
  }
  if (postFailureState.row.queue_status !== "resolved" || postFailureState.row.review_status !== "resolved") {
    throw new Error(`failure atomicity broke: row values changed after the refused rollback: ${JSON.stringify(postFailureState.row)}`);
  }
  if (postFailureState.indexes.some((row) => !row.indisvalid || !row.indisready)) {
    throw new Error(`failure atomicity broke: an index is not valid/ready after the refused rollback: ${JSON.stringify(postFailureState.indexes)}`);
  }
  const contractAfterFailedRollback = psqlFile(CONTRACT_CHECK).stdout;
  assertNoFail("P1-06 review_status column contract check (after refused rollback)", contractAfterFailedRollback);
  console.log("ROLLBACK ACCEPTANCE B (fail-closed): all checks passed - no partial rollback DDL persisted.", postFailureState);

  // ------------------------------------------------------------------
  // ROLLBACK NO-OP - D. legacy -> rollback converged no-op
  // ------------------------------------------------------------------
  resetDatabase();
  psqlFile(FIXTURE);
  console.log("Legacy enum-backed review_status fixture installed (rollback no-op case).");

  const preLegacyRollbackState = await captureLegacyStateSnapshot();
  psqlFile(ROLLBACK_MIGRATION);
  console.log("Actual rollback artifact applied directly against the exact legacy fixture (no forward migration applied first).");
  const postLegacyRollbackState = await captureLegacyStateSnapshot();
  if (JSON.stringify(preLegacyRollbackState) !== JSON.stringify(postLegacyRollbackState)) {
    throw new Error(
      `rollback artifact was not an exact converged no-op on the legacy contract: before=${JSON.stringify(preLegacyRollbackState)} after=${JSON.stringify(postLegacyRollbackState)}`,
    );
  }
  console.log("ROLLBACK NO-OP (legacy -> rollback converged no-op): all checks passed.", postLegacyRollbackState);

  // ------------------------------------------------------------------
  // F. artificially widened CHECK -> actual contract verifier must FAIL
  // the exact-vocabulary assertion, proven by running the real verifier
  // SQL file, not a JavaScript/static regex assertion.
  // ------------------------------------------------------------------
  resetDatabase();
  psqlFile(FIXTURE);
  psqlFile(FORWARD_MIGRATION);
  psqlCommand(`ALTER TABLE ONLY kai.review_queue_items DROP CONSTRAINT review_queue_items_p1_06_review_status_check`);
  psqlCommand(
    `ALTER TABLE ONLY kai.review_queue_items ADD CONSTRAINT review_queue_items_p1_06_review_status_check CHECK (review_status IN ('proposed', 'needs_gk_review', 'resolved', 'unexpected_fourth_value'))`,
  );
  console.log("Synthetic repaired-state variant installed: governing CHECK widened to a fourth value (unexpected_fourth_value).");

  const widenedContractOutput = psqlFile(CONTRACT_CHECK).stdout;
  console.log(widenedContractOutput);
  const vocabularyLine = widenedContractOutput
    .split("\n")
    .find((line) => line.includes("GOVERNING_CHECK_VOCABULARY"));
  if (!vocabularyLine) throw new Error("actual contract verifier did not emit a GOVERNING_CHECK_VOCABULARY row");
  if (!/\bFAIL\b/.test(vocabularyLine)) {
    throw new Error(`actual contract verifier did not FAIL the exact-vocabulary assertion against a widened four-value CHECK: ${vocabularyLine}`);
  }
  console.log("WIDENED-CHECK PROOF (F): actual contract verifier correctly reported FAIL for a widened four-value CHECK.", vocabularyLine);

  console.log("P1-06 review_status column repair: all synthetic PostgreSQL proofs passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P1-06 review-status-repair ephemeral PostgreSQL workdir removed: ${workDir}`);
}
