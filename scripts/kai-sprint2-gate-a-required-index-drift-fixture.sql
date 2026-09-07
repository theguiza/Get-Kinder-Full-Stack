-- Test-only synthetic drift fixture. Applied only by the local ephemeral
-- required-index repair runner to model the owner-confirmed production defect:
-- three current-required Gate A indexes absent while surrounding Gate A
-- function/trigger and Gate C-1 objects remain present.

BEGIN;

DROP INDEX IF EXISTS kai.ix_intake_files_gate_a_object_version;
DROP INDEX IF EXISTS kai.ix_intake_files_gate_a_tenant_upload_state;
DROP INDEX IF EXISTS kai.ux_intake_files_gate_a_org_declared_checksum;

COMMIT;
