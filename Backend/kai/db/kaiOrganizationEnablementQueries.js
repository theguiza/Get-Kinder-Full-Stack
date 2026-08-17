import pool from "./kaiDb.js";
import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import {
  listActiveGkOrganizationBindingsForGkOrganizationIds,
  upsertGkOrganizationBinding,
} from "./kaiOrganizationBindingQueries.js";

const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;

// Distinct from kaiQueries.js#KAI_USER_PROVISIONING_LOCK_NAMESPACE (913_224_001).
const KAI_ORGANIZATION_ENABLEMENT_LOCK_NAMESPACE = 913_224_002;

// No engagement_code convention exists anywhere in this repository (confirmed
// by repository-wide search before this package). This is the first
// established convention: a single, deterministic code for the one initial
// engagement every newly KAI-enabled organization receives, so repeated
// enablement requests converge on the same kai.engagements row via the
// existing UNIQUE (organization_id, engagement_code) constraint instead of
// requiring an application-level lock.
export const DEFAULT_INITIAL_ENGAGEMENT_CODE = "initial-pilot-assessment";

function normalizeGkOrganizationId(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Confirms the requested Get Kinder organization exists. Read-only; does not
 * expose any field beyond the id required to proceed.
 */
export async function selectGkOrganizationRow(gkOrganizationId, db = pool) {
  const normalizedGkOrganizationId = normalizeGkOrganizationId(gkOrganizationId);
  if (!normalizedGkOrganizationId) return null;
  const { rows } = await db.query(
    `SELECT id FROM public.organizations WHERE id = $1 LIMIT 1`,
    [normalizedGkOrganizationId],
  );
  return rows[0] || null;
}

/**
 * Idempotent, concurrency-safe create-or-reuse of the active
 * kai.gk_organization_bindings row for a Get Kinder organization.
 *
 * kai.organizations is not created or migrated by this repository (confirmed
 * by repository-wide search before this package) and kai.gk_organization_bindings
 * .kai_organization_id carries no foreign key to it - the binding migration's
 * own comment records that this is deliberate: no relationship is fabricated
 * against a schema this repository does not own or confirm. Accordingly this
 * function mints a new kai_organization_id (a fresh UUID) only when no active
 * binding already exists, and never writes to kai.organizations. Whether a
 * corresponding kai.organizations row is separately created by KAI's own
 * (external) system for that id is NOT_CONFIRMED by this repository.
 *
 * Concurrency safety mirrors kaiQueries.js#findOrCreateKaiUserByLegacyPublicUserdataId:
 * a Postgres advisory transaction lock keyed on the Get Kinder organization id
 * serializes concurrent first-enablement attempts, so two simultaneous
 * requests for the same organization cannot both observe "no active binding"
 * and both mint/insert a different kai_organization_id.
 */
export async function findOrCreateActiveKaiOrganizationBindingForGkOrganization(
  { gkOrganizationId } = {},
  db = pool,
) {
  const normalizedGkOrganizationId = normalizeGkOrganizationId(gkOrganizationId);
  if (!normalizedGkOrganizationId) {
    return { ok: false, error_code: "invalid_gk_organization_id" };
  }

  const isRealPool = typeof db.connect === "function";
  const client = isRealPool ? await db.connect() : db;
  try {
    if (isRealPool) await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      KAI_ORGANIZATION_ENABLEMENT_LOCK_NAMESPACE,
      normalizedGkOrganizationId,
    ]);

    const existingBindings = await listActiveGkOrganizationBindingsForGkOrganizationIds(
      [normalizedGkOrganizationId],
      client,
    );
    if (existingBindings[0]) {
      if (isRealPool) await client.query("COMMIT");
      return { ok: true, binding: existingBindings[0], created: false };
    }

    const { rows: [minted] } = await client.query("SELECT gen_random_uuid()::text AS id");
    const upsertResult = await upsertGkOrganizationBinding(
      { gkOrganizationId: normalizedGkOrganizationId, kaiOrganizationId: minted.id },
      client,
    );
    if (!upsertResult.ok) {
      if (isRealPool) await client.query("ROLLBACK").catch(() => {});
      return upsertResult;
    }
    if (isRealPool) await client.query("COMMIT");
    return { ok: true, binding: upsertResult.binding, created: upsertResult.created };
  } catch (error) {
    if (isRealPool) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (isRealPool) client.release();
  }
}

async function selectEngagementByOrganizationAndCode(db, organizationId, engagementCode) {
  const { rows } = await db.query(
    `SELECT engagement_id, organization_id, engagement_code
       FROM kai.engagements
      WHERE organization_id = $1
        AND engagement_code = $2
      LIMIT 1`,
    [organizationId, engagementCode],
  );
  return rows[0] || null;
}

/**
 * Idempotent create-or-reuse of the one initial kai.engagements row for a
 * newly (or already) KAI-enabled organization. Relies on the established
 * production UNIQUE (organization_id, engagement_code) constraint rather than
 * an advisory lock - mirrors kaiOrganizationBindingQueries.js#upsertGkOrganizationBinding's
 * check-then-insert-catch-23505 shape. Only inserts organization_id,
 * engagement_code, created_by - every other column (engagement_type,
 * engagement_status, created_by_type, project_metadata) is left to its
 * established production default.
 */
export async function findOrCreateInitialEngagementForOrganization(
  { organizationId, engagementCode = DEFAULT_INITIAL_ENGAGEMENT_CODE, createdByUserId = null } = {},
  db = pool,
) {
  if (typeof organizationId !== "string" || !UUID_RE.test(organizationId)) {
    return { ok: false, error_code: "invalid_organization_id" };
  }
  const normalizedEngagementCode =
    typeof engagementCode === "string" && engagementCode.length > 0
      ? engagementCode
      : DEFAULT_INITIAL_ENGAGEMENT_CODE;

  const isRealPool = typeof db.connect === "function";
  const client = isRealPool ? await db.connect() : db;
  try {
    if (isRealPool) await client.query("BEGIN");

    const existing = await selectEngagementByOrganizationAndCode(client, organizationId, normalizedEngagementCode);
    if (existing) {
      if (isRealPool) await client.query("COMMIT");
      return { ok: true, engagement: existing, created: false };
    }

    try {
      const { rows } = await client.query(
        `INSERT INTO kai.engagements (organization_id, engagement_code, created_by)
         VALUES ($1, $2, $3)
         RETURNING engagement_id, organization_id, engagement_code`,
        [organizationId, normalizedEngagementCode, createdByUserId],
      );
      if (isRealPool) await client.query("COMMIT");
      return { ok: true, engagement: rows[0], created: true };
    } catch (error) {
      if (isRealPool) await client.query("ROLLBACK").catch(() => {});
      if (error?.code === "23505") {
        const reselected = await selectEngagementByOrganizationAndCode(db, organizationId, normalizedEngagementCode);
        if (reselected) return { ok: true, engagement: reselected, created: false };
        return { ok: false, error_code: "conflicting_engagement" };
      }
      throw error;
    }
  } finally {
    if (isRealPool) client.release();
  }
}
