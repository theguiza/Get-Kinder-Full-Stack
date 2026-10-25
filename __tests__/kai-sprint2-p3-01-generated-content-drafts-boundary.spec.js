import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createEvidenceSummaryDraft } from "../Backend/kai/services/kaiGeneratedContentService.js";
import {
  __generatedContentValidatorContract,
  qualifyIneligibleClaimBlocks,
  validateGeneratedContentDraft,
} from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { __claimTraceabilityRepositoryContract } from "../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js";
import {
  __generatedContentRepositoryTestables,
  fingerprintEvidenceSummaryRequest,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import {
  __evidenceSummaryDraftGeneratorContract,
  createProductionEvidenceSummaryDraftGenerator,
} from "../Backend/kai/services/kaiEvidenceSummaryDraftGenerator.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000501";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const NOW = "2026-08-06T10:00:00.000Z";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

function input(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    requestedAudience: "internal",
    claimIds: [CLAIM],
    idempotencyKey: "p3-01-key",
    actorContext,
    now: NOW,
    ...overrides,
  };
}

async function stubGetEngagementForOrganization({ organizationId, engagementId }) {
  if (organizationId === ORG && engagementId === ENGAGEMENT) {
    return { engagement_id: ENGAGEMENT, organization_id: ORG };
  }
  return null;
}

function eligibleClaim(overrides = {}) {
  return {
    claimId: CLAIM,
    claimStatement: "Enrollment increased by 12% in 2025.",
    claimType: "finding",
    evidenceItemId: EVIDENCE,
    sourceId: "00000000-0000-4000-8000-000000000301",
    sourceVersionId: "00000000-0000-4000-8000-000000000401",
    requestedAudience: "internal",
    limitationCodes: [],
    revalidatedForGeneration: true,
    audienceAuthority: { internal: true, funder: false, public: false },
    ...overrides,
  };
}

function blocks(overrides = {}) {
  return [
    {
      ordinal: 1,
      text: "Enrollment increased by 12% in 2025.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
      ...overrides,
    },
  ];
}

