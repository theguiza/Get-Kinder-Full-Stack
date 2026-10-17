import test from "node:test";
import assert from "node:assert/strict";
import pool from "../Backend/db/pg.js";
import { resolveOrgScope, resolveOrgScopeForUserId, setSessionActiveOrg } from "../services/orgScopeService.js";
import { resolveEffectiveClientOrganizationMembershipsForLegacyUser } from "../Backend/kai/auth/gkOrganizationBindingAuthority.js";

/**
 * Get Kinder organization authority precedence (services/orgScopeService.js)
 * and its KAI client_admin projection: an explicit membership row for an
 * organization decides over the legacy public.userdata org_rep/org_id fields;
 * the legacy link counts only for an organization with no row at all.
 * The pool is replaced by an in-memory public schema.
 */

const ORG_A = 11;
const ORG_B = 12;
const ORG_C = 13;
const KAI_BY_GK = new Map([[ORG_A, "kai-a"], [ORG_B, "kai-b"], [ORG_C, "kai-c"]]);
const state = { users: [], memberships: [], organizations: [] };

pool.query = async (rawSql, params = []) => {
  const sql = (typeof rawSql === "string" ? rawSql : rawSql?.text ?? "").replace(/\s+/g, " ").trim();
  if (sql.startsWith("SELECT to_regclass('public.user_org_memberships')")) {
    return { rows: [{ table_name: "user_org_memberships" }] };
  }
  if (sql.startsWith("SELECT id, org_id, org_rep FROM public.userdata") || sql.startsWith("SELECT org_id FROM public.userdata")) {
    return { rows: state.users.filter((user) => String(user.id) === String(params[0])) };
  }
  if (sql.includes("FROM public.user_org_memberships m LEFT JOIN public.organizations o")) {
    return {
      rows: state.memberships
        .filter((m) => String(m.user_id) === String(params[0]))
        .filter((m) => !/COALESCE\(m\.is_active, true\) = true/.test(sql) || m.is_active !== false)
        .map((m) => ({ org_id: m.org_id, role: m.role ?? "admin", is_active: m.is_active ?? true, org_name: `Org ${m.org_id}`, org_status: "approved" })),
    };
  }
  if (sql.startsWith("SELECT id, name, status FROM public.organizations")) {
    return { rows: state.organizations.filter((o) => o.id === Number(params[0])) };
  }
  if (sql.startsWith("SELECT user_id AS id FROM public.user_org_memberships")) {
    return { rows: state.memberships.filter((m) => m.org_id === Number(params[0]) && m.is_active !== false).map((m) => ({ id: m.user_id })) };
  }
  throw new Error(`unexpected query: ${sql}`);
};

function given({ legacy = null, memberships = [] }) {
  state.organizations = [ORG_A, ORG_B, ORG_C].map((id) => ({ id, name: `Org ${id}`, status: "approved" }));
  state.users = [{ id: 7, org_rep: legacy !== null, org_id: legacy }];
  state.memberships = memberships.map(([orgId, role, isActive]) => ({ user_id: 7, org_id: orgId, role, is_active: isActive }));
}

async function authorityOf(userId = 7) {
  const scope = await resolveOrgScopeForUserId(userId, { includeOrgMembersForOrgRep: false });
  const derived = await resolveEffectiveClientOrganizationMembershipsForLegacyUser(userId, {
    listActiveGkOrganizationBindingsForGkOrganizationIds: async (ids) =>
      ids.map((id) => ({ gk_organization_id: id, kai_organization_id: KAI_BY_GK.get(id), status: "active" })),
  });
  return {
    organizations: scope.memberships.map((m) => [m.orgId, m.role]),
    activeOrganization: scope.orgId,
    representativeAccess: scope.hasOrgRepAccess,
    clientAdminOf: derived.filter((m) => m.role_name === "client_admin").map((m) => m.organization_id),
  };
}

test("A: an active admin membership grants its organization, with or without the legacy fields", async () => {
  given({ legacy: ORG_A, memberships: [[ORG_A, "admin", true]] });
  assert.deepEqual(await authorityOf(), { organizations: [[ORG_A, "admin"]], activeOrganization: ORG_A, representativeAccess: true, clientAdminOf: ["kai-a"] });
  given({ memberships: [[ORG_A, "admin", null]] });
  assert.deepEqual((await authorityOf()).clientAdminOf, ["kai-a"], "a NULL is_active counts as active, as before");
});

test("B: an inactive membership for the legacy organization is not overridden by org_rep/org_id", async () => {
  given({ legacy: ORG_A, memberships: [[ORG_A, "admin", false]] });
  assert.deepEqual(await authorityOf(), { organizations: [], activeOrganization: null, representativeAccess: false, clientAdminOf: [] });
});

test("C: an active non-admin membership keeps its own role; the legacy fields do not make it admin", async () => {
  given({ legacy: ORG_A, memberships: [[ORG_A, "member", true]] });
  assert.deepEqual(await authorityOf(), { organizations: [[ORG_A, "member"]], activeOrganization: ORG_A, representativeAccess: true, clientAdminOf: [] });
});

test("D: legacy-only administration (no membership row for that organization) is kept", async () => {
  given({ legacy: ORG_A });
  assert.deepEqual(await authorityOf(), { organizations: [[ORG_A, "admin"]], activeOrganization: ORG_A, representativeAccess: true, clientAdminOf: ["kai-a"] });
  given({ legacy: ORG_A, memberships: [[ORG_C, "admin", false]] });
  assert.deepEqual((await authorityOf()).clientAdminOf, ["kai-a"], "a deactivation for another organization does not revoke the legacy one");
});

test("E: deactivating the legacy organization's membership leaves another organization's active admin membership in force", async () => {
  given({ legacy: ORG_A, memberships: [[ORG_A, "admin", false], [ORG_B, "admin", true]] });
  assert.deepEqual(await authorityOf(), { organizations: [[ORG_B, "admin"]], activeOrganization: ORG_B, representativeAccess: true, clientAdminOf: ["kai-b"] });
});

test("E: a session's stale active organization and an explicit switch to a deactivated one are refused", async () => {
  given({ legacy: ORG_A, memberships: [[ORG_A, "admin", false], [ORG_B, "admin", true]] });
  const req = { user: { id: 7 }, session: { activeOrgId: String(ORG_A) } };
  const scope = await resolveOrgScope(req, { includeOrgMembersForOrgRep: false });
  assert.equal(scope.orgId, ORG_B);
  assert.equal(req.session.activeOrgId, String(ORG_B), "the session's active organization is replaced");
  assert.deepEqual(await setSessionActiveOrg(req, ORG_A, { allowAdminPreview: false }), { ok: false, error: "forbidden" });

  given({ legacy: ORG_A, memberships: [[ORG_A, "admin", false]] });
  const revoked = { user: { id: 7 }, session: { activeOrgId: String(ORG_A) } };
  const revokedScope = await resolveOrgScope(revoked, { includeOrgMembersForOrgRep: false });
  assert.deepEqual([revokedScope.orgId, revokedScope.hasOrgRepAccess], [null, false]);
  assert.equal(revoked.session.activeOrgId, undefined, "no stale organization survives in the session");
});
