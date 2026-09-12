BEGIN;

-- Fail closed: this ledger is append-only and immutable, so dropping the
-- table while any decision row exists would silently destroy persisted
-- human authority history. Unlike the P3-17/P14-07B1 precedents (which drop
-- unconditionally), this rollback refuses whenever it would be unsafe.
DO $$
BEGIN
  IF to_regclass('kai.board_reporting_candidate_human_authority_decisions') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM kai.board_reporting_candidate_human_authority_decisions) THEN
      RAISE EXCEPTION 'BR-04 board-reporting-candidate-human-authority-decision-ledger rollback refused: persisted decision rows exist';
    END IF;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_br_04_brchad_append_only ON kai.board_reporting_candidate_human_authority_decisions;
DROP INDEX IF EXISTS kai.ux_brchad_br_04_single_successor;
DROP INDEX IF EXISTS kai.ux_brchad_br_04_root_per_lineage;
DROP TABLE IF EXISTS kai.board_reporting_candidate_human_authority_decisions;
DROP FUNCTION IF EXISTS kai.br_04_reject_authority_mutation();

COMMIT;
