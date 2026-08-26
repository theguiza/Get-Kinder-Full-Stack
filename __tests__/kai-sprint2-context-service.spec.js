import test from "node:test";
import assert from "node:assert/strict";

import { resolveKaiRequestContext } from "../Backend/kai/services/kaiContextService.js";

/**
 * KAI Context Bootstrap v1: proves kaiContextService.js composes actor,
 * organization, and engagement context purely by orchestrating the existing
 * Sprint-2 actor resolver and organization/engagement authorization services
 * (injected here as dependencies), and never accepts a requested
 * organization or engagement id without it first appearing in those
 * services' own authorized-list results.
 */

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const ENGAGEMENT_A = "10000000-0000-4000-8000-00000000000a";
const ENGAGEMENT_B = "10000000-0000-4000-8000-00000000000b";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "client_admin" }],
});

function deps(overrides = {}) {
  return {
    env: enabledEnv,
    listAuthorizedOrganizations: async () => ({ ok: true, data: { items: [{ organization_id: ORG_A }] }, error: null }),
    listAuthorizedEngagements: async () => ({
      ok: true,
      data: { items: [{ engagement_id: ENGAGEMENT_A, organization_id: ORG_A }] },
      error: null,
    }),
    ...overrides,
  };
}

test("context bootstrap is disabled when KAI_SPRINT2_ENABLED is not true", async () => {
  const result = await resolveKaiRequestContext({ actorContext }, { env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("actor: fails closed when actor resolution fails, without ever calling organization/engagement services", async () => {
  let orgCalls = 0;
  const result = await resolveKaiRequestContext(
    { req: { id: 1 } },
    deps({
      resolveKaiActorContext: async () => ({ ok: false, error_code: "mapped_kai_user_required" }),
      listAuthorizedOrganizations: async () => {
        orgCalls += 1;
        return { ok: true, data: { items: [] }, error: null };
      },
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "mapped_kai_user_required");
  assert.equal(orgCalls, 0);
});

test("actor: a resolved actor with no requested organization or engagement returns actor-only context", async () => {
  const result = await resolveKaiRequestContext({ actorContext }, deps());
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.actorContext, actorContext);
  assert.equal(result.data.organizationContext, null);
  assert.equal(result.data.engagementContext, null);
});

test("organization: an actor-authorized requested organization is accepted", async () => {
  const result = await resolveKaiRequestContext(
    { actorContext, requestedOrganizationId: ORG_A },
    deps(),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.organizationContext, { organizationId: ORG_A });
});

test("organization: a requested organization the actor is not authorized for is denied", async () => {
  const result = await resolveKaiRequestContext(
    { actorContext, requestedOrganizationId: ORG_B },
    deps(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("organization: a malformed requested organization id is rejected as a validation blocker", async () => {
  const result = await resolveKaiRequestContext(
    { actorContext, requestedOrganizationId: 12345 },
    deps(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("engagement: an engagement belonging to the authorized organization is accepted", async () => {
  const result = await resolveKaiRequestContext(
    { actorContext, requestedOrganizationId: ORG_A, requestedEngagementId: ENGAGEMENT_A },
    deps(),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.engagementContext, { engagementId: ENGAGEMENT_A, organizationId: ORG_A });
});

test("engagement: an engagement belonging to another organization is denied even if the id exists elsewhere", async () => {
  const result = await resolveKaiRequestContext(
    { actorContext, requestedOrganizationId: ORG_A, requestedEngagementId: ENGAGEMENT_B },
    deps({
      listAuthorizedEngagements: async () => ({
        ok: true,
        data: { items: [{ engagement_id: ENGAGEMENT_A, organization_id: ORG_A }] },
        error: null,
      }),
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("engagement: an unknown engagement id is denied", async () => {
  const result = await resolveKaiRequestContext(
    { actorContext, requestedOrganizationId: ORG_A, requestedEngagementId: "does-not-exist" },
    deps(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("engagement: a requested engagement without a requested organization is rejected rather than inferring one", async () => {
  const result = await resolveKaiRequestContext(
    { actorContext, requestedEngagementId: ENGAGEMENT_A },
    deps(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("engagement: the underlying engagement service is called with exactly the authorized organization id, never the raw request", async () => {
  const calls = [];
  const result = await resolveKaiRequestContext(
    { actorContext, requestedOrganizationId: ORG_A, requestedEngagementId: ENGAGEMENT_A },
    deps({
      listAuthorizedEngagements: async (input) => {
        calls.push(input);
        return { ok: true, data: { items: [{ engagement_id: ENGAGEMENT_A, organization_id: ORG_A }] }, error: null };
      },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].organizationId, ORG_A);
  assert.deepEqual(calls[0].actorContext, actorContext);
});
