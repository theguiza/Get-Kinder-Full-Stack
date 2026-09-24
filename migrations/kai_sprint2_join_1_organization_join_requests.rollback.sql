BEGIN;

DROP TRIGGER IF EXISTS trg_organization_join_requests_guard_update ON kai.organization_join_requests;
DROP FUNCTION IF EXISTS kai.guard_organization_join_requests_update();
DROP INDEX IF EXISTS kai.ix_organization_join_requests_j1_requester_created;
DROP INDEX IF EXISTS kai.ix_organization_join_requests_j1_tenant_status_created;
DROP INDEX IF EXISTS kai.ux_organization_join_requests_j1_one_pending;
DROP TABLE IF EXISTS kai.organization_join_requests;

COMMIT;
