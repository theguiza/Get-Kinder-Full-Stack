import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  HUMAN_AUTHORITY_DECISION_TYPES,
  HUMAN_AUTHORITY_DECISION_ACTIONS,
  HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE,
  HUMAN_AUTHORITY_DECISION_AUDIENCE_BY_TYPE,
  isHumanAuthorityDecisionType,
  isHumanAuthorityDecisionAction,
  roleRequiredForDecisionType,
} from "../Backend/kai/dictionary/humanAuthorityDecisionContract.js";
import {
  createPostgresHumanAuthorityDecisionRepository,
  __humanAuthorityDecisionRepositoryTestables,
} from "../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const CANDIDATE = "00000000-0000-4000-8000-000000000701";

function input(overrides = {}) {
  return { organizationId: ORG, exportCandidateId: CANDIDATE, decisionType: "client_reviewed", ...overrides };
}

function fakeTx(rowsByQueryIndex) {
  let call = 0;
  return {
    async query() {
      const rows = rowsByQueryIndex[call] ?? [];
      call += 1;
      return { rows };
    },
  };
}

// --- contract vocabulary ---

test("P3-17 exact decision-type vocabulary is client_reviewed/funder_ready/public_ready/export_authority_granted", () => {
  assert.deepEqual([...HUMAN_AUTHORITY_DECISION_TYPES].sort(), [
    "client_reviewed",
    "export_authority_granted",
    "funder_ready",
    "public_ready",
  ]);
});

test("P3-17 exact decision-action vocabulary is grant/revoke", () => {
  assert.deepEqual([...HUMAN_AUTHORITY_DECISION_ACTIONS].sort(), ["grant", "revoke"]);
});

test("P3-17 decision-type/role ownership: client_reviewed -> client_reviewer, all others -> gk_admin", () => {
  assert.equal(HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE.client_reviewed, "client_reviewer");
  assert.equal(HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE.funder_ready, "gk_admin");
  assert.equal(HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE.public_ready, "gk_admin");
  assert.equal(HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE.export_authority_granted, "gk_admin");
  assert.equal(roleRequiredForDecisionType("client_reviewed"), "client_reviewer");
  assert.equal(roleRequiredForDecisionType("funder_ready"), "gk_admin");
  assert.equal(roleRequiredForDecisionType("not_a_type"), null);
});

test("P3-17 audience compatibility map only constrains funder_ready and public_ready", () => {
  assert.deepEqual(HUMAN_AUTHORITY_DECISION_AUDIENCE_BY_TYPE, { funder_ready: "funder", public_ready: "public" });
  assert.equal(Object.hasOwn(HUMAN_AUTHORITY_DECISION_AUDIENCE_BY_TYPE, "client_reviewed"), false);
  assert.equal(Object.hasOwn(HUMAN_AUTHORITY_DECISION_AUDIENCE_BY_TYPE, "export_authority_granted"), false);
});

test("P3-17 isHumanAuthorityDecisionType/isHumanAuthorityDecisionAction reject unknown values", () => {
  assert.equal(isHumanAuthorityDecisionType("funder_ready"), true);
  assert.equal(isHumanAuthorityDecisionType("final_gate"), false);
  assert.equal(isHumanAuthorityDecisionAction("grant"), true);
  assert.equal(isHumanAuthorityDecisionAction("approve"), false);
});

// --- repository input validation ---

test("P3-17 evaluate-effectiveness input validator rejects unknown keys, malformed ids, and unknown decision types", () => {
  const { isEvaluateEffectivenessInput } = __humanAuthorityDecisionRepositoryTestables;
  assert.equal(isEvaluateEffectivenessInput(input()), true);
  assert.equal(isEvaluateEffectivenessInput({ ...input(), extra: true }), false);
  assert.equal(isEvaluateEffectivenessInput(input({ organizationId: "not-a-uuid" })), false);
  assert.equal(isEvaluateEffectivenessInput(input({ decisionType: "final_gate" })), false);
});

// --- currentness helper ---

test("P3-17 isExportCandidateCurrentForAuthority delegates to the authoritative P3-16 currentness evaluator and fails closed on every non-current result, not only limitation-snapshot supersession", async () => {
  const { isExportCandidateCurrentForAuthority } = __humanAuthorityDecisionRepositoryTestables;

  const missing = await isExportCandidateCurrentForAuthority(
    {},
    { organizationId: ORG, exportCandidateId: CANDIDATE },
    async () => ({ ok: false, data: null, error: { code: "not_found", status: 404 } }),
  );
  assert.equal(missing.current, false);
  assert.equal(missing.reason, "export_candidate_missing");

  const superseded = await isExportCandidateCurrentForAuthority(
    {},
    { organizationId: ORG, exportCandidateId: CANDIDATE },
    async () => ({ ok: true, data: { current: false, reason: "limitation_snapshot_superseded" }, error: null }),
  );
  assert.equal(superseded.current, false);
  assert.equal(superseded.reason, "limitation_snapshot_superseded");

  const fingerprintMismatch = await isExportCandidateCurrentForAuthority(
    {},
    { organizationId: ORG, exportCandidateId: CANDIDATE },
    async () => ({ ok: true, data: { current: false, reason: "fingerprint_mismatch" }, error: null }),
  );
  assert.equal(fingerprintMismatch.current, false);
  assert.equal(fingerprintMismatch.reason, "fingerprint_mismatch");

  const current = await isExportCandidateCurrentForAuthority(
    {},
    { organizationId: ORG, exportCandidateId: CANDIDATE },
    async () => ({ ok: true, data: { current: true, reason: null }, error: null }),
  );
  assert.equal(current.current, true);
  assert.equal(current.reason, null);
});

