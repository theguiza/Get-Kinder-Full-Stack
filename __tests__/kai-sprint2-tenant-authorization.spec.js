import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ACTIVE_ORGANIZATION_MEMBERSHIP_SQL,
  ALLOWED_ACTIVE_MEMBERSHIP_STATUS,
  authorizeSprint2TenantMembership,
  authorizeSprint2TenantMembershipWithLookup,
  findActiveOrganizationMembership,
  isExplicitActiveMembershipStatus,
} from "../Backend/kai/auth/tenantAuthorization.js";

const tenantAuthorizationSource = readFileSync("Backend/kai/auth/tenantAuthorization.js", "utf8");
const tenantAuthorizationTestSource = readFileSync("__tests__/kai-sprint2-tenant-authorization.spec.js", "utf8");

const actorContext = Object.freeze({
  actorUserId: "kai-user-101",
  actorType: "human",
  legacyPublicUserdataId: 101,
  source: "public.userdata",
  kaiRoles: [],
  organizationMemberships: [],
});

const tenantContext = Object.freeze({
  organizationId: "org-test-scope",
});

function membershipRow(overrides = {}) {
  return {
    organization_id: "org-test-scope",
    user_id: "kai-user-101",
    role_name: "client_reviewer",
    membership_status: "active",
    email: "membership@example.invalid",
    ...overrides,
  };
}

function createMembershipQuery({ row = membershipRow() } = {}) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql === ACTIVE_ORGANIZATION_MEMBERSHIP_SQL) return { rows: row ? [row] : [] };
    throw new Error("unexpected membership test query");
  };
  return { calls, query };
}

