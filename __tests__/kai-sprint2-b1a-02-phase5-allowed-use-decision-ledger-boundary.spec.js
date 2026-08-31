import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SENSITIVITY_ALLOWED_USE_DECISION_OUTCOMES,
  SENSITIVITY_ALLOWED_USE_TERMINAL_OUTCOMES,
  SENSITIVITY_REVIEWED_SNAPSHOT_FIELDS,
  SENSITIVITY_DECISION_ALLOWED_ROLES,
  sensitivityReviewedSnapshotRequired,
  sensitivityQueueStatusForOutcome,
  sensitivityQueueReviewStatusForOutcome,
  validateSensitivityReviewedSnapshot,
  sensitivityAuthorityFromCurrentDecision,
  sensitivityPublicUseBasisEstablished,
  sensitivityRestrictedUseBasisEstablished,
} from "../Backend/kai/dictionary/sensitivityAllowedUseDecisionContract.js";
import { validateSensitivityProfileDecisionRequest } from "../Backend/kai/validators/kaiSprint2RequestSchemas.js";
import { __sensitivityAllowedUseDecisionRepositoryTestables } from "../Backend/kai/dictionary/postgresSensitivityAllowedUseDecisionRepository.js";
import { __sensitivityAllowedUseReviewRepositoryTestables } from "../Backend/kai/dictionary/postgresSensitivityAllowedUseReviewRepository.js";
import { __sensitivityAllowedUseReviewServiceContract } from "../Backend/kai/services/kaiSensitivityAllowedUseReviewService.js";
import { __reviewQueueRepositoryContract } from "../Backend/kai/dictionary/postgresReviewQueueRepository.js";

const NOW = "2026-08-31T10:00:00.000Z";
const QUEUE_ITEM = "70000000-0000-4000-8000-000000000001";

/**
 * The internal-only baseline: a complete, fully explicit reviewed snapshot in
 * which nothing at all is permitted. A reviewed decision with every permissive
 * boolean false is a legitimate, complete classification - "reviewed" means the
 * classification is finished, never that anything is allowed.
 */
function internalOnlySnapshot(overrides = {}) {
  return {
    reviewed_personal_data_status: "present",
    reviewed_minor_data_status: "absent",
    reviewed_health_housing_justice_immigration_status: "absent",
    reviewed_indigenous_governance_status: "unknown",
    reviewed_staff_notes_status: "absent",
    reviewed_story_testimonial_status: "absent",
    reviewed_small_cell_risk_status: "unknown",
    reviewed_financial_records_status: "absent",
    reviewed_consent_basis_status: "unknown",
    reviewed_allowed_use_status: "unknown",
    reviewed_llm_processing_allowed: false,
    reviewed_product_learning_allowed: false,
    reviewed_public_use_allowed: false,
    reviewed_funder_use_allowed: false,
    ...overrides,
  };
}

test("B1A-2 contract: the outcome vocabulary is exactly two frozen members, with 'reviewed' the only terminal one", () => {
  assert.deepEqual([...SENSITIVITY_ALLOWED_USE_DECISION_OUTCOMES].sort(), ["needs_more_information", "reviewed"]);
  assert.deepEqual([...SENSITIVITY_ALLOWED_USE_TERMINAL_OUTCOMES], ["reviewed"]);
  assert.ok(Object.isFrozen(SENSITIVITY_ALLOWED_USE_DECISION_OUTCOMES));
  assert.ok(Object.isFrozen(SENSITIVITY_REVIEWED_SNAPSHOT_FIELDS));
});

test("B1A-2 contract: queue projections resolve only on a terminal decision; needs_more_information leaves the review active", () => {
  assert.equal(sensitivityQueueStatusForOutcome("reviewed"), "resolved");
  assert.equal(sensitivityQueueReviewStatusForOutcome("reviewed"), "resolved");
  assert.equal(sensitivityQueueStatusForOutcome("needs_more_information"), "open");
  assert.equal(sensitivityQueueReviewStatusForOutcome("needs_more_information"), "needs_gk_review");
  assert.equal(sensitivityReviewedSnapshotRequired("reviewed"), true);
  assert.equal(sensitivityReviewedSnapshotRequired("needs_more_information"), false);
});

