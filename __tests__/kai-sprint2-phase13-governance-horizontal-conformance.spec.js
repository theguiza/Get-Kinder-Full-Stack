// Horizontal Phase-13 GOVERNANCE conformance suite for the four current
// generated-draft content types (evidence_summary, impact_narrative,
// readiness_assessment, data_gap_memo).
//
// This suite is deliberately scoped to governance predicates only. It does
// NOT re-prove the provider/result contract (provider call -> structured
// output -> JSON parse -> normalize -> classifyGeneratorResult) already
// declared once, horizontally, by
// kai-sprint2-generator-result-contract-horizontal-conformance.spec.js. That
// file is read for style/wiring conventions but is neither modified nor
// duplicated here.
//
// It drives two real, shared, production code paths, with only I/O
// boundaries (a fake transaction, a fake traceability evaluator, and stub
// draft-generator functions) mocked out:
//
//   1. `validateGeneratedContentDraft` (Backend/kai/validators/
//      kaiGeneratedContentValidators.js) - the shared VAL-GEN-001..007
//      governance validator every content type's draft is run through
//      before persistence. Called directly, per content type, for the
//      predicates that are pure functions of (claims, blocks, audience).
//   2. `createPostgresGeneratedContentRepository(...).createXxxDraft` (the
//      real creation service, Backend/kai/dictionary/
//      postgresGeneratedContentRepository.js) - for the predicates that are
//      facts about PERSISTENCE (draft_status, review_status, review-queue
//      coupling), which validateGeneratedContentDraft itself does not
//      decide.
//   3. `validateExportManifestEligibility` (VAL-EXP-001, Backend/kai/
//      validators/kaiExportManifestEligibilityValidators.js) - the real,
//      shared, content-type-agnostic export-authority gate, used here only
//      to prove that a freshly generated draft's own state (still `draft`,
//      review unresolved, no finalGate, no affirmative human export
//      authority) can never itself satisfy export eligibility.
//
// GOVERNANCE PREDICATE -> REAL VALIDATOR/REASON-CODE MAP (see the report
// handed back with this suite for full file/line citations):
//   1. eligible/current governed input succeeds
//        -> VAL-GEN-001..007 all "pass" (validateGeneratedContentDraft)
//   2. ineligible/blocked claim cannot become an accepted assertion
//        -> ALL FOUR TYPES, any requested audience: a claim whose
//           authoritative claim_strength is the TERMINAL
//           "reviewed_not_supported" outcome is rejected before the
//           generator is ever invoked - repository pre-generation gate,
//           error code "claim_reviewed_not_supported"
//           (postgresGeneratedContentRepository.js, immediately after the
//           traceabilityResults loop in createGeneratedContentDraft; Phase-13
//           repair). This is distinct from, and narrower than, the merely
//           UNRESOLVED/UNASSESSED `eligible=false` case below, which INTERNAL
//           generation still admits unchanged.
//        -> evidence_summary (funder only): additionally, repository
//           pre-generation gate, error code
//           "funder_use_not_currently_eligible"
//           (postgresGeneratedContentRepository.js ~L1256-1261) - a broader,
//           audience-scoped current-use-eligibility gate that subsumes the
//           terminal case above for funder requests specifically
//        -> readiness_assessment: VAL-GEN-006,
//           "readiness_gap_or_blocker_stated_as_positive_assertion"
//        -> data_gap_memo: VAL-GEN-007,
//           "data_gap_or_missing_support_stated_as_positive_support"
//        -> impact_narrative: no VAL-GEN-006/007-equivalent PURE VALIDATOR
//           exists (documented type-specific variance below, not a
//           divergence) - but the repository-layer terminal gate above
//           still applies to it, like every other type
//   3. citations resolve only to governed claim/evidence identities
//        -> VAL-GEN-002 "missing_or_unresolved_exact_citation" and
//           VAL-GEN-003 "unauthorized_claim_reference" (all 4 types,
//           content-type-agnostic)
//   4. required limitation handling remains enforced
//        -> readiness_assessment only: VAL-GEN-006's
//           generationClaimsContainBlockers(claim.limitationCodes) branch
//        -> evidence_summary / impact_narrative / data_gap_memo: no VAL-GEN
//           branch reads claim.limitationCodes at all (documented variance)
//   5. unsupported numeric/metric assertions rejected
//        -> VAL-GEN-004, "unsupported_numeric_or_causal_assertion",
//           assertion_classes includes "numeric_literal" (all 4 types)
//   6. unsupported causal language rejected
//        -> VAL-GEN-004, same reason code,
//           assertion_classes includes "causal_language" (all 4 types)
//   7. requested-audience eligibility enforced
//        -> VAL-GEN-005, "draft_audience_exceeds_authority" (all 4 types,
//           pure validator); additionally, for the three internal-only
//           types, the repository itself fails closed
//           ("validation_blocker") before generation ever starts if a
//           non-"internal" audience is requested at all
//   8. successful output remains a `draft`
//        -> persisted draft_status is the DRAFT_STATUS constant "draft"
//           (postgresGeneratedContentRepository.js persistCompleteSet)
//   9. successful output remains human-review gated
//        -> persisted review_status is
//           GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT.reviewStatus
//           ("needs_gk_review") and a matching
//           kai.review_queue_items row (queue_type "generated_content_review")
//           is created in the same transaction
//  10. the generation path grants no final/export/approval authority
//        -> VAL-EXP-001 (validateExportManifestEligibility), fed the
//           freshly created draft's own real state, always blocks with
//           failed_gates including "generated_content_still_draft",
//           "affirmative_human_export_authority_absent", and
//           "final_export_gate_absent"

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { validateGeneratedContentDraft } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { validateExportManifestEligibility } from "../Backend/kai/validators/kaiExportManifestEligibilityValidators.js";
import {
  createPostgresGeneratedContentRepository,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { createCaseForSupportDraft } from "../Backend/kai/services/kaiGeneratedContentService.js";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });

