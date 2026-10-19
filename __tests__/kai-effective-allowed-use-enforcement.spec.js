import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sensitivityEffectiveAllowedUseProhibition } from "../Backend/kai/dictionary/sensitivityAllowedUseDecisionContract.js";
import {
  readEffectiveAllowedUseProhibition,
  readEffectiveAllowedUseProhibitions,
  readEffectiveAllowedUseProhibitionsForClaims,
} from "../Backend/kai/dictionary/postgresEffectiveAllowedUseResolver.js";
import {
  EFFECTIVE_ALLOWED_USE_VALIDATOR_KEY,
  validateEffectiveAllowedUsePermitsOperation,
} from "../Backend/kai/validators/kaiEffectiveAllowedUseValidators.js";
import { validateEvidenceCoverageAssessmentIsPermitted } from "../Backend/kai/validators/kaiEvidenceCoverageAssessmentValidators.js";
import { createPostgresSourceCandidateRepository } from "../Backend/kai/dictionary/postgresSourceCandidateRepository.js";

/**
 * VAL-KAI-B1A-02-003: a file's effective allowed use (the current human
 * sensitivity decision combined with the committed P1-05 fact) gates every
 * content-processing operation through every entry point. Pure precedence,
 * blocker shape, resolver reads, the shared P2-02/P2-04/P2-05/P2-06 validator,
 * a P1-07 repository bypass attempt, and the wiring of each seam. The
 * assembled PostgreSQL/browser proof is
 * kai-source-to-impact-workflow-browser-acceptance.integration.spec.js.
 */

const ORG = "0e000000-0000-4000-8000-0000000000a1";
const PROFILE = "8e000000-0000-4000-8000-0000000000a1";
const PROFILE_2 = "8e000000-0000-4000-8000-0000000000a2";
const CLAIM = "ce000000-0000-4000-8000-0000000000a1";
const CLAIM_2 = "ce000000-0000-4000-8000-0000000000a2";
const NOW = "2026-10-19T12:00:00.000Z";

const reviewed = (allowedUse) => ({ decision_outcome: "reviewed", reviewed_allowed_use_status: allowedUse });

test("precedence: a reviewed not_allowed head prohibits; the P1-05 not_allowed fact is kept; unknown/allowed and non-terminal heads prohibit nothing; ambiguity fails closed", () => {
  const cases = [
    [{ profileAllowedUseStatus: "unknown", currentHead: null }, null],
    [{ profileAllowedUseStatus: "unknown", currentHead: reviewed("unknown") }, null],
    [{ profileAllowedUseStatus: "unknown", currentHead: reviewed("allowed") }, null],
    [{ profileAllowedUseStatus: "unknown", currentHead: reviewed("not_allowed") }, "reviewed_allowed_use_not_allowed"],
    [{ profileAllowedUseStatus: "allowed", currentHead: reviewed("not_allowed") }, "reviewed_allowed_use_not_allowed"],
    // A provisional machine fact never lifts a human prohibition, and a human
    // 'allowed' does not lift the retained P1-05 restriction (owner decision held).
    [{ profileAllowedUseStatus: "not_allowed", currentHead: null }, "intake_allowed_use_not_allowed"],
    [{ profileAllowedUseStatus: "not_allowed", currentHead: reviewed("allowed") }, "intake_allowed_use_not_allowed"],
    // needs_more_information carries no reviewed snapshot and states no allowed use.
    [{ profileAllowedUseStatus: "unknown", currentHead: { decision_outcome: "needs_more_information", reviewed_allowed_use_status: null } }, null],
    [{ profileAllowedUseStatus: "unknown", currentHead: reviewed("allowed"), lineageAmbiguous: true }, "sensitivity_decision_lineage_ambiguous"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(sensitivityEffectiveAllowedUseProhibition(input), expected, JSON.stringify(input));
  }
});

test("blocker: a prohibition is a structured VAL-KAI-B1A-02-003 blocker with the existing allowed_use_not_allowed reason; ambiguity is a stale-state conflict; a missing row is not_found", () => {
  assert.deepEqual(validateEffectiveAllowedUsePermitsOperation(null, { operation: "x", objectType: "y" }), { ok: true });
  for (const basis of ["reviewed_allowed_use_not_allowed", "intake_allowed_use_not_allowed"]) {
    const refused = validateEffectiveAllowedUsePermitsOperation(basis, { operation: "propose_claim", objectType: "evidence_item", objectId: CLAIM });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "validation_blocker");
    assert.deepEqual(
      [refused.blockers[0].validator_key, refused.blockers[0].blocking_reason, refused.blockers[0].object_code, refused.blockers[0].object_id, refused.blockers[0].evidence],
      [EFFECTIVE_ALLOWED_USE_VALIDATOR_KEY, "allowed_use_not_allowed", "propose_claim", CLAIM, { basis, bypass_allowed: false }],
    );
  }
  const ambiguous = validateEffectiveAllowedUsePermitsOperation("sensitivity_decision_lineage_ambiguous", { operation: "x", objectType: "y" });
  assert.deepEqual([ambiguous.code, ambiguous.blockers[0].blocking_reason], ["conflict_current_state_changed", "sensitivity_decision_lineage_ambiguous"]);
  assert.deepEqual(validateEffectiveAllowedUsePermitsOperation("sensitivity_profile_missing", { operation: "x", objectType: "y" }), { ok: false, code: "not_found", blockers: [] });
  assert.deepEqual(validateEffectiveAllowedUsePermitsOperation("claim_lineage_missing", { operation: "x", objectType: "y" }), { ok: false, code: "not_found", blockers: [] });
});