test("tenant authorization fails closed when actor context is missing", () => {
  const result = authorizeSprint2TenantMembership({
    tenantContext,
    membership: { membershipStatus: "active" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unauthorized");
  assert.equal(result.error.status, 401);
  assert.equal(result.blockers[0].blocking_reason, "missing_actor_context");
});

test("tenant authorization requires explicit organizationId", () => {
  for (const missingTenantContext of [undefined, null, {}, { organizationId: "" }, { tenantId: "tenant-only" }]) {
    const result = authorizeSprint2TenantMembership({
      actorContext,
      tenantContext: missingTenantContext,
      membership: { membershipStatus: "active" },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "tenant_boundary_violation");
    assert.equal(result.blockers[0].blocking_reason, "missing_tenant_context");
  }
});

test("tenant authorization fails closed when membership is missing", () => {
  for (const membership of [undefined, null, []]) {
    const result = authorizeSprint2TenantMembership({
      actorContext,
      tenantContext,
      membership,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "authorization_denied");
    assert.equal(result.error.status, 403);
    assert.equal(result.blockers[0].blocking_reason, "missing_membership_context");
  }
});

test("tenant authorization rejects non-active, unsupported, or unknown membership status", () => {
  for (const membershipStatus of [undefined, null, "", "pending", "inactive", "suspended", "ACTIVE", "unknown"]) {
    const result = authorizeSprint2TenantMembership({
      actorContext,
      tenantContext,
      membership: {
        organizationId: "org-test-scope",
        actorUserId: "kai-user-101",
        membershipStatus,
      },
    });

    assert.equal(result.ok, false, String(membershipStatus));
    assert.equal(result.error.code, "authorization_denied");
    assert.equal(result.blockers[0].blocking_reason, "unsupported_membership_status");
    assert.equal(isExplicitActiveMembershipStatus(membershipStatus), false);
  }
});

test("tenant authorization accepts only explicitly allowed active membership", () => {
  const result = authorizeSprint2TenantMembership({
    actorContext,
    tenantContext,
    membership: {
      organizationId: "org-test-scope",
      actorUserId: "kai-user-101",
      membershipStatus: ALLOWED_ACTIVE_MEMBERSHIP_STATUS,
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { membershipStatus: "active" });
  assert.deepEqual(result.warnings, []);
});

test("membership helper accepts active membership using injected query", async () => {
  const { calls, query } = createMembershipQuery();

  const membership = await findActiveOrganizationMembership({
    query,
    organizationId: "org-test-scope",
    actorUserId: "kai-user-101",
  });

  assert.deepEqual(calls, [
    {
      sql: ACTIVE_ORGANIZATION_MEMBERSHIP_SQL,
      params: ["org-test-scope", "kai-user-101"],
    },
  ]);
  assert.deepEqual(membership, {
    organizationId: "org-test-scope",
    actorUserId: "kai-user-101",
    roleName: "client_reviewer",
    membershipStatus: "active",
  });
});

test("membership lookup authorization rejects missing membership", async () => {
  const { calls, query } = createMembershipQuery({ row: null });

  const result = await authorizeSprint2TenantMembershipWithLookup({
    query,
    actorContext,
    organizationId: "org-test-scope",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(result.blockers[0].blocking_reason, "missing_membership_context");
  assert.equal(calls.length, 1);
});

test("membership helper rejects inactive, unsupported, or unknown membership rows", async () => {
  for (const row of [
    membershipRow({ membership_status: "inactive" }),
    membershipRow({ membership_status: "pending" }),
    membershipRow({ membership_status: "ACTIVE" }),
    {},
  ]) {
    const { query } = createMembershipQuery({ row });
    const membership = await findActiveOrganizationMembership({
      query,
      organizationId: "org-test-scope",
      actorUserId: "kai-user-101",
    });

    assert.equal(membership, null);
  }
});

test("tenant authorization rejects membership actor and organization mismatches", () => {
  const wrongOrganization = authorizeSprint2TenantMembership({
    actorContext,
    tenantContext,
    membership: {
      organizationId: "org-other",
      actorUserId: "kai-user-101",
      membershipStatus: "active",
    },
  });
  assert.equal(wrongOrganization.ok, false);
  assert.equal(wrongOrganization.error.code, "tenant_boundary_violation");
  assert.equal(wrongOrganization.blockers[0].blocking_reason, "membership_organization_mismatch");

  const wrongActor = authorizeSprint2TenantMembership({
    actorContext,
    tenantContext,
    membership: {
      organizationId: "org-test-scope",
      actorUserId: "kai-user-other",
      membershipStatus: "active",
    },
  });
  assert.equal(wrongActor.ok, false);
  assert.equal(wrongActor.error.code, "authorization_denied");
  assert.equal(wrongActor.blockers[0].blocking_reason, "membership_actor_mismatch");
});

test("gk_admin role does not bypass tenant membership in P0", async () => {
  const { query } = createMembershipQuery({ row: null });
  const result = await authorizeSprint2TenantMembershipWithLookup({
    query,
    actorContext: {
      ...actorContext,
      kaiRoles: ["gk_admin"],
    },
    organizationId: "org-test-scope",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(result.blockers[0].blocking_reason, "missing_membership_context");
});

test("membership lookup requires explicit organizationId and does not infer tenant from target IDs", async () => {
  const { calls, query } = createMembershipQuery();

  const result = await authorizeSprint2TenantMembershipWithLookup({
    query,
    actorContext,
    targetOrganizationId: "org-test-scope",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_boundary_violation");
  assert.equal(result.blockers[0].blocking_reason, "missing_tenant_context");
  assert.equal(calls.length, 0);
});

test("tenant helper SQL source is SELECT-only and tenant tests use injected query functions", () => {
  assert.match(ACTIVE_ORGANIZATION_MEMBERSHIP_SQL, /^SELECT organization_id, user_id, role_name, membership_status/);
  assert.doesNotMatch(ACTIVE_ORGANIZATION_MEMBERSHIP_SQL, /\b(?:INSERT|UPDATE|DELETE|UPSERT|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i);
  assert.match(tenantAuthorizationTestSource, /createMembershipQuery/);
  assert.match(tenantAuthorizationTestSource, /authorizeSprint2TenantMembershipWithLookup/);
});

test("tenant helper has no DB module import, DB pool initialization, or live DB test import", () => {
  assert.doesNotMatch(tenantAuthorizationSource, /from\s+["'][^"']*(?:kaiDb|db\/pg|kaiQueries)\.js["']/);
  assert.doesNotMatch(tenantAuthorizationSource, /\bconnect\s*\(|\bnew\s+Pool\b/);
  assert.doesNotMatch(tenantAuthorizationTestSource, /import\s+[\s\S]*["'][^"']*Backend\/kai\/db\/kaiDb\.js["']/);
  assert.doesNotMatch(tenantAuthorizationTestSource, /import\s+[\s\S]*["'][^"']*Backend\/db\/pg\.js["']/);
  assert.doesNotMatch(tenantAuthorizationTestSource, /\bnew\s+Pool\b/);
});
