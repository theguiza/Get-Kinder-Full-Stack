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

export async function getEngagementForOrganization({ organizationId, engagementId, lockForUpdate = false }, db = pool) {
  if (!organizationId || !engagementId) return null;
  const { rows } = await db.query(
    `SELECT engagement_id, organization_id, engagement_type, engagement_status, project_metadata
       FROM kai.engagements
      WHERE organization_id = $1
        AND engagement_id = $2
      LIMIT 1${lockForUpdate ? " FOR UPDATE" : ""}`,
    [organizationId, engagementId],
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
    `SELECT engagement_id, organization_id, engagement_type, engagement_status, project_metadata
       FROM kai.engagements
      WHERE organization_id = $1
      ORDER BY engagement_id ASC
      LIMIT 100`,
    [organizationId],
  );
  return rows;
}

export async function updateEngagementProjectMetadata(
  { organizationId, engagementId, projectMetadata },
  db = pool,
) {
  const { rows } = await db.query(
    `UPDATE kai.engagements
        SET project_metadata = $3::jsonb
      WHERE organization_id = $1
        AND engagement_id = $2
      RETURNING engagement_id, organization_id, engagement_type, engagement_status, project_metadata`,
    [organizationId, engagementId, JSON.stringify(projectMetadata || {})],
  );
  return rows[0] || null;
}

/**
 * KAI Impact Library redesign, Package F completeness repair
 * (project_status/use_case_type): updates project_metadata (the jsonb home
 * for `use_case_type`, alongside the already-existing
 * `engagement_requirement_target` key) and, only when supplied, the
 * already-existing `engagement_status` column. The caller
 * (kaiEngagementContextService's isUpdateEngagementProjectDetailsInput)
 * validates `projectStatus` against the real kai.engagement_status_enum's
 * production vocabulary before this function is ever called. engagement_status
 * is NOT NULL, so it is only ever set, never cleared, by this query.
 */
export async function updateEngagementProjectFields(
  { organizationId, engagementId, projectMetadata, engagementStatus },
  db = pool,
) {
  const setClauses = ["project_metadata = $3::jsonb"];
  const values = [organizationId, engagementId, JSON.stringify(projectMetadata || {})];
  if (typeof engagementStatus === "string" && engagementStatus.length > 0) {
    values.push(engagementStatus);
    setClauses.push(`engagement_status = $${values.length}`);
  }
  const { rows } = await db.query(
    `UPDATE kai.engagements
        SET ${setClauses.join(", ")}
      WHERE organization_id = $1
        AND engagement_id = $2
      RETURNING engagement_id, organization_id, engagement_type, engagement_status, project_metadata`,
    values,
  );
  return rows[0] || null;
}

export async function listExternalRequirementSetsForTarget(
  { sourceCode, frameworkCode },
  db = pool,
) {
  if (!sourceCode || !frameworkCode) return [];
  const { rows } = await db.query(
    `SELECT rs.requirement_set_id::text AS requirement_set_id,
            rs.set_key,
            rs.set_name,
            rfv.requirement_framework_version_id::text AS requirement_framework_version_id,
            rfv.framework_code,
            rfv.framework_name,
            rfv.version_label,
            rfv.framework_status,
            src.requirement_source_id::text AS requirement_source_id,
            src.source_type,
            src.source_code,
            src.source_name,
            count(r.requirement_id)::int AS requirement_count,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'requirement_id', r.requirement_id::text,
                  'requirement_key', r.requirement_key
                )
                ORDER BY r.display_order ASC, r.requirement_key ASC
              ) FILTER (WHERE r.requirement_id IS NOT NULL),
              '[]'::jsonb
            ) AS requirements
       FROM kai.requirement_sets rs
       JOIN kai.requirement_framework_versions rfv
         ON rfv.requirement_framework_version_id = rs.requirement_framework_version_id
       JOIN kai.requirement_sources src
         ON src.requirement_source_id = rfv.requirement_source_id
       LEFT JOIN kai.requirements r
         ON r.requirement_set_id = rs.requirement_set_id
      WHERE src.source_type <> 'kai_standard'
        AND src.source_code = $1
        AND rfv.framework_code = $2
        AND rfv.framework_status = 'active'
      GROUP BY rs.requirement_set_id,
               rs.set_key,
               rs.set_name,
               rfv.requirement_framework_version_id,
               rfv.framework_code,
               rfv.framework_name,
               rfv.version_label,
               rfv.framework_status,
               src.requirement_source_id,
               src.source_type,
               src.source_code,
               src.source_name
      ORDER BY src.source_code ASC, rfv.framework_code ASC, rfv.version_label ASC, rs.set_key ASC
      LIMIT 100`,
    [sourceCode, frameworkCode],
  );
  return rows;
}