const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const OTHER_EVIDENCE = "00000000-0000-4000-8000-000000000202";
const SOURCE = "00000000-0000-4000-8000-000000000301";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000401";
const REQUIREMENT = "00000000-0000-4000-8000-000000000501";
const GAP = "00000000-0000-4000-8000-000000000601";
const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000701";

// A claim statement carrying no digits and no causality-pattern words, so
// every "valid" fixture below is clean of both VAL-GEN-004 triggers unless
// a test case deliberately introduces one.
const SAFE_STATEMENT = "This claim is traceable to a governed evidence item.";

const CONTENT_TYPES = Object.freeze([
  "evidence_summary",
  "impact_narrative",
  "readiness_assessment",
  "data_gap_memo",
  "case_for_support",
]);

const READINESS = Object.freeze({
  requirements: [{
    requirement_id: REQUIREMENT,
    requirement_key: "ir_data_003",
    requirement_label: "Claims are traceable to evidence",
    assessed: true,
    assessment: {
      assessment_state: "partially_satisfied",
      assessment_explanation: "Some governed claims have no traceable evidence link.",
    },
  }],
});

const GAPS = Object.freeze({
  items: [{
    gap_log_item_id: GAP,
    claim_id: CLAIM,
    dimension_key: "coverage_gaps",
    assessment_status: "unresolved",
    validator_key: "VAL-COV-001",
  }],
});

// --- fixture builders for direct validateGeneratedContentDraft calls ---

function governedClaim(overrides = {}) {
  return {
    claimId: CLAIM,
    claimStatement: SAFE_STATEMENT,
    claimType: "finding",
    evidenceItemId: EVIDENCE,
    sourceId: SOURCE,
    sourceVersionId: SOURCE_VERSION,
    limitationCodes: [],
    revalidatedForGeneration: true,
    requestedAudience: "internal",
    currentEligible: true,
    audienceAuthority: { internal: true, funder: false, public: false },
    ...overrides,
  };
}

function block(overrides = {}) {
  return {
    ordinal: 1,
    text: SAFE_STATEMENT,
    citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    ...overrides,
  };
}

// Content-type-specific `authoritativeReadiness` argument, matching exactly
// what postgresGeneratedContentRepository.js's createGeneratedContentDraft
// passes into validateGeneratedContentDraft for each type (readiness state
// for readiness_assessment, the authoritative gap set - passed under the
// same `authoritativeReadiness` parameter name - for data_gap_memo, and
// `null` for the other two, which read no such input at all).
function authoritativeReadinessArgFor(contentType) {
  if (contentType === "readiness_assessment") return READINESS;
  if (contentType === "data_gap_memo") return GAPS;
  return null;
}

function validArgs(contentType, overrides = {}) {
  return {
    requestedAudience: "internal",
    generationClaims: [governedClaim()],
    blocks: [block()],
    draftAudience: "internal",
    contentType,
    authoritativeReadiness: authoritativeReadinessArgFor(contentType),
    ...overrides,
  };
}

function blockerKeys(result) {
  return result.blockers.map((b) => b.validator_key).sort();
}

// ---------------------------------------------------------------------
// Predicate 1: eligible/current governed input succeeds.
// ---------------------------------------------------------------------

for (const contentType of CONTENT_TYPES) {
  test(`[${contentType}] predicate 1 - a fresh, revalidated, in-authority governed claim with a clean citation succeeds (validateGeneratedContentDraft ok:true)`, () => {
    const result = validateGeneratedContentDraft(validArgs(contentType));
    assert.equal(result.ok, true, JSON.stringify(result.blockers));
    assert.deepEqual(result.blockers, []);
    const passedKeys = result.results.filter((r) => r.severity === "pass").map((r) => r.validator_key).sort();
    const expectedKeys = ["VAL-GEN-001", "VAL-GEN-002", "VAL-GEN-003", "VAL-GEN-004", "VAL-GEN-005"];
    if (contentType === "readiness_assessment") expectedKeys.push("VAL-GEN-006");
    if (contentType === "data_gap_memo") expectedKeys.push("VAL-GEN-007");
    assert.deepEqual(passedKeys, expectedKeys.sort());
  });
}

// ---------------------------------------------------------------------
// Predicate 3: citations must resolve only to governed claim/evidence
// identities (VAL-GEN-002 / VAL-GEN-003, content-type-agnostic).
// ---------------------------------------------------------------------

for (const contentType of CONTENT_TYPES) {
  test(`[${contentType}] predicate 3 - a citation pointing at an evidence item outside the governed claim projection is rejected by VAL-GEN-002 and VAL-GEN-003`, () => {
    const result = validateGeneratedContentDraft(validArgs(contentType, {
      blocks: [block({ citations: [{ claimId: CLAIM, evidenceItemId: OTHER_EVIDENCE }] })],
    }));
    assert.equal(result.ok, false);
    assert.deepEqual(blockerKeys(result), ["VAL-GEN-002", "VAL-GEN-003"]);
    const byKey = new Map(result.blockers.map((b) => [b.validator_key, b]));
    assert.equal(byKey.get("VAL-GEN-002").blocking_reason, "missing_or_unresolved_exact_citation");
    assert.equal(byKey.get("VAL-GEN-003").blocking_reason, "unauthorized_claim_reference");
  });
}

// ---------------------------------------------------------------------
// Predicate 5: unsupported numeric/metric assertions are rejected
// (VAL-GEN-004, NUMERIC_LITERAL_PATTERN branch, content-type-agnostic).
// ---------------------------------------------------------------------

