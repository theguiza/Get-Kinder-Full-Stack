import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { createConflictReviewCandidate } from "../Backend/kai/services/kaiConflictReviewCandidateService.js";
import {
  CONFLICT_GROUP_BASIS_CODE,
  CONFLICT_GROUP_SAFE_SUMMARY,
  CONFLICT_GROUP_VALIDATOR_KEY,
  CONFLICT_RESOLUTION_REQUIRED_ACTION,
  validateConflictGroupCompleteness,
} from "../Backend/kai/validators/kaiConflictGroupValidators.js";
import { __conflictReviewCandidateRepositoryTestables } from "../Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js";

const SERVICE_PATH = "Backend/kai/services/kaiConflictReviewCandidateService.js";
const REPOSITORY_PATH = "Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js";
const VALIDATOR_PATH = "Backend/kai/validators/kaiConflictGroupValidators.js";

const serviceSource = readFileSync(new URL(`../${SERVICE_PATH}`, import.meta.url), "utf8");
const repositorySource = readFileSync(new URL(`../${REPOSITORY_PATH}`, import.meta.url), "utf8");
const validatorSource = readFileSync(new URL(`../${VALIDATOR_PATH}`, import.meta.url), "utf8");

const ORG = "00000000-0000-4000-8000-000000000001";
const LOWER = "10000000-0000-4000-8000-000000000001";
const HIGHER = "20000000-0000-4000-8000-000000000001";
const GROUP = "30000000-0000-4000-8000-000000000001";
const LOWER_GAP = "40000000-0000-4000-8000-000000000001";
const HIGHER_GAP = "50000000-0000-4000-8000-000000000001";
const NOW = "2026-08-06T10:00:00.000Z";

function groupPlan(overrides = {}) {
  return {
    conflict_group_id: GROUP,
    organization_id: ORG,
    lower_claim_id: LOWER,
    higher_claim_id: HIGHER,
    lower_claim_conflict_gap_id: LOWER_GAP,
    higher_claim_conflict_gap_id: HIGHER_GAP,
    basis_code: CONFLICT_GROUP_BASIS_CODE,
    safe_summary: CONFLICT_GROUP_SAFE_SUMMARY,
    created_by_type: "system",
    created_at: NOW,
    ...overrides,
  };
}

function queuePlan(overrides = {}) {
  return {
    organization_id: ORG,
    queue_type: "conflict_resolution",
    target_object_type: "conflict_group",
    target_object_id: GROUP,
    queue_status: "open",
    review_status: "needs_gk_review",
    priority: "normal",
    summary: CONFLICT_GROUP_SAFE_SUMMARY,
    required_action: CONFLICT_RESOLUTION_REQUIRED_ACTION,
    assigned_to: null,
    due_at: null,
    ...overrides,
  };
}

function actorContext(overrides = {}) {
  return {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [
      {
        organization_id: ORG,
        membership_status: "active",
        role_name: "gk_reviewer",
      },
    ],
    ...overrides,
  };
}

function metadataOnlyAudit() {
  return {
    prepareMetadataOnlyAudit() {
      return {
        ok: true,
        async publish() {},
      };
    },
  };
}

test("validateConflictGroupCompleteness returns the canonical structured pass result", () => {
  const result = validateConflictGroupCompleteness({ conflictGroup: groupPlan(), queueItem: queuePlan() });
  assert.equal(result.severity, "pass");
  assert.equal(result.validator_key, CONFLICT_GROUP_VALIDATOR_KEY);
  assert.equal(result.object_type, "conflict_group");
  assert.equal(result.object_code, "human_selected_unresolved_comparison");
  assert.equal(result.object_id, GROUP);
  assert.equal(result.evidence.queue_target_object_id, GROUP);
});

test("validateConflictGroupCompleteness blocks self-pairing and non-normalized persisted pairs", () => {
  const self = validateConflictGroupCompleteness({
    conflictGroup: groupPlan({ lower_claim_id: LOWER, higher_claim_id: LOWER }),
    queueItem: queuePlan(),
  });
  assert.equal(self.severity, "blocker");
  assert.equal(self.blocking_reason, "self_pairing");

  const reversed = validateConflictGroupCompleteness({
    conflictGroup: groupPlan({ lower_claim_id: HIGHER, higher_claim_id: LOWER }),
    queueItem: queuePlan(),
  });
  assert.equal(reversed.severity, "blocker");
  assert.equal(reversed.blocking_reason, "claim_pair_not_normalized");
});

