BEGIN;

-- KAI P2-01M: a record-count measurement's identity includes the worksheet it
-- counts. Before this migration a source version could hold one definition
-- and one measurement in total, UNIQUE (organization_id, source_version_id,
-- measurement_type), so a second worksheet of the same promoted workbook
-- could never be counted. Afterwards each explicitly selected worksheet has
-- its own definition and measurement:
--   * kai.source_measurement_definitions and kai.evidence_measurements each
--     gain a nullable worksheet_key. It is set only for the selected-worksheet
--     method; CSV and one-worksheet XLSX measurements stay whole-version
--     (NULL), so their identity is unchanged.
--   * The two identity constraints become unique indexes over
--     (organization_id, source_version_id, measurement_type,
--     COALESCE(worksheet_key, '')). Every existing row already satisfies them.
--   * Existing selected-worksheet measurements are given the sheet key of
--     their own persisted locator, and their definitions the same key. Only
--     the new column is written; no existing value, identifier, fingerprint,
--     evidence item, locator, or claim is changed.
--   * Triggers keep a measurement's worksheet_key equal to its definition's
--     and to its locator's sheet key.

DO $$
BEGIN
  IF to_regclass('kai.source_measurement_definitions') IS NULL OR to_regclass('kai.evidence_measurements') IS NULL THEN
    RAISE EXCEPTION 'the P2-01M measurement tables are required before the worksheet measurement identity migration';
  END IF;
  IF to_regprocedure('kai.enforce_selected_worksheet_measurement_locator()') IS NULL THEN
    RAISE EXCEPTION 'the selected-worksheet method migration is required before the worksheet measurement identity migration';
  END IF;
END $$;

ALTER TABLE kai.source_measurement_definitions ADD COLUMN IF NOT EXISTS worksheet_key text;
ALTER TABLE kai.evidence_measurements ADD COLUMN IF NOT EXISTS worksheet_key text;

UPDATE kai.evidence_measurements m
   SET worksheet_key = sl.coordinates->>'sheet_key'
  FROM kai.evidence_items e
  JOIN kai.source_locators sl
    ON sl.organization_id = e.organization_id
   AND sl.source_locator_id = e.source_locator_id
 WHERE e.organization_id = m.organization_id
   AND e.evidence_item_id = m.evidence_item_id
   AND m.calculation_method = 'p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1'
   AND m.worksheet_key IS NULL;

UPDATE kai.source_measurement_definitions d
   SET worksheet_key = m.worksheet_key
  FROM kai.evidence_measurements m
 WHERE m.organization_id = d.organization_id
   AND m.source_measurement_definition_id = d.source_measurement_definition_id
   AND m.worksheet_key IS NOT NULL
   AND d.worksheet_key IS NULL;

ALTER TABLE kai.evidence_measurements
  DROP CONSTRAINT IF EXISTS evidence_measurements_p2_01m_worksheet_key_check,
  ADD CONSTRAINT evidence_measurements_p2_01m_worksheet_key_check
    CHECK (
      (calculation_method = 'p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1'
        AND worksheet_key IS NOT NULL AND worksheet_key ~ '^sheet_[1-9][0-9]{0,3}$')
      OR (calculation_method <> 'p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1' AND worksheet_key IS NULL)
    );

ALTER TABLE kai.source_measurement_definitions
  DROP CONSTRAINT IF EXISTS source_measurement_definitions_p2_01m_worksheet_key_check,
  ADD CONSTRAINT source_measurement_definitions_p2_01m_worksheet_key_check
    CHECK (worksheet_key IS NULL OR worksheet_key ~ '^sheet_[1-9][0-9]{0,3}$');

-- The new identities are created before the old ones are dropped.
CREATE UNIQUE INDEX IF NOT EXISTS source_measurement_definitions_p2_01m_worksheet_identity_unique
  ON kai.source_measurement_definitions (organization_id, source_version_id, measurement_type, (COALESCE(worksheet_key, '')));
CREATE UNIQUE INDEX IF NOT EXISTS evidence_measurements_p2_01m_worksheet_identity_unique
  ON kai.evidence_measurements (organization_id, source_version_id, measurement_type, (COALESCE(worksheet_key, '')));

