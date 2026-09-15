import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveEffectivePublicAuthority } from "../Backend/kai/dictionary/postgresEffectivePublicAuthorityResolver.js";
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
    public_use_allowed: false,
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
    public_use_allowed: false,
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

// A fully-established public-use basis: allowed_use=allowed, consent present,
// indigenous governance absent (the VAL-KAI-B1A-02-002 predicate this
// resolver reuses rather than duplicates).
function baseDecisionRow(overrides = {}) {
  return {
    decision_id: "d1",
    organization_id: ORG,
    intake_sensitivity_profile_id: PROFILE,
    decision_outcome: "reviewed",
    reviewed_allowed_use_status: "allowed",
    reviewed_consent_basis_status: "present",
    reviewed_indigenous_governance_status: "absent",
    reviewed_public_use_allowed: true,
    reviewed_funder_use_allowed: false,
    reviewed_llm_processing_allowed: false,
    reviewed_product_learning_allowed: false,
    ...overrides,
  };
}

// Fake tx satisfying exactly the SQL shapes getScopedClaimById,
// getScopedClaimEvidenceLinkByClaimId, getScopedEvidenceItemById,
// getScopedSourceVersionById, and findCurrentSensitivityAllowedUseDecision
// issue (dispatch by FROM table), so resolveEffectivePublicAuthority is
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

test("B1B public resolver: fully-established basis + reviewed_public_use_allowed=true is permitted (positive case)", async () => {
  const tx = fullyWiredTx();
  const result = await resolveEffectivePublicAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, true);
  assert.equal(result.reason, null);
  assert.equal(result.intakeSensitivityProfileId, PROFILE);
});

test("B1B public resolver: reviewed_public_use_allowed=false fails closed even with an otherwise-established basis", async () => {
  const tx = fullyWiredTx({ decisions: [baseDecisionRow({ reviewed_public_use_allowed: false })] });
  const result = await resolveEffectivePublicAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, false);
  assert.equal(result.reason, "decision_not_authorizing");
});

test("B1B public resolver: reviewed_public_use_allowed=true but an invalid/missing public basis (unknown consent) fails closed", async () => {
  const tx = fullyWiredTx({
    decisions: [baseDecisionRow({ reviewed_consent_basis_status: "unknown" })],
  });
  const result = await resolveEffectivePublicAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, false);
  assert.equal(result.reason, "public_use_basis_not_established");
});

test("B1B public resolver: reviewed_public_use_allowed=true but indigenous governance status present (not absent) fails closed", async () => {
  const tx = fullyWiredTx({
    decisions: [baseDecisionRow({ reviewed_indigenous_governance_status: "present" })],
  });
  const result = await resolveEffectivePublicAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, false);
  assert.equal(result.reason, "public_use_basis_not_established");
});

test("B1B public resolver: nonterminal Phase-5 outcome (needs_more_information) fails closed", async () => {
  const tx = fullyWiredTx({ decisions: [baseDecisionRow({ decision_outcome: "needs_more_information" })] });
  const result = await resolveEffectivePublicAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, false);
  assert.equal(result.reason, "decision_nonterminal");
});

test("B1B public resolver: missing Phase-5 head fails closed", async () => {
  const tx = fullyWiredTx({ decisions: [] });
  const result = await resolveEffectivePublicAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, false);
  assert.equal(result.reason, "decision_missing");
});

test("B1B public resolver: ambiguous Phase-5 heads (two current-head rows) fail closed", async () => {
  const tx = fullyWiredTx({ decisions: [baseDecisionRow({ decision_id: "d1" }), baseDecisionRow({ decision_id: "d2" })] });
  const result = await resolveEffectivePublicAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, false);
  assert.equal(result.reason, "ambiguous_lineage");
});

test("B1B public resolver: non-current source version fails closed", async () => {
  const tx = fullyWiredTx({ sourceVersion: baseSourceVersionRow({ is_current: false }) });
  const result = await resolveEffectivePublicAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, false);
  assert.equal(result.reason, "source_version_not_current");
});

test("B1B public resolver: ambiguous/mismatched claim-evidence lineage fails closed", async () => {
  assert.equal((await resolveEffectivePublicAuthority(fakeTx({}), { organizationId: ORG, claimId: CLAIM })).permitted, false);
  assert.equal(
    (await resolveEffectivePublicAuthority(fullyWiredTx({ link: baseLinkRow({ evidence_item_id: "other" }) }), { organizationId: ORG, claimId: CLAIM })).reason,
    "evidence_link_mismatch",
  );
  assert.equal(
    (await resolveEffectivePublicAuthority(fullyWiredTx({ evidence: null }), { organizationId: ORG, claimId: CLAIM })).reason,
    "evidence_not_found",
  );
});

test("B1B public resolver: a decision belonging to a different organization (tenant mismatch) fails closed", async () => {
  const tx = fullyWiredTx({ decisions: [baseDecisionRow({ organization_id: OTHER_ORG })] });
  const result = await resolveEffectivePublicAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, false);
  assert.equal(result.reason, "tenant_mismatch");
});