test("P3-17 isExportCandidateCurrentForAuthority defaults to the real P3-16 evaluator when none is injected", async () => {
  const { isExportCandidateCurrentForAuthority } = __humanAuthorityDecisionRepositoryTestables;
  const result = await isExportCandidateCurrentForAuthority(fakeTx([[]]), { organizationId: ORG, exportCandidateId: CANDIDATE });
  assert.equal(result.current, false);
  assert.equal(result.reason, "export_candidate_missing");
});

// --- effective-authority derivation ---

test("P3-17 evaluateHumanAuthorityEffectivenessInTransaction rejects malformed input before any query", async () => {
  const { evaluateHumanAuthorityEffectivenessInTransaction } = __humanAuthorityDecisionRepositoryTestables;
  let queried = false;
  const tx = { async query() { queried = true; return { rows: [] }; } };
  const result = await evaluateHumanAuthorityEffectivenessInTransaction(tx, input({ decisionType: "final_gate" }));
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(queried, false);
});

test("P3-17 evaluateHumanAuthorityEffectivenessInTransaction reports no_decision when no head row exists", async () => {
  const { evaluateHumanAuthorityEffectivenessInTransaction } = __humanAuthorityDecisionRepositoryTestables;
  const result = await evaluateHumanAuthorityEffectivenessInTransaction(fakeTx([[]]), input());
  assert.equal(result.ok, true);
  assert.equal(result.data.effective, false);
  assert.equal(result.data.reason, "no_decision");
  assert.equal(result.data.headDecisionId, null);
});

test("P3-17 evaluateHumanAuthorityEffectivenessInTransaction fails closed on an ambiguous (multi-row) head without touching currentness", async () => {
  const { evaluateHumanAuthorityEffectivenessInTransaction } = __humanAuthorityDecisionRepositoryTestables;
  const result = await evaluateHumanAuthorityEffectivenessInTransaction(
    fakeTx([[{ decision_id: "d1", decision_action: "grant" }, { decision_id: "d2", decision_action: "grant" }]]),
    input(),
  );
  assert.equal(result.data.effective, false);
  assert.equal(result.data.reason, "lineage_ambiguous");
  assert.equal(result.data.headDecisionId, null);
});

test("P3-17 evaluateHumanAuthorityEffectivenessInTransaction reports head_is_revoke when the current head's action is revoke", async () => {
  const { evaluateHumanAuthorityEffectivenessInTransaction } = __humanAuthorityDecisionRepositoryTestables;
  const result = await evaluateHumanAuthorityEffectivenessInTransaction(
    fakeTx([[{ decision_id: "d1", decision_action: "revoke" }]]),
    input(),
  );
  assert.equal(result.data.effective, false);
  assert.equal(result.data.reason, "head_is_revoke");
  assert.equal(result.data.headDecisionId, "d1");
});

test("P3-17 evaluateHumanAuthorityEffectivenessInTransaction reports effective only when the head is a grant AND the bound candidate is still current", async () => {
  const { evaluateHumanAuthorityEffectivenessInTransaction } = __humanAuthorityDecisionRepositoryTestables;

  const staleCandidate = await evaluateHumanAuthorityEffectivenessInTransaction(
    fakeTx([[{ decision_id: "d1", decision_action: "grant" }]]),
    input(),
    async () => ({ ok: true, data: { current: false, reason: "limitation_snapshot_superseded" }, error: null }),
  );
  assert.equal(staleCandidate.data.effective, false);
  assert.equal(staleCandidate.data.reason, "limitation_snapshot_superseded");
  assert.equal(staleCandidate.data.headDecisionId, "d1");

  // A fingerprint mismatch (authoritative graph drift with the limitation
  // snapshot untouched) must fail closed exactly like a superseded snapshot -
  // this is the case a candidate-existence + snapshot-currentness-only check
  // would miss.
  const fingerprintDrifted = await evaluateHumanAuthorityEffectivenessInTransaction(
    fakeTx([[{ decision_id: "d1", decision_action: "grant" }]]),
    input(),
    async () => ({ ok: true, data: { current: false, reason: "fingerprint_mismatch" }, error: null }),
  );
  assert.equal(fingerprintDrifted.data.effective, false);
  assert.equal(fingerprintDrifted.data.reason, "fingerprint_mismatch");
  assert.equal(fingerprintDrifted.data.headDecisionId, "d1");

  const effective = await evaluateHumanAuthorityEffectivenessInTransaction(
    fakeTx([[{ decision_id: "d1", decision_action: "grant" }]]),
    input(),
    async () => ({ ok: true, data: { current: true, reason: null }, error: null }),
  );
  assert.equal(effective.ok, true);
  assert.equal(effective.data.effective, true);
  assert.equal(effective.data.reason, null);
  assert.equal(effective.data.headDecisionId, "d1");
});

// --- scope-boundary self-checks ---

test("P3-17 repository exposes only a read-only evaluator: no grant/revoke write method exists on the created repository", () => {
  const repo = createPostgresHumanAuthorityDecisionRepository({ runInTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }) });
  assert.deepEqual(Object.keys(repo), ["evaluateEffectiveness"]);
});

test("P3-17 repository source contains no route wiring and creates no finalGate/manifest/export-eligible state", () => {
  const source = readFileSync(new URL("../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /express|router|req\.|res\./);
  assert.doesNotMatch(source, /finalGate\s*[:=]|exportEligible\s*[:=]|manifest\s*[:=]/i);
});

test("P3-17 contract source declares no grant/revoke route, service, or UI wiring", () => {
  const source = readFileSync(new URL("../Backend/kai/dictionary/humanAuthorityDecisionContract.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /express|router|req\.|res\./);
});
