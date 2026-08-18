import pool from "./kaiDb.js";
import {
  getScopedSourceCandidateByIdentityForDisplay,
  getScopedSourceCandidateReviewQueueItemByIdentityForDisplay,
  getScopedSourcePromotionDecisionByIdentityForDisplay,
  getScopedSourceById,
  getScopedSourceVersionById,
} from "./kaiIntakeQueries.js";

/**
 * KAI P1-09 internal review-cockpit read models.
 *
 * Read-only, tenant-scoped, bounded reads for the internal GK review cockpit.
 * This module is additive and isolated: it does not modify, wrap, or re-export any
 * existing read model in Backend/kai/db/kaiReadModels.js, and it performs no
 * mutation of any kind. Every statement here is organization-scoped by an explicit
 * `organization_id = $1` predicate, and every collection read is bounded by an
 * explicit LIMIT.
 *
 * The source-candidate detail composes the already-accepted P1-07/P1-08 lookups in
 * Backend/kai/db/kaiIntakeQueries.js rather than adding new SQL for objects those
 * packages already own.
 */

/**
 * P1-09 owner decision: quality findings shown on a file-profile detail are capped
 * at this fixed bound. The cockpit is a review surface, not an export surface, so
 * this read is never caller-paginated.
 */
export const REVIEW_COCKPIT_MAX_QUALITY_FINDINGS = 50;

/**
 * Bounded keyset pagination over `kai.review_queue_items`, generalizing the exact
 * cursor pattern already established by listIntakeFileReviewQueueItems: a stable
 * `created_at DESC, review_queue_item_id DESC` ordering whose tie-breaker
 * (review_queue_item_id) is the table's unique primary key, a strict
 * `(created_at, review_queue_item_id) < (cursor.created_at, cursor.review_queue_item_id)`
 * predicate applied only when a cursor is supplied, and LIMIT n+1 so the caller can
 * detect a next page without a second query.
 *
 * `queueTypes` and `queueStatuses` are canonical, already-validated, non-empty
 * vocabularies supplied by the caller's validator; they are bound as parameters and
 * never interpolated as caller text.
 *
 * The `queue_metadata ? 'kai_legacy_generation_target'` exclusion is the reader half
 * of the 2026-08-17 legacy-generation cutover's review-queue treatment
 * (migrations/kai_sprint2_legacy_generation_cutover_20260817.sql, section 6). Rows
 * carrying that marker are live production queue rows whose target object belongs to
 * the preserved pre-Sprint2 generation in kai_legacy_20260817 - they are never
 * deleted, resolved, retargeted or relabelled, but their targets are not canonical
 * work and this cockpit must not present them as such. `target_object_id` carries no
 * foreign key (it is polymorphic across queue_types, as the P1-06 migration
 * explains), so nothing else in this query could distinguish them. This narrows the
 * canonical read model to canonical work; it does not teach it to tolerate a legacy
 * shape.
 */
