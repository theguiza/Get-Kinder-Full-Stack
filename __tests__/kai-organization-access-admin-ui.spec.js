import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";

import pool from "../Backend/db/pg.js";
import adminApiRouter from "../routes/adminApi.js";
import kaiAccessAdministrationApiRouter from "../Backend/kai/routes/kaiAccessAdministrationApi.js";
import { KAI_ASSIGNABLE_ORGANIZATION_ROLES } from "../Backend/kai/config/kaiAccessAdministrationContract.js";
import {
  KAI_ORGANIZATION_ROLE_OPTIONS,
  adminUserLookupPath,
  buildKaiOrganizationMembershipPayload,
  describeKaiAccessAuthoritySource,
  isAssignableKaiOrganizationRole,
  kaiAccessRowKey,
  kaiOrganizationAccessPath,
  kaiOrganizationMembershipPath,
} from "../frontend/kaiOrganizationAccessLogic.js";

/**
 * Organization-scoped KAI role management, added to the existing
 * /admin -> Organizations UI. This file proves:
 *  - the new read-only GET /api/admin/users/lookup exact-email endpoint
 *    (routes/adminApi.js) is site-superuser-gated, mutates nothing, and
 *    never grants organization-panel admin access;
 *  - GET /api/admin/organizations now also returns each organization's
 *    active KAI organization UUID binding (or null), without changing any
 *    other field or the existing "+Admin" endpoint/behavior;
 *  - the new frontend logic module (frontend/kaiOrganizationAccessLogic.js)
 *    only ever builds requests for the three assignable client roles,
 *    against the exact mounted Package 2 access-administration routes;
 *  - frontend/adminDashboard.jsx's "+Admin" control is unchanged, a
 *    separate "KAI Access" control exists per organization row, and the new
 *    code never manufactures/transmits trusted actor authority.
 */

function withPoolQuery(handler, fn) {
  const originalQuery = pool.query;
  pool.query = handler;
  return fn().finally(() => {
    pool.query = originalQuery;
  });
}

// Simulates an authenticated, non-site-admin session for the ensureAdminApi
// gate (req.user present, is_admin !== true, no ADMIN_EMAILS match).
function nonAdminSessionApp(router) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 42, email: "someone@example.org", is_admin: false };
    next();
  });
  app.use("/api/admin", router);
  return app;
}