test("validateConflictGroupCompleteness enforces complete non-null group and queue identities", () => {
  const missingGroupId = validateConflictGroupCompleteness({
    conflictGroup: groupPlan({ conflict_group_id: null }),
    queueItem: queuePlan({ target_object_id: null }),
  });
  assert.equal(missingGroupId.severity, "blocker");
  assert.equal(missingGroupId.blocking_reason, "invalid_conflict_group_identity");

  const wrongTarget = validateConflictGroupCompleteness({
    conflictGroup: groupPlan(),
    queueItem: queuePlan({ target_object_id: "60000000-0000-4000-8000-000000000001" }),
  });
  assert.equal(wrongTarget.severity, "blocker");
  assert.equal(wrongTarget.blocking_reason, "invalid_queue_contract");
});

test("validateConflictGroupCompleteness enforces the exact conflict_resolution queue contract", () => {
  assert.equal(queuePlan().queue_type, "conflict_resolution");
  assert.equal(queuePlan().target_object_type, "conflict_group");
  assert.equal(queuePlan().queue_status, "open");
  assert.equal(queuePlan().review_status, "needs_gk_review");
  assert.equal(queuePlan().priority, "normal");
  assert.equal(queuePlan().assigned_to, null);
  assert.equal(queuePlan().due_at, null);
  assert.equal(queuePlan().required_action, CONFLICT_RESOLUTION_REQUIRED_ACTION);

  for (const [key, value] of [
    ["queue_status", "waiting_on_gk"],
    ["review_status", "proposed"],
    ["priority", "high"],
    ["summary", "different"],
    ["required_action", "different"],
    ["assigned_to", "90000000-0000-4000-8000-000000000001"],
  ]) {
    const result = validateConflictGroupCompleteness({
      conflictGroup: groupPlan(),
      queueItem: queuePlan({ [key]: value }),
    });
    assert.equal(result.severity, "blocker", key);
    assert.equal(result.blocking_reason, "invalid_queue_contract", key);
  }
});

test("validateConflictGroupCompleteness blocks asserted-conflict and raw/sensitive content fields", () => {
  for (const extra of [
    { conflict_status: "confirmed" },
    { asserted_conflict: true },
    { claim_statement: "raw text" },
    { evidence_text: "raw text" },
    { storage_object_key: "bucket/key" },
    { signed_url: "https://example.invalid" },
  ]) {
    const result = validateConflictGroupCompleteness({
      conflictGroup: groupPlan(extra),
      queueItem: queuePlan(),
    });
    assert.equal(result.severity, "blocker", Object.keys(extra)[0]);
  }
});

test("caller order is accepted and normalized by repository helpers", () => {
  assert.deepEqual(__conflictReviewCandidateRepositoryTestables.normalizeClaimPair(LOWER, HIGHER), {
    lowerClaimId: LOWER,
    higherClaimId: HIGHER,
  });
  assert.deepEqual(__conflictReviewCandidateRepositoryTestables.normalizeClaimPair(HIGHER, LOWER), {
    lowerClaimId: LOWER,
    higherClaimId: HIGHER,
  });

  const builtGroup = __conflictReviewCandidateRepositoryTestables.buildGroupPlan({
    conflictGroupId: GROUP,
    organizationId: ORG,
    lowerClaimId: LOWER,
    higherClaimId: HIGHER,
    lowerGapId: LOWER_GAP,
    higherGapId: HIGHER_GAP,
    now: NOW,
  });
  assert.equal(builtGroup.lower_claim_id < builtGroup.higher_claim_id, true);
});

test("existingMatches accepts complete replay rows and rejects partial or malformed state without repair", () => {
  const queue = { review_queue_item_id: "70000000-0000-4000-8000-000000000001", ...queuePlan() };
  assert.equal(
    __conflictReviewCandidateRepositoryTestables.existingMatches({
      groupRecord: groupPlan(),
      queueRecord: queue,
      organizationId: ORG,
      lowerClaimId: LOWER,
      higherClaimId: HIGHER,
      lowerGapId: LOWER_GAP,
      higherGapId: HIGHER_GAP,
    }),
    true,
  );
  assert.equal(
    __conflictReviewCandidateRepositoryTestables.existingMatches({
      groupRecord: groupPlan(),
      queueRecord: null,
      organizationId: ORG,
      lowerClaimId: LOWER,
      higherClaimId: HIGHER,
      lowerGapId: LOWER_GAP,
      higherGapId: HIGHER_GAP,
    }),
    false,
  );
  assert.equal(
    __conflictReviewCandidateRepositoryTestables.existingMatches({
      groupRecord: groupPlan({ lower_claim_conflict_gap_id: HIGHER_GAP }),
      queueRecord: queue,
      organizationId: ORG,
      lowerClaimId: LOWER,
      higherClaimId: HIGHER,
      lowerGapId: LOWER_GAP,
      higherGapId: HIGHER_GAP,
    }),
    false,
  );
});

