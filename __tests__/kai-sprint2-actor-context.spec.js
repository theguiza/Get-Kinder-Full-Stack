import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ACTIVE_KAI_USER_MAPPING_SQL,
  KAI_USER_ROLE_NAMES_SQL,
  extractSprint2ActorContext,
  findActiveKaiUserMappingByLegacyPublicUserdataId,
  hydrateSprint2ActorContextFromRequest,
  listKaiRoleNamesForActorUser,
} from "../Backend/kai/auth/actorContext.js";

const actorSource = readFileSync("Backend/kai/auth/actorContext.js", "utf8");
const actorTestSource = readFileSync("__tests__/kai-sprint2-actor-context.spec.js", "utf8");

function fakeRequestUser(overrides = {}) {
  return {
    id: 101,
    email: "actor@example.invalid",
    firstname: "Test",
    lastname: "Actor",
    password: "not-returned",
    session: { token: "not-returned" },
    profile: { nested: true },
    ...overrides,
  };
}

function mappingRow(overrides = {}) {
  return {
    user_id: "kai-user-101",
    legacy_identity_source: "public.userdata",
    legacy_public_userdata_id: 101,
    status: "active",
    ...overrides,
  };
}

function createActorQuery({ mapping = mappingRow(), roles = [{ role_name: "gk_admin" }, { role_name: "client_reviewer" }] } = {}) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql === ACTIVE_KAI_USER_MAPPING_SQL) return { rows: mapping ? [mapping] : [] };
    if (sql === KAI_USER_ROLE_NAMES_SQL) return { rows: roles };
    throw new Error("unexpected actor test query");
  };
  return { calls, query };
}

test("actor context fails closed when req.user is missing", () => {
  const result = extractSprint2ActorContext({});

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unauthorized");
  assert.equal(result.error.status, 401);
  assert.equal(result.data, null);
  assert.equal(result.blockers[0].blocking_reason, "missing_authenticated_user");
});

test("pure actor context returns only the safe Sprint 2 identity shape", () => {
  const req = { user: fakeRequestUser() };
  const result = extractSprint2ActorContext(req);

  assert.equal(result.ok, true);
  assert.notEqual(result.actorContext, req.user);
  assert.deepEqual(Object.keys(result.actorContext).sort(), [
    "actorType",
    "legacyIdentitySource",
    "legacyPublicUserdataId",
  ]);
  assert.deepEqual(result.actorContext, {
    actorType: "human",
    legacyIdentitySource: "public.userdata",
    legacyPublicUserdataId: 101,
  });
});

test("DB-backed actor mapping helper maps req.user.id to active legacy_public_userdata_id using injected query", async () => {
  const { calls, query } = createActorQuery();
  const result = await hydrateSprint2ActorContextFromRequest({
    req: { user: fakeRequestUser() },
    query,
    requestId: "req-actor-1c",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], { sql: ACTIVE_KAI_USER_MAPPING_SQL, params: [101] });
  assert.deepEqual(calls[1], { sql: KAI_USER_ROLE_NAMES_SQL, params: ["kai-user-101"] });
  assert.equal(result.actorContext.actorUserId, "kai-user-101");
  assert.equal(result.actorContext.legacyPublicUserdataId, 101);
  assert.equal(result.actorContext.actorType, "human");
  assert.equal(result.actorContext.source, "public.userdata");
  assert.equal(result.actorContext.requestId, "req-actor-1c");
});

