import test from "node:test";
import assert from "node:assert/strict";

import { createPostgresDataDictionaryRepository } from "../Backend/kai/dictionary/postgresDataDictionaryRepository.js";
import { createPostgresIntakeSensitivityProfileRepository } from "../Backend/kai/dictionary/postgresIntakeSensitivityProfileRepository.js";
import { createProductionMetadataOnlyAudit } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";

/**
 * Proves the P1-04 and P1-05 required metadata-only audit INSERT is issued
 * through the exact same PostgreSQL transaction connection as the domain
 * mutation it audits, rather than falling through to a separate/global pool
 * connection. Mirrors the existing proven pattern in
 * `kai-sprint2-p1-03-audit-transaction-propagation.spec.js`.
 *
 * The fake transaction provider behaves like a real pg client: every query -
 * including the `audit_events` insert performed by the production
 * `insertAuditEvent` dependency - is routed through `connection.query()` and
 * logged with the identity of the connection object that issued it. Before
 * the fix, the repository's `prepareRequiredAudit` never forwarded `tx` as
 * `db`, so the audit composition received `db: undefined` and this test fails
 * (either on a thrown `undefined.query` inside the audit publish, which the
 * repository shapes into a `system_error` result, or on the connection-id
 * comparison never finding a matching audit call).
 */

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const INTAKE_FILE_ID = "00000000-0000-4000-8000-000000000002";
const FILE_PROFILE_ID = "00000000-0000-4000-8000-000000000003";
const DATA_DICTIONARY_ID = "00000000-0000-4000-8000-000000000004";
const NOW = "2026-08-04T10:00:00.000Z";

function createFakeTransactionProvider(queryHandler) {
  const calls = [];
  let connectionCounter = 0;
  return {
    calls,
    async connect() {
      connectionCounter += 1;
      const connectionId = connectionCounter;
      const connection = {
        connectionId,
        async query(sql, params) {
          const trimmed = sql.trim();
          calls.push({ connectionId, sql: trimmed.split("\n")[0].trim(), params });
          if (trimmed === "BEGIN" || trimmed === "COMMIT" || trimmed === "ROLLBACK") {
            return { rows: [], rowCount: 0 };
          }
          return queryHandler(trimmed, params);
        },
        release() {},
      };
      return connection;
    },
  };
}

function runInTransactionFor(provider) {
  return async (callback) => {
    const tx = await provider.connect();
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
  };
}

