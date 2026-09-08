BEGIN;

-- P3-20 smoke seed: reuses the exact org1/draft1/candidate1 identity and its
-- single (P3-05-unique) export_review queue item already established by the
-- P3-19 smoke-seed/smoke-verifier (which, in the runner's own migration
-- order, run BEFORE the P3-20 migration is applied - so
-- kai-sprint2-p3-19-export-manifest-foundation-smoke-verifier.sql's own
-- manifest1 row is the genuine "pre-P3-20" legacy row this migration's own
-- backfill proves against, not a fabricated one). This seed adds a second,
-- independent export_authority_granted decision lineage step (revoke then
-- re-grant) on the SAME candidate1, giving the P3-20 smoke-verifier a second
-- real effective decision to bind a second manifest to - proving one review
-- item legitimately backs multiple historical manifests, per the accepted
-- FUNCTIONAL_DEPENDENCY_PROOF (DIRECT_MANIFEST_REVIEW_BINDING).

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  candidate1 uuid;
  head_grant uuid;
  revoke_decision uuid;
BEGIN
  SELECT export_candidate_id INTO candidate1
    FROM kai.export_candidates
   WHERE organization_id = org1 AND requested_audience = 'internal'
     AND canonical_fingerprint = encode(digest('p3-19-smoke-seed-candidate', 'sha256'), 'hex');

  SELECT d.decision_id INTO head_grant
    FROM kai.human_authority_decisions d
   WHERE d.organization_id = org1 AND d.export_candidate_id = candidate1
     AND d.decision_type = 'export_authority_granted'
     AND NOT EXISTS (SELECT 1 FROM kai.human_authority_decisions s WHERE s.supersedes_decision_id = d.decision_id);

  INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, supersedes_decision_id)
  VALUES (org1, candidate1, 'export_authority_granted', 'revoke', org1, 'gk_admin', head_grant)
  RETURNING decision_id INTO revoke_decision;

  INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, supersedes_decision_id)
  VALUES (org1, candidate1, 'export_authority_granted', 'grant', org1, 'gk_admin', revoke_decision);
END $$;

COMMIT;
