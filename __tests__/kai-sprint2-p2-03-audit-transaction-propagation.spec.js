import test from "node:test";
import assert from "node:assert/strict";

import { createPostgresClaimProposalRepository } from "../Backend/kai/dictionary/postgresClaimProposalRepository.js";
import { createProductionMetadataOnlyAuditForClaimProposal } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";

/**
 * P2-03 operational-audit correction proof. Mirrors the existing proven
 * pattern in `kai-sprint2-p2-01-audit-transaction-propagation.spec.js`.
 *
 * At the start of this package's operational composition, `prepareRequiredAudit`
 * never forwarded the repository's own transaction as `db`, so
 * `createProductionMetadataOnlyAuditForClaimProposal`'s `insertAuditEvent`
 * would have received `db: undefined` and the required-audit insert would
 * either throw or silently use a different connection than the domain writes.
 * The production adapter must also never fabricate the claim identity: it
 * requires `payload.claim_id` (the authoritative persisted claim UUID) and
 * refuses to substitute the evidenceItemId it was constructed with.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const EVIDENCE_ITEM = "40000000-0000-4000-8000-000000000001";
const LOCATOR = "30000000-0000-4000-8000-000000000001";
const SOURCE = "71000000-0000-4000-8000-000000000001";
const SOURCE_VERSION = "70000000-0000-4000-8000-000000000001";
const CANDIDATE = "90000000-0000-4000-8000-000000000001";
const DECISION_REVIEW_QUEUE = "45000000-0000-4000-8000-000000000001";
const EVIDENCE_REVIEW_QUEUE = "46000000-0000-4000-8000-000000000001";
const CLAIM_ID = "a0000000-0000-4000-8000-000000000001";
const CLAIM_LINK_ID = "b0000000-0000-4000-8000-000000000001";
const CLAIM_REVIEW_QUEUE_ID = "c0000000-0000-4000-8000-000000000001";
const INTAKE_FILE = "20000000-0000-4000-8000-000000000001";
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

function fakeQueryHandler(sql, params = []) {
  if (sql.includes("FROM kai.evidence_items")) {
    return {
      rows: [
        {
          evidence_item_id: EVIDENCE_ITEM,
          organization_id: ORG,
          source_id: SOURCE,
          source_version_id: SOURCE_VERSION,
          source_locator_id: LOCATOR,
          support_strength: "unassessed",
          created_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes("FROM kai.source_locators")) {
    return {
      rows: [
        {
          source_locator_id: LOCATOR,
          organization_id: ORG,
          source_version_id: SOURCE_VERSION,
          coordinates: { column_name: "email" },
          locator_fingerprint: "a".repeat(64),
          created_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes("FROM kai.sources")) {
    return { rows: [{ source_id: SOURCE, organization_id: ORG, created_at: NOW }], rowCount: 1 };
  }
  if (sql.includes("FROM kai.source_versions")) {
    return {
      rows: [
        {
          source_version_id: SOURCE_VERSION,
          organization_id: ORG,
          source_id: SOURCE,
          intake_source_candidate_id: CANDIDATE,
          is_current: true,
          created_at: NOW,
        },
      ],
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
          review_queue_item_id: DECISION_REVIEW_QUEUE,
          created_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes("queue_type = 'evidence_review'")) {
    return {
      rows: [
        {
          review_queue_item_id: EVIDENCE_REVIEW_QUEUE,
          organization_id: ORG,
          queue_type: "evidence_review",
          target_object_type: "evidence_item",
          target_object_id: EVIDENCE_ITEM,
          review_status: "needs_gk_review",
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.startsWith("INSERT INTO kai.claims")) {
    const [organizationId, evidenceItemId, claimType, claimStatus, claimReviewStatus, claimStrength, statement, statementFingerprint, createdBy, createdByType] = params;
    return {
      rows: [
        {
          claim_id: CLAIM_ID,
          organization_id: organizationId,
          evidence_item_id: evidenceItemId,
          claim_type: claimType,
          claim_status: claimStatus,
          claim_review_status: claimReviewStatus,
          claim_strength: claimStrength,
          statement,
          statement_fingerprint: statementFingerprint,
          internal_only: true,
          public_use_allowed: false,
          funder_use_allowed: false,
          llm_processing_allowed: false,
          product_learning_allowed: false,
          export_ready: false,
          created_by: createdBy,
          created_by_type: createdByType,
          created_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.startsWith("INSERT INTO kai.claim_evidence_links")) {
    const [organizationId, claimId, evidenceItemId, createdByType] = params;
    return {
      rows: [
        {
          claim_evidence_link_id: CLAIM_LINK_ID,
          organization_id: organizationId,
          claim_id: claimId,
          evidence_item_id: evidenceItemId,
          created_by_type: createdByType,
          created_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.startsWith("INSERT INTO kai.review_queue_items")) {
    const [organizationId, queueType, targetObjectType, targetObjectId, queueStatus, reviewStatus, summary, requiredAction] = params;
    return {
      rows: [
        {
          review_queue_item_id: CLAIM_REVIEW_QUEUE_ID,
          organization_id: organizationId,
          queue_type: queueType,
          target_object_type: targetObjectType,
          target_object_id: targetObjectId,
          queue_status: queueStatus,
          review_status: reviewStatus,
          summary,
          required_action: requiredAction,
          queue_metadata: {},
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      rowCount: 1,
    };
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

test("P2-03 proposeClaim: required metadata-only audit uses the SAME tx/connection as the domain mutation (fresh write)", async () => {
  const provider = createFakeTransactionProvider(fakeQueryHandler);
  const repository = createPostgresClaimProposalRepository({ runInTransaction: runInTransactionFor(provider) });

  let capturedAuditDb = null;
  const metadataOnlyAudit = createProductionMetadataOnlyAuditForClaimProposal({
    organizationId: ORG,
    evidenceItemId: EVIDENCE_ITEM,
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

  const result = await repository.proposeClaim({
    organizationId: ORG,
    evidenceItemId: EVIDENCE_ITEM,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.replayed, false);

  const domainMutationCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.claims"));
  const auditEventsCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.audit_events"));
  assert.ok(domainMutationCall, "the claims insert must have been issued");
  assert.ok(auditEventsCall, "the audit_events insert must have been issued");
  assert.equal(
    auditEventsCall.connectionId,
    domainMutationCall.connectionId,
    "the domain mutation and the required audit insert must share one connection",
  );
  assert.ok(capturedAuditDb, "the audit composition must receive a db/tx context, not undefined");
  assert.equal(typeof capturedAuditDb.query, "function", "the received db must be the repository's own tx, not a bare truthy stub");
});

test("P2-03 production adapter: requires payload.claim_id, refuses to substitute evidenceItemId, and does not require claimId at construction", async () => {
  let capturedMetadata = null;
  const metadataOnlyAudit = createProductionMetadataOnlyAuditForClaimProposal({
    organizationId: ORG,
    evidenceItemId: EVIDENCE_ITEM,
    actorContext: { actorType: "human", actorUserId: "user-1" },
    now: NOW,
    async insertAuditEvent(metadata) {
      capturedMetadata = metadata;
      return { ok: true, data: {} };
    },
  });

  const missingClaimId = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: { attempted_operation: "claim_proposed", object_type: "claim" },
    db: { query: async () => ({ rows: [] }) },
  });
  assert.equal(missingClaimId.ok, false, "a payload with no claim_id must be refused, not fall back to evidenceItemId");

  const invalidClaimId = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: { attempted_operation: "claim_proposed", object_type: "claim", claim_id: "not-a-uuid" },
    db: { query: async () => ({ rows: [] }) },
  });
  assert.equal(invalidClaimId.ok, false, "a malformed claim_id must be refused");

  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: {
      attempted_operation: "claim_proposed",
      object_type: "claim",
      validator_key: "VAL-KAI-P2-03-001",
      claim_id: CLAIM_ID,
    },
    db: { query: async () => ({ rows: [] }) },
  });
  assert.equal(prepared.ok, true);
  await prepared.publish();

  assert.ok(capturedMetadata, "expected the production adapter to publish an audit event");
  assert.equal(capturedMetadata.object_type, "claim");
  assert.equal(capturedMetadata.target_object_type, "claim");
  assert.equal(capturedMetadata.object_id, CLAIM_ID);
  assert.notEqual(capturedMetadata.object_id, EVIDENCE_ITEM);
});

test("P2-03 production adapter factory does not accept or require a claimId at construction time", () => {
  assert.doesNotThrow(() => createProductionMetadataOnlyAuditForClaimProposal({
    organizationId: ORG,
    evidenceItemId: EVIDENCE_ITEM,
    actorContext: { actorType: "human", actorUserId: "user-1" },
    now: NOW,
  }));
});

test("P2-03 repository claim-proposal payload still declares object_type = claim (unchanged internal contract)", async () => {
  const provider = createFakeTransactionProvider(fakeQueryHandler);
  const repository = createPostgresClaimProposalRepository({ runInTransaction: runInTransactionFor(provider) });

  let capturedPayload = null;
  let capturedDb = null;
  const metadataOnlyAudit = {
    prepareMetadataOnlyAudit({ payload, db }) {
      capturedPayload = payload;
      capturedDb = db;
      return { ok: true, async publish() {} };
    },
  };

  const result = await repository.proposeClaim({
    organizationId: ORG,
    evidenceItemId: EVIDENCE_ITEM,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(capturedPayload, "expected the repository to prepare a required audit for a fresh write");
  assert.equal(capturedPayload.object_type, "claim");
  assert.equal(capturedPayload.claim_id, CLAIM_ID);
  assert.ok(capturedDb, "prepareMetadataOnlyAudit must receive the repository's own tx as db");
  assert.equal(typeof capturedDb.query, "function");
});