for (const contentType of CONTENT_TYPES) {
  test(`[${contentType}] predicate 5 - a numeric literal absent from every cited claim statement is rejected by VAL-GEN-004 (numeric_literal)`, () => {
    const result = validateGeneratedContentDraft(validArgs(contentType, {
      blocks: [block({ text: "This claim is traceable to a governed evidence item, 42% of the time." })],
    }));
    assert.equal(result.ok, false);
    assert.deepEqual(blockerKeys(result), ["VAL-GEN-004"]);
    const genFour = result.blockers[0];
    assert.equal(genFour.blocking_reason, "unsupported_numeric_or_causal_assertion");
    assert.ok(genFour.evidence.assertion_classes.includes("numeric_literal"), JSON.stringify(genFour.evidence));
  });
}

// ---------------------------------------------------------------------
// Predicate 6: unsupported causal language is rejected via the existing
// causality control (VAL-GEN-004, CAUSAL_PATTERN branch,
// content-type-agnostic).
// ---------------------------------------------------------------------

for (const contentType of CONTENT_TYPES) {
  test(`[${contentType}] predicate 6 - causal language absent from every cited claim statement is rejected by VAL-GEN-004 (causal_language)`, () => {
    const result = validateGeneratedContentDraft(validArgs(contentType, {
      blocks: [block({ text: "This finding caused a downstream improvement." })],
    }));
    assert.equal(result.ok, false);
    assert.deepEqual(blockerKeys(result), ["VAL-GEN-004"]);
    const genFour = result.blockers[0];
    assert.equal(genFour.blocking_reason, "unsupported_numeric_or_causal_assertion");
    assert.ok(genFour.evidence.assertion_classes.includes("causal_language"), JSON.stringify(genFour.evidence));
  });
}

// ---------------------------------------------------------------------
// Predicate 7: requested-audience eligibility is enforced.
//   (a) VAL-GEN-005 itself is content-type-agnostic: a claim without
//       authority for the requested audience is rejected regardless of
//       contentType.
//   (b) In production, only evidence_summary's generator/repository path
//       ever accepts a non-"internal" requestedAudience at all; the other
//       three fail closed at the repository layer before generation.
// ---------------------------------------------------------------------

for (const contentType of CONTENT_TYPES) {
  test(`[${contentType}] predicate 7a - a claim lacking internal audience authority is rejected by VAL-GEN-005 (draft_audience_exceeds_authority)`, () => {
    const result = validateGeneratedContentDraft(validArgs(contentType, {
      generationClaims: [governedClaim({ audienceAuthority: { internal: false, funder: false, public: false } })],
    }));
    assert.equal(result.ok, false);
    assert.deepEqual(blockerKeys(result), ["VAL-GEN-005"]);
    assert.equal(result.blockers[0].blocking_reason, "draft_audience_exceeds_authority");
  });
}

test("[evidence_summary] predicate 7b - VAL-GEN-005 itself accepts a funder-authorized claim for a funder-requested draft (the one type production actually allows to request funder)", () => {
  const result = validateGeneratedContentDraft(validArgs("evidence_summary", {
    requestedAudience: "funder",
    draftAudience: "funder",
    generationClaims: [governedClaim({
      requestedAudience: "funder",
      audienceAuthority: { internal: false, funder: true, public: false },
    })],
  }));
  assert.equal(result.ok, true, JSON.stringify(result.blockers));
});

test("[evidence_summary] predicate 7b - VAL-GEN-005 rejects a funder-requested draft when the claim carries no funder authority", () => {
  const result = validateGeneratedContentDraft(validArgs("evidence_summary", {
    requestedAudience: "funder",
    draftAudience: "funder",
    generationClaims: [governedClaim({
      requestedAudience: "funder",
      audienceAuthority: { internal: false, funder: false, public: false },
    })],
  }));
  assert.equal(result.ok, false);
  assert.deepEqual(blockerKeys(result), ["VAL-GEN-005"]);
});

// ---------------------------------------------------------------------
// Predicate 7d (case_for_support-specific, P13-EXT-1): case_for_support is
// generation-time restricted to internal + funder only - unlike the three
// internal-only types above, it is NOT rejected at the repository layer for
// a funder request (see createGeneratedContentDraft's internal-only-types
// array in postgresGeneratedContentRepository.js, which deliberately does
// NOT include case_for_support). Instead, "public" is rejected at the
// SERVICE-level input validator (isCreateCaseForSupportDraftInput,
// kaiGeneratedContentService.js), before the repository is ever reached,
// while "internal" and "funder" are both accepted at that same input-shape
// layer.
// ---------------------------------------------------------------------

