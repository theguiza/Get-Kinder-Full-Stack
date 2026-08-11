import pool from "./kaiDb.js";
import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";

const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;

const BINDING_SELECT_COLUMNS =
  "gk_organization_binding_id, gk_organization_id, kai_organization_id, status, created_at, updated_at";

function normalizeGkOrganizationId(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Read-only lookup used by KAI actor/authorization context: the active
 * kai.gk_organization_bindings row (if any) per requested Get Kinder
 * organization id. Only status = 'active' rows are returned - a deactivated
 * binding must never silently continue to authorize KAI tenant access.
 */
export async function listActiveGkOrganizationBindingsForGkOrganizationIds(gkOrganizationIds, db = pool) {
  const ids = Array.from(
    new Set((Array.isArray(gkOrganizationIds) ? gkOrganizationIds : []).map(normalizeGkOrganizationId).filter(Boolean)),
  );
  if (ids.length === 0) return [];
  const { rows } = await db.query(
    `SELECT ${BINDING_SELECT_COLUMNS}
       FROM kai.gk_organization_bindings
      WHERE gk_organization_id = ANY($1::integer[])
        AND status = 'active'`,
    [ids],
  );
  return rows;
}

async function selectGkOrganizationBindingByGkOrganizationId(db, gkOrganizationId) {
  const { rows } = await db.query(
    `SELECT ${BINDING_SELECT_COLUMNS}
       FROM kai.gk_organization_bindings
      WHERE gk_organization_id = $1
      LIMIT 1`,
    [gkOrganizationId],
  );
  return rows[0] || null;
}

/**
 * Explicit, idempotent, uniqueness-safe binding-creation capability. This is
 * the ONLY controlled path that may create or change a
 * kai.gk_organization_bindings row - nothing infers or auto-creates a
 * binding from a request. Fails closed (returns ok:false, never throws a raw
 * constraint violation to the caller) when the requested pair would create
 * an ambiguous/conflicting active mapping:
 *   - the Get Kinder organization already has an active binding to a
 *     DIFFERENT KAI organization id;
 *   - the KAI organization id is already actively bound to a DIFFERENT Get
 *     Kinder organization (enforced by the database's partial unique index
 *     even under a race, surfaced here as the same conflicting_binding
 *     error code).
 * Calling this again with the same (gkOrganizationId, kaiOrganizationId,
 * status) is a no-op that returns the existing row.
 */
export async function upsertGkOrganizationBinding(
  { gkOrganizationId, kaiOrganizationId, status = "active" } = {},
  db = pool,
) {
  const normalizedGkOrganizationId = normalizeGkOrganizationId(gkOrganizationId);
  if (!normalizedGkOrganizationId) {
    return { ok: false, error_code: "invalid_gk_organization_id" };
  }
  if (typeof kaiOrganizationId !== "string" || !UUID_RE.test(kaiOrganizationId)) {
    return { ok: false, error_code: "invalid_kai_organization_id" };
  }
  if (status !== "active" && status !== "inactive") {
    return { ok: false, error_code: "invalid_status" };
  }
  const normalizedKaiOrganizationId = kaiOrganizationId.toLowerCase();

  const isRealPool = typeof db.connect === "function";
  const client = isRealPool ? await db.connect() : db;
  try {
    if (isRealPool) await client.query("BEGIN");

    const existing = await selectGkOrganizationBindingByGkOrganizationId(client, normalizedGkOrganizationId);
    if (existing) {
      if (existing.kai_organization_id.toLowerCase() !== normalizedKaiOrganizationId) {
        if (isRealPool) await client.query("ROLLBACK");
        return { ok: false, error_code: "conflicting_binding", existingBinding: existing };
      }
      if (existing.status === status) {
        if (isRealPool) await client.query("COMMIT");
        return { ok: true, binding: existing, created: false, changed: false };
      }
      const { rows } = await client.query(
        `UPDATE kai.gk_organization_bindings
            SET status = $2
          WHERE gk_organization_binding_id = $1
        RETURNING ${BINDING_SELECT_COLUMNS}`,
        [existing.gk_organization_binding_id, status],
      );
      if (isRealPool) await client.query("COMMIT");
      return { ok: true, binding: rows[0], created: false, changed: true };
    }

    try {
      const { rows } = await client.query(
        `INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status)
         VALUES ($1, $2, $3)
         RETURNING ${BINDING_SELECT_COLUMNS}`,
        [normalizedGkOrganizationId, normalizedKaiOrganizationId, status],
      );
      if (isRealPool) await client.query("COMMIT");
      return { ok: true, binding: rows[0], created: true, changed: true };
    } catch (error) {
      if (isRealPool) await client.query("ROLLBACK").catch(() => {});
      if (error?.code === "23505") {
        return { ok: false, error_code: "conflicting_binding" };
      }
      throw error;
    }
  } finally {
    if (isRealPool) client.release();
  }
}
