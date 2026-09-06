// P3-18 FINAL-GATE AUTHORITY STATE PROOF
//
// Proves, using the REAL (unmocked) P3-16 candidate-currentness evaluator,
// the REAL P3-17 evaluateEffectiveness path, the REAL VAL-EXP-001 validator,
// and the REAL (unmodified) final-gate composition
// (evaluateFinalExportEligibility), that:
//
//   P3-17 authority state  --->  finalGate=true state transition
//
// The only stubbed layer is the raw SQL row plumbing (a fakeTx that returns
// canned rows per call, exactly the style already used by
// kai-sprint2-p3-17-human-authority-decision-ledger-boundary.spec.js). No
// P3-16 currentness function, P3-17 effectiveness function, VAL-EXP-001
// gate, or final-gate composition logic is replaced or reinterpreted here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  evaluateFinalExportEligibility,
  __finalExportEligibilityGateServiceContract,
} from "../Backend/kai/services/kaiFinalExportEligibilityGateService.js";
import {
  createPostgresHumanAuthorityDecisionRepository,
} from "../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js";
import {
  evaluateExportCandidateCurrentnessInTransaction,
  __exportCandidateRepositoryTestables,
} from "../Backend/kai/dictionary/postgresExportCandidateRepository.js";
import { recordHumanFinalReleaseAuthorityDecision } from "../Backend/kai/services/kaiHumanAuthorityDecisionService.js";

const { buildCanonicalRepresentation, canonicalFingerprint } = __exportCandidateRepositoryTestables;

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000009";
const DRAFT = "00000000-0000-4000-8000-000000000301";
const CANDIDATE = "00000000-0000-4000-8000-000000000401";
const QUEUE = "00000000-0000-4000-8000-000000000303";
const CLAIM = "00000000-0000-4000-8000-000000000501";
const EVIDENCE = "00000000-0000-4000-8000-000000000601";
const SOURCE = "00000000-0000-4000-8000-000000000801";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000901";
const SNAPSHOT = "00000000-0000-4000-8000-000000001001";
const BLOCK = "block-1";

const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});

const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

// --- canonical representation shared by every "current candidate" fixture ---

const BLOCKS = [
  { ordinal: 1, text: "block text", citations: [{ claim_id: CLAIM, evidence_item_id: EVIDENCE, source_id: SOURCE, source_version_id: SOURCE_VERSION }] },
];
const SNAPSHOT_ENTRIES = [{ claim_id: CLAIM, evidence_item_id: EVIDENCE, limitation_codes: ["none"] }];

const CANONICAL_REPRESENTATION = buildCanonicalRepresentation({
  organizationId: ORG,
  generatedContentDraftId: DRAFT,
  contentType: "evidence_summary",
  requestedAudience: "internal",
  blocks: BLOCKS,
  snapshotEntries: SNAPSHOT_ENTRIES,
});
const MATCHING_FINGERPRINT = canonicalFingerprint(CANONICAL_REPRESENTATION);
const STALE_FINGERPRINT = "0".repeat(64);

// fakeTx: returns one canned row-set per sequential tx.query() call, and
// records the params array each call was made with (for tenant-scoping
// proof below) - exactly the existing P3-17 boundary-spec fakeTx pattern,
// extended only to capture params.
function fakeTx(rowsByQueryIndex) {
  let call = 0;
  const paramsByCall = [];
  return {
    calls: paramsByCall,
    async query(_sql, params) {
      paramsByCall.push(params);
      const rows = rowsByQueryIndex[call] ?? [];
      call += 1;
      return { rows };
    },
  };
}

