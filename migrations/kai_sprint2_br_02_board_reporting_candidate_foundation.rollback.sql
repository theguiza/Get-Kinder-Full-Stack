BEGIN;

DROP TRIGGER IF EXISTS trg_br_02_board_reporting_candidate_members_append_only
  ON kai.board_reporting_candidate_members;
DROP TRIGGER IF EXISTS trg_br_02_board_reporting_candidates_append_only
  ON kai.board_reporting_candidates;

DROP TABLE IF EXISTS kai.board_reporting_candidate_members;
DROP TABLE IF EXISTS kai.board_reporting_candidates;

DROP FUNCTION IF EXISTS kai.br_02_reject_board_reporting_candidate_mutation();

COMMIT;
