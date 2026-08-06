import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  validateClaimGapLineage,
  validateClientFollowupRouting,
  dimensionResultRequiresGap,
  CLIENT_ANSWERABLE_DIMENSION_KEYS,
  CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION,
} from "../Backend/kai/validators/kaiClaimGapFollowupValidators.js";
import { generateClaimGapFollowups } from "../Backend/kai/services/kaiClaimGapFollowupService.js";
import {
  createPostgresClaimGapFollowupRepository,
  __claimGapFollowupRepositoryContract,
  __claimGapFollowupRepositoryTestables,
} from "../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js";

const SERVICE_PATH = "Backend/kai/services/kaiClaimGapFollowupService.js";
const REPOSITORY_PATH = "Backend/kai/dictionary/postgresClaimGapFollowupRepository.js";

const serviceSource = readFileSync(new URL(`../${SERVICE_PATH}`, import.meta.url), "utf8");
const repositorySource = readFileSync(new URL(`../${REPOSITORY_PATH}`, import.meta.url), "utf8");

const ORG = "00000000-0000-4000-8000-000000000001";
const CLAIM = "c0000000-0000-4000-8000-000000000001";
const EVIDENCE_ITEM = "a0000000-0000-4000-8000-000000000001";
const LOCATOR = "a1000000-0000-4000-8000-000000000001";
const SOURCE = "71000000-0000-4000-8000-000000000001";
const SOURCE_VERSION = "70000000-0000-4000-8000-000000000001";
const CANDIDATE = "90000000-0000-4000-8000-000000000001";
const GAP = "d0000000-0000-4000-8000-000000000001";
const NOW = "2026-08-06T10:00:00.000Z";

