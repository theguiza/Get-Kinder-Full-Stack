BEGIN;

-- KAI measurement targets (owner-authorized 2026-11-18): an organization's
-- planned numerical target for a recorded measurement, kept apart from the
-- measurement (the source-derived actual) and from the Project's reporting
-- context (kai.engagements.project_metadata). Additive: one new table.
--
-- A target is set by a person on a recorded measurement and applies to its
-- metric identity on that Project: the same source, worksheet and
-- measurement key (family, method and definition, including any reporting
-- period), so it carries over to later versions of the same source with the
-- same definition. Its unit follows the family: a count target for counts
-- and linked reach, a percentage for rates and paired outcomes. Targets are
-- append-only; a change supersedes the current target of that identity.
-- A target is a plan: it is never recorded or stated as an achieved result.

DO $$
BEGIN
  IF to_regclass('kai.source_derived_measurements') IS NULL THEN
    RAISE EXCEPTION 'the source-derived measurement migration is required before the measurement target migration';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kai.measurement_targets (
  measurement_target_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  source_id uuid NOT NULL,
  worksheet_key text,
  measurement_key text NOT NULL,
  measurement_family text NOT NULL,
  target_unit text NOT NULL,
  target_value numeric(14, 2) NOT NULL,
  comparison text NOT NULL,
  set_on_measurement_id uuid NOT NULL,
  supersedes_target_id uuid,

  created_by uuid NOT NULL,
  created_by_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT measurement_targets_id_org_unique
    UNIQUE (measurement_target_id, organization_id),
  CONSTRAINT measurement_targets_measurement_fk
    FOREIGN KEY (set_on_measurement_id, organization_id)
    REFERENCES kai.source_derived_measurements (source_derived_measurement_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT measurement_targets_supersedes_fk
    FOREIGN KEY (supersedes_target_id, organization_id)
    REFERENCES kai.measurement_targets (measurement_target_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT measurement_targets_worksheet_key_check
    CHECK (worksheet_key IS NULL OR worksheet_key ~ '^sheet_[1-9][0-9]{0,3}$'),
  CONSTRAINT measurement_targets_key_check
    CHECK (measurement_key ~ '^[a-f0-9]{64}$'),
  CONSTRAINT measurement_targets_unit_value_check
    CHECK (
      (target_unit = 'count' AND measurement_family IN ('tabular_count', 'cross_source_reach')
        AND target_value >= 0 AND target_value = trunc(target_value))
      OR (target_unit = 'percent' AND measurement_family IN ('tabular_rate', 'paired_outcome_change')
        AND target_value BETWEEN 0 AND 100)
    ),
  CONSTRAINT measurement_targets_comparison_check
    CHECK (comparison IN ('at_least', 'at_most')),
  CONSTRAINT measurement_targets_not_self_check
    CHECK (supersedes_target_id IS NULL OR supersedes_target_id <> measurement_target_id),
  CONSTRAINT measurement_targets_created_by_type_check
    CHECK (created_by_type = 'human')
);

-- One chain per metric identity on a Project, superseded one step at a time.
CREATE UNIQUE INDEX IF NOT EXISTS measurement_targets_identity_root_unique
  ON kai.measurement_targets (organization_id, engagement_id, source_id, (COALESCE(worksheet_key, '')), measurement_key)
  WHERE supersedes_target_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS measurement_targets_single_successor_unique
  ON kai.measurement_targets (organization_id, supersedes_target_id)
  WHERE supersedes_target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_measurement_targets_identity
  ON kai.measurement_targets (organization_id, source_id, measurement_key);

DROP TRIGGER IF EXISTS trg_measurement_targets_append_only ON kai.measurement_targets;
CREATE TRIGGER trg_measurement_targets_append_only
  BEFORE UPDATE OR DELETE ON kai.measurement_targets
  FOR EACH ROW EXECUTE FUNCTION kai.source_derived_measurement_append_only();

COMMIT;
