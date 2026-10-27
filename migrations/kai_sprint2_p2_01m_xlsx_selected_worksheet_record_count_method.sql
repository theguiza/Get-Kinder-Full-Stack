BEGIN;

-- Add the versioned method for an explicitly selected worksheet in a
-- multi-worksheet workbook. Existing CSV and one-worksheet method values and
-- locator shapes remain admitted; no persisted row is rewritten.
DO $$
BEGIN
  IF to_regclass('kai.evidence_measurements') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_measurements is required before the selected-worksheet method migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kai.evidence_measurements'::regclass AND conname = 'evidence_measurements_p2_01m_method_check'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kai.source_locators'::regclass AND conname = 'source_locators_p2_01_coordinates_check'
  ) THEN
    RAISE EXCEPTION 'the P2-01M method and locator coordinate CHECKs are required before selected-worksheet method migration';
  END IF;
END $$;

ALTER TABLE kai.evidence_measurements
  DROP CONSTRAINT evidence_measurements_p2_01m_method_check,
  ADD CONSTRAINT evidence_measurements_p2_01m_method_check
    CHECK (calculation_method IN (
      'p1_csv_profile_data_records_excluding_blank_v1',
      'p1_xlsx_single_worksheet_data_rows_excluding_blank_v1',
      'p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1'
    ));

-- The selected method retains the same stable worksheet-key locator shape
-- already used by the single-worksheet XLSX method.
ALTER TABLE kai.source_locators
  DROP CONSTRAINT source_locators_p2_01_coordinates_check,
  ADD CONSTRAINT source_locators_p2_01_coordinates_check
    CHECK (
      (
        locator_type = 'column'
        AND jsonb_typeof(coordinates) = 'object'
        AND coordinates ? 'column_name'
        AND coordinates - ARRAY['column_name'] = '{}'::jsonb
        AND jsonb_typeof(coordinates->'column_name') = 'string'
      )
      OR (
        locator_type = 'source_data_records'
        AND coordinates = '{"scope": "data_records_after_header"}'::jsonb
      )
      OR (
        locator_type = 'source_data_records'
        AND jsonb_typeof(coordinates) = 'object'
        AND coordinates - ARRAY['scope', 'sheet_key'] = '{}'::jsonb
        AND coordinates->'scope' = '"data_records_after_header"'::jsonb
        AND jsonb_typeof(coordinates->'sheet_key') = 'string'
        AND coordinates->>'sheet_key' ~ '^sheet_[1-9][0-9]{0,3}$'
      )
    );

-- A selected-worksheet measurement must point through its governed evidence
-- item to a worksheet locator that names a stable key in the same committed
-- multi-worksheet profile. Service validators provide the same check before
-- writes; this trigger preserves it for direct database writes too.
CREATE OR REPLACE FUNCTION kai.enforce_selected_worksheet_measurement_locator()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  locator_type text;
  locator_coordinates jsonb;
  committed_profile jsonb;
  selected_key text;
BEGIN
  IF NEW.calculation_method <> 'p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1' THEN
    RETURN NEW;
  END IF;

  SELECT sl.locator_type, sl.coordinates, p.profile
    INTO locator_type, locator_coordinates, committed_profile
    FROM kai.evidence_items e
    JOIN kai.source_locators sl
      ON sl.organization_id = e.organization_id
     AND sl.source_locator_id = e.source_locator_id
    JOIN kai.source_versions sv
      ON sv.organization_id = e.organization_id
     AND sv.source_version_id = NEW.source_version_id
    JOIN kai.intake_source_candidates c
      ON c.organization_id = sv.organization_id
     AND c.intake_source_candidate_id = sv.intake_source_candidate_id
    JOIN kai.intake_file_profiles p
      ON p.organization_id = c.organization_id
     AND p.file_profile_id = c.file_profile_id
     AND p.profile_canonical_sha256 = sv.profile_canonical_sha256
   WHERE e.organization_id = NEW.organization_id
     AND e.evidence_item_id = NEW.evidence_item_id
     AND e.source_version_id = NEW.source_version_id;

  IF locator_type IS DISTINCT FROM 'source_data_records'
     OR locator_coordinates->>'scope' IS DISTINCT FROM 'data_records_after_header'
     OR jsonb_typeof(locator_coordinates->'sheet_key') IS DISTINCT FROM 'string'
     OR locator_coordinates - ARRAY['scope', 'sheet_key'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'selected-worksheet measurement requires its matching worksheet data-record locator';
  END IF;

  selected_key := locator_coordinates->>'sheet_key';
  IF selected_key !~ '^sheet_[1-9][0-9]{0,3}$'
     OR committed_profile->>'format' IS DISTINCT FROM 'xlsx'
     OR jsonb_typeof(committed_profile->'sheets') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'selected-worksheet measurement key must identify one worksheet in its committed multi-worksheet profile';
  END IF;
  IF jsonb_array_length(committed_profile->'sheets') < 2 THEN
    RAISE EXCEPTION 'selected-worksheet measurement requires a multi-worksheet profile';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(committed_profile->'sheets') AS sheet
     WHERE sheet->>'sheet_key' = selected_key
  ) THEN
    RAISE EXCEPTION 'selected-worksheet measurement key is absent from its committed profile';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_measurements_selected_worksheet_locator_check ON kai.evidence_measurements;
CREATE TRIGGER evidence_measurements_selected_worksheet_locator_check
  BEFORE INSERT OR UPDATE OF calculation_method, evidence_item_id, organization_id, source_version_id
  ON kai.evidence_measurements
  FOR EACH ROW
  EXECUTE FUNCTION kai.enforce_selected_worksheet_measurement_locator();

COMMIT;
