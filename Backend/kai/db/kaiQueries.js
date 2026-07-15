import pool from "./kaiDb.js";

export async function findKaiUserByLegacyPublicUserdataId(legacyPublicUserdataId, db = pool) {
  const { rows } = await db.query(
    `SELECT user_id, legacy_identity_source, legacy_public_userdata_id, status, email
       FROM kai.users
      WHERE legacy_identity_source = 'public.userdata'
        AND legacy_public_userdata_id = $1
        AND status = 'active'
      LIMIT 1`,
    [legacyPublicUserdataId],
  );
  return rows[0] || null;
}

export async function listKaiRolesForUser(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT r.role_name
       FROM kai.user_roles ur
       JOIN kai.roles r ON r.role_id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.role_name`,
    [userId],
  );
  return rows.map((row) => row.role_name);
}

export async function listOrganizationMembershipsForUser(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT organization_id, user_id, role_name, membership_status
       FROM kai.organization_memberships
      WHERE user_id = $1
      ORDER BY organization_id, role_name`,
    [userId],
  );
  return rows;
}

export async function getActorOrganizationAccess(userId, organizationId, db = pool) {
  const { rows } = await db.query(
    `SELECT organization_id, user_id, role_name, membership_status
       FROM kai.organization_memberships
      WHERE user_id = $1
        AND organization_id = $2
      ORDER BY role_name`,
    [userId, organizationId],
  );
  return rows;
}

export async function getEngagementTenantState(engagementId, db = pool) {
  if (!engagementId) return null;
  const { rows } = await db.query(
    `SELECT engagement_id, organization_id
       FROM kai.engagements
      WHERE engagement_id = $1
      LIMIT 1`,
    [engagementId],
  );
  return rows[0] || null;
}

export async function getIntakeBatchTenantState(intakeBatchId, organizationId, db = pool) {
  if (!intakeBatchId || !organizationId) return null;
  const { rows } = await db.query(
    `SELECT intake_batch_id, organization_id, engagement_id
       FROM kai.intake_batches
      WHERE intake_batch_id = $1
        AND organization_id = $2
      LIMIT 1`,
    [intakeBatchId, organizationId],
  );
  return rows[0] || null;
}
