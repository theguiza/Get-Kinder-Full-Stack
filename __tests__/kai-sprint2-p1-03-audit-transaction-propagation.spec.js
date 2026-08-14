import test from "node:test";
import assert from "node:assert/strict";

import { createPostgresParserRunRepository } from "../Backend/kai/parsing/postgresParserRunRepository.js";
import { createProductionMetadataOnlyAudit } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";

/**
 * Proves the P1 required-audit INSERT is issued through the exact same
 * PostgreSQL transaction connection as the parser-run mutation it audits,
 * rather than falling through to a separate/global pool connection.
 *
 * Unlike a bare audit double, this fake transaction provider behaves like a
 * real pg client: every query - including the audit_events insert performed
 * by the production `insertAuditEvent` dependency - is routed through
 * `connection.query()` and logged with the identity of the connection object
 * that issued it. If the audit insert used a different connection (e.g. the
 * default global pool), its log entry would carry a different connectionId
 * than the domain-mutation queries, or `db` captured by the audit composition
 * would fail the `===` identity check against the transaction context handed
 * to the repository callback.
 */
function createFakeTransactionProvider() {
  const calls = [];
  let connectionCounter = 0;

  function firstLine(sql) {
    return sql.trim().split("\n")[0].trim();
  }

  return {
    calls,
    async connect() {
      connectionCounter += 1;
      const connectionId = connectionCounter;
      const connection = {
        connectionId,
        async query(sql, params) {
          calls.push({ connectionId, sql: firstLine(sql), params });
          const trimmed = sql.trim();

          if (trimmed === "BEGIN" || trimmed === "COMMIT" || trimmed === "ROLLBACK") {
            return { rows: [], rowCount: 0 };
          }
          if (trimmed.includes("SELECT upload_state")) {
            return { rows: [{ upload_state: "confirmed" }], rowCount: 1 };
          }
          if (trimmed.startsWith("UPDATE kai.intake_parser_runs")) {
            return { rows: [], rowCount: 1 };
          }
          if (trimmed.includes("FROM kai.intake_parser_runs r")) {
            const isRunning = trimmed.includes("SET parser_status") === false && calls.some(
              (call) => call.sql.startsWith("UPDATE kai.intake_parser_runs"),
            );
            return {
              rows: [
                {
                  parser_run_id: "20000000-0000-4000-8000-000000000001",
                  organization_id: "00000000-0000-4000-8000-000000000001",
                  intake_file_id: "00000000-0000-4000-8000-000000000002",
                  parser_name: "kai_local_profiling_kernel",
                  parser_version: "1.0.0",
                  checksum: "a".repeat(64),
                  parser_status: isRunning ? "running" : "queued",
                  retry_count: 0,
                  error_code: null,
                  error_message_safe: null,
                  output_profile_id: null,
                  started_at: "2026-08-04T10:00:00.000Z",
                  completed_at: null,
                  created_at: "2026-08-04T10:00:00.000Z",
                  profile: null,
                  profile_canonical_sha256: null,
                },
              ],
              rowCount: 1,
            };
          }
          if (trimmed.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
            return { rows: [], rowCount: 1 };
          }
          if (trimmed.startsWith("INSERT INTO kai.audit_events")) {
            return { rows: [{ audit_event_id: "audit-1" }], rowCount: 1 };
          }
          throw new Error(`unexpected query in fake transaction provider: ${trimmed}`);
        },
        release() {},
      };
      return connection;
    },
  };
}

test("claimQueuedParserRun publishes the required audit through the identical transaction connection as the parser-run mutation", async () => {
  const provider = createFakeTransactionProvider();
  let capturedTx = null;

  const repository = createPostgresParserRunRepository({
    runInTransaction: async (callback) => {
      const tx = await provider.connect();
      capturedTx = tx;
      try {
        await tx.query("BEGIN");
        const result = await callback(tx);
        await tx.query("COMMIT");
        return result;
      } catch (error) {
        await tx.query("ROLLBACK");
        throw error;
      } finally {
        tx.release();
      }
    },
  });

  let capturedAuditDb = null;
  const metadataOnlyAudit = createProductionMetadataOnlyAudit({
    organizationId: "00000000-0000-4000-8000-000000000001",
    intakeFileId: "00000000-0000-4000-8000-000000000002",
    actorContext: { actorType: "system" },
    now: "2026-08-04T10:00:00.000Z",
    async insertAuditEvent(metadata, db) {
      capturedAuditDb = db;
      const result = await db.query(
        "INSERT INTO kai.audit_events (organization_id, action, metadata) VALUES ($1, $2, $3)",
        [metadata.organization_id, metadata.operation, JSON.stringify(metadata)],
      );
      return { ok: true, data: result.rows[0] };
    },
  });

  const result = await repository.claimQueuedParserRun({
    identity: {
      organizationId: "00000000-0000-4000-8000-000000000001",
      intakeFileId: "00000000-0000-4000-8000-000000000002",
      parserName: "kai_local_profiling_kernel",
      parserVersion: "1.0.0",
      checksum: "a".repeat(64),
    },
    now: "2026-08-04T10:00:00.000Z",
    metadataOnlyAudit,
  });

  assert.equal(result.ok, true);
  assert.ok(capturedTx, "the repository must have opened a transaction connection");
  assert.equal(capturedAuditDb, capturedTx, "the audit insert must receive the exact same transaction context object");

  const auditEventsCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.audit_events"));
  assert.ok(auditEventsCall, "the audit_events insert must have been issued");
  assert.equal(
    auditEventsCall.connectionId,
    capturedTx.connectionId,
    "the audit_events insert must be issued on the same connection as the parser-run mutation",
  );

  const domainMutationCall = provider.calls.find((call) => call.sql.startsWith("UPDATE kai.intake_parser_runs"));
  assert.equal(
    domainMutationCall.connectionId,
    auditEventsCall.connectionId,
    "the domain mutation and the required audit insert must share one connection",
  );
});