function adminSessionApp(router) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, email: "superuser@example.org", is_admin: true };
    next();
  });
  app.use("/api/admin", router);
  return app;
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/api/admin` });
    });
  });
}

let savedAdminEmails;
test.before(() => {
  // AGENTS.md: isolate ADMIN_EMAILS so ambient developer configuration
  // cannot alter site-admin-authority test behavior.
  savedAdminEmails = process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_EMAILS;
});
test.after(() => {
  if (savedAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = savedAdminEmails;
});

test("GET /api/admin/users/lookup is gated by the existing ensureAdminApi site-superuser check", async () => {
  const { server, baseUrl } = await listen(nonAdminSessionApp(adminApiRouter));
  try {
    const response = await fetch(`${baseUrl}/users/lookup?email=exists@example.org`);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, "forbidden");
  } finally {
    server.close();
  }
});

test("GET /api/admin/users/lookup returns only minimum safe fields for an exact existing email, and mutates nothing", async () => {
  const queries = [];
  const { server, baseUrl } = await listen(adminSessionApp(adminApiRouter));
  try {
    await withPoolQuery(async (sql, params) => {
      queries.push({ sql: String(sql), params });
      return {
        rows: [{ id: 501, email: "found@example.org", firstname: "Ada", lastname: "Lovelace" }],
      };
    }, async () => {
      const response = await fetch(`${baseUrl}/users/lookup?email=Found@Example.org`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body, {
        user: { id: 501, email: "found@example.org", firstname: "Ada", lastname: "Lovelace" },
      });
    });
  } finally {
    server.close();
  }
  assert.equal(queries.length, 1, "lookup must issue exactly one query");
  assert.match(queries[0].sql, /^\s*SELECT id, email, firstname, lastname\s+FROM userdata/);
  assert.doesNotMatch(queries[0].sql, /INSERT|UPDATE|DELETE/i);
  assert.deepEqual(queries[0].params, ["found@example.org"]);
});

test("GET /api/admin/users/lookup returns the canonical not-found response for an unknown email, zero mutation", async () => {
  const { server, baseUrl } = await listen(adminSessionApp(adminApiRouter));
  try {
    await withPoolQuery(async () => ({ rows: [] }), async () => {
      const response = await fetch(`${baseUrl}/users/lookup?email=nobody@example.org`);
      assert.equal(response.status, 404);
      const body = await response.json();
      assert.deepEqual(body, { error: "user_not_found" });
    });
  } finally {
    server.close();
  }
});

test("GET /api/admin/users/lookup rejects malformed input without querying the database", async () => {
  const { server, baseUrl } = await listen(adminSessionApp(adminApiRouter));
  let queried = false;
  try {
    await withPoolQuery(async () => {
      queried = true;
      return { rows: [] };
    }, async () => {
      const response = await fetch(`${baseUrl}/users/lookup?email=not-an-email`);
      assert.equal(response.status, 400);
    });
  } finally {
    server.close();
  }
  assert.equal(queried, false);
});

test("GET /api/admin/organizations attaches each organization's active KAI organization UUID binding, and leaves every other field unchanged", async () => {
  const { server, baseUrl } = await listen(adminSessionApp(adminApiRouter));
  try {
    await withPoolQuery(async (sql) => {
      const text = String(sql);
      if (/COUNT\(\*\)::int AS total/.test(text)) return { rows: [{ total: 2 }] };
      if (/FROM organizations o\s+LEFT JOIN userdata u/.test(text) && /SELECT\s+o\.id/.test(text)) {
        return {
          rows: [
            { id: 10, name: "Bound Org", status: "approved", website: null, applied_at: null, approved_at: null, funding_class: "mixed", subsidy_eligible: false, subsidy_cap_percent: null, manual_override_only: false, funding_notes: null, rep_email: null, rep_firstname: null, rep_lastname: null },
            { id: 11, name: "Unbound Org", status: "approved", website: null, applied_at: null, approved_at: null, funding_class: "mixed", subsidy_eligible: false, subsidy_cap_percent: null, manual_override_only: false, funding_notes: null, rep_email: null, rep_firstname: null, rep_lastname: null },
          ],
        };
      }
      if (/FROM kai\.gk_organization_bindings/.test(text)) {
        return { rows: [{ gk_organization_id: 10, kai_organization_id: "00000000-0000-4000-8000-000000000099" }] };
      }
      throw new Error(`unexpected query: ${text}`);
    }, async () => {
      const response = await fetch(`${baseUrl}/organizations?page=1&limit=50`);
      assert.equal(response.status, 200);
      const body = await response.json();
      const bound = body.data.find((row) => row.id === 10);
      const unbound = body.data.find((row) => row.id === 11);
      assert.equal(bound.kai_organization_id, "00000000-0000-4000-8000-000000000099");
      assert.equal(unbound.kai_organization_id, null);
      // Every previously-existing field survives unchanged.
      assert.equal(bound.name, "Bound Org");
      assert.equal(bound.funding_class, "mixed");
    });
  } finally {
    server.close();
  }
});

test("the existing mutating POST /organizations/:id/admins route is untouched by this feature", () => {
  const routeExists = adminApiRouter.stack.some(
    (layer) => layer.route && layer.route.path === "/organizations/:id/admins" && layer.route.methods.post
  );
  assert.ok(routeExists, "POST /organizations/:id/admins must still exist");
  const source = readFileSync("routes/adminApi.js", "utf8");
  assert.match(source, /adminApiRouter\.post\("\/organizations\/:id\/admins"/);
  assert.match(source, /if \(!member\) \{\s*await client\.query\("ROLLBACK"\);\s*return res\.status\(404\)\.json\(\{ error: "user_not_found" \}\);/);
});

test("frontend logic module only ever builds requests for the three Package 2 assignable client roles", () => {
  assert.deepEqual(KAI_ORGANIZATION_ROLE_OPTIONS, KAI_ASSIGNABLE_ORGANIZATION_ROLES);

  for (const role of ["client_admin", "client_reviewer", "client_contributor"]) {
    assert.equal(isAssignableKaiOrganizationRole(role), true);
    assert.deepEqual(buildKaiOrganizationMembershipPayload(role, "active"), {
      role_name: role,
      membership_status: "active",
    });
  }

  for (const forbidden of ["gk_admin", "gk_operator", "gk_reviewer", "platform_superuser", "totally_made_up_role"]) {
    assert.equal(isAssignableKaiOrganizationRole(forbidden), false);
    assert.throws(() => buildKaiOrganizationMembershipPayload(forbidden, "active"));
  }

  assert.throws(() => buildKaiOrganizationMembershipPayload("client_admin", "deleted"));
});

test("frontend logic module targets the exact mounted Package 2 access-administration routes", () => {
  const getPaths = kaiAccessAdministrationApiRouter.stack
    .filter((layer) => layer.route && layer.route.methods.get)
    .map((layer) => layer.route.path);
  const putPaths = kaiAccessAdministrationApiRouter.stack
    .filter((layer) => layer.route && layer.route.methods.put)
    .map((layer) => layer.route.path);

  assert.ok(getPaths.includes("/organizations/:organizationId/access"));
  assert.ok(putPaths.includes("/organizations/:organizationId/memberships/:legacyPublicUserdataId"));

  const organizationId = "00000000-0000-4000-8000-000000000001";
  assert.equal(
    kaiOrganizationAccessPath(organizationId),
    `/api/kai/sprint2/access-administration/organizations/${organizationId}/access`
  );
  assert.equal(
    kaiOrganizationMembershipPath(organizationId, 501),
    `/api/kai/sprint2/access-administration/organizations/${organizationId}/memberships/501`
  );
  assert.equal(adminUserLookupPath(" Someone@Example.org "), "/api/admin/users/lookup?email=someone%40example.org");
});

test("frontend logic module never builds a request for the mutating +Admin lookup endpoint", () => {
  const source = readFileSync("frontend/kaiOrganizationAccessLogic.js", "utf8");
  assert.doesNotMatch(source, /\/admins`/);
  assert.doesNotMatch(source, /\bDELETE\b/);
  assert.doesNotMatch(source, /gk_admin|gk_operator|gk_reviewer|platform_superuser/);
});