test("B1A-2 contract: the decider role set mirrors the existing P1-06 sensitivity_review role set exactly", () => {
  const serviceRoles = [...__sensitivityAllowedUseReviewServiceContract.RECORD_SENSITIVITY_DECISION_ALLOWED_ROLES].sort();
  assert.deepEqual([...SENSITIVITY_DECISION_ALLOWED_ROLES].sort(), ["gk_admin", "gk_operator", "gk_reviewer"]);
  assert.deepEqual(serviceRoles, ["gk_admin", "gk_operator", "gk_reviewer"]);
  // The same set the already-accepted P1-06 queue-creation contract authorizes.
  const p1_06ServiceSource = readFileSync("Backend/kai/services/kaiReviewQueueService.js", "utf8");
  assert.match(
    p1_06ServiceSource,
    /const SENSITIVITY_REVIEW_ALLOWED_ROLES = new Set\(\["gk_admin", "gk_operator", "gk_reviewer"\]\)/,
  );
  assert.equal(__reviewQueueRepositoryContract.SENSITIVITY_REVIEW_TARGET_OBJECT_TYPE, "intake_sensitivity_profile");
});

test("B1A-2 snapshot validation: a complete internal-only reviewed snapshot with every permission false is valid", () => {
  assert.deepEqual(validateSensitivityReviewedSnapshot(internalOnlySnapshot()), { ok: true, reason: null });
});

test("B1A-2 snapshot validation: 'unknown' is preserved, never coerced to a permissive value", () => {
  const snapshot = internalOnlySnapshot();
  assert.equal(snapshot.reviewed_indigenous_governance_status, "unknown");
  assert.equal(snapshot.reviewed_allowed_use_status, "unknown");
  assert.equal(validateSensitivityReviewedSnapshot(snapshot).ok, true);
  // An 'unknown' allowed-use status establishes no basis for any permission.
  assert.equal(sensitivityRestrictedUseBasisEstablished(snapshot), false);
  assert.equal(sensitivityPublicUseBasisEstablished(snapshot), false);
});

test("B1A-2 snapshot validation: an incomplete or unknown-keyed snapshot fails closed", () => {
  const { reviewed_minor_data_status: _omitted, ...incomplete } = internalOnlySnapshot();
  assert.equal(validateSensitivityReviewedSnapshot(incomplete).ok, false);
  assert.equal(validateSensitivityReviewedSnapshot({ ...internalOnlySnapshot(), extra: 1 }).ok, false);
  assert.equal(validateSensitivityReviewedSnapshot(null).reason, "reviewed_snapshot_required");
  assert.equal(
    validateSensitivityReviewedSnapshot({ ...internalOnlySnapshot(), reviewed_pii_status: "present" }).ok,
    false,
  );
});

test("B1A-2 snapshot validation: public use fails closed unless allowed-use is allowed, consent basis is present, AND indigenous/governance status is absent", () => {
  const withoutConsent = internalOnlySnapshot({
    reviewed_allowed_use_status: "allowed",
    reviewed_indigenous_governance_status: "absent",
    reviewed_public_use_allowed: true,
  });
  assert.equal(validateSensitivityReviewedSnapshot(withoutConsent).reason, "public_use_basis_not_established");

  const consentUnknownOnly = internalOnlySnapshot({
    reviewed_consent_basis_status: "unknown",
    reviewed_allowed_use_status: "allowed",
    reviewed_indigenous_governance_status: "absent",
    reviewed_public_use_allowed: true,
  });
  assert.equal(validateSensitivityReviewedSnapshot(consentUnknownOnly).reason, "public_use_basis_not_established");

  const consentAbsent = internalOnlySnapshot({
    reviewed_consent_basis_status: "absent",
    reviewed_allowed_use_status: "allowed",
    reviewed_indigenous_governance_status: "absent",
    reviewed_public_use_allowed: true,
  });
  assert.equal(validateSensitivityReviewedSnapshot(consentAbsent).reason, "public_use_basis_not_established");

  // Governance status "present" or "unknown" must reject public use even when
  // allowed-use is allowed and consent is present - governance authorization
  // is never inferred, and is never satisfied by an "unknown"/"present" value.
  const governancePresent = internalOnlySnapshot({
    reviewed_consent_basis_status: "present",
    reviewed_allowed_use_status: "allowed",
    reviewed_indigenous_governance_status: "present",
    reviewed_public_use_allowed: true,
  });
  assert.equal(validateSensitivityReviewedSnapshot(governancePresent).reason, "public_use_basis_not_established");
  assert.equal(sensitivityPublicUseBasisEstablished(governancePresent), false);

  const governanceUnknown = internalOnlySnapshot({
    reviewed_consent_basis_status: "present",
    reviewed_allowed_use_status: "allowed",
    reviewed_indigenous_governance_status: "unknown",
    reviewed_public_use_allowed: true,
  });
  assert.equal(validateSensitivityReviewedSnapshot(governanceUnknown).reason, "public_use_basis_not_established");
  assert.equal(sensitivityPublicUseBasisEstablished(governanceUnknown), false);

  const established = internalOnlySnapshot({
    reviewed_consent_basis_status: "present",
    reviewed_allowed_use_status: "allowed",
    reviewed_indigenous_governance_status: "absent",
    reviewed_public_use_allowed: true,
  });
  assert.equal(validateSensitivityReviewedSnapshot(established).ok, true);
  assert.equal(sensitivityPublicUseBasisEstablished(established), true);
});