test("P3-01 service gates: disabled, generation-disabled, malformed, unauthorized, and wrong-tenant calls do not call repository or generator", async () => {
  let repositoryCalls = 0;
  let generatorCalls = 0;
  const repository = {
    async createEvidenceSummaryDraft() {
      repositoryCalls += 1;
      throw new Error("must not call");
    },
  };
  const deps = {
    generatedContentRepository: repository,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    draftGenerator() {
      generatorCalls += 1;
      throw new Error("must not call");
    },
    metadataOnlyAudit: {},
  };
  assert.equal((await createEvidenceSummaryDraft(input(), { ...deps, env: {} })).error.code, "feature_disabled");
  assert.equal((await createEvidenceSummaryDraft(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "true" } })).error.code, "feature_disabled");
  assert.equal((await createEvidenceSummaryDraft({ ...input(), extra: true }, { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal((await createEvidenceSummaryDraft(input({ idempotencyKey: " short " }), { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal((await createEvidenceSummaryDraft(input({ claimIds: [CLAIM, CLAIM] }), { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal((await createEvidenceSummaryDraft(input({ actorContext: { actorType: "system", actorUserId: actorContext.actorUserId } }), { ...deps, env: enabledEnv })).error.code, "authorization_denied");
  assert.equal((await createEvidenceSummaryDraft(input({ organizationId: OTHER_ORG }), { ...deps, env: enabledEnv })).error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);
  assert.equal(generatorCalls, 0);
});

test("P3-01 service lazy-loads the database-capable repository only after all gates", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiGeneratedContentService.js", import.meta.url), "utf8");
  const topLevelImports = source.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/postgresGeneratedContentRepository|kaiDb|pg/.test(line)));
  assert.match(source, /await import\(\s*"\.\.\/dictionary\/postgresGeneratedContentRepository\.js"/);
});

test("P3-01 generator input and output contracts reject unknown keys, bad ordinals, duplicate citations, and oversized text", () => {
  const { validateGeneratorInput, validateGeneratorResult } = __generatedContentRepositoryTestables;
  assert.equal(validateGeneratorInput({
    contentType: "evidence_summary",
    requestedAudience: "internal",
    claims: [{
      claimId: CLAIM,
      claimStatement: "A claim.",
      claimType: "finding",
      evidenceItemId: EVIDENCE,
      sourceId: "00000000-0000-4000-8000-000000000301",
      sourceVersionId: "00000000-0000-4000-8000-000000000401",
      limitationCodes: [],
    }],
  }), true);
  assert.equal(validateGeneratorInput({
    contentType: "evidence_summary",
    requestedAudience: "internal",
    claims: [],
    extra: true,
  }), false);
  assert.equal(validateGeneratorResult({ blocks: blocks() }), true);
  assert.equal(validateGeneratorResult({ blocks: [{ ...blocks()[0], extra: true }] }), false);
  assert.equal(validateGeneratorResult({ blocks: [{ ...blocks()[0], ordinal: 2 }] }), false);
  assert.equal(validateGeneratorResult({ blocks: [{ ...blocks()[0], citations: [blocks()[0].citations[0], blocks()[0].citations[0]] }] }), false);
  assert.equal(validateGeneratorResult({ blocks: [{ ...blocks()[0], text: "x".repeat(4001) }] }), false);
});

test("P3-01 validators VAL-GEN-001 through VAL-GEN-005 enforce generation revalidation, citations, unauthorized references, numeric/causal assertions, and audience authority", () => {
  assert.equal(validateGeneratedContentDraft({
    requestedAudience: "internal",
    generationClaims: [eligibleClaim()],
    blocks: blocks(),
  }).ok, true);
  assert.deepEqual(validateGeneratedContentDraft({
    requestedAudience: "internal",
    generationClaims: [eligibleClaim({ revalidatedForGeneration: false })],
    blocks: blocks(),
  }).blockers.map((blocker) => blocker.validator_key), ["VAL-GEN-001"]);
  assert.ok(validateGeneratedContentDraft({
    requestedAudience: "internal",
    generationClaims: [eligibleClaim()],
    blocks: [{ ...blocks()[0], text: "Narrative without citation.", citations: [] }],
  }).blockers.some((blocker) => blocker.validator_key === "VAL-GEN-002"));
  assert.ok(validateGeneratedContentDraft({
    requestedAudience: "internal",
    generationClaims: [eligibleClaim()],
    blocks: [{ ...blocks()[0], citations: [{ claimId: CLAIM, evidenceItemId: "00000000-0000-4000-8000-000000000999" }] }],
  }).blockers.some((blocker) => blocker.validator_key === "VAL-GEN-003"));
  assert.ok(validateGeneratedContentDraft({
    requestedAudience: "internal",
    generationClaims: [eligibleClaim({ claimStatement: "Enrollment was 12% in 2025." })],
    blocks: [{ ...blocks()[0], text: "Enrollment caused 13% growth in 2025." }],
  }).blockers.some((blocker) => blocker.validator_key === "VAL-GEN-004"));
  assert.deepEqual(validateGeneratedContentDraft({
    requestedAudience: "public",
    generationClaims: [eligibleClaim({ requestedAudience: "public", audienceAuthority: { internal: true, funder: false, public: false } })],
    blocks: blocks(),
    draftAudience: "public",
  }).blockers.map((blocker) => blocker.validator_key), ["VAL-GEN-005"]);

  // Package 14-05: a governed claim's current audience/use eligibility being
  // currentEligible remains a separate fact from traceability, and internal
  // drafting remains possible when the output labels itself provisional and
  // discloses the current limitation.
  const qualifiedIneligible = validateGeneratedContentDraft({
    requestedAudience: "internal",
    generationClaims: [eligibleClaim({ currentEligible: false, limitationCodes: ["evidence_gap_unresolved"] })],
    blocks: [{
      ...blocks()[0],
      text: "Provisional internal draft: evidence gaps remain unresolved.",
    }],
  });
  assert.equal(qualifiedIneligible.ok, true, JSON.stringify(qualifiedIneligible.blockers));
});

test("VAL-GEN-009 repair: every server-authored limitation statement satisfies its own VAL-GEN-009 pattern and no other generated-content rule", () => {
  const { CURRENT_LIMITATION_DISCLOSURE, NUMERIC_LITERAL_PATTERN, CAUSAL_PATTERN } = __generatedContentValidatorContract;
  assert.deepEqual(Object.keys(CURRENT_LIMITATION_DISCLOSURE).sort(), [...__claimTraceabilityRepositoryContract.BLOCKER_ORDER, "claim_review_missing", "evidence_gap_unresolved"].sort());
  for (const audience of ["internal", "funder", "public"]) {
    for (const [code, { pattern, statement }] of Object.entries(CURRENT_LIMITATION_DISCLOSURE)) {
      const text = statement(audience);
      assert.match(text, pattern, code);
      assert.equal(text.match(NUMERIC_LITERAL_PATTERN), null, code);
      assert.equal(text.match(CAUSAL_PATTERN), null, code);
    }
  }
});

test("VAL-GEN-009 repair: undisclosed provider prose for ineligible claims is qualified by the server, eligible blocks are untouched, and missing limitations fail closed", () => {
  const SECOND_CLAIM = "00000000-0000-4000-8000-000000000102";
  const SECOND_EVIDENCE = "00000000-0000-4000-8000-000000000202";
  const ineligible = eligibleClaim({ currentEligible: false, limitationCodes: ["claim_review_unresolved", "coverage_dimension_unresolved"] });
  const secondIneligible = eligibleClaim({
    claimId: SECOND_CLAIM,
    evidenceItemId: SECOND_EVIDENCE,
    claimStatement: "Volunteers logged program hours.",
    currentEligible: false,
    limitationCodes: ["claim_review_unresolved", "client_followup_unresolved", "claim_not_approved_for_requested_audience"],
  });
  const eligible = eligibleClaim({ claimId: SECOND_CLAIM, evidenceItemId: SECOND_EVIDENCE, claimStatement: "Volunteers logged program hours.", currentEligible: true });
  const providerBlocks = [
    { ordinal: 1, text: "Enrollment increased by 12% in 2025. Volunteers logged program hours.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }, { claimId: SECOND_CLAIM, evidenceItemId: SECOND_EVIDENCE }] },
  ];

  // The unqualified provider output is exactly what production rejected.
  const unqualified = validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: [ineligible, secondIneligible], blocks: providerBlocks });
  assert.deepEqual(unqualified.blockers.map((blocker) => blocker.validator_key), ["VAL-GEN-009"]);

  const multi = qualifyIneligibleClaimBlocks({ requestedAudience: "internal", generationClaims: [ineligible, secondIneligible], blocks: providerBlocks });
  assert.equal(multi.ok, true);
  assert.equal(
    multi.blocks[0].text,
    "Provisional internal draft: Claim review is unresolved. A coverage dimension is unresolved. A client follow-up is unanswered. The claim is not approved for the internal audience. Enrollment increased by 12% in 2025. Volunteers logged program hours.",
  );
  assert.deepEqual(multi.blocks[0].citations, providerBlocks[0].citations);
  const validated = validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: [ineligible, secondIneligible], blocks: multi.blocks });
  assert.equal(validated.ok, true, JSON.stringify(validated.blockers));

  // Only blocks citing an ineligible claim change; eligible-only blocks are
  // returned as the same object.
  const mixedBlocks = [
    { ordinal: 1, text: "Volunteers logged program hours.", citations: [{ claimId: SECOND_CLAIM, evidenceItemId: SECOND_EVIDENCE }] },
    { ordinal: 2, text: "Enrollment increased by 12% in 2025.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] },
  ];
  const mixed = qualifyIneligibleClaimBlocks({ requestedAudience: "internal", generationClaims: [ineligible, eligible], blocks: mixedBlocks });
  assert.equal(mixed.blocks[0], mixedBlocks[0]);
  assert.equal(mixed.blocks[1].text, "Provisional internal draft: Claim review is unresolved. A coverage dimension is unresolved. Enrollment increased by 12% in 2025.");
  const allEligible = qualifyIneligibleClaimBlocks({ requestedAudience: "internal", generationClaims: [eligibleClaim({ currentEligible: true })], blocks: blocks() });
  assert.deepEqual(allEligible.blocks, blocks());

  // A provider-written designation is replaced, not repeated.
  const relabelled = qualifyIneligibleClaimBlocks({
    requestedAudience: "internal",
    generationClaims: [ineligible],
    blocks: blocks({ text: "Provisional internal draft — Enrollment increased by 12% in 2025." }),
  });
  assert.equal(relabelled.blocks[0].text, "Provisional internal draft: Claim review is unresolved. A coverage dimension is unresolved. Enrollment increased by 12% in 2025.");

  // No authoritative limitation to disclose: fail closed, qualify nothing.
  assert.deepEqual(
    qualifyIneligibleClaimBlocks({ requestedAudience: "internal", generationClaims: [eligibleClaim({ currentEligible: false, limitationCodes: [] })], blocks: blocks() }),
    { ok: false, reason: "ineligible_claim_limitations_unavailable" },
  );
  assert.deepEqual(
    qualifyIneligibleClaimBlocks({ requestedAudience: "internal", generationClaims: [eligibleClaim({ currentEligible: false, limitationCodes: ["unknown_limitation"] })], blocks: blocks() }),
    { ok: false, reason: "ineligible_claim_limitation_not_disclosable" },
  );

  // The designation never masks an unsupported body assertion: the provider
  // body is still blocked by VAL-GEN-004 after qualification.
  const unsupported = qualifyIneligibleClaimBlocks({
    requestedAudience: "internal",
    generationClaims: [ineligible],
    blocks: blocks({ text: "Enrollment caused 13% growth in 2025." }),
  });
  assert.deepEqual(
    validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: [ineligible], blocks: unsupported.blocks }).blockers.map((blocker) => blocker.validator_key),
    ["VAL-GEN-004"],
  );
});

test("P3-01 request fingerprint is deterministic and sensitive only to content type, audience, ordered claim ids, and engagement", () => {
  assert.equal(
    fingerprintEvidenceSummaryRequest(input({ actorContext: { different: true }, idempotencyKey: "different" })),
    fingerprintEvidenceSummaryRequest(input()),
  );
  assert.notEqual(
    fingerprintEvidenceSummaryRequest(input({ requestedAudience: "public" })),
    fingerprintEvidenceSummaryRequest(input()),
  );
  assert.notEqual(
    fingerprintEvidenceSummaryRequest(input({ engagementId: "00000000-0000-4000-8000-000000000502" })),
    fingerprintEvidenceSummaryRequest(input()),
  );
});

test("P3-01 production draft-generator adapter sends only the governed projection and normalizes provider JSON into the draftGenerator contract", async () => {
  const calls = [];
  const generator = createProductionEvidenceSummaryDraftGenerator({
    async createMessage(payload) {
      calls.push(payload);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            blocks: [{
              text: "Enrollment increased by 12% in 2025.",
              citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE, ignored: "drop" }],
              ignored: "drop",
            }],
          }),
        }],
      };
    },
  });

  const result = await generator({
    contentType: "evidence_summary",
    requestedAudience: "internal",
    claims: [{
      claimId: CLAIM,
      claimStatement: "Enrollment increased by 12% in 2025.",
      claimType: "finding",
      evidenceItemId: EVIDENCE,
      sourceId: "00000000-0000-4000-8000-000000000301",
      sourceVersionId: "00000000-0000-4000-8000-000000000401",
      limitationCodes: [],
    }],
  });

  assert.deepEqual(result, {
    blocks: [{
      ordinal: 1,
      text: "Enrollment increased by 12% in 2025.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(__generatedContentRepositoryTestables.validateGeneratorResult(result), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, __evidenceSummaryDraftGeneratorContract.MODEL);
  assert.equal(calls[0].tools, undefined);
  assert.equal(JSON.stringify(calls[0]).includes("prompt"), false);
  assert.equal(JSON.stringify(calls[0]).includes("signed_url"), false);
  assert.equal(JSON.stringify(calls[0]).includes("raw_content"), false);
  assert.equal(JSON.stringify(calls[0]).includes("file bytes"), false);
});
