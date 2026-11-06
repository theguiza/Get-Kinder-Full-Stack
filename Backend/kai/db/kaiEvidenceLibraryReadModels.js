import pool from "./kaiDb.js";
import { projectEvidenceScopeSql } from "./kaiProjectEvidenceScope.js";

/**
 * Read-only organization-scoped Evidence Library index (KAI Impact Library
 * redesign, E1 correction).
 *
 * kai.evidence_items has no column and no foreign key referencing
 * kai.claims - the dependency runs the other way (kai.claims.evidence_item_id
 * REFERENCES kai.evidence_items, ON DELETE RESTRICT; see
 * migrations/kai_sprint2_p2_03_claim_proposal.sql). Nothing enforces that
 * every evidence item has a claim: the governed pipeline is source
 * promotion -> evidence extraction -> coverage/quality assessment -> claim
 * proposal, and an evidence item can exist at any stage before the last
 * one. Enumerating evidence through kai.claims (a LEFT JOIN from claims,
 * as the Knowledge Studio Evidence tab previously did) would silently
 * exclude every evidence item that has not yet had a claim proposed for
 * it. This read model enumerates kai.evidence_items directly instead.
 *
 * Each row also carries the evidence item's own P2-01 `evidence_review`
 * queue item (at most one per evidence item, by
 * ux_review_queue_items_p2_01_evidence_review_identity): its id, status pair,
 * and updated_at - the exact optimistic-concurrency token the P2-12
 * evidence-review decision route compares against - plus the outcome of the
 * current P2-12 decision-lineage head (the decision with no successor), if
 * any. Only the outcome is read: never the reviewer identity, role,
 * limitation notes, or queue summary/metadata. This is what lets a GK
 * reviewer act on evidence that has no claim yet.
 *
 * The head is never chosen: the count of unsuperseded decisions is returned
 * with the outcome, and the outcome only when that count is exactly 1. More
 * than one head is ambiguous governance state - the P2-12 write repository
 * refuses it (AmbiguousDecisionLineageError) - and the service fails the
 * whole read closed on it.
 */
export async function listOrganizationEvidenceItems(
  organizationId,
  { limit, afterEvidenceItemId = null, engagementId = null },
  db = pool,
) {
  const params = [organizationId, limit + 1];
  const cursorClause = afterEvidenceItemId === null ? "" : `AND ei.evidence_item_id > $${params.push(afterEvidenceItemId)}::uuid`;
  // Project working view (kaiProjectEvidenceScope.js): filtered before LIMIT.
  // Omitted, this is the organization-wide library read.
  const scopeClause = engagementId === null
    ? ""
    : `AND ${projectEvidenceScopeSql({ evidenceAlias: "ei", engagementParam: `$${params.push(engagementId)}` })}`;

  const { rows } = await db.query(
    `SELECT ei.evidence_item_id::text AS evidence_item_id,
            ei.organization_id::text AS organization_id,
            ei.source_id::text AS source_id,
            ei.source_version_id::text AS source_version_id,
            ei.evidence_type, ei.data_class, ei.sensitivity_level, ei.support_strength, ei.statement,
            ei.evidence_review_status, ei.internal_only, ei.public_use_allowed, ei.funder_use_allowed,
            rq.review_queue_item_id::text AS review_queue_item_id,
            rq.queue_status AS review_queue_status,
            rq.review_status AS review_queue_review_status,
            rq.updated_at AS review_queue_updated_at,
            head.decision_outcome AS evidence_review_decision_outcome,
            head.head_count AS evidence_review_decision_head_count
       FROM kai.evidence_items ei
       LEFT JOIN kai.review_queue_items rq
         ON rq.organization_id = ei.organization_id
        AND rq.queue_type = 'evidence_review'
        AND rq.target_object_type = 'evidence_item'
        AND rq.target_object_id = ei.evidence_item_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS head_count,
                CASE WHEN count(*) = 1 THEN min(d.decision_outcome) END AS decision_outcome
           FROM kai.evidence_review_decisions d
          WHERE d.organization_id = ei.organization_id
            AND d.evidence_item_id = ei.evidence_item_id
            AND NOT EXISTS (
              SELECT 1
                FROM kai.evidence_review_decisions s
               WHERE s.supersedes_decision_id = d.decision_id
            )
       ) head ON true
      WHERE ei.organization_id = $1::uuid
        ${cursorClause}
        ${scopeClause}
      ORDER BY ei.evidence_item_id ASC
      LIMIT $2::int`,
    params,
  );
  return withDerivedMeasurementFamilies(organizationId, rows, db);
}

const DERIVED_MEASUREMENT_EVIDENCE_TYPE = "source_derived_measurement";

/**
 * Knowledge Studio four-view refactor (2026-11-06): the recorded family
 * (paired_outcome_change, cross_source_reach, tabular_count, ...) of the
 * source-derived measurement each derived-measurement evidence item on this
 * page states, so the Impact and Evidence views group outcome and reach
 * measurements by their recorded definition, never by inferring from prose.
 * One batched, tenant-scoped, read-only lookup for the page, issued only when
 * the page holds derived-measurement evidence (which is written only through
 * kai.evidence_derived_measurements, so an organization without derived
 * measurements never reads those tables). Every other row gets null.
 */
async function withDerivedMeasurementFamilies(organizationId, rows, db) {
  const derivedIds = rows.filter((row) => row.evidence_type === DERIVED_MEASUREMENT_EVIDENCE_TYPE).map((row) => row.evidence_item_id);
  if (derivedIds.length === 0) return rows.map((row) => ({ ...row, measurement_family: null }));
  const { rows: families } = await db.query(
    `SELECT edm.evidence_item_id::text AS evidence_item_id, dm.measurement_family
       FROM kai.evidence_derived_measurements edm
       JOIN kai.source_derived_measurements dm
         ON dm.organization_id = edm.organization_id
        AND dm.source_derived_measurement_id = edm.source_derived_measurement_id
      WHERE edm.organization_id = $1::uuid
        AND edm.evidence_item_id = ANY($2::uuid[])`,
    [organizationId, derivedIds],
  );
  const familyById = new Map(families.map((row) => [row.evidence_item_id, row.measurement_family]));
  return rows.map((row) => ({ ...row, measurement_family: familyById.get(row.evidence_item_id) ?? null }));
}
