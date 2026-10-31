BEGIN;

-- Refuse reversal once any source version holds more than one record-count
-- definition or measurement: the restored one-per-version identity could not
-- hold them. Otherwise restore the original identity constraints, then drop
-- the worksheet identity indexes, trigger, CHECKs, and columns. No
-- measurement, definition, evidence, locator, or claim row is deleted.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM kai.source_measurement_definitions
     GROUP BY organization_id, source_version_id, measurement_type HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM kai.evidence_measurements
     GROUP BY organization_id, source_version_id, measurement_type HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'worksheet measurement identity rollback refused: a source version has measurements for more than one worksheet';
  END IF;
END $$;

ALTER TABLE kai.source_measurement_definitions
  DROP CONSTRAINT IF EXISTS source_measurement_definitions_p2_01m_identity_unique,
  ADD CONSTRAINT source_measurement_definitions_p2_01m_identity_unique
    UNIQUE (organization_id, source_version_id, measurement_type);
ALTER TABLE kai.evidence_measurements
  DROP CONSTRAINT IF EXISTS evidence_measurements_p2_01m_identity_unique,
  ADD CONSTRAINT evidence_measurements_p2_01m_identity_unique
    UNIQUE (organization_id, source_version_id, measurement_type);

DROP TRIGGER IF EXISTS evidence_measurements_worksheet_identity_check ON kai.evidence_measurements;
DROP FUNCTION IF EXISTS kai.enforce_measurement_worksheet_identity();
DROP TRIGGER IF EXISTS source_measurement_definitions_worksheet_identity_check ON kai.source_measurement_definitions;
DROP FUNCTION IF EXISTS kai.enforce_measurement_definition_worksheet_identity();

DROP INDEX IF EXISTS kai.source_measurement_definitions_p2_01m_worksheet_identity_unique;
DROP INDEX IF EXISTS kai.evidence_measurements_p2_01m_worksheet_identity_unique;

ALTER TABLE kai.evidence_measurements
  DROP CONSTRAINT IF EXISTS evidence_measurements_p2_01m_worksheet_key_check,
  DROP COLUMN IF EXISTS worksheet_key;
ALTER TABLE kai.source_measurement_definitions
  DROP CONSTRAINT IF EXISTS source_measurement_definitions_p2_01m_worksheet_key_check,
  DROP COLUMN IF EXISTS worksheet_key;

COMMIT;
