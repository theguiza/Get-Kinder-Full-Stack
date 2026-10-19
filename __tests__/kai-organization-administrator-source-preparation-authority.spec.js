import test from "node:test";
import assert from "node:assert/strict";

import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import {
  validateActorCanPerformSensitivityReview,
  validateActorIsOrganizationAdministrator,
} from "../Backend/kai/auth/kaiAuthorizationService.js";
import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import { authorizeSourcePromotionDecision } from "../Backend/kai/services/kaiSourcePromotionService.js";
import { authorizeSourceCandidateContinuation } from "../Backend/kai/services/kaiSourceCandidateService.js";
import { getOrganizationAccessCapabilities } from "../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js";
import { createPostgresSourceCandidateRepository } from "../Backend/kai/dictionary/postgresSourceCandidateRepository.js";
import { recordSensitivityAllowedUseDecision } from "../Backend/kai/services/kaiSensitivityAllowedUseReviewService.js";

/**
 * Owner decision 2026-10-19: a legitimately delegated, active organization
 * client_admin (an active kai.organization_memberships grant, written only by
 * the governed, audited access-administration paths) has the same
 * organization-scoped source-preparation authority as a binding-derived
 * client_admin - sensitivity review, P1-07 continuation, the source-candidate
 * reads, and P1-08 promotion - and any such administrator may continue a file
 * another authorized human reviewed. Provenance is the server-set membership
 * marker; a client-supplied role, an untagged or inactive membership, a global
 * role, and platform-superuser authority never substitute. The assembled
 * PostgreSQL/browser proof is
 * kai-source-to-impact-workflow-browser-acceptance.integration.spec.js.
 */

const ORG = "0c000000-0000-4000-8000-0000000000a1";
const OTHER_ORG = "0c000000-0000-4000-8000-0000000000b1";
const PROFILE = "8c000000-0000-4000-8000-0000000000a1";
const QUEUE = "3c000000-0000-4000-8000-0000000000a1";
const ADMIN_A = "5c000000-0000-4000-8000-0000000000a1";
const ADMIN_B = "5c000000-0000-4000-8000-0000000000b1";
const NOW = "2026-10-19T12:00:00.000Z";
const ENV = { KAI_SPRINT2_ENABLED: "true" };
const GK_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);

function actor({ memberships, kaiRoles = [], platformSuperuser = false, kaiUserStatus = "active", actorUserId = ADMIN_B, actorType = "human" }) {
  return { actorType, actorUserId, kaiUserStatus, kaiRoles, platformSuperuser, organizationMemberships: memberships };
}
const stored = (overrides = {}) => ({ organization_id: ORG, role_name: "client_admin", membership_status: "active", source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE, ...overrides });
const bound = (overrides = {}) => ({ organization_id: ORG, role_name: "client_admin", membership_status: "active", source: "gk_organization_binding", gk_organization_id: 77, ...overrides });

