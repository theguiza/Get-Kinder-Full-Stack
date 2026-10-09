import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { executableSource } from "./support/kaiExecutableSource.js";

// The exact no-SQL / no-kai.* / no-DB-access patterns the Sprint 2 route-source
// assertions apply (kai-sprint2-api-contract, kai-sprint2-p1-09-review-cockpit-
// boundary, kai-sprint2-pass2-route-runtime). Comments are exempt; executable
// code, strings, templates, and regex literals are not.
const KAI_TABLE = /\bkai\.(?!js\b)[a-z_]+\b/i;
const KAI_TABLE_STRICT = /\bkai\.[a-z_]+\b/;
const SQL_NEAR_KAI = /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,200}\bkai\./i;
const SQL_VERB = /(?<!-)\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i;
const SQL_STATEMENT = /\bSELECT\b|\bINSERT INTO\b|\bUPDATE\b|\bDELETE FROM\b/;
const DB_QUERY_CALL = /\b(?:pool|db)\.query\s*\(/;
const DB_IMPORT = /from ["']\.\.\/db\//;
const KAI_DB_HELPER_IMPORT = /kaiDb\.js|kaiIntakeQueries\.js|kaiReadModels\.js|kaiReviewCockpitReadModels\.js/;
const POOL_IMPORT = /import\s+pool\s+from/;

const ALL_SQL_AND_KAI = [KAI_TABLE, KAI_TABLE_STRICT, SQL_NEAR_KAI, SQL_VERB, SQL_STATEMENT];

function assertNoneMatch(code, patterns, label) {
  for (const pattern of patterns) assert.doesNotMatch(code, pattern, `${label}: ${pattern}`);
}

test("comments naming SQL verbs and kai.* tables are not executable code", () => {
  const source = [
    "// kai.export_manifests constraint an insert violated",
    "/* SELECT * FROM kai.intake_files WHERE organization_id = $1 */",
    "/**",
    " * kai.engagements - DELETE FROM kai.engagements; UPDATE kai.engagements SET x = 1",
    " * required audit insert are all enforced inside the service",
    " */",
    "router.get(\"/status\", (req, res) => res.json({ ok: true })); // trailing UPDATE kai.audit_events",
    "const value = 1 /* INSERT INTO kai.review_queue_items */ + 2;",
  ].join("\n");
  const code = executableSource(source);

  assertNoneMatch(code, ALL_SQL_AND_KAI, "comment-only source");
  assert.match(code, /router\.get\("\/status", \(req, res\) => res\.json\(\{ ok: true \}\)\);/);
  assert.match(code, /const value = 1\s+\+ 2;/);
  assert.equal(code.length, source.length);
  assert.equal(code.split("\n").length, source.split("\n").length);
});

test("executable SQL and kai.* access in strings, templates, and calls are still detected", () => {
  const fixtures = {
    "double-quoted string": 'await pool.query("SELECT * FROM kai.intake_files WHERE organization_id = $1", [id]);',
    "single-quoted string": "await db.query('DELETE FROM kai.review_queue_items WHERE id = $1', [id]);",
    "template literal": "await pool.query(`UPDATE kai.intake_files SET file_policy_status = 'blocked'`);",
    "template with substitution": "const sql = `SELECT ${columns} FROM kai.intake_batches WHERE organization_id = $1`;",
    "template text containing //": "const sql = `SELECT 'http://x' AS u // not a comment\n FROM kai.claims`;",
    "template text containing /*": "const sql = `/* not a comment */ INSERT INTO kai.audit_events VALUES ($1)`;",
    "comment inside a substitution": "const sql = `SELECT ${/* inner */ column} FROM kai.sources`;",
    "string that looks like a comment opener": 'const open = "/*"; const sql = "SELECT * FROM kai.claims"; const close = "*/";',
    "string that looks like a line comment": 'const url = "https://example.test//"; const sql = "DELETE FROM kai.claims";',
    "regex literal containing comment markers": 'const re = /\\/\\*|\\/\\//; const sql = "UPDATE kai.claims SET x = 1";',
  };
  for (const [label, source] of Object.entries(fixtures)) {
    const code = executableSource(source);
    assert.match(code, KAI_TABLE, label);
    assert.match(code, KAI_TABLE_STRICT, label);
    assert.match(code, SQL_NEAR_KAI, label);
    assert.match(code, SQL_VERB, label);
  }
  assert.match(executableSource(fixtures["double-quoted string"]), DB_QUERY_CALL);
  assert.match(executableSource(fixtures["single-quoted string"]), DB_QUERY_CALL);
  assert.match(executableSource(fixtures["template literal"]), SQL_STATEMENT);
});

test("forbidden pool, db-module, and KAI DB-helper imports and calls are still detected", () => {
  const source = [
    'import pool from "../db/pg.js";',
    'import { query } from "../db/kaiDb.js";',
    'import { getIntakeFileMetadata } from "../db/kaiReadModels.js";',
    'const cockpit = await import("../db/kaiReviewCockpitReadModels.js");',
    'const { rows } = await pool.query(sql, params);',
  ].join("\n");
  const code = executableSource(source);
  assert.match(code, POOL_IMPORT);
  assert.match(code, DB_IMPORT);
  assert.match(code, KAI_DB_HELPER_IMPORT);
  assert.match(code, DB_QUERY_CALL);
  assert.match(code, /getIntakeFileMetadata/);
});

test("a source that does not parse fails loudly instead of being blanked", () => {
  assert.throws(() => executableSource("const sql = `SELECT * FROM kai.claims"), /could not parse/);
  assert.throws(() => executableSource("router.get('/x', (req, res) => {"), /could not parse/);
});

test("real route files: comment-only matches disappear, executable code is preserved, and injected executable SQL is caught", () => {
  for (const path of [
    "Backend/kai/routes/sprint2IntakeApi.js",
    "Backend/kai/routes/sprint2IntakeAuthPreflightApi.js",
    "Backend/kai/routes/kaiAccessAdministrationApi.js",
  ]) {
    const source = readFileSync(path, "utf8");
    const code = executableSource(source, path);
    assert.equal(code.length, source.length, path);
    assertNoneMatch(code, ALL_SQL_AND_KAI, path);
    assertNoneMatch(code, [DB_QUERY_CALL, DB_IMPORT, KAI_DB_HELPER_IMPORT, POOL_IMPORT], path);
    // Every non-comment token survives: the masked source re-parses and keeps
    // the router's own calls.
    assert.match(code, /\brouter\.(?:get|post|use)\(/, path);
    executableSource(code, path);

    for (const injected of [
      '\nconst leaked = await pool.query("SELECT * FROM kai.intake_files");\n',
      "\nconst leaked = `DELETE FROM kai.review_queue_items`;\n",
      '\nimport { query } from "../db/kaiDb.js";\n',
    ]) {
      const tampered = executableSource(source + injected, path);
      const caught = [...ALL_SQL_AND_KAI, DB_QUERY_CALL, DB_IMPORT, KAI_DB_HELPER_IMPORT]
        .some((pattern) => pattern.test(tampered));
      assert.equal(caught, true, `${path}: ${injected.trim()}`);
    }
  }

  // The comment-only matches the raw-text assertions used to report.
  const intakeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  assert.match(intakeSource, KAI_TABLE);
  assert.match(intakeSource, SQL_VERB);
});
