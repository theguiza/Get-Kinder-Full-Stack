import test from "node:test";
import assert from "node:assert/strict";

import {
  listAuthorizedOrganizations,
  getOrganizationDisplayProfile,
  __organizationContextServiceContract,
} from "../Backend/kai/services/kaiOrganizationContextService.js";

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

test("organization-context read authorized role set matches the canonical read_intake contract", () => {
  assert.deepEqual(
    [...__organizationContextServiceContract.AUTHORIZED_INTAKE_ROLE_NAMES].sort(),
    ["client_admin", "client_contributor", "client_reviewer", "gk_admin", "gk_operator", "gk_reviewer"],
  );
});

test("organization-context read returns exactly organization_id, derived only from the resolved actor's active memberships", async () => {
  const actorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [
      { organization_id: ORG_A, membership_status: "active", role_name: "client_admin", extra: "must not leak" },
    ],
  };
  const result = await listAuthorizedOrganizations({ actorContext }, { env: enabledEnv });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, [{ organization_id: ORG_A }]);
});

test("organization-context read deduplicates and sorts multiple active organizations", async () => {
  const actorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [
      { organization_id: ORG_B, membership_status: "active", role_name: "gk_operator" },
      { organization_id: ORG_A, membership_status: "active", role_name: "client_admin" },
      { organization_id: ORG_A, membership_status: "active", role_name: "gk_reviewer" },
    ],
  };
  const result = await listAuthorizedOrganizations({ actorContext }, { env: enabledEnv });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, [{ organization_id: ORG_A }, { organization_id: ORG_B }]);
});

test("organization-context read excludes inactive memberships - the browser cannot surface a deactivated tenant binding", async () => {
  const actorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [
      { organization_id: ORG_A, membership_status: "revoked", role_name: "client_admin" },
    ],
  };
  const result = await listAuthorizedOrganizations({ actorContext }, { env: enabledEnv });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, []);
});

test("organization-context read excludes a role not authorized for ordinary intake - fails closed rather than broadening role semantics", async () => {
  const actorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [
      { organization_id: ORG_A, membership_status: "active", role_name: "some_unrelated_role" },
    ],
  };
  const result = await listAuthorizedOrganizations({ actorContext }, { env: enabledEnv });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, []);
});

test("organization-context read returns an empty list rather than fabricating an organization when the actor has no memberships", async () => {
  const actorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [],
  };
  const result = await listAuthorizedOrganizations({ actorContext }, { env: enabledEnv });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, []);
});

test("organization-context read fails closed for a non-human actor", async () => {
  const actorContext = {
    actorType: "ai",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "client_admin" }],
  };
  const result = await listAuthorizedOrganizations({ actorContext }, { env: enabledEnv });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("organization-context read is disabled when KAI_SPRINT2_ENABLED is not true", async () => {
  const actorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "client_admin" }],
  };
  const result = await listAuthorizedOrganizations({ actorContext }, { env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("organization-context read rejects a request that does not carry a plain-object actorContext", async () => {
  const result = await listAuthorizedOrganizations({ actorContext: null }, { env: enabledEnv });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

// --- getOrganizationDisplayProfile (B0: /impact-library shell header source) ---

const AUTHORIZED_ACTOR_FOR_ORG_A = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "client_admin" }],
});

test("organization display-profile read returns the bound organization's name and logo for an authorized member", async () => {
  const result = await getOrganizationDisplayProfile(
    { organizationId: ORG_A, actorContext: AUTHORIZED_ACTOR_FOR_ORG_A },
    {
      env: enabledEnv,
      getActiveGkOrganizationBindingForKaiOrganizationId: async (kaiOrganizationId) => {
        assert.equal(kaiOrganizationId, ORG_A);
        return { gk_organization_id: 42, kai_organization_id: ORG_A, status: "active" };
      },
      getPublicOrganizationDisplayFields: async (gkOrganizationId) => {
        assert.equal(gkOrganizationId, 42);
        return { name: "Northwind Community Society", logo_url: "https://example.org/logo.png" };
      },
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    organization_id: ORG_A,
    name: "Northwind Community Society",
    logo_url: "https://example.org/logo.png",
    resolved: true,
  });
});

test("organization display-profile read blocks a request for an organization the actor is not authorized for", async () => {
  let bindingLookupCalled = false;
  const result = await getOrganizationDisplayProfile(
    { organizationId: ORG_B, actorContext: AUTHORIZED_ACTOR_FOR_ORG_A },
    {
      env: enabledEnv,
      getActiveGkOrganizationBindingForKaiOrganizationId: async () => {
        bindingLookupCalled = true;
        return { gk_organization_id: 99, kai_organization_id: ORG_B, status: "active" };
      },
      getPublicOrganizationDisplayFields: async () => ({ name: "Some Other Org", logo_url: null }),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(bindingLookupCalled, false, "must fail closed before ever resolving another organization's binding/display data");
});

test("organization display-profile read handles a missing logo_url safely without fabricating one", async () => {
  const result = await getOrganizationDisplayProfile(
    { organizationId: ORG_A, actorContext: AUTHORIZED_ACTOR_FOR_ORG_A },
    {
      env: enabledEnv,
      getActiveGkOrganizationBindingForKaiOrganizationId: async () => ({
        gk_organization_id: 42,
        kai_organization_id: ORG_A,
        status: "active",
      }),
      getPublicOrganizationDisplayFields: async () => ({ name: "Northwind Community Society", logo_url: null }),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.name, "Northwind Community Society");
  assert.equal(result.data.logo_url, null);
  assert.equal(result.data.resolved, true);
});

test("organization display-profile read returns an unresolved (not fabricated) profile when no active binding exists, and never leaks a different organization's metadata", async () => {
  const result = await getOrganizationDisplayProfile(
    { organizationId: ORG_A, actorContext: AUTHORIZED_ACTOR_FOR_ORG_A },
    {
      env: enabledEnv,
      getActiveGkOrganizationBindingForKaiOrganizationId: async () => null,
      getPublicOrganizationDisplayFields: async () => {
        throw new Error("must never be called when no binding was found");
      },
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { organization_id: ORG_A, name: null, logo_url: null, resolved: false });
});

test("organization display-profile read returns an unresolved profile when the bound public.organizations row has no display fields", async () => {
  const result = await getOrganizationDisplayProfile(
    { organizationId: ORG_A, actorContext: AUTHORIZED_ACTOR_FOR_ORG_A },
    {
      env: enabledEnv,
      getActiveGkOrganizationBindingForKaiOrganizationId: async () => ({
        gk_organization_id: 42,
        kai_organization_id: ORG_A,
        status: "active",
      }),
      getPublicOrganizationDisplayFields: async () => null,
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { organization_id: ORG_A, name: null, logo_url: null, resolved: false });
});

test("organization display-profile read is disabled when KAI_SPRINT2_ENABLED is not true", async () => {
  const result = await getOrganizationDisplayProfile(
    { organizationId: ORG_A, actorContext: AUTHORIZED_ACTOR_FOR_ORG_A },
    { env: {} },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("organization display-profile read rejects a request missing organizationId", async () => {
  const result = await getOrganizationDisplayProfile({ actorContext: AUTHORIZED_ACTOR_FOR_ORG_A }, { env: enabledEnv });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});
