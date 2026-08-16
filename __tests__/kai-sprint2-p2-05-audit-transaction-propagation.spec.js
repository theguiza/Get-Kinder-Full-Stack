import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createPostgresConflictReviewCandidateRepository } from "../Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js";
import { createProductionMetadataOnlyAuditForConflictReviewCandidate } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";

/**
 * P2-05 operational-audit correction proof. Mirrors the existing proven
 * pattern in `kai-sprint2-p2-04-audit-transaction-propagation.spec.js`.
 *
 * At the start of this package's operational composition, `prepareRequiredAudit`
 * never forwarded the repository's own transaction as `db`, so
 * `createProductionMetadataOnlyAuditForConflictReviewCandidate`'s
 * `insertAuditEvent` would have received `db: undefined` and the required-audit
 * insert would either throw or silently use a different connection than the
 * domain writes. The production adapter must also never fabricate the
 * conflict-group identity: it requires `payload.conflict_group_id` (the
 * authoritative, already-persisted/reread identity the repository's own
 * required-audit payload already carries) and refuses preparation when that
 * field is absent or malformed - it never derives one from
 * firstClaimId/secondClaimId.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const LOWER_CLAIM = "a0000000-0000-4000-8000-000000000001";
const HIGHER_CLAIM = "a0000000-0000-4000-8000-000000000002";
const CLAIM_LINK = "b0000000-0000-4000-8000-000000000001";
const EVIDENCE_ITEM = "c0000000-0000-4000-8000-000000000001";
const LOCATOR = "d0000000-0000-4000-8000-000000000001";
const SOURCE = "71000000-0000-4000-8000-000000000001";
const SOURCE_VERSION = "70000000-0000-4000-8000-000000000001";
const CANDIDATE = "90000000-0000-4000-8000-000000000001";
const SENSITIVITY_PROFILE = "b1000000-0000-4000-8000-000000000001";
const FILE_PROFILE = "e0000000-0000-4000-8000-000000000001";
const DICTIONARY = "f0000000-0000-4000-8000-000000000001";
const EVIDENCE_REVIEW_QUEUE = "46000000-0000-4000-8000-000000000001";
const DECISION_REVIEW_QUEUE = "45000000-0000-4000-8000-000000000001";
const INTAKE_FILE = "20000000-0000-4000-8000-000000000001";
const CONFLICT_GROUP_ID = randomUUID();
const CONFLICT_QUEUE_ID = "d3000000-0000-4000-8000-000000000001";
const NOW = "2026-08-15T10:00:00.000Z";

function gapIdFor(claimId) {
  return claimId === LOWER_CLAIM ? "d1000000-0000-4000-8000-000000000001" : "d1000000-0000-4000-8000-000000000002";
}

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
  if (sql.includes("FROM kai.claims")) {
    const claimId = params[1];
    return {
      rows: [
        {
          claim_id: claimId,
          organization_id: ORG,
          evidence_item_id: EVIDENCE_ITEM,
          claim_status: "proposed",
          claim_review_status: "needs_gk_review",
          internal_only: true,
          public_use_allowed: false,
          funder_use_allowed: false,
          llm_processing_allowed: false,
          product_learning_allowed: false,
          export_ready: false,
          created_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes("FROM kai.claim_evidence_links")) {
    const claimId = params[1];
    return {
      rows: [{ claim_evidence_link_id: CLAIM_LINK, organization_id: ORG, claim_id: claimId, evidence_item_id: EVIDENCE_ITEM, created_at: NOW }],
      rowCount: 1,
    };
  }
  if (sql.includes("FROM kai.evidence_items")) {
    return {
      rows: [
        {
          evidence_item_id: EVIDENCE_ITEM,
          organization_id: ORG,
          source_id: SOURCE,
          source_version_id: SOURCE_VERSION,
          source_locator_id: LOCATOR,
          support_strength: "supported",
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
          intake_sensitivity_profile_id: SENSITIVITY_PROFILE,
          profile_canonical_sha256: "c".repeat(64),
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
          intake_sensitivity_profile_id: SENSITIVITY_PROFILE,
          file_profile_id: FILE_PROFILE,
          data_dictionary_id: DICTIONARY,
          profile_canonical_sha256: "c".repeat(64),
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
          review_status: "resolved",
          created_at: NOW,
          updated_at: NOW,
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
          intake_sensitivity_profile_id: SENSITIVITY_PROFILE,
          intake_file_id: INTAKE_FILE,
          file_profile_id: FILE_PROFILE,
          data_dictionary_id: DICTIONARY,
          human_review_required: true,
          public_use_allowed: false,
          funder_use_allowed: false,
          llm_processing_allowed: false,
          product_learning_allowed: false,
          retention_posture: "restricted_pending_review",
          allowed_use_status: "allowed",
          profile_canonical_sha256: "c".repeat(64),
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes("FROM kai.data_dictionaries")) {
    return {
      rows: [{
        organization_id: ORG,
        data_dictionary_id: DICTIONARY,
        file_profile_id: FILE_PROFILE,
        profile_canonical_sha256: "c".repeat(64),
        created_at: NOW,
      }],
      rowCount: 1,
    };
  }
  if (sql.includes("dimension_key = 'conflicting_source_indicators'")) {
    const claimId = params[1];
    return {
      rows: [
        {
          gap_log_item_id: gapIdFor(claimId),
          organization_id: ORG,
          claim_id: claimId,
          evidence_item_id: EVIDENCE_ITEM,
          source_version_id: SOURCE_VERSION,
          dimension_key: "conflicting_source_indicators",
          assessment_status: "unresolved",
          validator_key: "VAL-KAI-P2-02-conflicting_source_indicators",
          safe_summary: "Claim gap requires review for dimension: conflicting_source_indicators.",
          created_by_type: "system",
          created_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes("queue_type = 'claim_review'")) {
    const claimId = params[1];
    return {
      rows: [
        {
          review_queue_item_id: `c${claimId.slice(1)}`,
          organization_id: ORG,
          queue_type: "claim_review",
          target_object_type: "claim",
          target_object_id: claimId,
          priority: "normal",
          queue_status: "open",
          review_status: "needs_gk_review",
          assigned_to: null,
          due_at: null,
          summary: "summary",
          required_action: "required_action",
          queue_metadata: {},
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.includes("FROM kai.conflict_groups")) {
    return { rows: [], rowCount: 0 };
  }
  if (sql.includes("queue_type = 'conflict_resolution'") && sql.startsWith("SELECT")) {
    return { rows: [], rowCount: 0 };
  }
  if (sql.startsWith("INSERT INTO kai.conflict_groups")) {
    return {
      rows: [
        {
          conflict_group_id: CONFLICT_GROUP_ID,
          organization_id: ORG,
          lower_claim_id: LOWER_CLAIM,
          higher_claim_id: HIGHER_CLAIM,
          lower_claim_conflict_gap_id: gapIdFor(LOWER_CLAIM),
          higher_claim_conflict_gap_id: gapIdFor(HIGHER_CLAIM),
          basis_code: "human_selected_unresolved_comparison",
          safe_summary: "Potential claim conflict requires GK review.",
          created_by_type: "system",
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
          review_queue_item_id: CONFLICT_QUEUE_ID,
          organization_id: ORG,
          queue_type: "conflict_resolution",
          target_object_type: "conflict_group",
          target_object_id: CONFLICT_GROUP_ID,
          queue_status: "open",
          review_status: "needs_gk_review",
          priority: "normal",
          summary: "Potential claim conflict requires GK review.",
          required_action:
            "Compare both claims, their evidence lineage, definitions, reporting periods, entity levels, denominators, and support limitations. Record whether a conflict exists. Do not approve or promote either claim.",
          assigned_to: null,
          due_at: null,
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

test("P2-05 createConflictReviewCandidate: required metadata-only audit uses the SAME tx/connection as the domain mutation (fresh write)", async () => {
  const provider = createFakeTransactionProvider(fakeQueryHandler);
  const repository = createPostgresConflictReviewCandidateRepository({ runInTransaction: runInTransactionFor(provider) });

  let capturedAuditDb = null;
  const metadataOnlyAudit = createProductionMetadataOnlyAuditForConflictReviewCandidate({
    organizationId: ORG,
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

  const result = await repository.createConflictReviewCandidate({
    organizationId: ORG,
    firstClaimId: LOWER_CLAIM,
    secondClaimId: HIGHER_CLAIM,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.replayed, false);

  const domainMutationCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.conflict_groups"));
  const auditEventsCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.audit_events"));
  assert.ok(domainMutationCall, "the conflict_groups insert must have been issued");
  assert.ok(auditEventsCall, "the audit_events insert must have been issued");
  assert.equal(
    auditEventsCall.connectionId,
    domainMutationCall.connectionId,
    "the domain mutation and the required audit insert must share one connection",
  );
  assert.ok(capturedAuditDb, "the audit composition must receive a db/tx context, not undefined");
  assert.equal(typeof capturedAuditDb.query, "function", "the received db must be the repository's own tx, not a bare truthy stub");
});

test("P2-05 production adapter: requires payload.conflict_group_id, never fabricates one from claim ids", async () => {
  let capturedMetadata = null;
  const metadataOnlyAudit = createProductionMetadataOnlyAuditForConflictReviewCandidate({
    organizationId: ORG,
    actorContext: { actorType: "human", actorUserId: "user-1" },
    now: NOW,
    async insertAuditEvent(metadata) {
      capturedMetadata = metadata;
      return { ok: true, data: {} };
    },
  });

  const missingGroupId = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: { attempted_operation: "conflict_review_candidate_created", object_type: "conflict_group" },
    db: { query: async () => ({ rows: [] }) },
  });
  assert.equal(missingGroupId.ok, false, "a payload with no conflict_group_id must be refused");

  const invalidGroupId = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: { attempted_operation: "conflict_review_candidate_created", object_type: "conflict_group", conflict_group_id: "not-a-uuid" },
    db: { query: async () => ({ rows: [] }) },
  });
  assert.equal(invalidGroupId.ok, false, "a malformed conflict_group_id must be refused");

  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: {
      attempted_operation: "conflict_review_candidate_created",
      object_type: "conflict_group",
      validator_key: "VAL-KAI-P2-05-001",
      conflict_group_id: CONFLICT_GROUP_ID,
    },
    db: { query: async () => ({ rows: [] }) },
  });
  assert.equal(prepared.ok, true);
  await prepared.publish();

  assert.ok(capturedMetadata, "expected the production adapter to publish an audit event");
  assert.equal(capturedMetadata.object_type, "conflict_group");
  assert.equal(capturedMetadata.target_object_type, "conflict_group");
  assert.equal(capturedMetadata.object_id, CONFLICT_GROUP_ID);
  assert.notEqual(capturedMetadata.object_id, LOWER_CLAIM);
  assert.notEqual(capturedMetadata.object_id, HIGHER_CLAIM);
});

test("P2-05 repository already supplies conflict_group_id in its own required-audit payload (unchanged internal contract)", async () => {
  const provider = createFakeTransactionProvider(fakeQueryHandler);
  const repository = createPostgresConflictReviewCandidateRepository({ runInTransaction: runInTransactionFor(provider) });

  let capturedPayload = null;
  let capturedDb = null;
  const metadataOnlyAudit = {
    prepareMetadataOnlyAudit({ payload, db }) {
      capturedPayload = payload;
      capturedDb = db;
      return { ok: true, async publish() {} };
    },
  };

  const result = await repository.createConflictReviewCandidate({
    organizationId: ORG,
    firstClaimId: LOWER_CLAIM,
    secondClaimId: HIGHER_CLAIM,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(capturedPayload, "expected the repository to prepare a required audit for a fresh write");
  assert.equal(capturedPayload.object_type, "conflict_group");
  assert.equal(capturedPayload.conflict_group_id, CONFLICT_GROUP_ID);
  assert.ok(capturedDb, "prepareMetadataOnlyAudit must receive the repository's own tx as db");
  assert.equal(typeof capturedDb.query, "function");
});