test("B1A-2 snapshot validation: llm/product-learning/funder permission each require an explicit 'allowed' allowed-use basis", () => {
  for (const field of [
    "reviewed_llm_processing_allowed",
    "reviewed_product_learning_allowed",
    "reviewed_funder_use_allowed",
  ]) {
    const withoutBasis = internalOnlySnapshot({ [field]: true });
    assert.equal(validateSensitivityReviewedSnapshot(withoutBasis).ok, false, `${field} must fail closed`);
    const withBasis = internalOnlySnapshot({ reviewed_allowed_use_status: "allowed", [field]: true });
    assert.equal(validateSensitivityReviewedSnapshot(withBasis).ok, true, `${field} must be representable`);
  }
});

test("B1A-2 authority projection fails closed: no head, needs_more_information head, and non-boolean permissions grant nothing", () => {
  const denied = {
    review_complete: false,
    llm_processing_allowed: false,
    product_learning_allowed: false,
    public_use_allowed: false,
    funder_use_allowed: false,
  };
  assert.deepEqual({ ...sensitivityAuthorityFromCurrentDecision(null) }, denied);
  assert.deepEqual({ ...sensitivityAuthorityFromCurrentDecision(undefined) }, denied);
  assert.deepEqual(
    { ...sensitivityAuthorityFromCurrentDecision({ decision_outcome: "needs_more_information" }) },
    denied,
  );
  // A queue row is not a decision: nothing about queue state can manufacture authority.
  assert.deepEqual(
    { ...sensitivityAuthorityFromCurrentDecision({ queue_status: "resolved", review_status: "resolved" }) },
    denied,
  );
});

test("B1A-2 authority projection returns exactly and only what a terminal reviewed head stores", () => {
  const authority = sensitivityAuthorityFromCurrentDecision({
    decision_outcome: "reviewed",
    reviewed_llm_processing_allowed: false,
    reviewed_product_learning_allowed: false,
    reviewed_public_use_allowed: false,
    reviewed_funder_use_allowed: true,
  });
  assert.deepEqual({ ...authority }, {
    review_complete: true,
    llm_processing_allowed: false,
    product_learning_allowed: false,
    public_use_allowed: false,
    funder_use_allowed: true,
  });

  const internalOnly = sensitivityAuthorityFromCurrentDecision({
    decision_outcome: "reviewed",
    reviewed_llm_processing_allowed: false,
    reviewed_product_learning_allowed: false,
    reviewed_public_use_allowed: false,
    reviewed_funder_use_allowed: false,
  });
  assert.equal(internalOnly.review_complete, true);
  assert.equal(internalOnly.funder_use_allowed, false);
});

test("B1A-2 validator: unknown request fields, malformed OCC stamps, and invalid decisions are rejected", () => {
  const unknownField = validateSensitivityProfileDecisionRequest({
    expected_updated_at: NOW,
    review_queue_item_id: QUEUE_ITEM,
    decision: "needs_more_information",
    unexpected: true,
  });
  assert.equal(unknownField.ok, false);
  assert.equal(unknownField.blockers[0].blocking_reason, "unknown_field");

  const badStamp = validateSensitivityProfileDecisionRequest({
    expected_updated_at: "not-a-timestamp",
    review_queue_item_id: QUEUE_ITEM,
    decision: "needs_more_information",
  });
  assert.equal(badStamp.ok, false);
  assert.equal(badStamp.blockers[0].blocking_reason, "invalid_expected_updated_at");

  const badDecision = validateSensitivityProfileDecisionRequest({
    expected_updated_at: NOW,
    review_queue_item_id: QUEUE_ITEM,
    decision: "made_up_outcome",
  });
  assert.equal(badDecision.ok, false);
  assert.equal(badDecision.blockers[0].blocking_reason, "invalid_decision");

  const badQueueId = validateSensitivityProfileDecisionRequest({
    expected_updated_at: NOW,
    review_queue_item_id: "not-a-uuid",
    decision: "needs_more_information",
  });
  assert.equal(badQueueId.ok, false);
  assert.equal(badQueueId.blockers[0].blocking_reason, "invalid_uuid_field");
});

