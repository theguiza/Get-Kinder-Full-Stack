/**
 * KAI shared tenant-scoped effective allowed-use resolver (VAL-KAI-B1A-02-003).
 *
 * The one place that reads, for a set of sensitivity profiles, the two
 * committed allowed-use facts - the P1-05 `kai.intake_sensitivity_profiles`
 * `allowed_use_status` and the current Phase-5 decision-lineage head in
 * `kai.intake_sensitivity_review_decisions` (the row with no successor, the
 * same "no successor" rule findCurrentSensitivityAllowedUseDecision applies) -
 * and projects them through sensitivityEffectiveAllowedUseProhibition. Every
 * content-processing seam (P1-07, P1-08 promotion, P2-01, P2-02/P2-04/P2-05/
 * P2-06 through readSensitivityProfileForAssessment, P2-03, generation) asks
 * this module instead of reading either fact alone, so the same file is
 * prohibited through every entry point. It writes nothing.
 *
 * Callers MUST pass the transaction they use for their own reads (and, where
 * they hold it, the profile row lock), so the check and the operation it
 * gates observe one view of the database.
 *
 * Fails closed: a profile that is not found, or a lineage with more than one
 * head, is prohibited.
 *
 * The AI-processing forms (VAL-KAI-B1A-02-004) read the same two facts and
 * project them through sensitivityEffectiveAiProcessingProhibition, which
 * applies the allowed-use prohibition first; only the seams that send content
 * to an AI provider use them.
 */

import {
  sensitivityEffectiveAiProcessingProhibition,
  sensitivityEffectiveAllowedUseProhibition,
} from "./sensitivityAllowedUseDecisionContract.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

async function readProfileProhibitions(tx, { organizationId, intakeSensitivityProfileIds }, project, name) {
  if (!isUuid(organizationId)) {
    throw new TypeError(`${name} requires an organizationId UUID.`);
  }
  const ids = [...new Set(intakeSensitivityProfileIds || [])];
  if (!ids.every(isUuid)) {
    throw new TypeError(`${name} requires intakeSensitivityProfileId UUIDs.`);
  }
  const result = new Map();
  if (ids.length === 0) return result;

  const profiles = await tx.query(
    `SELECT intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id, allowed_use_status
       FROM kai.intake_sensitivity_profiles
      WHERE organization_id = $1::uuid
        AND intake_sensitivity_profile_id = ANY($2::uuid[])`,
    [organizationId, ids],
  );
  const heads = await tx.query(
    `SELECT d.intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id,
            d.decision_outcome, d.reviewed_allowed_use_status, d.reviewed_llm_processing_allowed
       FROM kai.intake_sensitivity_review_decisions d
      WHERE d.organization_id = $1::uuid
        AND d.intake_sensitivity_profile_id = ANY($2::uuid[])
        AND NOT EXISTS (
              SELECT 1 FROM kai.intake_sensitivity_review_decisions s
               WHERE s.supersedes_decision_id = d.decision_id
            )`,
    [organizationId, ids],
  );

  const profileById = new Map(profiles.rows.map((row) => [String(row.intake_sensitivity_profile_id).toLowerCase(), row]));
  const headsById = new Map();
  for (const row of heads.rows) {
    const key = String(row.intake_sensitivity_profile_id).toLowerCase();
    headsById.set(key, [...(headsById.get(key) || []), row]);
  }

  for (const id of ids) {
    const key = id.toLowerCase();
    const profile = profileById.get(key);
    if (!profile) {
      result.set(id, "sensitivity_profile_missing");
      continue;
    }
    const profileHeads = headsById.get(key) || [];
    result.set(id, project({
      profileAllowedUseStatus: profile.allowed_use_status,
      currentHead: profileHeads.length === 1 ? profileHeads[0] : null,
      lineageAmbiguous: profileHeads.length > 1,
    }));
  }
  return result;
}

/**
 * Returns a Map of intake_sensitivity_profile_id -> prohibition reason (null
 * when nothing prohibits) for every requested id. Ids are read with one query
 * per table; an id whose profile row is absent maps to
 * 'sensitivity_profile_missing'.
 */
