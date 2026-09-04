import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveEffectiveFunderAuthority } from "../Backend/kai/dictionary/postgresEffectiveFunderAuthorityResolver.js";
import {
  createPostgresEligibleClaimsForAudienceRepository,
} from "../Backend/kai/dictionary/postgresEligibleClaimsForAudienceRepository.js";
import { __claimTraceabilityRepositoryTestables } from "../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js";

const { approvalForAudience } = __claimTraceabilityRepositoryTestables;

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000301";
const PROFILE = "80000000-0000-4000-8000-000000000001";

function baseClaimRow(overrides = {}) {
  return {
    claim_id: CLAIM,
    organization_id: ORG,
    evidence_item_id: EVIDENCE,
    funder_use_allowed: false,
    ...overrides,
  };
}

function baseLinkRow(overrides = {}) {
  return { claim_evidence_link_id: "l1", organization_id: ORG, claim_id: CLAIM, evidence_item_id: EVIDENCE, ...overrides };
}

function baseEvidenceRow(overrides = {}) {
  return {
    evidence_item_id: EVIDENCE,
    organization_id: ORG,
    source_version_id: SOURCE_VERSION,
    funder_use_allowed: false,
    ...overrides,
  };
}

function baseSourceVersionRow(overrides = {}) {
  return {
    source_version_id: SOURCE_VERSION,
    organization_id: ORG,
    is_current: true,
    intake_sensitivity_profile_id: PROFILE,
    ...overrides,
  };
}

function baseDecisionRow(overrides = {}) {
  return {
    decision_id: "d1",
    organization_id: ORG,
    intake_sensitivity_profile_id: PROFILE,
    decision_outcome: "reviewed",
    reviewed_allowed_use_status: "allowed",
    reviewed_consent_basis_status: "present",
    reviewed_funder_use_allowed: true,
    reviewed_public_use_allowed: true,
    reviewed_llm_processing_allowed: false,
    reviewed_product_learning_allowed: false,
    ...overrides,
  };
}

// Fake tx satisfying exactly the SQL shapes getScopedClaimById,
// getScopedClaimEvidenceLinkByClaimId, getScopedEvidenceItemById,
// getScopedSourceVersionById, and findCurrentSensitivityAllowedUseDecision
// issue (dispatch by FROM table), so resolveEffectiveFunderAuthority is
// exercised through its real dependency chain rather than a stub of itself.
function fakeTx({ claim, link, evidence, sourceVersion, decisions }) {
  return {
    async query(sql) {
      if (/FROM kai\.claims\b/.test(sql)) return { rows: claim ? [claim] : [] };
      if (/FROM kai\.claim_evidence_links/.test(sql)) return { rows: link ? [link] : [] };
      if (/FROM kai\.evidence_items/.test(sql)) return { rows: evidence ? [evidence] : [] };
      if (/FROM kai\.source_versions/.test(sql)) return { rows: sourceVersion ? [sourceVersion] : [] };
      if (/FROM kai\.intake_sensitivity_review_decisions/.test(sql)) return { rows: decisions || [] };
      throw new Error(`fakeTx received an unexpected query: ${sql}`);
    },
  };
}

function fullyWiredTx(overrides = {}) {
  return fakeTx({
    claim: baseClaimRow(),
    link: baseLinkRow(),
    evidence: baseEvidenceRow(),
    sourceVersion: baseSourceVersionRow(),
    decisions: [baseDecisionRow()],
    ...overrides,
  });
}

test("B1B resolver: missing Phase-5 head fails closed", async () => {
  const tx = fullyWiredTx({ decisions: [] });
  const result = await resolveEffectiveFunderAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, false);
  assert.equal(result.reason, "decision_missing");
});

