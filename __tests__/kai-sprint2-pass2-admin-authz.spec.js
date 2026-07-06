import test from "node:test";
import assert from "node:assert/strict";

import { checkAdminAccess, createIntakeBatch } from "../Backend/kai/services/kaiIntakeService.js";

const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const engagementId = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const actorContext = {
  actorType: "human",
  actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
  legacyPublicUserdataId: 46,
  kaiRoles: ["gk_operator"],
  organizationMemberships: [
    { organization_id: organizationId, role_name: "gk_operator", membership_status: "active" },
  ],
};

test("admin access check maps actor and confirms NCWS membership without writes", async () => {
  let wrote = false;
  const result = await checkAdminAccess(
    { actorContext, organizationId, engagementId },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getEngagementTenantState() {
        return { engagement_id: engagementId, organization_id: organizationId };
      },
      async insertIntakeBatchMetadata() {
        wrote = true;
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.actor_mapped, true);
  assert.equal(result.data.membership_active, true);
  assert.equal(result.data.global_write_role_present, true);
  assert.equal(result.data.matched_write_role_family, "gk_admin_or_operator");
  assert.deepEqual(result.data.authorized_operations, ["create_intake_batch", "reserve_intake_file_metadata"]);
  assert.equal(wrote, false);
});

test("admin access check blocks missing engagement tenant state without writes", async () => {
  let wrote = false;
  const result = await checkAdminAccess(
    { actorContext, organizationId, engagementId },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getEngagementTenantState() {
        return null;
      },
      async insertIntakeBatchMetadata() {
        wrote = true;
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.status, 422);
  assert.equal(result.blockers[0].blocking_reason, "missing_engagement_tenant_state");
  assert.equal(wrote, false);
});

test("admin access check blocks missing engagement_id with metadata-only audit", async () => {
  let wrote = false;
  let auditMetadata = null;
  const result = await checkAdminAccess(
    { actorContext, organizationId },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getEngagementTenantState() {
        throw new Error("engagement lookup should not run for missing engagement_id");
      },
      async insertIntakeBatchMetadata() {
        wrote = true;
      },
      async insertBlockedAttemptAuditEvent(metadata) {
        auditMetadata = metadata;
        return { ok: true, auditEventId: "audit-access-missing-engagement" };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.status, 422);
  assert.equal(result.blockers[0].blocking_reason, "missing_engagement_id");
  assert.equal(wrote, false);
  assert.equal(result.audit_context.blocked_attempt_audit.ok, true);
  assert.equal(result.audit_context.blocked_attempt_audit.audit_event_id, "audit-access-missing-engagement");
  assert.equal(auditMetadata.object_type, "other");
  assert.equal(auditMetadata.target_object_type, "engagement");
  assert.equal(auditMetadata.metadata_only, true);
  assert.equal(auditMetadata.contains_signed_urls, false);
  assert.equal(auditMetadata.contains_storage_credentials, false);
});

test("missing kai.users mapping returns mapped_kai_user_required, not 500", async () => {
  const result = await createIntakeBatch(
    {
      req: { user: { id: 46, email: "kai@getkinder.ai" } },
      organizationId,
      engagementId,
      batchCode: "NCWS-P0-PASS2-METADATA-001",
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async findKaiUserByLegacyPublicUserdataId() {
        return null;
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "mapped_kai_user_required");
  assert.equal(result.error.status, 403);
});
