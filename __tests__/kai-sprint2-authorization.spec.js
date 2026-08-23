import test from "node:test";
import assert from "node:assert/strict";

import { validateActorCanPerformOperation } from "../Backend/kai/auth/kaiAuthorizationService.js";

const baseActor = {
  actorType: "human",
  actorUserId: "user-1",
  kaiRoles: ["gk_admin"],
  organizationMemberships: [],
};

test("authorization blocks actor outside organization with no gk_admin bypass", () => {
  const result = validateActorCanPerformOperation(baseActor, "create_intake_batch", "org-1");

  assert.equal(result.ok, false);
  assert.equal(result.error_code, "authorization_denied");
  assert.equal(result.blockers[0].blocking_reason, "missing_active_organization_membership");
  assert.equal(result.blockers[0].evidence.bypass_allowed, false);
});

test("platform superuser satisfies central role/membership authorization without synthetic organization membership", () => {
  const result = validateActorCanPerformOperation(
    {
      actorType: "human",
      actorUserId: "platform-user-1",
      kaiRoles: [],
      organizationMemberships: [],
      platformSuperuser: true,
      platformSuperuserAuthority: "get_kinder_site_admin",
    },
    "accept_internal_coverage_limitation",
    "org-1",
    { allowedRoles: new Set(["gk_reviewer"]) },
  );

  assert.equal(result.ok, true);
  assert.equal(result.platformSuperuserAuthorized, true);
  assert.deepEqual(result.memberships, []);
});

test("platform superuser still requires explicit organization context", () => {
  const result = validateActorCanPerformOperation(
    {
      actorType: "human",
      actorUserId: "platform-user-1",
      kaiRoles: [],
      organizationMemberships: [],
      platformSuperuser: true,
      platformSuperuserAuthority: "get_kinder_site_admin",
    },
    "accept_internal_coverage_limitation",
    null,
    { allowedRoles: new Set(["gk_reviewer"]) },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error_code, "tenant_boundary_violation");
  assert.equal(result.blockers[0].blocking_reason, "missing_organization_scope");
});

test("a role named like platform authority does not create platform superuser authorization", () => {
  const result = validateActorCanPerformOperation(
    {
      actorType: "human",
      actorUserId: "ordinary-user-1",
      kaiRoles: ["platform_superuser", "get_kinder_site_admin"],
      organizationMemberships: [],
    },
    "accept_internal_coverage_limitation",
    "org-1",
    { allowedRoles: new Set(["gk_reviewer"]) },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error_code, "authorization_denied");
  assert.equal(result.blockers[0].blocking_reason, "missing_active_organization_membership");
});

test("authorization allows P0 write with global GK role plus active organization membership", () => {
  const result = validateActorCanPerformOperation(
    {
      ...baseActor,
      organizationMemberships: [
        { organization_id: "org-1", role_name: "gk_operator", membership_status: "active" },
      ],
    },
    "create_intake_file",
    "org-1",
  );

  assert.equal(result.ok, true);
});

test("authorization blocks non-admin client roles for P0 write operations", () => {
  for (const roleName of ["client_contributor", "client_reviewer"]) {
    const result = validateActorCanPerformOperation(
      {
        actorType: "human",
        actorUserId: "user-1",
        kaiRoles: [roleName],
        organizationMemberships: [
          { organization_id: "org-1", role_name: roleName, membership_status: "active" },
        ],
      },
      "create_intake_file",
      "org-1",
    );

    assert.equal(result.ok, false);
    assert.equal(result.error_code, "authorization_denied");
    assert.equal(result.blockers[0].blocking_reason, "missing_global_gk_write_role");
  }
});

// Owner-authorized minimum DDL-backed exception (Get Kinder org <-> KAI
// tenant binding package): an org-scoped client_admin - derived only from an
// active kai.gk_organization_bindings row, never from authentication alone -
// may perform ordinary intake (create_intake_batch/create_intake_file) for
// its own bound organization without a global gk_admin/gk_operator role.
// This does not extend to governance operations.
test("authorization allows client_admin for the two client-write intake operations, but not for governance operations", () => {
  const clientAdmin = {
    actorType: "human",
    actorUserId: "user-1",
    kaiRoles: [],
    organizationMemberships: [{ organization_id: "org-1", role_name: "client_admin", membership_status: "active" }],
  };

  for (const operation of ["create_intake_batch", "create_intake_file"]) {
    const result = validateActorCanPerformOperation(clientAdmin, operation, "org-1");
    assert.equal(result.ok, true, `expected client_admin to pass ${operation}`);
  }

  for (const operation of ["mark_file_policy_blocked", "create_review_queue_item", "update_review_queue_status"]) {
    const result = validateActorCanPerformOperation(clientAdmin, operation, "org-1");
    assert.equal(result.ok, false, `expected client_admin to be denied ${operation}`);
    assert.equal(result.error_code, "authorization_denied");
    assert.equal(result.blockers[0].blocking_reason, "missing_global_gk_write_role");
  }
});

test("authorization still blocks client_admin in an organization it is not actively bound/mapped to", () => {
  const result = validateActorCanPerformOperation(
    {
      actorType: "human",
      actorUserId: "user-1",
      kaiRoles: [],
      organizationMemberships: [{ organization_id: "org-1", role_name: "client_admin", membership_status: "active" }],
    },
    "create_intake_file",
    "org-2",
  );

  assert.equal(result.ok, false);
  assert.equal(result.error_code, "authorization_denied");
  assert.equal(result.blockers[0].blocking_reason, "missing_active_organization_membership");
});