ALTER TABLE kai.source_measurement_definitions DROP CONSTRAINT IF EXISTS source_measurement_definitions_p2_01m_identity_unique;
ALTER TABLE kai.evidence_measurements DROP CONSTRAINT IF EXISTS evidence_measurements_p2_01m_identity_unique;

-- A measurement counts the same worksheet as its definition, and a worksheet
-- measurement's evidence item sits on that worksheet's locator. Service
-- validators derive all three from one selection; this trigger preserves the
-- agreement for direct database writes too.
CREATE OR REPLACE FUNCTION kai.enforce_measurement_worksheet_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  definition_worksheet_key text;
  locator_sheet_key text;
BEGIN
  SELECT d.worksheet_key
    INTO definition_worksheet_key
    FROM kai.source_measurement_definitions d
   WHERE d.organization_id = NEW.organization_id
     AND d.source_measurement_definition_id = NEW.source_measurement_definition_id;
  IF definition_worksheet_key IS DISTINCT FROM NEW.worksheet_key THEN
    RAISE EXCEPTION 'measurement worksheet_key must equal its definition''s worksheet_key';
  END IF;

  IF NEW.worksheet_key IS NOT NULL THEN
    SELECT sl.coordinates->>'sheet_key'
      INTO locator_sheet_key
      FROM kai.evidence_items e
      JOIN kai.source_locators sl
        ON sl.organization_id = e.organization_id
       AND sl.source_locator_id = e.source_locator_id
     WHERE e.organization_id = NEW.organization_id
       AND e.evidence_item_id = NEW.evidence_item_id;
    IF locator_sheet_key IS DISTINCT FROM NEW.worksheet_key THEN
      RAISE EXCEPTION 'measurement worksheet_key must equal its locator''s sheet_key';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_measurements_worksheet_identity_check ON kai.evidence_measurements;
CREATE TRIGGER evidence_measurements_worksheet_identity_check
  BEFORE INSERT OR UPDATE OF worksheet_key, source_measurement_definition_id, evidence_item_id, organization_id
  ON kai.evidence_measurements
  FOR EACH ROW
  EXECUTE FUNCTION kai.enforce_measurement_worksheet_identity();

-- The definition side of the same agreement: a definition's worksheet cannot
-- move away from the measurement recorded under it.
CREATE OR REPLACE FUNCTION kai.enforce_measurement_definition_worksheet_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM kai.evidence_measurements m
     WHERE m.organization_id = NEW.organization_id
       AND m.source_measurement_definition_id = NEW.source_measurement_definition_id
       AND m.worksheet_key IS DISTINCT FROM NEW.worksheet_key
  ) THEN
    RAISE EXCEPTION 'definition worksheet_key must equal its measurement''s worksheet_key';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_measurement_definitions_worksheet_identity_check ON kai.source_measurement_definitions;
CREATE TRIGGER source_measurement_definitions_worksheet_identity_check
  BEFORE UPDATE OF worksheet_key, source_measurement_definition_id, organization_id
  ON kai.source_measurement_definitions
  FOR EACH ROW
  EXECUTE FUNCTION kai.enforce_measurement_definition_worksheet_identity();

-- Every persisted row must agree after the backfill (no row is left to the
-- trigger, which fires only on later writes).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM kai.evidence_measurements m
      JOIN kai.source_measurement_definitions d
        ON d.organization_id = m.organization_id
       AND d.source_measurement_definition_id = m.source_measurement_definition_id
      JOIN kai.evidence_items e
        ON e.organization_id = m.organization_id
       AND e.evidence_item_id = m.evidence_item_id
      JOIN kai.source_locators sl
        ON sl.organization_id = e.organization_id
       AND sl.source_locator_id = e.source_locator_id
     WHERE d.worksheet_key IS DISTINCT FROM m.worksheet_key
        OR (m.worksheet_key IS NOT NULL AND sl.coordinates->>'sheet_key' IS DISTINCT FROM m.worksheet_key)
  ) THEN
    RAISE EXCEPTION 'worksheet measurement identity backfill left a measurement, definition, or locator in disagreement';
  END IF;
END $$;

COMMIT;
