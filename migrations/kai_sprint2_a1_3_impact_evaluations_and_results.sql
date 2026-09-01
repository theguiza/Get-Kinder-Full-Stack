BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.impact_outcome_contexts') IS NULL THEN
    RAISE EXCEPTION 'kai.impact_outcome_contexts is required before the A1.3 impact-evaluations/results migration';
  END IF;
  IF to_regclass('kai.impact_evaluation_framework_versions') IS NULL THEN
    RAISE EXCEPTION 'kai.impact_evaluation_framework_versions is required before the A1.3 impact-evaluations/results migration';
  END IF;
  IF to_regclass('kai.impact_evaluation_criteria') IS NULL THEN
    RAISE EXCEPTION 'kai.impact_evaluation_criteria is required before the A1.3 impact-evaluations/results migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'impact_outcome_contexts'
       AND c.conname = 'impact_outcome_contexts_a1_1_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.impact_outcome_contexts_a1_1_id_org_unique is required before the A1.3 impact-evaluations/results migration';
  END IF;
END $$;

-- A1.3 owner decision (Evaluation Snapshots + Criterion Results): this
-- migration adds exactly two new, additive relations plus the single
-- smallest A1.2 compatibility constraint required to make one of them
-- possible (see below) - never a provenance link, AI-reasoning record,
-- requirement, gap, recommendation, funder, service, route, or UI. It never
-- redesigns kai.impact_outcome_contexts (A1.1) or
-- kai.impact_evaluation_framework_versions/kai.impact_evaluation_criteria
-- (A1.2).
--
-- A1.2 compatibility constraint: kai.impact_evaluation_criteria was given a
-- PRIMARY KEY of criterion_id alone plus a same-table
-- UNIQUE (framework_version_id, criterion_key). Enforcing "this criterion
-- belongs to this exact framework_version_id" as a database-level composite
-- FOREIGN KEY from kai.impact_evaluation_results requires the referenced
-- side to itself carry a UNIQUE (or PRIMARY KEY) constraint on exactly
-- (criterion_id, framework_version_id). That constraint did not exist after
-- A1.2, so this migration adds the smallest possible redundant unique
-- constraint to permit it - it changes no column, no existing constraint,
-- and no existing behavior of kai.impact_evaluation_criteria.
ALTER TABLE kai.impact_evaluation_criteria
  ADD CONSTRAINT impact_evaluation_criteria_a1_3_id_framework_version_unique
  UNIQUE (criterion_id, framework_version_id);

