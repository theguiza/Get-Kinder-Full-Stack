import pool from "../Backend/db/pg.js";
import { isAdminRequest } from "../Backend/middleware/ensureAdmin.js";

export const ADMIN_ORG_PORTAL_PREVIEW_USER_ID_KEY = "adminOrgPortalPreviewUserId";
export const ADMIN_ORG_PORTAL_PREVIEW_ORG_ID_KEY = "adminOrgPortalPreviewOrgId";
export const ACTIVE_ORG_ID_KEY = "activeOrgId";

let hasUserOrgMembershipTablePromise = null;

function normalizeUserId(value) {
  const raw = String(value ?? "").trim();
  return /^\d+$/.test(raw) ? raw : null;
}

function normalizeOrgId(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const numeric = Number(raw);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export async function hasUserOrgMembershipTable() {
  if (!hasUserOrgMembershipTablePromise) {
    hasUserOrgMembershipTablePromise = pool
      .query("SELECT to_regclass('public.user_org_memberships') AS table_name")
      .then(({ rows }) => Boolean(rows?.[0]?.table_name))
      .catch(() => false);
  }
  return hasUserOrgMembershipTablePromise;
}

export function getAdminPreviewUserId(req) {
  if (!isAdminRequest(req)) return null;
  return normalizeUserId(req.session?.[ADMIN_ORG_PORTAL_PREVIEW_USER_ID_KEY]);
}

function getAdminPreviewOrgId(req) {
  if (!isAdminRequest(req)) return null;
  return normalizeOrgId(req.session?.[ADMIN_ORG_PORTAL_PREVIEW_ORG_ID_KEY]);
}

async function resolveAuthenticatedUserId(req, { allowAdminPreview = false } = {}) {
  if (allowAdminPreview) {
    const previewUserId = getAdminPreviewUserId(req);
    if (previewUserId) {
      return {
        userId: previewUserId,
        previewUserId,
        previewOrgId: getAdminPreviewOrgId(req),
      };
    }
  }

  const directId = normalizeUserId(req.user?.id);
  if (directId) return { userId: directId, previewUserId: null, previewOrgId: null };

  const userId = normalizeUserId(req.user?.user_id);
  if (userId) return { userId, previewUserId: null, previewOrgId: null };

  if (!req.user?.email) throw new Error("Missing authenticated user email.");
  const { rows } = await pool.query(
    "SELECT id FROM public.userdata WHERE email=$1 LIMIT 1",
    [req.user.email]
  );
  if (!rows[0]?.id) throw new Error("User record not found.");
  return { userId: String(rows[0].id), previewUserId: null, previewOrgId: null };
}

async function loadMembershipsForUser(userId, { legacyOrgId = null } = {}) {
  const memberships = [];
  if (await hasUserOrgMembershipTable()) {
    const { rows } = await pool.query(
      `
        SELECT
          m.org_id,
          COALESCE(m.role, 'admin') AS role,
          COALESCE(m.is_active, true) AS is_active,
          o.name AS org_name,
          o.status AS org_status
        FROM public.user_org_memberships m
        LEFT JOIN public.organizations o
          ON o.id = m.org_id
        WHERE m.user_id = $1
          AND COALESCE(m.is_active, true) = true
        ORDER BY LOWER(COALESCE(o.name, '')), m.org_id ASC
      `,
      [userId]
    );
    rows.forEach((row) => {
      const orgId = normalizeOrgId(row?.org_id);
      if (!orgId) return;
      memberships.push({
        orgId,
        org_name: row?.org_name || "",
        org_status: row?.org_status || "",
        role: String(row?.role || "admin"),
        is_active: row?.is_active !== false,
      });
    });
  }

  const hasLegacyOrg = legacyOrgId != null && Number.isFinite(Number(legacyOrgId));
  const knownOrgIds = new Set(memberships.map((entry) => entry.orgId));
  if (hasLegacyOrg && !knownOrgIds.has(Number(legacyOrgId))) {
    const { rows: [legacyOrg] = [] } = await pool.query(
      `
        SELECT id, name, status
        FROM public.organizations
        WHERE id = $1
        LIMIT 1
      `,
      [Number(legacyOrgId)]
    );
    if (legacyOrg?.id != null) {
      memberships.push({
        orgId: Number(legacyOrg.id),
        org_name: legacyOrg.name || "",
        org_status: legacyOrg.status || "",
        role: "admin",
        is_active: true,
      });
    }
  }

  return memberships.sort((a, b) => {
    const nameCmp = String(a.org_name || "").localeCompare(String(b.org_name || ""));
    if (nameCmp !== 0) return nameCmp;
    return Number(a.orgId) - Number(b.orgId);
  });
}

function resolveSessionActiveOrgId(req, previewUserId) {
  if (!req?.session) return null;
  const key = previewUserId ? ADMIN_ORG_PORTAL_PREVIEW_ORG_ID_KEY : ACTIVE_ORG_ID_KEY;
  return normalizeOrgId(req.session[key]);
}

function persistSessionActiveOrgId(req, previewUserId, orgId) {
  if (!req?.session) return;
  const key = previewUserId ? ADMIN_ORG_PORTAL_PREVIEW_ORG_ID_KEY : ACTIVE_ORG_ID_KEY;
  if (orgId == null) {
    delete req.session[key];
  } else {
    req.session[key] = String(orgId);
  }
}

function pickActiveOrgId({
  memberships,
  previewOrgId = null,
  sessionActiveOrgId = null,
  legacyOrgId = null,
}) {
  const knownOrgIds = new Set(
    memberships
      .map((entry) => normalizeOrgId(entry?.orgId))
      .filter((entry) => entry != null)
  );

  if (previewOrgId != null && knownOrgIds.has(previewOrgId)) return previewOrgId;
  if (sessionActiveOrgId != null && knownOrgIds.has(sessionActiveOrgId)) return sessionActiveOrgId;
  if (legacyOrgId != null && knownOrgIds.has(legacyOrgId)) return legacyOrgId;
  if (memberships.length) return normalizeOrgId(memberships[0].orgId);
  return legacyOrgId != null ? legacyOrgId : null;
}

export async function setSessionActiveOrg(req, orgId, { allowAdminPreview = true } = {}) {
  const targetOrgId = normalizeOrgId(orgId);
  if (targetOrgId == null) {
    return { ok: false, error: "invalid_org_id" };
  }

  const { userId, previewUserId } = await resolveAuthenticatedUserId(req, { allowAdminPreview });
  const { rows: [userRow] = [] } = await pool.query(
    "SELECT org_id FROM public.userdata WHERE id = $1 LIMIT 1",
    [userId]
  );
  const legacyOrgId = normalizeOrgId(userRow?.org_id);
  const memberships = await loadMembershipsForUser(userId, { legacyOrgId });
  const knownOrgIds = new Set(memberships.map((entry) => normalizeOrgId(entry.orgId)).filter(Boolean));
  if (!knownOrgIds.has(targetOrgId)) {
    return { ok: false, error: "forbidden" };
  }

  persistSessionActiveOrgId(req, previewUserId, targetOrgId);
  return { ok: true, orgId: targetOrgId, previewUserId, memberships };
}

export async function resolveOrgScope(
  req,
  { allowAdminPreview = false, includeOrgMembersForOrgRep = true } = {}
) {
  const { userId, previewUserId, previewOrgId } = await resolveAuthenticatedUserId(req, { allowAdminPreview });
  const { rows: [userRow] = [] } = await pool.query(
    "SELECT id, org_id, org_rep FROM public.userdata WHERE id = $1 LIMIT 1",
    [userId]
  );

  const legacyOrgId = normalizeOrgId(userRow?.org_id);
  const memberships = await loadMembershipsForUser(userId, { legacyOrgId });
  const sessionActiveOrgId = resolveSessionActiveOrgId(req, previewUserId);
  const orgId = pickActiveOrgId({
    memberships,
    previewOrgId,
    sessionActiveOrgId,
    legacyOrgId,
  });
  persistSessionActiveOrgId(req, previewUserId, orgId);

  const hasOrg = orgId != null;
  const hasOrgRepAccess = Boolean(previewUserId) || memberships.length > 0 || userRow?.org_rep === true;
  const canExpandToOrgMembers = includeOrgMembersForOrgRep && hasOrg && hasOrgRepAccess;

  let memberUserIds = [String(userId)];
  if (canExpandToOrgMembers) {
    let ids = [];
    if (await hasUserOrgMembershipTable()) {
      const { rows } = await pool.query(
        `
          SELECT user_id AS id
          FROM public.user_org_memberships
          WHERE org_id = $1
            AND COALESCE(is_active, true) = true
          ORDER BY user_id ASC
        `,
        [orgId]
      );
      ids = rows.map((row) => String(row.id || "").trim()).filter(Boolean);
    } else {
      const { rows } = await pool.query(
        `
          SELECT id
          FROM public.userdata
          WHERE org_id = $1
          ORDER BY id ASC
        `,
        [orgId]
      );
      ids = rows.map((row) => String(row.id || "").trim()).filter(Boolean);
    }

    if (ids.length) {
      memberUserIds = Array.from(new Set(ids));
    }
  }

  return {
    actorUserId: String(userId),
    previewUserId: previewUserId || null,
    orgId: orgId != null ? Number(orgId) : null,
    activeOrgId: orgId != null ? Number(orgId) : null,
    hasOrgRepAccess,
    memberUserIds,
    memberships,
  };
}