test("describeKaiAccessAuthoritySource distinguishes derived from stored authority for the roster UI", () => {
  assert.equal(describeKaiAccessAuthoritySource("derived"), "Derived (Get Kinder org admin)");
  assert.equal(describeKaiAccessAuthoritySource("both"), "Derived + stored");
  assert.equal(describeKaiAccessAuthoritySource("stored"), "Stored");
  assert.equal(kaiAccessRowKey({ legacy_public_userdata_id: 7 }), "legacy:7");
  assert.equal(kaiAccessRowKey({ kai_user_id: "u1" }), "kai:u1");
  assert.equal(kaiAccessRowKey({ email: "x@example.org" }), "email:x@example.org");
});

test("adminDashboard.jsx keeps the existing +Admin control unchanged and adds a separate KAI Access control per organization row", () => {
  const source = readFileSync("frontend/adminDashboard.jsx", "utf8");

  // +Admin is unchanged: same button text, same handler, same mutating
  // endpoint, same window.prompt-based email entry.
  assert.match(source, />\s*\+Admin\s*</);
  assert.match(source, /onClick=\{\(\) => runOrgAddAdmin\(org\)\}/);
  assert.match(source, /fetch\(`\/api\/admin\/organizations\/\$\{org\.id\}\/admins`/);
  assert.match(source, /window\.prompt\(`Grant org panel access for "\$\{org\.name\}" to which user email\?`\)/);

  // KAI Access is a separate control, not a repurposing of +Admin.
  assert.match(source, />\s*KAI Access\s*</);
  assert.match(source, /onClick=\{\(\) => openKaiAccessModal\(org\)\}/);

  // The modal makes the selected organization explicit.
  assert.match(source, /KAI Access — \{kaiAccessModal\.organizationName\}/);

  // Opening the modal calls the GET access endpoint for the org's KAI
  // organization id, not the Get Kinder organization id.
  assert.match(source, /loadKaiAccess\(org\.id, kaiOrganizationId\)/);
  assert.match(source, /requestJson\(kaiOrganizationAccessPath\(kaiOrganizationId\)\)/);

  // Role assignment/change use the PUT membership endpoint with the
  // resolved legacy user id, and refresh from the server afterward - never
  // fabricate the resulting roster locally.
  assert.match(source, /kaiMutateJson\(kaiOrganizationMembershipPath\(kaiOrganizationId, legacyUserId\), "PUT", payload\)/);
  assert.match(source, /kaiMutateJson\(kaiOrganizationMembershipPath\(kaiOrganizationId, legacyUserId\), "PUT", payload\)/g);
  assert.match(source, /loadKaiAccess\(organizationId, kaiOrganizationId\);/);

  // Email resolution uses the read-only lookup, never the mutating +Admin
  // endpoint, and stops with a clear message when the user does not exist.
  assert.match(source, /requestJson\(adminUserLookupPath\(email\)\)/);
  assert.match(source, /No existing Get Kinder account found for/);

  // No client-manufactured/transmitted trusted authority anywhere in the
  // new KAI Access code (or the file at large).
  assert.doesNotMatch(source, /platformSuperuser|platformSuperuserAuthority|actorContext|kaiRoles|organizationMemberships|actorUserId/);

  // No removal/DELETE was introduced for KAI membership rows.
  assert.doesNotMatch(source, /kaiOrganizationMembershipPath\([^)]*\),\s*"DELETE"/);
});