export async function listEngagementRequirementSetsForOrganization(
  { organizationId, engagementId },
  db = pool,
) {
  if (!organizationId || !engagementId) return [];
  const { rows } = await db.query(
    `SELECT ers.engagement_requirement_set_id::text AS engagement_requirement_set_id,
            ers.organization_id::text AS organization_id,
            ers.engagement_id::text AS engagement_id,
            ers.requirement_set_id::text AS requirement_set_id,
            ers.applicability_status,
            ers.applicability_effective_state,
            ers.reviewed_by::text AS reviewed_by,
            ers.reviewed_by_role,
            ers.reviewed_at,
            ers.supersedes_engagement_requirement_set_id::text AS supersedes_engagement_requirement_set_id,
            successor.engagement_requirement_set_id::text AS superseded_by_engagement_requirement_set_id,
            ers.target_context_identity,
            ers.created_by::text AS created_by,
            ers.created_by_type,
            ers.created_at,
            rs.set_key,
            rs.set_name,
            rfv.requirement_framework_version_id::text AS requirement_framework_version_id,
            rfv.framework_code,
            rfv.framework_name,
            rfv.version_label,
            rfv.framework_status,
            src.requirement_source_id::text AS requirement_source_id,
            src.source_type,
            src.source_code,
            src.source_name
       FROM kai.engagement_requirement_sets ers
       JOIN kai.requirement_sets rs
         ON rs.requirement_set_id = ers.requirement_set_id
       JOIN kai.requirement_framework_versions rfv
         ON rfv.requirement_framework_version_id = rs.requirement_framework_version_id
       JOIN kai.requirement_sources src
         ON src.requirement_source_id = rfv.requirement_source_id
       LEFT JOIN kai.engagement_requirement_sets successor
         ON successor.supersedes_engagement_requirement_set_id = ers.engagement_requirement_set_id
      WHERE ers.organization_id = $1
        AND ers.engagement_id = $2
      ORDER BY ers.created_at DESC, ers.engagement_requirement_set_id ASC
      LIMIT 100`,
    [organizationId, engagementId],
  );
  return rows;
}

/**
 * Package 3A read: the bare requirement_set_id a single kai.requirements row
 * belongs to. kai.requirements (B1.1) carries no organization_id/engagement_id
 * of its own - shared catalogue data - so this is only ever used to resolve
 * a requirement_id into the requirement_set_id needed to look up that set's
 * governed authority (getRequirementSetAuthority) and its engagement
 * applicability (listEngagementRequirementSetsForOrganization).
 */
export async function getRequirementSetIdForRequirement({ requirementId }, db = pool) {
  if (!requirementId) return null;
  const { rows } = await db.query(
    `SELECT requirement_id::text AS requirement_id, requirement_set_id::text AS requirement_set_id
       FROM kai.requirements
      WHERE requirement_id = $1
      LIMIT 1`,
    [requirementId],
  );
  return rows[0] || null;
}

/**
 * Package 2B-A governed-authority read: the exact source/framework/status
 * identity of one requirement set, keyed by requirement_set_id. Used only to
 * validate a proposed or reviewed engagement_requirement_sets row against its
 * requirement-set authority (kai_standard exclusion, active-governed
 * authority, exact source_code/framework_code target identity) - never to
 * infer a target from set_key/set_name/labels.
 */
export async function getRequirementSetAuthority({ requirementSetId }, db = pool) {
  if (!requirementSetId) return null;
  const { rows } = await db.query(
    `SELECT rs.requirement_set_id::text AS requirement_set_id,
            rs.set_key,
            rs.set_name,
            rfv.requirement_framework_version_id::text AS requirement_framework_version_id,
            rfv.framework_code,
            rfv.framework_status,
            src.requirement_source_id::text AS requirement_source_id,
            src.source_type,
            src.source_code
       FROM kai.requirement_sets rs
       JOIN kai.requirement_framework_versions rfv
         ON rfv.requirement_framework_version_id = rs.requirement_framework_version_id
       JOIN kai.requirement_sources src
         ON src.requirement_source_id = rfv.requirement_source_id
      WHERE rs.requirement_set_id = $1
      LIMIT 1`,
    [requirementSetId],
  );
  return rows[0] || null;
}

const ENGAGEMENT_REQUIREMENT_SET_RETURNING_COLUMNS = `
            engagement_requirement_set_id::text AS engagement_requirement_set_id,
            organization_id::text AS organization_id,
            engagement_id::text AS engagement_id,
            requirement_set_id::text AS requirement_set_id,
            applicability_status,
            applicability_effective_state,
            reviewed_by::text AS reviewed_by,
            reviewed_by_role,
            reviewed_at,
            supersedes_engagement_requirement_set_id::text AS supersedes_engagement_requirement_set_id,
            target_context_identity,
            created_by::text AS created_by,
            created_by_type,
            created_at`;

/**
 * Package 2B-A proposal writer: inserts the non-authoritative root row for
 * one (organization, engagement, requirement_set) identity -
 * applicability_status = 'proposed', applicability_effective_state left at
 * its Package 2A default 'pending_review', reviewed_* and
 * target_context_identity left NULL. Never establishes current applicability
 * - the append-only schema's partial unique index already permits at most
 * one such root row per identity (kai_sprint2_package_2a_..._current_identity).
 */
