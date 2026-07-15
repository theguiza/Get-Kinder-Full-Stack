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

test("authorization blocks client roles for P0 write operations", () => {
  for (const roleName of ["client_admin", "client_contributor"]) {
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
    for (const operation of ["create_intake_batch", "create_intake_file", "create_review_queue_item"]) {
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
