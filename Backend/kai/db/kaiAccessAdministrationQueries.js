import pool from "./kaiDb.js";

/**
 * KAI Sprint 2 Package 2 repository: kai.organization_memberships and
 * kai.user_roles read/write helpers for governed role/organization-access
 * administration.
 *
 * kai.organization_memberships, kai.user_roles, kai.roles, and kai.users are
 * all externally managed (no CREATE TABLE for any of them exists in this
 * repository - see Backend/kai/db/kaiQueries.js). Every column referenced
 * below is one Package 1's own, already-tested queries already depend on
 * (organization_id, user_id, role_name, membership_status on
 * kai.organization_memberships; user_id, role_id on kai.user_roles; role_id,
 * role_name on kai.roles). No new column or table is assumed.
 *
 * Concurrency safety does not depend on a uniqueness constraint on either
 * table (none is confirmed from this repository): every write here is
 * serialized by a Postgres advisory transaction lock keyed on the identity
 * being written, exactly the same technique
 * findOrCreateKaiUserByLegacyPublicUserdataId (kaiQueries.js) already uses
 * for kai.users. Every function accepts either a real pool (has `.connect`)
 * or an already-open transaction client, so a caller can compose a
 * membership/role read-check with its own mutation + audit inside one
 * externally-owned transaction (see kaiAccessAdministrationService.js).
 */

const MEMBERSHIP_SELECT_COLUMNS = "organization_id, user_id, role_name, membership_status";
const KAI_USER_SELECT_COLUMNS = "user_id, legacy_identity_source, legacy_public_userdata_id, status, email";

// `typeof db.connect === "function"` is NOT a safe "is this a Pool" test: a
// real pg.Client obtained from Pool#connect() also exposes `.connect`
// (inherited from the Client prototype - reconfirmed empirically against
// real PostgreSQL while closing this package), so that duck-type check would
// make withLockedTransaction call `.connect()` a second time on an
// already-open transaction client passed down from
// kaiAccessAdministrationService.js and crash ("Client has already been
// connected. You cannot reuse a client."). See the identical prior finding
// documented on Backend/kai/db/kaiOrganizationEnablementQueries.js#insertGkOrganizationBinding.
//
// `instanceof Pool` is not a safe fix either: this repository has more than
// one installed copy of the "pg" package (this file's own node_modules/pg
// resolves differently than one imported from a script/test at the
// repository root), so a genuine Pool instance can fail `instanceof` against
// a Pool class loaded from the other copy - reconfirmed empirically: it
// silently disabled the advisory lock entirely (no BEGIN was ever issued, so
// pg_advisory_xact_lock released immediately instead of holding for the
// transaction, and two concurrent global-role assignments both inserted).
// `.release` is the reliable signal instead: pg-pool attaches a `.release`
// method only to a client it has already checked out via Pool#connect() -
// never to the Pool object itself, and never to a plain, not-yet-connected
// Client - so its presence/absence is stable across separate "pg" package
// installations.
function isRealPool(db) {
  return typeof db?.connect === "function" && typeof db?.release !== "function";
}

async function withLockedTransaction(db, lockKeyText, work) {
  const usesOwnTransaction = isRealPool(db);
  const client = usesOwnTransaction ? await db.connect() : db;
  try {
    if (usesOwnTransaction) await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKeyText]);
    const result = await work(client);
    if (usesOwnTransaction) await client.query("COMMIT");
    return result;
  } catch (error) {
    if (usesOwnTransaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (usesOwnTransaction) client.release();
  }
}

/**
 * Safe roster read for one explicitly scoped organization: every stored
 * kai.organization_memberships row for that organization, joined to
 * kai.users for the mapped identity fields an administrator needs (never raw
 * legacy PII beyond email, which Package 1's own safeLegacyUser already
 * exposes to actors).
 */
export async function listOrganizationMembershipRowsForOrganization(organizationId, db = pool) {
  const { rows } = await db.query(
    `SELECT om.organization_id, om.user_id, om.role_name, om.membership_status,
            u.legacy_public_userdata_id, u.email, u.status AS kai_user_status
       FROM kai.organization_memberships om
       JOIN kai.users u ON u.user_id = om.user_id
      WHERE om.organization_id = $1
      ORDER BY om.role_name, u.email`,
    [organizationId],
  );
  return rows;
}

