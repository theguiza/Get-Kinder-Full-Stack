import test from "node:test";
import assert from "node:assert/strict";

import {
  listClientFollowupWorkflows,
  __clientFollowupReadServiceContract,
} from "../Backend/kai/services/kaiClientFollowupReadService.js";
import {
  listAuthorizedEngagements,
  __engagementContextServiceContract,
} from "../Backend/kai/services/kaiEngagementContextService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000009";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

const clientReviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_reviewer" }],
});
const gkReviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
});
const gkOperatorActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000003",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
});
const crossTenantReviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000004",
  organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "client_reviewer" }],
});
const aiActor = Object.freeze({
  actorType: "ai",
  actorUserId: "90000000-0000-4000-8000-000000000005",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_reviewer" }],
});

// --- P2-11 client-followup read ---

test("P2-11 read allowed role is client_reviewer only", () => {
  assert.deepEqual(
    [...__clientFollowupReadServiceContract.LIST_CLIENT_FOLLOWUP_WORKFLOWS_ALLOWED_ROLES],
    ["client_reviewer"],
  );
});

test("P2-11 read returns exactly the safe field set for an authorized client_reviewer", async () => {
  const row = {
    claim_id: "c1", client_followup_item_id: "f1", dimension_key: "definition_clarity",
    question_text: "Confirm the business meaning of the unresolved field or measure.",
    review_queue_item_id: "q1", queue_status: "waiting_on_client", review_status: "proposed",
    updated_at: new Date("2026-08-15T10:00:00.000Z"),
  };
  const result = await listClientFollowupWorkflows(
    { organizationId: ORG, actorContext: clientReviewerActor },
    { env: enabledEnv, listClientFollowupWorkflowsForOrganization: async () => [row] },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, [{
    claim_id: "c1",
    client_followup_item_id: "f1",
    dimension_key: "definition_clarity",
    question_text: "Confirm the business meaning of the unresolved field or measure.",
    review_queue_item_id: "q1",
    queue_status: "waiting_on_client",
    review_status: "proposed",
    updated_at: "2026-08-15T10:00:00.000Z",
  }]);
});

test("P2-11 read rejects gk_reviewer/gk_operator before any repository call - never broadened beyond client_reviewer", async () => {
  for (const actorContext of [gkReviewerActor, gkOperatorActor]) {
    const result = await listClientFollowupWorkflows(
      { organizationId: ORG, actorContext },
      { env: enabledEnv, listClientFollowupWorkflowsForOrganization: async () => { throw new Error("must not be called"); } },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "authorization_denied");
  }
});

test("P2-11 read fails closed for a non-human actor", async () => {
  const result = await listClientFollowupWorkflows(
    { organizationId: ORG, actorContext: aiActor },
    { env: enabledEnv, listClientFollowupWorkflowsForOrganization: async () => { throw new Error("must not be called"); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-11 read fails closed for a client_reviewer with membership in a different organization", async () => {
  const result = await listClientFollowupWorkflows(
    { organizationId: ORG, actorContext: crossTenantReviewerActor },
    { env: enabledEnv, listClientFollowupWorkflowsForOrganization: async () => { throw new Error("must not be called"); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-11 read is disabled when KAI_SPRINT2_ENABLED is not true", async () => {
  const result = await listClientFollowupWorkflows(
    { organizationId: ORG, actorContext: clientReviewerActor },
    { env: {}, listClientFollowupWorkflowsForOrganization: async () => { throw new Error("must not be called"); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

// --- intake-context engagement read ---

test("engagement-context read allowed roles are exactly gk_admin/gk_operator", () => {
  assert.deepEqual(
    [...__engagementContextServiceContract.LIST_ENGAGEMENTS_ALLOWED_ROLES].sort(),
    ["gk_admin", "gk_operator"],
  );
});

test("engagement-context read returns only engagement_id/organization_id for an authorized actor", async () => {
  const result = await listAuthorizedEngagements(
    { organizationId: ORG, actorContext: gkOperatorActor },
    { env: enabledEnv, listEngagementsForOrganization: async () => [{ engagement_id: "e1", organization_id: ORG, extra: "must not leak" }] },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, [{ engagement_id: "e1", organization_id: ORG }]);
});

test("engagement-context read rejects client_reviewer before any repository call - only GK actors select engagement context here", async () => {
  const result = await listAuthorizedEngagements(
    { organizationId: ORG, actorContext: clientReviewerActor },
    { env: enabledEnv, listEngagementsForOrganization: async () => { throw new Error("must not be called"); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("engagement-context read fails closed for cross-tenant membership", async () => {
  const result = await listAuthorizedEngagements(
    { organizationId: ORG, actorContext: crossTenantReviewerActor },
    { env: enabledEnv, listEngagementsForOrganization: async () => { throw new Error("must not be called"); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("engagement-context read is disabled when KAI_SPRINT2_ENABLED is not true", async () => {
  const result = await listAuthorizedEngagements(
    { organizationId: ORG, actorContext: gkOperatorActor },
    { env: {}, listEngagementsForOrganization: async () => { throw new Error("must not be called"); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});