export async function readEffectiveAllowedUseProhibitions(tx, args) {
  return readProfileProhibitions(tx, args, sensitivityEffectiveAllowedUseProhibition, "readEffectiveAllowedUseProhibitions");
}

/** The AI-processing form of readEffectiveAllowedUseProhibitions. */
export async function readEffectiveAiProcessingProhibitions(tx, args) {
  return readProfileProhibitions(tx, args, sensitivityEffectiveAiProcessingProhibition, "readEffectiveAiProcessingProhibitions");
}

/** The single-profile form: the prohibition reason, or null. */
export async function readEffectiveAllowedUseProhibition(tx, { organizationId, intakeSensitivityProfileId }) {
  const prohibitions = await readEffectiveAllowedUseProhibitions(tx, {
    organizationId,
    intakeSensitivityProfileIds: [intakeSensitivityProfileId],
  });
  return prohibitions.has(intakeSensitivityProfileId) ? prohibitions.get(intakeSensitivityProfileId) : "sensitivity_profile_missing";
}

async function readClaimProhibitions(tx, { organizationId, claimIds }, readProfiles, name) {
  if (!isUuid(organizationId)) {
    throw new TypeError(`${name} requires an organizationId UUID.`);
  }
  const ids = [...new Set(claimIds || [])];
  if (!ids.every(isUuid)) {
    throw new TypeError(`${name} requires claimId UUIDs.`);
  }
  const result = new Map();
  if (ids.length === 0) return result;

  const lineage = await tx.query(
    `SELECT c.claim_id::text AS claim_id,
            sv.intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id
       FROM kai.claims c
       JOIN kai.claim_evidence_links l
         ON l.organization_id = c.organization_id
        AND l.claim_id = c.claim_id
        AND l.evidence_item_id = c.evidence_item_id
       JOIN kai.evidence_items e
         ON e.organization_id = c.organization_id
        AND e.evidence_item_id = l.evidence_item_id
       JOIN kai.source_versions sv
         ON sv.organization_id = c.organization_id
        AND sv.source_version_id = e.source_version_id
      WHERE c.organization_id = $1::uuid
        AND c.claim_id = ANY($2::uuid[])`,
    [organizationId, ids],
  );
  const profileByClaim = new Map();
  for (const row of lineage.rows) {
    const key = String(row.claim_id).toLowerCase();
    // More than one lineage row for one claim is not a single lineage.
    profileByClaim.set(key, profileByClaim.has(key) ? null : row.intake_sensitivity_profile_id);
  }
  const profileIds = [...profileByClaim.values()].filter(isUuid);
  const prohibitions = await readProfiles(tx, {
    organizationId,
    intakeSensitivityProfileIds: profileIds,
  });
  for (const id of ids) {
    const profileId = profileByClaim.get(id.toLowerCase());
    if (!isUuid(profileId)) result.set(id, "claim_lineage_missing");
    else result.set(id, prohibitions.has(profileId) ? prohibitions.get(profileId) : "sensitivity_profile_missing");
  }
  return result;
}

/**
 * The claim form, for generation: every claim's own lineage
 * (claim -> claim_evidence_link -> evidence item -> source version ->
 * intake_sensitivity_profile_id), read in one query, then the profile form.
 * Returns a Map of claim_id -> prohibition reason; a claim whose lineage
 * cannot be walked maps to 'claim_lineage_missing'.
 */
export async function readEffectiveAllowedUseProhibitionsForClaims(tx, args) {
  return readClaimProhibitions(tx, args, readEffectiveAllowedUseProhibitions, "readEffectiveAllowedUseProhibitionsForClaims");
}

/**
 * The AI-processing claim form, for every seam that sends claim content to an
 * AI provider (generated-content drafting, impact evaluation).
 */
export async function readEffectiveAiProcessingProhibitionsForClaims(tx, args) {
  return readClaimProhibitions(tx, args, readEffectiveAiProcessingProhibitions, "readEffectiveAiProcessingProhibitionsForClaims");
}