function validRows(overrides = {}) {
  return {
    claimRow: { claim_id: CLAIM, organization_id: ORG, evidence_item_id: EVIDENCE_ITEM, ...overrides.claimRow },
    claimEvidenceLinkRow: { claim_id: CLAIM, organization_id: ORG, evidence_item_id: EVIDENCE_ITEM, ...overrides.claimEvidenceLinkRow },
    evidenceItemRow: {
      evidence_item_id: EVIDENCE_ITEM,
      organization_id: ORG,
      source_locator_id: LOCATOR,
      source_id: SOURCE,
      source_version_id: SOURCE_VERSION,
      support_strength: "supported",
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
    sourceRow: { source_id: SOURCE, organization_id: ORG, ...overrides.sourceRow },
    sourceVersionRow: {
      source_version_id: SOURCE_VERSION,
      organization_id: ORG,
      source_id: SOURCE,
      intake_source_candidate_id: CANDIDATE,
      is_current: true,
      intake_sensitivity_profile_id: "b0000000-0000-4000-8000-000000000001",
      profile_canonical_sha256: "c".repeat(64),
      ...overrides.sourceVersionRow,
    },
    candidateRow: {
      intake_source_candidate_id: CANDIDATE,
      organization_id: ORG,
      intake_file_id: "20000000-0000-4000-8000-000000000001",
      candidate_status: "promoted",
      intake_sensitivity_profile_id: "b0000000-0000-4000-8000-000000000001",
      file_profile_id: "e0000000-0000-4000-8000-000000000001",
      data_dictionary_id: "f0000000-0000-4000-8000-000000000001",
      profile_canonical_sha256: "c".repeat(64),
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
      review_status: "resolved",
      ...overrides.evidenceReviewQueueItemRow,
    },
    profileRow: {
      organization_id: ORG,
      intake_sensitivity_profile_id: "b0000000-0000-4000-8000-000000000001",
      file_profile_id: "e0000000-0000-4000-8000-000000000001",
      data_dictionary_id: "f0000000-0000-4000-8000-000000000001",
      profile_canonical_sha256: "c".repeat(64),
      human_review_required: true,
      public_use_allowed: false,
      funder_use_allowed: false,
      llm_processing_allowed: false,
      product_learning_allowed: false,
      retention_posture: "restricted_pending_review",
      allowed_use_status: "unknown",
      ...overrides.profileRow,
    },
    dictionaryRow: {
      organization_id: ORG,
      data_dictionary_id: "f0000000-0000-4000-8000-000000000001",
      file_profile_id: "e0000000-0000-4000-8000-000000000001",
      profile_canonical_sha256: "c".repeat(64),
      ...overrides.dictionaryRow,
    },
  };
}

test("validateClaimGapLineage: passes when claim/link identity is consistent and reused lineage/permission validators pass", () => {
  const result = validateClaimGapLineage(validRows());
  assert.equal(result.ok, true);
});

test("validateClaimGapLineage: a missing claim or link returns not_found", () => {
  for (const key of ["claimRow", "claimEvidenceLinkRow"]) {
    const rows = validRows();
    rows[key] = null;
    const result = validateClaimGapLineage(rows);
    assert.equal(result.ok, false, key);
    assert.equal(result.code, "not_found", key);
  }
});

test("validateClaimGapLineage: claim/link tenant or identity mismatch returns conflict_current_state_changed", () => {
  const mismatchedOrg = validateClaimGapLineage(validRows({ claimEvidenceLinkRow: { organization_id: "99999999-0000-4000-8000-000000000099" } }));
  assert.equal(mismatchedOrg.ok, false);
  assert.equal(mismatchedOrg.code, "conflict_current_state_changed");

  const mismatchedClaim = validateClaimGapLineage(validRows({ claimEvidenceLinkRow: { claim_id: "99999999-0000-4000-8000-000000000098" } }));
  assert.equal(mismatchedClaim.ok, false);
  assert.equal(mismatchedClaim.code, "conflict_current_state_changed");

  const mismatchedEvidence = validateClaimGapLineage(validRows({ claimEvidenceLinkRow: { evidence_item_id: "99999999-0000-4000-8000-000000000097" } }));
  assert.equal(mismatchedEvidence.ok, false);
  assert.equal(mismatchedEvidence.code, "conflict_current_state_changed");

  const claimEvidenceMismatch = validateClaimGapLineage(validRows({ claimRow: { evidence_item_id: "99999999-0000-4000-8000-000000000096" } }));
  assert.equal(claimEvidenceMismatch.ok, false);
  assert.equal(claimEvidenceMismatch.code, "conflict_current_state_changed");
});

test("validateClaimGapLineage: a non-current source_version fails closed via the reused P2-03 lineage validator", () => {
  const result = validateClaimGapLineage(validRows({ sourceVersionRow: { is_current: false } }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "conflict_current_state_changed");
});

test("validateClaimGapLineage: a not-allowed sensitivity-profile use status fails closed via the reused P2-02 permission gate", () => {
  const result = validateClaimGapLineage(validRows({ profileRow: { allowed_use_status: "not_allowed" } }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "validation_blocker");
});

test("dimensionResultRequiresGap: every assessment_status other than resolved_clear requires a gap", () => {
  assert.equal(dimensionResultRequiresGap({ evidence: { assessment_status: "resolved_clear" } }), false);
  assert.equal(dimensionResultRequiresGap({ evidence: { assessment_status: "resolved_risk_flagged" } }), true);
  assert.equal(dimensionResultRequiresGap({ evidence: { assessment_status: "unresolved" } }), true);
  assert.equal(dimensionResultRequiresGap(undefined), false);
  assert.equal(dimensionResultRequiresGap({ evidence: {} }), false);
});

test("CLIENT_ANSWERABLE_DIMENSION_KEYS: exactly the four client-answerable dimensions", () => {
  assert.deepEqual(
    [...CLIENT_ANSWERABLE_DIMENSION_KEYS].sort(),
    ["definition_clarity", "denominator_clarity", "entity_level_clarity", "time_period_clarity"],
  );
});

test("CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION: exactly the four fixed question templates, unaugmented", () => {
  assert.equal(CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION.definition_clarity, "Confirm the business meaning of the unresolved field or measure.");
  assert.equal(CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION.denominator_clarity, "Confirm the denominator and how it is calculated.");
  assert.equal(CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION.time_period_clarity, "Confirm the reporting period represented by this source.");
  assert.equal(CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION.entity_level_clarity, "Confirm the entity level represented by the unresolved field or measure.");
  assert.equal(Object.keys(CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION).length, 4);
});

function validFollowupRoutingInput(overrides = {}) {
  const dimensionKey = overrides.dimensionKey || "definition_clarity";
  const question = CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[dimensionKey];
  return {
    dimensionKey,
    gapRow: { gap_log_item_id: GAP, organization_id: ORG, claim_id: CLAIM, dimension_key: dimensionKey, ...overrides.gapRow },
    claimRow: { organization_id: ORG, claim_id: CLAIM, ...overrides.claimRow },
    followupWritePlan: {
      organization_id: ORG,
      claim_id: CLAIM,
      gap_log_item_id: GAP,
      dimension_key: dimensionKey,
      question_text: question,
      ...overrides.followupWritePlan,
    },
    queueWritePlan: {
      organization_id: ORG,
      queue_type: "client_followup",
      target_object_type: "client_followup_item",
      queue_status: "waiting_on_client",
      review_status: "proposed",
      priority: "normal",
      summary: "Client clarification is required for an unresolved claim gap.",
      required_action: question,
      assigned_to: null,
      due_at: null,
      ...overrides.queueWritePlan,
    },
  };
}

test("validateClientFollowupRouting: passes for the exact fixed contract on each of the four authorized dimensions", () => {
  for (const dimensionKey of CLIENT_ANSWERABLE_DIMENSION_KEYS) {
    const result = validateClientFollowupRouting(validFollowupRoutingInput({ dimensionKey }));
    assert.equal(result.ok, true, dimensionKey);
  }
});

test("validateClientFollowupRouting: rejects every dimension outside the four authorized client-answerable dimensions", () => {
  for (const dimensionKey of [
    "missingness", "duplicates", "small_cell_risk", "conflicting_source_indicators", "requirement_alignment", "coverage_gaps",
  ]) {
    const result = validateClientFollowupRouting({
      dimensionKey,
      gapRow: { gap_log_item_id: GAP, organization_id: ORG, claim_id: CLAIM, dimension_key: dimensionKey },
      claimRow: { organization_id: ORG, claim_id: CLAIM },
      followupWritePlan: { organization_id: ORG, claim_id: CLAIM, gap_log_item_id: GAP, dimension_key: dimensionKey, question_text: "anything" },
      queueWritePlan: {},
    });
    assert.equal(result.ok, false, dimensionKey);
    assert.equal(result.code, "validation_blocker", dimensionKey);
  }
});

test("validateClientFollowupRouting: a missing gap or claim row returns not_found", () => {
  for (const key of ["gapRow", "claimRow"]) {
    const input = validFollowupRoutingInput();
    input[key] = null;
    const result = validateClientFollowupRouting(input);
    assert.equal(result.ok, false, key);
    assert.equal(result.code, "not_found", key);
  }
});

test("validateClientFollowupRouting: tenant or dimension mismatch between gap and claim returns conflict_current_state_changed", () => {
  const orgMismatch = validateClientFollowupRouting(validFollowupRoutingInput({ gapRow: { organization_id: "99999999-0000-4000-8000-000000000099" } }));
  assert.equal(orgMismatch.ok, false);
  assert.equal(orgMismatch.code, "conflict_current_state_changed");

  const claimMismatch = validateClientFollowupRouting(validFollowupRoutingInput({ gapRow: { claim_id: "99999999-0000-4000-8000-000000000098" } }));
  assert.equal(claimMismatch.ok, false);
  assert.equal(claimMismatch.code, "conflict_current_state_changed");

  const dimensionMismatch = validateClientFollowupRouting(validFollowupRoutingInput({ gapRow: { dimension_key: "time_period_clarity" } }));
  assert.equal(dimensionMismatch.ok, false);
  assert.equal(dimensionMismatch.code, "conflict_current_state_changed");
});

test("validateClientFollowupRouting: any deviation in the follow-up write plan is a validation_blocker", () => {
  const scenarios = [
    validFollowupRoutingInput({ followupWritePlan: { question_text: "A different question." } }),
    validFollowupRoutingInput({ followupWritePlan: { gap_log_item_id: "99999999-0000-4000-8000-000000000097" } }),
    validFollowupRoutingInput({ followupWritePlan: { extraField: "not allowed" } }),
  ];
  for (const input of scenarios) {
    const result = validateClientFollowupRouting(input);
    assert.equal(result.ok, false);
    assert.equal(result.code, "validation_blocker");
  }
});

test("validateClientFollowupRouting: any deviation in the queue write plan is a validation_blocker - including an internal-only or unsupported-assertion reason never leaking through", () => {
  const scenarios = [
    validFollowupRoutingInput({ queueWritePlan: { queue_status: "open" } }),
    validFollowupRoutingInput({ queueWritePlan: { review_status: "needs_gk_review" } }),
    validFollowupRoutingInput({ queueWritePlan: { priority: "high" } }),
    validFollowupRoutingInput({ queueWritePlan: { summary: "A conflict was detected between sources." } }),
    validFollowupRoutingInput({ queueWritePlan: { required_action: "The requirement is unmet." } }),
    validFollowupRoutingInput({ queueWritePlan: { assigned_to: "90000000-0000-4000-8000-000000000001" } }),
    validFollowupRoutingInput({ queueWritePlan: { due_at: "2026-09-01T00:00:00.000Z" } }),
    validFollowupRoutingInput({ queueWritePlan: { target_object_type: "claim" } }),
    validFollowupRoutingInput({ queueWritePlan: { extraField: "raw content should never appear here" } }),
  ];
  for (const input of scenarios) {
    const result = validateClientFollowupRouting(input);
    assert.equal(result.ok, false, JSON.stringify(input.queueWritePlan));
    assert.equal(result.code, "validation_blocker", JSON.stringify(input.queueWritePlan));
  }
});

test("P2-04 service: KAI_SPRINT2_ENABLED disabled (or absent) returns feature_disabled with zero repository calls; no package-specific flag exists", async () => {
  const throwingRepository = {
    async generateClaimGapsAndFollowups() {
      throw new Error("repository should never be called when KAI_SPRINT2_ENABLED is disabled");
    },
  };
  for (const env of [{}, { KAI_SPRINT2_ENABLED: "false" }, { KAI_SPRINT2_ENABLED: "0" }, { KAI_CLAIM_GAP_FOLLOWUP_ENABLED: "true" }]) {
    const result = await generateClaimGapFollowups(
      { organizationId: ORG, claimId: CLAIM, actorContext: humanActor(), now: NOW },
      { env, claimGapFollowupRepository: throwingRepository },
    );
    assert.equal(result.ok, false, JSON.stringify(env));
    assert.equal(result.error.code, "feature_disabled", JSON.stringify(env));
  }
});

test("P2-04 service: KAI_SPRINT2_ENABLED alone (no other flag) enables the seam", async () => {
  const probeRepository = {
    async generateClaimGapsAndFollowups() {
      return { ok: true, data: { replayed: false, gapItems: [], clientFollowupItems: [], reviewQueueItems: [] }, error: null };
    },
  };
  const result = await generateClaimGapFollowups(
    { organizationId: ORG, claimId: CLAIM, actorContext: humanActor(), now: NOW },
    { env: { KAI_SPRINT2_ENABLED: "true" }, claimGapFollowupRepository: probeRepository },
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

test("P2-04 service: rejects an unknown input key without calling the repository", async () => {
  const throwingRepository = { async generateClaimGapsAndFollowups() { throw new Error("must not be called"); } };
  const result = await generateClaimGapFollowups(
    { organizationId: ORG, claimId: CLAIM, actorContext: humanActor(), now: NOW, extraKey: "nope" },
    { env: sprint2Enabled, claimGapFollowupRepository: throwingRepository },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("P2-04 service: rejects a missing required key without calling the repository", async () => {
  const throwingRepository = { async generateClaimGapsAndFollowups() { throw new Error("must not be called"); } };
  const invalidInputs = [
    null,
    {},
    { organizationId: ORG, claimId: CLAIM, actorContext: humanActor() },
    { organizationId: ORG, claimId: CLAIM, now: NOW },
    { claimId: CLAIM, actorContext: humanActor(), now: NOW },
    { organizationId: ORG, actorContext: humanActor(), now: NOW },
    { organizationId: "", claimId: CLAIM, actorContext: humanActor(), now: NOW },
    { organizationId: ORG, claimId: CLAIM, actorContext: humanActor(), now: "not-a-normalized-timestamp" },
  ];
  for (const input of invalidInputs) {
    const result = await generateClaimGapFollowups(input, { env: sprint2Enabled, claimGapFollowupRepository: throwingRepository });
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error.code, "validation_blocker", JSON.stringify(input));
  }
});

test("P2-04 service (AUTH-KAI-003): rejects every non-human actor type outright, with zero repository calls", async () => {
  const throwingRepository = { async generateClaimGapsAndFollowups() { throw new Error("must not be called"); } };
  for (const actorType of ["ai", "system", "import", "code", "generic_service"]) {
    const result = await generateClaimGapFollowups(
      { organizationId: ORG, claimId: CLAIM, actorContext: humanActor({ actorType }), now: NOW },
      { env: sprint2Enabled, claimGapFollowupRepository: throwingRepository },
    );
    assert.equal(result.ok, false, actorType);
    assert.equal(result.error.code, "authorization_denied", actorType);
  }
});

test("P2-04 service: a role without active tenant membership is rejected", async () => {
  const throwingRepository = { async generateClaimGapsAndFollowups() { throw new Error("must not be called"); } };
  const result = await generateClaimGapFollowups(
    { organizationId: ORG, claimId: CLAIM, actorContext: humanActor({ organizationMemberships: [] }), now: NOW },
    { env: sprint2Enabled, claimGapFollowupRepository: throwingRepository },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_boundary_violation");
});

test("P2-04 service: forwards only organizationId/claimId/actorUserId/now/metadataOnlyAudit to the repository", async () => {
  const calls = [];
  const probeRepository = {
    async generateClaimGapsAndFollowups(input) {
      calls.push(input);
      return { ok: true, data: { replayed: false, gapItems: [], clientFollowupItems: [], reviewQueueItems: [] }, error: null };
    },
  };
  const metadataOnlyAudit = { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) };
  const result = await generateClaimGapFollowups(
    { organizationId: ORG, claimId: CLAIM, actorContext: humanActor(), now: NOW },
    { env: sprint2Enabled, claimGapFollowupRepository: probeRepository, metadataOnlyAudit },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["actorUserId", "claimId", "metadataOnlyAudit", "now", "organizationId"]);
  assert.equal(calls[0].organizationId, ORG);
  assert.equal(calls[0].claimId, CLAIM);
  assert.equal(calls[0].actorUserId, "user-1");
  assert.equal(calls[0].now, NOW);
});

test("P2-04 service: generateClaimGapFollowups itself contains no SQL and does not import a database pool directly", () => {
  const body = serviceSource.match(/export async function generateClaimGapFollowups\([\s\S]*/)?.[0];
  assert.ok(body, "expected to find the generateClaimGapFollowups function body");
  assert.doesNotMatch(body, /\bimport\s+pool\b/);
  assert.doesNotMatch(body, /\bSELECT\b|\bINSERT INTO\b|\bUPDATE\b|\bDELETE FROM\b/i);
});

test("P2-04 repository: gap_log_items/client_followup_items/review_queue_items inserts all use ON CONFLICT ... DO NOTHING RETURNING", () => {
  assert.match(
    repositorySource,
    /INSERT INTO kai\.gap_log_items[\s\S]*?ON CONFLICT \(organization_id, claim_id, dimension_key\)[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
  assert.match(
    repositorySource,
    /INSERT INTO kai\.client_followup_items[\s\S]*?ON CONFLICT \(organization_id, claim_id, dimension_key\)[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
  assert.match(
    repositorySource,
    /INSERT INTO kai\.review_queue_items[\s\S]*?ON CONFLICT \(organization_id, queue_type, target_object_type, target_object_id\)[\s\S]*?WHERE queue_type = 'client_followup'[\s\S]*?DO NOTHING[\s\S]*?RETURNING/,
  );
});

test("P2-04 repository resolves concurrency via ON CONFLICT ... DO NOTHING RETURNING plus authoritative re-reads, not a raised 23505 catch or an in-process lock", () => {
  assert.doesNotMatch(repositorySource, /\bcatch\s*\(\s*insertError\s*\)/);
  assert.doesNotMatch(repositorySource, /"23505"/);
  assert.doesNotMatch(repositorySource, /\b(?:inFlight|pendingLocks?|mutex|semaphore|advisory_lock|pg_advisory|savepoint)\b/i);
});

test("P2-04 repository never fabricates raw content, sample values, or storage pointers, and never includes question/summary text in audit metadata", () => {
  assert.doesNotMatch(repositorySource, /raw_content|sample_values|storage_uri|signed_url/i);
  const auditMetadataBuilder = repositorySource.match(/function buildClaimGapFollowupAuditMetadata\([\s\S]*?\n\}/)?.[0];
  assert.ok(auditMetadataBuilder);
  assert.doesNotMatch(auditMetadataBuilder, /question_text|safe_summary|\bsummary\b/);
});

test("P2-04 audit contract discloses its validator key and operation as a P2-04 implementation decision", () => {
  assert.equal(__claimGapFollowupRepositoryContract.CLAIM_GAP_FOLLOWUP_VALIDATOR_KEY, "VAL-KAI-P2-04-001");
  assert.equal(__claimGapFollowupRepositoryContract.CLAIM_GAP_FOLLOWUP_AUDIT_OPERATION, "claim_gap_and_followup_generated");
  assert.deepEqual(
    [...__claimGapFollowupRepositoryContract.DIMENSION_KEYS],
    [
      "missingness", "duplicates", "definition_clarity", "denominator_clarity", "time_period_clarity",
      "entity_level_clarity", "small_cell_risk", "conflicting_source_indicators", "requirement_alignment", "coverage_gaps",
    ],
  );
});

test("P2-04 buildExpectedGapPlans: creates a plan for every non-resolved_clear dimension only, and safeSummaryFor matches the fixed template", () => {
  const { buildExpectedGapPlans, safeSummaryFor } = __claimGapFollowupRepositoryTestables;
  const dimensions = {
    missingness: { validator_key: "VAL-KAI-P2-02-missingness", evidence: { assessment_status: "resolved_clear" } },
    duplicates: { validator_key: "VAL-KAI-P2-02-duplicates", evidence: { assessment_status: "resolved_risk_flagged", open_finding_count: 2 } },
    definition_clarity: { validator_key: "VAL-KAI-P2-02-definition_clarity", evidence: { assessment_status: "resolved_risk_flagged", field_count: 3, undefined_field_count: 1 } },
    denominator_clarity: { validator_key: "VAL-KAI-P2-02-denominator_clarity", evidence: { assessment_status: "unresolved" } },
    time_period_clarity: { validator_key: "VAL-KAI-P2-02-time_period_clarity", evidence: { assessment_status: "unresolved" } },
    entity_level_clarity: { validator_key: "VAL-KAI-P2-02-entity_level_clarity", evidence: { assessment_status: "resolved_clear" } },
    small_cell_risk: { validator_key: "VAL-KAI-P2-02-small_cell_risk", evidence: { assessment_status: "resolved_clear" } },
    conflicting_source_indicators: { validator_key: "VAL-KAI-P2-02-conflicting_source_indicators", evidence: { assessment_status: "unresolved" } },
    requirement_alignment: { validator_key: "VAL-KAI-P2-02-requirement_alignment", evidence: { assessment_status: "unresolved" } },
    coverage_gaps: { validator_key: "VAL-KAI-P2-02-coverage_gaps", evidence: { assessment_status: "resolved_clear" } },
  };
  const plans = buildExpectedGapPlans(dimensions);
  assert.deepEqual(
    plans.map((plan) => plan.dimension_key),
    ["duplicates", "definition_clarity", "denominator_clarity", "time_period_clarity", "conflicting_source_indicators", "requirement_alignment"],
  );
  for (const plan of plans) {
    assert.equal(plan.safe_summary, safeSummaryFor(plan.dimension_key));
  }
  const duplicatesPlan = plans.find((plan) => plan.dimension_key === "duplicates");
  assert.equal(duplicatesPlan.open_finding_count, 2);
  assert.equal(duplicatesPlan.field_count, null);
});

test("P2-04 buildExpectedFollowupDimensionKeys: only the intersection of gap dimensions and the four client-answerable dimensions", () => {
  const { buildExpectedFollowupDimensionKeys } = __claimGapFollowupRepositoryTestables;
  const plans = [
    { dimension_key: "missingness" },
    { dimension_key: "definition_clarity" },
    { dimension_key: "denominator_clarity" },
    { dimension_key: "conflicting_source_indicators" },
  ];
  assert.deepEqual(buildExpectedFollowupDimensionKeys(plans), ["definition_clarity", "denominator_clarity"]);
});

test("P2-04 repository never statically imports Backend/kai/db/kaiDb.js at module top level - only a deferred dynamic import", () => {
  const topLevelImports = repositorySource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/kaiDb\.js/.test(line)));
  assert.match(repositorySource, /await import\("\.\.\/db\/kaiDb\.js"\)/);
});

test("P2-04 repository rejects an input shape outside its own allowlist without opening a transaction", async () => {
  const repository = createPostgresClaimGapFollowupRepository({
    runInTransaction: () => {
      throw new Error("transaction should never open for a rejected repository input shape");
    },
  });
  const result = await repository.generateClaimGapsAndFollowups({ organizationId: ORG });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("P2-04 repository reuses (never forks) the P2-02 dimension-assessment functions and P2-02/P2-03 validators", () => {
  assert.match(repositorySource, /from\s+["']\.\.\/validators\/kaiEvidenceCoverageAssessmentValidators\.js["']/);
  assert.match(repositorySource, /assessMissingness|assessDuplicates|assessDefinitionClarity|assessCoverageGaps/);
  assert.doesNotMatch(repositorySource, /function assessMissingness|function assessDuplicates|function assessCoverageGaps/);
});
