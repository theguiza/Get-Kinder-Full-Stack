import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  validateClaimHasLoadBearingEvidence,
  validateUnsupportedClaimPromotion,
  validateClaimRequirementCoverage,
} from "../Backend/kai/validators/kaiClaimProposalValidators.js";
import { proposeClaim } from "../Backend/kai/services/kaiClaimProposalService.js";
import {
  createPostgresClaimProposalRepository,
  __claimProposalRepositoryContract,
  __claimProposalRepositoryTestables,
} from "../Backend/kai/dictionary/postgresClaimProposalRepository.js";

const SERVICE_PATH = "Backend/kai/services/kaiClaimProposalService.js";
const REPOSITORY_PATH = "Backend/kai/dictionary/postgresClaimProposalRepository.js";

const serviceSource = readFileSync(new URL(`../${SERVICE_PATH}`, import.meta.url), "utf8");
const repositorySource = readFileSync(new URL(`../${REPOSITORY_PATH}`, import.meta.url), "utf8");

const ORG = "00000000-0000-4000-8000-000000000001";
const EVIDENCE_ITEM = "a0000000-0000-4000-8000-000000000001";
const LOCATOR = "a1000000-0000-4000-8000-000000000001";
const SOURCE = "71000000-0000-4000-8000-000000000001";
const SOURCE_VERSION = "70000000-0000-4000-8000-000000000001";
const CANDIDATE = "90000000-0000-4000-8000-000000000001";
const NOW = "2026-08-06T10:00:00.000Z";

function validRows(overrides = {}) {
  return {
    evidenceItemRow: {
      evidence_item_id: EVIDENCE_ITEM,
      organization_id: ORG,
      source_locator_id: LOCATOR,
      source_id: SOURCE,
      source_version_id: SOURCE_VERSION,
      support_strength: "unassessed",
      ...overrides.evidenceItemRow,
    },
    locatorRow: {
      source_locator_id: LOCATOR,
      organization_id: ORG,
      source_version_id: SOURCE_VERSION,
      coordinates: { column_name: "email" },
      locator_fingerprint: "a".repeat(64),
      ...overrides.locatorRow,
    },
    sourceRow: {
      source_id: SOURCE,
      organization_id: ORG,
      ...overrides.sourceRow,
    },
    sourceVersionRow: {
      source_version_id: SOURCE_VERSION,
      organization_id: ORG,
      source_id: SOURCE,
      intake_source_candidate_id: CANDIDATE,
      is_current: true,
      ...overrides.sourceVersionRow,
    },
    candidateRow: {
      intake_source_candidate_id: CANDIDATE,
      organization_id: ORG,
      intake_file_id: "20000000-0000-4000-8000-000000000001",
      candidate_status: "promoted",
      ...overrides.candidateRow,
    },
    decisionRow: {
      organization_id: ORG,
      source_id: SOURCE,
      source_version_id: SOURCE_VERSION,
      decision_status: "promoted",
      ...overrides.decisionRow,
    },
    evidenceReviewQueueItemRow: {
      organization_id: ORG,
      queue_type: "evidence_review",
      target_object_type: "evidence_item",
      target_object_id: EVIDENCE_ITEM,
      review_status: "needs_gk_review",
      ...overrides.evidenceReviewQueueItemRow,
    },
  };
}

test("validateClaimHasLoadBearingEvidence: passes with a warning when support_strength is unassessed or the evidence review is unresolved", () => {
  const result = validateClaimHasLoadBearingEvidence(validRows());
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].severity, "warning");
});