export async function getOrganizationMembershipRow(organizationId, userId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${MEMBERSHIP_SELECT_COLUMNS}
       FROM kai.organization_memberships
      WHERE organization_id = $1
        AND user_id = $2
      LIMIT 1`,
    [organizationId, userId],
  );
  return rows[0] || null;
}

/**
 * Every stored kai.organization_memberships row for one user in one
 * organization, ordered deterministically. The deployed uniqueness is
 * UNIQUE (organization_id, user_id, role_name) - not (organization_id,
 * user_id) - so PostgreSQL itself permits more than one stored role row for
 * the same user+organization. This package's own writes never create that
 * state (see upsertOrganizationMembershipRoleStatus), but pre-existing data
 * might; callers use this instead of getOrganizationMembershipRow wherever a
 * mutation decision depends on there being exactly one stored row, so an
 * unexpected extra row is detected and fails closed rather than silently
 * picked between.
 */
export async function listOrganizationMembershipRowsForUserInOrganization(organizationId, userId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${MEMBERSHIP_SELECT_COLUMNS}
       FROM kai.organization_memberships
      WHERE organization_id = $1
        AND user_id = $2
      ORDER BY role_name`,
    [organizationId, userId],
  );
  return rows;
}

/**
 * Count of stored, active client_admin memberships for an organization,
 * optionally excluding one user (the actor whose own membership a mutation
 * would change) - used to simulate whether a proposed change would leave the
 * organization with zero stored effective admins. Derived client_admin
 * authority is counted separately (see gkOrganizationAdminQueries.js) since
 * it is never a kai.organization_memberships row.
 */
export async function countActiveStoredClientAdminMemberships(organizationId, db = pool, { excludingUserId = null } = {}) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS count
       FROM kai.organization_memberships
      WHERE organization_id = $1
        AND role_name = 'client_admin'
        AND membership_status = 'active'
        AND ($2::text IS NULL OR user_id::text <> $2::text)`,
    [organizationId, excludingUserId === null ? null : String(excludingUserId)],
  );
  return rows[0]?.count ?? 0;
}

/**
 * Governed create/change of one stored organization membership. Returns the
 * previous row (null if none existed), the resulting row, and whether this
 * call actually changed anything (`mutated: false` on an exact-state replay,
 * so callers can skip writing a duplicate audit event).
 */
export async function upsertOrganizationMembershipRoleStatus(
  { organizationId, userId, roleName, membershipStatus },
  db = pool,
) {
  return withLockedTransaction(db, `kai_org_membership:${organizationId}:${userId}`, async (client) => {
    const existingRows = await listOrganizationMembershipRowsForUserInOrganization(organizationId, userId, client);

    if (existingRows.length > 1) {
      return { previousRow: null, newRow: null, mutated: false, replay: false, conflict: true };
    }

    const previousRow = existingRows[0] || null;

    if (!previousRow) {
      const { rows } = await client.query(
        `INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status)
         VALUES ($1, $2, $3, $4)
         RETURNING ${MEMBERSHIP_SELECT_COLUMNS}`,
        [organizationId, userId, roleName, membershipStatus],
      );
      return { previousRow: null, newRow: rows[0] || null, mutated: true, replay: false };
    }

    if (previousRow.role_name === roleName && previousRow.membership_status === membershipStatus) {
      return { previousRow, newRow: previousRow, mutated: false, replay: true };
    }

    // Replacement semantics: the one stored row this user/org previously had
    // (identified by its own role_name, matching the deployed UNIQUE
    // (organization_id, user_id, role_name)) is changed in place to the
    // requested role/status - never additively inserted alongside it - so no
    // old privileged role row can remain active after a successful change.
    const { rows } = await client.query(
      `UPDATE kai.organization_memberships
          SET role_name = $3,
              membership_status = $4
        WHERE organization_id = $1
          AND user_id = $2
          AND role_name = $5
        RETURNING ${MEMBERSHIP_SELECT_COLUMNS}`,
      [organizationId, userId, roleName, membershipStatus, previousRow.role_name],
    );
    return { previousRow, newRow: rows[0] || null, mutated: true, replay: false };
  });
}

export async function getRoleIdByName(roleName, db = pool) {
  const { rows } = await db.query(
    `SELECT role_id, role_name FROM kai.roles WHERE role_name = $1 LIMIT 1`,
    [roleName],
  );
  return rows[0] || null;
}

/**
 * Effective GLOBAL kai.user_roles rows for one user: organization_id and
 * engagement_id are both nullable on the deployed table, and a row scoped to
 * an organization or engagement is a different capability than a global one -
 * only a row with both NULL, active = true, and revoked_at IS NULL counts as
 * an effective global role here. Readers that omit this scope/active filter
 * would treat an org-scoped or engagement-scoped (or inactive/revoked)
 * kai.user_roles row as global KAI capability, which this package never
 * intends.
 */
const GLOBAL_ROLE_SCOPE_FILTER = "ur.organization_id IS NULL AND ur.engagement_id IS NULL AND ur.active = true AND ur.revoked_at IS NULL";

export async function listGlobalRoleAssignmentRows(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT ur.user_id, ur.role_id, r.role_name
       FROM kai.user_roles ur
       JOIN kai.roles r ON r.role_id = ur.role_id
      WHERE ur.user_id = $1
        AND ${GLOBAL_ROLE_SCOPE_FILTER}
      ORDER BY r.role_name`,
    [userId],
  );
  return rows;
}

