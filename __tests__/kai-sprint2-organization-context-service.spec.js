import test from "node:test";
import assert from "node:assert/strict";

import {
  listAuthorizedOrganizations,
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
