import test from "node:test";
import assert from "node:assert/strict";

import { resolveAuthorizedHumanRole } from "../Backend/kai/auth/kaiAuthorizedRoleAttribution.js";

const allowedRoles = new Set(["gk_admin", "gk_reviewer"]);

test("resolves the actor's active org-scoped membership role when it is allowed", () => {
  const role = resolveAuthorizedHumanRole({
    actorContext: { kaiRoles: [] },
    auth: { ok: true, memberships: [{ organization_id: "org-1", role_name: "gk_reviewer", membership_status: "active" }] },
    allowedRoles,
  });

  assert.equal(role, "gk_reviewer");
});

test("falls back to a matching global KAI role when no membership role matches", () => {
  const role = resolveAuthorizedHumanRole({
    actorContext: { kaiRoles: ["gk_admin"] },
    auth: { ok: true, memberships: [] },
    allowedRoles,
  });

  assert.equal(role, "gk_admin");
});

test("attributes gk_admin only via a recognized platform-superuser authorization result", () => {
  const role = resolveAuthorizedHumanRole({
    actorContext: { kaiRoles: [] },
    auth: {
      ok: true,
      memberships: [],
      platformSuperuserAuthorized: true,
      platformSuperuserAuthority: "get_kinder_site_admin",
    },
    allowedRoles,
  });

  assert.equal(role, "gk_admin");
});

test("fails closed (null) when auth did not succeed", () => {
  const role = resolveAuthorizedHumanRole({
    actorContext: { kaiRoles: ["gk_admin"] },
    auth: { ok: false },
    allowedRoles,
  });

  assert.equal(role, null);
});

test("does not attribute gk_admin from a platform-superuser-shaped authority that isn't the recognized source", () => {
  const role = resolveAuthorizedHumanRole({
    actorContext: { kaiRoles: [] },
    auth: {
      ok: true,
      memberships: [],
      platformSuperuserAuthorized: true,
      platformSuperuserAuthority: "some_other_authority",
    },
    allowedRoles,
  });

  assert.equal(role, null);
});

test("does not attribute gk_admin when the operation's allowedRoles does not include gk_admin", () => {
  const role = resolveAuthorizedHumanRole({
    actorContext: { kaiRoles: [] },
    auth: {
      ok: true,
      memberships: [],
      platformSuperuserAuthorized: true,
      platformSuperuserAuthority: "get_kinder_site_admin",
    },
    allowedRoles: new Set(["gk_reviewer"]),
  });

  assert.equal(role, null);
});

test("never returns gk_admin unconditionally: a plain authorized actor with no matching role and no platform-superuser authorization resolves to null", () => {
  const role = resolveAuthorizedHumanRole({
    actorContext: { kaiRoles: ["client_contributor"] },
    auth: { ok: true, memberships: [{ organization_id: "org-1", role_name: "client_contributor", membership_status: "active" }] },
    allowedRoles,
  });

  assert.equal(role, null);
});