/**
 * Governed assignment of one existing global KAI role. Fails closed
 * (`ok: false, error_code: "role_not_found"`) if kai.roles has no row for
 * roleName - this package never invents a kai.roles row.
 *
 * The deployed UNIQUE (user_id, role_id, organization_id, engagement_id)
 * does NOT prevent duplicate NULL-scoped (global) rows for the same
 * user+role - PostgreSQL treats each NULL as distinct for uniqueness
 * purposes. Safety instead comes entirely from the advisory transaction
 * lock keyed on user+role (below): concurrent callers serialize on this
 * check-then-act block, so only one of them ever observes "no existing
 * global row" and inserts.
 *
 * Idempotent and soft-state: a replayed assignment of an already-active
 * global row is a no-op (`mutated: false`); an existing but
 * inactive/revoked global row is reactivated in place rather than a second
 * row being inserted alongside it, preferring the deployed active/
 * revoked_at soft-state columns over physical delete+insert.
 */
export async function assignGlobalRole({ userId, roleName }, db = pool) {
  const role = await getRoleIdByName(roleName, db);
  if (!role) return { ok: false, error_code: "role_not_found" };

  return withLockedTransaction(db, `kai_global_role:${userId}:${role.role_id}`, async (client) => {
    const { rows: existingRows } = await client.query(
      `SELECT user_role_id, active, revoked_at
         FROM kai.user_roles
        WHERE user_id = $1
          AND role_id = $2
          AND organization_id IS NULL
          AND engagement_id IS NULL
        LIMIT 1`,
      [userId, role.role_id],
    );
    const existing = existingRows[0];

    if (existing && existing.active === true && existing.revoked_at === null) {
      return { ok: true, mutated: false, replay: true, roleId: role.role_id, roleName: role.role_name };
    }

    if (existing) {
      await client.query(
        `UPDATE kai.user_roles
            SET active = true,
                revoked_at = NULL,
                assigned_at = now()
          WHERE user_role_id = $1`,
        [existing.user_role_id],
      );
      return { ok: true, mutated: true, replay: false, roleId: role.role_id, roleName: role.role_name };
    }

    await client.query(
      `INSERT INTO kai.user_roles (user_id, role_id, organization_id, engagement_id, active)
       VALUES ($1, $2, NULL, NULL, true)`,
      [userId, role.role_id],
    );
    return { ok: true, mutated: true, replay: false, roleId: role.role_id, roleName: role.role_name };
  });
}

/**
 * Governed revocation of one existing global KAI role. A replay against an
 * already-inactive/absent global assignment is a no-op (`mutated: false`),
 * not an error - revoking twice must never fail closed or throw. Uses the
 * deployed active/revoked_at soft-state columns (UPDATE), not DELETE, so
 * revoked global-role history is never physically destroyed.
 */
export async function revokeGlobalRole({ userId, roleName }, db = pool) {
  const role = await getRoleIdByName(roleName, db);
  if (!role) return { ok: false, error_code: "role_not_found" };

  return withLockedTransaction(db, `kai_global_role:${userId}:${role.role_id}`, async (client) => {
    const { rows } = await client.query(
      `UPDATE kai.user_roles
          SET active = false,
              revoked_at = now()
        WHERE user_id = $1
          AND role_id = $2
          AND organization_id IS NULL
          AND engagement_id IS NULL
          AND active = true
          AND revoked_at IS NULL
        RETURNING user_role_id`,
      [userId, role.role_id],
    );
    return { ok: true, mutated: rows.length > 0, replay: rows.length === 0, roleId: role.role_id, roleName: role.role_name };
  });
}

/**
 * Bounded target-user resolution: this package administers only Get Kinder
 * users already (or now, via the same existing JIT mechanism actor
 * resolution already uses) mapped into kai.users. It invents no second
 * identity/invitation system - see kaiQueries.js.
 */
export { findOrCreateKaiUserByLegacyPublicUserdataId } from "./kaiQueries.js";
export const KAI_USER_SELECT_COLUMNS_FOR_ADMINISTRATION = KAI_USER_SELECT_COLUMNS;