test("provenance: resolveKaiActorContext tags each stored kai.organization_memberships row; binding-derived memberships keep their own marker", async () => {
  const result = await resolveKaiActorContext({ user: { id: 501, email: "b@example.test" } }, {
    async findOrCreateKaiUserByLegacyPublicUserdataId() {
      return { user_id: ADMIN_B, legacy_identity_source: "public.userdata", legacy_public_userdata_id: 501, status: "active" };
    },
    async listKaiRolesForUser() { return []; },
    async listOrganizationMembershipsForUser() {
      return [{ organization_id: ORG, user_id: ADMIN_B, role_name: "client_admin", membership_status: "active" }];
    },
    async resolveEffectiveClientOrganizationMembershipsForLegacyUser() { return [bound({ organization_id: OTHER_ORG })]; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.actorContext.organizationMemberships, [
    { organization_id: ORG, user_id: ADMIN_B, role_name: "client_admin", membership_status: "active", source: "kai_organization_membership" },
    bound({ organization_id: OTHER_ORG }),
  ]);
});

function gates(actorContext, organizationId = ORG) {
  return {
    administrator: validateActorIsOrganizationAdministrator(actorContext, "x", organizationId).ok === true,
    sensitivityReview: validateActorCanPerformSensitivityReview(actorContext, "record_sensitivity_allowed_use_decision", organizationId, GK_ROLES, { globalRolesOnly: true }).ok === true,
    continuation: authorizeSourceCandidateContinuation(actorContext, organizationId).ok === true,
    promotion: authorizeSourcePromotionDecision(actorContext, organizationId).ok === true,
  };
}
const ALL = { administrator: true, sensitivityReview: true, continuation: true, promotion: true };
const NONE = { administrator: false, sensitivityReview: false, continuation: false, promotion: false };

test("equivalence: a delegated stored client_admin grant and a binding-derived client_admin hold the same organization-scoped source-preparation authority", () => {
  assert.deepEqual(gates(actor({ memberships: [bound()] })), ALL);
  assert.deepEqual(gates(actor({ memberships: [stored()] })), ALL);
  assert.equal(authorizeSourcePromotionDecision(actor({ memberships: [stored()] }), ORG).organizationAdminAuthorized, true);
});

test("no substitute: untagged, inactive, revoked, or other-role memberships, a global client_admin role, platform-superuser authority, an inactive account, other organizations, and non-human actors", () => {
  const cases = [
    ["client_admin membership with no provenance (e.g. caller-built)", actor({ memberships: [stored({ source: undefined })] })],
    ["client_admin membership with an unknown provenance", actor({ memberships: [stored({ source: "request_body" })] })],
    ["revoked stored grant (inactive)", actor({ memberships: [stored({ membership_status: "inactive" })] })],
    ["revoked stored grant (revoked)", actor({ memberships: [stored({ membership_status: "revoked" })] })],
    ["invited stored grant", actor({ memberships: [stored({ membership_status: "invited" })] })],
    ["stored client_reviewer", actor({ memberships: [stored({ role_name: "client_reviewer" })] })],
    ["stored client_contributor", actor({ memberships: [stored({ role_name: "client_contributor" })] })],
    ["global client_admin role over a contributor grant", actor({ memberships: [stored({ role_name: "client_contributor" })], kaiRoles: ["client_admin"] })],
    ["platform superuser with no organization grant", actor({ memberships: [], platformSuperuser: true })],
    ["inactive KAI account", actor({ memberships: [stored()], kaiUserStatus: "inactive" })],
  ];
  for (const [label, actorContext] of cases) {
    const result = gates(actorContext);
    // The superuser keeps its own existing GK-side authority (unchanged); it is
    // never organization-administrator authority.
    if (label.startsWith("platform superuser")) {
      assert.deepEqual([result.administrator, result.continuation], [false, false], label);
      assert.notEqual(authorizeSourcePromotionDecision(actorContext, ORG).organizationAdminAuthorized, true, label);
      continue;
    }
    // An inactive account is refused where the account status is checked (continuation, P1-08).
    if (label === "inactive KAI account") {
      assert.deepEqual([result.continuation, result.promotion], [false, false], label);
      continue;
    }
    assert.deepEqual(result, NONE, label);
  }
  assert.deepEqual(gates(actor({ memberships: [stored()] }), OTHER_ORG), NONE, "an administrator of one organization holds nothing in another");
  assert.deepEqual(gates(actor({ memberships: [stored()], actorType: "system" })), NONE);
  assert.deepEqual(gates(actor({ memberships: [stored()], actorType: "ai" })), NONE);
});

test("capabilities follow the same predicate: a stored administrator is offered sensitivity review and promotion, never GK review, release, or the GK draft library", async () => {
  for (const memberships of [[stored()], [bound()]]) {
    const result = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext: actor({ memberships }) }, { env: ENV });
    assert.equal(result.ok, true, JSON.stringify(result));
    const ops = result.data.workflowOperations;
    assert.deepEqual([ops.reviewSensitivity, ops.promoteSource, ops.extractEvidence, ops.proposeClaim, ops.generateDrafts], [true, true, true, true, true]);
    assert.deepEqual([ops.recordEvidenceReview, ops.recordClaimReview, ops.reviewGeneratedDrafts, ops.readGeneratedDrafts, ops.generateAllDraftTypes], [false, false, false, false, false]);
    assert.equal(result.data.internalKnowledgeWorkspace, false);
  }
  const revoked = await getOrganizationAccessCapabilities({ organizationId: ORG, actorContext: actor({ memberships: [stored({ membership_status: "inactive" })] }) }, { env: ENV });
  assert.equal(revoked.ok, false, "no active grant: no organization access at all");
});

function head(overrides = {}) {
  return {
    decision_id: "4c000000-0000-4000-8000-0000000000a1", organization_id: ORG, intake_sensitivity_profile_id: PROFILE,
    review_queue_item_id: QUEUE, decision_outcome: "reviewed", reviewed_allowed_use_status: "unknown",
    decided_by: ADMIN_A, decided_by_role: "client_admin", created_by_type: "human", supersedes_decision_id: null,
    ...overrides,
  };
}