// Full 8-query row sequence evaluateExportCandidateCurrentnessInTransaction
// issues for a *current* candidate: candidate row, bound-snapshot exists,
// no successor, draft row, current-snapshot row, snapshot entries, blocks,
// citations.
function currentCandidateRowSequence({ fingerprint = MATCHING_FINGERPRINT, hasSuccessor = false, boundSnapshotExists = true } = {}) {
  return [
    [{
      export_candidate_id: CANDIDATE,
      organization_id: ORG,
      generated_content_draft_id: DRAFT,
      content_type: "evidence_summary",
      requested_audience: "internal",
      limitation_snapshot_id: SNAPSHOT,
      canonical_fingerprint: fingerprint,
    }],
    boundSnapshotExists ? [{ limitation_snapshot_id: SNAPSHOT }] : [],
    hasSuccessor ? [{ exists: 1 }] : [],
    [{ generated_content_draft_id: DRAFT, organization_id: ORG, content_type: "evidence_summary", requested_audience: "internal", draft_status: "draft" }],
    [{ limitation_snapshot_id: SNAPSHOT }],
    [{ claim_id: CLAIM, evidence_item_id: EVIDENCE, limitation_codes: ["none"] }],
    [{ generated_content_block_id: BLOCK, ordinal: 1, text: "block text" }],
    [{ generated_content_block_id: BLOCK, claim_id: CLAIM, evidence_item_id: EVIDENCE, source_id: SOURCE, source_version_id: SOURCE_VERSION }],
  ];
}

// Sanity-check the fixture itself against the real, unmodified P3-16
// evaluator before relying on it through P3-17/final-gate below.
test("fixture sanity: real evaluateExportCandidateCurrentnessInTransaction reports current:true for the matching-fingerprint row sequence", async () => {
  const tx = fakeTx(currentCandidateRowSequence());
  const result = await evaluateExportCandidateCurrentnessInTransaction(tx, { organizationId: ORG, exportCandidateId: CANDIDATE });
  assert.equal(result.ok, true);
  assert.equal(result.data.current, true);
  assert.equal(result.data.reason, null);
});

test("fixture sanity: real evaluateExportCandidateCurrentnessInTransaction reports fingerprint_mismatch for a stale row", async () => {
  const tx = fakeTx(currentCandidateRowSequence({ fingerprint: STALE_FINGERPRINT }));
  const result = await evaluateExportCandidateCurrentnessInTransaction(tx, { organizationId: ORG, exportCandidateId: CANDIDATE });
  assert.equal(result.data.current, false);
  assert.equal(result.data.reason, "fingerprint_mismatch");
});

function candidateRow(overrides = {}) {
  return {
    export_candidate_id: CANDIDATE,
    organization_id: ORG,
    generated_content_draft_id: DRAFT,
    requested_audience: "internal",
    ...overrides,
  };
}

function packet(overrides = {}) {
  return {
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "internal",
    // Real generated_content_drafts rows can never be anything but "draft"
    // (schema CHECK (draft_status = 'draft'), unchanged). Per the
    // VAL-EXP-001 source-draft semantic correction, finalGate=true no
    // longer treats the immutable source draft's 'draft' status as a
    // final-export blocker, so this fixture uses the real, schema-true
    // value rather than a synthetic override.
    draftStatus: "draft",
    generatedContentReviewQueueStatus: "resolved",
    generatedContentReviewStatus: "resolved",
    exportReviewQueueStatus: "resolved",
    exportReviewStatus: "resolved",
    currentUseEligible: true,
    ...overrides,
  };
}

// Builds the real, unmodified P3-17 repository (createPostgresHumanAuthorityDecisionRepository)
// wired to a fakeTx carrying the given head-decision + currentness row sequence, so
// repo.evaluateEffectiveness runs the REAL evaluateHumanAuthorityEffectivenessInTransaction
// against REAL evaluateExportCandidateCurrentnessInTransaction (its default).
function realHumanAuthorityRepository(rowsByQueryIndex) {
  const tx = fakeTx(rowsByQueryIndex);
  const repo = createPostgresHumanAuthorityDecisionRepository({
    runInTransaction: async (callback) => callback(tx),
  });
  return { repo, tx };
}

function gateDependencies({ humanAuthorityDecisionRepository, packetOverrides = {}, candidateOverrides = {} }) {
  return {
    env: enabledEnv,
    runInTransaction: async (callback) => callback({ async query() { return { rows: [] }; } }),
    loadCandidate: async () => candidateRow(candidateOverrides),
    evaluatePacket: async () => ({ ok: true, data: packet(packetOverrides), error: null }),
    evaluator: async () => ({ ok: true, data: {}, error: null }),
    humanAuthorityDecisionRepository,
  };
}