function recordingTx({ profiles = [], heads = [], claimLineage = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM kai.intake_sensitivity_review_decisions")) return { rows: heads };
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) return { rows: profiles };
      if (sql.includes("FROM kai.claims")) return { rows: claimLineage };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test("resolver: reads the P1-05 fact and only lineage heads (no successor), tenant-scoped, in two queries; missing profile and multiple heads fail closed", async () => {
  const tx = recordingTx({
    profiles: [
      { intake_sensitivity_profile_id: PROFILE, allowed_use_status: "unknown" },
      { intake_sensitivity_profile_id: PROFILE_2, allowed_use_status: "unknown" },
    ],
    heads: [
      { intake_sensitivity_profile_id: PROFILE, ...reviewed("not_allowed") },
      { intake_sensitivity_profile_id: PROFILE_2, ...reviewed("allowed") },
      { intake_sensitivity_profile_id: PROFILE_2, ...reviewed("allowed") },
    ],
  });
  const missing = "8e000000-0000-4000-8000-0000000000ff";
  const result = await readEffectiveAllowedUseProhibitions(tx, { organizationId: ORG, intakeSensitivityProfileIds: [PROFILE, PROFILE_2, missing] });
  assert.deepEqual([...result.entries()], [
    [PROFILE, "reviewed_allowed_use_not_allowed"],
    [PROFILE_2, "sensitivity_decision_lineage_ambiguous"],
    [missing, "sensitivity_profile_missing"],
  ]);
  assert.equal(tx.calls.length, 2);
  for (const { sql, params } of tx.calls) {
    assert.match(sql, /organization_id = \$1::uuid/);
    assert.equal(params[0], ORG);
  }
  assert.match(tx.calls[1].sql, /NOT EXISTS[\s\S]*supersedes_decision_id = d\.decision_id/, "only the lineage head is read");

  const clear = recordingTx({ profiles: [{ intake_sensitivity_profile_id: PROFILE, allowed_use_status: "unknown" }] });
  assert.equal(await readEffectiveAllowedUseProhibition(clear, { organizationId: ORG, intakeSensitivityProfileId: PROFILE }), null, "null (permitted) is never turned into missing");
  await assert.rejects(() => readEffectiveAllowedUseProhibitions(tx, { organizationId: "org-1", intakeSensitivityProfileIds: [PROFILE] }), TypeError);
});

test("resolver, claim form: each claim's own source version profile governs it; an unwalkable or forked lineage is missing", async () => {
  const tx = recordingTx({
    profiles: [{ intake_sensitivity_profile_id: PROFILE, allowed_use_status: "unknown" }],
    heads: [{ intake_sensitivity_profile_id: PROFILE, ...reviewed("not_allowed") }],
    claimLineage: [{ claim_id: CLAIM, intake_sensitivity_profile_id: PROFILE }],
  });
  const result = await readEffectiveAllowedUseProhibitionsForClaims(tx, { organizationId: ORG, claimIds: [CLAIM, CLAIM_2] });
  assert.deepEqual([...result.entries()], [[CLAIM, "reviewed_allowed_use_not_allowed"], [CLAIM_2, "claim_lineage_missing"]]);
  assert.match(tx.calls[0].sql, /JOIN kai\.claim_evidence_links[\s\S]*JOIN kai\.evidence_items[\s\S]*JOIN kai\.source_versions/);

  const forked = recordingTx({
    profiles: [{ intake_sensitivity_profile_id: PROFILE, allowed_use_status: "unknown" }],
    claimLineage: [{ claim_id: CLAIM, intake_sensitivity_profile_id: PROFILE }, { claim_id: CLAIM, intake_sensitivity_profile_id: PROFILE_2 }],
  });
  assert.equal((await readEffectiveAllowedUseProhibitionsForClaims(forked, { organizationId: ORG, claimIds: [CLAIM] })).get(CLAIM), "claim_lineage_missing");
});

const lineageRows = (profileOverrides = {}) => {
  const sha = "a".repeat(64);
  const ids = { source: "5e000000-0000-4000-8000-0000000000a1", version: "6e000000-0000-4000-8000-0000000000a1", candidate: "9e000000-0000-4000-8000-0000000000a1", fp: "4e000000-0000-4000-8000-0000000000a1", dd: "3e000000-0000-4000-8000-0000000000a1" };
  return {
    sourceVersionRow: { source_version_id: ids.version, source_id: ids.source, organization_id: ORG, intake_sensitivity_profile_id: PROFILE, profile_canonical_sha256: sha, is_current: true },
    sourceRow: { source_id: ids.source },
    candidateRow: { organization_id: ORG, candidate_status: "promoted", intake_sensitivity_profile_id: PROFILE, file_profile_id: ids.fp, data_dictionary_id: ids.dd, profile_canonical_sha256: sha },
    decisionRow: { decision_status: "promoted", source_id: ids.source, source_version_id: ids.version },
    profileRow: {
      organization_id: ORG, intake_sensitivity_profile_id: PROFILE, file_profile_id: ids.fp, data_dictionary_id: ids.dd, profile_canonical_sha256: sha,
      human_review_required: true, public_use_allowed: false, funder_use_allowed: false, llm_processing_allowed: false, product_learning_allowed: false,
      retention_posture: "restricted_pending_review", allowed_use_status: "unknown", ...profileOverrides,
    },
    dictionaryRow: { organization_id: ORG, file_profile_id: ids.fp, data_dictionary_id: ids.dd, profile_canonical_sha256: sha },
  };
};

test("shared P2-02/P2-04/P2-05/P2-06 permission validator honours the current human decision attached by readSensitivityProfileForAssessment", () => {
  assert.deepEqual(validateEvidenceCoverageAssessmentIsPermitted(lineageRows({ effective_allowed_use_prohibition: null })), { ok: true });
  const reviewedNotAllowed = validateEvidenceCoverageAssessmentIsPermitted(lineageRows({ effective_allowed_use_prohibition: "reviewed_allowed_use_not_allowed" }));
  assert.deepEqual([reviewedNotAllowed.ok, reviewedNotAllowed.code, reviewedNotAllowed.blockers[0].validator_key, reviewedNotAllowed.blockers[0].blocking_reason],
    [false, "validation_blocker", EFFECTIVE_ALLOWED_USE_VALIDATOR_KEY, "allowed_use_not_allowed"]);
  // The existing P1-05 refusal keeps its own key.
  const profileNotAllowed = validateEvidenceCoverageAssessmentIsPermitted(lineageRows({ allowed_use_status: "not_allowed", effective_allowed_use_prohibition: "intake_allowed_use_not_allowed" }));
  assert.equal(profileNotAllowed.blockers[0].validator_key, "VAL-KAI-P2-02-000");
  const ambiguous = validateEvidenceCoverageAssessmentIsPermitted(lineageRows({ effective_allowed_use_prohibition: "sensitivity_decision_lineage_ambiguous" }));
  assert.equal(ambiguous.code, "conflict_current_state_changed");
});

function p1_07FakeTx({ heads }) {
  const writes = [];
  const profileRow = {
    organization_id: ORG, intake_sensitivity_profile_id: PROFILE, intake_file_id: "2e000000-0000-4000-8000-0000000000a1",
    file_profile_id: "4e000000-0000-4000-8000-0000000000a1", data_dictionary_id: "3e000000-0000-4000-8000-0000000000a1",
    profile_canonical_sha256: "a".repeat(64), human_review_required: true, public_use_allowed: false, funder_use_allowed: false,
    llm_processing_allowed: false, product_learning_allowed: false, retention_posture: "restricted_pending_review", allowed_use_status: "unknown",
  };
  return {
    writes,
    async query(sql) {
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push(sql);
      if (sql.includes("FROM kai.intake_sensitivity_review_decisions")) return { rows: heads };
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) return { rows: [profileRow] };
      if (sql.includes("FROM kai.intake_files")) return { rows: [{ upload_state: "confirmed" }] };
      if (sql.includes("FROM kai.intake_source_candidates")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test("direct P1-07 entry (any caller, including a GK actor with no own-decision prerequisite): a reviewed not_allowed decision refuses the candidate with zero writes and zero audit", async () => {
  const tx = p1_07FakeTx({ heads: [{ intake_sensitivity_profile_id: PROFILE, ...reviewed("not_allowed") }] });
  let audits = 0;
  const repository = createPostgresSourceCandidateRepository({ runInTransaction: (callback) => callback(tx) });
  const result = await repository.createSourceCandidateStub({
    identity: { organizationId: ORG, intakeSensitivityProfileId: PROFILE },
    actorUserId: "user-gk",
    now: NOW,
    metadataOnlyAudit: { prepareMetadataOnlyAudit: () => { audits += 1; return { ok: true, publish: async () => {} }; } },
  });
  assert.deepEqual([result.ok, result.error.code, result.error.blockers[0].blocking_reason, result.error.blockers[0].evidence.basis],
    [false, "validation_blocker", "allowed_use_not_allowed", "reviewed_allowed_use_not_allowed"]);
  assert.deepEqual(tx.writes, []);
  assert.equal(audits, 0);
});

test("wiring: every content-processing seam reads the shared resolver inside its own transaction", () => {
  const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  for (const [path, symbol] of [
    ["Backend/kai/dictionary/postgresSourceCandidateRepository.js", "readEffectiveAllowedUseProhibition("],
    ["Backend/kai/dictionary/postgresSourcePromotionRepository.js", "readEffectiveAllowedUseProhibition("],
    ["Backend/kai/dictionary/postgresEvidenceLineageRepository.js", "readEffectiveAllowedUseProhibition("],
    ["Backend/kai/dictionary/postgresClaimProposalRepository.js", "readEffectiveAllowedUseProhibition("],
    ["Backend/kai/dictionary/postgresEvidenceCoverageAssessmentRepository.js", "readEffectiveAllowedUseProhibition("],
    ["Backend/kai/dictionary/postgresOrganizationEvidenceGapCurrentStateRepository.js", "readEffectiveAllowedUseProhibitions("],
    ["Backend/kai/dictionary/postgresGeneratedContentRepository.js", "readEffectiveAllowedUseProhibitionsForClaims("],
  ]) {
    assert.ok(source(path).includes(symbol), path);
  }
  // Generation checks allowed use before P2-06 and before the generator call.
  const generation = source("Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const check = generation.indexOf("readEffectiveAllowedUseProhibitionsForClaims(tx");
  assert.ok(check > 0 && check < generation.indexOf("const traceabilityResults = [];"));
  assert.ok(check < generation.indexOf("await dependencies.draftGenerator(generatorInput)"));
  // P1-08 refuses only the 'promoted' work; rejection stays decidable.
  const promotion = source("Backend/kai/dictionary/postgresSourcePromotionRepository.js");
  assert.ok(promotion.indexOf("readEffectiveAllowedUseProhibition(tx") > promotion.indexOf("async function performPromotionSourceWork"));
});
