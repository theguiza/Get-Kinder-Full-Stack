DROP TABLE IF EXISTS p3_16_smoke_results;
CREATE TEMP TABLE p3_16_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  draft1 uuid;
  claim1 uuid;
  claim2 uuid;
  evidence1 uuid;
  evidence2 uuid;
  snapshot1 uuid := gen_random_uuid();
  snapshot2 uuid := gen_random_uuid();
  candidate1 uuid := gen_random_uuid();
  fingerprint1 text := repeat('d', 64);
  fingerprint2 text := repeat('e', 64);
  supersede_check uuid;
  duplicate_candidate_count int;
BEGIN
  SELECT d.generated_content_draft_id INTO draft1
    FROM kai.generated_content_drafts d
    JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id
   WHERE r.organization_id = org1 AND r.idempotency_key = 'p3-16-smoke-seed';

  SELECT claim_id INTO claim1 FROM kai.claims WHERE organization_id = org1 AND statement = 'P3-16 smoke-seed claim one.';
  SELECT claim_id INTO claim2 FROM kai.claims WHERE organization_id = org1 AND statement = 'P3-16 smoke-seed claim two.';
  SELECT evidence_item_id INTO evidence1 FROM kai.claim_evidence_links WHERE organization_id = org1 AND claim_id = claim1;
  SELECT evidence_item_id INTO evidence2 FROM kai.claim_evidence_links WHERE organization_id = org1 AND claim_id = claim2;

  -- Fresh limitation snapshot covering exactly the two cited pairs.
  INSERT INTO kai.limitation_snapshots (limitation_snapshot_id, organization_id, generated_content_draft_id, confirmed_by, confirmed_by_role, entries_fingerprint, created_by_type)
  VALUES (snapshot1, org1, draft1, org1, 'gk_reviewer', fingerprint1, 'human');
  INSERT INTO kai.limitation_snapshot_entries (limitation_snapshot_id, organization_id, claim_id, evidence_item_id, limitation_codes)
  VALUES
    (snapshot1, org1, claim1, evidence1, ARRAY[]::text[]),
    (snapshot1, org1, claim2, evidence2, ARRAY['small_sample_size']);

  INSERT INTO p3_16_smoke_results
  SELECT 'fresh_snapshot_is_current',
         CASE WHEN EXISTS (
                SELECT 1 FROM kai.limitation_snapshots
                 WHERE limitation_snapshot_id = snapshot1
                   AND NOT EXISTS (SELECT 1 FROM kai.limitation_snapshots s WHERE s.supersedes_snapshot_id = snapshot1)
              )
              THEN 'PASS' ELSE 'FAIL' END,
         'a freshly confirmed snapshot (no successor yet) is the current snapshot for the draft';

  -- Supersede: insert the new row carrying a backward pointer at the prior
  -- current row. The prior row (snapshot1) is never targeted by an UPDATE.
  INSERT INTO kai.limitation_snapshots (limitation_snapshot_id, organization_id, generated_content_draft_id, confirmed_by, confirmed_by_role, entries_fingerprint, supersedes_snapshot_id, created_by_type)
  VALUES (snapshot2, org1, draft1, org1, 'gk_admin', fingerprint2, snapshot1, 'human');
  INSERT INTO kai.limitation_snapshot_entries (limitation_snapshot_id, organization_id, claim_id, evidence_item_id, limitation_codes)
  VALUES
    (snapshot2, org1, claim1, evidence1, ARRAY['self_reported']),
    (snapshot2, org1, claim2, evidence2, ARRAY['small_sample_size']);

  SELECT supersedes_snapshot_id INTO supersede_check FROM kai.limitation_snapshots WHERE limitation_snapshot_id = snapshot2;
  INSERT INTO p3_16_smoke_results
  SELECT 'supersession_lineage_is_append_only',
         CASE WHEN supersede_check = snapshot1
              THEN 'PASS' ELSE 'FAIL' END,
         'the new (successor) row carries a backward pointer at its predecessor; the prior row is never rewritten';

  INSERT INTO p3_16_smoke_results
  SELECT 'prior_snapshot_and_entries_unchanged_after_supersession',
         CASE WHEN EXISTS (
                SELECT 1 FROM kai.limitation_snapshots ls
                 WHERE ls.limitation_snapshot_id = snapshot1
                   AND ls.confirmed_by = org1
                   AND ls.confirmed_by_role = 'gk_reviewer'
                   AND ls.entries_fingerprint = fingerprint1
                   AND ls.supersedes_snapshot_id IS NULL
              )
              AND (SELECT count(*) FROM kai.limitation_snapshot_entries WHERE limitation_snapshot_id = snapshot1) = 2
              AND (SELECT limitation_codes FROM kai.limitation_snapshot_entries WHERE limitation_snapshot_id = snapshot1 AND claim_id = claim1) = ARRAY[]::text[]
              THEN 'PASS' ELSE 'FAIL' END,
         'the complete prior snapshot header and its entries are identical before and after supersession';

  INSERT INTO p3_16_smoke_results
  SELECT 'exactly_one_current_snapshot_after_supersession',
         CASE WHEN (
                SELECT count(*) FROM kai.limitation_snapshots ls
                 WHERE ls.generated_content_draft_id = draft1
                   AND NOT EXISTS (SELECT 1 FROM kai.limitation_snapshots s WHERE s.supersedes_snapshot_id = ls.limitation_snapshot_id)
              ) = 1
              THEN 'PASS' ELSE 'FAIL' END,
         'after supersession, exactly one current (no-successor) snapshot remains for the draft';

  DECLARE
    update_rejected boolean := false;
  BEGIN
    BEGIN
      UPDATE kai.limitation_snapshots SET confirmed_by_role = 'gk_admin' WHERE limitation_snapshot_id = snapshot1;
    EXCEPTION WHEN OTHERS THEN
      update_rejected := true;
    END;
    INSERT INTO p3_16_smoke_results
    VALUES ('ordinary_update_of_prior_snapshot_rejected', CASE WHEN update_rejected THEN 'PASS' ELSE 'FAIL' END, 'the append-only trigger rejects an ordinary UPDATE of the prior (superseded) snapshot row');
  END;

  -- Export candidate bound to the now-current snapshot.
  INSERT INTO kai.export_candidates (export_candidate_id, organization_id, generated_content_draft_id, content_type, requested_audience, limitation_snapshot_id, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
  VALUES (candidate1, org1, draft1, 'evidence_summary', 'internal', snapshot2, 'kai-sprint2-p3-16-export-candidate-fingerprint-v1', fingerprint1, org1, 'human');

  INSERT INTO p3_16_smoke_results
  SELECT 'export_candidate_binds_current_snapshot',
         CASE WHEN EXISTS (
                SELECT 1 FROM kai.export_candidates
                 WHERE export_candidate_id = candidate1 AND limitation_snapshot_id = snapshot2
              )
              THEN 'PASS' ELSE 'FAIL' END,
         'the export candidate binds the current (non-superseded) limitation snapshot';

  -- Replay convergence: an identical (org, draft, audience, fingerprint) insert is a no-op under ON CONFLICT DO NOTHING.
  INSERT INTO kai.export_candidates (export_candidate_id, organization_id, generated_content_draft_id, content_type, requested_audience, limitation_snapshot_id, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
  VALUES (gen_random_uuid(), org1, draft1, 'evidence_summary', 'internal', snapshot2, 'kai-sprint2-p3-16-export-candidate-fingerprint-v1', fingerprint1, org1, 'human')
  ON CONFLICT (organization_id, generated_content_draft_id, requested_audience, canonical_fingerprint) DO NOTHING;

  SELECT count(*) INTO duplicate_candidate_count
    FROM kai.export_candidates
   WHERE organization_id = org1 AND generated_content_draft_id = draft1 AND requested_audience = 'internal' AND canonical_fingerprint = fingerprint1;

  INSERT INTO p3_16_smoke_results
  SELECT 'replay_convergence_no_duplicate_row',
         CASE WHEN duplicate_candidate_count = 1 THEN 'PASS' ELSE 'FAIL' END,
         'an identical (organization, draft, audience, fingerprint) insert converges to exactly one row';

  -- A different fingerprint for the same (org, draft, audience) is a distinct candidate.
  INSERT INTO kai.export_candidates (export_candidate_id, organization_id, generated_content_draft_id, content_type, requested_audience, limitation_snapshot_id, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
  VALUES (gen_random_uuid(), org1, draft1, 'evidence_summary', 'internal', snapshot2, 'kai-sprint2-p3-16-export-candidate-fingerprint-v1', fingerprint2, org1, 'human');

  INSERT INTO p3_16_smoke_results
  SELECT 'changed_fingerprint_creates_new_candidate',
         CASE WHEN (SELECT count(*) FROM kai.export_candidates WHERE generated_content_draft_id = draft1) = 2
              THEN 'PASS' ELSE 'FAIL' END,
         'a changed canonical fingerprint for the same draft/audience creates a second append-only candidate row, not a rewrite';
END $$;

SELECT * FROM p3_16_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_16_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-16 export-candidate-foundation smoke verifier failed';
  END IF;
END $$;