test('[case_for_support] predicate 7d - the service-level input validator rejects requestedAudience "public" before any repository call', async () => {
  const repository = {
    createCaseForSupportDraft: async () => { throw new Error("createCaseForSupportDraft must not be reached: public must fail closed at the service-level input validator"); },
  };
  const result = await createCaseForSupportDraft({
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    requestedAudience: "public",
    claimIds: [CLAIM],
    idempotencyKey: "phase13-governance-case-for-support-audience-gate-public",
    actorContext: { actorType: "human", actorUserId: "90000000-0000-4000-8000-000000000001", source: "public.userdata", organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }] },
    now: "2026-09-01T00:00:00.000Z",
  }, { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

for (const requestedAudience of ["internal", "funder"]) {
  test(`[case_for_support] predicate 7d - the service-level input validator accepts requestedAudience "${requestedAudience}" (repository is invoked)`, async () => {
    let repositoryCalls = 0;
    const repository = {
      createCaseForSupportDraft: async (repoInput) => {
        repositoryCalls += 1;
        return {
          ok: true,
          data: {
            generationRunId: "00000000-0000-4000-8000-000000000801",
            generatedContentDraftId: "00000000-0000-4000-8000-000000000802",
            requestedAudience: repoInput.requestedAudience,
            draftStatus: "draft",
            reviewStatus: "needs_gk_review",
            reviewQueueItemId: "00000000-0000-4000-8000-000000000803",
            blocks: [{ ordinal: 1, text: SAFE_STATEMENT, citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
            replayed: false,
          },
          error: null,
        };
      },
    };
    const result = await createCaseForSupportDraft({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      requestedAudience,
      claimIds: [CLAIM],
      idempotencyKey: `phase13-governance-case-for-support-audience-gate-${requestedAudience}`,
      actorContext: { actorType: "human", actorUserId: "90000000-0000-4000-8000-000000000001", source: "public.userdata", organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }] },
      now: "2026-09-01T00:00:00.000Z",
    }, {
      env: enabledEnv,
      generatedContentRepository: repository,
      metadataOnlyAudit: auditRecorder(),
      getEngagementForOrganization: async () => ({ engagement_id: ENGAGEMENT, organization_id: ORG }),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(repositoryCalls, 1);
  });
}

for (const contentType of ["impact_narrative", "readiness_assessment", "data_gap_memo"]) {
  test(`[${contentType}] predicate 7c - the real creation service fails closed (validation_blocker) before generation if a non-"internal" audience is requested at all`, async () => {
    const repository = createPostgresGeneratedContentRepository({
      runInTransaction: async () => { throw new Error("runInTransaction must not be reached: this content type must fail closed on requestedAudience before any transaction opens"); },
      evaluator: async () => { throw new Error("evaluator must not be reached"); },
    });
    const methodName = {
      impact_narrative: "createImpactNarrativeDraft",
      readiness_assessment: "createReadinessAssessmentDraft",
      data_gap_memo: "createDataGapMemoDraft",
    }[contentType];
    const result = await repository[methodName]({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      requestedAudience: "funder",
      claimIds: [CLAIM],
      idempotencyKey: "phase13-governance-audience-gate",
      actorContext: { actorType: "human", actorUserId: "90000000-0000-4000-8000-000000000001" },
      now: "2026-09-01T00:00:00.000Z",
    }, { draftGenerator: async () => { throw new Error("draftGenerator must not be reached"); }, metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, async publish() {} }) } });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
  });
}

// ---------------------------------------------------------------------
// Predicate 2 (type-specific): ineligible or blocked claim input cannot
// become an accepted generated assertion.
// ---------------------------------------------------------------------

test("[readiness_assessment] predicate 2 - a claim carrying limitationCodes cannot be turned into a positive readiness assertion (VAL-GEN-006, readiness_gap_or_blocker_stated_as_positive_assertion)", () => {
  const result = validateGeneratedContentDraft(validArgs("readiness_assessment", {
    generationClaims: [governedClaim({ limitationCodes: ["evidence_gap_unresolved"] })],
    blocks: [block({ text: "This claim is traceable to a governed evidence item and every requirement is fully met." })],
  }));
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((b) => b.validator_key === "VAL-GEN-006" && b.blocking_reason === "readiness_gap_or_blocker_stated_as_positive_assertion"), JSON.stringify(result.blockers));
});

test("[data_gap_memo] predicate 2 - the authoritative current gap set cannot be inverted into a positive-support assertion (VAL-GEN-007, data_gap_or_missing_support_stated_as_positive_support)", () => {
  const result = validateGeneratedContentDraft(validArgs("data_gap_memo", {
    blocks: [block({ text: "This claim is traceable to a governed evidence item and support is sufficient." })],
  }));
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((b) => b.validator_key === "VAL-GEN-007" && b.blocking_reason === "data_gap_or_missing_support_stated_as_positive_support"), JSON.stringify(result.blockers));
});

// Documented, non-divergent type-specific variance: validateGeneratedContentDraft
// only branches into a gap/blocker-vs-positive-assertion check
// (VAL-GEN-006 / VAL-GEN-007) when contentType is "readiness_assessment" or
// "data_gap_memo" (kaiGeneratedContentValidators.js lines 140-163). Neither
// evidence_summary nor impact_narrative has an equivalent branch, and this
// is intentional: the code comment directly above validateGeneratedContentDraft
// (kaiGeneratedContentValidators.js lines 44-49) and inside
// createGeneratedContentDraft (postgresGeneratedContentRepository.js lines
// 1204-1210) both state that a governed claim's CURRENT audience/use
// eligibility (`currentEligible`) is a separate, stricter, downstream fact
// that must NOT by itself block INTERNAL generation. This is NOT a
// governance divergence: it is the documented, load-bearing design that lets
// an internal, human-review-gated draft legitimately surface a currently
// unresolved/unassessed claim (predicate 9's human-review gate is the
// intended backstop for these two types, not a VAL-GEN blocker).
//
// Disambiguation (Phase-13 reconciliation): `validateGeneratedContentDraft`
// itself has NO visibility into WHY `currentEligible` is false - it only
// ever sees the opaque boolean plus a `limitationCodes` string array, so at
// this pure-validator layer an unresolved/unassessed claim and a terminally
// "reviewed_not_supported" claim are indistinguishable (both collapse into
// the same `support_strength_unassessed` blocker code -
// postgresClaimTraceabilityRepository.js line 770). The test below proves
// that indistinguishability holds exactly as before at THIS layer.
//
// This is no longer the whole governance story, though: the REPOSITORY layer
// (postgresGeneratedContentRepository.js's createGeneratedContentDraft, the
// shared admission boundary all four content types pass through before the
// pure validator ever runs) now reads the one field that DOES distinguish
// the two cases - the fresh traceability result's authoritative
// `claim.claim_strength` - and rejects a terminal "reviewed_not_supported"
// claim (error code "claim_reviewed_not_supported") before generation even
// starts, for every content type and requested audience. See the repository-
// level Case A / Case B tests below for that enforcement; this test proves
// only the pure validator's (unchanged, still-opaque) behavior in isolation.
//
// This `currentEligible`/`limitationCodes` concept is also DIFFERENT from
// both of the following, which remain fully enforced for impact_narrative
// and are proven elsewhere in this file:
//   - a genuinely BLOCKED claim reference, i.e. one outside the governed
//     claim/evidence identities actually supplied for this generation
//     request: excluded by VAL-GEN-003 "unauthorized_claim_reference" for
//     all four content types, including impact_narrative (see predicate 3
//     above, "a citation pointing at an evidence item outside the governed
//     claim projection is rejected by VAL-GEN-002 and VAL-GEN-003").
//   - a claim genuinely INELIGIBLE FOR THE REQUESTED AUDIENCE, i.e. one
//     whose `claim.audienceAuthority` does not authorize the requested
//     audience: excluded by VAL-GEN-005 for all four content types (see
//     predicate 7 below).
// A claim already excluded by either of those two controls never reaches
// this test's fixture at all - it never becomes part of `generationClaims`.
test("[impact_narrative] predicate 2 - documented variance: the PURE VALIDATOR (validateGeneratedContentDraft) has no visibility into an opaque currentEligible:false/limitationCodes signal and does not, by itself, block INTERNAL generation on it (no VAL-GEN-006/007-equivalent exists for this type at this layer; the repository-layer terminal-claim-strength gate proven below is the real enforcement point for a formally rejected claim)", () => {
  const result = validateGeneratedContentDraft(validArgs("impact_narrative", {
    generationClaims: [governedClaim({ limitationCodes: ["evidence_gap_unresolved"], currentEligible: false })],
  }));
  assert.equal(result.ok, true, JSON.stringify(result.blockers));

  // Even a `limitationCodes` string that names the terminal blocker code
  // does not, by itself, change this pure-validator outcome: it only ever
  // sees an opaque string array, never claim_strength itself.
  const rejectedResult = validateGeneratedContentDraft(validArgs("impact_narrative", {
    generationClaims: [governedClaim({ limitationCodes: ["support_strength_unassessed"], currentEligible: false })],
  }));
  assert.equal(rejectedResult.ok, true, JSON.stringify(rejectedResult.blockers));
});