test("B1A-2 validator: reviewed requires a complete snapshot; needs_more_information forbids one entirely", () => {
  const missingSnapshot = validateSensitivityProfileDecisionRequest({
    expected_updated_at: NOW,
    review_queue_item_id: QUEUE_ITEM,
    decision: "reviewed",
  });
  assert.equal(missingSnapshot.ok, false);
  assert.equal(missingSnapshot.blockers[0].blocking_reason, "required_field_missing");

  const unexpectedSnapshot = validateSensitivityProfileDecisionRequest({
    expected_updated_at: NOW,
    review_queue_item_id: QUEUE_ITEM,
    decision: "needs_more_information",
    reviewed_snapshot: internalOnlySnapshot(),
  });
  assert.equal(unexpectedSnapshot.ok, false);
  assert.equal(unexpectedSnapshot.blockers[0].blocking_reason, "unexpected_reviewed_snapshot");

  const publicWithoutBasis = validateSensitivityProfileDecisionRequest({
    expected_updated_at: NOW,
    review_queue_item_id: QUEUE_ITEM,
    decision: "reviewed",
    reviewed_snapshot: internalOnlySnapshot({
      reviewed_allowed_use_status: "allowed",
      reviewed_public_use_allowed: true,
    }),
  });
  assert.equal(publicWithoutBasis.ok, false);
  assert.equal(publicWithoutBasis.blockers[0].blocking_reason, "public_use_basis_not_established");

  const accepted = validateSensitivityProfileDecisionRequest({
    expected_updated_at: NOW,
    review_queue_item_id: QUEUE_ITEM,
    decision: "reviewed",
    reviewed_snapshot: internalOnlySnapshot(),
  });
  assert.equal(accepted.ok, true);

  // Reviewer identity and organization can never be supplied by the caller.
  const spoofedActor = validateSensitivityProfileDecisionRequest({
    expected_updated_at: NOW,
    review_queue_item_id: QUEUE_ITEM,
    decision: "needs_more_information",
    decided_by: "90000000-0000-4000-8000-000000000001",
  });
  assert.equal(spoofedActor.ok, false);
  assert.equal(spoofedActor.blockers[0].blocking_reason, "unknown_field");
});

test("B1A-2 ledger repository input validation fails closed on malformed input", () => {
  const { isInsertSensitivityAllowedUseDecisionInput, snapshotValues } = __sensitivityAllowedUseDecisionRepositoryTestables;
  assert.equal(isInsertSensitivityAllowedUseDecisionInput({}), false);
  const wellFormed = {
    organizationId: "00000000-0000-4000-8000-000000000001",
    intakeSensitivityProfileId: "80000000-0000-4000-8000-000000000001",
    reviewQueueItemId: QUEUE_ITEM,
    decisionOutcome: "needs_more_information",
    reviewedSnapshot: null,
    decidedBy: "90000000-0000-4000-8000-000000000001",
    decidedByRole: "gk_reviewer",
    targetUpdatedAt: NOW,
    supersedesDecisionId: null,
  };
  assert.equal(isInsertSensitivityAllowedUseDecisionInput(wellFormed), true);
  assert.equal(isInsertSensitivityAllowedUseDecisionInput({ ...wellFormed, extra: 1 }), false);
  assert.equal(isInsertSensitivityAllowedUseDecisionInput({ ...wellFormed, decidedBy: "not-a-uuid" }), false);

  // A null snapshot binds 14 SQL NULLs: a needs_more_information row is
  // structurally incapable of carrying a permission.
  assert.deepEqual(snapshotValues(null), new Array(14).fill(null));
  assert.equal(snapshotValues({ ...internalOnlySnapshot(), reviewed_allowed_use_status: "bogus" }), null);
});

