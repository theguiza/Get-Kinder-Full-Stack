BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.export_candidates') IS NULL THEN
    RAISE EXCEPTION 'kai.export_candidates is required before P3-19 export-manifest-foundation migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_candidates_p3_16_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.export_candidates_p3_16_id_org_unique is required before P3-19 export-manifest-foundation migration';
  END IF;
  IF to_regclass('kai.human_authority_decisions') IS NULL THEN
    RAISE EXCEPTION 'kai.human_authority_decisions is required before P3-19 export-manifest-foundation migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'human_authority_decisions_p3_17_id_org_candidate_type_unique'
  ) THEN
    RAISE EXCEPTION 'kai.human_authority_decisions_p3_17_id_org_candidate_type_unique is required before P3-19 export-manifest-foundation migration';
  END IF;
END $$;

-- P3-19 scope: this migration adds exactly one new authoritative, additive
-- foundation - an immutable export-manifest identity record binding an
-- existing P3-16 export candidate to the exact effective P3-17
-- export_authority_granted decision that authorized it - once the shared
-- P3-18/VAL-EXP-001 final-eligibility composition has PASSed inside the same
-- write transaction as the insert. It changes no existing table, column,
-- constraint, or lifecycle established by Gate A through P3-18, does not set
-- draft_status anywhere, and adds no renderer, artifact-bytes, storage,
-- signed-URL, download, or reuse-lifecycle capability. No
-- kai.upload_lifecycle_audit change is made by this migration (see the P3-19
-- patch notes for the audit-sink classification: kai.audit_events, an
-- externally-owned table, is the valid sink for this non-file-scoped
-- object - no schema change to it is needed or made here).

CREATE TABLE kai.export_manifests (
  export_manifest_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  export_candidate_id uuid NOT NULL,
  effective_authority_decision_id uuid NOT NULL,
  effective_authority_decision_type text NOT NULL,
  fingerprint_contract_version text NOT NULL,
  canonical_fingerprint text NOT NULL,
  created_by uuid NOT NULL,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT export_manifests_p3_19_id_org_unique
    UNIQUE (export_manifest_id, organization_id),
  -- Replay convergence: the same effective-authority state submitted twice
  -- for the same candidate converges to exactly one manifest row.
  CONSTRAINT export_manifests_p3_19_replay_convergence_unique
    UNIQUE (organization_id, export_candidate_id, canonical_fingerprint),
  CONSTRAINT export_manifests_p3_19_candidate_fk
    FOREIGN KEY (export_candidate_id, organization_id)
    REFERENCES kai.export_candidates (export_candidate_id, organization_id)
    ON DELETE RESTRICT,
  -- The bound decision must belong to this same organization and export
  -- candidate, and must be a decision of type export_authority_granted -
  -- lineage can never cross tenant, candidate, or decision-type.
  CONSTRAINT export_manifests_p3_19_authority_decision_fk
    FOREIGN KEY (effective_authority_decision_id, organization_id, export_candidate_id, effective_authority_decision_type)
    REFERENCES kai.human_authority_decisions (decision_id, organization_id, export_candidate_id, decision_type)
    ON DELETE RESTRICT,
  CONSTRAINT export_manifests_p3_19_decision_type_check
    CHECK (effective_authority_decision_type = 'export_authority_granted'),
  CONSTRAINT export_manifests_p3_19_fingerprint_contract_version_check
    CHECK (fingerprint_contract_version = 'kai-sprint2-p3-19-export-manifest-fingerprint-v1'),
  CONSTRAINT export_manifests_p3_19_canonical_fingerprint_check
    CHECK (canonical_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT export_manifests_p3_19_created_by_type_check
    CHECK (created_by_type = 'human')
);

CREATE OR REPLACE FUNCTION kai.p3_19_reject_authority_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'P3-19 export-manifest foundation is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_p3_19_export_manifests_append_only
  BEFORE UPDATE OR DELETE ON kai.export_manifests
  FOR EACH ROW EXECUTE FUNCTION kai.p3_19_reject_authority_mutation();

COMMIT;
