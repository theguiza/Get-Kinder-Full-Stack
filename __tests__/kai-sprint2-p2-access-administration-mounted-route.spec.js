import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";

import {
  validateActorCanPerformOperation,
  validateActorCanPerformPlatformOperation,
} from "../Backend/kai/auth/kaiAuthorizationService.js";
import {
  KAI_ACCESS_ADMINISTRATION_OPERATIONS,
  KAI_ASSIGNABLE_ORGANIZATION_ROLES,
  KAI_ASSIGNABLE_GLOBAL_ROLES,
  KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS,
  KAI_INACTIVE_ORGANIZATION_MEMBERSHIP_STATUS,
} from "../Backend/kai/config/kaiAccessAdministrationContract.js";
import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import {
  requireKaiSprint2Authenticated,
  createAttachKaiSprint2ActorContext,
} from "../Backend/kai/middleware/kaiSprint2Authentication.js";

/**
 * P2 access-administration MOUNTED-ROUTE proof.
 *
 * Everything else Package 2 has already proven the authorization/write
 * semantics of Backend/kai/services/kaiAccessAdministrationService.js
 * directly (kai-sprint2-p2-access-administration.spec.js) and against a real
 * local Postgres (kai-sprint2-p2-access-administration.integration.spec.js).
 * Neither of those exercises the actual mounted Express composition: the
 * exact index.js app.use(...) chain, requireKaiSprint2Enabled,
 * requireKaiSprint2Authenticated, or the route handlers in
 * Backend/kai/routes/kaiAccessAdministrationApi.js.
 *
 * This file closes that gap. It:
 *  - stubs only the service-layer boundary (viewEffectiveKaiAccess,
 *    manageOrganizationMembership, manageGlobalKaiRole) through the route's
 *    own setAccessAdministrationServiceForTest(service) injection seam
 *    (Backend/kai/routes/kaiAccessAdministrationApi.js __testables), which
 *    follows the exact setXServiceForTest(service)/getXService() idiom
 *    already established for every other Package 1/2/3 KAI route (see
 *    Backend/kai/routes/sprint2IntakeApi.js). Zero real DB access ever
 *    occurs and the real service module is never called;
 *  - reuses the REAL production authorization functions
 *    (validateActorCanPerformOperation / validateActorCanPerformPlatformOperation)
 *    *inside* the fakes to decide allow/deny, so no parallel test-only
 *    authorization logic is invented;
 *  - reuses the REAL resolveKaiActorContext (Backend/kai/auth/kaiActorContext.js)
 *    via its own supported dependencies parameter to resolve the actor
 *    context from a fake authenticated req.user, so platform-superuser
 *    (req.user.is_admin / ADMIN_EMAILS) resolution runs through the real
 *    production path;
 *  - assembles a real Express app and drives it over real HTTP, mounting the
 *    exact requireKaiSprint2Enabled / requireKaiSprint2Authenticated /
 *    kaiAccessAdministrationApiRouter chain used in index.js.
 */

const ROUTE_SOURCE = readFileSync(
  new URL("../Backend/kai/routes/kaiAccessAdministrationApi.js", import.meta.url),
  "utf8",
);
const INDEX_SOURCE = readFileSync(new URL("../index.js", import.meta.url), "utf8");

const BASE_PATH = "/api/kai/sprint2/access-administration";
const ORG_A = "org-aaaa-mounted";
const ORG_B = "org-bbbb-mounted";

const { VIEW_KAI_ACCESS, MANAGE_ORGANIZATION_MEMBERSHIP, MANAGE_GLOBAL_KAI_ROLE } =
  KAI_ACCESS_ADMINISTRATION_OPERATIONS;
const ORG_ADMIN_ALLOWED_ROLES = new Set(["client_admin"]);

// ---------------------------------------------------------------------------
// Mutable scenario indirection: the injected fake service functions are
// registered exactly once via setAccessAdministrationServiceForTest below.
// Every test reassigns `currentScenario` rather than re-registering, exactly
// mirroring the existing repo pattern in
// __tests__/kai-sprint2-p2-01-evidence-extraction-route.spec.js.
// ---------------------------------------------------------------------------
let currentScenario;

