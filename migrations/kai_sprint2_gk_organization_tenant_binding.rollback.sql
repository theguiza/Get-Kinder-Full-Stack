BEGIN;

DROP TRIGGER IF EXISTS trg_gk_organization_bindings_touch_updated_at ON kai.gk_organization_bindings;
DROP FUNCTION IF EXISTS kai.touch_gk_organization_bindings_updated_at();
DROP TABLE IF EXISTS kai.gk_organization_bindings;

COMMIT;
