import test from "node:test";
import assert from "node:assert/strict";

import { createPostgresEvidenceLineageRepository } from "../Backend/kai/dictionary/postgresEvidenceLineageRepository.js";
import { createProductionMetadataOnlyAuditForSourceVersion } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";

/**
 * P2-01 operational-audit correction proof. Mirrors the existing proven pattern
 * in `kai-sprint2-p1-04-p1-05-audit-transaction-propagation.spec.js`.
 *
 * Before this fix, `prepareRequiredAudit` never forwarded the repository's own
 * transaction as `db`, so `createProductionMetadataOnlyAuditForSourceVersion`'s
 * `insertAuditEvent` received `db: undefined` and the required-audit insert
 * either threw or silently used a different connection than the domain writes.
 * Before this fix, the generic adapter also let the P2-01 repository payload's
 * `object_type: "evidence_item"` leak into the generic audit event's
 * `object_type`/`target_object_type`, mislabeling the object that actually
 * triggered the operation (the source_version), even though `object_id` was
 * already correctly the sourceVersionId.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const SOURCE_VERSION = "70000000-0000-4000-8000-000000000001";
const SOURCE = "71000000-0000-4000-8000-000000000001";
const CANDIDATE = "90000000-0000-4000-8000-000000000001";
const SENSITIVITY = "80000000-0000-4000-8000-000000000001";
const FILE_PROFILE = "50000000-0000-4000-8000-000000000001";
const DATA_DICTIONARY = "60000000-0000-4000-8000-000000000001";
const INTAKE_FILE = "20000000-0000-4000-8000-000000000001";
const LOCATOR = "30000000-0000-4000-8000-000000000001";
const EVIDENCE_ITEM = "40000000-0000-4000-8000-000000000001";
const REVIEW_QUEUE_ITEM = "45000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);
const NOW = "2026-08-15T10:00:00.000Z";

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

function fakeQueryHandler(sql) {
  if (sql.includes("FROM kai.source_versions")) {
    return {
      rows: [
        {
          source_version_id: SOURCE_VERSION,
          organization_id: ORG,
          source_id: SOURCE,
          intake_source_candidate_id: CANDIDATE,
          intake_sensitivity_profile_id: SENSITIVITY,
          profile_canonical_sha256: SHA,
          is_current: true,
          created_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes("FROM kai.sources")) {
    return {
      rows: [{ source_id: SOURCE, organization_id: ORG, source_code: "code", reviewed_source_type: "survey", created_at: NOW }],
      rowCount: 1,
    };
  }
  if (sql.includes("FROM kai.intake_source_candidates")) {
    return {
      rows: [
        {
          intake_source_candidate_id: CANDIDATE,
          organization_id: ORG,
          intake_file_id: INTAKE_FILE,
          file_profile_id: FILE_PROFILE,
          data_dictionary_id: DATA_DICTIONARY,
          intake_sensitivity_profile_id: SENSITIVITY,
          profile_canonical_sha256: SHA,
          candidate_status: "promoted",
          created_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes("FROM kai.intake_promotion_decisions")) {
    return {
      rows: [
        {
          organization_id: ORG,
          source_id: SOURCE,
          source_version_id: SOURCE_VERSION,
          decision_status: "promoted",
          created_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes("FROM kai.intake_sensitivity_profiles")) {
    return {
      rows: [
        {
          organization_id: ORG,
          intake_sensitivity_profile_id: SENSITIVITY,
          file_profile_id: FILE_PROFILE,
          data_dictionary_id: DATA_DICTIONARY,
          profile_canonical_sha256: SHA,
          human_review_required: true,
          public_use_allowed: false,
          funder_use_allowed: false,
          llm_processing_allowed: false,
          product_learning_allowed: false,
          retention_posture: "restricted_pending_review",
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes("FROM kai.data_dictionaries")) {
    return {
      rows: [{ data_dictionary_id: DATA_DICTIONARY, organization_id: ORG, file_profile_id: FILE_PROFILE, profile_canonical_sha256: SHA, created_at: NOW }],
      rowCount: 1,
    };
  }
  if (sql.includes("FROM kai.data_dictionary_fields")) {
    return {
      rows: [{ data_dictionary_field_id: "field-1", profile_field_key: "email", data_type: "text", sensitivity: "unknown" }],
      rowCount: 1,
    };
  }
  if (sql.startsWith("INSERT INTO kai.source_locators")) {
    return {
      rows: [
        {
          source_locator_id: LOCATOR,
          organization_id: ORG,
          source_version_id: SOURCE_VERSION,
          locator_type: "column",
          coordinates: { column_name: "email" },
          locator_fingerprint: "f".repeat(64),
          created_by_type: "system",
          created_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.startsWith("INSERT INTO kai.evidence_items")) {
    return {
      rows: [
        {
          evidence_item_id: EVIDENCE_ITEM,
          organization_id: ORG,
          source_id: SOURCE,
          source_version_id: SOURCE_VERSION,
          source_locator_id: LOCATOR,
          evidence_type: "dictionary_field_presence_fact",
          data_class: "organization_committed_metadata",
          sensitivity_level: "unknown",
          support_strength: "unassessed",
          statement: "stmt",
          statement_fingerprint: "e".repeat(64),
          evidence_review_status: null,
          internal_only: null,
          public_use_allowed: null,
          funder_use_allowed: null,
          llm_processing_allowed: null,
          product_learning_allowed: null,
          created_by: "user-1",
          created_by_type: "human",
          created_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.startsWith("INSERT INTO kai.review_queue_items")) {
    return {
      rows: [
        {
          review_queue_item_id: REVIEW_QUEUE_ITEM,
          organization_id: ORG,
          queue_type: "evidence_review",
          target_object_type: "evidence_item",
          target_object_id: EVIDENCE_ITEM,
          queue_status: "open",
          review_status: "needs_gk_review",
          summary: "New evidence item requires GK review.",
          required_action: "Review",
          queue_metadata: {},
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes("count(*)::int AS count") && sql.includes("FROM kai.evidence_items")) {
    return { rows: [{ count: 1 }], rowCount: 1 };
  }
  if (sql.includes("count(*)::int AS count") && sql.includes("FROM kai.source_locators")) {
    return { rows: [{ count: 1 }], rowCount: 1 };
  }
  if (sql.includes("count(*)::int AS count") && sql.includes("FROM kai.review_queue_items")) {
    return { rows: [{ count: 1 }], rowCount: 1 };
  }
  if (sql.startsWith("SELECT upload_state")) {
    return { rows: [{ upload_state: "confirmed" }], rowCount: 1 };
  }
  if (sql.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
    return { rows: [], rowCount: 1 };
  }
  if (sql.startsWith("INSERT INTO kai.audit_events")) {
    return { rows: [{ audit_event_id: "audit-1" }], rowCount: 1 };
  }
  throw new Error(`unexpected query in fake transaction provider: ${sql}`);
}

test("P2-01 extractEvidenceFromSourceVersion: required metadata-only audit uses the SAME tx/connection as the domain mutation (fresh write)", async () => {
  const provider = createFakeTransactionProvider(fakeQueryHandler);
  const repository = createPostgresEvidenceLineageRepository({ runInTransaction: runInTransactionFor(provider) });

  let capturedAuditDb = null;
  const metadataOnlyAudit = createProductionMetadataOnlyAuditForSourceVersion({
    organizationId: ORG,
    sourceVersionId: SOURCE_VERSION,
    actorContext: { actorType: "human", actorUserId: "user-1" },
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

  const result = await repository.extractEvidenceFromSourceVersion({
    organizationId: ORG,
    sourceVersionId: SOURCE_VERSION,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.replayed, false);

  const domainMutationCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.evidence_items"));
  const auditEventsCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.audit_events"));
  assert.ok(domainMutationCall, "the evidence_items insert must have been issued");
  assert.ok(auditEventsCall, "the audit_events insert must have been issued");
  assert.equal(
    auditEventsCall.connectionId,
    domainMutationCall.connectionId,
    "the domain mutation and the required audit insert must share one connection",
  );
  assert.ok(capturedAuditDb, "the audit composition must receive a db/tx context, not undefined");
  assert.equal(typeof capturedAuditDb.query, "function", "the received db must be the repository's own tx, not a bare truthy stub");
});

test("P2-01 generic adapter metadata: describes the source_version that triggered the operation, not the internal evidence_item payload contract", async () => {
  let capturedMetadata = null;
  const metadataOnlyAudit = createProductionMetadataOnlyAuditForSourceVersion({
    organizationId: ORG,
    sourceVersionId: SOURCE_VERSION,
    actorContext: { actorType: "human", actorUserId: "user-1" },
    now: NOW,
    async insertAuditEvent(metadata) {
      capturedMetadata = metadata;
      return { ok: true, data: {} };
    },
  });

  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: {
      attempted_operation: "evidence_lineage_extracted",
      object_type: "evidence_item",
      validator_key: "VAL-KAI-P2-01-001",
    },
    db: { query: async () => ({ rows: [] }) },
  });
  assert.equal(prepared.ok, true);
  await prepared.publish();

  assert.ok(capturedMetadata, "expected the generic adapter to publish an audit event");
  assert.equal(capturedMetadata.object_type, "source_version");
  assert.equal(capturedMetadata.target_object_type, "source_version");
  assert.equal(capturedMetadata.object_id, SOURCE_VERSION);
});

test("P2-01 repository evidence-lineage payload still declares object_type = evidence_item (unchanged internal contract)", async () => {
  const provider = createFakeTransactionProvider(fakeQueryHandler);
  const repository = createPostgresEvidenceLineageRepository({ runInTransaction: runInTransactionFor(provider) });

  let capturedPayload = null;
  const metadataOnlyAudit = {
    prepareMetadataOnlyAudit({ payload }) {
      capturedPayload = payload;
      return { ok: true, async publish() {} };
    },
  };

  const result = await repository.extractEvidenceFromSourceVersion({
    organizationId: ORG,
    sourceVersionId: SOURCE_VERSION,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(capturedPayload, "expected the repository to prepare a required audit for a fresh write");
  assert.equal(capturedPayload.object_type, "evidence_item");
});
