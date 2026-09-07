-- Test-only synthetic drift fixture. Applied only by the local ephemeral
-- repair runner to model the owner-confirmed production defect:
-- kai.enforce_gate_a_p0_upload_lifecycle() absent and
-- trg_gate_a_p0_upload_lifecycle absent, while surrounding Gate A and Gate C-1
-- schema objects remain present.

BEGIN;

DROP TRIGGER IF EXISTS trg_gate_a_p0_upload_lifecycle ON kai.intake_files;
DROP FUNCTION IF EXISTS kai.enforce_gate_a_p0_upload_lifecycle();

COMMIT;
