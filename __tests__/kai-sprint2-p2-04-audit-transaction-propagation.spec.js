import test from "node:test";
import assert from "node:assert/strict";

import { createPostgresClaimGapFollowupRepository } from "../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js";
import { createProductionMetadataOnlyAuditForClaimGapFollowup } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";

/**
 * P2-04 operational-audit correction proof. Mirrors the existing proven
 * pattern in `kai-sprint2-p2-03-audit-transaction-propagation.spec.js`.
 *
 * At the start of this package's operational composition, `prepareRequiredAudit`
 * never forwarded the repository's own transaction as `db`, so
 * `createProductionMetadataOnlyAuditForClaimGapFollowup`'s `insertAuditEvent`
 * would have received `db: undefined` and the required-audit insert would
 * either throw or silently use a different connection than the domain writes.
 * The production adapter must also never fabricate the claim identity: it
 * requires `payload.claim_id` (the authoritative claimId this package was
 * asked to generate gaps/follow-ups for) and refuses a mismatched claim_id.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const CLAIM = "a0000000-0000-4000-8000-000000000001";
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
const GAP_ID = "d1000000-0000-4000-8000-000000000001";
const FOLLOWUP_ID = "d2000000-0000-4000-8000-000000000001";
const QUEUE_ID = "d3000000-0000-4000-8000-000000000001";
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
  if (sql.includes("FROM kai.claims")) {
    return { rows: [{ claim_id: CLAIM, organization_id: ORG, evidence_item_id: EVIDENCE_ITEM, created_at: NOW }], rowCount: 1 };
  }
  if (sql.includes("FROM kai.claim_evidence_links")) {
    return {
      rows: [{ claim_evidence_link_id: CLAIM_LINK, organization_id: ORG, claim_id: CLAIM, evidence_item_id: EVIDENCE_ITEM, created_at: NOW }],
      rowCount: 1,
    };
  }
  if (sql.includes("FROM kai.evidence_items e")) {
    return { rows: [], rowCount: 0 };
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
  if (sql.includes("FROM kai.data_dictionary_fields")) {
    return { rows: [], rowCount: 0 };
  }
  if (sql.includes("FROM kai.data_quality_findings")) {
    return { rows: [], rowCount: 0 };
  }
  if (sql.includes("FROM kai.gap_log_items")) {
    return { rows: [], rowCount: 0 };
  }
  if (sql.includes("FROM kai.client_followup_items")) {
    return { rows: [], rowCount: 0 };
  }
  if (sql.includes("queue_type = 'client_followup'") && sql.startsWith("SELECT")) {
    return { rows: [], rowCount: 0 };
  }
  if (sql.startsWith("INSERT INTO kai.gap_log_items")) {
    return {
      rows: [
        {
          gap_log_item_id: GAP_ID,
          organization_id: ORG,
          claim_id: CLAIM,
          evidence_item_id: EVIDENCE_ITEM,
          source_version_id: SOURCE_VERSION,
          dimension_key: "definition_clarity",
          assessment_status: "unresolved",
          validator_key: "VAL-KAI-P2-02-003",
          safe_summary: "Claim gap requires review for dimension: definition_clarity.",
          open_finding_count: 0,
          field_count: 0,
          undefined_field_count: 0,
          uncovered_field_count: 0,
          created_by_type: "system",
          created_at: NOW,
        },
      ],
      rowCount: 1,
    };
  }
  if (sql.startsWith("INSERT INTO kai.client_followup_items")) {
    return {
      rows: [
        {
          client_followup_item_id: FOLLOWUP_ID,
          organization_id: ORG,
          claim_id: CLAIM,
          gap_log_item_id: GAP_ID,
          dimension_key: "definition_clarity",
          question_text: "Confirm the business meaning of the unresolved field or measure.",
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
          review_queue_item_id: QUEUE_ID,
          organization_id: ORG,
          queue_type: "client_followup",
          target_object_type: "client_followup_item",
          target_object_id: FOLLOWUP_ID,
          priority: "normal",
          queue_status: "waiting_on_client",
          review_status: "proposed",
          assigned_to: null,
          due_at: null,
          summary: "Client clarification is required for an unresolved claim gap.",
          required_action: "Confirm the business meaning of the unresolved field or measure.",
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

function computeDimensionsForTesting() {
  const resolvedClear = { validator_key: "VAL-KAI-P2-02-000", evidence: { assessment_status: "resolved_clear" } };
  return {
    missingness: resolvedClear,
    duplicates: resolvedClear,
    definition_clarity: {
      validator_key: "VAL-KAI-P2-02-003",
      evidence: {
        assessment_status: "unresolved",
        open_finding_count: 0,
        field_count: 0,
        undefined_field_count: 0,
        uncovered_field_count: 0,
      },
    },
    denominator_clarity: resolvedClear,
    time_period_clarity: resolvedClear,
    entity_level_clarity: resolvedClear,
    small_cell_risk: resolvedClear,
    conflicting_source_indicators: resolvedClear,
    requirement_alignment: resolvedClear,
    coverage_gaps: resolvedClear,
  };
}

test("P2-04 generateClaimGapsAndFollowups: required metadata-only audit uses the SAME tx/connection as the domain mutation (fresh write)", async () => {
  const provider = createFakeTransactionProvider(fakeQueryHandler);
  const repository = createPostgresClaimGapFollowupRepository({
    runInTransaction: runInTransactionFor(provider),
    computeDimensions: computeDimensionsForTesting,
  });

  let capturedAuditDb = null;
  const metadataOnlyAudit = createProductionMetadataOnlyAuditForClaimGapFollowup({
    organizationId: ORG,
    claimId: CLAIM,
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

  const result = await repository.generateClaimGapsAndFollowups({
    organizationId: ORG,
    claimId: CLAIM,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.replayed, false);

  const domainMutationCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.gap_log_items"));
  const auditEventsCall = provider.calls.find((call) => call.sql.startsWith("INSERT INTO kai.audit_events"));
  assert.ok(domainMutationCall, "the gap_log_items insert must have been issued");
  assert.ok(auditEventsCall, "the audit_events insert must have been issued");
  assert.equal(
    auditEventsCall.connectionId,
    domainMutationCall.connectionId,
    "the domain mutation and the required audit insert must share one connection",
  );
  assert.ok(capturedAuditDb, "the audit composition must receive a db/tx context, not undefined");
  assert.equal(typeof capturedAuditDb.query, "function", "the received db must be the repository's own tx, not a bare truthy stub");
});

test("P2-04 production adapter: requires payload.claim_id matching the constructed claimId, and does not require claimId at construction beyond binding", async () => {
  let capturedMetadata = null;
  const metadataOnlyAudit = createProductionMetadataOnlyAuditForClaimGapFollowup({
    organizationId: ORG,
    claimId: CLAIM,
    actorContext: { actorType: "human", actorUserId: "user-1" },
    now: NOW,
    async insertAuditEvent(metadata) {
      capturedMetadata = metadata;
      return { ok: true, data: {} };
    },
  });

  const missingClaimId = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: { attempted_operation: "claim_gap_and_followup_generated", object_type: "claim" },
    db: { query: async () => ({ rows: [] }) },
  });
  assert.equal(missingClaimId.ok, false, "a payload with no claim_id must be refused");

  const mismatchedClaimId = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: { attempted_operation: "claim_gap_and_followup_generated", object_type: "claim", claim_id: "ffffffff-0000-4000-8000-000000000001" },
    db: { query: async () => ({ rows: [] }) },
  });
  assert.equal(mismatchedClaimId.ok, false, "a claim_id that does not match the constructed route claimId must be refused");

  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: {
      attempted_operation: "claim_gap_and_followup_generated",
      object_type: "claim",
      validator_key: "VAL-KAI-P2-04-001",
      claim_id: CLAIM,
    },
    db: { query: async () => ({ rows: [] }) },
  });
  assert.equal(prepared.ok, true);
  await prepared.publish();

  assert.ok(capturedMetadata, "expected the production adapter to publish an audit event");
  assert.equal(capturedMetadata.object_type, "claim");
  assert.equal(capturedMetadata.target_object_type, "claim");
  assert.equal(capturedMetadata.object_id, CLAIM);
});

test("P2-04 repository claim-gap-followup payload still declares object_type = claim (unchanged internal contract)", async () => {
  const provider = createFakeTransactionProvider(fakeQueryHandler);
  const repository = createPostgresClaimGapFollowupRepository({
    runInTransaction: runInTransactionFor(provider),
    computeDimensions: computeDimensionsForTesting,
  });

  let capturedPayload = null;
  let capturedDb = null;
  const metadataOnlyAudit = {
    prepareMetadataOnlyAudit({ payload, db }) {
      capturedPayload = payload;
      capturedDb = db;
      return { ok: true, async publish() {} };
    },
  };

  const result = await repository.generateClaimGapsAndFollowups({
    organizationId: ORG,
    claimId: CLAIM,
    actorUserId: "user-1",
    now: NOW,
    metadataOnlyAudit,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(capturedPayload, "expected the repository to prepare a required audit for a fresh write");
  assert.equal(capturedPayload.object_type, "claim");
  assert.equal(capturedPayload.claim_id, CLAIM);
  assert.ok(capturedDb, "prepareMetadataOnlyAudit must receive the repository's own tx as db");
  assert.equal(typeof capturedDb.query, "function");
});
