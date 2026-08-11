import test from "node:test";
import assert from "node:assert/strict";

import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import { validateActorCanPerformOperation } from "../Backend/kai/auth/kaiAuthorizationService.js";
import { checkAdminAccess, createIntakeBatch, reserveIntakeFileMetadata } from "../Backend/kai/services/kaiIntakeService.js";

const KAI_ORG_A = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const KAI_ORG_B = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";
const ENGAGEMENT_A = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const INTAKE_BATCH_A = "8e426ea1-2be3-4e48-b80f-9783ddbacda0";

function fakeGetKinderUser(overrides = {}) {
  return { id: 46, email: "org-admin@getkinder.ai", firstname: "Org", lastname: "Admin", ...overrides };
}

function boundClientAdminDependencies({ gkOrgId = 12, kaiOrgId = KAI_ORG_A, gkRole = "admin", gkActive = true } = {}) {
  return {
    async findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId, email }) {
      return {
        user_id: "jit-kai-user-46",
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: legacyPublicUserdataId,
        status: "active",
        email,
      };
    },
    async listKaiRolesForUser() {
      return [];
    },
    async listOrganizationMembershipsForUser() {
      return [];
    },
    async resolveOrgScopeForUserId() {
      return { memberships: [{ orgId: gkOrgId, role: gkRole, is_active: gkActive }] };
    },
    async listActiveGkOrganizationBindingsForGkOrganizationIds(ids) {
      if (!ids.includes(gkOrgId)) return [];
      return [{ gk_organization_id: gkOrgId, kai_organization_id: kaiOrgId, status: "active" }];
    },
  };
}

// 1 + 2 + 3 + 6 - JIT identity, existing GK org access + active binding
// authorizes the corresponding KAI tenant, role admin -> client_admin, and
// no organization access is granted from authentication alone otherwise.
test("1/2/3/6: JIT-provisioned Get Kinder org admin with an active binding resolves to an org-scoped client_admin membership for the bound KAI org only", async () => {
  const dependencies = boundClientAdminDependencies();
  const result = await resolveKaiActorContext({ user: fakeGetKinderUser() }, dependencies);

  assert.equal(result.ok, true);
  assert.notEqual(result.error_code, "mapped_kai_user_required");
  assert.deepEqual(result.actorContext.kaiRoles, []);
  assert.deepEqual(result.actorContext.organizationMemberships, [
    {
      organization_id: KAI_ORG_A,
      role_name: "client_admin",
      membership_status: "active",
      source: "gk_organization_binding",
      gk_organization_id: 12,
    },
  ]);

  const sameOrg = validateActorCanPerformOperation(result.actorContext, "read_intake", KAI_ORG_A);
  assert.equal(sameOrg.ok, true);
});

// 5 - membership in public org A cannot authorize KAI org B.
test("5: a client_admin bound to KAI org A cannot access KAI org B", async () => {
  const dependencies = boundClientAdminDependencies({ gkOrgId: 12, kaiOrgId: KAI_ORG_A });
  const result = await resolveKaiActorContext({ user: fakeGetKinderUser() }, dependencies);
  assert.equal(result.ok, true);

  const otherOrg = validateActorCanPerformOperation(result.actorContext, "read_intake", KAI_ORG_B);
  assert.equal(otherOrg.ok, false);
  assert.equal(otherOrg.error_code, "authorization_denied");
});

// 6 - an arbitrary client-supplied KAI UUID (never bound to anything) cannot
// authorize access, even for an otherwise-valid bound actor.
test("6: an arbitrary, never-bound KAI organization UUID supplied by the caller cannot be authorized", async () => {
  const dependencies = boundClientAdminDependencies();
  const result = await resolveKaiActorContext({ user: fakeGetKinderUser() }, dependencies);
  assert.equal(result.ok, true);

  const arbitraryOrgId = "00000000-0000-4000-8000-0000000000ff";
  const auth = validateActorCanPerformOperation(result.actorContext, "read_intake", arbitraryOrgId);
  assert.equal(auth.ok, false);
  assert.equal(auth.error_code, "authorization_denied");
});