-- A1.3 foundation table: one row is one immutable historical evaluation
-- snapshot of a single impact_outcome_context (A1.1) under a single, pinned
-- framework_version (A1.2). Multiple evaluations of the same outcome
-- context under the same (or a different) framework version are expected
-- and allowed - there is no uniqueness constraint on
-- (impact_outcome_context_id, framework_version_id) - because re-evaluating
-- the same subject over time, or under a revised methodology version, is
-- the normal, expected case for a historical record, not a duplicate.
-- engagement_id is deliberately not duplicated here: impact_outcome_contexts
-- already owns that scope, and this row's tenant-safe composite FK to it
-- carries that scope forward implicitly.
CREATE TABLE IF NOT EXISTS kai.impact_evaluations (
  impact_evaluation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  impact_outcome_context_id uuid NOT NULL,
  framework_version_id uuid NOT NULL,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Downstream tenant/framework-safe reference target for
  -- kai.impact_evaluation_results: lets a result's composite FK pin both
  -- organization_id and framework_version_id to this exact evaluation row in
  -- one constraint.
  CONSTRAINT impact_evaluations_a1_3_id_org_framework_unique
    UNIQUE (impact_evaluation_id, organization_id, framework_version_id),
  -- Tenant-safe composite FK: an evaluation's outcome context must belong to
  -- the exact same organization_id this evaluation row claims. A tool-
  -- supplied outcome_context_id from a different tenant cannot satisfy this
  -- FK regardless of organization_id's own validity, closing the same class
  -- of cross-organization binding that A1.1's engagement FK closes.
  CONSTRAINT impact_evaluations_a1_3_outcome_context_fk
    FOREIGN KEY (impact_outcome_context_id, organization_id)
    REFERENCES kai.impact_outcome_contexts (impact_outcome_context_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT impact_evaluations_a1_3_framework_version_fk
    FOREIGN KEY (framework_version_id)
    REFERENCES kai.impact_evaluation_framework_versions (framework_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT impact_evaluations_a1_3_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_impact_evaluations_a1_3_tenant_context
  ON kai.impact_evaluations (organization_id, impact_outcome_context_id);

-- A1.3 foundation table: one row is one criterion-level analytical result
-- within one evaluation snapshot. assessment_state is a fixed, closed
-- five-value vocabulary of analytical Impact Evaluation outcomes - never a
-- human queue-review approval state, a claim-review state, a requirement-
-- coverage state, or a gap-assessment status from an unrelated earlier
-- package. 'supported_with_limitation' records that the available evidence
-- supports the intended outcome/change subject to a stated limitation; it
-- does not, and must never be read to, establish that the outcome was
-- caused by the organization's activity, or rule out what would have
-- happened otherwise. This table carries only the closed text vocabulary
-- below - no quantitative rating of any kind.
CREATE TABLE IF NOT EXISTS kai.impact_evaluation_results (
  impact_evaluation_result_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  impact_evaluation_id uuid NOT NULL,
  framework_version_id uuid NOT NULL,
  criterion_id uuid NOT NULL,

  assessment_state text NOT NULL,
  safe_explanation text NOT NULL,
  limitation_notes text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT impact_evaluation_results_a1_3_identity_unique
    UNIQUE (impact_evaluation_id, criterion_id),
  -- Critical database integrity (1 of 2): pins both
  -- result.organization_id = evaluation.organization_id AND
  -- result.framework_version_id = evaluation.framework_version_id in a
  -- single composite FK against the A1.3 evaluation identity above - a
  -- result cannot claim a tenant or a framework version its own evaluation
  -- row does not itself have.
  CONSTRAINT impact_evaluation_results_a1_3_evaluation_fk
    FOREIGN KEY (impact_evaluation_id, organization_id, framework_version_id)
    REFERENCES kai.impact_evaluations (impact_evaluation_id, organization_id, framework_version_id)
    ON DELETE RESTRICT,
  -- Critical database integrity (2 of 2): pins criterion_id to belong to
  -- this exact framework_version_id, using the A1.3 compatibility unique
  -- constraint added to kai.impact_evaluation_criteria above. A criterion
  -- defined under a different framework version cannot satisfy this FK even
  -- if criterion_id alone would otherwise exist.
  CONSTRAINT impact_evaluation_results_a1_3_criterion_fk
    FOREIGN KEY (criterion_id, framework_version_id)
    REFERENCES kai.impact_evaluation_criteria (criterion_id, framework_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT impact_evaluation_results_a1_3_assessment_state_check
    CHECK (assessment_state IN (
      'supported',
      'supported_with_limitation',
      'not_supported',
      'needs_more_information',
      'not_applicable'
    )),
  CONSTRAINT impact_evaluation_results_a1_3_safe_explanation_check
    CHECK (btrim(safe_explanation) <> '' AND char_length(safe_explanation) <= 2000),
  CONSTRAINT impact_evaluation_results_a1_3_limitation_notes_length_check
    CHECK (limitation_notes IS NULL OR char_length(limitation_notes) <= 2000),
  -- supported_with_limitation requires non-empty limitation_notes; every
  -- other assessment_state must carry no limitation_notes at all.
  CONSTRAINT impact_evaluation_results_a1_3_limitation_notes_pairing_check
    CHECK (
      (assessment_state = 'supported_with_limitation' AND limitation_notes IS NOT NULL AND btrim(limitation_notes) <> '')
      OR (assessment_state <> 'supported_with_limitation' AND limitation_notes IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_impact_evaluation_results_a1_3_evaluation
  ON kai.impact_evaluation_results (impact_evaluation_id);

COMMIT;