test("B1A-2 orchestration repository: replay requires matching outcome, matching OCC stamp, and the projected queue state", () => {
  const { isReplayOfSensitivityDecision } = __sensitivityAllowedUseReviewRepositoryTestables;
  const head = { decision_outcome: "reviewed", target_updated_at: new Date(NOW) };
  assert.equal(isReplayOfSensitivityDecision({
    currentHead: head, decisionOutcome: "reviewed", expectedUpdatedAt: NOW,
    existingQueueRow: { queue_status: "resolved", review_status: "resolved" }, isTerminal: true,
  }), true);
  assert.equal(isReplayOfSensitivityDecision({
    currentHead: head, decisionOutcome: "needs_more_information", expectedUpdatedAt: NOW,
    existingQueueRow: { queue_status: "resolved", review_status: "resolved" }, isTerminal: false,
  }), false);
  assert.equal(isReplayOfSensitivityDecision({
    currentHead: null, decisionOutcome: "reviewed", expectedUpdatedAt: NOW,
    existingQueueRow: { queue_status: "resolved", review_status: "resolved" }, isTerminal: true,
  }), false);
  assert.equal(isReplayOfSensitivityDecision({
    currentHead: head, decisionOutcome: "reviewed", expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
    existingQueueRow: { queue_status: "resolved", review_status: "resolved" }, isTerminal: true,
  }), false);
});

test("B1A-2 orchestration repository: a needs_more_information input carrying a snapshot is rejected before any transaction", () => {
  const { isRecordSensitivityAllowedUseDecisionInput } = __sensitivityAllowedUseReviewRepositoryTestables;
  const base = {
    organizationId: "00000000-0000-4000-8000-000000000001",
    intakeSensitivityProfileId: "80000000-0000-4000-8000-000000000001",
    reviewQueueItemId: QUEUE_ITEM,
    expectedUpdatedAt: NOW,
    decisionOutcome: "needs_more_information",
    reviewedSnapshot: null,
    actorUserId: "90000000-0000-4000-8000-000000000001",
    actorRole: "gk_reviewer",
    now: NOW,
    metadataOnlyAudit: { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } },
  };
  assert.equal(isRecordSensitivityAllowedUseDecisionInput(base), true);
  assert.equal(isRecordSensitivityAllowedUseDecisionInput({ ...base, reviewedSnapshot: internalOnlySnapshot() }), false);
  assert.equal(isRecordSensitivityAllowedUseDecisionInput({ ...base, decisionOutcome: "reviewed" }), false);
  assert.equal(isRecordSensitivityAllowedUseDecisionInput({
    ...base,
    decisionOutcome: "reviewed",
    reviewedSnapshot: internalOnlySnapshot(),
  }), true);
});