function baseActorDependencies({ storedMemberships = [], derivedMemberships = [], kaiRoles = [] } = {}) {
  return {
    async findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId, email }) {
      return {
        user_id: `kai-user-${legacyPublicUserdataId}`,
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: legacyPublicUserdataId,
        status: "active",
        email: email || null,
      };
    },
    async listKaiRolesForUser() {
      return kaiRoles;
    },
    async listOrganizationMembershipsForUser() {
      return storedMemberships;
    },
    async resolveEffectiveClientOrganizationMembershipsForLegacyUser() {
      return derivedMemberships;
    },
  };
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    user: { id: 900, email: "actor@example.com" },
    actorDependencies: baseActorDependencies(),
    calls: { view: [], manageMembership: [], manageGlobalRole: [] },
    viewData: null,
    membershipMutationSeamCalls: 0,
    globalRoleMutationSeamCalls: 0,
    ...overrides,
  };
}

async function fakeViewEffectiveKaiAccess(input) {
  currentScenario.calls.view.push(input);
  const { actorContext, organizationId } = input;
  const authResult = validateActorCanPerformOperation(actorContext, VIEW_KAI_ACCESS, organizationId, {
    allowedRoles: ORG_ADMIN_ALLOWED_ROLES,
  });
  if (!authResult.ok) {
    return { ok: false, data: null, error: { code: authResult.error_code }, blockers: authResult.blockers || [] };
  }
  return {
    ok: true,
    data: currentScenario.viewData ?? { organization_id: organizationId, access: [] },
    error: null,
    warnings: [],
  };
}

async function fakeManageOrganizationMembership(input) {
  currentScenario.calls.manageMembership.push(input);
  const { actorContext, organizationId, targetLegacyPublicUserdataId, roleName, membershipStatus } = input;

  if (
    !Number.isInteger(targetLegacyPublicUserdataId) ||
    targetLegacyPublicUserdataId <= 0 ||
    !KAI_ASSIGNABLE_ORGANIZATION_ROLES.includes(roleName) ||
    (membershipStatus !== KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS &&
      membershipStatus !== KAI_INACTIVE_ORGANIZATION_MEMBERSHIP_STATUS)
  ) {
    return { ok: false, data: null, error: { code: "validation_blocker" } };
  }

  const authResult = validateActorCanPerformOperation(actorContext, MANAGE_ORGANIZATION_MEMBERSHIP, organizationId, {
    allowedRoles: ORG_ADMIN_ALLOWED_ROLES,
  });
  if (!authResult.ok) {
    return { ok: false, data: null, error: { code: authResult.error_code }, blockers: authResult.blockers || [] };
  }

  currentScenario.membershipMutationSeamCalls += 1;
  return {
    ok: true,
    data: {
      organization_id: organizationId,
      user_id: "mock-kai-user",
      legacy_public_userdata_id: targetLegacyPublicUserdataId,
      role_name: roleName,
      membership_status: membershipStatus,
      replayed: false,
    },
    warnings: [],
  };
}

async function fakeManageGlobalKaiRole(input) {
  currentScenario.calls.manageGlobalRole.push(input);
  const { actorContext, targetLegacyPublicUserdataId, roleName, action } = input;

  if (
    !Number.isInteger(targetLegacyPublicUserdataId) ||
    targetLegacyPublicUserdataId <= 0 ||
    !KAI_ASSIGNABLE_GLOBAL_ROLES.includes(roleName) ||
    (action !== "assign" && action !== "revoke")
  ) {
    return { ok: false, data: null, error: { code: "validation_blocker" } };
  }

  const authResult = validateActorCanPerformPlatformOperation(actorContext, MANAGE_GLOBAL_KAI_ROLE);
  if (!authResult.ok) {
    return { ok: false, data: null, error: { code: authResult.error_code }, blockers: authResult.blockers || [] };
  }

  currentScenario.globalRoleMutationSeamCalls += 1;
  return {
    ok: true,
    data: {
      user_id: "mock-kai-user",
      legacy_public_userdata_id: targetLegacyPublicUserdataId,
      role_name: roleName,
      action,
      replayed: false,
    },
    warnings: [],
  };
}