// 4 - client_admin can perform the minimum Gate C intake operations for its
// own organization: create_intake_batch (checkAdminAccess/createIntakeBatch)
// and create_intake_file (reserveIntakeFileMetadata and, transitively, the
// shared authorizeUploadReservedIntakeFile helper used by
// uploadReservedIntakeFile/requestUploadUrl/confirmUpload).
test("4: client_admin can pass authorization for create_intake_batch and create_intake_file in its own bound organization", () => {
  const actorContext = {
    actorType: "human",
    actorUserId: "jit-kai-user-46",
    kaiRoles: [],
    organizationMemberships: [{ organization_id: KAI_ORG_A, role_name: "client_admin", membership_status: "active" }],
  };

  for (const operation of ["create_intake_batch", "create_intake_file"]) {
    const result = validateActorCanPerformOperation(actorContext, operation, KAI_ORG_A);
    assert.equal(result.ok, true, `expected client_admin to pass ${operation}`);
  }
});

test("4: client_admin reaches checkAdminAccess and createIntakeBatch for its own bound organization (env/tenant satisfied)", async () => {
  const actorContext = {
    actorType: "human",
    actorUserId: "jit-kai-user-46",
    kaiRoles: [],
    organizationMemberships: [{ organization_id: KAI_ORG_A, role_name: "client_admin", membership_status: "active" }],
  };

  const access = await checkAdminAccess(
    { actorContext, organizationId: KAI_ORG_A, engagementId: ENGAGEMENT_A },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getEngagementTenantState() {
        return { engagement_id: ENGAGEMENT_A, organization_id: KAI_ORG_A };
      },
    },
  );
  assert.equal(access.ok, true);
  assert.equal(access.data.global_write_role_present, false);

  let wrote = false;
  const created = await createIntakeBatch(
    {
      actorContext,
      organizationId: KAI_ORG_A,
      engagementId: ENGAGEMENT_A,
      batchCode: "NCWS-CLIENT-ADMIN-001",
      idempotencyKey: "client-admin-create-batch-001",
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getEngagementTenantState() {
        return { engagement_id: ENGAGEMENT_A, organization_id: KAI_ORG_A };
      },
      async insertIntakeBatchMetadata() {
        wrote = true;
        return { intake_batch_id: INTAKE_BATCH_A, organization_id: KAI_ORG_A, engagement_id: ENGAGEMENT_A, batch_code: "NCWS-CLIENT-ADMIN-001" };
      },
      async findIntakeBatchByIdempotencyKey() {
        return null;
      },
    },
  );
  assert.equal(created.ok, true);
  assert.equal(wrote, true);
});

test("4: client_admin reaches reserveIntakeFileMetadata for its own bound organization (tenant state satisfied)", async () => {
  const actorContext = {
    actorType: "human",
    actorUserId: "jit-kai-user-46",
    kaiRoles: [],
    organizationMemberships: [{ organization_id: KAI_ORG_A, role_name: "client_admin", membership_status: "active" }],
  };

  const auth = validateActorCanPerformOperation(actorContext, "create_intake_file", KAI_ORG_A);
  assert.equal(auth.ok, true);

  const result = await reserveIntakeFileMetadata(
    {
      actorContext,
      organizationId: KAI_ORG_A,
      engagementId: ENGAGEMENT_A,
      intakeBatchId: INTAKE_BATCH_A,
      payload: {
        original_filename: "report.pdf",
        file_extension: ".pdf",
        mime_type: "application/pdf",
        checksum: "a".repeat(64),
        hash_algorithm: "sha256",
        file_size_bytes: 1024,
      },
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchTenantState() {
        return { intake_batch_id: INTAKE_BATCH_A, organization_id: KAI_ORG_A, engagement_id: ENGAGEMENT_A };
      },
    },
  );
  assert.notEqual(result.error?.code, "authorization_denied");
  assert.notEqual(result.error?.code, "mapped_kai_user_required");
});

// 14 - client_admin remains blocked from internal policy/review/governance
// operations even for its own bound organization.
test("14: client_admin is denied internal governance operations (file-policy, review-queue) in its own bound organization", () => {
  const actorContext = {
    actorType: "human",
    actorUserId: "jit-kai-user-46",
    kaiRoles: [],
    organizationMemberships: [{ organization_id: KAI_ORG_A, role_name: "client_admin", membership_status: "active" }],
  };

  for (const operation of ["mark_file_policy_blocked", "create_review_queue_item", "update_review_queue_status"]) {
    const result = validateActorCanPerformOperation(actorContext, operation, KAI_ORG_A);
    assert.equal(result.ok, false, `expected client_admin to be denied ${operation}`);
    assert.equal(result.error_code, "authorization_denied");
    assert.equal(result.blockers[0].blocking_reason, "missing_global_gk_write_role");
  }
});