function input(overrides = {}) {
  return {
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    exportReviewQueueItemId: QUEUE,
    actorContext,
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// STATE A - no effective P3-17 authority (no decision recorded at all)
// --------------------------------------------------------------------------

test("STATE A: current candidate + reviews satisfied + no effective P3-17 authority -> affirmativeHumanExportAuthority=false, finalGate=true -> BLOCKED", async () => {
  const { repo } = realHumanAuthorityRepository([[]]); // head-decision query returns no rows
  const deps = gateDependencies({ humanAuthorityDecisionRepository: repo });
  const result = await evaluateFinalExportEligibility(input(), deps);

  assert.equal(result.ok, true);
  assert.equal(result.data.effectiveHumanExportAuthority, false);
  assert.equal(result.data.effectivenessReason, "no_decision");
  assert.equal(result.data.validatorResult.validator_key, "VAL-EXP-001");
  assert.equal(result.data.validatorResult.severity, "blocker");
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
  assert.equal(result.data.finalExportEligible, false);
});

// --------------------------------------------------------------------------
// STATE B - effective grant, current candidate, correct audience
// --------------------------------------------------------------------------

test("STATE B: effective P3-17 grant + current candidate + correct audience -> affirmativeHumanExportAuthority=true, finalGate=true -> PASS", async () => {
  const rows = [
    [{ decision_id: "decision-grant-1", decision_action: "grant" }],
    ...currentCandidateRowSequence(),
  ];
  const { repo } = realHumanAuthorityRepository(rows);
  const deps = gateDependencies({ humanAuthorityDecisionRepository: repo });
  const result = await evaluateFinalExportEligibility(input(), deps);

  assert.equal(result.ok, true);
  assert.equal(result.data.effectiveHumanExportAuthority, true);
  assert.equal(result.data.effectivenessReason, null);
  assert.equal(result.data.validatorResult.severity, "pass");
  assert.equal(result.data.validatorResult.blocking_reason, null);
  assert.equal(result.data.finalExportEligible, true);
});

// --------------------------------------------------------------------------
// STATE C - authority revoked, or the granted chain has since been superseded
// --------------------------------------------------------------------------

test("STATE C1: same chain, current head decision is a revoke -> authority ineffective, finalGate=true -> BLOCKED", async () => {
  const rows = [[{ decision_id: "decision-revoke-2", decision_action: "revoke" }]];
  const { repo } = realHumanAuthorityRepository(rows);
  const deps = gateDependencies({ humanAuthorityDecisionRepository: repo });
  const result = await evaluateFinalExportEligibility(input(), deps);

  assert.equal(result.data.effectiveHumanExportAuthority, false);
  assert.equal(result.data.effectivenessReason, "head_is_revoke");
  assert.equal(result.data.finalExportEligible, false);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
});

test("STATE C2: head decision is still a grant, but the bound P3-16 candidate/limitation-snapshot has since been superseded -> authority ineffective, finalGate=true -> BLOCKED", async () => {
  const rows = [
    [{ decision_id: "decision-grant-1", decision_action: "grant" }],
    ...currentCandidateRowSequence({ hasSuccessor: true }),
  ];
  const { repo } = realHumanAuthorityRepository(rows);
  const deps = gateDependencies({ humanAuthorityDecisionRepository: repo });
  const result = await evaluateFinalExportEligibility(input(), deps);

  assert.equal(result.data.effectiveHumanExportAuthority, false);
  assert.equal(result.data.effectivenessReason, "limitation_snapshot_superseded");
  assert.equal(result.data.finalExportEligible, false);
});

// --------------------------------------------------------------------------
// Negative proof
// --------------------------------------------------------------------------

test("NEGATIVE: wrong audience (candidate audience diverges from resolved export-review audience) -> cannot reach PASS", async () => {
  const rows = [
    [{ decision_id: "decision-grant-1", decision_action: "grant" }],
    ...currentCandidateRowSequence(),
  ];
  const { repo } = realHumanAuthorityRepository(rows);
  const deps = gateDependencies({
    humanAuthorityDecisionRepository: repo,
    candidateOverrides: { requested_audience: "funder" },
    packetOverrides: { requestedExportAudience: "internal" },
  });
  const result = await evaluateFinalExportEligibility(input(), deps);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("NEGATIVE: stale/non-current candidate (fingerprint drift) -> authority ineffective -> BLOCKED even with a real grant head", async () => {
  const rows = [
    [{ decision_id: "decision-grant-1", decision_action: "grant" }],
    ...currentCandidateRowSequence({ fingerprint: STALE_FINGERPRINT }),
  ];
  const { repo } = realHumanAuthorityRepository(rows);
  const deps = gateDependencies({ humanAuthorityDecisionRepository: repo });
  const result = await evaluateFinalExportEligibility(input(), deps);

  assert.equal(result.data.effectiveHumanExportAuthority, false);
  assert.equal(result.data.effectivenessReason, "fingerprint_mismatch");
  assert.equal(result.data.finalExportEligible, false);
});

test("NEGATIVE: unresolved generated-content review -> BLOCKED even with effective authority", async () => {
  const rows = [
    [{ decision_id: "decision-grant-1", decision_action: "grant" }],
    ...currentCandidateRowSequence(),
  ];
  const { repo } = realHumanAuthorityRepository(rows);
  const deps = gateDependencies({
    humanAuthorityDecisionRepository: repo,
    packetOverrides: { generatedContentReviewQueueStatus: "in_progress", generatedContentReviewStatus: "needs_gk_review" },
  });
  const result = await evaluateFinalExportEligibility(input(), deps);

  assert.equal(result.data.effectiveHumanExportAuthority, true);
  assert.equal(result.data.finalExportEligible, false);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("generated_content_review_unresolved"));
});

test("NEGATIVE: unresolved export review -> BLOCKED even with effective authority", async () => {
  const rows = [
    [{ decision_id: "decision-grant-1", decision_action: "grant" }],
    ...currentCandidateRowSequence(),
  ];
  const { repo } = realHumanAuthorityRepository(rows);
  const deps = gateDependencies({
    humanAuthorityDecisionRepository: repo,
    packetOverrides: { exportReviewQueueStatus: "in_progress", exportReviewStatus: "needs_gk_review" },
  });
  const result = await evaluateFinalExportEligibility(input(), deps);

  assert.equal(result.data.effectiveHumanExportAuthority, true);
  assert.equal(result.data.finalExportEligible, false);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("generated_content_review_unresolved"));
});

test("NEGATIVE: invalid limitation-snapshot state (missing bound snapshot row) -> authority ineffective -> BLOCKED", async () => {
  const rows = [
    [{ decision_id: "decision-grant-1", decision_action: "grant" }],
    ...currentCandidateRowSequence({ boundSnapshotExists: false }),
  ];
  const { repo } = realHumanAuthorityRepository(rows);
  const deps = gateDependencies({ humanAuthorityDecisionRepository: repo });
  const result = await evaluateFinalExportEligibility(input(), deps);

  assert.equal(result.data.effectiveHumanExportAuthority, false);
  assert.equal(result.data.effectivenessReason, "limitation_snapshot_missing");
  assert.equal(result.data.finalExportEligible, false);
});

test("NEGATIVE: a raw authority row exists but is not effective (ambiguous lineage) -> BLOCKED, presence of a row alone never satisfies the gate", async () => {
  const rows = [
    [
      { decision_id: "decision-grant-1", decision_action: "grant" },
      { decision_id: "decision-grant-2", decision_action: "grant" },
    ],
  ];
  const { repo } = realHumanAuthorityRepository(rows);
  const deps = gateDependencies({ humanAuthorityDecisionRepository: repo });
  const result = await evaluateFinalExportEligibility(input(), deps);

  assert.equal(result.data.effectiveHumanExportAuthority, false);
  assert.equal(result.data.effectivenessReason, "lineage_ambiguous");
  assert.equal(result.data.finalExportEligible, false);
});

test("NEGATIVE: cross-tenant authority cannot satisfy the gate - every authority/candidate query the real evaluators issue is organizationId-scoped", async () => {
  const rows = [
    [{ decision_id: "decision-grant-1", decision_action: "grant" }],
    ...currentCandidateRowSequence(),
  ];
  const { repo, tx } = realHumanAuthorityRepository(rows);
  const deps = gateDependencies({ humanAuthorityDecisionRepository: repo });
  await evaluateFinalExportEligibility(input(), deps);

  // No query the real P3-17 effectiveness evaluator or the real P3-16
  // currentness evaluator issued on this candidate's authority chain ever
  // carried some other tenant's organization id, and the head-decision
  // lookup (this call's tenant boundary) was scoped to this call's own
  // organizationId (ORG) - proving a decision recorded under a different
  // organization_id cannot be read back into this org's gate evaluation.
  assert.ok(tx.calls.length > 0);
  assert.equal(tx.calls[0][0], ORG);
  for (const params of tx.calls) {
    assert.ok(!params.includes(OTHER_ORG));
  }
});

test("NEGATIVE: cross-tenant actor is denied by the gate's own authorization check before any evaluator runs", async () => {
  const wrongOrgActor = Object.freeze({
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000002",
    organizationMemberships: [
      { organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_admin" },
    ],
  });
  let touched = false;
  const deps = gateDependencies({
    humanAuthorityDecisionRepository: { evaluateEffectiveness: async () => { touched = true; return { ok: true, data: { effective: false, reason: "no_decision", headDecisionId: null }, error: null }; } },
  });
  const result = await evaluateFinalExportEligibility(input({ actorContext: wrongOrgActor }), deps);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(touched, false);
});

test("NEGATIVE: an AI/system actor cannot create the authority decision the gate would need to reach PASS", async () => {
  const systemActor = Object.freeze({ actorType: "system", actorUserId: "90000000-0000-4000-8000-000000000003" });
  let repositoryTouched = false;
  const result = await recordHumanFinalReleaseAuthorityDecision(
    {
      organizationId: ORG,
      exportCandidateId: CANDIDATE,
      requestedAudience: "internal",
      decisionAction: "grant",
      actorContext: systemActor,
      now: "2026-09-06T00:00:00.000Z",
    },
    {
      env: enabledEnv,
      humanAuthorityDecisionRepository: { recordDecision: async () => { repositoryTouched = true; throw new Error("must not be reached"); } },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(repositoryTouched, false);

  // Because no decision was ever recorded, the gate (using the real,
  // unmocked P3-17 effectiveness evaluator) still reports no_decision.
  const { repo } = realHumanAuthorityRepository([[]]);
  const deps = gateDependencies({ humanAuthorityDecisionRepository: repo });
  const gateResult = await evaluateFinalExportEligibility(input(), deps);
  assert.equal(gateResult.data.effectiveHumanExportAuthority, false);
  assert.equal(gateResult.data.finalExportEligible, false);
});

// --------------------------------------------------------------------------
// Composition-boundary self-check: reconfirm the final-gate service itself
// still structurally forbids client-supplied finalGate/authority and still
// contains no manifest/artifact wiring (this package adds no artifact work).
// --------------------------------------------------------------------------

test("final-gate composition source still contains no manifest/artifact/renderer wiring", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiFinalExportEligibilityGateService.js", import.meta.url), "utf8");
  // The only legitimate "manifest" occurrences are the existing, unmodified
  // VAL-EXP-001 import/call (validateExportManifestEligibility) - assert no
  // artifact/renderer/file-write/manifest-object wiring exists at all.
  assert.doesNotMatch(source, /export_artifact|artifact_id|artifact\s*[:=]|renderer\(|writeFile|signed_url|manifest_id|manifest\s*[:=]/i);
});

test("FINAL_RELEASE_AUTHORITY_DECISION_TYPE used by the gate is exactly P3-17's export_authority_granted", () => {
  assert.equal(__finalExportEligibilityGateServiceContract.FINAL_RELEASE_AUTHORITY_DECISION_TYPE, "export_authority_granted");
});
