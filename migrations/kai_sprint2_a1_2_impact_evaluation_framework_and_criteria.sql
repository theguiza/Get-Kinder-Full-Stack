BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.impact_outcome_contexts') IS NULL THEN
    RAISE EXCEPTION 'kai.impact_outcome_contexts is required before the A1.2 impact-evaluation-framework/criteria migration';
  END IF;
END $$;

-- A1.2 owner decision (Versioned Impact Evaluation Framework + Criteria):
-- this migration adds exactly two new, additive relations - the persisted
-- methodology layer that a future evaluator (A2+) will read, never a
-- funder-requirement, provenance, gap, evaluation, or criterion-result
-- object. It never modifies kai.impact_outcome_contexts (A1.1, closed) or
-- any other existing table.
--
-- This methodology is KAI-owned: framework_code/framework_name/version_label
-- identify a KAI-authored, versioned evaluation framework that MAY be
-- informed by outside standards, but this schema makes no claim that KAI's
-- methodology is formally certified against, equivalent to, or a compliant
-- implementation of any named external standard - no external-standard
-- identifier or cross-reference column exists here or anywhere else in this
-- migration.
--
-- Immutability model: a framework_version row, once created, is never
-- mutated in place to change its methodology - a revised methodology is a
-- new (framework_code, version_label) row. framework_status only tracks
-- that version's own lifecycle (draft -> active -> retired), never a
-- rewrite of its criteria. This package does not enforce that immutability
-- with a trigger (no UPDATE-blocking trigger is added here, unlike the
-- append-only P3-16 authority tables) because no writer of any kind is
-- introduced in this schema-only package; enforcing it is left to whatever
-- future package adds the first writer.
CREATE TABLE IF NOT EXISTS kai.impact_evaluation_framework_versions (
  framework_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  framework_code text NOT NULL,
  framework_name text NOT NULL,
  version_label text NOT NULL,
  framework_status text NOT NULL DEFAULT 'draft',

  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT impact_evaluation_framework_versions_a1_2_identity_unique
    UNIQUE (framework_code, version_label),
  CONSTRAINT impact_evaluation_framework_versions_a1_2_framework_code_check
    CHECK (framework_code ~ '^[a-z][a-z0-9_]{0,95}$'),
  CONSTRAINT impact_evaluation_framework_versions_a1_2_framework_name_check
    CHECK (btrim(framework_name) <> '' AND char_length(framework_name) <= 200),
  CONSTRAINT impact_evaluation_framework_versions_a1_2_version_label_check
    CHECK (version_label ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  CONSTRAINT impact_evaluation_framework_versions_a1_2_framework_status_check
    CHECK (framework_status IN ('draft', 'active', 'retired')),
  CONSTRAINT impact_evaluation_framework_versions_a1_2_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

-- At most one 'active' version per framework_code, so "the current
-- methodology for framework X" is always unambiguous. draft and retired
-- versions are unrestricted in count - many drafts may be in flight, and
-- every superseded version is retained as 'retired', never deleted.
CREATE UNIQUE INDEX IF NOT EXISTS ux_impact_evaluation_framework_versions_a1_2_active_per_code
  ON kai.impact_evaluation_framework_versions (framework_code)
  WHERE framework_status = 'active';

-- A1.2 foundation table: the version-scoped criterion set a framework
-- version's methodology is made of. One row is one evaluator-facing
-- criterion definition - criterion_label/description/evaluation_guidance
-- are the persisted data an evaluator (A2+) reads instead of a hard-coded
-- per-criterion prompt branch. This table defines no fixed, global
-- criterion_key vocabulary: criterion_key is scoped and unique only within
-- its own framework_version_id, so a future framework version is free to
-- define a different criterion set entirely. The six Package-A keys (what,
-- who, how_much, contribution, risk, how) are exercised only as ordinary
-- data rows in this package's tests, never as a CHECK constraint value
-- list. 'how' is program/activity/impact-pathway context (how the outcome
-- is understood to come about) - it is not investor/funder contribution,
-- which is out of scope for this schema-only package.
CREATE TABLE IF NOT EXISTS kai.impact_evaluation_criteria (
  criterion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_version_id uuid NOT NULL,

  criterion_key text NOT NULL,
  criterion_label text NOT NULL,
  description text NOT NULL,
  evaluation_guidance text NOT NULL,
  display_order integer NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT impact_evaluation_criteria_a1_2_framework_version_fk
    FOREIGN KEY (framework_version_id)
    REFERENCES kai.impact_evaluation_framework_versions (framework_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT impact_evaluation_criteria_a1_2_key_unique
    UNIQUE (framework_version_id, criterion_key),
  CONSTRAINT impact_evaluation_criteria_a1_2_display_order_unique
    UNIQUE (framework_version_id, display_order),
  CONSTRAINT impact_evaluation_criteria_a1_2_criterion_key_check
    CHECK (criterion_key ~ '^[a-z][a-z0-9_]{0,95}$'),
  CONSTRAINT impact_evaluation_criteria_a1_2_criterion_label_check
    CHECK (btrim(criterion_label) <> '' AND char_length(criterion_label) <= 200),
  CONSTRAINT impact_evaluation_criteria_a1_2_description_check
    CHECK (btrim(description) <> '' AND char_length(description) <= 4000),
  CONSTRAINT impact_evaluation_criteria_a1_2_evaluation_guidance_check
    CHECK (btrim(evaluation_guidance) <> '' AND char_length(evaluation_guidance) <= 4000),
  CONSTRAINT impact_evaluation_criteria_a1_2_display_order_check
    CHECK (display_order >= 0)
);

CREATE INDEX IF NOT EXISTS ix_impact_evaluation_criteria_a1_2_framework_version
  ON kai.impact_evaluation_criteria (framework_version_id);

COMMIT;
