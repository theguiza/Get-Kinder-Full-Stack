BEGIN;

-- Operational rollback draft only. These three indexes are part of the
-- current required Gate A target contract, so this rollback is not automatic
-- production instruction. Execute only under a separately authorized
-- operational decision that intentionally removes this repair package.

DROP INDEX IF EXISTS kai.ix_intake_files_gate_a_object_version;
DROP INDEX IF EXISTS kai.ix_intake_files_gate_a_tenant_upload_state;
DROP INDEX IF EXISTS kai.ux_intake_files_gate_a_org_declared_checksum;

COMMIT;