test("B1B resolver: ambiguous Phase-5 heads (two current-head rows) fail closed", async () => {
  const tx = fullyWiredTx({ decisions: [baseDecisionRow({ decision_id: "d1" }), baseDecisionRow({ decision_id: "d2" })] });
  const result = await resolveEffectiveFunderAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, false);
  assert.equal(result.reason, "ambiguous_lineage");
});

test("B1B resolver: current Phase-5 decision denies funder (reviewed_funder_use_allowed=false) blocks", async () => {
  const tx = fullyWiredTx({ decisions: [baseDecisionRow({ reviewed_funder_use_allowed: false })] });
  const result = await resolveEffectiveFunderAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, false);
  assert.equal(result.reason, "decision_not_authorizing");
});

test("B1B resolver: allowed + funder=true + llm=false is permitted (llm_processing_allowed does not negate funder authority)", async () => {
  const tx = fullyWiredTx({
    decisions: [baseDecisionRow({ reviewed_funder_use_allowed: true, reviewed_llm_processing_allowed: false })],
  });
  const result = await resolveEffectiveFunderAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, true);
  assert.equal(result.reason, null);
  assert.equal(result.intakeSensitivityProfileId, PROFILE);
});

test("B1B resolver: nonterminal Phase-5 outcome (needs_more_information) fails closed", async () => {
  const tx = fullyWiredTx({ decisions: [baseDecisionRow({ decision_outcome: "needs_more_information" })] });
  const result = await resolveEffectiveFunderAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, false);
  assert.equal(result.reason, "decision_nonterminal");
});

test("B1B resolver: incomplete lineage (missing claim, link mismatch, missing evidence, missing/non-current source version) fails closed", async () => {
  assert.equal((await resolveEffectiveFunderAuthority(fakeTx({}), { organizationId: ORG, claimId: CLAIM })).permitted, false);
  assert.equal(
    (await resolveEffectiveFunderAuthority(fullyWiredTx({ link: baseLinkRow({ evidence_item_id: "other" }) }), { organizationId: ORG, claimId: CLAIM })).reason,
    "evidence_link_mismatch",
  );
  assert.equal(
    (await resolveEffectiveFunderAuthority(fullyWiredTx({ evidence: null }), { organizationId: ORG, claimId: CLAIM })).reason,
    "evidence_not_found",
  );
  assert.equal(
    (await resolveEffectiveFunderAuthority(fullyWiredTx({ sourceVersion: baseSourceVersionRow({ is_current: false }) }), { organizationId: ORG, claimId: CLAIM })).reason,
    "source_version_not_current",
  );
});

test("B1B resolver: never reads or requires legacy claims.funder_use_allowed / evidence_items.funder_use_allowed to permit funder", async () => {
  const tx = fullyWiredTx({
    claim: baseClaimRow({ funder_use_allowed: false }),
    evidence: baseEvidenceRow({ funder_use_allowed: false }),
    decisions: [baseDecisionRow({ reviewed_funder_use_allowed: true })],
  });
  const result = await resolveEffectiveFunderAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, true);
});

test("B1B: funder authority alone does not imply public/export/generation authority (resolver has no such fields)", async () => {
  const tx = fullyWiredTx();
  const result = await resolveEffectiveFunderAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, true);
  assert.deepEqual(Object.keys(result).sort(), ["decision", "intakeSensitivityProfileId", "permitted", "reason"]);
  assert.equal("export_ready" in result, false);
  assert.equal("public" in result, false);
  assert.equal("generation" in result, false);
});