test("active kai.users row hydrates safe actor context with role names only", async () => {
  const { query } = createActorQuery({
    roles: [
      { role_name: "gk_admin", email: "role-row-email@example.invalid" },
      { role_name: "client_reviewer", display_name: "Role Row Name" },
      { role_name: "" },
      { role_name: null },
    ],
  });

  const result = await hydrateSprint2ActorContextFromRequest({
    req: { user: fakeRequestUser() },
    query,
    organizationMemberships: [
      {
        organization_id: "org-1",
        user_id: "kai-user-101",
        role_name: "client_reviewer",
        membership_status: "active",
        email: "membership-email@example.invalid",
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.actorContext).sort(), [
    "actorType",
    "actorUserId",
    "kaiRoles",
    "legacyPublicUserdataId",
    "organizationMemberships",
    "requestId",
    "source",
  ]);
  assert.deepEqual(result.actorContext.kaiRoles, ["gk_admin", "client_reviewer"]);
  assert.deepEqual(result.actorContext.organizationMemberships, [
    {
      organizationId: "org-1",
      actorUserId: "kai-user-101",
      roleName: "client_reviewer",
      membershipStatus: "active",
    },
  ]);
});

test("missing kai.users mapping returns mapped_kai_user_required blocker, not a 500", async () => {
  const { calls, query } = createActorQuery({ mapping: null });
  const result = await hydrateSprint2ActorContextFromRequest({
    req: { user: fakeRequestUser() },
    query,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "mapped_kai_user_required");
  assert.equal(result.error.status, 403);
  assert.equal(result.data, null);
  assert.equal(result.blockers[0].blocking_reason, "missing_active_kai_user_mapping");
  assert.equal(calls.length, 1);
});

test("inactive kai.users mapping fails closed", async () => {
  const { calls, query } = createActorQuery({
    mapping: mappingRow({ status: "inactive" }),
  });

  const directLookup = await findActiveKaiUserMappingByLegacyPublicUserdataId({
    query,
    legacyPublicUserdataId: 101,
  });
  assert.equal(directLookup, null);

  const result = await hydrateSprint2ActorContextFromRequest({
    req: { user: fakeRequestUser() },
    query,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "mapped_kai_user_required");
  assert.equal(calls.length, 2);
});

test("role lookup returns only role_name values", async () => {
  const { calls, query } = createActorQuery({
    roles: [{ role_name: "gk_admin", name: "Admin User" }, { role_name: "client_contributor" }],
  });

  const roles = await listKaiRoleNamesForActorUser({ query, actorUserId: "kai-user-101" });

  assert.deepEqual(roles, ["gk_admin", "client_contributor"]);
  assert.deepEqual(calls, [{ sql: KAI_USER_ROLE_NAMES_SQL, params: ["kai-user-101"] }]);
});

test("hydrated actor context does not expose raw req.user or sensitive user/session fields", async () => {
  const { query } = createActorQuery();
  const result = await hydrateSprint2ActorContextFromRequest({
    req: { user: fakeRequestUser() },
    query,
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, true);
  assert.doesNotMatch(serialized, /actor@example\.invalid/);
  assert.doesNotMatch(serialized, /not-returned/);
  assert.doesNotMatch(serialized, /role-row-email@example\.invalid|membership-email@example\.invalid/);
  assert.doesNotMatch(serialized, /\bfirstname\b|\blastname\b|\bemail\b|\bpassword\b|\bsession\b|\bprofile\b/);
});

test("unsupported auth or session shape returns structured unauthorized failure", () => {
  for (const user of [
    null,
    {},
    { id: "101", email: "actor@example.invalid", name: "Test Actor" },
    { id: 101, name: "Test Actor" },
    { id: 101, email: "actor@example.invalid" },
    { sub: 101, email: "actor@example.invalid", name: "Test Actor" },
    { id: 101, email: "actor@example.invalid", provider: "unknown", profile: { name: "Test Actor" } },
  ]) {
    const result = extractSprint2ActorContext({ user });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "unauthorized");
    assert.equal(result.error.status, 401);
    assert.equal(result.data, null);
    assert.ok(result.blockers[0].blocking_reason);
  }
});

test("actor helper SQL source is SELECT-only and actor tests use injected query functions", () => {
  assert.match(ACTIVE_KAI_USER_MAPPING_SQL, /^SELECT user_id, legacy_identity_source, legacy_public_userdata_id, status/);
  assert.match(KAI_USER_ROLE_NAMES_SQL, /^SELECT r\.role_name/);
  assert.doesNotMatch(`${ACTIVE_KAI_USER_MAPPING_SQL}\n${KAI_USER_ROLE_NAMES_SQL}`, /\b(?:INSERT|UPDATE|DELETE|UPSERT|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i);
  assert.match(actorTestSource, /createActorQuery/);
  assert.match(actorTestSource, /hydrateSprint2ActorContextFromRequest/);
});

test("actor helper has no DB module import, DB pool initialization, or live DB test import", () => {
  assert.doesNotMatch(actorSource, /from\s+["'][^"']*(?:kaiDb|db\/pg|kaiQueries)\.js["']/);
  assert.doesNotMatch(actorSource, /\bconnect\s*\(|\bnew\s+Pool\b/);
  assert.doesNotMatch(actorTestSource, /import\s+[\s\S]*["'][^"']*Backend\/kai\/db\/kaiDb\.js["']/);
  assert.doesNotMatch(actorTestSource, /import\s+[\s\S]*["'][^"']*Backend\/db\/pg\.js["']/);
  assert.doesNotMatch(actorTestSource, /\bnew\s+Pool\b/);
});
