/**
 * Builds the read-only SQL of KAI_PGADMIN_PRODUCTION_MIGRATION_05_DELTA_PACKET
 * (migration 05, organization internal factual review authority) from three
 * recorded catalogs; it connects to nothing:
 *
 *   - artifacts/kai-db-reconciliation-2026-09-16/PRODUCTION_KAI_SCHEMA.json:
 *     the owner's pgAdmin capture of the production kai schema (2026-09-16);
 *     no migration 01-04 touches the six tables compared here, apart from
 *     evidence_items' three P2-01M CHECKs, which are compared with 03's result;
 *   - KAI_PGADMIN_PRODUCTION_MIGRATION_PACKET/support/expected_post_migration_catalog_pg16.json:
 *     the accepted 01-04 packet's expected results (read, never rewritten),
 *     the post-04 prerequisites;
 *   - KAI_PGADMIN_PRODUCTION_MIGRATION_05_DELTA_PACKET/support/expected_migration_05_catalog_pg16.json:
 *     migration 05's objects before and after, written by the rehearsal
 *     script's `capture` mode.
 *
 * Every generated file is one SELECT statement (no writes, no temporary
 * objects) so pgAdmin's Query Tool shows its whole result in Data Output.
 * Definitions are compared after the 01-04 packet's normalization: kai./public.
 * qualifiers removed, whitespace collapsed, a trailing NOT VALID removed
 * (validation state is checked separately for migration 05's constraints).
 * Every OVERALL row also checks its own row count, so a missing check row can
 * never report PASS.
 *
 *   node scripts/kai-sprint2-pgadmin-migration-05-packet-build.js
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const packetDir = join(repoRoot, "KAI_PGADMIN_PRODUCTION_MIGRATION_05_DELTA_PACKET");
const productionCapturePath = "artifacts/kai-db-reconciliation-2026-09-16/PRODUCTION_KAI_SCHEMA.json";
const priorExpectedPath = "KAI_PGADMIN_PRODUCTION_MIGRATION_PACKET/support/expected_post_migration_catalog_pg16.json";
const m05CatalogPath = "KAI_PGADMIN_PRODUCTION_MIGRATION_05_DELTA_PACKET/support/expected_migration_05_catalog_pg16.json";
const production = JSON.parse(readFileSync(join(repoRoot, productionCapturePath), "utf8"));
const prior = JSON.parse(readFileSync(join(repoRoot, priorExpectedPath), "utf8")).after;
const m05 = JSON.parse(readFileSync(join(repoRoot, m05CatalogPath), "utf8"));

const normalize = (text) => String(text ?? "").replace(/\b(kai|public)\./g, "").replace(/\s+/g, " ").trim().replace(/ NOT VALID$/, "");
const md5 = (text) => createHash("md5").update(text, "utf8").digest("hex");
const fingerprint = (text) => md5(normalize(text));
const lit = (text) => `'${String(text).replace(/'/g, "''")}'`;
const N = (expr) => `regexp_replace(btrim(regexp_replace(regexp_replace(${expr}, '\\m(kai|public)\\.', '', 'g'), '\\s+', ' ', 'g')), ' NOT VALID$', '')`;
const NMD5 = (expr) => `md5(${N(expr)})`;
const inList = (values) => values.map(lit).join(", ");
const valuesBlock = (rows, columns, alias = "v") => rows.length
  ? `(VALUES\n${rows.map((row) => `    (${row.map((v) => (v === null ? "NULL" : typeof v === "boolean" ? String(v) : lit(v))).join(", ")})`).join(",\n")}\n  ) AS ${alias}(${columns.join(", ")})`
  : `(SELECT ${columns.map((c) => `NULL::text AS ${c}`).join(", ")} WHERE false) AS ${alias}`;

// ------------------------------------------------------- migration 05 objects
const M05_CONSTRAINTS = [
  ["evidence_review_decisions", "evidence_review_decisions_p2_12_role_check"],
  ["claim_review_decisions", "claim_review_decisions_p2_12_role_check"],
  ["claim_review_decisions", "claim_review_decisions_organization_internal_audience_check"],
  ["coverage_review_decisions", "coverage_review_decisions_p2_10_decided_by_role_check"],
].map(([table, name]) => {
  const before = m05.before.constraints.find((c) => c.name === name)?.definition ?? null;
  const captured = production.constraints.find((c) => c.name === name)?.definition ?? null;
  // The pre-05 definition the repository chain renders must be the one the
  // owner captured in production; otherwise this packet was built for a
  // different starting point.
  if (fingerprint(before) !== fingerprint(captured)) throw new Error(`${name}: repository pre-05 definition differs from the production capture`);
  const target = m05.after.constraints.find((c) => c.name === name)?.definition;
  if (!target) throw new Error(`no captured post-05 definition for ${name}`);
  return { table, name, base: before, target };
});
const fn = (name) => {
  const found = m05.after.functions.find((f) => f.name === name);
  if (!found) throw new Error(`no captured function ${name}`);
  return found;
};
const M05_HELPER = fn("organization_factual_review_is_measurement_evidence");
const M05_TRIGGERS = m05.after.triggers.filter((t) => t.name.startsWith("trg_organization_factual_review_")).map((t) => {
  const name = t.definition.match(/EXECUTE FUNCTION kai\.([a-z0-9_]+)\(/)[1];
  return { table: t.table_name, trigger: t.name, triggerMd5: fingerprint(t.definition), definition: normalize(t.definition), fn: fn(name) };
});
const triggerOrder = ["trg_organization_factual_review_evidence_scope", "trg_organization_factual_review_claim_scope", "trg_organization_factual_review_coverage_scope"];
M05_TRIGGERS.sort((a, b) => triggerOrder.indexOf(a.trigger) - triggerOrder.indexOf(b.trigger));
if (M05_TRIGGERS.length !== 3 || m05.after.functions.length !== 4) throw new Error("expected three scope triggers and four functions after migration 05");
const M05_TRIGGER_NAMES = M05_TRIGGERS.map((t) => t.trigger);
const M05_FUNCTION_NAMES = m05.after.functions.map((f) => f.name);

// --------------------------------------------- 01-04 prerequisites (post-04)
const priorDef = (name) => {
  const found = prior.constraints.find((c) => c.name === name);
  if (!found) throw new Error(`no 01-04 expected definition for ${name}`);
  return found.definition;
};
const priorTable = (table) => ({
  columns: prior.columns.filter((c) => c.table_name === table).map((c) => [c.column_name, normalize(c.type), c.not_null, normalize(c.default)]),
  constraints: prior.constraints.filter((c) => c.table_name === table).map((c) => [c.name, fingerprint(c.definition)]),
  indexes: prior.indexes.filter((i) => i.table_name === table).map((i) => [i.name, fingerprint(i.definition)]),
});
const P03_CONSTRAINTS = [
  ["evidence_items", "evidence_items_p2_01_evidence_type_check"],
  ["evidence_items", "evidence_items_p2_01_data_class_check"],
  ["evidence_items", "evidence_items_p2_01m_type_class_pairing_check"],
  ["source_locators", "source_locators_p2_01_locator_type_check"],
  ["source_locators", "source_locators_p2_01_coordinates_check"],
];
const P04_CONSTRAINTS = [
  ["limitation_snapshots", "limitation_snapshots_p3_16_confirmed_by_role_check"],
  ["human_authority_decisions", "human_authority_decisions_p3_17_role_by_type_check"],
];
const P04_OBJECTS = prior.triggers.map((t) => {
  const name = t.definition.match(/EXECUTE FUNCTION kai\.([a-z0-9_]+)\(/)[1];
  const f = prior.functions.find((x) => x.name === name);
  return { table: t.table_name, trigger: t.name, triggerMd5: fingerprint(t.definition), fn: name, prosrcMd5: f.prosrc_md5 };
});

// Returns SQL text describing every difference between a table and the 01-04
// packet's expected result (columns, constraints, indexes), or NULL.
function exactTableDiffSql(table) {
  const o = priorTable(table);
  return `(SELECT string_agg(problem, '; ' ORDER BY problem) FROM (
      SELECT 'column ' || coalesce(e.name, a.name) || CASE WHEN e.name IS NULL THEN ' unexpected' WHEN a.name IS NULL THEN ' missing' ELSE ' differs' END AS problem
        FROM ${valuesBlock(o.columns, ["name", "type", "not_null", "def"], "e")}
        FULL JOIN (SELECT a.attname::text AS name, ${N("format_type(a.atttypid, a.atttypmod)")} AS type, a.attnotnull AS not_null,
                          ${N("coalesce(pg_get_expr(d.adbin, d.adrelid), '')")} AS def
                     FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                    WHERE a.attrelid = to_regclass('kai.${table}') AND a.attnum > 0 AND NOT a.attisdropped) a ON a.name = e.name
       WHERE e.name IS NULL OR a.name IS NULL OR a.type <> e.type OR a.not_null <> e.not_null OR a.def <> e.def
      UNION ALL
      SELECT 'constraint ' || coalesce(e.name, a.name) || CASE WHEN e.name IS NULL THEN ' unexpected' WHEN a.name IS NULL THEN ' missing' ELSE ' differs' END
        FROM ${valuesBlock(o.constraints, ["name", "md5"], "e")}
        FULL JOIN (SELECT conname::text AS name, ${NMD5("pg_get_constraintdef(oid, true)")} AS md5
                     FROM pg_constraint WHERE conrelid = to_regclass('kai.${table}') AND contype <> 'n') a ON a.name = e.name
       WHERE e.name IS NULL OR a.name IS NULL OR a.md5 <> e.md5
      UNION ALL
      SELECT 'index ' || coalesce(e.name, a.name) || CASE WHEN e.name IS NULL THEN ' unexpected' WHEN a.name IS NULL THEN ' missing' ELSE ' differs' END
        FROM ${valuesBlock(o.indexes, ["name", "md5"], "e")}
        FULL JOIN (SELECT indexname::text AS name, ${NMD5("indexdef")} AS md5
                     FROM pg_indexes WHERE schemaname = 'kai' AND tablename = '${table}') a ON a.name = e.name
       WHERE e.name IS NULL OR a.name IS NULL OR a.md5 <> e.md5
    ) problems)`;
}
const exactTableProblem = (table) => `CASE WHEN to_regclass('kai.${table}') IS NULL THEN 'kai.${table} missing'
       ELSE (SELECT 'kai.${table}: ' || d FROM (SELECT ${exactTableDiffSql(table)} AS d) x WHERE d IS NOT NULL) END`;

const constraintMd5Sql = (table, name) => `(SELECT ${NMD5("pg_get_constraintdef(con.oid, true)")}
     FROM pg_constraint con WHERE con.conrelid = to_regclass('kai.${table}') AND con.conname = ${lit(name)})`;
const constraintObservedSql = (table, name) => `coalesce((SELECT ${N("pg_get_constraintdef(con.oid, true)")} || CASE WHEN con.convalidated THEN '' ELSE ' [NOT VALID]' END
     FROM pg_constraint con WHERE con.conrelid = to_regclass('kai.${table}') AND con.conname = ${lit(name)}), '(absent)')`;
const constraintAtSql = (table, name, def) => `coalesce(${constraintMd5Sql(table, name)} = ${lit(fingerprint(def))}, false)`;
const constraintNotAtSql = (table, name, def) => `CASE WHEN NOT ${constraintAtSql(table, name, def)} THEN ${lit(`${name} not at its expected definition`)} END`;
const priorTriggerTargetSql = (o) => `(EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('kai.${o.table}') AND t.tgname = ${lit(o.trigger)}
                     AND ${NMD5("pg_get_triggerdef(t.oid, true)")} = ${lit(o.triggerMd5)} AND t.tgenabled = 'O')
       AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.pronamespace = 'kai'::regnamespace AND p.proname = ${lit(o.fn)} AND p.pronargs = 0
                      AND md5(p.prosrc) = ${lit(o.prosrcMd5)} AND l.lanname = 'plpgsql' AND p.prorettype = 'trigger'::regtype))`;

// -------------------------------------------- migration 05 object states
// Each yields 'base' (pre-05), 'target' (exactly as 05 creates it), or 'other'.
const constraintStateSql = (c) => `(CASE
      WHEN ${constraintMd5Sql(c.table, c.name)} IS NULL THEN ${c.base ? "'other'" : "'base'"}
      WHEN ${constraintMd5Sql(c.table, c.name)} = ${lit(fingerprint(c.target))}
       AND (SELECT con.convalidated FROM pg_constraint con WHERE con.conrelid = to_regclass('kai.${c.table}') AND con.conname = ${lit(c.name)}) THEN 'target'
      ${c.base ? `WHEN ${constraintMd5Sql(c.table, c.name)} = ${lit(fingerprint(c.base))} THEN 'base'` : ""}
      ELSE 'other' END)`;
const functionExactSql = (f) => `EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.pronamespace = 'kai'::regnamespace AND p.proname = ${lit(f.name)}
            AND pg_get_function_identity_arguments(p.oid) = ${lit(f.identity_arguments)} AND p.pronargs = ${f.nargs}
            AND md5(p.prosrc) = ${lit(f.prosrc_md5)} AND l.lanname = ${lit(f.language)} AND p.provolatile = ${lit(f.volatility)}
            AND pg_get_function_result(p.oid) = ${lit(f.result_type)} AND p.prosecdef = ${f.security_definer} AND p.prokind = 'f')
       AND (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'kai'::regnamespace AND p.proname = ${lit(f.name)}) = 1`;
const functionAbsentSql = (name) => `NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'kai'::regnamespace AND p.proname = ${lit(name)})`;
const helperStateSql = `(CASE WHEN ${functionAbsentSql(M05_HELPER.name)} THEN 'base' WHEN ${functionExactSql(M05_HELPER)} THEN 'target' ELSE 'other' END)`;
const triggerExactSql = (o) => `EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('kai.${o.table}') AND t.tgname = ${lit(o.trigger)}
            AND NOT t.tgisinternal AND ${NMD5("pg_get_triggerdef(t.oid, true)")} = ${lit(o.triggerMd5)} AND t.tgenabled = 'O')
       AND (SELECT count(*) FROM pg_trigger t WHERE t.tgname = ${lit(o.trigger)} AND NOT t.tgisinternal) = 1`;
const triggerAbsentSql = (o) => `NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = ${lit(o.trigger)} AND NOT t.tgisinternal)`;
const triggerStateSql = (o) => `(CASE WHEN ${triggerAbsentSql(o)} AND ${functionAbsentSql(o.fn.name)} THEN 'base'
      WHEN ${triggerExactSql(o)} AND ${functionExactSql(o.fn)} THEN 'target' ELSE 'other' END)`;
const triggerObservedSql = (o) => `concat_ws('; ',
      coalesce((SELECT string_agg(c.relname || ': ' || ${N("pg_get_triggerdef(t.oid, true)")} || ' [tgenabled=' || t.tgenabled::text || ']', ' | ')
                  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = ${lit(o.trigger)} AND NOT t.tgisinternal), 'trigger absent'),
      coalesce((SELECT string_agg('kai.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || l.lanname
                                  || ' returns ' || pg_get_function_result(p.oid) || ' body md5 ' || md5(p.prosrc)
                                  || CASE WHEN p.prosecdef THEN ' SECURITY DEFINER' ELSE '' END, ' | ')
                  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                 WHERE p.pronamespace = 'kai'::regnamespace AND p.proname = ${lit(o.fn.name)}), 'function absent'))`;
const helperObservedSql = `coalesce((SELECT string_agg('kai.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || l.lanname
          || ' ' || CASE p.provolatile WHEN 's' THEN 'STABLE' WHEN 'i' THEN 'IMMUTABLE' ELSE 'VOLATILE' END || ' returns ' || pg_get_function_result(p.oid)
          || ' body md5 ' || md5(p.prosrc) || CASE WHEN p.prosecdef THEN ' SECURITY DEFINER' ELSE '' END, ' | ')
     FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.pronamespace = 'kai'::regnamespace AND p.proname = ${lit(M05_HELPER.name)}), 'function absent')`;
const strayObjectsSql = `(SELECT nullif(concat_ws(', ',
      (SELECT string_agg('function kai.' || p.proname, ', ') FROM pg_proc p
        WHERE p.pronamespace = 'kai'::regnamespace AND p.proname LIKE 'organization\\_factual\\_review\\_%' AND p.proname NOT IN (${inList(M05_FUNCTION_NAMES)})),
      (SELECT string_agg('trigger ' || t.tgname, ', ') FROM pg_trigger t
        WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg\\_organization\\_factual\\_review\\_%' AND t.tgname NOT IN (${inList(M05_TRIGGER_NAMES)}))), ''))`;

// -------------------------------------------------- baseline tables
// The three decision tables migration 05 alters, the claims and evidence the
// scope triggers read, and gap_log_items (the coverage foreign-key target),
// compared with the 2026-09-16 capture. Migration 05's own objects and
// evidence_items' three P2-01M CHECKs (B01.3) are excluded.
const BASELINE_TABLES = ["evidence_review_decisions", "claim_review_decisions", "coverage_review_decisions", "claims", "evidence_items", "gap_log_items"];
const EXCLUDED_CONSTRAINTS = [...M05_CONSTRAINTS.map((c) => c.name), "evidence_items_p2_01_evidence_type_check", "evidence_items_p2_01_data_class_check", "evidence_items_p2_01m_type_class_pairing_check"];
for (const table of BASELINE_TABLES) if (!production.tables.some((t) => t.name === table)) throw new Error(`${table} not in the production capture`);
const baselineConstraints = production.constraints
  .filter((c) => BASELINE_TABLES.includes(c.table_name) && !EXCLUDED_CONSTRAINTS.includes(c.name))
  .map((c) => [c.table_name, c.name, fingerprint(c.definition)]);
const baselineColumns = production.columns.filter((c) => BASELINE_TABLES.includes(c.table_name)).map((c) => [c.table_name, c.column_name, normalize(c.type), c.not_null]);
const baselineTriggers = production.triggers.filter((t) => BASELINE_TABLES.includes(t.table_name)).map((t) => [t.table_name, t.name, fingerprint(t.definition), t.enabled]);
const baselineUniqueIndexes = production.indexes.filter((i) => BASELINE_TABLES.includes(i.table_name) && /^CREATE UNIQUE INDEX/.test(i.definition))
  .map((i) => [i.table_name, i.name, fingerprint(i.definition)]);
const helperNames = new Set();
for (const t of production.triggers.filter((t) => BASELINE_TABLES.includes(t.table_name))) {
  const match = t.definition.match(/EXECUTE FUNCTION kai\.([a-z0-9_]+)\(/);
  if (match) helperNames.add(match[1]);
}
for (const c of production.constraints.filter((c) => BASELINE_TABLES.includes(c.table_name))) {
  // REFERENCES kai.<table>(...) also matches; only functions are helpers.
  for (const match of c.definition.matchAll(/kai\.([a-z0-9_]+)\(/g)) if (!production.tables.some((t) => t.name === match[1])) helperNames.add(match[1]);
}
const baselineFunctions = production.functions.filter((f) => helperNames.has(f.name)).map((f) => [f.name, f.arguments, fingerprint(f.normalized_definition)]);
if (baselineFunctions.length !== helperNames.size) throw new Error("a helper function of the baseline tables is not in the production capture");

function baselineCtes() {
  const tables = inList(BASELINE_TABLES);
  return `baseline_constraints(tbl, name, md5) AS (SELECT * FROM ${valuesBlock(baselineConstraints, ["tbl", "name", "md5"])}),
baseline_columns(tbl, col, type, nn) AS (SELECT tbl, col, type, nn::boolean FROM ${valuesBlock(baselineColumns, ["tbl", "col", "type", "nn"])}),
baseline_triggers(tbl, name, md5, enabled) AS (SELECT * FROM ${valuesBlock(baselineTriggers, ["tbl", "name", "md5", "enabled"])}),
baseline_unique_indexes(tbl, name, md5) AS (SELECT * FROM ${valuesBlock(baselineUniqueIndexes, ["tbl", "name", "md5"])}),
actual_constraints AS (
  SELECT c.relname::text AS tbl, con.conname::text AS name, ${NMD5("pg_get_constraintdef(con.oid, true)")} AS md5, ${N("pg_get_constraintdef(con.oid, true)")} AS def
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
   WHERE c.relnamespace = 'kai'::regnamespace AND c.relname IN (${tables}) AND con.contype <> 'n'
     AND con.conname NOT IN (${inList(EXCLUDED_CONSTRAINTS)})),
actual_columns AS (
  SELECT c.relname::text AS tbl, a.attname::text AS col, ${N("format_type(a.atttypid, a.atttypmod)")} AS type, a.attnotnull AS nn, a.atthasdef AS has_default
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relnamespace = 'kai'::regnamespace AND c.relname IN (${tables}) AND a.attnum > 0 AND NOT a.attisdropped),
actual_triggers AS (
  SELECT c.relname::text AS tbl, t.tgname::text AS name, ${NMD5("pg_get_triggerdef(t.oid, true)")} AS md5, ${N("pg_get_triggerdef(t.oid, true)")} AS def, t.tgenabled::text AS enabled
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relnamespace = 'kai'::regnamespace AND c.relname IN (${tables}) AND NOT t.tgisinternal
     AND t.tgname NOT IN (${inList(M05_TRIGGER_NAMES)})),
actual_unique_indexes AS (
  SELECT tablename::text AS tbl, indexname::text AS name, ${NMD5("indexdef")} AS md5, ${N("indexdef")} AS def
    FROM pg_indexes WHERE schemaname = 'kai' AND tablename IN (${tables}) AND indexdef LIKE 'CREATE UNIQUE INDEX%')`;
}

// ------------------------------------------------------ constraint matrices
// Evaluates the live CHECK expressions (pg_get_expr) against literal rows
// through query_to_xml: nothing is inserted anywhere. A CHECK admits a row when
// its expression is not false. Returns 'NONE' when every case behaves as
// expected, the mismatching labels otherwise, and a non-'NONE' marker when a
// constraint is missing, so a missing constraint can never pass.
function matrixSql(table, names, columns, cases) {
  const exprOf = (name) => `(SELECT pg_get_expr(conbin, conrelid) FROM pg_constraint WHERE conrelid = to_regclass('kai.${table}') AND conname = ${lit(name)} AND contype = 'c')`;
  const valueSql = (value, type) => (value === null ? `NULL::${type}` : `${lit(value)}::${type}`);
  const rows = cases.map((c) => `(${lit(c.label)}, ${c.expect}, ${c.values.map((v, i) => valueSql(v, columns[i][1])).join(", ")})`).join(", ");
  const head = `SELECT coalesce(string_agg(label, '; ' ORDER BY label), 'NONE') AS bad FROM (VALUES ${rows}) AS v(label, expect, ${columns.map((c) => c[0]).join(", ")}) WHERE (`;
  const allExprs = names.map((name) => `'(' || ${exprOf(name)} || ') IS NOT FALSE'`).join(" || ' AND ' || ");
  return `(SELECT CASE WHEN (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('kai.${table}') AND contype = 'c' AND conname IN (${inList(names)})) <> ${names.length}
      THEN '(constraint missing)'
      ELSE coalesce((xpath('/row/bad/text()', query_to_xml(${lit(head)} || ${allExprs} || ${lit(") IS DISTINCT FROM expect")}, true, true, '')))[1]::text, '(probe failed)') END)`;
}
function matrixRow(seq, section, id, title, table, names, columns, cases, acceptedSummary = null) {
  const accepted = acceptedSummary ?? cases.filter((c) => c.expect).map((c) => c.label).join(", ");
  return `SELECT ${seq}, ${lit(section)}, ${lit(id)},
         CASE WHEN m.bad = 'NONE' THEN 'PASS' ELSE 'FAIL' END,
         ${lit(`${cases.length} combinations; accepted exactly: ${accepted}`)},
         CASE WHEN m.bad = 'NONE' THEN ${lit(`${cases.length}/${cases.length} combinations behave as expected`)} ELSE 'mismatched: ' || coalesce(m.bad, '(null)') END,
         ${lit(title)}
    FROM (SELECT ${matrixSql(table, names, columns, cases)} AS bad) m`;
}

const literalSet = (definition) => [...new Set([...definition.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]))];
const DIMENSIONS = literalSet(production.constraints.find((c) => c.name === "coverage_review_decisions_p2_10_dimension_key_check").definition);
const COVERAGE_DECISIONS = literalSet(production.constraints.find((c) => c.name === "coverage_review_decisions_p2_10_decision_check").definition);
const ORGANIZATION_DIMENSIONS = ["small_cell_risk", "conflicting_source_indicators", "requirement_alignment"];
if (DIMENSIONS.length !== 10 || COVERAGE_DECISIONS.length !== 3) throw new Error("unexpected coverage vocabulary in the capture");
const REVIEW_ROLES = ["gk_reviewer", "gk_admin", "client_admin", "gk_operator", "client_reviewer", "client_contributor"];
const CLAIM_OUTCOMES = ["approved", "approved_with_limitation", "rejected", "needs_more_information"];
const AUDIENCES = [null, "{internal}", "{funder}", "{public}", "{internal,funder}", "{internal,public}", "{funder,public}", "{internal,funder,public}"];

const matrix = {
  evidence: () => ({
    table: "evidence_review_decisions", names: ["evidence_review_decisions_p2_12_role_check"], columns: [["decided_by_role", "text"]],
    cases: REVIEW_ROLES.map((r) => ({ label: r, expect: ["gk_reviewer", "gk_admin", "client_admin"].includes(r), values: [r] })),
  }),
  claim: () => ({
    table: "claim_review_decisions",
    names: ["claim_review_decisions_p2_12_role_check", "claim_review_decisions_p2_12_audience_scope_check", "claim_review_decisions_organization_internal_audience_check"],
    columns: [["decided_by_role", "text"], ["decision_outcome", "text"], ["approved_audiences", "text[]"]],
    cases: REVIEW_ROLES.flatMap((r) => CLAIM_OUTCOMES.flatMap((o) => AUDIENCES.map((a) => {
      const approved = o === "approved" || o === "approved_with_limitation";
      const scopeOk = approved ? a !== null : a === null;
      const roleOk = ["gk_reviewer", "gk_admin", "client_admin"].includes(r);
      const orgOk = r !== "client_admin" || a === null || a === "{internal}";
      return { label: `${r}/${o}/${a ?? "NULL"}`, expect: roleOk && scopeOk && orgOk, values: [r, o, a] };
    }))),
  }),
  coverage: () => ({
    table: "coverage_review_decisions",
    names: ["coverage_review_decisions_p2_10_decided_by_role_check", "coverage_review_decisions_p2_10_decision_check", "coverage_review_decisions_p2_10_dimension_key_check"],
    columns: [["decided_by_role", "text"], ["decision", "text"], ["dimension_key", "text"]],
    cases: REVIEW_ROLES.flatMap((r) => COVERAGE_DECISIONS.flatMap((d) => DIMENSIONS.map((k) => ({
      label: `${r}/${d}/${k}`,
      expect: r === "gk_reviewer" || (r === "client_admin" && d === "accepted_internal_with_limitation" && ORGANIZATION_DIMENSIONS.includes(k)),
      values: [r, d, k],
    })))),
  }),
};

// --------------------------------------------------------------- sections
function sectionA() {
  return [
    `SELECT 101, 'A_ENVIRONMENT', 'A01', CASE WHEN to_regnamespace('kai') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
            'schema kai exists', coalesce(to_regnamespace('kai')::text, '(absent)'), 'Connected to the production database that holds the KAI schema'`,
    `SELECT 102, 'A_ENVIRONMENT', 'A02', CASE WHEN current_setting('server_version_num')::int >= 130000 THEN 'PASS' ELSE 'FAIL' END,
            'PostgreSQL 13 or later', version(), 'Server version (also shown so the result can be compared with the 01-04 run)'`,
    `SELECT 103, 'A_ENVIRONMENT', 'A03', CASE WHEN x.missing IS NULL THEN 'PASS' ELSE 'FAIL' END,
            'current_user may ALTER (owns, or is a member of the owner role of) the three decision tables 05 alters',
            'current_user=' || current_user || coalesce('; cannot alter: ' || x.missing, ''),
            'ALTER TABLE and CREATE TRIGGER require table ownership; without it the migration fails and rolls back'
       FROM (SELECT string_agg(t, ', ') AS missing FROM unnest(ARRAY[${inList(["evidence_review_decisions", "claim_review_decisions", "coverage_review_decisions"])}]) t
              WHERE to_regclass('kai.' || t) IS NULL
                 OR NOT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = to_regclass('kai.' || t)), 'MEMBER')) x`,
    `SELECT 104, 'A_ENVIRONMENT', 'A04', CASE WHEN has_schema_privilege('kai', 'CREATE') THEN 'PASS' ELSE 'FAIL' END,
            'CREATE on schema kai', 'create_on_kai=' || has_schema_privilege('kai', 'CREATE')::text, 'Needed for the four new functions'`,
  ];
}

function sectionB({ final }) {
  const rows = [];
  rows.push(`SELECT 201, 'B_PREREQUISITES', 'B01.1', CASE WHEN p.problem IS NULL THEN 'PASS' ELSE 'FAIL' END,
            '01 (P1 downstream recovery state) applied: kai.intake_p1_downstream_attempts exactly as 01 creates it',
            coalesce(p.problem, 'applied, identical'), 'Accepted 01-04 packet state; this packet does not rerun 01'
       FROM (SELECT ${exactTableProblem("intake_p1_downstream_attempts")} AS problem) p`);
  rows.push(`SELECT 202, 'B_PREREQUISITES', 'B01.2', CASE WHEN ${constraintAtSql("intake_sensitivity_review_decisions", "intake_sensitivity_review_decisions_b1a_02_role_check", priorDef("intake_sensitivity_review_decisions_b1a_02_role_check"))} THEN 'PASS' ELSE 'FAIL' END,
            ${lit(`02 (client_admin sensitivity review) applied: ${normalize(priorDef("intake_sensitivity_review_decisions_b1a_02_role_check"))}`)},
            ${constraintObservedSql("intake_sensitivity_review_decisions", "intake_sensitivity_review_decisions_b1a_02_role_check")},
            'Accepted 01-04 packet state; this packet does not rerun 02'`);
  rows.push(`SELECT 203, 'B_PREREQUISITES', 'B01.3', CASE WHEN p.problem IS NULL THEN 'PASS' ELSE 'FAIL' END,
            '03 (P2-01M measurement) applied: five evidence/locator CHECKs at 03''s definitions; source_measurement_definitions and evidence_measurements exactly as 03 creates them',
            coalesce(p.problem, 'applied, identical'),
            'Migration 05''s scope triggers read kai.evidence_measurements and the measurement evidence type 03 admits'
       FROM (SELECT nullif(concat_ws('; ', ${P03_CONSTRAINTS.map(([t, n]) => constraintNotAtSql(t, n, priorDef(n))).join(", ")},
                    ${exactTableProblem("source_measurement_definitions")}, ${exactTableProblem("evidence_measurements")}), '') AS problem) p`);
  rows.push(`SELECT 204, 'B_PREREQUISITES', 'B01.4', CASE WHEN p.problem IS NULL THEN 'PASS' ELSE 'FAIL' END,
            '04 (organization internal release authority) applied: both role CHECKs at 04''s definitions; both scope triggers enabled with 04''s exact function bodies',
            coalesce(p.problem, 'applied, identical'),
            'The GK and organization release authority 04 established, unchanged; 05 is built on the post-04 state'
       FROM (SELECT nullif(concat_ws('; ', ${P04_CONSTRAINTS.map(([t, n]) => constraintNotAtSql(t, n, priorDef(n))).join(", ")},
                    ${P04_OBJECTS.map((o) => `CASE WHEN NOT ${priorTriggerTargetSql(o)} THEN ${lit(`${o.trigger}/${o.fn} not as 04 creates it`)} END`).join(", ")}), '') AS problem) p`);
  rows.push(`SELECT 205, 'B_PREREQUISITES', 'B02', CASE WHEN x.missing IS NULL THEN 'PASS' ELSE 'FAIL' END,
            'every column, key and relationship migration 05''s constraints and triggers read exists',
            coalesce('missing: ' || x.missing, 'all present'),
            'The scope triggers read claims.evidence_item_id, evidence_items.evidence_type and evidence_measurements(evidence_item_id, organization_id); the CHECKs read decided_by_role, approved_audiences, decision, dimension_key'
       FROM (SELECT string_agg(item, ', ' ORDER BY item) AS missing FROM (
         SELECT 'kai.' || t || '.' || c AS item FROM (VALUES
                ('evidence_review_decisions', 'decision_id'), ('evidence_review_decisions', 'organization_id'), ('evidence_review_decisions', 'evidence_item_id'),
                ('evidence_review_decisions', 'decided_by_role'), ('evidence_review_decisions', 'supersedes_decision_id'),
                ('claim_review_decisions', 'decision_id'), ('claim_review_decisions', 'organization_id'), ('claim_review_decisions', 'claim_id'),
                ('claim_review_decisions', 'decided_by_role'), ('claim_review_decisions', 'approved_audiences'), ('claim_review_decisions', 'supersedes_decision_id'),
                ('coverage_review_decisions', 'organization_id'), ('coverage_review_decisions', 'claim_id'), ('coverage_review_decisions', 'decided_by_role'),
                ('coverage_review_decisions', 'decision'), ('coverage_review_decisions', 'dimension_key'),
                ('claims', 'claim_id'), ('claims', 'organization_id'), ('claims', 'evidence_item_id'),
                ('evidence_items', 'evidence_item_id'), ('evidence_items', 'organization_id'), ('evidence_items', 'evidence_type'),
                ('evidence_measurements', 'evidence_item_id'), ('evidence_measurements', 'organization_id')) AS req(t, c)
          WHERE NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('kai.' || t) AND attname = c AND attnum > 0 AND NOT attisdropped)
         UNION ALL SELECT 'evidence_items_p2_01_id_org_unique' WHERE NOT EXISTS (
           SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('kai.evidence_items') AND conname = 'evidence_items_p2_01_id_org_unique' AND contype = 'u')
         UNION ALL SELECT 'claims_p2_03_id_org_unique' WHERE NOT EXISTS (
           SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('kai.claims') AND conname = 'claims_p2_03_id_org_unique' AND contype = 'u')
         UNION ALL SELECT 'evidence_measurements foreign key to evidence_items' WHERE NOT EXISTS (
           SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('kai.evidence_measurements') AND contype = 'f' AND confrelid = to_regclass('kai.evidence_items'))
         UNION ALL SELECT 'evidence_items admits source_record_count_measurement' WHERE NOT coalesce((
           SELECT pg_get_constraintdef(oid) LIKE '%''source_record_count_measurement''%' FROM pg_constraint
            WHERE conrelid = to_regclass('kai.evidence_items') AND conname = 'evidence_items_p2_01_evidence_type_check'), false)
       ) m) x`);
  rows.push(`SELECT 206, 'B_PREREQUISITES', 'B03', CASE WHEN x.bad IS NULL THEN 'PASS' ELSE 'FAIL' END,
            ${lit(`${baselineFunctions.length} append-only and CHECK helper functions of these tables identical to the 2026-09-16 capture: ${baselineFunctions.map((f) => f[0]).join(", ")}`)},
            coalesce(x.bad, 'all identical'), 'The append-only decision ledgers migration 05 must not weaken'
       FROM (SELECT string_agg(e.name || CASE WHEN a.md5 IS NULL THEN ' missing' ELSE ' changed' END, ', ' ORDER BY e.name) AS bad
               FROM ${valuesBlock(baselineFunctions, ["name", "args", "md5"], "e")}
               LEFT JOIN (SELECT p.proname::text AS name, pg_get_function_identity_arguments(p.oid) AS args, ${NMD5("pg_get_functiondef(p.oid)")} AS md5
                            FROM pg_proc p WHERE p.pronamespace = 'kai'::regnamespace AND p.prokind = 'f') a ON a.name = e.name AND a.args = e.args
              WHERE a.md5 IS DISTINCT FROM e.md5) x`);
  BASELINE_TABLES.forEach((table, i) => {
    rows.push(`SELECT ${300 + i}, 'B_BASELINE', ${lit(`B_TABLE kai.${table}`)},
            CASE WHEN p.problems IS NULL THEN 'PASS' ELSE 'FAIL' END,
            ${lit(`columns, constraints, unique indexes and triggers identical to the 2026-09-16 production capture (migration 05's own objects${table === "evidence_items" ? " and 03's three CHECKs" : ""} excluded)`)},
            coalesce(p.problems, 'identical'),
            ${lit(final ? "Every pre-05 definition, foreign key and append-only trigger still present and unchanged" : "Any difference means production changed in a way this packet was not built for: STOP")}
       FROM (SELECT nullif(concat_ws('; ',
              CASE WHEN to_regclass('kai.${table}') IS NULL THEN 'table missing' END,
              (SELECT string_agg('column ' || e.col || CASE WHEN a.col IS NULL THEN ' missing' ELSE ' is ' || a.type || CASE WHEN a.nn THEN ' NOT NULL' ELSE ' NULL' END END, ', ' ORDER BY e.col)
                 FROM baseline_columns e LEFT JOIN actual_columns a ON a.tbl = e.tbl AND a.col = e.col
                WHERE e.tbl = ${lit(table)} AND (a.col IS NULL OR a.type <> e.type OR a.nn <> e.nn)),
              (SELECT string_agg('extra NOT NULL column without default ' || a.col, ', ') FROM actual_columns a
                WHERE a.tbl = ${lit(table)} AND a.nn AND NOT a.has_default AND NOT EXISTS (SELECT 1 FROM baseline_columns e WHERE e.tbl = a.tbl AND e.col = a.col)),
              (SELECT string_agg('constraint ' || coalesce(e.name, a.name) || CASE WHEN e.name IS NULL THEN ' unexpected: ' || a.def WHEN a.name IS NULL THEN ' missing' ELSE ' changed: ' || a.def END, ', ' ORDER BY coalesce(e.name, a.name))
                 FROM (SELECT * FROM baseline_constraints WHERE tbl = ${lit(table)}) e
                 FULL JOIN (SELECT * FROM actual_constraints WHERE tbl = ${lit(table)}) a ON a.name = e.name
                WHERE e.name IS NULL OR a.name IS NULL OR a.md5 <> e.md5),
              (SELECT string_agg('unique index ' || coalesce(e.name, a.name) || CASE WHEN e.name IS NULL THEN ' unexpected: ' || a.def WHEN a.name IS NULL THEN ' missing' ELSE ' changed: ' || a.def END, ', ' ORDER BY coalesce(e.name, a.name))
                 FROM (SELECT * FROM baseline_unique_indexes WHERE tbl = ${lit(table)}) e
                 FULL JOIN (SELECT * FROM actual_unique_indexes WHERE tbl = ${lit(table)}) a ON a.name = e.name
                WHERE e.name IS NULL OR a.name IS NULL OR a.md5 <> e.md5),
              (SELECT string_agg('trigger ' || coalesce(e.name, a.name) || CASE WHEN e.name IS NULL THEN ' unexpected: ' || a.def WHEN a.name IS NULL THEN ' missing' WHEN a.md5 <> e.md5 THEN ' changed: ' || a.def ELSE ' enabled state ' || a.enabled END, ', ' ORDER BY coalesce(e.name, a.name))
                 FROM (SELECT * FROM baseline_triggers WHERE tbl = ${lit(table)}) e
                 FULL JOIN (SELECT * FROM actual_triggers WHERE tbl = ${lit(table)}) a ON a.name = e.name
                WHERE e.name IS NULL OR a.name IS NULL OR a.md5 <> e.md5 OR a.enabled <> e.enabled)
            ), '') AS problems) p`);
  });
  return rows;
}

// Section C: one row per migration 05 object. Preflight statuses: REQUIRED
// (pre-05 state), ALREADY_APPLIED (exactly as 05 creates it, enabled and
// validated) or STOP_INCOMPATIBLE (anything else).
// In the final verification every object must be exactly as created (PASS).
function sectionC({ final }) {
  const stateStatus = (stateSql) => (final
    ? `CASE WHEN ${stateSql} = 'target' THEN 'PASS' ELSE 'FAIL' END`
    : `CASE ${stateSql} WHEN 'base' THEN 'REQUIRED' WHEN 'target' THEN 'ALREADY_APPLIED' ELSE 'STOP_INCOMPATIBLE' END`);
  const rows = [];
  M05_CONSTRAINTS.forEach((c, i) => rows.push(`SELECT ${401 + i}, 'C_MIGRATION_05_STATE', ${lit(`C0${i + 1}`)}, ${stateStatus(constraintStateSql(c))},
            ${lit(`${c.name}: REQUIRED = ${c.base ? normalize(c.base) : "absent"}; ALREADY_APPLIED = ${normalize(c.target)} (validated)`)},
            ${constraintObservedSql(c.table, c.name)}, ${lit(`kai.${c.table}`)}`));
  rows.push(`SELECT 405, 'C_MIGRATION_05_STATE', 'C05', ${stateStatus(helperStateSql)},
            ${lit(`kai.${M05_HELPER.name}(${M05_HELPER.identity_arguments}): REQUIRED = absent; ALREADY_APPLIED = one sql STABLE function returning boolean, not SECURITY DEFINER, body md5 ${M05_HELPER.prosrc_md5}`)},
            ${helperObservedSql}, 'Is the evidence item P2-01M source-record-count measurement evidence (with its measurement row)?'`);
  M05_TRIGGERS.forEach((o, i) => rows.push(`SELECT ${406 + i}, 'C_MIGRATION_05_STATE', ${lit(`C0${6 + i}`)}, ${stateStatus(triggerStateSql(o))},
            ${lit(`${o.trigger} + kai.${o.fn.name}(): REQUIRED = both absent; ALREADY_APPLIED = ${o.definition} [enabled], plpgsql returns trigger, body md5 ${o.fn.prosrc_md5}`)},
            ${triggerObservedSql(o)}, ${lit(`kai.${o.table}`)}`));
  rows.push(`SELECT 409, 'C_MIGRATION_05_STATE', 'C09', CASE WHEN ${strayObjectsSql} IS NULL THEN ${final ? "'PASS'" : "'NONE'"} ELSE ${final ? "'FAIL'" : "'STOP_INCOMPATIBLE'"} END,
            'no other organization_factual_review_* function or trigger exists',
            coalesce(${strayObjectsSql}, 'none'), 'An unexpected same-family object means a different or edited version of 05 was applied'`);
  return rows;
}

// Section V: post-migration verification rows.
function verifyRows(base) {
  const rows = [];
  const add = (id, condition, expectedText, observed, detail) => rows.push(`SELECT ${base + rows.length}, 'V05', ${lit(id)},
            CASE WHEN ${condition} THEN 'PASS' ELSE 'FAIL' END, ${lit(expectedText)}, ${observed}, ${lit(detail)}`);
  const details = [
    "GK roles gk_reviewer and gk_admin kept; client_admin added (kai.evidence_review_decisions)",
    "GK roles gk_reviewer and gk_admin kept; client_admin added (kai.claim_review_decisions)",
    "A client_admin claim decision may approve the internal audience only (kai.claim_review_decisions)",
    "gk_reviewer kept for every decision and dimension; client_admin only accepted_internal_with_limitation on three dimensions (kai.coverage_review_decisions)",
  ];
  M05_CONSTRAINTS.forEach((c, i) => add(`V05.${i + 1}`, `${constraintStateSql(c)} = 'target'`, `${normalize(c.target)} (validated)`,
    constraintObservedSql(c.table, c.name), details[i]));
  add("V05.5", `${helperStateSql} = 'target'`,
    `kai.${M05_HELPER.name}(${M05_HELPER.identity_arguments}) sql STABLE returns boolean, not SECURITY DEFINER, body md5 ${M05_HELPER.prosrc_md5}`,
    helperObservedSql, "Shared by the three scope triggers: true only for source_record_count_measurement evidence with its evidence_measurements row");
  const triggerDetails = [
    "client_admin evidence decision: P2-01M measurement evidence only; may not supersede a GK decision (SQLSTATE 23514 otherwise)",
    "client_admin claim decision: claim on P2-01M measurement evidence only; may not supersede a GK decision (SQLSTATE 23514 otherwise)",
    "client_admin coverage acceptance: claim on P2-01M measurement evidence only (SQLSTATE 23514 otherwise)",
  ];
  M05_TRIGGERS.forEach((o, i) => add(`V05.${6 + i}`, `${triggerStateSql(o)} = 'target'`,
    `${o.definition} [enabled, on kai.${o.table}]; kai.${o.fn.name}() plpgsql returns trigger, body md5 ${o.fn.prosrc_md5}`, triggerObservedSql(o), triggerDetails[i]));
  add("V05.9", `${strayObjectsSql} IS NULL`, "no other organization_factual_review_* function or trigger", `coalesce(${strayObjectsSql}, 'none')`,
    "No partial, duplicate or edited copy of migration 05's objects");
  const m = matrix;
  const ev = m.evidence();
  rows.push(matrixRow(base + rows.length, "V05", "V05.10", "Evidence decision roles: gk_reviewer, gk_admin and client_admin accepted; every other role rejected", ev.table, ev.names, ev.columns, ev.cases));
  const cl = m.claim();
  rows.push(matrixRow(base + rows.length, "V05", "V05.11",
    "Claim decision role x outcome x audiences (role, P2-12 audience scope and organization audience CHECKs together): GK unchanged; client_admin approval internal only",
    cl.table, cl.names, cl.columns, cl.cases,
    "gk_reviewer and gk_admin with every P2-12-valid outcome/audience pair; client_admin with approved or approved_with_limitation for {internal} only, and rejected or needs_more_information with NULL audiences"));
  const cv = m.coverage();
  rows.push(matrixRow(base + rows.length, "V05", "V05.12",
    "Coverage decision role x decision x dimension (role, decision and dimension CHECKs together): gk_reviewer only, as before, plus client_admin internal acceptance of three dimensions",
    cv.table, cv.names, cv.columns, cv.cases,
    "gk_reviewer for all 30 decision/dimension pairs; client_admin only accepted_internal_with_limitation for small_cell_risk, conflicting_source_indicators, requirement_alignment"));
  rows.push(`SELECT ${base + rows.length}, 'V05', 'V05.13', 'INFO',
            'trigger behavior is proven by local behavioral tests, not here',
            'this file is read-only and inserts nothing',
            'Unsupported evidence, GK supersession and external-audience inserts were rejected (SQLSTATE 23514) on the locally migrated schema (scripts/kai-sprint2-pgadmin-migration-05-packet-rehearsal-local-postgres.js compat)'`);
  return rows;
}

// --------------------------------------------------------------- writers
const header = (title, purpose, lines) => `-- KAI pgAdmin migration 05 delta packet: ${title}
-- READ-ONLY. One SELECT statement; it changes nothing and inserts nothing.
-- ${purpose}
${lines.map((line) => `-- ${line}`).join("\n")}
-- Generated by scripts/kai-sprint2-pgadmin-migration-05-packet-build.js from
--   ${productionCapturePath} (owner pgAdmin capture, 2026-09-16),
--   ${priorExpectedPath} (accepted 01-04 results) and
--   ${m05CatalogPath}.
-- Run it in the pgAdmin Query Tool (Execute script, F5). Read the Data Output grid.
`;
const columns = "seq, section, check_id, status, expected, observed, detail";
function wrap(rows, ctes, tailSql) {
  return `WITH${ctes ? `\n${ctes},` : ""}
checks(${columns}) AS (
${rows.map((row) => `  ${row.replace(/\n/g, "\n  ")}`).join("\n  UNION ALL\n")}
)
SELECT ${columns} FROM checks
UNION ALL
${tailSql}
ORDER BY seq;
`;
}
const notOk = (okStatuses) => `status IS NULL OR status NOT IN (${inList(okStatuses)})`;

const files = {};

// 00 preflight: A, B, C; then M05 (the migration's state) and OVERALL.
{
  const rows = [...sectionA(), ...sectionB({ final: false }), ...sectionC({ final: false })];
  const cIds = "section = 'C_MIGRATION_05_STATE' AND check_id <> 'C09'";
  const blockingAB = `section IN ('A_ENVIRONMENT', 'B_PREREQUISITES', 'B_BASELINE') AND (${notOk(["PASS"])})`;
  const m05State = `CASE WHEN NOT EXISTS (SELECT 1 FROM checks WHERE ${cIds} AND (${notOk(["REQUIRED"])})) AND (SELECT status FROM checks WHERE check_id = 'C09') = 'NONE' THEN 'REQUIRED'
              WHEN NOT EXISTS (SELECT 1 FROM checks WHERE ${cIds} AND (${notOk(["ALREADY_APPLIED"])})) AND (SELECT status FROM checks WHERE check_id = 'C09') = 'NONE' THEN 'ALREADY_APPLIED'
              ELSE 'STOP_INCOMPATIBLE' END`;
  const tail = `SELECT 998, 'C_MIGRATION_05_STATE', 'M05', ${m05State},
       'all eight objects REQUIRED (absent / pre-05) or all eight ALREADY_APPLIED; any mixture is a partial migration',
       CASE WHEN (SELECT count(DISTINCT status) FROM checks WHERE ${cIds}) > 1
            THEN 'mixed: ' || (SELECT string_agg(check_id || '=' || status, ', ' ORDER BY seq) FROM checks WHERE ${cIds})
            ELSE 'uniform: ' || coalesce((SELECT min(status) FROM checks WHERE ${cIds}), '(none)') END
         || CASE WHEN (SELECT status FROM checks WHERE check_id = 'C09') = 'NONE' THEN '' ELSE '; unexpected same-family objects (C09)' END,
       'kai_sprint2_plan_a_organization_internal_factual_review_authority'
UNION ALL
SELECT 999, 'OVERALL', 'OVERALL',
       CASE WHEN (SELECT count(*) FROM checks) <> ${rows.length} THEN 'STOP_INCOMPATIBLE'
            WHEN EXISTS (SELECT 1 FROM checks WHERE ${blockingAB}) THEN 'STOP_INCOMPATIBLE'
            ELSE ${m05State} END,
       'exactly one of REQUIRED, ALREADY_APPLIED, STOP_INCOMPATIBLE',
       CASE WHEN (SELECT count(*) FROM checks) <> ${rows.length} THEN 'incomplete verification: ' || (SELECT count(*) FROM checks) || ' of ${rows.length} check rows'
            WHEN EXISTS (SELECT 1 FROM checks WHERE ${blockingAB}) THEN 'blocking rows: ' || (SELECT string_agg(check_id, ', ' ORDER BY seq) FROM checks WHERE ${blockingAB})
            ELSE 'migration 05 state: ' || ${m05State} || '; every environment, prerequisite and baseline row PASS' END,
       CASE WHEN (SELECT count(*) FROM checks) <> ${rows.length} OR EXISTS (SELECT 1 FROM checks WHERE ${blockingAB})
            THEN 'STOP_INCOMPATIBLE: run no migration. Save this whole grid as CSV and send it back.'
            ELSE CASE ${m05State}
              WHEN 'REQUIRED' THEN 'REQUIRED: run 05_MIGRATION_kai_sprint2_plan_a_organization_internal_factual_review_authority.sql, then 05V, then this preflight again, then 99.'
              WHEN 'ALREADY_APPLIED' THEN 'ALREADY_APPLIED: do not run the migration. Run 05V, then 99.'
              ELSE 'STOP_INCOMPATIBLE: partial or different migration 05 state. Run no migration. Save this whole grid as CSV and send it back.' END END`;
  files["00_MIGRATION_05_PREFLIGHT_READ_ONLY.sql"] = header("00 migration 05 preflight",
    "Classifies production for migration 05: REQUIRED, ALREADY_APPLIED or STOP_INCOMPATIBLE.", [
      "Sections: A environment and privileges; B the accepted post-04 state (01-04 objects exactly as",
      "verified), the columns and relationships 05 reads, and the six tables 05 depends on compared with",
      "the 2026-09-16 capture; C each of migration 05's eight objects. Row M05 is the migration's state;",
      "the last row, OVERALL, is the single classification.",
    ]) + wrap(rows, baselineCtes(), tail);
}

const passTail = (rows, what) => `SELECT 999, 'OVERALL', 'OVERALL',
       CASE WHEN (SELECT count(*) FROM checks) <> ${rows.length} THEN 'FAIL'
            WHEN EXISTS (SELECT 1 FROM checks WHERE ${notOk(["PASS", "INFO"])}) THEN 'FAIL' ELSE 'PASS' END,
       ${lit(`every row PASS (${what}); ${rows.length} rows`)},
       CASE WHEN (SELECT count(*) FROM checks) <> ${rows.length} THEN 'incomplete verification: ' || (SELECT count(*) FROM checks) || ' of ${rows.length} check rows'
            ELSE coalesce('failing rows: ' || (SELECT string_agg(check_id, ', ' ORDER BY seq) FROM checks WHERE ${notOk(["PASS", "INFO"])}), 'all rows PASS') END,
       CASE WHEN (SELECT count(*) FROM checks) <> ${rows.length} OR EXISTS (SELECT 1 FROM checks WHERE ${notOk(["PASS", "INFO"])})
            THEN 'STOP. Do not continue. Save this grid as CSV and send it back.' ELSE 'Verified.' END`;

{
  const rows = verifyRows(100);
  files["05V_VERIFY_AFTER_plan_a_organization_internal_factual_review_authority_READ_ONLY.sql"] = header(
    "05V verification after 05 (organization internal factual review authority)",
    "Proves migration 05 produced exactly its intended objects: definitions, enabled triggers, function bodies.", [
      "Role, audience, decision and dimension rules are evaluated by running the live CHECK expressions",
      "against literal values (query_to_xml), not by inserting rows. Last row OVERALL must be PASS.",
    ]) + wrap(rows, null, passTail(rows, "migration 05 verified"));
}

{
  const rows = [...sectionA().slice(0, 2), ...sectionB({ final: true }), ...sectionC({ final: true }), ...verifyRows(500)];
  files["99_MIGRATION_05_FINAL_SCHEMA_VERIFICATION_READ_ONLY.sql"] = header("99 migration 05 final schema verification",
    "The intended final structure after migration 05, without rerunning 01-04:", [
      "01-04 still exactly as accepted (B01); every column and relationship 05 reads (B02); append-only",
      "helpers and the six dependent tables unchanged from the capture apart from 05's own objects (B03,",
      "B_TABLE); every 05 object exactly as created (C, no partial state); and all of 05V, including the",
      "GK combinations preserved and the prohibited role/audience/decision combinations rejected.",
    ]) + wrap(rows, baselineCtes(), passTail(rows, "final schema after migration 05 verified"));
}

{
  const guardedCount = (table, where) => `(CASE WHEN to_regclass('kai.${table}') IS NULL THEN NULL
      ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM kai.${table} WHERE ${where.replace(/'/g, "''")}', true, true, '')))[1]::text::bigint END)`;
  const anyObject = `(${M05_CONSTRAINTS.map((c) => `${constraintStateSql(c)} <> 'base'`).join(" OR ")} OR ${helperStateSql} <> 'base' OR ${M05_TRIGGERS.map((o) => `${triggerStateSql(o)} <> 'base'`).join(" OR ")})`;
  const rows = [
    `SELECT 101, 'RP', 'R05',
            CASE WHEN e.n IS NULL OR c.n IS NULL OR v.n IS NULL THEN 'STOP_TABLE_MISSING'
                 WHEN e.n + c.n + v.n > 0 THEN 'UNSAFE_ROLLBACK_REFUSES'
                 WHEN NOT ${anyObject} THEN 'NOT_APPLIED'
                 ELSE 'SAFE_TO_ROLL_BACK' END,
            'no client_admin evidence, claim or coverage decision exists',
            'client_admin decisions: evidence=' || coalesce(e.n::text, 'table absent') || '; claim=' || coalesce(c.n::text, 'table absent') || '; coverage=' || coalesce(v.n::text, 'table absent')
              || '; migration 05 objects present=' || ${anyObject}::text,
            'R05 refuses (raises "rollback refused: client_admin review decisions exist") and changes nothing while any count is above 0. Never delete, reclassify or discard these decisions to force it.'
       FROM (SELECT ${guardedCount("evidence_review_decisions", "decided_by_role = 'client_admin'")} AS n) e,
            (SELECT ${guardedCount("claim_review_decisions", "decided_by_role = 'client_admin'")} AS n) c,
            (SELECT ${guardedCount("coverage_review_decisions", "decided_by_role = 'client_admin'")} AS n) v`,
    `SELECT 102, 'RP', 'R05_APP', 'INFO',
            'application before database',
            'not determinable from the database',
            'Before R05 the application must already serve a revision that never records a client_admin review decision (before e0022aa, for example 96653f8); otherwise the organization''s review fails with SQLSTATE 23514 after R05.'`,
  ];
  files["RP05_ROLLBACK_PRECHECK_READ_ONLY.sql"] = header("RP05 migration 05 rollback precheck",
    "Run before the R05 rollback file. Reports counts only (no row contents) and whether R05 may run.", [
      "Statuses: NOT_APPLIED (nothing to roll back), SAFE_TO_ROLL_BACK, UNSAFE_ROLLBACK_REFUSES (protected",
      "organization decisions exist: do not roll back), STOP_TABLE_MISSING.",
    ]) + wrap(rows, null, `SELECT 999, 'OVERALL', 'OVERALL', (SELECT status FROM checks WHERE check_id = 'R05'), 'R05 may run only when SAFE_TO_ROLL_BACK', 'counts only',
       'Run rollback/R05 only when R05 is SAFE_TO_ROLL_BACK and the application has already been moved off e0022aa or later.'`);
}

for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(packetDir, name), content.replace(/[ \t]+$/gm, ""));
  console.log(`wrote ${name} (${content.length} bytes)`);
}
console.log(`baseline: ${baselineConstraints.length} constraints, ${baselineColumns.length} columns, ${baselineTriggers.length} triggers, ${baselineUniqueIndexes.length} unique indexes, ${baselineFunctions.length} helper functions over ${BASELINE_TABLES.length} tables`);
console.log(`matrices: evidence ${matrix.evidence().cases.length}, claim ${matrix.claim().cases.length}, coverage ${matrix.coverage().cases.length} combinations`);
