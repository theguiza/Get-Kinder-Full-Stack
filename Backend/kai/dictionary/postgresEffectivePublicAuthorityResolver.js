/**
 * KAI shared tenant-scoped effective public-authority resolver.
 *
 * The single place that walks
 *   claim -> claim_evidence_link -> evidence item -> source version
 *   -> intake_sensitivity_profile_id (kai.source_versions carries this
 *      column directly - NOT NULL, see migrations/kai_sprint2_p1_08_source_promotion.sql)
 *   -> findCurrentSensitivityAllowedUseDecision(...)
 * and projects the Phase-5 decision-ledger head
 * (postgresSensitivityAllowedUseDecisionRepository.js) into a public-authority
 * verdict. Every consumer of public authority (the claim-review governance
 * ceiling in postgresHumanReviewRepository.js, P2-06 audience eligibility in
 * postgresClaimTraceabilityRepository.js) must call this instead of reading
 * the legacy claims.public_use_allowed / evidence_items.public_use_allowed
 * columns, which remain schema-pinned false (CHECK constraints) and are never
 * consulted here. This module writes nothing.
 *
 * Mirrors postgresEffectiveFunderAuthorityResolver.js's structure exactly,
 * substituting the public-use permission check
 * (reviewed_public_use_allowed === true AND
 * sensitivityPublicUseBasisEstablished(decision) === true, the shared
 * VAL-KAI-B1A-02-002 predicate from sensitivityAllowedUseDecisionContract.js)
 * for the funder resolver's funder-use permission check. That predicate's
 * consent/governance logic is never duplicated here.
 *
 * Callers MUST pass the same `tx` (transaction/snapshot) they use for their
 * own reads, so the authority check and the decision it gates observe one
 * consistent view of the database.
 *
 * Fails closed (permitted: false) on: missing claim/evidence/source-version/
 * candidate/profile linkage, a non-current source version, an ambiguous
 * Phase-5 lineage (AmbiguousSensitivityDecisionLineageError - more than one
 * current-head row), a missing Phase-5 decision, a nonterminal
 * decision_outcome (e.g. 'needs_more_information'), an organization mismatch,
 * a terminal decision with reviewed_public_use_allowed !== true, or a
 * terminal decision for which sensitivityPublicUseBasisEstablished(decision)
 * is not true.
 *
 * Funder, generation/release, and export authority are all out of scope of
 * this resolver.
 */

import {
  getScopedClaimById,
  getScopedClaimEvidenceLinkByClaimId,
  getScopedEvidenceItemById,
  getScopedSourceVersionById,
} from "../db/kaiIntakeQueries.js";
import {
  findCurrentSensitivityAllowedUseDecision,
  AmbiguousSensitivityDecisionLineageError,
} from "./postgresSensitivityAllowedUseDecisionRepository.js";
import { sensitivityPublicUseBasisEstablished } from "./sensitivityAllowedUseDecisionContract.js";

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function notPermitted(reason) {
  return Object.freeze({
    permitted: false,
    reason,
    intakeSensitivityProfileId: null,
    decision: null,
  });
}

export async function resolveEffectivePublicAuthority(tx, { organizationId, claimId }) {
  if (!isNonEmptyString(organizationId) || !isNonEmptyString(claimId)) {
    return notPermitted("invalid_input");
  }

  const claimRow = await getScopedClaimById({ organizationId, claimId }, tx);
  if (!claimRow) return notPermitted("claim_not_found");

  const linkRow = await getScopedClaimEvidenceLinkByClaimId({ organizationId, claimId }, tx);
  if (!linkRow || linkRow.evidence_item_id !== claimRow.evidence_item_id) {
    return notPermitted("evidence_link_mismatch");
  }

  const evidenceItemRow = await getScopedEvidenceItemById(
    { organizationId, evidenceItemId: linkRow.evidence_item_id },
    tx,
  );
  if (!evidenceItemRow) return notPermitted("evidence_not_found");

  const sourceVersionRow = await getScopedSourceVersionById(
    { organizationId, sourceVersionId: evidenceItemRow.source_version_id },
    tx,
  );
  if (!sourceVersionRow) return notPermitted("source_version_not_found");
  if (sourceVersionRow.is_current !== true) return notPermitted("source_version_not_current");
  if (!isNonEmptyString(sourceVersionRow.intake_sensitivity_profile_id)) {
    return notPermitted("sensitivity_profile_missing");
  }
  const intakeSensitivityProfileId = sourceVersionRow.intake_sensitivity_profile_id;

  let decision;
  try {
    decision = await findCurrentSensitivityAllowedUseDecision(tx, {
      organizationId,
      intakeSensitivityProfileId,
    });
  } catch (error) {
    if (error instanceof AmbiguousSensitivityDecisionLineageError) {
      return notPermitted("ambiguous_lineage");
    }
    throw error;
  }

  if (!decision) return notPermitted("decision_missing");
  if (decision.organization_id !== organizationId) return notPermitted("tenant_mismatch");
  if (decision.decision_outcome !== "reviewed") return notPermitted("decision_nonterminal");
  if (decision.reviewed_public_use_allowed !== true) {
    return notPermitted("decision_not_authorizing");
  }
  if (!sensitivityPublicUseBasisEstablished(decision)) {
    return notPermitted("public_use_basis_not_established");
  }

  return Object.freeze({
    permitted: true,
    reason: null,
    intakeSensitivityProfileId,
    decision,
  });
}

export const __effectivePublicAuthorityResolverTestables = Object.freeze({
  notPermitted,
});