export async function insertEngagementRequirementSetProposal(
  { organizationId, engagementId, requirementSetId, createdBy, createdByType },
  db = pool,
) {
  const { rows } = await db.query(
    `INSERT INTO kai.engagement_requirement_sets (
       organization_id, engagement_id, requirement_set_id, applicability_status,
       created_by, created_by_type
     ) VALUES ($1, $2, $3, 'proposed', $4, $5)
     RETURNING ${ENGAGEMENT_REQUIREMENT_SET_RETURNING_COLUMNS}`,
    [organizationId, engagementId, requirementSetId, createdBy || null, createdByType],
  );
  return rows[0] || null;
}

/**
 * Package 2B current-authority read: the Package 2A current-authority
 * predicate itself - a row with no successor is the current/tip row for its
 * (organization_id, engagement_id, requirement_set_id) identity, exactly the
 * same derivation listEngagementRequirementSetsForOrganization uses for
 * superseded_by_engagement_requirement_set_id, here applied directly to find
 * "the current decision" for one governed identity rather than trusting a
 * caller-supplied row id. This is what a governed replacement/lifecycle
 * write (Package 2B-B) must look up before superseding: the current row may
 * be the original non-authoritative proposal (Package 2B-A) or an already
 * reviewed/confirmed decision (a Package 2B-B replacement). Scoped by
 * organization_id and engagement_id so a caller can never resolve a row
 * belonging to another tenant or engagement. Supports FOR UPDATE locking so
 * a governed review transaction can serialize concurrent review attempts
 * against the same identity; the partial unique index on
 * supersedes_engagement_requirement_set_id (Package 2A) is still the actual
 * conflict-safety backstop if two transactions race past this lock.
 */
export async function getCurrentEngagementRequirementSetForIdentity(
  { organizationId, engagementId, requirementSetId, lockForUpdate = false },
  db = pool,
) {
  if (!organizationId || !engagementId || !requirementSetId) return null;
  const { rows } = await db.query(
    `SELECT ers.engagement_requirement_set_id::text AS engagement_requirement_set_id,
            ers.organization_id::text AS organization_id,
            ers.engagement_id::text AS engagement_id,
            ers.requirement_set_id::text AS requirement_set_id,
            ers.applicability_status,
            ers.applicability_effective_state,
            ers.supersedes_engagement_requirement_set_id::text AS supersedes_engagement_requirement_set_id
       FROM kai.engagement_requirement_sets ers
      WHERE ers.organization_id = $1
        AND ers.engagement_id = $2
        AND ers.requirement_set_id = $3
        AND NOT EXISTS (
          SELECT 1
            FROM kai.engagement_requirement_sets successor
           WHERE successor.supersedes_engagement_requirement_set_id = ers.engagement_requirement_set_id
        )
      LIMIT 1${lockForUpdate ? " FOR UPDATE" : ""}`,
    [organizationId, engagementId, requirementSetId],
  );
  return rows[0] || null;
}

/**
 * Package 2B review/approval and Package 2B-B replacement writer: inserts
 * the reviewed row that supersedes exactly one prior row - the locked
 * current row read by getCurrentEngagementRequirementSetForIdentity, whether
 * that prior row was a non-authoritative proposal or an already-reviewed
 * decision being replaced. reviewed_by/reviewed_by_role/
 * reviewed_at/target_context_identity are all caller-supplied here because
 * the service layer - never the client - derives them (authenticated actor,
 * fixed reviewer role, server clock, current governed engagement target).
 * The Package 2A append-only schema itself still enforces reviewed-authority
 * shape, effective-state values, approved-target-shape, not-self-superseding,
 * and "at most one successor per superseded row".
 */
export async function insertEngagementRequirementSetReviewApproval(
  {
    organizationId,
    engagementId,
    requirementSetId,
    supersedesEngagementRequirementSetId,
    reviewedBy,
    reviewedByRole,
    reviewedAt,
    applicabilityEffectiveState,
    targetContextIdentity,
    createdBy,
    createdByType,
  },
  db = pool,
) {
  const { rows } = await db.query(
    `INSERT INTO kai.engagement_requirement_sets (
       organization_id, engagement_id, requirement_set_id, applicability_status,
       reviewed_by, reviewed_by_role, reviewed_at, applicability_effective_state,
       supersedes_engagement_requirement_set_id, target_context_identity,
       created_by, created_by_type
     ) VALUES ($1, $2, $3, 'confirmed', $4, $5, $6::timestamptz, $7, $8, $9::jsonb, $10, $11)
     RETURNING ${ENGAGEMENT_REQUIREMENT_SET_RETURNING_COLUMNS}`,
    [
      organizationId,
      engagementId,
      requirementSetId,
      reviewedBy,
      reviewedByRole,
      reviewedAt,
      applicabilityEffectiveState,
      supersedesEngagementRequirementSetId,
      JSON.stringify(targetContextIdentity || {}),
      createdBy,
      createdByType,
    ],
  );
  return rows[0] || null;
}