test("authorization requires global GK write role even with active organization membership", () => {
  const result = validateActorCanPerformOperation(
    {
      actorType: "human",
      actorUserId: "user-1",
      kaiRoles: [],
      organizationMemberships: [
        { organization_id: "org-1", role_name: "gk_operator", membership_status: "active" },
      ],
    },
    "create_intake_batch",
    "org-1",
  );

  assert.equal(result.ok, false);
  assert.equal(result.blockers[0].blocking_reason, "missing_global_gk_write_role");
});

test("combineGlobalRoles: a global capability role plus active org membership of any role is allowed for a non-mutating operation", () => {
  const result = validateActorCanPerformOperation(
    {
      actorType: "human",
      actorUserId: "user-1",
      kaiRoles: ["gk_reviewer"],
      organizationMemberships: [{ organization_id: "org-1", role_name: "org_viewer", membership_status: "active" }],
    },
    "read_intake",
    "org-1",
    { allowedRoles: new Set(["gk_admin", "gk_operator", "gk_reviewer"]), combineGlobalRoles: true },
  );

  assert.equal(result.ok, true);
});

test("combineGlobalRoles: a global capability role without active membership in the requested organization is still denied", () => {
  const result = validateActorCanPerformOperation(
    {
      actorType: "human",
      actorUserId: "user-1",
      kaiRoles: ["gk_admin"],
      organizationMemberships: [],
    },
    "read_intake",
    "org-1",
    { allowedRoles: new Set(["gk_admin", "gk_operator", "gk_reviewer"]), combineGlobalRoles: true },
  );

  assert.equal(result.ok, false);
  assert.equal(result.blockers[0].blocking_reason, "missing_active_organization_membership");
});

test("combineGlobalRoles: client_admin without the required global capability is denied even with active membership", () => {
  const result = validateActorCanPerformOperation(
    {
      actorType: "human",
      actorUserId: "user-1",
      kaiRoles: [],
      organizationMemberships: [{ organization_id: "org-1", role_name: "client_admin", membership_status: "active" }],
    },
    "read_intake",
    "org-1",
    { allowedRoles: new Set(["gk_admin", "gk_operator", "gk_reviewer"]), combineGlobalRoles: true },
  );

  assert.equal(result.ok, false);
  assert.equal(result.blockers[0].blocking_reason, "role_not_allowed");
});

test("without combineGlobalRoles, a matching global role alone (no matching membership role_name) is still denied, preserving prior callers' behavior", () => {
  const result = validateActorCanPerformOperation(
    {
      actorType: "human",
      actorUserId: "user-1",
      kaiRoles: ["gk_reviewer"],
      organizationMemberships: [{ organization_id: "org-1", role_name: "org_viewer", membership_status: "active" }],
    },
    "read_intake",
    "org-1",
    { allowedRoles: new Set(["gk_admin", "gk_operator", "gk_reviewer"]) },
  );

  assert.equal(result.ok, false);
  assert.equal(result.blockers[0].blocking_reason, "role_not_allowed");
});

test("globalRolesOnly: an org-scoped role_name matching allowedRoles, with no corresponding global role, is denied (tenant scope must not substitute for the global capability)", () => {
  const result = validateActorCanPerformOperation(
    {
      actorType: "human",
      actorUserId: "user-1",
      kaiRoles: [],
      organizationMemberships: [{ organization_id: "org-1", role_name: "gk_operator", membership_status: "active" }],
    },
    "read_intake",
    "org-1",
    { allowedRoles: new Set(["gk_admin", "gk_operator", "gk_reviewer"]), globalRolesOnly: true },
  );

  assert.equal(result.ok, false);
  assert.equal(result.blockers[0].blocking_reason, "role_not_allowed");
});

test("globalRolesOnly: a global gk_operator role plus active org membership whose scoped role is client_admin (a non-GK role) is allowed", () => {
  const result = validateActorCanPerformOperation(
    {
      actorType: "human",
      actorUserId: "user-1",
      kaiRoles: ["gk_operator"],
      organizationMemberships: [{ organization_id: "org-1", role_name: "client_admin", membership_status: "active" }],
    },
    "read_intake",
    "org-1",
    { allowedRoles: new Set(["gk_admin", "gk_operator", "gk_reviewer"]), globalRolesOnly: true },
  );

  assert.equal(result.ok, true);
});

test("assistant/system actors cannot promote, approve, finalize, export, access raw URLs, or convert parser output", () => {
  for (const operation of ["promote_source", "approve", "finalize", "export", "access_raw_file_url", "convert_parser_output_to_claims"]) {
    const result = validateActorCanPerformOperation(
      { actorType: "assistant", actorUserId: "assistant-1", organizationMemberships: [{ organization_id: "org-1", role_name: "gk_admin", membership_status: "active" }] },
      operation,
      "org-1",
    );
    assert.equal(result.ok, false, operation);
    assert.equal(result.blockers[0].blocking_reason, "assistant_boundary");
  }
});

test("non-human actors cannot mutate intake even with full roles and active membership", () => {
  for (const actorType of ["assistant", "ai", "system", "internal_service"]) {
    for (const operation of [
      "create_intake_batch",
      "create_intake_file",
      "create_review_queue_item",
      "update_review_queue_status",
    ]) {
      const result = validateActorCanPerformOperation(
        {
          actorType,
          actorUserId: `${actorType}-1`,
          kaiRoles: ["gk_admin", "gk_operator"],
          organizationMemberships: [
            { organization_id: "org-1", role_name: "gk_admin", membership_status: "active" },
          ],
        },
        operation,
        "org-1",
      );

      assert.equal(result.ok, false, `${actorType}:${operation}`);
      assert.equal(result.blockers[0].blocking_reason, "assistant_boundary", `${actorType}:${operation}`);
    }
  }
});