test("B1A-2 boundary: this package writes nothing to P1-05, and creates no claim/evidence/export/release authority", () => {
  const ledgerRepositorySource = readFileSync(
    "Backend/kai/dictionary/postgresSensitivityAllowedUseDecisionRepository.js",
    "utf8",
  );
  const orchestrationSource = readFileSync(
    "Backend/kai/dictionary/postgresSensitivityAllowedUseReviewRepository.js",
    "utf8",
  );
  const serviceSource = readFileSync("Backend/kai/services/kaiSensitivityAllowedUseReviewService.js", "utf8");

  for (const source of [ledgerRepositorySource, orchestrationSource]) {
    // The P1-05 profile row is only ever read (and locked), never written.
    assert.doesNotMatch(source, /UPDATE kai\.intake_sensitivity_profiles/i);
    assert.doesNotMatch(source, /INSERT INTO kai\.intake_sensitivity_profiles/i);
    assert.doesNotMatch(source, /DELETE FROM/i);
    // No claim/evidence/generated-content/export/release authority is created.
    assert.doesNotMatch(source, /kai\.(claims|claim_review_decisions|evidence_items|evidence_review_decisions)\b/);
    assert.doesNotMatch(source, /kai\.(generated_content_drafts|export_candidates|export_review|human_authority_decisions)/);
    assert.doesNotMatch(source, /export_ready|release_authority/i);
    // No new queue item is ever created by this package's write path.
    assert.doesNotMatch(source, /INSERT INTO kai\.review_queue_items/i);
  }

  // The service layer contains no SQL and imports no database pool.
  assert.doesNotMatch(serviceSource, /\bimport\s+pool\b/);
  assert.doesNotMatch(serviceSource, /\bfrom\s+["']\.\.\/db\/(?:kaiDb|pg)\.js["']/);
  assert.doesNotMatch(serviceSource, /\bSELECT\b|\bINSERT INTO\b|\bUPDATE\b|\bDELETE FROM\b/i);

  // The generic review-queue status endpoint's semantics are untouched.
  const reviewQueueServiceSource = readFileSync("Backend/kai/services/kaiReviewQueueService.js", "utf8");
  const updateReviewQueueStatusBody = reviewQueueServiceSource.match(
    /export async function updateReviewQueueStatus\([\s\S]*?\n}\n/,
  )?.[0];
  assert.ok(updateReviewQueueStatusBody);
  assert.match(updateReviewQueueStatusBody, /expectedQueueStatus !== "open" \|\| newQueueStatus !== "in_progress"/);
  assert.doesNotMatch(updateReviewQueueStatusBody, /sensitivity/i);
});

test("B1A-2 boundary: the P1-07 and P1-08 predicates are byte-for-byte unchanged", () => {
  const expectedPredicateBody = [
    "    profileRow.human_review_required === true &&",
    "    profileRow.public_use_allowed === false &&",
    "    profileRow.funder_use_allowed === false &&",
    "    profileRow.llm_processing_allowed === false &&",
    "    profileRow.product_learning_allowed === false &&",
    '    profileRow.retention_posture === "restricted_pending_review"',
  ].join("\n");

  const p1_07 = readFileSync("Backend/kai/dictionary/postgresSourceCandidateRepository.js", "utf8");
  assert.match(p1_07, /function satisfiesCreationTriggerPredicate\(profileRow\) \{\n  return \(\n/);
  assert.ok(p1_07.includes(expectedPredicateBody), "P1-07 creation-trigger predicate must be unchanged");

  const p1_08 = readFileSync("Backend/kai/dictionary/postgresSourcePromotionRepository.js", "utf8");
  assert.match(p1_08, /function satisfiesPermissionPredicate\(profileRow\) \{\n  return \(\n/);
  assert.ok(p1_08.includes(expectedPredicateBody), "P1-08 permission predicate must be unchanged");

  // ...and P1-05's own pinned CHECK constraints are still declared exactly as before.
  const p1_05Migration = readFileSync("migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql", "utf8");
  assert.match(p1_05Migration, /CHECK \(llm_processing_allowed = false\)/);
  assert.match(p1_05Migration, /CHECK \(product_learning_allowed = false\)/);
  assert.match(p1_05Migration, /CHECK \(public_use_allowed = false\)/);
  assert.match(p1_05Migration, /CHECK \(funder_use_allowed = false\)/);
  assert.match(p1_05Migration, /CHECK \(human_review_required = true\)/);
  assert.match(p1_05Migration, /CHECK \(retention_posture = 'restricted_pending_review'\)/);
});

test("B1A-2 migration: the ledger is append-only, human-only, and adds no column to kai.intake_sensitivity_profiles", () => {
  const migration = readFileSync(
    "migrations/kai_sprint2_b1a_02_phase5_allowed_use_decision_ledger.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TRIGGER intake_sensitivity_review_decisions_b1a_02_append_only\n {2}BEFORE UPDATE OR DELETE ON kai\.intake_sensitivity_review_decisions/);
  assert.match(migration, /CHECK \(created_by_type = 'human'\)/);
  assert.match(migration, /CHECK \(decision_outcome IN \('reviewed', 'needs_more_information'\)\)/);
  assert.match(migration, /CREATE UNIQUE INDEX ux_intake_sensitivity_review_decisions_b1a_02_root_per_lineage/);
  assert.match(migration, /CREATE UNIQUE INDEX ux_intake_sensitivity_review_decisions_b1a_02_single_successor/);
  // The only change to the P1-05 table is one additive unique constraint.
  const profileTableStatements = migration.match(/ALTER TABLE kai\.intake_sensitivity_profiles[\s\S]*?;/g) || [];
  assert.equal(profileTableStatements.length, 1);
  assert.match(profileTableStatements[0], /ADD CONSTRAINT intake_sensitivity_profiles_b1a_02_id_org_unique/);
  assert.doesNotMatch(profileTableStatements[0], /DROP CONSTRAINT|ADD COLUMN|ALTER COLUMN|DROP COLUMN/);
  // No claim/evidence/export/release table is created or altered.
  assert.doesNotMatch(migration, /(?:CREATE|ALTER) TABLE kai\.(?:claims|evidence_items|generated_content_drafts|export_[a-z_]+|human_authority_decisions)\b/);
});
