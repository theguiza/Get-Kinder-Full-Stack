import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_join_1_organization_join_requests.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_join_1_organization_join_requests.rollback.sql", "utf8");
const sqlOnly = migrationSource.replace(/--.*$/gm, "");

test("JOIN-1 migration is transactional and guards on kai.organizations and kai.users existing", () => {
  assert.match(migrationSource, /^BEGIN;/);
  assert.match(migrationSource, /COMMIT;\s*$/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.organizations is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.users is required/);
});

test("JOIN-1 creates only kai.organization_join_requests and never alters externally owned tables", () => {
  assert.match(sqlOnly, /CREATE TABLE IF NOT EXISTS kai\.organization_join_requests/);
  assert.doesNotMatch(sqlOnly, /CREATE TABLE IF NOT EXISTS kai\.(?!organization_join_requests\b)/);
  assert.doesNotMatch(sqlOnly, /ALTER TABLE/);
  assert.doesNotMatch(sqlOnly, /kai\.organization_memberships/);
  assert.doesNotMatch(sqlOnly, /DROP TABLE/);
});

test("JOIN-1 declares exactly the approved columns and no requested-role column", () => {
  for (const column of [
    "organization_join_request_id",
    "organization_id",
    "requester_user_id",
    "status",
    "created_at",
    "reviewed_at",
    "reviewed_by_user_id",
    "updated_at",
  ]) {
    assert.match(sqlOnly, new RegExp(`\\b${column}\\b`), `expected column ${column}`);
  }
  assert.doesNotMatch(sqlOnly, /\brole/i);
  assert.doesNotMatch(sqlOnly, /client_admin|client_reviewer/);
  assert.doesNotMatch(sqlOnly, /organization_name|\bname\b/);
});

test("organization and requester are required; review fields are nullable", () => {
  assert.match(sqlOnly, /organization_id uuid NOT NULL,/);
  assert.match(sqlOnly, /requester_user_id uuid NOT NULL,/);
  assert.match(sqlOnly, /status text NOT NULL DEFAULT 'pending',/);
  assert.match(sqlOnly, /created_at timestamptz NOT NULL DEFAULT now\(\),/);
  assert.match(sqlOnly, /reviewed_at timestamptz,/);
  assert.match(sqlOnly, /reviewed_by_user_id uuid,/);
});

test("organization, requester, and reviewer are foreign keys into the authoritative KAI tables", () => {
  assert.match(
    sqlOnly,
    /organization_join_requests_j1_organization_fk\s+FOREIGN KEY \(organization_id\)\s+REFERENCES kai\.organizations \(organization_id\)\s+ON DELETE RESTRICT/,
  );
  assert.match(
    sqlOnly,
    /organization_join_requests_j1_requester_fk\s+FOREIGN KEY \(requester_user_id\)\s+REFERENCES kai\.users \(user_id\)\s+ON DELETE RESTRICT/,
  );
  assert.match(
    sqlOnly,
    /organization_join_requests_j1_reviewer_fk\s+FOREIGN KEY \(reviewed_by_user_id\)\s+REFERENCES kai\.users \(user_id\)\s+ON DELETE RESTRICT/,
  );
});

test("status is pinned to pending/approved/declined and review fields are consistent with status", () => {
  assert.match(
    sqlOnly,
    /organization_join_requests_j1_status_check\s+CHECK \(status IN \('pending', 'approved', 'declined'\)\)/,
  );
  assert.match(
    sqlOnly,
    /status = 'pending' AND reviewed_at IS NULL AND reviewed_by_user_id IS NULL/,
  );
  assert.match(
    sqlOnly,
    /status IN \('approved', 'declined'\) AND reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL/,
  );
  assert.match(sqlOnly, /CHECK \(reviewed_at IS NULL OR reviewed_at >= created_at\)/);
  assert.match(sqlOnly, /CHECK \(reviewed_by_user_id IS NULL OR reviewed_by_user_id <> requester_user_id\)/);
});

test("one pending request per requester + organization is a partial unique index, so declined requests can be followed by a new one", () => {
  assert.match(
    sqlOnly,
    /CREATE UNIQUE INDEX IF NOT EXISTS ux_organization_join_requests_j1_one_pending\s+ON kai\.organization_join_requests \(organization_id, requester_user_id\)\s+WHERE status = 'pending';/,
  );
  assert.doesNotMatch(sqlOnly, /UNIQUE \(organization_id, requester_user_id\)/);
});

test("reviewer-queue and requester-history indexes are present", () => {
  assert.match(
    sqlOnly,
    /ix_organization_join_requests_j1_tenant_status_created\s+ON kai\.organization_join_requests \(organization_id, status, created_at\)/,
  );
  assert.match(
    sqlOnly,
    /ix_organization_join_requests_j1_requester_created\s+ON kai\.organization_join_requests \(requester_user_id, created_at DESC\)/,
  );
});

test("a BEFORE UPDATE trigger keeps identity immutable, decisions terminal, and updated_at current", () => {
  assert.match(sqlOnly, /CREATE OR REPLACE FUNCTION kai\.guard_organization_join_requests_update\(\)/);
  assert.match(sqlOnly, /NEW\.organization_id IS DISTINCT FROM OLD\.organization_id/);
  assert.match(sqlOnly, /NEW\.requester_user_id IS DISTINCT FROM OLD\.requester_user_id/);
  assert.match(sqlOnly, /IF OLD\.status <> 'pending' THEN/);
  assert.match(sqlOnly, /IF NEW\.status NOT IN \('approved', 'declined'\) THEN/);
  assert.match(sqlOnly, /NEW\.updated_at := now\(\);/);
  assert.match(
    sqlOnly,
    /CREATE TRIGGER trg_organization_join_requests_guard_update\s*\nBEFORE UPDATE ON kai\.organization_join_requests/,
  );
});

test("JOIN-1 rollback removes exactly what the migration created, trigger before table, and never touches external tables", () => {
  assert.match(rollbackSource, /^BEGIN;/);
  assert.match(rollbackSource, /COMMIT;\s*$/);
  for (const statement of [
    "DROP TRIGGER IF EXISTS trg_organization_join_requests_guard_update ON kai.organization_join_requests;",
    "DROP FUNCTION IF EXISTS kai.guard_organization_join_requests_update();",
    "DROP INDEX IF EXISTS kai.ix_organization_join_requests_j1_requester_created;",
    "DROP INDEX IF EXISTS kai.ix_organization_join_requests_j1_tenant_status_created;",
    "DROP INDEX IF EXISTS kai.ux_organization_join_requests_j1_one_pending;",
    "DROP TABLE IF EXISTS kai.organization_join_requests;",
  ]) {
    assert.ok(rollbackSource.includes(statement), `expected rollback statement: ${statement}`);
  }
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.(?!organization_join_requests\b)/);
  assert.ok(
    rollbackSource.indexOf("DROP TRIGGER") < rollbackSource.indexOf("DROP TABLE"),
    "trigger must be dropped before the table",
  );
});