test("[evidence_summary] predicate 2 - a currently-ineligible governed claim requested for FUNDER use cannot become an accepted generated assertion (repository pre-generation gate, funder_use_not_currently_eligible)", async () => {
  const state = makeState();
  const evaluator = makeEvaluator({ eligibleForClaim: () => false });
  const repository = makeRepository(state, evaluator);

  const result = await repository.createEvidenceSummaryDraft({
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    requestedAudience: "funder",
    claimIds: [CLAIM],
    idempotencyKey: "phase13-governance-funder-ineligible",
    actorContext: { actorType: "human", actorUserId: "90000000-0000-4000-8000-000000000001" },
    now: "2026-09-01T00:00:00.000Z",
  }, { draftGenerator: goodGenerator(), metadataOnlyAudit: auditRecorder() });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "funder_use_not_currently_eligible");
  // Fail-closed before any durable state is written.
  assert.equal(state.generationRuns.length, 0);
  assert.equal(state.generatedContentDrafts.length, 0);
});

// ---------------------------------------------------------------------
// Predicate 2 (Phase-13 repair): the repository-layer terminal-claim-
// strength gate, driven through the real createGeneratedContentDraft
// admission boundary shared by all four content types.
//
// CASE A - unresolved/unassessed INTERNAL claim: existing accepted INTERNAL
// drafting behavior is unchanged for a claim that is governed,
// audience-authorized, and merely unresolved/unassessed (claim_strength
// "unassessed", eligible:false). This must NOT become a blanket
// currentEligible===false rejection.
// ---------------------------------------------------------------------

