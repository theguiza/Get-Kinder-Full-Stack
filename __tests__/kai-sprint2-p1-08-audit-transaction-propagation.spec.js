import test from "node:test";
import assert from "node:assert/strict";

import { createPostgresSourcePromotionRepository } from "../Backend/kai/dictionary/postgresSourcePromotionRepository.js";
import { createProductionMetadataOnlyAuditForSourcePromotion } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";

/**
 * P1-08 operational-audit correction proof. Mirrors the existing proven pattern
 * in `kai-sprint2-p2-01-audit-transaction-propagation.spec.js`.
 *
 * Before this fix, `prepareRequiredAudit` never forwarded the repository's own
 * transaction as `db`, so `createProductionMetadataOnlyAuditForSourcePromotion`'s
 * `insertAuditEvent` received `db: undefined` and the required-audit insert fell
 * through to a different connection (the shared pool) than the domain writes -
 * this is exactly the class of bug the P1-03/P1-04/P1-05/P2-01/P2-03/P2-04/P2-05
 * corrections already fixed for their own repositories; P1-08 was the one
 * dictionary repository still missing it.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const CANDIDATE = "90000000-0000-4000-8000-000000000001";
const SENSITIVITY = "80000000-0000-4000-8000-000000000001";
const FILE_PROFILE = "50000000-0000-4000-8000-000000000001";
const DATA_DICTIONARY = "60000000-0000-4000-8000-000000000001";
const INTAKE_FILE = "20000000-0000-4000-8000-000000000001";
const REVIEW_QUEUE_ITEM = "45000000-0000-4000-8000-000000000001";
const REVIEWED_TYPE = "organization_primary_record";
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
      return {
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

function fakeQueryHandler(sql, params) {
  if (sql.includes("FROM kai.intake_promotion_decisions") && sql.includes("FOR UPDATE")) return { rows: [] };
  if (sql.includes("FROM kai.intake_source_candidates") && sql.includes("FOR UPDATE")) {
    return {
      rows: [{
        intake_source_candidate_id: CANDIDATE,
        organization_id: ORG,
        intake_file_id: INTAKE_FILE,
        file_profile_id: FILE_PROFILE,
        data_dictionary_id: DATA_DICTIONARY,
        intake_sensitivity_profile_id: SENSITIVITY,
        profile_canonical_sha256: SHA,
        proposed_source_type: "unknown",
        candidate_status: "needs_gk_review",
        created_at: NOW,
      }],
    };
  }
  if (sql.includes("FROM kai.review_queue_items") && sql.includes("FOR UPDATE")) {
    return {
      rows: [{
        review_queue_item_id: REVIEW_QUEUE_ITEM,
        organization_id: ORG,
        queue_type: "source_candidate_review",
        target_object_type: "intake_source_candidate",
        target_object_id: CANDIDATE,
        queue_status: "open",
        review_status: null,
      }],
    };
  }
  if (sql.includes("FROM kai.intake_sensitivity_profiles")) {
    return {
      rows: [{
        organization_id: ORG,
        intake_sensitivity_profile_id: SENSITIVITY,
        intake_file_id: INTAKE_FILE,
        file_profile_id: FILE_PROFILE,
        data_dictionary_id: DATA_DICTIONARY,
        profile_canonical_sha256: SHA,
        human_review_required: true,
        public_use_allowed: false,
        funder_use_allowed: false,
        llm_processing_allowed: false,
        product_learning_allowed: false,
        retention_posture: "restricted_pending_review",
      }],
    };
  }
  if (sql.includes("FROM kai.intake_files")) return { rows: [{ upload_state: "confirmed" }] };
  if (sql.includes("FROM kai.sources") && sql.includes("FOR UPDATE")) return { rows: [] };
  if (sql.includes("FROM kai.source_versions") && sql.includes("FOR UPDATE")) return { rows: [] };
  if (sql.includes("INSERT INTO kai.sources")) {
    return { rows: [{ source_id: "s-new", organization_id: params[0], source_code: params[1], reviewed_source_type: params[2], created_at: NOW }] };
  }
  if (sql.includes("INSERT INTO kai.source_versions")) {
    return {
      rows: [{
        source_version_id: "v-new", organization_id: params[0], source_id: params[1], intake_source_candidate_id: params[2],
        intake_sensitivity_profile_id: params[3], profile_canonical_sha256: params[4], is_current: true, created_at: NOW,
      }],
    };
  }
  if (sql.includes("UPDATE kai.intake_source_candidates")) {
    return { rows: [{
      intake_source_candidate_id: CANDIDATE, organization_id: ORG, intake_file_id: INTAKE_FILE, file_profile_id: FILE_PROFILE,
      data_dictionary_id: DATA_DICTIONARY, intake_sensitivity_profile_id: SENSITIVITY, profile_canonical_sha256: SHA,
      proposed_source_type: "unknown", candidate_status: "promoted", created_at: NOW,
    }] };
  }
  if (sql.includes("UPDATE kai.review_queue_items")) {
    return { rows: [{
      review_queue_item_id: REVIEW_QUEUE_ITEM, organization_id: ORG, queue_type: "source_candidate_review",
      target_object_type: "intake_source_candidate", target_object_id: CANDIDATE, queue_status: "resolved", review_status: "resolved",
    }] };
  }
  if (sql.includes("INSERT INTO kai.intake_promotion_decisions")) {
    return { rows: [{
      intake_promotion_decision_id: "d-new", organization_id: ORG, intake_source_candidate_id: CANDIDATE,
      review_queue_item_id: REVIEW_QUEUE_ITEM, reviewed_source_type: REVIEWED_TYPE, decision_status: "promoted",
      source_id: "s-new", source_version_id: "v-new", created_at: NOW, decided_at: NOW, promoted_at: NOW,
    }] };
  }
  if (sql.startsWith("INSERT INTO kai.upload_lifecycle_audit")) return { rows: [], rowCount: 1 };
  if (sql.startsWith("INSERT INTO kai.audit_events")) return { rows: [{ audit_event_id: "audit-1" }], rowCount: 1 };
  throw new Error(`unexpected query in fake transaction provider: ${sql}`);
}

test("P1-08 createSourcePromotionDecision: required metadata-only audit uses the SAME tx/connection as the domain mutation", async () => {
  const provider = createFakeTransactionProvider(fakeQueryHandler);
  const repository = createPostgresSourcePromotionRepository({ runInTransaction: runInTransactionFor(provider) });

  let capturedAuditDb = null;
  const metadataOnlyAudit = createProductionMetadataOnlyAuditForSourcePromotion({
    organizationId: ORG,
    intakeSourceCandidateId: CANDIDATE,
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

  const result = await repository.createSourcePromotionDecision({
    identity: { organizationId: ORG, intakeSourceCandidateId: CANDIDATE },
    outcome: "promoted",
    reviewedSourceType: REVIEWED_TYPE,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.replayed, false);

  const domainMutationCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.intake_promotion_decisions"));
  const auditEventsCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.audit_events"));
  assert.ok(domainMutationCall, "the intake_promotion_decisions insert must have been issued");
  assert.ok(auditEventsCall, "the audit_events insert must have been issued");
  assert.equal(
    auditEventsCall.connectionId,
    domainMutationCall.connectionId,
    "the domain mutation and the required audit insert must share one connection",
  );
  assert.ok(capturedAuditDb, "the audit composition must receive a db/tx context, not undefined");
  assert.equal(typeof capturedAuditDb.query, "function", "the received db must be the repository's own tx, not a bare truthy stub");
});
