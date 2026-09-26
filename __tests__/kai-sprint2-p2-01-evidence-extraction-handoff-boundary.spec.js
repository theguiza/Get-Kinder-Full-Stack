import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { submitSourceCandidateDecision } from "../Backend/kai/services/kaiReviewCockpitService.js";
import { extractEvidenceFromSourceVersion } from "../Backend/kai/services/kaiEvidenceLineageService.js";
import { createSourcePromotionDecision } from "../Backend/kai/services/kaiSourcePromotionService.js";

/**
 * KAI P1-08 -> P2-01 handoff boundary: the Review Cockpit's human source-decision
 * seam reaches the existing P2-01 extractEvidenceFromSourceVersion only after a
 * committed 'promoted' decision, for the exact source_version that decision is
 * bound to, as the same authenticated human actor, and never reaches evidence
 * review or anything further downstream. Every collaborator is an injected
 * double; no database.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const CANDIDATE = "50000000-0000-4000-8000-000000000001";
const OTHER_CANDIDATE = "50000000-0000-4000-8000-000000000002";
const CANDIDATE_QUEUE_ITEM = "70000000-0000-4000-8000-000000000002";
const DECISION = "60000000-0000-4000-8000-000000000001";
const SOURCE = "a0000000-0000-4000-8000-000000000001";
const SOURCE_VERSION = "b0000000-0000-4000-8000-000000000001";
const OTHER_SOURCE_VERSION = "b0000000-0000-4000-8000-000000000002";
const INTAKE_FILE = "20000000-0000-4000-8000-000000000001";
const FILE_PROFILE = "30000000-0000-4000-8000-000000000001";
const DICTIONARY = "40000000-0000-4000-8000-000000000001";
const PROFILE = "80000000-0000-4000-8000-000000000001";
const EVIDENCE = ["c0000000-0000-4000-8000-000000000001", "c0000000-0000-4000-8000-000000000002"];
const EVIDENCE_QUEUE = ["d0000000-0000-4000-8000-000000000001", "d0000000-0000-4000-8000-000000000002"];
const REVIEWER = "90000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);
const NOW = "2026-09-26T10:05:00.000Z";
const ENV = { KAI_SPRINT2_ENABLED: "true" };
const STATEMENT_SENTINEL = "raw-evidence-statement-sentinel";

function gkActor(role = "gk_reviewer", organizationId = ORG) {
  return {
    actorType: "human",
    actorUserId: REVIEWER,
    kaiRoles: [role],
    organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: role }],
  };
}
const reviewerActor = Object.freeze(gkActor());

function promotionResult(outcome, { replayed = false, sourceVersionOverrides = {}, decisionOverrides = {} } = {}) {
  const promoted = outcome === "promoted";
  return {
    ok: true,
    data: {
      promotionDecision: {
        intake_promotion_decision_id: DECISION,
        organization_id: ORG,
        intake_source_candidate_id: CANDIDATE,
        review_queue_item_id: CANDIDATE_QUEUE_ITEM,
        reviewed_source_type: promoted ? "organization_primary_record" : null,
        decision_status: outcome,
        source_id: promoted ? SOURCE : null,
        source_version_id: promoted ? SOURCE_VERSION : null,
        created_at: NOW,
        decided_at: NOW,
        promoted_at: promoted ? NOW : null,
        ...decisionOverrides,
      },
      sourceCandidate: {
        intake_source_candidate_id: CANDIDATE,
        organization_id: ORG,
        intake_file_id: INTAKE_FILE,
        file_profile_id: FILE_PROFILE,
        data_dictionary_id: DICTIONARY,
        intake_sensitivity_profile_id: PROFILE,
        profile_canonical_sha256: SHA,
        proposed_source_type: "organization_primary_record",
        candidate_status: promoted ? "promoted" : outcome === "rejected" ? "rejected" : "needs_gk_review",
        created_at: NOW,
      },
      reviewQueueItem: {
        review_queue_item_id: CANDIDATE_QUEUE_ITEM,
        organization_id: ORG,
        queue_type: "source_candidate_review",
        target_object_type: "intake_source_candidate",
        target_object_id: CANDIDATE,
        queue_status: outcome === "needs_more_information" ? "waiting_on_client" : "resolved",
        review_status: null,
      },
      source: promoted
        ? { source_id: SOURCE, organization_id: ORG, source_code: SHA, reviewed_source_type: "organization_primary_record", created_at: NOW }
        : null,
      sourceVersion: promoted
        ? {
          source_version_id: SOURCE_VERSION,
          organization_id: ORG,
          source_id: SOURCE,
          intake_source_candidate_id: CANDIDATE,
          intake_sensitivity_profile_id: PROFILE,
          profile_canonical_sha256: SHA,
          is_current: true,
          created_at: NOW,
          ...sourceVersionOverrides,
        }
        : null,
      replayed,
    },
    error: null,
  };
}

function promotionDouble(result) {
  const calls = [];
  return {
    calls,
    async createSourcePromotionDecision(input, injected) {
      calls.push({ input, injected });
      return typeof result === "function" ? result() : result;
    },
  };
}

function extractionResult({ replayed = false, organizationId = ORG, sourceVersionId = SOURCE_VERSION, count = 2 } = {}) {
  return {
    ok: true,
    data: {
      sourceVersion: { source_version_id: sourceVersionId, organization_id: organizationId, is_current: true },
      source: { source_id: SOURCE, organization_id: organizationId },
      evidenceItems: EVIDENCE.slice(0, count).map((id) => ({
        evidence_item_id: id,
        organization_id: organizationId,
        source_id: SOURCE,
        source_version_id: sourceVersionId,
        evidence_type: "dictionary_field_presence_fact",
        statement: STATEMENT_SENTINEL,
        evidence_review_status: "needs_gk_review",
        support_strength: "unassessed",
      })),
      sourceLocators: [],
      reviewQueueItems: EVIDENCE_QUEUE.slice(0, count).map((id, index) => ({
        review_queue_item_id: id,
        organization_id: organizationId,
        queue_type: "evidence_review",
        target_object_type: "evidence_item",
        target_object_id: EVIDENCE[index],
        queue_status: "open",
        review_status: "needs_gk_review",
        summary: "New evidence item requires GK review.",
      })),
      replayed,
    },
    error: null,
  };
}

function extractionDouble(result = extractionResult()) {
  const calls = [];
  return {
    calls,
    async extractEvidenceFromSourceVersion(input, injected) {
      calls.push({ input, injected });
      if (typeof result === "function") return result();
      return result;
    },
  };
}

const noAudit = () => ({ prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) });

function dependencies(promotion, extraction, overrides = {}) {
  return {
    env: ENV,
    now: () => Date.parse(NOW),
    metadataOnlyAudit: noAudit(),
    evidenceExtractionMetadataOnlyAudit: noAudit(),
    createSourcePromotionDecision: promotion.createSourcePromotionDecision,
    extractEvidenceFromSourceVersion: extraction.extractEvidenceFromSourceVersion,
    ...overrides,
  };
}

function decisionRequest(outcome, overrides = {}) {
  return {
    organizationId: ORG,
    intakeSourceCandidateId: CANDIDATE,
    actorContext: reviewerActor,
    payload: outcome === "promoted" ? { outcome, reviewed_source_type: "organization_primary_record" } : { outcome },
    ...overrides,
  };
}

test("A: a committed 'promoted' decision invokes extractEvidenceFromSourceVersion exactly once, for the decision's exact source_version, as the same human actor", async () => {
  const promotion = promotionDouble(promotionResult("promoted"));
  const extraction = extractionDouble();
  const result = await submitSourceCandidateDecision(decisionRequest("promoted"), dependencies(promotion, extraction));

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(promotion.calls.length, 1, "P1-08 called once");
  assert.equal(result.data.promotion_decision.decision_status, "promoted");
  assert.equal(result.data.source.source_id, SOURCE);
  assert.equal(result.data.source_version.source_version_id, SOURCE_VERSION);
  assert.equal(extraction.calls.length, 1, "P2-01 called once");

  const { input, injected } = extraction.calls[0];
  // Exactly the P2-01 service's own input allowlist.
  assert.deepEqual(Object.keys(input).sort(), ["actorContext", "now", "organizationId", "sourceVersionId"]);
  assert.equal(input.organizationId, ORG);
  assert.equal(input.sourceVersionId, SOURCE_VERSION);
  assert.equal(input.actorContext, reviewerActor, "the same authenticated human actor object is forwarded");
  assert.equal(input.actorContext, promotion.calls[0].input.actorContext);
  assert.equal(input.now, NOW);
  assert.equal(input.now, promotion.calls[0].input.now);
  assert.equal(injected.env, ENV);
  assert.equal(typeof injected.metadataOnlyAudit.prepareMetadataOnlyAudit, "function");

  assert.deepEqual(result.data.evidence_extraction_handoff, {
    status: "created",
    source_version_id: SOURCE_VERSION,
    evidence_item_count: 2,
    review_queue_item_count: 2,
    error_code: null,
  });
  // Ids and counts only: no evidence statement, queue summary, or evidence id.
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(STATEMENT_SENTINEL));
  assert.ok(!serialized.includes("New evidence item requires GK review."));
  for (const id of [...EVIDENCE, ...EVIDENCE_QUEUE]) assert.ok(!serialized.includes(id));
});

test("A: the default runtime path composes the production source-version audit adapter the P2-01 route composes", async () => {
  const promotion = promotionDouble(promotionResult("promoted"));
  const extraction = extractionDouble();
  const deps = dependencies(promotion, extraction);
  delete deps.evidenceExtractionMetadataOnlyAudit;
  await submitSourceCandidateDecision(decisionRequest("promoted"), deps);
  assert.equal(extraction.calls.length, 1);
  const composed = extraction.calls[0].injected.metadataOnlyAudit;
  assert.notEqual(composed, deps.metadataOnlyAudit, "never the P1-08 audit double");
  const prepared = composed.prepareMetadataOnlyAudit({ payload: { attempted_operation: "evidence_lineage_extracted", validator_key: "VAL-KAI-P2-01-001" } });
  assert.equal(prepared.ok, true);
  assert.equal(typeof prepared.publish, "function");

  const serviceSource = readFileSync(new URL("../Backend/kai/services/kaiReviewCockpitService.js", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("../Backend/kai/routes/sprint2IntakeApi.js", import.meta.url), "utf8");
  const handoffBody = serviceSource.match(/async function ensureEvidenceAfterPromotedDecision\([\s\S]*?\n}\n/)?.[0];
  assert.ok(handoffBody);
  assert.match(handoffBody, /createProductionMetadataOnlyAuditForSourceVersion\(\{\s*organizationId,\s*sourceVersionId,\s*actorContext,\s*now,\s*\}\)/);
  assert.match(routeSource, /metadataOnlyAudit: createProductionMetadataOnlyAuditForSourceVersion\(\{/);
  // No SQL, no repository/pool import, no HTTP call, no P2-12 or claim seam.
  assert.doesNotMatch(handoffBody, /\bSELECT\b|\bINSERT\b|\bUPDATE\b|fetch\(|evidence-extraction|recordEvidenceReviewDecision|proposeClaim/);
});

test("B: needs_more_information and rejected decisions never invoke P2-01", async () => {
  for (const outcome of ["needs_more_information", "rejected"]) {
    for (const replayed of [false, true]) {
      const extraction = extractionDouble();
      const result = await submitSourceCandidateDecision(
        decisionRequest(outcome),
        dependencies(promotionDouble(promotionResult(outcome, { replayed })), extraction),
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(extraction.calls.length, 0, `${outcome} replayed=${replayed}`);
      assert.deepEqual(result.data.evidence_extraction_handoff, {
        status: "not_applicable",
        source_version_id: null,
        evidence_item_count: null,
        review_queue_item_count: null,
        error_code: null,
      });
    }
  }
});

test("C: extraction is never invoked after an authorization, tenant, validator, or write failure of the P1-08 decision", async () => {
  const cases = [
    ["P1-08 authorization refusal", { ok: false, data: null, error: { code: "tenant_boundary_violation", status: 403 } }],
    ["P1-08 validator refusal", { ok: false, data: { exact_verification_phase: "candidate_review_incomplete" }, error: { code: "validation_blocker", status: 422 } }],
    ["P1-08 conflict", { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } }],
    ["P1-08 failed write", { ok: false, data: null, error: { code: "system_error", status: 500 } }],
    ["P1-08 malformed success", { ok: true, data: { promotionDecision: null }, error: null }],
  ];
  for (const [label, promotionOutcome] of cases) {
    const extraction = extractionDouble();
    const result = await submitSourceCandidateDecision(
      decisionRequest("promoted"),
      dependencies(promotionDouble(promotionOutcome), extraction),
    );
    assert.equal(result.ok, false, label);
    assert.equal(extraction.calls.length, 0, label);
  }

  // Cockpit-level refusals happen before P1-08 is ever reached.
  for (const [label, request] of [
    ["cross-organization request", decisionRequest("promoted", { organizationId: OTHER_ORG })],
    ["invalid body", decisionRequest("promoted", { payload: { outcome: "promoted" } })],
    ["invalid candidate id", decisionRequest("promoted", { intakeSourceCandidateId: "not-a-uuid" })],
  ]) {
    const promotion = promotionDouble(promotionResult("promoted"));
    const extraction = extractionDouble();
    const result = await submitSourceCandidateDecision(request, dependencies(promotion, extraction));
    assert.equal(result.ok, false, label);
    assert.equal(extraction.calls.length, 0, label);
  }

  // Feature gate.
  const extraction = extractionDouble();
  const disabled = await submitSourceCandidateDecision(
    decisionRequest("promoted"),
    dependencies(promotionDouble(promotionResult("promoted")), extraction, { env: { KAI_SPRINT2_ENABLED: "false" } }),
  );
  assert.equal(disabled.error.code, "feature_disabled");
  assert.equal(extraction.calls.length, 0);
});

test("C/F: a promoted result without a valid current source_version bound to this exact candidate never invokes P2-01", async () => {
  const cases = [
    ["missing source_version", promotionResult("promoted", { sourceVersionOverrides: {} }), (r) => { r.data.sourceVersion = null; }, "system_error"],
    ["decision bound to a different version", promotionResult("promoted", { decisionOverrides: { source_version_id: OTHER_SOURCE_VERSION } }), null, "system_error"],
    ["version of another candidate", promotionResult("promoted", { sourceVersionOverrides: { intake_source_candidate_id: OTHER_CANDIDATE } }), null, "system_error"],
    ["stale / non-current version", promotionResult("promoted", { sourceVersionOverrides: { is_current: false } }), null, "conflict_current_state_changed"],
  ];
  for (const [label, promotionOutcome, mutate, errorCode] of cases) {
    if (mutate) mutate(promotionOutcome);
    const extraction = extractionDouble();
    const result = await submitSourceCandidateDecision(
      decisionRequest("promoted"),
      dependencies(promotionDouble(promotionOutcome), extraction),
    );
    // An inconsistent promoted result is refused by the handoff rather than
    // guessing a version; the committed promotion itself is still reported.
    assert.equal(result.ok, true, `${label}: ${JSON.stringify(result)}`);
    assert.equal(extraction.calls.length, 0, label);
    assert.equal(result.data.evidence_extraction_handoff.status, "not_created", label);
    assert.equal(result.data.evidence_extraction_handoff.error_code, errorCode, label);
  }

  // A version of another organization is refused by the cockpit's own
  // response re-validation before any handoff.
  const foreign = promotionResult("promoted", { sourceVersionOverrides: { organization_id: OTHER_ORG } });
  const extraction = extractionDouble();
  const result = await submitSourceCandidateDecision(decisionRequest("promoted"), dependencies(promotionDouble(foreign), extraction));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(extraction.calls.length, 0);
});

test("D: a P2-01 refusal, failure, throw, or malformed result leaves the committed promotion reported and the handoff not_created with a sanitized code", async () => {
  const cases = [
    ["P2-01 conflict (stale version)", { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } }, "conflict_current_state_changed"],
    ["P2-01 validator", { ok: false, data: null, error: { code: "validation_blocker", status: 422 } }, "validation_blocker"],
    ["P2-01 authorization", { ok: false, data: null, error: { code: "tenant_boundary_violation", status: 403 } }, "tenant_boundary_violation"],
    ["P2-01 raw database message", { ok: false, data: null, error: { code: "duplicate key value violates unique constraint \"evidence_items_pkey\"" } }, "system_error"],
    ["P2-01 throws", () => { throw new Error("connect ECONNREFUSED 127.0.0.1:5432 password=secret"); }, "system_error"],
    ["P2-01 foreign-organization result", extractionResult({ organizationId: OTHER_ORG }), "system_error"],
    ["P2-01 other-version result", extractionResult({ sourceVersionId: OTHER_SOURCE_VERSION }), "system_error"],
    ["P2-01 missing queue items", (() => { const r = extractionResult(); r.data.reviewQueueItems = r.data.reviewQueueItems.slice(1); return r; })(), "system_error"],
    ["P2-01 non-evidence queue item", (() => { const r = extractionResult(); r.data.reviewQueueItems[0].queue_type = "claim_review"; return r; })(), "system_error"],
  ];
  for (const [label, outcome, errorCode] of cases) {
    const promotion = promotionDouble(promotionResult("promoted"));
    const extraction = extractionDouble(outcome);
    const result = await submitSourceCandidateDecision(decisionRequest("promoted"), dependencies(promotion, extraction));
    assert.equal(result.ok, true, `${label}: the committed promotion is still reported`);
    assert.equal(result.data.promotion_decision.decision_status, "promoted", label);
    assert.equal(result.data.source.source_id, SOURCE, label);
    assert.equal(result.data.source_version.source_version_id, SOURCE_VERSION, label);
    assert.equal(extraction.calls.length, 1, label);
    assert.deepEqual(result.data.evidence_extraction_handoff, {
      status: "not_created",
      source_version_id: SOURCE_VERSION,
      evidence_item_count: null,
      review_queue_item_count: null,
      error_code: errorCode,
    }, label);
    const serialized = JSON.stringify(result);
    for (const leak of ["ECONNREFUSED", "password", "duplicate key", STATEMENT_SENTINEL]) {
      assert.ok(!serialized.includes(leak), `${label}: ${leak} not echoed`);
    }
  }
});

test("E: an identical replayed promotion re-attempts the idempotent P2-01 handoff and reports replayed", async () => {
  const promotion = promotionDouble(promotionResult("promoted", { replayed: true }));
  const extraction = extractionDouble(extractionResult({ replayed: true }));
  const result = await submitSourceCandidateDecision(decisionRequest("promoted"), dependencies(promotion, extraction));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.replayed, true);
  assert.equal(extraction.calls.length, 1, "a replay re-attempts extraction so a failed first handoff can recover");
  assert.equal(extraction.calls[0].input.sourceVersionId, SOURCE_VERSION);
  assert.deepEqual(result.data.evidence_extraction_handoff, {
    status: "replayed",
    source_version_id: SOURCE_VERSION,
    evidence_item_count: 2,
    review_queue_item_count: 2,
    error_code: null,
  });

  // Recovery: first promotion's extraction failed, the identical replay creates.
  let attempt = 0;
  const recovering = extractionDouble(() => {
    attempt += 1;
    return attempt === 1 ? { ok: false, data: null, error: { code: "system_error", status: 500 } } : extractionResult();
  });
  const first = await submitSourceCandidateDecision(decisionRequest("promoted"), dependencies(promotionDouble(promotionResult("promoted")), recovering));
  assert.equal(first.data.evidence_extraction_handoff.status, "not_created");
  const retried = await submitSourceCandidateDecision(decisionRequest("promoted"), dependencies(promotionDouble(promotionResult("promoted", { replayed: true })), recovering));
  assert.equal(retried.data.replayed, true);
  assert.equal(retried.data.evidence_extraction_handoff.status, "created");
});

test("G: the real P1-08 and P2-01 services share one GK role set and one attribution mode; client, system, AI, and cross-organization actors are refused before any repository call", async () => {
  const { __sourcePromotionServiceContract } = await import("../Backend/kai/services/kaiSourcePromotionService.js");
  const { __evidenceLineageServiceContract } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  assert.deepEqual([...__sourcePromotionServiceContract.SOURCE_PROMOTION_ALLOWED_ROLES].sort(), ["gk_admin", "gk_operator", "gk_reviewer"]);
  assert.deepEqual([...__evidenceLineageServiceContract.EVIDENCE_LINEAGE_ALLOWED_ROLES].sort(), ["gk_admin", "gk_operator", "gk_reviewer"]);
  const promotionSource = readFileSync(new URL("../Backend/kai/services/kaiSourcePromotionService.js", import.meta.url), "utf8");
  const lineageSource = readFileSync(new URL("../Backend/kai/services/kaiEvidenceLineageService.js", import.meta.url), "utf8");
  // Same membership-role attribution: neither passes globalRolesOnly.
  assert.match(promotionSource, /\{ allowedRoles: SOURCE_PROMOTION_ALLOWED_ROLES \}/);
  assert.match(lineageSource, /\{ allowedRoles: EVIDENCE_LINEAGE_ALLOWED_ROLES \}/);

  const repositoryTripwire = () => {
    const calls = [];
    return {
      calls,
      evidenceLineageRepository: {
        async extractEvidenceFromSourceVersion(input) {
          calls.push(input);
          return extractionResult();
        },
      },
    };
  };
  const actors = [
    ["gk_admin", gkActor("gk_admin"), true],
    ["gk_operator", gkActor("gk_operator"), true],
    ["gk_reviewer", gkActor("gk_reviewer"), true],
    ["client_admin", gkActor("client_admin"), false],
    ["client_reviewer", gkActor("client_reviewer"), false],
    ["client_contributor", gkActor("client_contributor"), false],
    ["system actor", { ...gkActor(), actorType: "system" }, false],
    ["AI actor", { ...gkActor(), actorType: "ai" }, false],
    ["assistant actor", { ...gkActor(), actorType: "assistant" }, false],
    ["cross-organization GK", gkActor("gk_reviewer", OTHER_ORG), false],
    ["inactive membership", { ...gkActor(), organizationMemberships: [{ organization_id: ORG, membership_status: "inactive", role_name: "gk_reviewer" }] }, false],
  ];
  for (const [label, actorContext, allowed] of actors) {
    const tripwire = repositoryTripwire();
    const direct = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext, now: NOW },
      { env: ENV, evidenceLineageRepository: tripwire.evidenceLineageRepository, metadataOnlyAudit: noAudit() },
    );
    assert.equal(direct.ok, allowed, `P2-01 ${label}`);
    assert.equal(tripwire.calls.length, allowed ? 1 : 0, `P2-01 repository ${label}`);

    const promotionCalls = [];
    const promotion = await createSourcePromotionDecision(
      { organizationId: ORG, intakeSourceCandidateId: CANDIDATE, outcome: "rejected", actorContext, now: NOW },
      {
        env: ENV,
        metadataOnlyAudit: noAudit(),
        sourcePromotionRepository: { async createSourcePromotionDecision(input) { promotionCalls.push(input); return { ok: false, data: null, error: { code: "not_found", status: 404 } }; } },
      },
    );
    assert.equal(promotionCalls.length, allowed ? 1 : 0, `P1-08 repository ${label}`);
    if (!allowed) assert.equal(promotion.ok, false, `P1-08 ${label}`);
  }

  // Through the cockpit: only the authenticated GK human reaches the handoff,
  // and the handoff forwards that actor to the real P2-01 service unchanged.
  for (const [label, actorContext, reachesHandoff] of [
    ["gk_reviewer", gkActor("gk_reviewer"), true],
    ["client_admin", gkActor("client_admin"), false],
    ["system actor", { ...gkActor(), actorType: "system" }, false],
    ["AI actor", { ...gkActor(), actorType: "ai" }, false],
    ["cross-organization GK", gkActor("gk_reviewer", OTHER_ORG), false],
  ]) {
    const tripwire = repositoryTripwire();
    const promotion = promotionDouble(promotionResult("promoted"));
    const result = await submitSourceCandidateDecision(
      decisionRequest("promoted", { actorContext }),
      dependencies(promotion, { extractEvidenceFromSourceVersion }, { evidenceLineageRepository: tripwire.evidenceLineageRepository }),
    );
    if (reachesHandoff) {
      assert.equal(result.ok, true, label);
      assert.equal(result.data.evidence_extraction_handoff.status, "created", label);
      assert.equal(tripwire.calls.length, 1, label);
      assert.equal(tripwire.calls[0].actorUserId, REVIEWER, label);
      assert.equal(tripwire.calls[0].sourceVersionId, SOURCE_VERSION, label);
    } else {
      // Either the cockpit refuses before P1-08, or (for a cross-organization
      // GK who passes the global-role read gate) P2-01 itself refuses.
      assert.equal(tripwire.calls.length, 0, label);
      if (result.ok) {
        assert.equal(result.data.evidence_extraction_handoff.status, "not_created", label);
        assert.equal(result.data.evidence_extraction_handoff.error_code, "tenant_boundary_violation", label);
      } else {
        assert.equal(promotion.calls.length, 0, label);
      }
    }
  }
});

test("the handoff never reaches evidence review, claims, or the P2-01 HTTP route, and the P1-07 sensitivity handoff still never reaches P2-01", () => {
  const serviceSource = readFileSync(new URL("../Backend/kai/services/kaiReviewCockpitService.js", import.meta.url), "utf8");
  assert.doesNotMatch(serviceSource, /kaiHumanReviewService|kaiClaimProposalService|recordEvidenceReviewDecision|proposeClaim|evidence-extraction/);
  const sensitivityBody = serviceSource.match(/export async function submitSensitivityProfileDecision\([\s\S]*?\n}\n/)?.[0];
  const sourceCandidateHandoff = serviceSource.match(/async function ensureSourceCandidateAfterReviewedDecision\([\s\S]*?\n}\n/)?.[0];
  for (const body of [sensitivityBody, sourceCandidateHandoff]) {
    assert.ok(body);
    assert.doesNotMatch(body, /extractEvidenceFromSourceVersion|ensureEvidenceAfterPromotedDecision/);
  }
  const decisionBody = serviceSource.match(/export async function submitSourceCandidateDecision\([\s\S]*?\n}\n/)?.[0];
  assert.match(decisionBody, /promotionDecision\.decision_status === DECISION_STATUS_PROMOTED\s*\?\s*await ensureEvidenceAfterPromotedDecision\(/);
  // The P1 worker still imports no decision or extraction seam.
  const workerSource = readFileSync(new URL("../Backend/kai/parsing/p1WorkerRuntime.js", import.meta.url), "utf8");
  assert.doesNotMatch(workerSource, /kaiEvidenceLineageService|extractEvidenceFromSourceVersion|kaiReviewCockpitService/);
});

test("GK cockpit UI distinguishes created/replayed evidence from a failed extraction and offers retry only as recovery", () => {
  const uiSource = readFileSync(new URL("../frontend/kaiReviewCockpit.jsx", import.meta.url), "utf8");
  assert.match(uiSource, /const handoff = result\.body\.data\.evidence_extraction_handoff;/);
  assert.match(uiSource, /evidence item\(s\) created, awaiting GK evidence review\./);
  assert.match(uiSource, /evidence item\(s\) already present \(no new write\)\./);
  assert.match(uiSource, /The source is promoted, but evidence extraction did not complete/);
  assert.match(uiSource, /if \(handoff\?\.status === "not_created" && payload\.outcome === "promoted"\) setRetryPayload\(payload\);/);
  assert.match(uiSource, /onClick=\{\(\) => onSubmitDecision\(retryPayload\)\}[\s\S]{0,80}Retry evidence extraction/);
  // The browser never issues the P2-01 request itself.
  assert.doesNotMatch(uiSource, /evidence-extraction/);
});