test("adminDashboard.jsx's KAI Access roster distinguishes derived (read-only) access from editable stored access", () => {
  const source = readFileSync("frontend/adminDashboard.jsx", "utf8");
  assert.match(source, /row\.editable \? \(/);
  assert.match(source, /Derived — not editable here/);
  assert.match(source, /submitKaiAccessRoleChange = useCallback\(/);
  assert.match(source, /if \(!kaiOrganizationId \|\| !legacyUserId \|\| !row\?\.editable\) return;/);
});

test("stale-modal-state protection: loading KAI access for one organization ignores results delivered after the modal moved to a different organization", () => {
  const source = readFileSync("frontend/adminDashboard.jsx", "utf8");
  assert.match(source, /const requestToken = \+\+kaiAccessRequestRef\.current;/);
  assert.match(source, /if \(kaiAccessRequestRef\.current !== requestToken\) return;/);
  assert.match(source, /curr\.organizationId === organizationId/);
});

test("routes/adminApi.js no longer directly imports the KAI organization-binding DB query helper", () => {
  const source = readFileSync("routes/adminApi.js", "utf8");
  assert.doesNotMatch(source, /Backend\/kai\/db\/kaiOrganizationBindingQueries\.js/);
  assert.match(source, /Backend\/kai\/services\/kaiAccessAdminReadService\.js/);
});

test("GET /api/admin/users/lookup handler contains no direct SQL or userdata query call", () => {
  const source = readFileSync("routes/adminApi.js", "utf8");
  const lookupHandlerMatch = source.match(
    /adminApiRouter\.get\("\/users\/lookup"[\s\S]*?\n\}\);/
  );
  assert.ok(lookupHandlerMatch, "expected to find the /users/lookup handler");
  const handlerSource = lookupHandlerMatch[0];
  assert.doesNotMatch(handlerSource, /pool\.query/);
  assert.doesNotMatch(handlerSource, /SELECT/i);
  assert.match(handlerSource, /findExistingGkUserByExactEmail\(email\)/);
});

test("the read service resolves organization bindings via the existing KAI binding query helper, and exact-email users via the new query module", () => {
  const serviceSource = readFileSync("Backend/kai/services/kaiAccessAdminReadService.js", "utf8");
  assert.match(serviceSource, /import \{ listActiveGkOrganizationBindingsForGkOrganizationIds \} from "\.\.\/db\/kaiOrganizationBindingQueries\.js";/);
  assert.match(serviceSource, /import \{ findUserdataRowByExactEmail \} from "\.\.\/db\/gkUserDirectoryQueries\.js";/);
  assert.doesNotMatch(serviceSource, /\.query\(/);
});
