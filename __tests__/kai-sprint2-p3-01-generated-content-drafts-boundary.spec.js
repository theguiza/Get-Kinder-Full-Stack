import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createEvidenceSummaryDraft } from "../Backend/kai/services/kaiGeneratedContentService.js";
import { validateGeneratedContentDraft } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
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
    requestedAudience: "internal",
    claimIds: [CLAIM],
    idempotencyKey: "p3-01-key",
    actorContext,
    now: NOW,
    ...overrides,
  };
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
    revalidatedEligible: true,
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

test("P3-01 validators VAL-GEN-001 through VAL-GEN-005 enforce eligibility, citations, unauthorized references, numeric/causal assertions, and audience authority", () => {
  assert.equal(validateGeneratedContentDraft({
    requestedAudience: "internal",
    eligibleClaims: [eligibleClaim()],
    blocks: blocks(),
  }).ok, true);
  assert.deepEqual(validateGeneratedContentDraft({
    requestedAudience: "internal",
    eligibleClaims: [eligibleClaim({ revalidatedEligible: false })],
    blocks: blocks(),
  }).blockers.map((blocker) => blocker.validator_key), ["VAL-GEN-001"]);
  assert.ok(validateGeneratedContentDraft({
    requestedAudience: "internal",
    eligibleClaims: [eligibleClaim()],
    blocks: [{ ...blocks()[0], text: "Narrative without citation.", citations: [] }],
  }).blockers.some((blocker) => blocker.validator_key === "VAL-GEN-002"));
  assert.ok(validateGeneratedContentDraft({
    requestedAudience: "internal",
    eligibleClaims: [eligibleClaim()],
    blocks: [{ ...blocks()[0], citations: [{ claimId: CLAIM, evidenceItemId: "00000000-0000-4000-8000-000000000999" }] }],
  }).blockers.some((blocker) => blocker.validator_key === "VAL-GEN-003"));
  assert.ok(validateGeneratedContentDraft({
    requestedAudience: "internal",
    eligibleClaims: [eligibleClaim({ claimStatement: "Enrollment was 12% in 2025." })],
    blocks: [{ ...blocks()[0], text: "Enrollment caused 13% growth in 2025." }],
  }).blockers.some((blocker) => blocker.validator_key === "VAL-GEN-004"));
  assert.deepEqual(validateGeneratedContentDraft({
    requestedAudience: "public",
    eligibleClaims: [eligibleClaim({ requestedAudience: "public", audienceAuthority: { internal: true, funder: false, public: false } })],
    blocks: blocks(),
    draftAudience: "public",
  }).blockers.map((blocker) => blocker.validator_key), ["VAL-GEN-005"]);
});

test("P3-01 request fingerprint is deterministic and sensitive only to content type, audience, and ordered claim ids", () => {
  assert.equal(
    fingerprintEvidenceSummaryRequest(input({ actorContext: { different: true }, idempotencyKey: "different" })),
    fingerprintEvidenceSummaryRequest(input()),
  );
  assert.notEqual(
    fingerprintEvidenceSummaryRequest(input({ requestedAudience: "public" })),
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