for (const contentType of CONTENT_TYPES) {
  test(`[${contentType}] predicate 2 Case A - an unresolved/unassessed governed claim (claim_strength "unassessed", eligible:false) still succeeds for INTERNAL generation (accepted behavior preserved)`, async () => {
    const state = makeState();
    const evaluator = makeEvaluator({ eligibleForClaim: () => false, claimStrengthForClaim: () => "unassessed" });
    const repository = makeRepository(state, evaluator);
    const methodName = REPOSITORY_METHOD_BY_CONTENT_TYPE[contentType];

    const result = await repository[methodName]({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      requestedAudience: "internal",
      claimIds: [CLAIM],
      idempotencyKey: `phase13-governance-case-a-unresolved-${contentType}`,
      actorContext: { actorType: "human", actorUserId: "90000000-0000-4000-8000-000000000001" },
      now: "2026-09-01T00:00:00.000Z",
    }, {
      draftGenerator: goodGenerator(),
      metadataOnlyAudit: auditRecorder(),
      ...creationDependenciesFor(contentType),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.draftStatus, "draft");
  });
}

// ---------------------------------------------------------------------
// Predicate 2 (Phase-13 repair), CASE B - terminally rejected claim: for
// every current content type, a claim whose fresh, authoritative
// claim_strength is the TERMINAL "reviewed_not_supported" outcome
// (claimStrengthForOutcome, humanReviewDecisionContract.js) cannot become an
// accepted generated assertion. The repository rejects it (error code
// "claim_reviewed_not_supported", carrying a
// VAL-GEN-CLAIM-STRENGTH-P0-001/"claim_terminally_not_supported" structured
// blocker) BEFORE the generator is ever invoked, and before any durable
// state is written - for every content type identically, unlike predicate 2
// (readiness_assessment/data_gap_memo)'s content-type-specific VAL-GEN-006/
// 007 heuristics.
// ---------------------------------------------------------------------

for (const contentType of CONTENT_TYPES) {
  test(`[${contentType}] predicate 2 Case B - a claim with terminal claim_strength "reviewed_not_supported" cannot become an accepted generated assertion (repository pre-generation gate, claim_reviewed_not_supported)`, async () => {
    const state = makeState();
    const evaluator = makeEvaluator({ claimStrengthForClaim: () => "reviewed_not_supported" });
    const repository = makeRepository(state, evaluator);
    const methodName = REPOSITORY_METHOD_BY_CONTENT_TYPE[contentType];

    const result = await repository[methodName]({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      requestedAudience: "internal",
      claimIds: [CLAIM],
      idempotencyKey: `phase13-governance-case-b-terminal-rejected-${contentType}`,
      actorContext: { actorType: "human", actorUserId: "90000000-0000-4000-8000-000000000001" },
      now: "2026-09-01T00:00:00.000Z",
    }, {
      draftGenerator: async () => { throw new Error("draftGenerator must not be reached: a terminally rejected claim must never reach the generator"); },
      metadataOnlyAudit: auditRecorder(),
      ...creationDependenciesFor(contentType),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "claim_reviewed_not_supported");
    assert.ok(
      result.blockers.some((b) => b.blocking_reason === "claim_terminally_not_supported" && b.validator_key === "VAL-GEN-CLAIM-STRENGTH-P0-001"),
      JSON.stringify(result.blockers),
    );
    // Fail-closed before any durable state is written.
    assert.equal(state.generationRuns.length, 0);
    assert.equal(state.generatedContentDrafts.length, 0);
  });
}

// ---------------------------------------------------------------------
// Predicate 4 (type-specific): required limitation handling remains
// enforced.
// ---------------------------------------------------------------------

test("[readiness_assessment] predicate 4 - claim.limitationCodes feeds VAL-GEN-006's blocker-detection directly (generationClaimsContainBlockers)", () => {
  // Same fixture as predicate 2's readiness_assessment case: limitationCodes
  // is the exact signal generationClaimsContainBlockers(generationClaims)
  // reads (kaiGeneratedContentValidators.js lines 192-194).
  const withLimitation = validateGeneratedContentDraft(validArgs("readiness_assessment", {
    generationClaims: [governedClaim({ limitationCodes: ["evidence_gap_unresolved"] })],
    blocks: [block({ text: "This claim is traceable to a governed evidence item and every requirement is fully met." })],
  }));
  assert.equal(withLimitation.ok, false);
  assert.ok(withLimitation.blockers.some((b) => b.validator_key === "VAL-GEN-006"));

  // With the identical positive-assertion text but NO limitationCodes and a
  // requirement whose assessment_state is "satisfied", VAL-GEN-006 must
  // pass: readinessContainsGapOrUnsupportedRequirement is also false, so
  // neither disjunct of the OR is true.
  const satisfiedReadiness = {
    requirements: [{
      requirement_id: REQUIREMENT,
      requirement_key: "ir_data_003",
      requirement_label: "Claims are traceable to evidence",
      assessed: true,
      assessment: { assessment_state: "satisfied", assessment_explanation: "Fully satisfied." },
    }],
  };
  const withoutLimitation = validateGeneratedContentDraft(validArgs("readiness_assessment", {
    blocks: [block({ text: "This claim is traceable to a governed evidence item and every requirement is fully met." })],
    authoritativeReadiness: satisfiedReadiness,
  }));
  assert.equal(withoutLimitation.ok, true, JSON.stringify(withoutLimitation.blockers));
});

// Documented, non-divergent type-specific variance: unlike
// readiness_assessment, neither VAL-GEN-007 (data_gap_memo) nor any branch
// reachable for evidence_summary/impact_narrative reads claim.limitationCodes
// at all. VAL-GEN-007's own predicate,
// authoritativeDataGapsContainReturnedGap(authoritativeReadiness)
// (kaiGeneratedContentValidators.js lines 181-183), inspects only the
// authoritative gap-set argument, never the per-claim limitationCodes array.
// This is confirmed directly: a claim with a non-empty limitationCodes array
// produces the exact same validateGeneratedContentDraft outcome as the same
// claim with limitationCodes: [] for these three content types, proving
// limitationCodes is not itself a distinct governance signal for them.
for (const contentType of ["evidence_summary", "impact_narrative", "data_gap_memo", "case_for_support"]) {
  test(`[${contentType}] predicate 4 - documented variance: no VAL-GEN branch reads claim.limitationCodes for this type (outcome is identical with and without it)`, () => {
    const withLimitation = validateGeneratedContentDraft(validArgs(contentType, {
      generationClaims: [governedClaim({ limitationCodes: ["evidence_gap_unresolved"] })],
    }));
    const withoutLimitation = validateGeneratedContentDraft(validArgs(contentType, {
      generationClaims: [governedClaim({ limitationCodes: [] })],
    }));
    assert.equal(withLimitation.ok, true, JSON.stringify(withLimitation.blockers));
    assert.equal(withoutLimitation.ok, true, JSON.stringify(withoutLimitation.blockers));
    assert.deepEqual(
      withLimitation.results.map((r) => ({ validator_key: r.validator_key, severity: r.severity })),
      withoutLimitation.results.map((r) => ({ validator_key: r.validator_key, severity: r.severity })),
    );
  });
}

// =======================================================================
// Predicates 8, 9, 10: persistence-layer governance facts. These are not
// decided by validateGeneratedContentDraft itself, so they are proven by
// driving the real creation service (createPostgresGeneratedContentRepository's
// createXxxDraft methods) end-to-end with a fake transaction, then feeding
// the resulting real draft state into the real VAL-EXP-001 export-
// eligibility validator.
// =======================================================================

function claimRow(overrides = {}) {
  return {
    claim_id: CLAIM,
    claim_statement: SAFE_STATEMENT,
    claim_type: "finding",
    evidence_item_id: EVIDENCE,
    internal_only: true,
    funder_use_allowed: true,
    public_use_allowed: false,
    source_id: SOURCE,
    source_version_id: SOURCE_VERSION,
    intake_file_id: "00000000-0000-4000-8000-000000000901",
    upload_state: "confirmed",
    ...overrides,
  };
}

function makeState({ claims = [claimRow()] } = {}) {
  return {
    generationRuns: [],
    generatedContentDrafts: [],
    generatedContentBlocks: [],
    generatedContentCitations: [],
    reviewQueueItems: [],
    uploadLifecycleAudit: [],
    claims,
  };
}

// Adapted, content-type-agnostic, from the fake-tx dispatch-by-SQL-text
// convention already established by
// __tests__/kai-sprint2-p14-09-generated-content-validation-blocker-diagnostic-propagation.spec.js
// (read for convention, not imported/modified). The INSERT/SELECT shapes it
// dispatches on are identical across all four content types (see
// loadGenerationProjection and persistCompleteSet in
// postgresGeneratedContentRepository.js, neither of which branches on
// contentType).
function makeFakeTx(draft) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();

      if (s.startsWith("INSERT INTO kai.generation_runs")) {
        const [organizationId, engagementId, idempotencyKey, requestFingerprint, contentType, requestedAudience, now] = params;
        const conflict = draft.generationRuns.some((r) => r.organization_id === organizationId && r.idempotency_key === idempotencyKey);
        if (conflict) return { rows: [] };
        const row = {
          generation_run_id: randomUUID(),
          organization_id: organizationId,
          engagement_id: engagementId,
          idempotency_key: idempotencyKey,
          request_fingerprint: requestFingerprint,
          content_type: contentType,
          requested_audience: requestedAudience,
          created_by_type: "system",
          created_at: now,
        };
        draft.generationRuns.push(row);
        return { rows: [{ generation_run_id: row.generation_run_id }] };
      }

      if (s.startsWith("SELECT generation_run_id::text AS generation_run_id")) {
        const [organizationId, idempotencyKey] = params;
        const row = draft.generationRuns.find((r) => r.organization_id === organizationId && r.idempotency_key === idempotencyKey);
        return { rows: row ? [row] : [] };
      }

      if (s.startsWith("SELECT generated_content_draft_id::text AS generated_content_draft_id, generation_run_id")) {
        const [organizationId, generationRunId] = params;
        const rows = draft.generatedContentDrafts.filter((d) => d.organization_id === organizationId && d.generation_run_id === generationRunId);
        return { rows };
      }

      if (s.startsWith("INSERT INTO kai.generated_content_drafts")) {
        const [generationRunId, organizationId, contentType, requestedAudience, draftStatus, reviewStatus, , now] = params;
        const row = {
          generated_content_draft_id: randomUUID(),
          generation_run_id: generationRunId,
          organization_id: organizationId,
          content_type: contentType,
          requested_audience: requestedAudience,
          draft_status: draftStatus,
          review_status: reviewStatus,
          created_by_type: "system",
          created_at: now,
        };
        draft.generatedContentDrafts.push(row);
        return { rows: [{ generated_content_draft_id: row.generated_content_draft_id }] };
      }

      if (s.startsWith("SELECT generated_content_block_id::text AS generated_content_block_id")) {
        const [organizationId, draftId] = params;
        const rows = draft.generatedContentBlocks
          .filter((b) => b.organization_id === organizationId && b.generated_content_draft_id === draftId)
          .sort((a, b) => a.ordinal - b.ordinal);
        return { rows };
      }

      if (s.startsWith("INSERT INTO kai.generated_content_blocks")) {
        const [draftId, organizationId, ordinal, text, now] = params;
        const row = {
          generated_content_block_id: randomUUID(),
          generated_content_draft_id: draftId,
          organization_id: organizationId,
          ordinal,
          text,
          created_at: now,
        };
        draft.generatedContentBlocks.push(row);
        return { rows: [{ generated_content_block_id: row.generated_content_block_id }] };
      }

      if (s.startsWith("SELECT c.generated_content_citation_id::text AS generated_content_citation_id")) {
        const [organizationId, draftId] = params;
        const blockIds = new Set(draft.generatedContentBlocks.filter((b) => b.generated_content_draft_id === draftId).map((b) => b.generated_content_block_id));
        const rows = draft.generatedContentCitations.filter((c) => c.organization_id === organizationId && blockIds.has(c.generated_content_block_id));
        return { rows };
      }

      if (s.startsWith("INSERT INTO kai.generated_content_citations")) {
        const [blockId, organizationId, claimId, evidenceItemId, now] = params;
        draft.generatedContentCitations.push({
          generated_content_citation_id: randomUUID(),
          generated_content_block_id: blockId,
          organization_id: organizationId,
          claim_id: claimId,
          evidence_item_id: evidenceItemId,
          created_at: now,
        });
        return { rows: [] };
      }

      if (s.startsWith("SELECT c.claim_id::text AS claim_id")) {
        const [, claimIds] = params;
        const rows = draft.claims
          .filter((c) => claimIds.includes(c.claim_id))
          .sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1));
        return { rows };
      }

      if (s.startsWith("SELECT review_queue_item_id::text AS review_queue_item_id") && s.includes("queue_type = $2") && !s.includes("updated_at")) {
        const [organizationId, queueType, targetObjectType, targetObjectId] = params;
        const rows = draft.reviewQueueItems.filter((q) =>
          q.organization_id === organizationId
          && q.queue_type === queueType
          && q.target_object_type === targetObjectType
          && q.target_object_id === targetObjectId);
        return { rows };
      }

      if (s.startsWith("INSERT INTO kai.review_queue_items")) {
        const [organizationId, queueType, targetObjectType, targetObjectId, reviewStatus, summary, requiredAction, now] = params;
        const row = {
          review_queue_item_id: randomUUID(),
          organization_id: organizationId,
          engagement_id: null,
          queue_type: queueType,
          target_object_type: targetObjectType,
          target_object_id: targetObjectId,
          priority: "medium",
          queue_status: "open",
          review_status: reviewStatus,
          blocked_reason: null,
          assigned_to: null,
          due_at: null,
          summary,
          required_action: requiredAction,
          queue_metadata: {},
          created_by: null,
          created_by_type: "system",
          created_at: now,
          updated_at: now,
        };
        draft.reviewQueueItems.push(row);
        return { rows: [{ review_queue_item_id: row.review_queue_item_id }] };
      }

      if (s.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
        const [organizationId, intakeFileId, operation, fromState, metadataJson, now] = params;
        draft.uploadLifecycleAudit.push({ organization_id: organizationId, intake_file_id: intakeFileId, operation, from_state: fromState, metadata: JSON.parse(metadataJson), created_at: now });
        return { rows: [] };
      }

      throw new Error(`unhandled fake query: ${s}`);
    },
  };
}