export async function listReviewCockpitQueueItems(
  organizationId,
  { limit, cursor = null, queueTypes, queueStatuses },
  db = pool,
) {
  const params = [organizationId];
  const typePlaceholders = queueTypes.map((value) => {
    params.push(value);
    return `$${params.length}`;
  });
  const statusPlaceholders = queueStatuses.map((value) => {
    params.push(value);
    return `$${params.length}`;
  });

  let cursorPredicate = "";
  if (cursor) {
    params.push(cursor.created_at);
    const createdAtParameter = `$${params.length}`;
    params.push(cursor.review_queue_item_id);
    const identifierParameter = `$${params.length}`;
    cursorPredicate =
      `\n        AND (\n          created_at < ${createdAtParameter}\n` +
      `          OR (created_at = ${createdAtParameter} AND review_queue_item_id < ${identifierParameter})\n        )`;
  }

  params.push(limit + 1);
  const limitParameter = `$${params.length}`;

  const { rows } = await db.query(
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, priority, queue_status, due_at, summary, required_action,
            created_at, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1
        AND NOT (queue_metadata ? 'kai_legacy_generation_target')
        AND queue_type IN (${typePlaceholders.join(", ")})
        AND queue_status IN (${statusPlaceholders.join(", ")})${cursorPredicate}
      ORDER BY created_at DESC, review_queue_item_id DESC
      LIMIT ${limitParameter}`,
    params,
  );
  return rows;
}

/**
 * Read-only, tenant-scoped file-profile review record: safe profile metadata, the
 * data-dictionary summary, the bounded safe quality findings, and the P1-05
 * sensitivity/allowed-use posture. Never reads
 * `kai.intake_file_profiles.profile` (machine-generated profiling metadata) and
 * never reads any storage location, object key, or raw sample column.
 */
export async function getReviewCockpitFileProfileRecord(organizationId, fileProfileId, db = pool) {
  const fileProfileResult = await db.query(
    `SELECT file_profile_id, organization_id, intake_file_id, parser_name, parser_version,
            checksum, profile_canonical_sha256, created_at
       FROM kai.intake_file_profiles
      WHERE organization_id = $1
        AND file_profile_id = $2
      LIMIT 1`,
    [organizationId, fileProfileId],
  );
  const fileProfile = fileProfileResult.rows[0] || null;
  if (!fileProfile) return null;
  return getReviewCockpitFileProfileRecordForResolvedProfile(organizationId, fileProfile, db);
}

export async function getReviewCockpitSensitivityProfileRecord(
  organizationId,
  intakeSensitivityProfileId,
  db = pool,
) {
  const fileProfileResult = await db.query(
    `SELECT p.file_profile_id, p.organization_id, p.intake_file_id, p.parser_name,
            p.parser_version, p.checksum, p.profile_canonical_sha256, p.created_at
       FROM kai.intake_sensitivity_profiles s
       JOIN kai.intake_file_profiles p
         ON p.organization_id = s.organization_id
        AND p.file_profile_id = s.file_profile_id
      WHERE s.organization_id = $1
        AND s.intake_sensitivity_profile_id = $2
      LIMIT 1`,
    [organizationId, intakeSensitivityProfileId],
  );
  const fileProfile = fileProfileResult.rows[0] || null;
  if (!fileProfile) return null;
  return getReviewCockpitFileProfileRecordForResolvedProfile(organizationId, fileProfile, db);
}

async function getReviewCockpitFileProfileRecordForResolvedProfile(organizationId, fileProfile, db) {
  const resolvedFileProfileId = fileProfile.file_profile_id;
  const dataDictionaryResult = await db.query(
    `SELECT d.data_dictionary_id, d.organization_id, d.intake_file_id, d.file_profile_id,
            d.dictionary_status, d.profile_canonical_sha256, d.created_at,
            (SELECT count(*)::int
               FROM kai.data_dictionary_fields f
              WHERE f.organization_id = d.organization_id
                AND f.data_dictionary_id = d.data_dictionary_id) AS field_count
       FROM kai.data_dictionaries d
      WHERE d.organization_id = $1
        AND d.file_profile_id = $2
      LIMIT 1`,
    [organizationId, resolvedFileProfileId],
  );
  const dataDictionary = dataDictionaryResult.rows[0] || null;

  const qualityFindingsResult = dataDictionary
    ? await db.query(
      `SELECT data_quality_finding_id, organization_id, data_dictionary_id, file_profile_id,
              profile_field_key, finding_type, finding_status, finding_detail_safe, created_at
         FROM kai.data_quality_findings
        WHERE organization_id = $1
          AND data_dictionary_id = $2
        ORDER BY created_at DESC, data_quality_finding_id DESC
        LIMIT $3`,
      [organizationId, dataDictionary.data_dictionary_id, REVIEW_COCKPIT_MAX_QUALITY_FINDINGS],
    )
    : { rows: [] };

  const sensitivityProfileResult = await db.query(
    `SELECT intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id,
            data_dictionary_id, profile_canonical_sha256, pii_status, minor_data_status,
            health_housing_justice_immigration_status, indigenous_governance_status,
            staff_notes_status, story_testimonial_status, small_cell_risk_status,
            financial_records_status, consent_basis_status, allowed_use_status,
            llm_processing_allowed, product_learning_allowed, public_use_allowed,
            funder_use_allowed, human_review_required, retention_posture, created_at
       FROM kai.intake_sensitivity_profiles
      WHERE organization_id = $1
        AND file_profile_id = $2
      LIMIT 1`,
    [organizationId, resolvedFileProfileId],
  );

  return {
    fileProfile,
    dataDictionary,
    qualityFindings: qualityFindingsResult.rows,
    sensitivityProfile: sensitivityProfileResult.rows[0] || null,
  };
}

/**
 * Read-only, tenant-scoped source-candidate review record, composed entirely from
 * the already-accepted P1-07/P1-08 `getScoped*` lookups - using their `ForDisplay`,
 * non-locking counterparts. The write-path `getScoped*` lookups take a row lock
 * (via the SQL clause that follows a SELECT to bind it to the current transaction)
 * because they back a same-transaction replay-vs-write decision; this
 * cockpit detail never writes anything, so it must never take a row lock (or
 * require UPDATE table privilege) merely to display one. The source and
 * source_version are read only through the identifiers the committed decision row
 * is already bound to, so this never infers a promotion result that the decision
 * row does not itself record.
 */
export async function getReviewCockpitSourceCandidateRecord(
  organizationId,
  intakeSourceCandidateId,
  db = pool,
) {
  const identity = { organizationId, intakeSourceCandidateId };
  const sourceCandidate = await getScopedSourceCandidateByIdentityForDisplay(identity, db);
  if (!sourceCandidate) return null;

  const reviewQueueItem = await getScopedSourceCandidateReviewQueueItemByIdentityForDisplay(
    { organizationId, targetObjectId: sourceCandidate.intake_source_candidate_id },
    db,
  );
  const promotionDecision = await getScopedSourcePromotionDecisionByIdentityForDisplay(identity, db);
  const source = promotionDecision?.source_id
    ? await getScopedSourceById({ organizationId, sourceId: promotionDecision.source_id }, db)
    : null;
  const sourceVersion = promotionDecision?.source_version_id
    ? await getScopedSourceVersionById(
      { organizationId, sourceVersionId: promotionDecision.source_version_id },
      db,
    )
    : null;

  return { sourceCandidate, reviewQueueItem, promotionDecision, source, sourceVersion };
}