test("P1-04 draftDataDictionary: required metadata-only audit uses the SAME tx/connection as the domain mutation", async () => {
  const provider = createFakeTransactionProvider((sql) => {
    if (sql.includes("FROM kai.intake_file_profiles")) {
      return {
        rows: [
          {
            organization_id: ORG_ID,
            intake_file_id: INTAKE_FILE_ID,
            file_profile_id: FILE_PROFILE_ID,
            profile: { fields: [] },
            profile_canonical_sha256: "a".repeat(64),
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes("FROM kai.data_dictionaries") && sql.includes("FOR UPDATE")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("SELECT upload_state")) {
      return { rows: [{ upload_state: "confirmed" }], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO kai.data_dictionaries")) {
      return { rows: [{ data_dictionary_id: DATA_DICTIONARY_ID, created_at: NOW }], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO kai.audit_events")) {
      return { rows: [{ audit_event_id: "audit-1" }], rowCount: 1 };
    }
    throw new Error(`unexpected query in fake transaction provider: ${sql}`);
  });

  const repository = createPostgresDataDictionaryRepository({ runInTransaction: runInTransactionFor(provider) });

  let capturedAuditDb = null;
  const metadataOnlyAudit = createProductionMetadataOnlyAudit({
    organizationId: ORG_ID,
    intakeFileId: INTAKE_FILE_ID,
    actorContext: { actorType: "system" },
    now: NOW,
    async insertAuditEvent(metadata, db) {
      capturedAuditDb = db;
      const result = await db.query(
        "INSERT INTO kai.audit_events (organization_id, action, metadata) VALUES ($1, $2, $3)",
        [metadata.organization_id, metadata.operation, JSON.stringify(metadata)],
      );
      return { ok: true, data: result.rows[0] };
    },
  });

  const result = await repository.draftDataDictionary({
    identity: { organizationId: ORG_ID, fileProfileId: FILE_PROFILE_ID },
    now: NOW,
    metadataOnlyAudit,
  });

  assert.equal(result.ok, true, "the draft must succeed once the audit is issued on the same connection");

  const domainMutationCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.data_dictionaries"));
  const auditEventsCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.audit_events"));
  assert.ok(domainMutationCall, "the data_dictionaries insert must have been issued");
  assert.ok(auditEventsCall, "the audit_events insert must have been issued");
  assert.equal(
    auditEventsCall.connectionId,
    domainMutationCall.connectionId,
    "the domain mutation and the required audit insert must share one connection",
  );
  assert.ok(capturedAuditDb, "the audit composition must receive a db/tx context, not undefined");
});

test("P1-05 persistIntakeSensitivityProfile: required metadata-only audit uses the SAME tx/connection as the domain mutation", async () => {
  const provider = createFakeTransactionProvider((sql) => {
    if (sql.includes("FROM kai.intake_file_profiles")) {
      return {
        rows: [
          {
            organization_id: ORG_ID,
            intake_file_id: INTAKE_FILE_ID,
            file_profile_id: FILE_PROFILE_ID,
            profile_canonical_sha256: "a".repeat(64),
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes("FROM kai.data_dictionaries")) {
      return {
        rows: [
          {
            data_dictionary_id: DATA_DICTIONARY_ID,
            organization_id: ORG_ID,
            intake_file_id: INTAKE_FILE_ID,
            file_profile_id: FILE_PROFILE_ID,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes("FROM kai.intake_sensitivity_profiles") && sql.includes("FOR UPDATE")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith("SELECT upload_state")) {
      return { rows: [{ upload_state: "confirmed" }], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO kai.intake_sensitivity_profiles")) {
      return {
        rows: [
          {
            intake_sensitivity_profile_id: "00000000-0000-4000-8000-000000000005",
            organization_id: ORG_ID,
            intake_file_id: INTAKE_FILE_ID,
            file_profile_id: FILE_PROFILE_ID,
            data_dictionary_id: DATA_DICTIONARY_ID,
            profile_canonical_sha256: "a".repeat(64),
            pii_status: "unknown",
            minor_data_status: "unknown",
            health_housing_justice_immigration_status: "unknown",
            indigenous_governance_status: "unknown",
            staff_notes_status: "unknown",
            story_testimonial_status: "unknown",
            small_cell_risk_status: "unknown",
            financial_records_status: "unknown",
            consent_basis_status: "unknown",
            allowed_use_status: "unknown",
            llm_processing_allowed: false,
            product_learning_allowed: false,
            public_use_allowed: false,
            funder_use_allowed: false,
            human_review_required: true,
            retention_posture: "unknown",
            created_at: NOW,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO kai.audit_events")) {
      return { rows: [{ audit_event_id: "audit-1" }], rowCount: 1 };
    }
    throw new Error(`unexpected query in fake transaction provider: ${sql}`);
  });

  const repository = createPostgresIntakeSensitivityProfileRepository({ runInTransaction: runInTransactionFor(provider) });

  let capturedAuditDb = null;
  const metadataOnlyAudit = createProductionMetadataOnlyAudit({
    organizationId: ORG_ID,
    intakeFileId: INTAKE_FILE_ID,
    actorContext: { actorType: "system" },
    now: NOW,
    async insertAuditEvent(metadata, db) {
      capturedAuditDb = db;
      const result = await db.query(
        "INSERT INTO kai.audit_events (organization_id, action, metadata) VALUES ($1, $2, $3)",
        [metadata.organization_id, metadata.operation, JSON.stringify(metadata)],
      );
      return { ok: true, data: result.rows[0] };
    },
  });

  const result = await repository.persistIntakeSensitivityProfile({
    identity: { organizationId: ORG_ID, fileProfileId: FILE_PROFILE_ID, dataDictionaryId: DATA_DICTIONARY_ID },
    now: NOW,
    metadataOnlyAudit,
  });

  assert.equal(result.ok, true, "the persist must succeed once the audit is issued on the same connection");

  const domainMutationCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.intake_sensitivity_profiles"));
  const auditEventsCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.audit_events"));
  assert.ok(domainMutationCall, "the intake_sensitivity_profiles insert must have been issued");
  assert.ok(auditEventsCall, "the audit_events insert must have been issued");
  assert.equal(
    auditEventsCall.connectionId,
    domainMutationCall.connectionId,
    "the domain mutation and the required audit insert must share one connection",
  );
  assert.ok(capturedAuditDb, "the audit composition must receive a db/tx context, not undefined");
});
