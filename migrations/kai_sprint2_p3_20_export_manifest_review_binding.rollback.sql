BEGIN;

DROP INDEX IF EXISTS kai.ix_export_manifests_p3_20_review_queue_item;

ALTER TABLE kai.export_manifests
  DROP CONSTRAINT IF EXISTS export_manifests_p3_20_review_queue_item_fk;

ALTER TABLE kai.export_manifests
  DROP COLUMN IF EXISTS export_review_queue_item_id;

ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p3_20_id_org_unique;

COMMIT;