const {
  default: kaiAccessAdministrationApiRouter,
  __testables: { setAccessAdministrationServiceForTest },
} = await import("../Backend/kai/routes/kaiAccessAdministrationApi.js");

setAccessAdministrationServiceForTest({
  viewEffectiveKaiAccess: fakeViewEffectiveKaiAccess,
  manageOrganizationMembership: fakeManageOrganizationMembership,
  manageGlobalKaiRole: fakeManageGlobalKaiRole,
});

function createAssembledApplication() {
  const app = express();
  app.use(express.json());

  // Scaffolding: stand in for Passport's req.isAuthenticated()/req.user, and
  // resolve the actor context through the REAL resolveKaiActorContext using
  // its own supported dependencies parameter (fed from currentScenario) so
  // that no real DB call ever happens while every actor-context resolution
  // rule (JIT mapping, platformSuperuser via is_admin/ADMIN_EMAILS, derived
  // gk_organization_binding client_admin) runs for real.
  app.use(BASE_PATH, (req, res, next) => {
    req.isAuthenticated = () => currentScenario.authenticated;
    if (currentScenario.authenticated) req.user = currentScenario.user;
    next();
  });
  const testAttachActorContext = createAttachKaiSprint2ActorContext({
    resolveActorContext: (req) => resolveKaiActorContext(req, currentScenario.actorDependencies),
  });
  app.use(BASE_PATH, requireKaiSprint2Enabled, requireKaiSprint2Authenticated, testAttachActorContext);

  // This is the exact production mount from index.js. Because
  // testAttachActorContext above already set req.kaiSprint2ActorContext, the
  // router's own internal attachKaiSprint2ActorContext instance below is a
  // documented no-op idempotent pass-through (see its own docstring) - the
  // enabled/authenticated checks and the route handlers below are the real,
  // unmodified production code path.
  app.use(BASE_PATH, requireKaiSprint2Enabled, requireKaiSprint2Authenticated, kaiAccessAdministrationApiRouter);
  return app;
}

async function listen(app) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function requestJson(server, path, { body = null, method = "GET" } = {}) {
  const { port } = server.address();
  const serialized = body == null ? null : JSON.stringify(body);
  return await new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: serialized
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(serialized) }
          : {},
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      },
    );
    request.on("error", reject);
    if (serialized) request.write(serialized);
    request.end();
  });
}

function storedClientAdminActorDeps(organizationId, roleName = "client_admin") {
  return baseActorDependencies({
    storedMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: "active" }],
  });
}

// --- 1. Mount, path, methods, middleware order ------------------------------

test("boundary 1: exact production mount path + methods + middleware order", () => {
  assert.match(
    INDEX_SOURCE,
    /app\.use\(\s*"\/api\/kai\/sprint2\/access-administration",\s*requireKaiSprint2Enabled,\s*requireKaiSprint2Authenticated,\s*kaiAccessAdministrationApiRouter\s*\)/,
    "index.js must mount the router at the exact path behind requireKaiSprint2Enabled then requireKaiSprint2Authenticated",
  );

  const routeLayers = kaiAccessAdministrationApiRouter.stack.filter((layer) => layer.route);
  assert.equal(
    routeLayers.filter((l) => l.route.path === "/organizations/:organizationId/access" && l.route.methods.get)
      .length,
    1,
  );
  assert.equal(
    routeLayers.filter(
      (l) =>
        l.route.path === "/organizations/:organizationId/memberships/:legacyPublicUserdataId" &&
        l.route.methods.put,
    ).length,
    1,
  );
  assert.equal(
    routeLayers.filter((l) => l.route.path === "/global-roles/:legacyPublicUserdataId" && l.route.methods.put)
      .length,
    1,
  );

  const layerNames = kaiAccessAdministrationApiRouter.stack.map((l) => l.name);
  const enabledIdx = layerNames.indexOf("requireKaiSprint2Enabled");
  const authIdx = layerNames.indexOf("requireKaiSprint2Authenticated");
  const actorIdx = layerNames.indexOf("attachKaiSprint2ActorContext");
  const firstRouteIdx = kaiAccessAdministrationApiRouter.stack.findIndex((l) => l.route);
  assert.ok(enabledIdx >= 0, "requireKaiSprint2Enabled must be mounted inside the router");
  assert.ok(authIdx > enabledIdx, "requireKaiSprint2Authenticated must run after requireKaiSprint2Enabled");
  assert.ok(actorIdx > authIdx, "attachKaiSprint2ActorContext must run after requireKaiSprint2Authenticated");
  assert.ok(firstRouteIdx > actorIdx, "route handlers must run after the actor context is attached");
});