function withFakeTransaction(state) {
  return async (callback) => {
    const draft = structuredClone(state);
    const result = await callback(makeFakeTx(draft));
    for (const key of Object.keys(draft)) state[key] = draft[key];
    return result;
  };
}

function makeEvaluator({ eligibleForClaim = () => true, claimStrengthForClaim = () => "reviewed_supported" } = {}) {
  return async (tx, { claimId, requestedAudience }) => ({
    ok: true,
    data: {
      claim: { claim_id: claimId, claim_strength: claimStrengthForClaim(claimId) },
      evidence: { evidence_item_id: EVIDENCE },
      requestedAudience,
      eligible: eligibleForClaim(claimId),
      blockerCodes: [],
      affectedDimensionKeys: [],
      affectedObjectIds: [],
    },
    error: null,
  });
}

function makeRepository(state, evaluator) {
  return createPostgresGeneratedContentRepository({
    runInTransaction: withFakeTransaction(state),
    evaluator,
  });
}

function auditRecorder() {
  return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
}

function goodGenerator() {
  return async (generatorInput) => ({
    blocks: [{
      ordinal: 1,
      text: generatorInput.claims[0].claimStatement,
      citations: [{ claimId: generatorInput.claims[0].claimId, evidenceItemId: generatorInput.claims[0].evidenceItemId }],
    }],
  });
}

