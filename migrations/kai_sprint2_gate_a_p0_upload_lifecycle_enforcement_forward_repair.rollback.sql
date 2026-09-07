BEGIN;

-- Operational rollback draft only. The function
-- kai.enforce_gate_a_p0_upload_lifecycle() and trigger
-- trg_gate_a_p0_upload_lifecycle on kai.intake_files are part of the current
-- required Gate A target contract, so this rollback is not automatic
-- production instruction. Execute only under a separately authorized
-- operational decision that intentionally removes this repair package.

DROP TRIGGER IF EXISTS trg_gate_a_p0_upload_lifecycle ON kai.intake_files;
DROP FUNCTION IF EXISTS kai.enforce_gate_a_p0_upload_lifecycle();

COMMIT;
