import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_p1_06_review_status_column_repair.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_p1_06_review_status_column_repair.rollback.sql", "utf8");
const contractCheckSource = readFileSync("scripts/kai-sprint2-p1-06-review-status-column-contract-check.sql", "utf8");
const originalP1_06Source = readFileSync("migrations/kai_sprint2_p1_06_review_queue.sql", "utf8");

test("forward migration guards on the exact diagnosed enum-typed starting contract, structurally, and classifies the starting state before mutating", () => {
  assert.match(migrationSource, /v_atttypname = 'review_status_enum' AND v_atttypnamespace = 'kai' AND v_atttyptype = 'e' THEN\s+v_state := 'legacy';/);
  assert.match(migrationSource, /v_atttypname = 'text' AND v_atttypnamespace = 'pg_catalog' THEN\s+v_state := 'repaired';/);
  assert.match(migrationSource, /v_defexpr IS DISTINCT FROM '''needs_gk_review''::kai\.review_status_enum'/);
  assert.match(migrationSource, /IF NOT v_attnotnull THEN/);
  assert.match(migrationSource, /v_attidentity <> '' OR v_attgenerated <> ''/);
});

test("forward migration fails closed on any starting state that is neither the legacy enum contract nor the exact repaired text contract", () => {
  assert.match(
    migrationSource,
    /is neither the diagnosed legacy enum contract \(kai\.review_status_enum\) nor the exact repaired text contract[\s\S]*?refusing the P1-06 review_status repair/,
  );
});

test("forward migration supports an exact converged-state no-op: no DDL mutation when already in the repaired contract, validated structurally including the exact three-value vocabulary", () => {
  assert.match(migrationSource, /converged-state check failed:/);
  assert.match(migrationSource, /already in the exact repaired contract, converged no-op/);
  assert.match(
    migrationSource,
    /SELECT \(array_agg\(DISTINCT literal ORDER BY literal\) = ARRAY\['needs_gk_review', 'proposed', 'resolved'\]\)/,
  );
  assert.match(migrationSource, /does not admit exactly \{proposed, needs_gk_review, resolved\}/);
});

test("forward migration restores fail-fast locking immediately after BEGIN", () => {
  assert.match(migrationSource, /^BEGIN;\s*\n[\s\S]*?LOCK TABLE ONLY kai\.review_queue_items\s+IN ACCESS EXCLUSIVE MODE\s+NOWAIT;/);
});

test("forward migration refuses if the shared enum already contains 'resolved'", () => {
  assert.match(migrationSource, /enumlabel = 'resolved'/);
  assert.match(migrationSource, /v_has_resolved_label THEN[\s\S]*?RAISE EXCEPTION 'kai\.review_status_enum already contains ''resolved'';/);
});

test("forward migration refuses on any existing row outside {proposed, needs_gk_review, resolved}", () => {
  assert.match(migrationSource, /review_status::text NOT IN \(%L, %L, %L\)/);
});

test("forward migration detects conflicting CHECK constraints and name collisions structurally (conkey), not by rendered-SQL substring", () => {
  assert.match(migrationSource, /v_attnum = ANY \(c\.conkey\)/);
  assert.doesNotMatch(migrationSource, /LIKE '%' \|\| quote_literal/);
});

test("forward migration guards index validity before mutating and does not touch kai.review_status_enum", () => {
  assert.match(migrationSource, /NOT \(i\.indisvalid AND i\.indisready\)/);
  assert.doesNotMatch(migrationSource, /ALTER TYPE kai\.review_status_enum/);
  assert.doesNotMatch(migrationSource, /ADD VALUE/);
});

test("forward migration mutates only review_status: drops the enum default, converts via review_status::text, restores a text default, adds exactly the P1-06 vocabulary", () => {
  assert.match(migrationSource, /ALTER TABLE ONLY kai\.review_queue_items\s+ALTER COLUMN review_status DROP DEFAULT/);
  assert.match(migrationSource, /ALTER TABLE ONLY kai\.review_queue_items\s+ALTER COLUMN review_status TYPE text\s+USING review_status::text/);
  assert.match(migrationSource, /ALTER TABLE ONLY kai\.review_queue_items\s+ALTER COLUMN review_status SET DEFAULT 'needs_gk_review'::text/);
  assert.match(
    migrationSource,
    /ADD CONSTRAINT review_queue_items_p1_06_review_status_check\s+CHECK \(review_status IN \('proposed', 'needs_gk_review', 'resolved'\)\)/,
  );
});

test("forward migration matches the vocabulary already accepted by the P1-06 CREATE TABLE's own review_status CHECK", () => {
  const originalCheck = originalP1_06Source.match(/review_queue_items_p1_06_review_status_check\s+CHECK \(([^)]*)\)/);
  assert.ok(originalCheck, "expected the original P1-06 review_status CHECK to exist");
  assert.match(migrationSource, new RegExp(`CHECK \\(${originalCheck[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`));
});

test("forward migration re-verifies its own postconditions structurally before COMMIT", () => {
  assert.match(migrationSource, /review_status_repair_postconditions/);
  assert.match(migrationSource, /postcondition failed: review_status is not pg_catalog\.text/);
  assert.match(migrationSource, /postcondition failed: expected exactly 1 CHECK constraint governing review_status/);
});

test("rollback classifies the exact repaired starting contract vs. the exact legacy contract, and refuses if the shared enum already drifted to contain 'resolved'", () => {
  assert.match(rollbackSource, /v_atttypname = 'text' AND v_atttypnamespace = 'pg_catalog' THEN\s+v_state := 'repaired';/);
  assert.match(rollbackSource, /v_atttypname = 'review_status_enum' AND v_atttypnamespace = 'kai' AND v_atttyptype = 'e' THEN\s+v_state := 'legacy';/);
  assert.match(rollbackSource, /v_defexpr IS DISTINCT FROM '''needs_gk_review''::text'/);
  assert.match(rollbackSource, /v_has_resolved_label THEN[\s\S]*?RAISE EXCEPTION 'kai\.review_status_enum already contains ''resolved'';/);
});

test("rollback fails closed on any starting state that is neither the exact repaired contract nor the exact legacy contract", () => {
  assert.match(
    rollbackSource,
    /is neither the exact repaired text contract nor the exact legacy enum contract[\s\S]*?refusing the P1-06 review_status rollback/,
  );
});

test("rollback supports an exact converged-state no-op on the exact legacy/already-restored contract: no DDL mutation, validated structurally", () => {
  assert.match(rollbackSource, /legacy-state check failed:/);
  assert.match(rollbackSource, /already in the exact legacy enum contract, rollback no-op/);
  assert.match(
    rollbackSource,
    /no unexpected CHECK[\s\S]{0,40}constraint structurally governs review_status\.[\s\S]*?SELECT count\(\*\) INTO v_governing_check_count/,
  );
});

test("rollback restores fail-fast locking immediately after BEGIN", () => {
  assert.match(rollbackSource, /^BEGIN;\s*\n[\s\S]*?LOCK TABLE ONLY kai\.review_queue_items\s+IN ACCESS EXCLUSIVE MODE\s+NOWAIT;/);
});

test("rollback refuses (fail-closed) rather than lose a legitimate 'resolved' row, and never rewrites/deletes rows or widens the shared enum", () => {
  assert.match(rollbackSource, /rollback would be lossy, refusing/);
  assert.doesNotMatch(rollbackSource, /DELETE FROM kai\.review_queue_items/);
  assert.doesNotMatch(rollbackSource, /UPDATE kai\.review_queue_items/);
  assert.doesNotMatch(rollbackSource, /ADD VALUE/);
  assert.doesNotMatch(rollbackSource, /ALTER TYPE kai\.review_status_enum/);
});

test("rollback converts back only when lossless, using a label-preserving cast", () => {
  assert.match(
    rollbackSource,
    /ALTER TABLE ONLY kai\.review_queue_items\s+ALTER COLUMN review_status TYPE kai\.review_status_enum\s+USING review_status::kai\.review_status_enum/,
  );
  assert.match(rollbackSource, /DROP CONSTRAINT review_queue_items_p1_06_review_status_check/);
});

test("both migration files are self-contained single transactions (BEGIN...COMMIT), matching this repository's migration-file convention", () => {
  for (const source of [migrationSource, rollbackSource]) {
    assert.match(source, /^BEGIN;/);
    assert.match(source, /\nCOMMIT;\n?$/);
  }
});

test("the historical accepted P1-06 migration is not edited by this corrective repair", () => {
  assert.doesNotMatch(originalP1_06Source, /review_status_repair/);
});

test("the schema-drift verifier detects the enum-backed contract as incompatible and only asserts the review_status column, not other review_status_enum-backed columns", () => {
  assert.match(contractCheckSource, /COLUMN_TYPE_IS_TEXT/);
  assert.match(contractCheckSource, /typname = 'text' AND typnamespace = 'pg_catalog'/);
  assert.doesNotMatch(contractCheckSource, /data_dictionaries|data_dictionary_fields|source_locators|evidence_items|source_versions|sources\b/);
});

test("the schema-drift verifier proves the governing CHECK admits EXACTLY the three-value vocabulary, not merely that it contains those three substrings", () => {
  // The old shape checked three/four independent LIKE predicates, which
  // cannot detect a widened (superset) vocabulary. The strengthened
  // verifier must extract and compare the full admitted literal set.
  assert.doesNotMatch(
    contractCheckSource,
    /constraint_definition LIKE '%''proposed''%'\s*\n\s*AND constraint_definition LIKE '%''needs_gk_review''%'\s*\n\s*AND constraint_definition LIKE '%''resolved''%'/,
  );
  assert.match(contractCheckSource, /regexp_matches\(/);
  assert.match(contractCheckSource, /literal_set = ARRAY\['needs_gk_review', 'proposed', 'resolved'\]/);
  assert.match(contractCheckSource, /EXACTLY \{proposed, needs_gk_review, resolved\}/);
});

test("the P1-06 review-status repair synthetic fixture proves an unrelated shared kai.review_status_enum consumer, separate from review_queue_items.review_status", () => {
  const fixtureSource = readFileSync("scripts/kai-sprint2-p1-06-review-status-repair-legacy-fixture.sql", "utf8");
  assert.match(fixtureSource, /CREATE TABLE kai\.unrelated_review_status_enum_consumer/);
  assert.match(fixtureSource, /legacy_status kai\.review_status_enum NOT NULL/);
});

test("the P1-06 review-status repair synthetic runner exercises the exact converged-state no-op cases and the widened-CHECK verifier proof against the actual local PostgreSQL artifacts", () => {
  const runnerSource = readFileSync("scripts/kai-sprint2-p1-06-review-status-repair-local-postgres.js", "utf8");
  assert.match(runnerSource, /FORWARD NO-OP/);
  assert.match(runnerSource, /ROLLBACK NO-OP/);
  assert.match(runnerSource, /unrelated_review_status_enum_consumer/);
  assert.match(runnerSource, /unexpected_fourth_value/);
  assert.match(runnerSource, /GOVERNING_CHECK_VOCABULARY/);
});