test("service rejects unknown keys and malformed UUIDs before repository invocation", async () => {
  let called = false;
  const repo = {
    async createConflictReviewCandidate() {
      called = true;
      return { ok: true, data: {}, error: null };
    },
  };
  const result = await createConflictReviewCandidate(
    {
      organizationId: ORG,
      firstClaimId: LOWER,
      secondClaimId: HIGHER,
      actorContext: actorContext(),
      now: NOW,
      extra: true,
    },
    { env: { KAI_SPRINT2_ENABLED: "true" }, conflictReviewCandidateRepository: repo, metadataOnlyAudit: metadataOnlyAudit() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(called, false);

  const badUuid = await createConflictReviewCandidate(
    { organizationId: ORG, firstClaimId: "not-a-uuid", secondClaimId: HIGHER, actorContext: actorContext(), now: NOW },
    { env: { KAI_SPRINT2_ENABLED: "true" }, conflictReviewCandidateRepository: repo, metadataOnlyAudit: metadataOnlyAudit() },
  );
  assert.equal(badUuid.ok, false);
  assert.equal(badUuid.error.code, "validation_blocker");
  assert.equal(called, false);
});

test("service requires a mapped human with active gk_admin/gk_operator/gk_reviewer membership", async () => {
  const base = { organizationId: ORG, firstClaimId: LOWER, secondClaimId: HIGHER, now: NOW };
  const deps = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    conflictReviewCandidateRepository: { async createConflictReviewCandidate() { throw new Error("should not call"); } },
    metadataOnlyAudit: metadataOnlyAudit(),
  };

  const systemActor = await createConflictReviewCandidate({ ...base, actorContext: actorContext({ actorType: "system" }) }, deps);
  assert.equal(systemActor.error.code, "authorization_denied");

  const inactive = await createConflictReviewCandidate({
    ...base,
    actorContext: actorContext({ organizationMemberships: [{ organization_id: ORG, membership_status: "inactive", role_name: "gk_reviewer" }] }),
  }, deps);
  assert.equal(inactive.error.code, "authorization_denied");

  const wrongRole = await createConflictReviewCandidate({
    ...base,
    actorContext: actorContext({ organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "viewer" }] }),
  }, deps);
  assert.equal(wrongRole.error.code, "authorization_denied");
});

test("disabled service loading returns feature_disabled without loading database-capable modules", () => {
  assert.match(serviceSource, /await import\(\s*["']\.\.\/dictionary\/postgresConflictReviewCandidateRepository\.js["']\s*\)/);
  assert.doesNotMatch(serviceSource, /from ["']\.\.\/dictionary\/postgresConflictReviewCandidateRepository\.js["']/);

  const script = `
    const before = new Set(Object.keys(process.env));
    process.env.KAI_SPRINT2_ENABLED = '';
    const { createConflictReviewCandidate } = await import('./${SERVICE_PATH}');
    const result = await createConflictReviewCandidate({
      organizationId: '${ORG}',
      firstClaimId: '${LOWER}',
      secondClaimId: '${HIGHER}',
      actorContext: {},
      now: '${NOW}'
    }, { env: {} });
    if (result.error.code !== 'feature_disabled') process.exit(1);
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, DATABASE_URL: "postgres://127.0.0.1:9/kai_sentinel" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("source contracts disclose lazy loading, metadata-only audit, and no asserted conflict semantics", () => {
  assert.match(repositorySource, /ON CONFLICT \(organization_id, lower_claim_id, higher_claim_id\)/);
  assert.match(repositorySource, /WHERE queue_type = 'conflict_resolution'/);
  assert.match(repositorySource, /prepareMetadataOnlyAudit/);
  assert.match(repositorySource, /conflict_review_candidate_created/);
  assert.doesNotMatch(repositorySource, /automatic conflict detection/i);
  assert.doesNotMatch(repositorySource, /conflict_status\s*=/);
  assert.match(validatorSource, /"confidence"/);
  assert.match(validatorSource, /"asserted_conflict"/);
});