function prerequisiteTx({ heads, queue = { review_queue_item_id: QUEUE, queue_status: "resolved", review_status: "resolved" } }) {
  const writes = [];
  return {
    writes,
    async query(sql) {
      if (/^\s*INSERT/i.test(sql)) {
        writes.push(sql);
        if (sql.includes("INTO kai.intake_source_candidates")) {
          return { rows: [{ intake_source_candidate_id: "9c000000-0000-4000-8000-0000000000a1", organization_id: ORG, intake_file_id: "2c000000-0000-4000-8000-0000000000a1", file_profile_id: "4c000000-0000-4000-8000-0000000000f1", data_dictionary_id: "3c000000-0000-4000-8000-0000000000d1", intake_sensitivity_profile_id: PROFILE, profile_canonical_sha256: "a".repeat(64), proposed_source_type: "unknown", candidate_status: "needs_gk_review", created_at: NOW }] };
        }
        if (sql.includes("INTO kai.review_queue_items")) {
          return { rows: [{ review_queue_item_id: "3c000000-0000-4000-8000-0000000000b1", organization_id: ORG, queue_type: "source_candidate_review", queue_status: "open", target_object_type: "intake_source_candidate", target_object_id: "9c000000-0000-4000-8000-0000000000a1", queue_metadata: { p0_stub: true } }] };
        }
        return { rows: [] };
      }
      if (sql.includes("FROM kai.intake_sensitivity_review_decisions")) return { rows: heads };
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) {
        return { rows: [{ organization_id: ORG, intake_sensitivity_profile_id: PROFILE, intake_file_id: "2c000000-0000-4000-8000-0000000000a1", file_profile_id: "4c000000-0000-4000-8000-0000000000f1", data_dictionary_id: "3c000000-0000-4000-8000-0000000000d1", profile_canonical_sha256: "a".repeat(64), human_review_required: true, public_use_allowed: false, funder_use_allowed: false, llm_processing_allowed: false, product_learning_allowed: false, retention_posture: "restricted_pending_review", allowed_use_status: "unknown" }] };
      }
      if (sql.includes("FROM kai.review_queue_items") && sql.includes("sensitivity_review")) return { rows: queue ? [queue] : [] };
      if (sql.includes("FROM kai.intake_files")) return { rows: [{ upload_state: "confirmed" }] };
      if (sql.includes("FROM kai.intake_source_candidates")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

async function createAsAdministrator(tx) {
  let audits = 0;
  const repository = createPostgresSourceCandidateRepository({ runInTransaction: (callback) => callback(tx) });
  const result = await repository.createSourceCandidateStub({
    identity: { organizationId: ORG, intakeSensitivityProfileId: PROFILE },
    actorUserId: ADMIN_B,
    now: NOW,
    requireCurrentReviewedDecision: true,
    metadataOnlyAudit: { prepareMetadataOnlyAudit: () => { audits += 1; return { ok: false }; } },
  });
  return { result, audits };
}

test("P1-07 prerequisite: Admin B continues Admin A's (or Get Kinder's) current human 'reviewed' decision; the decision is only read", async () => {
  for (const decider of [head(), head({ decided_by_role: "gk_reviewer" })]) {
    const tx = prerequisiteTx({ heads: [decider] });
    const { result, audits } = await createAsAdministrator(tx);
    // The prerequisite passed and creation proceeded to the required audit (which this
    // test rejects, rolling the write back): the head itself was never written.
    assert.equal(audits, 1, JSON.stringify(result));
    assert.equal(tx.writes.some((sql) => sql.includes("intake_sensitivity_review_decisions")), false);
  }
});

test("P1-07 prerequisite still refuses a machine head, a needs_more_information head, an unresolved review item, no decision, and an unknown decider role - zero writes", async () => {
  for (const [label, heads, queue] of [
    ["system-created head", [head({ created_by_type: "system" })], undefined],
    ["needs_more_information head", [head({ decision_outcome: "needs_more_information", reviewed_allowed_use_status: null })], undefined],
    ["unresolved review item", [head()], { review_queue_item_id: QUEUE, queue_status: "in_progress", review_status: "needs_gk_review" }],
    ["review item of another decision", [head()], { review_queue_item_id: "3c000000-0000-4000-8000-0000000000ff", queue_status: "resolved", review_status: "resolved" }],
    ["no decision", [], undefined],
    ["unknown decider role", [head({ decided_by_role: "client_contributor" })], undefined],
  ]) {
    const tx = prerequisiteTx({ heads, ...(queue ? { queue } : {}) });
    const { result, audits } = await createAsAdministrator(tx);
    assert.deepEqual([result.ok, result.error.code, audits, tx.writes.length], [false, "authorization_denied", 0, 0], label);
  }
});

test("sensitivity decision: a delegated stored administrator's decision reaches the ledger attributed client_admin; an untagged or inactive membership never does", async () => {
  const input = (actorContext) => ({
    organizationId: ORG, intakeSensitivityProfileId: PROFILE, reviewQueueItemId: QUEUE,
    expectedUpdatedAt: NOW, decision: "needs_more_information", actorContext, now: NOW,
  });
  const calls = [];
  const repository = { async recordSensitivityAllowedUseDecision(args) { calls.push(args); return { ok: true, data: { recorded: true } }; } };
  for (const memberships of [[stored()], [bound()]]) {
    const result = await recordSensitivityAllowedUseDecision(input(actor({ memberships })), { env: ENV, sensitivityAllowedUseReviewRepository: repository });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  assert.deepEqual(calls.map((call) => [call.actorUserId, call.actorRole]), [[ADMIN_B, "client_admin"], [ADMIN_B, "client_admin"]]);
  for (const memberships of [[stored({ source: undefined })], [stored({ membership_status: "inactive" })], [stored({ role_name: "client_reviewer" })]]) {
    const result = await recordSensitivityAllowedUseDecision(input(actor({ memberships })), { env: ENV, sensitivityAllowedUseReviewRepository: repository });
    assert.equal(result.ok, false);
  }
  assert.equal(calls.length, 2, "no refused actor reaches the ledger");
});
