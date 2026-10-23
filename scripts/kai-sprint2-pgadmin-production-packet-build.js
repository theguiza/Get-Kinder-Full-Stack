/**
 * Builds the read-only SQL of KAI_PGADMIN_PRODUCTION_MIGRATION_PACKET from two
 * recorded catalogs; it connects to nothing:
 *
 *   - artifacts/kai-db-reconciliation-2026-09-16/PRODUCTION_KAI_SCHEMA.json:
 *     the owner's pgAdmin capture of the production kai schema (2026-09-16),
 *     the last recorded production starting state;
 *   - KAI_PGADMIN_PRODUCTION_MIGRATION_PACKET/support/expected_post_migration_catalog_pg16.json:
 *     the PostgreSQL 16 rendering of every object the four packet migrations
 *     create or change (written by the rehearsal script's `capture` mode).
 *
 * Every generated file is one SELECT statement (no writes, no temporary
 * objects) so pgAdmin's Query Tool shows its whole result in Data Output.
 * Definitions are compared after normalization: kai./public. qualifiers
 * removed (they depend on the session search_path), whitespace collapsed, and
 * a trailing NOT VALID removed (validation state is reported separately where
 * it matters).
 *
 *   node scripts/kai-sprint2-pgadmin-production-packet-build.js
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const packetDir = join(repoRoot, "KAI_PGADMIN_PRODUCTION_MIGRATION_PACKET");
const productionCapturePath = "artifacts/kai-db-reconciliation-2026-09-16/PRODUCTION_KAI_SCHEMA.json";
const production = JSON.parse(readFileSync(join(repoRoot, productionCapturePath), "utf8"));
const expected = JSON.parse(readFileSync(join(packetDir, "support", "expected_post_migration_catalog_pg16.json"), "utf8")).after;

const normalize = (text) => String(text ?? "").replace(/\b(kai|public)\./g, "").replace(/\s+/g, " ").trim().replace(/ NOT VALID$/, "");
const md5 = (text) => createHash("md5").update(text, "utf8").digest("hex");
const fingerprint = (text) => md5(normalize(text));
const lit = (text) => `'${String(text).replace(/'/g, "''")}'`;
const N = (expr) => `regexp_replace(btrim(regexp_replace(regexp_replace(${expr}, '\\m(kai|public)\\.', '', 'g'), '\\s+', ' ', 'g')), ' NOT VALID$', '')`;
const NMD5 = (expr) => `md5(${N(expr)})`;

// Workflow tables: every kai table the file-to-report path reads or writes.
// Repository-owned: drift FAILs. Production-owned (no repository migration
// creates them): drift is reported as WARN, since no packet migration touches them.
const REPOSITORY_TABLES = [
  "intake_parser_runs", "intake_file_profiles", "data_dictionaries", "data_dictionary_fields", "data_dictionary_mappings",
  "data_quality_findings", "intake_sensitivity_profiles", "intake_sensitivity_review_decisions", "intake_source_candidates",
  "intake_promotion_decisions", "upload_policy_decision_replay", "upload_lifecycle_audit", "sources", "source_versions",
  "source_locators", "evidence_items", "claims", "claim_evidence_links", "evidence_review_decisions", "claim_review_decisions",
  "coverage_review_decisions", "gap_log_items", "client_followup_items", "conflict_groups", "review_queue_items",
  "generation_runs", "generated_content_drafts", "generated_content_blocks", "generated_content_citations",
  "limitation_snapshots", "limitation_snapshot_entries", "export_candidates", "human_authority_decisions",
  "export_manifests", "gk_organization_bindings",
];
const PRODUCTION_OWNED_TABLES = ["intake_files", "audit_events", "users", "organizations", "engagements", "organization_memberships", "user_roles", "roles"];
const WORKFLOW_TABLES = [...REPOSITORY_TABLES, ...PRODUCTION_OWNED_TABLES];
for (const table of WORKFLOW_TABLES) {
  if (!production.tables.some((t) => t.name === table)) throw new Error(`workflow table ${table} is not in the production capture`);
}

// Constraints decided elsewhere: the packet migrations' own objects (section C),
// the three content-type CHECKs later migrations may widen (B03), and the audit
// operation vocabulary, compared as a set (B04).
const MIGRATION_OWNED_CONSTRAINTS = [
  "evidence_items_p2_01_evidence_type_check", "evidence_items_p2_01_data_class_check", "evidence_items_p2_01m_type_class_pairing_check",
  "source_locators_p2_01_locator_type_check", "source_locators_p2_01_coordinates_check",
  "intake_sensitivity_review_decisions_b1a_02_role_check",
  "limitation_snapshots_p3_16_confirmed_by_role_check", "human_authority_decisions_p3_17_role_by_type_check",
];
const CONTENT_TYPE_CONSTRAINTS = [
  ["generation_runs", "generation_runs_p3_01_content_type_check"],
  ["generated_content_drafts", "generated_content_drafts_p3_01_content_type_check"],
  ["export_candidates", "export_candidates_p3_16_content_type_check"],
];
const OPERATION_CONSTRAINT = "upload_lifecycle_audit_gate_a_operation_check";
const EXCLUDED_CONSTRAINTS = [...MIGRATION_OWNED_CONSTRAINTS, ...CONTENT_TYPE_CONSTRAINTS.map(([, name]) => name), OPERATION_CONSTRAINT];
const MIGRATION_OWNED_TRIGGERS = ["trg_organization_release_limitation_snapshot_scope", "trg_organization_release_decision_scope"];

const inList = (values) => values.map(lit).join(", ");
const valuesBlock = (rows, columns, alias = "v") => rows.length
  ? `(VALUES\n${rows.map((row) => `    (${row.map((v) => (v === null ? "NULL" : typeof v === "boolean" ? String(v) : lit(v))).join(", ")})`).join(",\n")}\n  ) AS ${alias}(${columns.join(", ")})`
  : `(SELECT ${columns.map((c) => `NULL::text AS ${c}`).join(", ")} WHERE false) AS ${alias}`;

// ----------------------------------------------------------------- baseline
const baselineConstraints = production.constraints
  .filter((c) => WORKFLOW_TABLES.includes(c.table_name) && !EXCLUDED_CONSTRAINTS.includes(c.name))
  .map((c) => [c.table_name, c.name, fingerprint(c.definition)]);
const baselineColumns = production.columns
  .filter((c) => WORKFLOW_TABLES.includes(c.table_name))
  .map((c) => [c.table_name, c.column_name, normalize(c.type), c.not_null]);
const baselineTriggers = production.triggers
  .filter((t) => WORKFLOW_TABLES.includes(t.table_name))
  .map((t) => [t.table_name, t.name, fingerprint(t.definition), t.enabled]);
const baselineUniqueIndexes = production.indexes
  .filter((i) => WORKFLOW_TABLES.includes(i.table_name) && /^CREATE UNIQUE INDEX/.test(i.definition))
  .map((i) => [i.table_name, i.name, fingerprint(i.definition)]);
const triggerFunctions = new Set();
for (const t of production.triggers.filter((t) => WORKFLOW_TABLES.includes(t.table_name))) {
  const match = t.definition.match(/EXECUTE FUNCTION kai\.([a-z0-9_]+)\(/);
  if (match) triggerFunctions.add(match[1]);
}
for (const c of production.constraints.filter((c) => WORKFLOW_TABLES.includes(c.table_name))) {
  for (const match of c.definition.matchAll(/kai\.([a-z0-9_]+)\(/g)) triggerFunctions.add(match[1]);
}
const baselineFunctions = production.functions
  .filter((f) => triggerFunctions.has(f.name))
  .map((f) => [f.name, f.arguments, fingerprint(f.normalized_definition)]);
const enumLabels = new Map();
for (const t of production.types.filter((t) => t.kind === "e")) {
  if (!enumLabels.has(t.name)) enumLabels.set(t.name, []);
  enumLabels.get(t.name).push(t);
}
const usedEnums = new Set(production.columns.filter((c) => WORKFLOW_TABLES.includes(c.table_name))
  .map((c) => c.type.replace(/^kai\./, "").replace(/\[\]$/, "")).filter((name) => enumLabels.has(name)));
const baselineEnums = [...usedEnums].sort().map((name) => [name, enumLabels.get(name)
  .sort((a, b) => a.enum_sort_order - b.enum_sort_order).map((t) => t.enum_label).join(",")]);

const BASE_CONTENT_TYPES = ["evidence_summary", "impact_narrative", "readiness_assessment", "data_gap_memo"];
const EXTENDED_CONTENT_TYPES = [...BASE_CONTENT_TYPES, "case_for_support", "board_update", "annual_report_section", "funder_outcome_table", "grant_response_paragraph"];
const productionOperationDef = production.constraints.find((c) => c.name === OPERATION_CONSTRAINT).definition;
const literalSet = (definition) => {
  const set = new Set([...definition.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));
  for (const m of definition.matchAll(/'\{([a-z0-9_,]+)\}'/g)) for (const item of m[1].split(",")) set.add(item);
  return set;
};
const REQUIRED_OPERATIONS = [...literalSet(productionOperationDef)].sort();
if (REQUIRED_OPERATIONS.length !== 35) throw new Error(`expected 35 audit operations in the production capture, found ${REQUIRED_OPERATIONS.length}`);

// SQL: the literal set of a CHECK definition (quoted words and '{a,b}' arrays).
const literalsSql = (defExpr) => `(SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}') FROM (
        SELECT m[1] AS x FROM regexp_matches(${defExpr}, '''([a-z0-9_]+)''', 'g') AS m
        UNION ALL
        SELECT unnest(string_to_array(m[1], ',')) FROM regexp_matches(${defExpr}, '''\\{([a-z0-9_,]+)\\}''', 'g') AS m
      ) lit)`;

// ------------------------------------------------------- packet migrations
const productionDef = (name) => production.constraints.find((c) => c.name === name).definition;
const expectedDef = (name) => {
  const found = expected.constraints.find((c) => c.name === name);
  if (!found) throw new Error(`no expected definition for ${name}`);
  return found.definition;
};
const newTableObjects = (table) => ({
  columns: expected.columns.filter((c) => c.table_name === table).map((c) => [c.column_name, normalize(c.type), c.not_null, normalize(c.default)]),
  constraints: expected.constraints.filter((c) => c.table_name === table).map((c) => [c.name, fingerprint(c.definition)]),
  indexes: expected.indexes.filter((i) => i.table_name === table).map((i) => [i.name, fingerprint(i.definition)]),
});

// Returns a SQL boolean: the table exists and matches exactly (columns,
// constraints, indexes), plus a SQL text describing any difference.
function exactTableSql(table) {
  const o = newTableObjects(table);
  const diff = `(SELECT string_agg(problem, '; ' ORDER BY problem) FROM (
      SELECT 'column ' || coalesce(e.name, a.name) || CASE WHEN e.name IS NULL THEN ' unexpected' WHEN a.name IS NULL THEN ' missing' ELSE ' differs (' || a.type || CASE WHEN a.not_null THEN ' NOT NULL' ELSE '' END || ' DEFAULT ' || coalesce(a.def, '-') || ')' END AS problem
        FROM ${valuesBlock(o.columns, ["name", "type", "not_null", "def"], "e")}
        FULL JOIN (SELECT a.attname::text AS name, ${N("format_type(a.atttypid, a.atttypmod)")} AS type, a.attnotnull AS not_null,
                          ${N("coalesce(pg_get_expr(d.adbin, d.adrelid), '')")} AS def
                     FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                    WHERE a.attrelid = to_regclass('kai.${table}') AND a.attnum > 0 AND NOT a.attisdropped) a ON a.name = e.name
       WHERE e.name IS NULL OR a.name IS NULL OR a.type <> e.type OR a.not_null <> e.not_null OR a.def <> e.def
      UNION ALL
      SELECT 'constraint ' || coalesce(e.name, a.name) || CASE WHEN e.name IS NULL THEN ' unexpected' WHEN a.name IS NULL THEN ' missing' ELSE ' differs: ' || a.def END
        FROM ${valuesBlock(o.constraints, ["name", "md5"], "e")}
        FULL JOIN (SELECT conname::text AS name, ${NMD5("pg_get_constraintdef(oid, true)")} AS md5, ${N("pg_get_constraintdef(oid, true)")} AS def
                     FROM pg_constraint WHERE conrelid = to_regclass('kai.${table}') AND contype <> 'n') a ON a.name = e.name
       WHERE e.name IS NULL OR a.name IS NULL OR a.md5 <> e.md5
      UNION ALL
      SELECT 'index ' || coalesce(e.name, a.name) || CASE WHEN e.name IS NULL THEN ' unexpected' WHEN a.name IS NULL THEN ' missing' ELSE ' differs: ' || a.def END
        FROM ${valuesBlock(o.indexes, ["name", "md5"], "e")}
        FULL JOIN (SELECT indexname::text AS name, ${NMD5("indexdef")} AS md5, ${N("indexdef")} AS def
                     FROM pg_indexes WHERE schemaname = 'kai' AND tablename = '${table}') a ON a.name = e.name
       WHERE e.name IS NULL OR a.name IS NULL OR a.md5 <> e.md5
    ) problems)`;
  return { present: `(to_regclass('kai.${table}') IS NOT NULL)`, diff };
}

const constraintStateSql = (table, name) => `(SELECT ${NMD5("pg_get_constraintdef(con.oid, true)")}
     FROM pg_constraint con WHERE con.conrelid = to_regclass('kai.${table}') AND con.conname = ${lit(name)})`;
const constraintObservedSql = (table, name) => `coalesce((SELECT ${N("pg_get_constraintdef(con.oid, true)")}
     FROM pg_constraint con WHERE con.conrelid = to_regclass('kai.${table}') AND con.conname = ${lit(name)}), '(absent)')`;
// 'base' | 'target' | 'absent' | 'other'
const stateOf = (table, name, baseDef, targetDef) => `(CASE ${constraintStateSql(table, name)}
      WHEN ${lit(fingerprint(targetDef))} THEN 'target'
      ${baseDef ? `WHEN ${lit(fingerprint(baseDef))} THEN 'base'` : ""}
      ELSE CASE WHEN ${constraintStateSql(table, name)} IS NULL THEN 'absent' ELSE 'other' END END)`;

const M02 = {
  table: "intake_sensitivity_review_decisions", name: "intake_sensitivity_review_decisions_b1a_02_role_check",
  base: productionDef("intake_sensitivity_review_decisions_b1a_02_role_check"),
  target: expectedDef("intake_sensitivity_review_decisions_b1a_02_role_check"),
};
const M03_CONSTRAINTS = [
  ["evidence_items", "evidence_items_p2_01_evidence_type_check"],
  ["evidence_items", "evidence_items_p2_01_data_class_check"],
  ["evidence_items", "evidence_items_p2_01m_type_class_pairing_check"],
  ["source_locators", "source_locators_p2_01_locator_type_check"],
  ["source_locators", "source_locators_p2_01_coordinates_check"],
].map(([table, name]) => ({ table, name, base: production.constraints.find((c) => c.name === name)?.definition ?? null, target: expectedDef(name) }));
const M04_CONSTRAINTS = [
  ["limitation_snapshots", "limitation_snapshots_p3_16_confirmed_by_role_check"],
  ["human_authority_decisions", "human_authority_decisions_p3_17_role_by_type_check"],
].map(([table, name]) => ({ table, name, base: productionDef(name), target: expectedDef(name) }));
const M04_OBJECTS = expected.triggers.map((t) => {
  const fn = t.definition.match(/EXECUTE FUNCTION kai\.([a-z0-9_]+)\(/)[1];
  const f = expected.functions.find((x) => x.name === fn);
  return { table: t.table_name, trigger: t.name, triggerMd5: fingerprint(t.definition), fn, prosrcMd5: f.prosrc_md5 };
});
const triggerStateSql = (o) => `(SELECT CASE
      WHEN NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('kai.${o.table}') AND tgname = ${lit(o.trigger)})
       AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'kai'::regnamespace AND proname = ${lit(o.fn)}) THEN 'absent'
      WHEN EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('kai.${o.table}') AND t.tgname = ${lit(o.trigger)}
                     AND ${NMD5("pg_get_triggerdef(t.oid, true)")} = ${lit(o.triggerMd5)} AND t.tgenabled = 'O')
       AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.pronamespace = 'kai'::regnamespace AND p.proname = ${lit(o.fn)} AND p.pronargs = 0
                      AND md5(p.prosrc) = ${lit(o.prosrcMd5)} AND l.lanname = 'plpgsql' AND p.prorettype = 'trigger'::regtype) THEN 'target'
      ELSE 'other' END)`;

// ---------------------------------------------------- constraint matrices
// Each probe evaluates the live CHECK expression (pg_get_expr) against
// literal values through query_to_xml: nothing is inserted anywhere.
function probeSql(table, names, columns, values) {
  const exprs = names.map((name) => `(SELECT 'coalesce((' || pg_get_expr(conbin, conrelid) || '), true)' FROM pg_constraint WHERE conrelid = to_regclass('kai.${table}') AND conname = ${lit(name)})`);
  const select = exprs.join(" || ' AND ' || ");
  const valueList = values.map((v) => `quote_literal(${lit(v[1])}) || '::${v[0]}'`).join(" || ', ' || ");
  return `(SELECT (xpath('/row/ok/text()', query_to_xml(
      'SELECT (' || ${select} || ') AS ok FROM (VALUES (' || ${valueList} || ')) AS v(${columns.join(", ")})', true, true, '')))[1]::text)`;
}

const RBT_TYPES = ["client_reviewed", "funder_ready", "public_ready", "export_authority_granted"];
const RBT_ROLES = ["client_reviewer", "client_admin", "gk_admin", "gk_reviewer"];
const RBT_ACTIONS = ["grant", "revoke"];
const rbtAllowed = (type, role, action, widened) => (type === "client_reviewed" && role === "client_reviewer")
  || (type !== "client_reviewed" && role === "gk_admin")
  || (widened && type === "export_authority_granted" && role === "client_admin" && action === "grant");
const matrix = {
  roleByType: (widened) => RBT_TYPES.flatMap((t) => RBT_ROLES.flatMap((r) => RBT_ACTIONS.map((a) => ({
    label: `${t}/${r}/${a}`, expect: rbtAllowed(t, r, a, widened),
    probe: probeSql("human_authority_decisions", ["human_authority_decisions_p3_17_role_by_type_check"], ["decision_type", "decided_by_role", "decision_action"], [["text", t], ["text", r], ["text", a]]),
  })))),
  snapshotRole: (widened) => ["gk_reviewer", "gk_admin", "client_admin", "client_reviewer", "client_contributor", "gk_operator"].map((r) => ({
    label: r, expect: ["gk_reviewer", "gk_admin"].includes(r) || (widened && r === "client_admin"),
    probe: probeSql("limitation_snapshots", ["limitation_snapshots_p3_16_confirmed_by_role_check"], ["confirmed_by_role"], [["text", r]]),
  })),
  sensitivityRole: () => ["gk_admin", "gk_operator", "gk_reviewer", "client_admin", "client_reviewer", "client_contributor"].map((r) => ({
    label: r, expect: ["gk_admin", "gk_operator", "gk_reviewer", "client_admin"].includes(r),
    probe: probeSql("intake_sensitivity_review_decisions", ["intake_sensitivity_review_decisions_b1a_02_role_check"], ["decided_by_role"], [["text", r]]),
  })),
  evidence: () => [
    ["dictionary_field_presence_fact", "organization_committed_metadata", true],
    ["source_record_count_measurement", "source_derived_aggregate", true],
    ["dictionary_field_presence_fact", "source_derived_aggregate", false],
    ["source_record_count_measurement", "organization_committed_metadata", false],
    ["source_value_statement", "source_derived_aggregate", false],
  ].map(([type, cls, ok]) => ({
    label: `${type}/${cls}`, expect: ok,
    probe: probeSql("evidence_items", ["evidence_items_p2_01_evidence_type_check", "evidence_items_p2_01_data_class_check", "evidence_items_p2_01m_type_class_pairing_check"], ["evidence_type", "data_class"], [["text", type], ["text", cls]]),
  })),
  locator: () => [
    ["column", "{\"column_name\": \"Program\"}", true],
    ["source_data_records", "{\"scope\": \"data_records_after_header\"}", true],
    ["source_data_records", "{\"column_name\": \"Program\"}", false],
    ["column", "{\"scope\": \"data_records_after_header\"}", false],
    ["source_data_records", "{\"scope\": \"all_rows\"}", false],
    ["row", "{\"scope\": \"data_records_after_header\"}", false],
  ].map(([type, coords, ok]) => ({
    label: `${type} ${coords}`, expect: ok,
    probe: probeSql("source_locators", ["source_locators_p2_01_locator_type_check", "source_locators_p2_01_coordinates_check"], ["locator_type", "coordinates"], [["text", type], ["jsonb", coords]]),
  })),
};
function matrixRow(seq, section, id, title, cases) {
  const results = cases.map((c) => `CASE WHEN ${c.probe} = ${lit(String(c.expect))} THEN NULL ELSE ${lit(`${c.label} expected ${c.expect ? "accepted" : "rejected"}`)} END`);
  return `SELECT ${seq}, ${lit(section)}, ${lit(id)},
         CASE WHEN m.bad IS NULL THEN 'PASS' ELSE 'FAIL' END,
         ${lit(`${cases.length} combinations: ${cases.filter((c) => c.expect).map((c) => c.label).join(", ")} accepted; all others rejected`)},
         CASE WHEN m.bad IS NULL THEN ${lit(`${cases.length}/${cases.length} combinations behave as expected`)} ELSE 'mismatched: ' || m.bad END,
         ${lit(title)}
    FROM (SELECT concat_ws('; ', ${results.join(",\n                                   ")}) AS raw) r
    CROSS JOIN LATERAL (SELECT nullif(r.raw, '') AS bad) m`;
}

// ------------------------------------------------------------- sections
function sectionA() {
  const ownedTables = ["evidence_items", "source_locators", "intake_sensitivity_review_decisions", "limitation_snapshots", "human_authority_decisions"];
  const referenced = ["source_versions", "evidence_items", "intake_file_profiles", "generated_content_drafts", "export_candidates"];
  return [
    `SELECT 101, 'A_ENVIRONMENT', 'A01', CASE WHEN to_regnamespace('kai') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
            'schema kai exists', coalesce(to_regnamespace('kai')::text, '(absent)'), 'Connected to the production database that holds the KAI schema'`,
    `SELECT 102, 'A_ENVIRONMENT', 'A02', CASE WHEN current_setting('server_version_num')::int >= 130000 THEN 'PASS' ELSE 'FAIL' END,
            'PostgreSQL 13 or later (built-in gen_random_uuid, used by 03)', version(), 'Server version (production version is otherwise not recorded in the repository)'`,
    `SELECT 103, 'A_ENVIRONMENT', 'A03', CASE WHEN x.missing IS NULL THEN 'PASS' ELSE 'FAIL' END,
            'current_user may ALTER (owns, or is a member of the owner role of) every table the migrations alter',
            'current_user=' || current_user || coalesce('; cannot alter: ' || x.missing, ''),
            'ALTER TABLE requires table ownership; without it the migration fails part-way and rolls back'
       FROM (SELECT string_agg(t, ', ') AS missing FROM unnest(ARRAY[${inList(ownedTables)}]) t
              WHERE to_regclass('kai.' || t) IS NULL
                 OR NOT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = to_regclass('kai.' || t)), 'MEMBER')) x`,
    `SELECT 104, 'A_ENVIRONMENT', 'A04', CASE WHEN has_schema_privilege('kai', 'CREATE') AND x.missing IS NULL THEN 'PASS' ELSE 'FAIL' END,
            'CREATE on schema kai; REFERENCES on every foreign-key target',
            'create_on_kai=' || has_schema_privilege('kai', 'CREATE')::text || coalesce('; no REFERENCES on: ' || x.missing, ''),
            'Needed by 01 and 03 (new tables with foreign keys) and 04 (new functions)'
       FROM (SELECT string_agg(t, ', ') AS missing FROM unnest(ARRAY[${inList(referenced)}]) t
              WHERE to_regclass('kai.' || t) IS NULL OR NOT has_table_privilege(to_regclass('kai.' || t), 'REFERENCES')) x`,
    `SELECT 105, 'A_ENVIRONMENT', 'A05', 'INFO',
            'any migration-history ledger relation (informational; none is defined in the repository)',
            coalesce((SELECT string_agg(n.nspname || '.' || c.relname, ', ' ORDER BY 1)
                        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE c.relkind IN ('r', 'p', 'v') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                         AND (c.relname ILIKE '%migrat%' OR c.relname ILIKE '%schema_version%' OR c.relname ILIKE '%flyway%' OR c.relname ILIKE 'knex%')), '(none found)'),
            'If a ledger is listed, send its name; this packet decides state from catalog objects, not from a ledger'`,
  ];
}

function sectionB(final) {
  const rows = [];
  rows.push(`SELECT 201, 'B_PREREQUISITES', 'B01', CASE WHEN x.missing IS NULL THEN 'PASS' ELSE 'FAIL' END,
            'foreign-key and trigger dependencies of the four migrations exist',
            coalesce('missing: ' || x.missing, 'all present'),
            'P2-01M needs unique (source_version_id, organization_id) on source_versions and evidence_items_p2_01_id_org_unique; P1 downstream needs the six-column intake_file_profiles key; release-authority reads content_type/requested_audience'
       FROM (SELECT string_agg(item, ', ') AS missing FROM (
         SELECT 'unique source_versions(source_version_id, organization_id)' AS item WHERE NOT EXISTS (
           SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('kai.source_versions') AND c.contype IN ('u', 'p')
              AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['organization_id', 'source_version_id'])
         UNION ALL SELECT 'evidence_items_p2_01_id_org_unique' WHERE NOT EXISTS (
           SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('kai.evidence_items') AND conname = 'evidence_items_p2_01_id_org_unique' AND contype = 'u')
         UNION ALL SELECT 'unique intake_file_profiles(file_profile_id, organization_id, intake_file_id, parser_name, parser_version, checksum)' WHERE NOT EXISTS (
           SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('kai.intake_file_profiles') AND c.contype IN ('u', 'p')
              AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey))
                  = ARRAY['checksum', 'file_profile_id', 'intake_file_id', 'organization_id', 'parser_name', 'parser_version'])
         UNION ALL SELECT 'limitation_snapshots_p3_16_confirmed_by_role_check' WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'limitation_snapshots_p3_16_confirmed_by_role_check')
         UNION ALL SELECT 'human_authority_decisions_p3_17_role_by_type_check' WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'human_authority_decisions_p3_17_role_by_type_check')
         UNION ALL SELECT 'kai.' || t || '.' || c FROM (VALUES ('generated_content_drafts', 'content_type'), ('generated_content_drafts', 'requested_audience'),
                ('generated_content_drafts', 'generated_content_draft_id'), ('export_candidates', 'content_type'), ('export_candidates', 'requested_audience'),
                ('export_candidates', 'export_candidate_id'), ('source_versions', 'is_current')) AS req(t, c)
          WHERE NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('kai.' || t) AND attname = c AND NOT attisdropped)
       ) m) x`);
  rows.push(`SELECT 202, 'B_PREREQUISITES', 'B02', CASE WHEN x.bad IS NULL THEN 'PASS' ELSE 'FAIL' END,
            ${lit(`${baselineFunctions.length} trigger/CHECK helper functions identical to the 2026-09-16 production capture`)},
            coalesce(x.bad, 'all identical'), 'Append-only, audience, lifecycle and metadata-only guards the workflow relies on'
       FROM (SELECT string_agg(e.name || CASE WHEN a.md5 IS NULL THEN ' missing' ELSE ' changed' END, ', ' ORDER BY e.name) AS bad
               FROM ${valuesBlock(baselineFunctions, ["name", "args", "md5"], "e")}
               LEFT JOIN (SELECT p.proname::text AS name, pg_get_function_identity_arguments(p.oid) AS args, ${NMD5("pg_get_functiondef(p.oid)")} AS md5
                            FROM pg_proc p WHERE p.pronamespace = 'kai'::regnamespace AND p.prokind = 'f') a ON a.name = e.name AND a.args = e.args
              WHERE a.md5 IS DISTINCT FROM e.md5) x`);
  CONTENT_TYPE_CONSTRAINTS.forEach(([table, name], i) => {
    const def = `(SELECT pg_get_constraintdef(oid, true) FROM pg_constraint WHERE conrelid = to_regclass('kai.${table}') AND conname = ${lit(name)})`;
    rows.push(`SELECT ${203 + i}, 'B_PREREQUISITES', ${lit(`B03.${i + 1}`)},
            CASE WHEN s.lits @> ARRAY[${inList(BASE_CONTENT_TYPES)}] AND s.lits <@ ARRAY[${inList(EXTENDED_CONTENT_TYPES)}] THEN 'PASS' ELSE 'FAIL' END,
            ${lit(`${name} admits evidence_summary (and the four P3 types); later P13 extensions are accepted`)},
            coalesce(array_to_string(s.lits, ','), '(absent)'),
            'Content types beyond the base four come from the optional P13 extension migrations, which this workflow does not need'
       FROM (SELECT ${literalsSql(def)} AS lits) s`);
  });
  rows.push(`SELECT 206, 'B_PREREQUISITES', 'B04', CASE WHEN x.missing IS NULL THEN 'PASS' ELSE 'FAIL' END,
            ${lit(`upload_lifecycle_audit operation vocabulary admits the ${REQUIRED_OPERATIONS.length} operations of the 2026-09-16 production capture`)},
            coalesce('missing: ' || x.missing, 'all admitted') || coalesce('; additional: ' || x.extra, ''),
            'Every intake, P1, sensitivity, evidence, claim, generation, factual-review and release step writes one of these operations'
       FROM (SELECT (SELECT string_agg(op, ', ' ORDER BY op) FROM unnest(ARRAY[${inList(REQUIRED_OPERATIONS)}]) op WHERE NOT op = ANY (s.lits)) AS missing,
                    (SELECT string_agg(op, ', ' ORDER BY op) FROM unnest(s.lits) op WHERE NOT op = ANY (ARRAY[${inList(REQUIRED_OPERATIONS)}])) AS extra
               FROM (SELECT ${literalsSql(`(SELECT pg_get_constraintdef(oid, true) FROM pg_constraint WHERE conrelid = to_regclass('kai.upload_lifecycle_audit') AND conname = '${OPERATION_CONSTRAINT}')`)} AS lits) s) x`);
  rows.push(`SELECT 207, 'B_PREREQUISITES', 'B05', CASE WHEN x.bad IS NULL THEN 'PASS' ELSE 'FAIL' END,
            ${lit(`${baselineEnums.length} enum types used by workflow columns keep every captured label`)},
            coalesce(x.bad, 'all labels present'), 'Production-legacy enum columns (for example review_queue_items.priority) must still accept the labels the application writes'
       FROM (SELECT string_agg(e.name || ' missing labels', ', ' ORDER BY e.name) AS bad
               FROM ${valuesBlock(baselineEnums, ["name", "labels"], "e")}
              WHERE NOT coalesce((SELECT array_agg(en.enumlabel::text) FROM pg_enum en JOIN pg_type t ON t.oid = en.enumtypid
                                   WHERE t.typnamespace = 'kai'::regnamespace AND t.typname = e.name), '{}') @> string_to_array(e.labels, ',')) x`);
  // Per-table exact comparison with the 2026-09-16 production capture.
  const tableRows = WORKFLOW_TABLES.map((table, i) => {
    const owned = PRODUCTION_OWNED_TABLES.includes(table);
    return `SELECT ${300 + i}, 'B_BASELINE', ${lit(`B_TABLE kai.${table}`)},
            CASE WHEN p.problems IS NULL THEN 'PASS' WHEN ${owned ? "true" : "false"} THEN 'WARN' ELSE 'FAIL' END,
            ${lit(`columns, constraints, unique indexes and triggers identical to the 2026-09-16 production capture${owned ? " (production-owned table)" : ""}`)},
            coalesce(p.problems, 'identical'),
            ${lit(owned ? "Production-owned: no packet migration touches it; a WARN is reported, not blocking" : final ? "Packet-owned objects are checked in section C" : "Any difference here means production changed after the last capture: STOP")}
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
            ), '') AS problems) p`;
  });
  return { rows: [...rows, ...tableRows] };
}

function baselineCtes() {
  const tables = inList(WORKFLOW_TABLES);
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
     AND t.tgname NOT IN (${inList(MIGRATION_OWNED_TRIGGERS)})),
actual_unique_indexes AS (
  SELECT tablename::text AS tbl, indexname::text AS name, ${NMD5("indexdef")} AS md5, ${N("indexdef")} AS def
    FROM pg_indexes WHERE schemaname = 'kai' AND tablename IN (${tables}) AND indexdef LIKE 'CREATE UNIQUE INDEX%')`;
}

// Section C: the four migrations' states. In the preflight each yields
// REQUIRED / ALREADY_APPLIED / STOP_INCOMPATIBLE.
function migrationStateRows() {
  const m01 = exactTableSql("intake_p1_downstream_attempts");
  const m03a = exactTableSql("source_measurement_definitions");
  const m03b = exactTableSql("evidence_measurements");
  const m03States = M03_CONSTRAINTS.map((c) => stateOf(c.table, c.name, c.base, c.target));
  const m04States = M04_CONSTRAINTS.map((c) => stateOf(c.table, c.name, c.base, c.target));
  const m04Objects = M04_OBJECTS.map(triggerStateSql);
  const allEq = (states, value) => states.map((s) => `${s} = '${value}'`).join(" AND ");
  return [
    `SELECT 401, 'C_MIGRATION_STATE', 'M01',
            CASE WHEN NOT ${m01.present} AND to_regclass('kai.ix_intake_p1_downstream_attempts_tenant_file') IS NULL THEN 'REQUIRED'
                 WHEN ${m01.present} AND ${m01.diff} IS NULL THEN 'ALREADY_APPLIED'
                 ELSE 'STOP_INCOMPATIBLE' END,
            '01 kai_sprint2_p1_downstream_recovery_state: kai.intake_p1_downstream_attempts absent (REQUIRED) or exactly as the migration creates it (ALREADY_APPLIED)',
            CASE WHEN ${m01.present} THEN coalesce(${m01.diff}, 'table present and identical') ELSE 'table absent' END,
            'P1 worker attempt budget and claim fence; the current application reads and writes it'`,
    `SELECT 402, 'C_MIGRATION_STATE', 'M02',
            CASE ${stateOf(M02.table, M02.name, M02.base, M02.target)} WHEN 'base' THEN 'REQUIRED' WHEN 'target' THEN 'ALREADY_APPLIED' ELSE 'STOP_INCOMPATIBLE' END,
            ${lit(`02 kai_sprint2_b1a_02_client_admin_sensitivity_review: role CHECK is either ${normalize(M02.base)} (REQUIRED) or ${normalize(M02.target)} (ALREADY_APPLIED)`)},
            ${constraintObservedSql(M02.table, M02.name)},
            'Lets an active organization administrator record the file sensitivity decision'`,
    `SELECT 403, 'C_MIGRATION_STATE', 'M03',
            CASE WHEN ${M03_CONSTRAINTS.map((c, i) => `${m03States[i]} = '${c.base ? "base" : "absent"}'`).join(" AND ")}
                      AND NOT ${m03a.present} AND NOT ${m03b.present} THEN 'REQUIRED'
                 WHEN ${allEq(m03States, "target")} AND ${m03a.present} AND ${m03b.present} AND ${m03a.diff} IS NULL AND ${m03b.diff} IS NULL THEN 'ALREADY_APPLIED'
                 ELSE 'STOP_INCOMPATIBLE' END,
            '03 kai_sprint2_p2_01m_source_record_count_measurement: five evidence/locator CHECKs at their original definitions and both tables absent (REQUIRED), or all at the migration result (ALREADY_APPLIED)',
            concat_ws('; ', ${M03_CONSTRAINTS.map((c, i) => `${lit(c.name)} || '=' || ${m03States[i]}`).join(", ")},
                      'source_measurement_definitions=' || CASE WHEN ${m03a.present} THEN coalesce(${m03a.diff}, 'identical') ELSE 'absent' END,
                      'evidence_measurements=' || CASE WHEN ${m03b.present} THEN coalesce(${m03b.diff}, 'identical') ELSE 'absent' END),
            'Governed record-count measurement evidence (P2-01M)'`,
    `SELECT 404, 'C_MIGRATION_STATE', 'M04',
            CASE WHEN ${allEq(m04States, "base")} AND ${allEq(m04Objects, "absent")} THEN 'REQUIRED'
                 WHEN ${allEq(m04States, "target")} AND ${allEq(m04Objects, "target")} THEN 'ALREADY_APPLIED'
                 ELSE 'STOP_INCOMPATIBLE' END,
            '04 kai_sprint2_plan_a_organization_internal_release_authority: both role CHECKs original and no scope triggers (REQUIRED), or both widened with both triggers and functions exactly as created (ALREADY_APPLIED)',
            concat_ws('; ', ${M04_CONSTRAINTS.map((c, i) => `${lit(c.name)} || '=' || ${m04States[i]}`).join(", ")},
                      ${M04_OBJECTS.map((o, i) => `${lit(`${o.trigger}+${o.fn}`)} || '=' || ${m04Objects[i]}`).join(", ")}),
            'Organization-owned final release of an ordinary internal Evidence Summary'`,
  ];
}

// Per-migration verification rows (verifiers 01V..04V and the final file).
function verifyRows(n, base) {
  const rows = [];
  const add = (id, condition, expectedText, observed, detail) => rows.push(`SELECT ${base + rows.length}, 'V${n}', ${lit(id)},
            CASE WHEN ${condition} THEN 'PASS' ELSE 'FAIL' END, ${lit(expectedText)}, ${observed}, ${lit(detail)}`);
  const exactConstraint = (id, table, name, detail) => add(id, `${constraintStateSql(table, name)} = ${lit(fingerprint(expectedDef(name)))}`,
    normalize(expectedDef(name)), constraintObservedSql(table, name), detail);
  const exactTable = (id, table, detail) => {
    const t = exactTableSql(table);
    add(id, `${t.present} AND ${t.diff} IS NULL`, `kai.${table} exists with exactly the migration's columns, constraints and indexes`,
      `CASE WHEN ${t.present} THEN coalesce(${t.diff}, 'identical') ELSE 'table absent' END`, detail);
  };
  if (n === "01") {
    exactTable("V01.1", "intake_p1_downstream_attempts", "16 columns, 9 constraints (incl. the profile foreign key and state/fact consistency CHECK), primary key and tenant/file index");
  }
  if (n === "02") {
    exactConstraint("V02.1", M02.table, M02.name, "Role CHECK admits client_admin in addition to the three GK roles");
    rows.push(matrixRow(base + rows.length, "V02", "V02.2", "Sensitivity-decision roles: client_admin and GK roles accepted; client_reviewer/client_contributor rejected", matrix.sensitivityRole()));
  }
  if (n === "03") {
    M03_CONSTRAINTS.forEach((c, i) => exactConstraint(`V03.${i + 1}`, c.table, c.name, "Measurement vocabulary widened; every original value still admitted"));
    exactTable("V03.6", "source_measurement_definitions", "Human-confirmed measurement definition per source version");
    exactTable("V03.7", "evidence_measurements", "Measured value bound 1:1 to its evidence item, definition, source version and P1 profile");
    rows.push(matrixRow(base + rows.length, "V03", "V03.8", "Evidence type/data class pairing", matrix.evidence()));
    rows.push(matrixRow(base + rows.length, "V03", "V03.9", "Locator type/coordinates pairing", matrix.locator()));
  }
  if (n === "04") {
    M04_CONSTRAINTS.forEach((c, i) => exactConstraint(`V04.${i + 1}`, c.table, c.name, i === 0 ? "Limitation snapshot may be confirmed by client_admin" : "client_admin admitted only as an export_authority_granted grant"));
    M04_OBJECTS.forEach((o, i) => add(`V04.${i + 3}`, `${triggerStateSql(o)} = 'target'`,
      `${o.trigger} BEFORE INSERT FOR EACH ROW, enabled, executing kai.${o.fn}() with the migration's exact body`,
      `${triggerStateSql(o)}`, o.table === "limitation_snapshots"
        ? "Pins a client_admin snapshot to an internal evidence_summary draft (SQLSTATE 23514 otherwise)"
        : "Pins a client_admin decision to an internal evidence_summary candidate (SQLSTATE 23514 otherwise)"));
    rows.push(matrixRow(base + rows.length, "V04", "V04.5", "Decision role/type/action: GK combinations preserved; client_admin only as export_authority_granted grant", matrix.roleByType(true)));
    rows.push(matrixRow(base + rows.length, "V04", "V04.6", "Limitation-snapshot confirming roles", matrix.snapshotRole(true)));
    const audience = production.functions.find((f) => f.name === "p3_17_enforce_decision_audience_compatibility");
    const auditTrigger = production.triggers.find((t) => t.name === "trg_p3_17_human_authority_decisions_audience_compatibility");
    add("V04.7", `EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'kai'::regnamespace AND p.proname = 'p3_17_enforce_decision_audience_compatibility'
                     AND ${NMD5("pg_get_functiondef(p.oid)")} = ${lit(fingerprint(audience.normalized_definition))})
               AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('kai.human_authority_decisions') AND t.tgname = 'trg_p3_17_human_authority_decisions_audience_compatibility'
                     AND ${NMD5("pg_get_triggerdef(t.oid, true)")} = ${lit(fingerprint(auditTrigger.definition))} AND t.tgenabled = 'O')`,
      "P3-17 audience trigger unchanged: funder_ready only on funder, public_ready only on public candidates", "'checked against the 2026-09-16 capture'",
      "client_admin funder_ready/public_ready remain refused by the role CHECK and this trigger");
  }
  return rows;
}

// --------------------------------------------------------------- writers
const header = (title, purpose, lines) => `-- KAI pgAdmin production migration packet: ${title}
-- READ-ONLY. One SELECT statement; it changes nothing and inserts nothing.
-- ${purpose}
${lines.map((line) => `-- ${line}`).join("\n")}
-- Generated by scripts/kai-sprint2-pgadmin-production-packet-build.js from
--   ${productionCapturePath} (owner pgAdmin capture, 2026-09-16) and
--   KAI_PGADMIN_PRODUCTION_MIGRATION_PACKET/support/expected_post_migration_catalog_pg16.json.
-- Run it in the pgAdmin Query Tool (Execute script, F5). Read the Data Output grid.
`;

const columns = "seq, section, check_id, status, expected, observed, detail";
function wrap(rows, ctes, overallSql) {
  return `WITH${ctes ? `\n${ctes},` : ""}
checks(${columns}) AS (
${rows.map((row) => `  ${row.replace(/\n/g, "\n  ")}`).join("\n  UNION ALL\n")}
)
SELECT ${columns} FROM checks
UNION ALL
${overallSql}
ORDER BY seq;
`;
}

const preflightOverall = `SELECT 999, 'OVERALL', 'OVERALL',
       CASE WHEN EXISTS (SELECT 1 FROM checks WHERE status IN ('FAIL', 'STOP_INCOMPATIBLE')) THEN 'STOP'
            WHEN EXISTS (SELECT 1 FROM checks WHERE status = 'REQUIRED') THEN 'READY'
            ELSE 'NOTHING_TO_RUN' END,
       'no FAIL or STOP_INCOMPATIBLE row; WARN rows are reported but do not block',
       CASE WHEN EXISTS (SELECT 1 FROM checks WHERE status IN ('FAIL', 'STOP_INCOMPATIBLE'))
            THEN 'blocking rows: ' || (SELECT string_agg(check_id, ', ' ORDER BY seq) FROM checks WHERE status IN ('FAIL', 'STOP_INCOMPATIBLE'))
            ELSE coalesce('run in order: ' || (SELECT string_agg(substr(check_id, 2), ', ' ORDER BY seq) FROM checks WHERE status = 'REQUIRED'), 'all four migrations already applied')
       END,
       CASE WHEN EXISTS (SELECT 1 FROM checks WHERE status IN ('FAIL', 'STOP_INCOMPATIBLE'))
            THEN 'STOP: run no migration. Export this whole grid as CSV and send it back.'
            WHEN EXISTS (SELECT 1 FROM checks WHERE status = 'REQUIRED')
            THEN 'Run only the listed NN_MIGRATION files, in that order, each followed by its NNV verifier (RUN_IN_PGADMIN.md).'
            ELSE 'Nothing to run. Run 99_FINAL_SCHEMA_VERIFICATION_READ_ONLY.sql.' END
       || coalesce(' WARN: ' || (SELECT string_agg(check_id, ', ' ORDER BY seq) FROM checks WHERE status = 'WARN'), '')`;
const passOverall = (what) => `SELECT 999, 'OVERALL', 'OVERALL',
       CASE WHEN EXISTS (SELECT 1 FROM checks WHERE status NOT IN ('PASS', 'INFO', 'WARN')) THEN 'FAIL' ELSE 'PASS' END,
       ${lit(`every row PASS (${what})`)},
       coalesce('failing rows: ' || (SELECT string_agg(check_id, ', ' ORDER BY seq) FROM checks WHERE status NOT IN ('PASS', 'INFO', 'WARN')), 'all rows PASS')
         || coalesce('; WARN: ' || (SELECT string_agg(check_id, ', ' ORDER BY seq) FROM checks WHERE status = 'WARN'), ''),
       CASE WHEN EXISTS (SELECT 1 FROM checks WHERE status NOT IN ('PASS', 'INFO', 'WARN'))
            THEN 'STOP. Do not run the next file. Export this grid as CSV and send it back.' ELSE 'Verified.' END`;

const files = {};
files["00_PRODUCTION_PREFLIGHT_READ_ONLY.sql"] = header("00 production preflight",
  "Decides, from the live catalog, which of the four migrations production needs.", [
    "Sections: A environment and privileges; B prerequisites and an exact comparison of every",
    "workflow table with the 2026-09-16 production capture; C the state of each packet migration",
    "(REQUIRED / ALREADY_APPLIED / STOP_INCOMPATIBLE). Last row OVERALL: READY (with the exact run",
    "order), NOTHING_TO_RUN, or STOP.",
  ]) + wrap([...sectionA(), ...sectionB(false).rows, ...migrationStateRows()], baselineCtes(), preflightOverall);
const verifierTitles = {
  "01": ["01V_VERIFY_AFTER_p1_downstream_recovery_state_READ_ONLY.sql", "01V verification after 01 (P1 downstream recovery state)"],
  "02": ["02V_VERIFY_AFTER_b1a_02_client_admin_sensitivity_review_READ_ONLY.sql", "02V verification after 02 (client_admin sensitivity review)"],
  "03": ["03V_VERIFY_AFTER_p2_01m_source_record_count_measurement_READ_ONLY.sql", "03V verification after 03 (P2-01M record-count measurement)"],
  "04": ["04V_VERIFY_AFTER_plan_a_organization_internal_release_authority_READ_ONLY.sql", "04V verification after 04 (organization internal release authority)"],
};
for (const [n, [file, title]] of Object.entries(verifierTitles)) {
  files[file] = header(title, "Proves the migration produced exactly its intended objects; role and vocabulary rules are", [
    "evaluated by running the live CHECK expressions against literal values (query_to_xml), not by",
    "inserting rows. Last row OVERALL must be PASS before the next step.",
  ]) + wrap(verifyRows(n, 100), null, passOverall(`migration ${n} verified`));
}
files["99_FINAL_SCHEMA_VERIFICATION_READ_ONLY.sql"] = header("99 final schema verification",
  "The intended final structure: all four migrations verified, every workflow table unchanged", [
    "from the 2026-09-16 capture except the packet's own objects, audit vocabulary, helper functions,",
    "GK decision combinations preserved and prohibited role/decision combinations rejected.",
  ]) + wrap([
    ...sectionA().slice(0, 2),
    ...sectionB(true).rows,
    ...["01", "02", "03", "04"].flatMap((n, i) => verifyRows(n, 500 + i * 20)),
  ], baselineCtes(), passOverall("final schema verified"));

// Rollback precheck: counts only (no row content).
const guardedCount = (table, where) => `(CASE WHEN to_regclass('kai.${table}') IS NULL THEN NULL
      ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM kai.${table}${where ? ` WHERE ${where.replace(/'/g, "''")}` : ""}', true, true, '')))[1]::text::bigint END)`;
files["RP_ROLLBACK_PRECHECK_READ_ONLY.sql"] = header("RP rollback precheck",
  "Run before any rollback file. Reports counts only (no row contents) and whether each rollback is safe.", [
    "A rollback is never needed after a migration whose verifier PASSED unless the application rollout is",
    "abandoned. Roll back in reverse order (R04, R03, R02, R01), only for migrations actually applied.",
  ]) + wrap([
    `SELECT 101, 'RP', 'R04',
            CASE WHEN coalesce(s.n, 0) + coalesce(d.n, 0) = 0 THEN 'SAFE_TO_ROLL_BACK' ELSE 'UNSAFE_ROLLBACK_REFUSES' END,
            'no client_admin limitation snapshot and no client_admin final-release decision',
            'client_admin snapshots=' || coalesce(s.n::text, 'n/a') || '; client_admin decisions=' || coalesce(d.n::text, 'n/a'),
            'R04 raises "rollback refused: client_admin release decisions exist" and changes nothing. Never delete organization decisions to force it.'
       FROM (SELECT ${guardedCount("limitation_snapshots", "confirmed_by_role = 'client_admin'")} AS n) s,
            (SELECT ${guardedCount("human_authority_decisions", "decided_by_role = 'client_admin'")} AS n) d`,
    `SELECT 102, 'RP', 'R03',
            CASE WHEN coalesce(e.n, 0) + coalesce(l.n, 0) + coalesce(m.n, 0) + coalesce(f.n, 0) = 0 THEN 'SAFE_TO_ROLL_BACK' ELSE 'UNSAFE_ROLLBACK_REFUSES' END,
            'no measurement evidence, record locator, measurement or measurement definition',
            'measurement evidence=' || coalesce(e.n::text, 'n/a') || '; record locators=' || coalesce(l.n::text, 'n/a')
              || '; evidence_measurements=' || coalesce(m.n::text, 'table absent') || '; source_measurement_definitions=' || coalesce(f.n::text, 'table absent'),
            'R03 refuses while measurement evidence or locators exist; it drops both P2-01M tables (definitions included) otherwise.'
       FROM (SELECT ${guardedCount("evidence_items", "evidence_type = 'source_record_count_measurement'")} AS n) e,
            (SELECT ${guardedCount("source_locators", "locator_type = 'source_data_records'")} AS n) l,
            (SELECT ${guardedCount("evidence_measurements", null)} AS n) m,
            (SELECT ${guardedCount("source_measurement_definitions", null)} AS n) f`,
    `SELECT 103, 'RP', 'R02',
            CASE WHEN coalesce(c.n, 0) = 0 THEN 'SAFE_TO_ROLL_BACK' ELSE 'UNSAFE_ROLLBACK_FAILS' END,
            'no client_admin sensitivity decision',
            'client_admin sensitivity decisions=' || coalesce(c.n::text, 'n/a'),
            'R02 has no guard: with client_admin decisions present its re-added CHECK fails validation, the transaction aborts and nothing changes (run ROLLBACK; in pgAdmin).'
       FROM (SELECT ${guardedCount("intake_sensitivity_review_decisions", "decided_by_role = 'client_admin'")} AS n) c`,
    `SELECT 104, 'RP', 'R01',
            CASE WHEN a.n IS NULL THEN 'NOT_APPLIED' WHEN a.n = 0 THEN 'SAFE_TO_ROLL_BACK' ELSE 'DESTRUCTIVE_APP_ROLLBACK_FIRST' END,
            'no P1 downstream attempt rows, and the application already rolled back to a revision that does not use the table',
            'intake_p1_downstream_attempts rows=' || coalesce(a.n::text, 'table absent'),
            'R01 drops the table and its attempt budgets. Run it only after the application no longer references the table.'
       FROM (SELECT ${guardedCount("intake_p1_downstream_attempts", null)} AS n) a`,
  ], null, `SELECT 999, 'OVERALL', 'OVERALL', 'INFO', 'see each R row', 'counts only', 'Roll back in reverse order, only what was applied, only when its row is SAFE_TO_ROLL_BACK.'`);

for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(packetDir, name), content.replace(/[ \t]+$/gm, ""));
  console.log(`wrote ${name} (${content.length} bytes)`);
}
console.log(`baseline: ${baselineConstraints.length} constraints, ${baselineColumns.length} columns, ${baselineTriggers.length} triggers, ${baselineUniqueIndexes.length} unique indexes, ${baselineFunctions.length} functions, ${baselineEnums.length} enums; ${REQUIRED_OPERATIONS.length} audit operations`);