test("validateClaimHasLoadBearingEvidence: passes with zero warnings when support_strength is assessed and the review is resolved", () => {
  const result = validateClaimHasLoadBearingEvidence(
    validRows({
      evidenceItemRow: { support_strength: "supported" },
      evidenceReviewQueueItemRow: { review_status: "resolved" },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 0);
});

test("validateClaimHasLoadBearingEvidence: any missing row returns not_found", () => {
  for (const key of [
    "evidenceItemRow", "locatorRow", "sourceRow", "sourceVersionRow", "candidateRow", "decisionRow", "evidenceReviewQueueItemRow",
  ]) {
    const rows = validRows();
    rows[key] = null;
    const result = validateClaimHasLoadBearingEvidence(rows);
    assert.equal(result.ok, false, key);
    assert.equal(result.code, "not_found", key);
  }
  assert.deepEqual(validateClaimHasLoadBearingEvidence(undefined), { ok: false, code: "not_found" });
});

test("validateClaimHasLoadBearingEvidence: cross-row organization_id mismatch returns conflict_current_state_changed", () => {
  const result = validateClaimHasLoadBearingEvidence(validRows({ locatorRow: { organization_id: "99999999-0000-4000-8000-000000000099" } }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "conflict_current_state_changed");
});

test("validateClaimHasLoadBearingEvidence: evidence item's own lineage-binding columns must match the rows read for it", () => {
  const scenarios = [
    validRows({ evidenceItemRow: { source_locator_id: "99999999-0000-4000-8000-000000000098" } }),
    validRows({ evidenceItemRow: { source_id: "99999999-0000-4000-8000-000000000097" } }),
    validRows({ evidenceItemRow: { source_version_id: "99999999-0000-4000-8000-000000000096" } }),
  ];
  for (const rows of scenarios) {
    const result = validateClaimHasLoadBearingEvidence(rows);
    assert.equal(result.ok, false);
    assert.equal(result.code, "conflict_current_state_changed");
  }
});

test("validateClaimHasLoadBearingEvidence: locator/source_version/source cross-binding mismatch returns conflict_current_state_changed", () => {
  const scenarios = [
    validRows({ locatorRow: { source_version_id: "99999999-0000-4000-8000-000000000095" } }),
    validRows({ sourceVersionRow: { source_id: "99999999-0000-4000-8000-000000000094" } }),
  ];
  for (const rows of scenarios) {
    const result = validateClaimHasLoadBearingEvidence(rows);
    assert.equal(result.ok, false);
    assert.equal(result.code, "conflict_current_state_changed");
  }
});

test("validateClaimHasLoadBearingEvidence: a non-promoted candidate returns validation_blocker", () => {
  for (const candidateStatus of ["needs_gk_review", "rejected"]) {
    const result = validateClaimHasLoadBearingEvidence(validRows({ candidateRow: { candidate_status: candidateStatus } }));
    assert.equal(result.ok, false, candidateStatus);
    assert.equal(result.code, "validation_blocker", candidateStatus);
  }
});

test("validateClaimHasLoadBearingEvidence: a non-promoted decision returns validation_blocker", () => {
  const result = validateClaimHasLoadBearingEvidence(validRows({ decisionRow: { decision_status: "rejected" } }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "validation_blocker");
});

test("validateClaimHasLoadBearingEvidence: a decision bound to a different source or source_version returns conflict_current_state_changed", () => {
  const wrongSource = validateClaimHasLoadBearingEvidence(validRows({ decisionRow: { source_id: "99999999-0000-4000-8000-000000000093" } }));
  assert.equal(wrongSource.ok, false);
  assert.equal(wrongSource.code, "conflict_current_state_changed");
});

test("validateClaimHasLoadBearingEvidence: source_version bound to a different candidate returns conflict_current_state_changed", () => {
  const result = validateClaimHasLoadBearingEvidence(validRows({ sourceVersionRow: { intake_source_candidate_id: "99999999-0000-4000-8000-000000000092" } }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "conflict_current_state_changed");
});

test("validateClaimHasLoadBearingEvidence: a non-current source_version fails closed with conflict_current_state_changed, regardless of every other row remaining promoted/referencing it", () => {
  for (const isCurrent of [false, undefined, null]) {
    const result = validateClaimHasLoadBearingEvidence(validRows({ sourceVersionRow: { is_current: isCurrent } }));
    assert.equal(result.ok, false, String(isCurrent));
    assert.equal(result.code, "conflict_current_state_changed", String(isCurrent));
  }
});

test("validateClaimHasLoadBearingEvidence: is_current === true preserves the existing warning and no-warning paths", () => {
  const withWarning = validateClaimHasLoadBearingEvidence(validRows({ sourceVersionRow: { is_current: true } }));
  assert.equal(withWarning.ok, true);
  assert.equal(withWarning.warnings.length, 1);

  const withoutWarning = validateClaimHasLoadBearingEvidence(
    validRows({
      sourceVersionRow: { is_current: true },
      evidenceItemRow: { support_strength: "supported" },
      evidenceReviewQueueItemRow: { review_status: "resolved" },
    }),
  );
  assert.equal(withoutWarning.ok, true);
  assert.equal(withoutWarning.warnings.length, 0);
});

test("validateClaimHasLoadBearingEvidence: an evidence_review pair with mismatched target identity returns conflict_current_state_changed", () => {
  const scenarios = [
    validRows({ evidenceReviewQueueItemRow: { queue_type: "sensitivity_review" } }),
    validRows({ evidenceReviewQueueItemRow: { target_object_type: "claim" } }),
    validRows({ evidenceReviewQueueItemRow: { target_object_id: "99999999-0000-4000-8000-000000000091" } }),
  ];
  for (const rows of scenarios) {
    const result = validateClaimHasLoadBearingEvidence(rows);
    assert.equal(result.ok, false);
    assert.equal(result.code, "conflict_current_state_changed");
  }
});

test("validateUnsupportedClaimPromotion: passes only for the exact fixed allowed write-plan shape", () => {
  const allowedPlan = {
    claimStatus: "proposed",
    claimReviewStatus: "needs_gk_review",
    claimStrength: "unassessed",
    internalOnly: true,
    publicUseAllowed: false,
    funderUseAllowed: false,
    llmProcessingAllowed: false,
    productLearningAllowed: false,
    exportReady: false,
  };
  assert.deepEqual(validateUnsupportedClaimPromotion(allowedPlan), { ok: true, warnings: [] });
});

test("validateUnsupportedClaimPromotion: rejects any deviation from the fixed allowed shape as validation_blocker", () => {
  const allowedPlan = {
    claimStatus: "proposed",
    claimReviewStatus: "needs_gk_review",
    claimStrength: "unassessed",
    internalOnly: true,
    publicUseAllowed: false,
    funderUseAllowed: false,
    llmProcessingAllowed: false,
    productLearningAllowed: false,
    exportReady: false,
  };
  for (const key of Object.keys(allowedPlan)) {
    const plan = { ...allowedPlan, [key]: key.endsWith("Allowed") || key === "internalOnly" || key === "exportReady" ? !allowedPlan[key] : "some_other_value" };
    const result = validateUnsupportedClaimPromotion(plan);
    assert.equal(result.ok, false, key);
    assert.equal(result.code, "validation_blocker", key);
  }
  assert.deepEqual(validateUnsupportedClaimPromotion(undefined), { ok: false, code: "validation_blocker" });
});

test("validateClaimRequirementCoverage: always returns ok:true with exactly one unresolved warning, and takes no input", () => {
  const result = validateClaimRequirementCoverage();
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].evidence.requirement_coverage_status, "unresolved");
  assert.equal(validateClaimRequirementCoverage.length, 0, "validateClaimRequirementCoverage must take no parameters");
});

test("P2-03 service: KAI_SPRINT2_ENABLED disabled (or absent) returns feature_disabled with zero repository calls; no package-specific flag exists", async () => {
  const throwingRepository = {
    async proposeClaim() {
      throw new Error("repository should never be called when KAI_SPRINT2_ENABLED is disabled");
    },
  };
  for (const env of [{}, { KAI_SPRINT2_ENABLED: "false" }, { KAI_SPRINT2_ENABLED: "0" }, { KAI_CLAIM_PROPOSAL_ENABLED: "true" }]) {
    const result = await proposeClaim(
      { organizationId: ORG, evidenceItemId: EVIDENCE_ITEM, actorContext: humanActor(), now: NOW },
      { env, claimProposalRepository: throwingRepository },
    );
    assert.equal(result.ok, false, JSON.stringify(env));
    assert.equal(result.error.code, "feature_disabled", JSON.stringify(env));
  }
});

test("P2-03 service: KAI_SPRINT2_ENABLED alone (no other flag) enables the seam", async () => {
  const probeRepository = {
    async proposeClaim() {
      return { ok: true, data: { replayed: false, warnings: [] }, error: null };
    },
  };
  const result = await proposeClaim(
    { organizationId: ORG, evidenceItemId: EVIDENCE_ITEM, actorContext: humanActor(), now: NOW },
    { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: probeRepository, metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) } },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

function humanActor(overrides = {}) {
  return {
    actorType: "human",
    actorUserId: "user-1",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
    ...overrides,
  };
}

const sprint2Enabled = { KAI_SPRINT2_ENABLED: "true" };

test("P2-03 service: rejects an unknown input key without calling the repository", async () => {
  const throwingRepository = { async proposeClaim() { throw new Error("must not be called"); } };
  const result = await proposeClaim(
    { organizationId: ORG, evidenceItemId: EVIDENCE_ITEM, actorContext: humanActor(), now: NOW, extraKey: "nope" },
    { env: sprint2Enabled, claimProposalRepository: throwingRepository },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("P2-03 service: rejects a missing required key without calling the repository", async () => {
  const throwingRepository = { async proposeClaim() { throw new Error("must not be called"); } };
  const invalidInputs = [
    null,
    {},
    { organizationId: ORG, evidenceItemId: EVIDENCE_ITEM, actorContext: humanActor() },
    { organizationId: ORG, evidenceItemId: EVIDENCE_ITEM, now: NOW },
    { evidenceItemId: EVIDENCE_ITEM, actorContext: humanActor(), now: NOW },
    { organizationId: ORG, actorContext: humanActor(), now: NOW },
    { organizationId: "", evidenceItemId: EVIDENCE_ITEM, actorContext: humanActor(), now: NOW },
    { organizationId: ORG, evidenceItemId: EVIDENCE_ITEM, actorContext: humanActor(), now: "not-a-normalized-timestamp" },
  ];
  for (const input of invalidInputs) {
    const result = await proposeClaim(input, { env: sprint2Enabled, claimProposalRepository: throwingRepository });
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error.code, "validation_blocker", JSON.stringify(input));
  }
});

test("P2-03 service (AUTH-KAI-003): rejects every non-human actor type outright, with zero repository calls", async () => {
  const throwingRepository = { async proposeClaim() { throw new Error("must not be called"); } };
  for (const actorType of ["ai", "system", "import", "code", "generic_service"]) {
    const result = await proposeClaim(
      { organizationId: ORG, evidenceItemId: EVIDENCE_ITEM, actorContext: humanActor({ actorType }), now: NOW },
      { env: sprint2Enabled, claimProposalRepository: throwingRepository },
    );
    assert.equal(result.ok, false, actorType);
    assert.equal(result.error.code, "authorization_denied", actorType);
  }
});

test("P2-03 service: a role without active tenant membership is rejected", async () => {
  const throwingRepository = { async proposeClaim() { throw new Error("must not be called"); } };
  const result = await proposeClaim(
    { organizationId: ORG, evidenceItemId: EVIDENCE_ITEM, actorContext: humanActor({ organizationMemberships: [] }), now: NOW },
    { env: sprint2Enabled, claimProposalRepository: throwingRepository },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_boundary_violation");
});

test("P2-03 service: forwards only organizationId/evidenceItemId/actorUserId/now/metadataOnlyAudit to the repository", async () => {
  const calls = [];
  const probeRepository = {
    async proposeClaim(input) {
      calls.push(input);
      return { ok: true, data: { replayed: false, warnings: [] }, error: null };
    },
  };
  const metadataOnlyAudit = { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) };
  const result = await proposeClaim(
    { organizationId: ORG, evidenceItemId: EVIDENCE_ITEM, actorContext: humanActor(), now: NOW },
    { env: sprint2Enabled, claimProposalRepository: probeRepository, metadataOnlyAudit },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["actorUserId", "evidenceItemId", "metadataOnlyAudit", "now", "organizationId"]);
  assert.equal(calls[0].organizationId, ORG);
  assert.equal(calls[0].evidenceItemId, EVIDENCE_ITEM);
  assert.equal(calls[0].actorUserId, "user-1");
  assert.equal(calls[0].now, NOW);
});

test("P2-03 service: proposeClaim itself contains no SQL and does not import a database pool directly", () => {
  const body = serviceSource.match(/export async function proposeClaim\([\s\S]*/)?.[0];
  assert.ok(body, "expected to find the proposeClaim function body");
  assert.doesNotMatch(body, /\bimport\s+pool\b/);
  assert.doesNotMatch(body, /\bSELECT\b|\bINSERT INTO\b|\bUPDATE\b|\bDELETE FROM\b/i);
});

test("P2-03 repository: claims/claim_evidence_links/review_queue_items inserts all use ON CONFLICT ... DO NOTHING RETURNING", () => {
  assert.match(
    repositorySource,
    /INSERT INTO kai\.claims[\s\S]*?ON CONFLICT \(organization_id, evidence_item_id, claim_type\)[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
  assert.match(
    repositorySource,
    /INSERT INTO kai\.claim_evidence_links[\s\S]*?ON CONFLICT \(organization_id, claim_id, evidence_item_id\)[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
  assert.match(
    repositorySource,
    /INSERT INTO kai\.review_queue_items[\s\S]*?ON CONFLICT \(organization_id, queue_type, target_object_type, target_object_id\)[\s\S]*?WHERE queue_type = 'claim_review'[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
});

test("P2-03 repository resolves concurrency via ON CONFLICT ... DO NOTHING RETURNING plus authoritative re-reads, not a raised 23505 catch or an in-process lock", () => {
  assert.doesNotMatch(repositorySource, /\bcatch\s*\(\s*insertError\s*\)/);
  assert.doesNotMatch(repositorySource, /"23505"/);
  assert.doesNotMatch(repositorySource, /\b(?:inFlight|pendingLocks?|mutex|semaphore|advisory_lock|pg_advisory|savepoint)\b/i);
});

test("P2-03 repository gates the link/queue-item writes strictly on THIS call's own isFreshlyCreated result, never on a missing link/queue item alone", () => {
  assert.match(repositorySource, /if \(isFreshlyCreated\) \{/);
  assert.match(repositorySource, /throw new ConcurrentStateChangedError\("claim_evidence_link"\)/);
  assert.match(repositorySource, /throw new ConcurrentStateChangedError\("claim_review_queue_item"\)/);
});

test("P2-03 repository never fabricates raw content, sample values, or storage pointers, and never includes the claim statement in audit metadata", () => {
  assert.doesNotMatch(repositorySource, /raw_content|sample_values|storage_uri|signed_url/i);
  const auditMetadataBuilder = repositorySource.match(/function buildClaimProposalAuditMetadata\([\s\S]*?\n\}/)?.[0];
  assert.ok(auditMetadataBuilder);
  assert.doesNotMatch(auditMetadataBuilder, /\bstatement\b/);
});

test("P2-03 audit contract discloses its validator key and operation as a P2-03 implementation decision", () => {
  assert.equal(__claimProposalRepositoryContract.CLAIM_PROPOSAL_VALIDATOR_KEY, "VAL-KAI-P2-03-001");
  assert.equal(__claimProposalRepositoryContract.CLAIM_PROPOSAL_AUDIT_OPERATION, "claim_proposed");
  assert.equal(__claimProposalRepositoryContract.CLAIM_TYPE_FINDING, "finding");
  assert.equal(__claimProposalRepositoryContract.CLAIM_REVIEW_QUEUE_TYPE, "claim_review");
});

test("P2-03 composeClaimStatement is deterministic, derives only from column name and locator fingerprint, and never copies evidence statement text", () => {
  const { composeClaimStatement } = __claimProposalRepositoryTestables;
  const first = composeClaimStatement({ columnName: "email", locatorFingerprint: "a".repeat(64) });
  const second = composeClaimStatement({ columnName: "email", locatorFingerprint: "a".repeat(64) });
  assert.equal(first, second);
  assert.match(first, /^The promoted source contains the committed data-dictionary field "email" identified by locator a{64}\.$/);
  assert.notEqual(first, composeClaimStatement({ columnName: "phone", locatorFingerprint: "a".repeat(64) }));
});

test("P2-03 computeClaimStatementFingerprint is deterministic and depends on organizationId/evidenceItemId/claimType/statement", () => {
  const { computeClaimStatementFingerprint } = __claimProposalRepositoryTestables;
  const inputs = { organizationId: ORG, evidenceItemId: EVIDENCE_ITEM, claimType: "finding", statement: "A statement." };
  const first = computeClaimStatementFingerprint(inputs);
  const second = computeClaimStatementFingerprint({ ...inputs });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, computeClaimStatementFingerprint({ ...inputs, statement: "different." }));
});

test("P2-03 repository never statically imports Backend/kai/db/kaiDb.js at module top level - only a deferred dynamic import", () => {
  const topLevelImports = repositorySource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/kaiDb\.js/.test(line)));
  assert.match(repositorySource, /await import\("\.\.\/db\/kaiDb\.js"\)/);
});

test("P2-03 repository rejects an input shape outside its own allowlist without opening a transaction", async () => {
  const repository = createPostgresClaimProposalRepository({
    runInTransaction: () => {
      throw new Error("transaction should never open for a rejected repository input shape");
    },
  });
  const result = await repository.proposeClaim({ organizationId: ORG });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});
