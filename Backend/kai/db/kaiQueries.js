import pool from "./kaiDb.js";

const KAI_USER_PROVISIONING_LOCK_NAMESPACE = 913_224_001;

const KAI_USER_SELECT_COLUMNS = "user_id, legacy_identity_source, legacy_public_userdata_id, status, email";

async function selectKaiUserByLegacyPublicUserdataId(db, legacyPublicUserdataId) {
  const { rows } = await db.query(
    `SELECT ${KAI_USER_SELECT_COLUMNS}
       FROM kai.users
      WHERE legacy_identity_source = 'public.userdata'
        AND legacy_public_userdata_id = $1
      LIMIT 1`,
    [legacyPublicUserdataId],
  );
  return rows[0] || null;
}

/**
 * Resolve the internal kai.users principal for an authenticated public.userdata
 * identity, provisioning it on first use. Existing rows (any status) are
 * returned as-is so an explicitly deactivated mapping still fails closed in
 * the caller; only a genuinely absent mapping is created.
 *
 * Concurrency safety does not depend on a kai.users uniqueness constraint
 * (kai.users is externally managed and its constraints are not confirmed from
 * this repository): a Postgres advisory transaction lock keyed on the legacy
 * user id serializes concurrent first-provisioning attempts for the same
 * user, so two simultaneous callers cannot both observe "absent" and both
 * insert.
 */
export async function findOrCreateKaiUserByLegacyPublicUserdataId(
  { legacyPublicUserdataId, email = null } = {},
  db = pool,
) {
  if (!Number.isInteger(legacyPublicUserdataId) || legacyPublicUserdataId <= 0) {
    return null;
  }

  if (typeof db.connect !== "function") {
    const existing = await selectKaiUserByLegacyPublicUserdataId(db, legacyPublicUserdataId);
    if (existing) return existing;
    const { rows } = await db.query(
      `INSERT INTO kai.users (legacy_identity_source, legacy_public_userdata_id, email, status)
       VALUES ('public.userdata', $1, $2, 'active')
       RETURNING ${KAI_USER_SELECT_COLUMNS}`,
      [legacyPublicUserdataId, email],
    );
    return rows[0] || null;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      KAI_USER_PROVISIONING_LOCK_NAMESPACE,
      legacyPublicUserdataId,
    ]);

    const existing = await selectKaiUserByLegacyPublicUserdataId(client, legacyPublicUserdataId);
    if (existing) {
      await client.query("COMMIT");
      return existing;
    }

    const { rows } = await client.query(
      `INSERT INTO kai.users (legacy_identity_source, legacy_public_userdata_id, email, status)
       VALUES ('public.userdata', $1, $2, 'active')
       RETURNING ${KAI_USER_SELECT_COLUMNS}`,
      [legacyPublicUserdataId, email],
    );
    await client.query("COMMIT");
    return rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Read-only lookup companion to findOrCreateKaiUserByLegacyPublicUserdataId:
 * used where a caller must never provision a new kai.users row (e.g. listing
 * effective access for administration) and only wants the mapping if one
 * already exists.
 */
export async function findKaiUserByLegacyPublicUserdataId(legacyPublicUserdataId, db = pool) {
  if (!Number.isInteger(legacyPublicUserdataId) || legacyPublicUserdataId <= 0) return null;
  return selectKaiUserByLegacyPublicUserdataId(db, legacyPublicUserdataId);
}

/**
 * Global KAI capability roles for one user. organization_id and
 * engagement_id are both nullable on the deployed kai.user_roles table, so a
 * row scoped to an organization or engagement is not global capability -
 * only a row with both NULL, active = true, and revoked_at IS NULL is an
 * effective global role. Without this filter an org- or engagement-scoped
 * (or inactive/revoked) row would be treated as global capability by every
 * caller of actorContext.kaiRoles.
 */
export async function listKaiRolesForUser(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT r.role_name
       FROM kai.user_roles ur
       JOIN kai.roles r ON r.role_id = ur.role_id
      WHERE ur.user_id = $1
        AND ur.organization_id IS NULL
        AND ur.engagement_id IS NULL
        AND ur.active = true
        AND ur.revoked_at IS NULL
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

/**
 * KAI intake-context read: existing engagement contexts already scoped to an
 * organization. Returns only engagement_id/organization_id - the same
 * minimal, already-established-safe field set every other engagement read in
 * this codebase (getEngagementTenantState) uses. Never creates a row.
 */
export async function listEngagementsForOrganization({ organizationId }, db = pool) {
  if (!organizationId) return [];
  const { rows } = await db.query(
    `SELECT engagement_id, organization_id
       FROM kai.engagements
      WHERE organization_id = $1
      ORDER BY engagement_id ASC
      LIMIT 100`,
    [organizationId],
  );
  return rows;
}