test("B1B public resolver: never reads or requires legacy claims.public_use_allowed / evidence_items.public_use_allowed to permit public", async () => {
  const tx = fullyWiredTx({
    claim: baseClaimRow({ public_use_allowed: false }),
    evidence: baseEvidenceRow({ public_use_allowed: false }),
    decisions: [baseDecisionRow({ reviewed_public_use_allowed: true })],
  });
  const result = await resolveEffectivePublicAuthority(tx, { organizationId: ORG, claimId: CLAIM });
  assert.equal(result.permitted, true);
});

test("B1B public resolver: reuses sensitivityPublicUseBasisEstablished rather than duplicating its logic (no local consent/governance predicate)", () => {
  const source = readFileSync(
    new URL("../Backend/kai/dictionary/postgresEffectivePublicAuthorityResolver.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /import \{ sensitivityPublicUseBasisEstablished \} from "\.\/sensitivityAllowedUseDecisionContract\.js";/);
  assert.match(source, /sensitivityPublicUseBasisEstablished\(decision\)/);
  assert.doesNotMatch(source, /reviewed_indigenous_governance_status === "absent"/);
});

test("B1B: no migration file was added or edited for the public resolver", () => {
  const source = readFileSync(
    new URL("../Backend/kai/dictionary/postgresEffectivePublicAuthorityResolver.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bCREATE TABLE\b|\bALTER TABLE\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
});

test("B1B: P2-06 - a qualifying current review decision including 'public', with Phase-5 permitting public, approves the audience gate", async () => {
  const tx = fullyWiredTx(); // Phase-5 permits public
  const claimReviewHead = { decision_outcome: "reviewed_supported", approved_audiences: ["internal", "public"] };
  const approval = await approvalForAudience({
    requestedAudience: "public",
    organizationId: ORG,
    claimId: CLAIM,
    claimReviewHead,
    tx,
  });
  assert.deepEqual(approval, { approved: true, gateOpen: true, authorityPresent: true });
});

test("B1B: P2-06 - approved_audiences=['internal'] only leaves public ineligible even though Phase-5 permits it", async () => {
  const tx = fullyWiredTx(); // Phase-5 permits public
  const claimReviewHead = { decision_outcome: "reviewed_supported", approved_audiences: ["internal"] };
  const approval = await approvalForAudience({
    requestedAudience: "public",
    organizationId: ORG,
    claimId: CLAIM,
    claimReviewHead,
    tx,
  });
  assert.deepEqual(approval, { approved: false, gateOpen: false, authorityPresent: false });
});

test("B1B: P2-06 - a qualifying review decision alone does not approve public if Phase-5 denies it", async () => {
  const tx = fullyWiredTx({ decisions: [baseDecisionRow({ reviewed_public_use_allowed: false })] });
  const claimReviewHead = { decision_outcome: "reviewed_supported", approved_audiences: ["public"] };
  const approval = await approvalForAudience({
    requestedAudience: "public",
    organizationId: ORG,
    claimId: CLAIM,
    claimReviewHead,
    tx,
  });
  assert.deepEqual(approval, { approved: false, gateOpen: false, authorityPresent: false });
});

test("B1B: P2-06 - a nonterminal ('needs_more_information') current claim-review head never qualifies public, even with Phase-5 permitted", async () => {
  const tx = fullyWiredTx();
  const claimReviewHead = { decision_outcome: "needs_more_information", approved_audiences: ["public"] };
  const approval = await approvalForAudience({
    requestedAudience: "public",
    organizationId: ORG,
    claimId: CLAIM,
    claimReviewHead,
    tx,
  });
  assert.deepEqual(approval, { approved: false, gateOpen: false, authorityPresent: false });
});

test("B1B wiring: claim-review governance ceiling resolves public through the shared resolver, not legacy booleans", () => {
  const source = readFileSync(
    new URL("../Backend/kai/dictionary/postgresHumanReviewRepository.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /resolveEffectivePublicAuthority/);
  assert.match(
    source,
    /if \(audience === "public"\) \{\s*\n\s*const publicAuthority = await resolveEffectivePublicAuthority\(tx, \{ organizationId, claimId \}\);\s*\n\s*if \(publicAuthority\.permitted\) continue;\s*\n\s*return failure\("governance_ceiling_exceeded"\);/,
  );
  assert.doesNotMatch(source, /claimRow\.public_use_allowed === true && evidenceItemRow\.public_use_allowed === true/);
});

test("B1B wiring: P2-06 approvalForAudience adds an explicit 'public' branch that never consults legacy public_use_allowed booleans", () => {
  const source = readFileSync(
    new URL("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /resolveEffectivePublicAuthority/);
  assert.match(source, /if \(requestedAudience === "public"\) \{/);
  assert.doesNotMatch(source, /requestedAudience === "public"[\s\S]{0,400}public_use_allowed/);
});
