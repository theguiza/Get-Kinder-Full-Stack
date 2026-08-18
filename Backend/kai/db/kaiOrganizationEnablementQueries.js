import pool from "./kaiDb.js";
import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";

const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;

export const KAI_ORGANIZATION_ENABLEMENT_LOCK_NAMESPACE = 913_224_002;

// No engagement_code convention exists anywhere in this repository. This
// remains the first, NOT_CONFIRMED convention introduced by the original
// organization-enablement package: a single, deterministic code for the one
// initial engagement every newly KAI-enabled organization receives, so
// repeated enablement requests converge on the same kai.engagements row via
// the established UNIQUE (organization_id, engagement_code) constraint. Its
// durable product status remains NOT_CONFIRMED pending an owner decision;
// this correction package does not ratify it and does not rename it.
export const DEFAULT_INITIAL_ENGAGEMENT_CODE = "initial-pilot-assessment";

function normalizeGkOrganizationId(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeRequiredName(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * All functions in this module are pure DB primitives: each accepts the
 * caller-supplied `db` (a pool for standalone reads, or a transaction-scoped
 * client when called as part of the single-transaction organization
 * enablement flow orchestrated by kaiOrganizationEnablementService.js) and
 * never opens or commits its own transaction. Transaction ownership belongs
 * exclusively to that orchestration layer (Backend/kai/db/kaiDb.js#withTransaction).
 */

export async function acquireOrganizationEnablementLock(gkOrganizationId, db = pool) {
  const normalized = normalizeGkOrganizationId(gkOrganizationId);
  if (!normalized) return;
  await db.query("SELECT pg_advisory_xact_lock($1, $2)", [
    KAI_ORGANIZATION_ENABLEMENT_LOCK_NAMESPACE,
    normalized,
  ]);
}

/**
 * Confirms the requested Get Kinder organization exists and returns the
 * authoritative name used to provision the KAI organization. Read-only;
 * exposes only id/name.
 */
export async function selectGkOrganizationRow(gkOrganizationId, db = pool) {
  const normalizedGkOrganizationId = normalizeGkOrganizationId(gkOrganizationId);
  if (!normalizedGkOrganizationId) return null;
  const { rows } = await db.query(
    `SELECT id, name FROM public.organizations WHERE id = $1 LIMIT 1`,
    [normalizedGkOrganizationId],
  );
  return rows[0] || null;
}

/**
 * Read-only existence check for a kai.organizations row by its primary key.
 * Used to detect an active kai.gk_organization_bindings row whose
 * kai_organization_id no longer resolves to a real organization row (an
 * inconsistent state this operation must fail closed on, never repair).
 */
export async function selectKaiOrganizationRow(kaiOrganizationId, db = pool) {
  if (typeof kaiOrganizationId !== "string" || !UUID_RE.test(kaiOrganizationId)) return null;
  const { rows } = await db.query(
    `SELECT organization_id FROM kai.organizations WHERE organization_id = $1 LIMIT 1`,
    [kaiOrganizationId.toLowerCase()],
  );
  return rows[0] || null;
}

/**
 * INSERTs exactly one kai.organizations row. Only name,
 * legacy_public_organization_id, and legacy_public_organization_source are
 * supplied - organization_id, organization_type, status, created_by_type,
 * created_at, and updated_at are left entirely to their PostgreSQL defaults
 * (status in particular uses kai.engagement_status_enum; this function never
 * writes a literal into it), and organization_code is left NULL.
 *
 * legacy_public_organization_id carries a NON-UNIQUE index in production and
 * is never used here (or by any caller) as an uniqueness/idempotency
 * authority - idempotency for the overall enablement operation is the
 * caller's responsibility (advisory lock + active-binding lookup), not this
 * function's. Fails closed with no INSERT executed when name is missing or
 * blank after trim - never manufactures a fallback name.
 */
export async function insertKaiOrganization({ name, legacyPublicOrganizationId } = {}, db = pool) {
  const normalizedName = normalizeRequiredName(name);
  if (!normalizedName) {
    return { ok: false, error_code: "invalid_organization_name" };
  }
  const normalizedLegacyId = normalizeGkOrganizationId(legacyPublicOrganizationId);
  if (!normalizedLegacyId) {
    return { ok: false, error_code: "invalid_gk_organization_id" };
  }
  const { rows } = await db.query(
    `INSERT INTO kai.organizations (name, legacy_public_organization_id, legacy_public_organization_source)
     VALUES ($1, $2, 'public.organizations')
     RETURNING organization_id`,
    [normalizedName, normalizedLegacyId],
  );
  return { ok: true, organizationId: rows[0].organization_id };
}

/**
 * INSERTs exactly one active kai.gk_organization_bindings row. Deliberately
 * NOT a wrapper around kaiOrganizationBindingQueries.js#upsertGkOrganizationBinding:
 * that function detects "is this a pool or an already-open transaction
 * client" via `typeof db.connect === "function"`, but a real pg.Client
 * obtained from Pool#connect() also exposes `.connect` (inherited from the
 * Client prototype - verified empirically before writing this comment), so
 * passing this module's shared transaction client into that function would
 * make it open and COMMIT its own nested transaction, prematurely committing
 * the enclosing single-transaction enablement flow this module exists to
 * guarantee. This function is a plain INSERT with no transaction control of
 * its own, safe to call with any `db` that exposes `.query`. The caller is
 * expected to have already confirmed, inside the same transaction and under
 * the organization-enablement advisory lock, that no active binding exists
 * for this Get Kinder organization - the 23505 handling here is
 * defense-in-depth against the partial unique indexes, not the primary
 * idempotency mechanism.
 */
export async function insertGkOrganizationBinding({ gkOrganizationId, kaiOrganizationId } = {}, db = pool) {
  const normalizedGkOrganizationId = normalizeGkOrganizationId(gkOrganizationId);
  if (!normalizedGkOrganizationId) {
    return { ok: false, error_code: "invalid_gk_organization_id" };
  }
  if (typeof kaiOrganizationId !== "string" || !UUID_RE.test(kaiOrganizationId)) {
    return { ok: false, error_code: "invalid_kai_organization_id" };
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status)
       VALUES ($1, $2, 'active')
       RETURNING gk_organization_binding_id, gk_organization_id, kai_organization_id, status, created_at, updated_at`,
      [normalizedGkOrganizationId, kaiOrganizationId.toLowerCase()],
    );
    return { ok: true, binding: rows[0] };
  } catch (error) {
    if (error?.code === "23505") {
      return { ok: false, error_code: "conflicting_binding" };
    }
    throw error;
  }
}

/**
 * SELECT-only lookup of the one initial kai.engagements row for a KAI
 * organization. Never inserts. Safe to call from a read-only status check.
 */
export async function selectInitialEngagementForOrganization(
  { organizationId, engagementCode = DEFAULT_INITIAL_ENGAGEMENT_CODE } = {},
  db = pool,
) {
  if (typeof organizationId !== "string" || !UUID_RE.test(organizationId)) return null;
  const normalizedEngagementCode =
    typeof engagementCode === "string" && engagementCode.length > 0 ? engagementCode : DEFAULT_INITIAL_ENGAGEMENT_CODE;
  const { rows } = await db.query(
    `SELECT engagement_id, organization_id, engagement_code
       FROM kai.engagements
      WHERE organization_id = $1
        AND engagement_code = $2
      LIMIT 1`,
    [organizationId, normalizedEngagementCode],
  );
  return rows[0] || null;
}

/**
 * INSERTs the one initial kai.engagements row. Only organization_id,
 * engagement_code, created_by are supplied - engagement_type,
 * engagement_status, created_by_type, project_metadata are left to their
 * established production defaults. The caller (orchestration layer) is
 * expected to have already confirmed no row exists for this
 * (organization_id, engagement_code) pair inside the same transaction; the
 * 23505 handling here is defense-in-depth, not the primary idempotency
 * mechanism (the advisory lock in the orchestration layer is).
 */
export async function insertInitialEngagement(
  { organizationId, engagementCode = DEFAULT_INITIAL_ENGAGEMENT_CODE, createdByUserId = null } = {},
  db = pool,
) {
  if (typeof organizationId !== "string" || !UUID_RE.test(organizationId)) {
    return { ok: false, error_code: "invalid_organization_id" };
  }
  const normalizedEngagementCode =
    typeof engagementCode === "string" && engagementCode.length > 0 ? engagementCode : DEFAULT_INITIAL_ENGAGEMENT_CODE;
  try {
    const { rows } = await db.query(
      `INSERT INTO kai.engagements (organization_id, engagement_code, created_by)
       VALUES ($1, $2, $3)
       RETURNING engagement_id, organization_id, engagement_code`,
      [organizationId, normalizedEngagementCode, createdByUserId],
    );
    return { ok: true, engagement: rows[0] };
  } catch (error) {
    if (error?.code === "23505") {
      return { ok: false, error_code: "conflicting_engagement" };
    }
    throw error;
  }
}