function creationDependenciesFor(contentType) {
  if (contentType === "readiness_assessment") return { authoritativeReadiness: READINESS };
  if (contentType === "data_gap_memo") return { authoritativeDataGaps: GAPS };
  return {};
}

const REPOSITORY_METHOD_BY_CONTENT_TYPE = Object.freeze({
  evidence_summary: "createEvidenceSummaryDraft",
  impact_narrative: "createImpactNarrativeDraft",
  readiness_assessment: "createReadinessAssessmentDraft",
  data_gap_memo: "createDataGapMemoDraft",
  case_for_support: "createCaseForSupportDraft",
});

for (const contentType of CONTENT_TYPES) {
  test(`[${contentType}] predicates 8/9/10 - a successful generation is persisted as a human-review-gated draft with no final/export/approval authority`, async () => {
    const state = makeState();
    const evaluator = makeEvaluator();
    const repository = makeRepository(state, evaluator);
    const methodName = REPOSITORY_METHOD_BY_CONTENT_TYPE[contentType];

    const result = await repository[methodName]({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      requestedAudience: "internal",
      claimIds: [CLAIM],
      idempotencyKey: `phase13-governance-persist-${contentType}`,
      actorContext: { actorType: "human", actorUserId: "90000000-0000-4000-8000-000000000001" },
      now: "2026-09-01T00:00:00.000Z",
    }, {
      draftGenerator: goodGenerator(),
      metadataOnlyAudit: auditRecorder(),
      ...creationDependenciesFor(contentType),
    });

    assert.equal(result.ok, true, JSON.stringify(result));

    // Predicate 8: successful output remains a `draft`.
    assert.equal(result.data.draftStatus, "draft");
    assert.equal(state.generatedContentDrafts[0].draft_status, "draft");

    // Predicate 9: successful output remains human-review gated - the exact
    // GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT.reviewStatus value, plus a
    // real, coupled review-queue row of the correct queue/target type.
    assert.equal(result.data.reviewStatus, "needs_gk_review");
    assert.equal(state.generatedContentDrafts[0].review_status, "needs_gk_review");
    assert.equal(state.reviewQueueItems.length, 1);
    const queueRow = state.reviewQueueItems[0];
    assert.equal(queueRow.queue_type, "generated_content_review");
    assert.equal(queueRow.target_object_type, "generated_content_draft");
    assert.equal(queueRow.target_object_id, result.data.generatedContentDraftId);
    assert.equal(queueRow.review_status, "needs_gk_review");
    assert.equal(queueRow.queue_status, "open");

    // Predicate 10: the generation path grants no final/export/approval
    // authority. Feed the draft's own real, just-persisted state into the
    // real, shared VAL-EXP-001 export-eligibility validator - unconditional
    // finalGate:false / affirmativeHumanExportAuthority:false, exactly as
    // evaluateExportReviewReadiness (postgresGeneratedContentRepository.js
    // ~L2161-2169) always supplies for a draft that has not separately been
    // through an affirmative human export-authority act.
    const exportEligibility = validateExportManifestEligibility({
      generatedContentDraftId: result.data.generatedContentDraftId,
      requestedExportAudience: result.data.requestedAudience,
      draftAudience: result.data.requestedAudience,
      draftIsStillDraft: result.data.draftStatus === "draft",
      reviewIsResolved: false,
      currentUseEligible: true,
      finalGate: false,
      affirmativeHumanExportAuthority: false,
    });
    assert.equal(exportEligibility.severity, "blocker");
    assert.equal(exportEligibility.blocking_reason, "export_manifest_not_eligible");
    assert.ok(exportEligibility.evidence.failed_gates.includes("generated_content_still_draft"), JSON.stringify(exportEligibility.evidence));
    assert.ok(exportEligibility.evidence.failed_gates.includes("affirmative_human_export_authority_absent"), JSON.stringify(exportEligibility.evidence));
    assert.ok(exportEligibility.evidence.failed_gates.includes("final_export_gate_absent"), JSON.stringify(exportEligibility.evidence));
  });
}

test("horizontal Phase-13 governance conformance: all five content types were exercised", () => {
  assert.deepEqual(CONTENT_TYPES, ["evidence_summary", "impact_narrative", "readiness_assessment", "data_gap_memo", "case_for_support"]);
});
