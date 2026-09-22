import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_package_g_improvement_practices_foundation.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_package_g_improvement_practices_foundation.rollback.sql", "utf8");

test("Package G migration is wrapped in a transaction and guards on kai.organizations/kai.engagements/kai.gap_log_items already existing", () => {
  assert.match(migrationSource, /^BEGIN;/);
  assert.match(migrationSource, /COMMIT;\s*$/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.organizations is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.engagements is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.gap_log_items is required/);
  assert.match(migrationSource, /gap_log_items_p2_04_id_org_unique/);
});

test("Package G migration never modifies kai.organizations, kai.engagements, or kai.gap_log_items and creates only improvement_practices", () => {
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.organizations/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.engagements/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.gap_log_items/);
  assert.doesNotMatch(migrationSource, /DROP TABLE[\s\S]*?kai\.(?:organizations|engagements|gap_log_items)\b/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.improvement_practices/);
  assert.doesNotMatch(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.(?!improvement_practices\b)/);
});

test("Package G improvement_practices declares the approved column list", () => {
  for (const column of [
    "improvement_practice_id",
    "organization_id",
    "engagement_id",
    "gap_log_item_id",
    "title",
    "rationale",
    "status",
    "cadence",
    "next_due_date",
    "responsible_actor_user_id",
    "created_by",
    "created_by_type",
    "created_at",
    "updated_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected column ${column}`);
  }
});

test("organization_id is NOT NULL; engagement_id and gap_log_item_id are nullable", () => {
  assert.match(migrationSource, /organization_id uuid NOT NULL/);
  assert.match(migrationSource, /engagement_id uuid,\s*$/m);
  assert.match(migrationSource, /gap_log_item_id uuid,\s*$/m);
  assert.doesNotMatch(migrationSource, /engagement_id uuid NOT NULL/);
  assert.doesNotMatch(migrationSource, /gap_log_item_id uuid NOT NULL/);
});

test("Package G binds organization_id, (engagement_id, organization_id), and (gap_log_item_id, organization_id) via tenant-safe composite FKs", () => {
  assert.match(
    migrationSource,
    /improvement_practices_g_organization_fk\s+FOREIGN KEY \(organization_id\)\s+REFERENCES kai\.organizations \(organization_id\)/,
  );
  assert.match(
    migrationSource,
    /improvement_practices_g_engagement_fk\s+FOREIGN KEY \(engagement_id, organization_id\)\s+REFERENCES kai\.engagements \(engagement_id, organization_id\)/,
  );
  assert.match(
    migrationSource,
    /improvement_practices_g_gap_log_item_fk\s+FOREIGN KEY \(gap_log_item_id, organization_id\)\s+REFERENCES kai\.gap_log_items \(gap_log_item_id, organization_id\)/,
  );
});

test("status is pinned to the four approved values and cadence to the approved cadence vocabulary", () => {
  assert.match(
    migrationSource,
    /improvement_practices_g_status_check\s+CHECK \(status IN \('recommended', 'active', 'paused', 'completed'\)\)/,
  );
  assert.match(
    migrationSource,
    /improvement_practices_g_cadence_check\s+CHECK \(cadence IN \('one_time', 'every_session', 'weekly', 'monthly', 'quarterly', 'annually', 'ongoing'\)\)/,
  );
});

test("title/rationale are non-blank bounded text; created_by_type is pinned to human/system", () => {
  assert.match(
    migrationSource,
    /improvement_practices_g_title_check\s+CHECK \(btrim\(title\) <> '' AND char_length\(title\) <= 200\)/,
  );
  assert.match(
    migrationSource,
    /improvement_practices_g_rationale_check\s+CHECK \(btrim\(rationale\) <> '' AND char_length\(rationale\) <= 1000\)/,
  );
  assert.match(migrationSource, /created_by_type text NOT NULL DEFAULT 'human'/);
  assert.match(
    migrationSource,
    /improvement_practices_g_created_by_type_check\s+CHECK \(created_by_type IN \('human', 'system'\)\)/,
  );
});

test("the table is mutable (no append-only reject-mutation trigger) but maintains updated_at via a BEFORE UPDATE trigger", () => {
  assert.doesNotMatch(migrationSource, /reject.*mutation/i);
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION kai\.touch_improvement_practices_updated_at\(\)/);
  assert.match(migrationSource, /NEW\.updated_at := now\(\);/);
  assert.match(
    migrationSource,
    /CREATE TRIGGER trg_improvement_practices_touch_updated_at\s*\nBEFORE UPDATE ON kai\.improvement_practices/,
  );
});

test("Package G rollback removes exactly what the forward migration created, in dependency-safe order, and never touches kai.organizations/kai.engagements/kai.gap_log_items", () => {
  assert.match(rollbackSource, /^BEGIN;/);
  assert.match(rollbackSource, /COMMIT;\s*$/);
  assert.match(rollbackSource, /DROP TRIGGER IF EXISTS trg_improvement_practices_touch_updated_at ON kai\.improvement_practices/);
  assert.match(rollbackSource, /DROP FUNCTION IF EXISTS kai\.touch_improvement_practices_updated_at\(\)/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.improvement_practices/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.(?:organizations|engagements|gap_log_items)\b/);

  const triggerDropIndex = rollbackSource.indexOf("DROP TRIGGER IF EXISTS trg_improvement_practices_touch_updated_at");
  const tableDropIndex = rollbackSource.indexOf("DROP TABLE IF EXISTS kai.improvement_practices");
  assert.ok(triggerDropIndex >= 0 && tableDropIndex >= 0 && triggerDropIndex < tableDropIndex);
});