// --- 11. Route layering: no SQL, no kai.* access, service-layer only -------

test("boundary 11: route file contains no SQL, no kai.* access, and calls through the service layer only", () => {
  assert.doesNotMatch(ROUTE_SOURCE, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,200}\bkai\./i);
  assert.doesNotMatch(ROUTE_SOURCE, /\bkai\.(?!js\b)[a-z_]+\b/i);
  assert.doesNotMatch(ROUTE_SOURCE, /from\s+["'][^"']*(?:kaiDb|kaiQueries|kaiAccessAdministrationQueries)\.js["']/);
  assert.doesNotMatch(ROUTE_SOURCE, /\bnew\s+Pool\b|\bpool\.query\b/);
  assert.match(ROUTE_SOURCE, /from\s+["']\.\.\/services\/kaiAccessAdministrationService\.js["']/);
  assert.match(ROUTE_SOURCE, /\bviewEffectiveKaiAccess\(/);
  assert.match(ROUTE_SOURCE, /\bmanageOrganizationMembership\(/);
  assert.match(ROUTE_SOURCE, /\bmanageGlobalKaiRole\(/);
});

test("boundary 1b (ordering runtime proof): disabled feature wins over unauthenticated - enabled check runs first", async (t) => {
  currentScenario = createScenario({ authenticated: false });
  const originalEnabled = process.env.KAI_SPRINT2_ENABLED;
  const originalAdminEmails = process.env.ADMIN_EMAILS;
  process.env.KAI_SPRINT2_ENABLED = "false";
  process.env.ADMIN_EMAILS = "";
  const app = createAssembledApplication();
  const server = await listen(app);
  t.after(async () => {
    if (originalEnabled === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalEnabled;
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  const response = await requestJson(server, `${BASE_PATH}/organizations/${ORG_A}/access`);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error.code, "feature_disabled");
  assert.deepEqual(currentScenario.calls.view, []);
});

// --- Main scenario suite (shares one server) --------------------------------

test("P2 access-administration mounted route", async (t) => {
  const originalEnabled = process.env.KAI_SPRINT2_ENABLED;
  const originalAdminEmails = process.env.ADMIN_EMAILS;
  process.env.KAI_SPRINT2_ENABLED = "true";
  process.env.ADMIN_EMAILS = ""; // isolate: no local .env ADMIN_EMAILS value may leak into these tests
  currentScenario = createScenario();
  const app = createAssembledApplication();
  const server = await listen(app);

  t.after(async () => {
    if (originalEnabled === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalEnabled;
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  // --- 2. KAI_SPRINT2_ENABLED disabled -------------------------------------

  await t.test("boundary 2: feature-disabled response has zero mutation/audit side effect on every route", async () => {
    const original = process.env.KAI_SPRINT2_ENABLED;
    process.env.KAI_SPRINT2_ENABLED = "false";
    currentScenario = createScenario();
    try {
      const viewResp = await requestJson(server, `${BASE_PATH}/organizations/${ORG_A}/access`);
      const putMembershipResp = await requestJson(server, `${BASE_PATH}/organizations/${ORG_A}/memberships/4201`, {
        method: "PUT",
        body: { role_name: "client_admin", membership_status: "active" },
      });
      const putGlobalResp = await requestJson(server, `${BASE_PATH}/global-roles/4201`, {
        method: "PUT",
        body: { role_name: "gk_admin", action: "assign" },
      });
      for (const resp of [viewResp, putMembershipResp, putGlobalResp]) {
        assert.equal(resp.statusCode, 403);
        assert.equal(resp.body.error.code, "feature_disabled");
      }
      assert.deepEqual(currentScenario.calls.view, []);
      assert.deepEqual(currentScenario.calls.manageMembership, []);
      assert.deepEqual(currentScenario.calls.manageGlobalRole, []);
      assert.equal(currentScenario.membershipMutationSeamCalls, 0);
      assert.equal(currentScenario.globalRoleMutationSeamCalls, 0);
    } finally {
      process.env.KAI_SPRINT2_ENABLED = original;
    }
  });

  // --- 3. Unauthenticated / authenticated-but-unauthorized -----------------

  await t.test("boundary 3a: unauthenticated request cannot reach mutation", async () => {
    currentScenario = createScenario({ authenticated: false });
    const response = await requestJson(server, `${BASE_PATH}/organizations/${ORG_A}/memberships/4202`, {
      method: "PUT",
      body: { role_name: "client_admin", membership_status: "active" },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, "unauthorized");
    assert.deepEqual(currentScenario.calls.manageMembership, []);
    assert.equal(currentScenario.membershipMutationSeamCalls, 0);
  });

  await t.test("boundary 3b: authenticated-but-unauthorized actor fails through canonical authorization error, zero mutation", async () => {
    currentScenario = createScenario({
      user: { id: 901, email: "no-role@example.com" },
      actorDependencies: baseActorDependencies({ storedMemberships: [] }),
    });
    const response = await requestJson(server, `${BASE_PATH}/organizations/${ORG_A}/memberships/4203`, {
      method: "PUT",
      body: { role_name: "client_admin", membership_status: "active" },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "authorization_denied");
    assert.equal(currentScenario.calls.manageMembership.length, 1, "service was reached (real auth denial happened inside it)");
    assert.equal(currentScenario.membershipMutationSeamCalls, 0);
  });

  // --- 4. Own-org client_admin succeeds ------------------------------------

  await t.test("boundary 4: own-org client_admin succeeds, server-derived actor context reaches the service, mutation seam invoked exactly once", async () => {
    currentScenario = createScenario({
      user: { id: 902, email: "org-a-admin@example.com" },
      actorDependencies: storedClientAdminActorDeps(ORG_A),
    });
    const response = await requestJson(server, `${BASE_PATH}/organizations/${ORG_A}/memberships/4204`, {
      method: "PUT",
      body: { role_name: "client_reviewer", membership_status: "active" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(currentScenario.calls.manageMembership.length, 1);
    assert.equal(currentScenario.membershipMutationSeamCalls, 1);
    const call = currentScenario.calls.manageMembership[0];
    assert.equal(call.organizationId, ORG_A);
    assert.equal(call.actorContext.actorUserId, "kai-user-902");
    assert.match(call.now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "now must be server-generated");
  });

  // --- 5. Cross-org client_admin fails, zero mutation ----------------------

  await t.test("boundary 5: cross-org client_admin (same actor, org B) authorization fails, mutation seam never invoked", async () => {
    currentScenario = createScenario({
      user: { id: 903, email: "org-a-admin-2@example.com" },
      actorDependencies: storedClientAdminActorDeps(ORG_A),
    });
    const response = await requestJson(server, `${BASE_PATH}/organizations/${ORG_B}/memberships/4205`, {
      method: "PUT",
      body: { role_name: "client_reviewer", membership_status: "active" },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "authorization_denied");
    assert.equal(currentScenario.membershipMutationSeamCalls, 0);
  });

  // --- 6. Platform superuser (is_admin and ADMIN_EMAILS, isolated) ---------

  await t.test("boundary 6a: platform superuser via req.user.is_admin can administer org membership and an allowed global GK role", async () => {
    currentScenario = createScenario({
      user: { id: 904, email: "site-admin@example.com", is_admin: true },
      actorDependencies: baseActorDependencies(),
    });
    const membershipResp = await requestJson(server, `${BASE_PATH}/organizations/${ORG_A}/memberships/4206`, {
      method: "PUT",
      body: { role_name: "client_admin", membership_status: "active" },
    });
    assert.equal(membershipResp.statusCode, 200);
    assert.equal(currentScenario.calls.manageMembership.at(-1).actorContext.platformSuperuser, true);

    const globalRoleResp = await requestJson(server, `${BASE_PATH}/global-roles/4206`, {
      method: "PUT",
      body: { role_name: "gk_admin", action: "assign" },
    });
    assert.equal(globalRoleResp.statusCode, 200);
    assert.equal(currentScenario.globalRoleMutationSeamCalls, 1);
  });

  await t.test("boundary 6b (isolated): ADMIN_EMAILS fallback works on its own and does not bleed into other cases", async () => {
    const originalAdmin = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "legacy-admin@example.com";
    try {
      currentScenario = createScenario({
        user: { id: 905, email: "legacy-admin@example.com" }, // no is_admin flag
        actorDependencies: baseActorDependencies(),
      });
      const response = await requestJson(server, `${BASE_PATH}/organizations/${ORG_A}/memberships/4207`, {
        method: "PUT",
        body: { role_name: "client_admin", membership_status: "active" },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(currentScenario.calls.manageMembership.at(-1).actorContext.platformSuperuser, true);
    } finally {
      process.env.ADMIN_EMAILS = originalAdmin;
    }

    // Isolation proof: the same email, without the env var set, is ordinary.
    currentScenario = createScenario({
      user: { id: 905, email: "legacy-admin@example.com" },
      actorDependencies: baseActorDependencies(),
    });
    const response = await requestJson(server, `${BASE_PATH}/organizations/${ORG_A}/memberships/4207`, {
      method: "PUT",
      body: { role_name: "client_admin", membership_status: "active" },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "authorization_denied");
  });

  // --- 7. client_admin cannot manage global GK roles -----------------------

  await t.test("boundary 7: client_admin cannot assign/revoke global GK roles through the mounted global-role route, zero mutation", async () => {
    currentScenario = createScenario({
      user: { id: 906, email: "org-a-admin-3@example.com" },
      actorDependencies: storedClientAdminActorDeps(ORG_A),
    });
    const response = await requestJson(server, `${BASE_PATH}/global-roles/4208`, {
      method: "PUT",
      body: { role_name: "gk_admin", action: "assign" },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, "authorization_denied");
    assert.equal(currentScenario.globalRoleMutationSeamCalls, 0);
  });

  // --- 8. Actor-authority injection attempts are ignored -------------------

  await t.test("boundary 8: body/query/path actor-authority injection fields never override the server-authenticated actor context", async () => {
    currentScenario = createScenario({
      user: { id: 907, email: "org-a-admin-4@example.com" },
      actorDependencies: storedClientAdminActorDeps(ORG_A),
    });
    const response = await requestJson(
      server,
      `${BASE_PATH}/organizations/${ORG_A}/memberships/4209?actorUserId=attacker&platformSuperuser=true`,
      {
        method: "PUT",
        body: {
          role_name: "client_reviewer",
          membership_status: "active",
          actorUserId: "attacker",
          kaiRoles: ["gk_admin"],
          organizationMemberships: [{ organization_id: ORG_B, role_name: "client_admin", membership_status: "active" }],
          platformSuperuser: true,
          platformSuperuserAuthority: "get_kinder_site_admin",
          actorContext: { actorType: "human", actorUserId: "attacker", platformSuperuser: true },
        },
      },
    );
    assert.equal(response.statusCode, 200, "legitimate own-org action still succeeds");
    assert.equal(currentScenario.membershipMutationSeamCalls, 1);
    const call = currentScenario.calls.manageMembership.at(-1);
    assert.equal(call.actorContext.actorUserId, "kai-user-907", "server-resolved identity, not the injected value");
    assert.equal(call.actorContext.platformSuperuser, false, "injected platformSuperuser=true was not honored");
    assert.deepEqual(
      call.actorContext.organizationMemberships.some((m) => m.organization_id === ORG_B),
      false,
      "injected organizationMemberships entry for org B was not merged in",
    );
    assert.deepEqual(Object.keys(call).sort(), ["actorContext", "membershipStatus", "now", "organizationId", "roleName", "targetLegacyPublicUserdataId"].sort());
  });

  // --- 9. Derived client_admin remains read-only for identity purposes -----

  await t.test("boundary 9: derived (gk_organization_binding) client_admin can act on its own org, but the mutation call carries no derived-authority write field", async () => {
    currentScenario = createScenario({
      user: { id: 908, email: "derived-admin@example.com" },
      actorDependencies: baseActorDependencies({
        storedMemberships: [],
        derivedMemberships: [
          { organization_id: ORG_A, role_name: "client_admin", membership_status: "active", source: "gk_organization_binding" },
        ],
      }),
    });
    const response = await requestJson(server, `${BASE_PATH}/organizations/${ORG_A}/memberships/4210`, {
      method: "PUT",
      body: {
        role_name: "client_reviewer",
        membership_status: "active",
        source: "gk_organization_binding",
        authority_source: "derived",
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(currentScenario.membershipMutationSeamCalls, 1);
    const call = currentScenario.calls.manageMembership.at(-1);
    assert.ok(
      call.actorContext.organizationMemberships.some(
        (m) => m.organization_id === ORG_A && m.source === "gk_organization_binding",
      ),
      "actor context still shows the membership as derived",
    );
    assert.deepEqual(
      Object.keys(call).sort(),
      ["actorContext", "membershipStatus", "now", "organizationId", "roleName", "targetLegacyPublicUserdataId"].sort(),
      "the route accepts no field that would let a client mark/mutate the derived binding source itself",
    );
  });

  // --- 10. Malformed / disallowed input fails before mutation --------------

  await t.test("boundary 10: malformed/disallowed input fails before mutation, zero mutation in every case", async () => {
    currentScenario = createScenario({
      user: { id: 909, email: "org-a-admin-5@example.com" },
      actorDependencies: storedClientAdminActorDeps(ORG_A),
    });

    // Route-level rejection: non-numeric legacy id never reaches the service at all.
    const badPathResp = await requestJson(server, `${BASE_PATH}/organizations/${ORG_A}/memberships/not-a-number`, {
      method: "PUT",
      body: { role_name: "client_reviewer", membership_status: "active" },
    });
    assert.equal(badPathResp.statusCode, 422);
    assert.equal(badPathResp.body.error.code, "validation_blocker");
    assert.deepEqual(currentScenario.calls.manageMembership, []);

    // Route-level rejection: missing required fields never reach the service.
    const missingFieldsResp = await requestJson(server, `${BASE_PATH}/organizations/${ORG_A}/memberships/4211`, {
      method: "PUT",
      body: {},
    });
    assert.equal(missingFieldsResp.statusCode, 422);
    assert.equal(missingFieldsResp.body.error.code, "validation_blocker");
    assert.deepEqual(currentScenario.calls.manageMembership, []);

    // Service-level rejection using the route's real validation contract: non-assignable role.
    const badRoleResp = await requestJson(server, `${BASE_PATH}/organizations/${ORG_A}/memberships/4212`, {
      method: "PUT",
      body: { role_name: "gk_admin", membership_status: "active" },
    });
    assert.equal(badRoleResp.statusCode, 422);
    assert.equal(badRoleResp.body.error.code, "validation_blocker");
    assert.equal(currentScenario.membershipMutationSeamCalls, 0);

    // Service-level rejection: invalid membership state.
    const badStatusResp = await requestJson(server, `${BASE_PATH}/organizations/${ORG_A}/memberships/4213`, {
      method: "PUT",
      body: { role_name: "client_reviewer", membership_status: "revoked" },
    });
    assert.equal(badStatusResp.statusCode, 422);
    assert.equal(badStatusResp.body.error.code, "validation_blocker");
    assert.equal(currentScenario.membershipMutationSeamCalls, 0);

    // Global-role route: disallowed global role.
    currentScenario = createScenario({
      user: { id: 910, email: "site-admin-2@example.com", is_admin: true },
      actorDependencies: baseActorDependencies(),
    });
    const badGlobalRoleResp = await requestJson(server, `${BASE_PATH}/global-roles/4214`, {
      method: "PUT",
      body: { role_name: "client_admin", action: "assign" },
    });
    assert.equal(badGlobalRoleResp.statusCode, 422);
    assert.equal(badGlobalRoleResp.body.error.code, "validation_blocker");
    assert.equal(currentScenario.globalRoleMutationSeamCalls, 0);
  });
});