// 10 - internal GK role behavior is unchanged: gk_admin/gk_operator still
// pass every mutating operation, including the governance ones client_admin
// is denied.
test("10: existing internal gk_operator role remains compatible with every mutating operation", () => {
  const actorContext = {
    actorType: "human",
    actorUserId: "internal-kai-user-1",
    kaiRoles: ["gk_operator"],
    organizationMemberships: [{ organization_id: KAI_ORG_A, role_name: "gk_operator", membership_status: "active" }],
  };

  for (const operation of [
    "create_intake_batch",
    "create_intake_file",
    "mark_file_policy_blocked",
    "create_review_queue_item",
    "update_review_queue_status",
  ]) {
    const result = validateActorCanPerformOperation(actorContext, operation, KAI_ORG_A);
    assert.equal(result.ok, true, `expected gk_operator to pass ${operation}`);
  }
});

// 7 - missing/inactive/ambiguous binding fails closed end-to-end through
// resolveKaiActorContext (not just the pure derivation already covered in
// kai-sprint2-gk-organization-binding.spec.js).
test("7: no binding for an active Get Kinder org-admin membership yields no organization access, not an error", async () => {
  const dependencies = {
    async findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId, email }) {
      return { user_id: "jit-kai-user-46", legacy_identity_source: "public.userdata", legacy_public_userdata_id: legacyPublicUserdataId, status: "active", email };
    },
    async listKaiRolesForUser() {
      return [];
    },
    async listOrganizationMembershipsForUser() {
      return [];
    },
    async resolveOrgScopeForUserId() {
      return { memberships: [{ orgId: 12, role: "admin", is_active: true }] };
    },
    async listActiveGkOrganizationBindingsForGkOrganizationIds() {
      return [];
    },
  };

  const result = await resolveKaiActorContext({ user: fakeGetKinderUser() }, dependencies);
  assert.equal(result.ok, true);
  assert.deepEqual(result.actorContext.organizationMemberships, []);

  const auth = validateActorCanPerformOperation(result.actorContext, "read_intake", KAI_ORG_A);
  assert.equal(auth.ok, false);
  assert.equal(auth.error_code, "authorization_denied");
});

// 8 - missing/inactive Get Kinder organization access fails closed.
test("8: inactive Get Kinder organization membership yields no organization access", async () => {
  const dependencies = boundClientAdminDependencies({ gkActive: false });
  const result = await resolveKaiActorContext({ user: fakeGetKinderUser() }, dependencies);

  assert.equal(result.ok, true);
  assert.deepEqual(result.actorContext.organizationMemberships, []);
});

test("8: no Get Kinder organization membership at all yields no organization access", async () => {
  const dependencies = {
    async findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId, email }) {
      return { user_id: "jit-kai-user-46", legacy_identity_source: "public.userdata", legacy_public_userdata_id: legacyPublicUserdataId, status: "active", email };
    },
    async listKaiRolesForUser() {
      return [];
    },
    async listOrganizationMembershipsForUser() {
      return [];
    },
    async resolveOrgScopeForUserId() {
      return { memberships: [] };
    },
    async listActiveGkOrganizationBindingsForGkOrganizationIds() {
      throw new Error("must not be called with no admin-role memberships");
    },
  };

  const result = await resolveKaiActorContext({ user: fakeGetKinderUser() }, dependencies);
  assert.equal(result.ok, true);
  assert.deepEqual(result.actorContext.organizationMemberships, []);
});

// 9 - unauthenticated request remains blocked.
test("9: an unauthenticated request (no req.user) remains unauthorized", async () => {
  const dependencies = {
    async resolveOrgScopeForUserId() {
      throw new Error("must not be called without an authenticated user");
    },
  };
  const result = await resolveKaiActorContext({}, dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "unauthorized");
});

// 11 - explicitly inactive KAI users remain blocked, and never resurrected,
// even if the user also has a valid Get Kinder org binding.
test("11: an explicitly deactivated kai.users mapping still fails closed even with a valid Get Kinder org binding", async () => {
  const dependencies = {
    async findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId }) {
      return { user_id: "deprovisioned-kai-user", legacy_identity_source: "public.userdata", legacy_public_userdata_id: legacyPublicUserdataId, status: "inactive" };
    },
    async resolveOrgScopeForUserId() {
      throw new Error("must not be reached: identity check fails closed before organization derivation");
    },
  };

  const result = await resolveKaiActorContext({ user: fakeGetKinderUser() }, dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "mapped_kai_user_required");
});