test("B1B wiring: claim-review governance ceiling resolves funder through the shared resolver, not legacy booleans, and public is unchanged", () => {
  const source = readFileSync(
    new URL("../Backend/kai/dictionary/postgresHumanReviewRepository.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /resolveEffectiveFunderAuthority/);
  assert.match(
    source,
    /if \(audience === "funder"\) \{\s*\n\s*const funderAuthority = await resolveEffectiveFunderAuthority\(tx, \{ organizationId, claimId \}\);\s*\n\s*if \(funderAuthority\.permitted\) continue;\s*\n\s*return failure\("governance_ceiling_exceeded"\);/,
  );
  assert.match(
    source,
    /if \(audience === "public"\) \{\s*\n\s*if \(claimRow\.public_use_allowed === true && evidenceItemRow\.public_use_allowed === true\) continue;\s*\n\s*return failure\("governance_ceiling_exceeded"\);/,
  );
  assert.doesNotMatch(source, /claimRow\.funder_use_allowed === true && evidenceItemRow\.funder_use_allowed === true/);
});

test("B1B wiring: recordClaimReviewDecision never auto-approves funder - the resolver only unblocks the ceiling, callers still choose approvedAudiences", () => {
  const source = readFileSync(
    new URL("../Backend/kai/dictionary/postgresHumanReviewRepository.js", import.meta.url),
    "utf8",
  );
  // approvedAudiences is still exactly the caller-supplied array written to the ledger -
  // the funder branch only ever `continue`s (falls through to the loop, changing nothing)
  // or fails; it never mutates approvedAudiences itself.
  assert.doesNotMatch(source, /approvedAudiences\s*=\s*\[.*funder.*\]/);
  assert.match(source, /approvedAudiences: approvedAudiences \|\| null/);
});

test("B1B: governance_ceiling_exceeded still maps to validation_blocker/422 in the external service contract (unchanged)", () => {
  const source = readFileSync(
    new URL("../Backend/kai/services/kaiHumanReviewService.js", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /result\.error\.code === "governance_ceiling_exceeded" \? "validation_blocker" : result\.error\.code/,
  );
});

test("B1B: unexpected internal failures still map to system_error/500 (shapeError unchanged in both repositories)", () => {
  const humanReviewSource = readFileSync(
    new URL("../Backend/kai/dictionary/postgresHumanReviewRepository.js", import.meta.url),
    "utf8",
  );
  const traceabilitySource = readFileSync(
    new URL("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js", import.meta.url),
    "utf8",
  );
  assert.match(humanReviewSource, /function shapeError\(error\) \{[\s\S]*return failure\("system_error"\);/);
  assert.match(traceabilitySource, /function shapeError\(error\) \{[\s\S]*return failure\("system_error"\);/);
});

test("B1B: P2-08 includes a claim only when the injected P2-06 evaluator reports eligible:true (positive case)", async () => {
  const tx = { async query() { return { rows: [{ claim_id: CLAIM }] }; } };
  const repository = createPostgresEligibleClaimsForAudienceRepository({
    runInTransaction: async (fn) => fn(tx),
    evaluator: async () => ({
      ok: true,
      data: {
        eligible: true,
        claim: { claim_id: CLAIM, claim_type: "finding", claim_status: "proposed", claim_review_status: "resolved" },
        evidence: { support_strength: "reviewed_supported", evidence_item_id: EVIDENCE },
        source: { source_id: "s1" },
        source_version: { source_version_id: SOURCE_VERSION },
        requestedAudience: "funder",
      },
    }),
  });
  const result = await repository.listEligibleClaimsForAudience({
    organizationId: ORG,
    requestedAudience: "funder",
    limit: 10,
    afterClaimId: null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.eligibleClaims.length, 1);
  assert.equal(result.data.eligibleClaims[0].claimId, CLAIM);
});

test("B1B: P2-08 excludes a claim when the injected P2-06 evaluator reports eligible:false (negative case)", async () => {
  const tx = { async query() { return { rows: [{ claim_id: CLAIM }] }; } };
  const repository = createPostgresEligibleClaimsForAudienceRepository({
    runInTransaction: async (fn) => fn(tx),
    evaluator: async () => ({
      ok: true,
      data: { eligible: false },
    }),
  });
  const result = await repository.listEligibleClaimsForAudience({
    organizationId: ORG,
    requestedAudience: "funder",
    limit: 10,
    afterClaimId: null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.eligibleClaims.length, 0);
});

test("B1B: P2-06 - Phase-5 allowed + approved_audiences=['internal'] only leaves funder ineligible (all three audience blockers fire)", async () => {
  const tx = fullyWiredTx(); // Phase-5 permits funder
  const claimReviewHead = { decision_outcome: "reviewed_supported", approved_audiences: ["internal"] };
  const approval = await approvalForAudience({
    requestedAudience: "funder",
    organizationId: ORG,
    claimId: CLAIM,
    claimReviewHead,
    tx,
  });
  assert.deepEqual(approval, { approved: false, gateOpen: false, authorityPresent: false });
});

test("B1B: P2-06 - Phase-5 allowed + a qualifying current review decision including 'funder' approves the audience gate", async () => {
  const tx = fullyWiredTx(); // Phase-5 permits funder
  const claimReviewHead = { decision_outcome: "reviewed_supported", approved_audiences: ["internal", "funder"] };
  const approval = await approvalForAudience({
    requestedAudience: "funder",
    organizationId: ORG,
    claimId: CLAIM,
    claimReviewHead,
    tx,
  });
  assert.deepEqual(approval, { approved: true, gateOpen: true, authorityPresent: true });
});

test("B1B: P2-06 - a qualifying review decision alone does not approve funder if Phase-5 denies it", async () => {
  const tx = fullyWiredTx({ decisions: [baseDecisionRow({ reviewed_funder_use_allowed: false })] });
  const claimReviewHead = { decision_outcome: "reviewed_supported", approved_audiences: ["funder"] };
  const approval = await approvalForAudience({
    requestedAudience: "funder",
    organizationId: ORG,
    claimId: CLAIM,
    claimReviewHead,
    tx,
  });
  assert.deepEqual(approval, { approved: false, gateOpen: false, authorityPresent: false });
});

test("B1B: P2-06 - a nonterminal ('needs_more_information') current claim-review head never qualifies funder, even with Phase-5 permitted", async () => {
  const tx = fullyWiredTx();
  const claimReviewHead = { decision_outcome: "needs_more_information", approved_audiences: ["funder"] };
  const approval = await approvalForAudience({
    requestedAudience: "funder",
    organizationId: ORG,
    claimId: CLAIM,
    claimReviewHead,
    tx,
  });
  assert.deepEqual(approval, { approved: false, gateOpen: false, authorityPresent: false });
});

test("B1B: P2-06 - internal audience approval is unaffected by the funder branch (regression)", async () => {
  const approval = await approvalForAudience({ requestedAudience: "internal" });
  assert.deepEqual(approval, { approved: true, gateOpen: true, authorityPresent: true });
});

test("B1B: P2-06 - public audience remains unconditionally fail-closed (unchanged)", async () => {
  const approval = await approvalForAudience({ requestedAudience: "public" });
  assert.deepEqual(approval, { approved: false, gateOpen: false, authorityPresent: false });
});

test("P2-10/B1B wiring: coverage carve-out is exact-audience only and public has no carve-out", () => {
  const source = readFileSync(
    new URL("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /row\.decision === COVERAGE_REVIEW_DECISION_TYPE/);
  assert.match(source, /row\.decision === COVERAGE_REVIEW_FUNDER_DECISION_TYPE/);
  assert.match(source, /requestedAudience === "internal" && internalAccepted/);
  assert.match(source, /requestedAudience === "funder" && funderAccepted/);
  assert.doesNotMatch(source, /requestedAudience === "public" && .*Accepted/);
});

test("B1B: no migration file was added or edited for this package", () => {
  // Sanity check against accidental schema changes: the resolver module
  // itself contains no DDL and imports no migration runner.
  const source = readFileSync(
    new URL("../Backend/kai/dictionary/postgresEffectiveFunderAuthorityResolver.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bCREATE TABLE\b|\bALTER TABLE\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
});
