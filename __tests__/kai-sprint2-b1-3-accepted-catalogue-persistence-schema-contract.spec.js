import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_b1_3_accepted_catalogue_persistence.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_b1_3_accepted_catalogue_persistence.rollback.sql", "utf8");
const canonicalSource = readFileSync(
  "docs/kai/catalogues/KAI_B1_2_BASELINE_IMPACT_REQUIREMENTS_CATALOGUE_V1_ACCEPTED.md",
  "utf8",
);

const SET_ORDER = [
  "purpose_intended_change",
  "program_delivery",
  "stakeholders",
  "outcomes",
  "indicators",
  "data_evidence",
  "performance_impact",
  "contribution_limitations_risk",
  "learning_improvement",
  "communication_accountability",
];

const MEMBERSHIP = {
  purpose_intended_change: ["ir_pur_001", "ir_pur_002"],
  program_delivery: ["ir_prog_001", "ir_prog_002"],
  stakeholders: ["ir_stk_001"],
  outcomes: ["ir_out_001", "ir_out_002"],
  indicators: ["ir_ind_001", "ir_ind_002"],
  data_evidence: ["ir_data_001", "ir_data_002", "ir_data_003"],
  performance_impact: ["ir_perf_001", "ir_perf_002"],
  contribution_limitations_risk: ["ir_contrib_001", "ir_contrib_002", "ir_contrib_003"],
  learning_improvement: ["ir_learn_001", "ir_learn_002"],
  communication_accountability: ["ir_comm_001", "ir_comm_002"],
};

const ALL_REQUIREMENT_KEYS = SET_ORDER.flatMap((setKey) => MEMBERSHIP[setKey]);

function extractCanonicalRequirements(source) {
  const reqRegex = /### (ir_\w+)\n\n- \*\*requirement_label:\*\* (.+)\n- \*\*requirement_description:\*\* (.+)\n/g;
  const requirements = {};
  let m;
  while ((m = reqRegex.exec(source)) !== null) {
    requirements[m[1]] = { label: m[2].trim(), description: m[3].trim() };
  }
  return requirements;
}

function sqlLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

const canonicalRequirements = extractCanonicalRequirements(canonicalSource);

test("canonical artefact contains exactly the 21 accepted requirement keys with a label and description each", () => {
  assert.deepEqual(Object.keys(canonicalRequirements).sort(), [...ALL_REQUIREMENT_KEYS].sort());
});

test("B1.3 migration is wrapped in a transaction and guards on the four B1.1 tables existing", () => {
  assert.match(migrationSource, /^BEGIN;/);
  assert.match(migrationSource, /COMMIT;\s*$/);
  for (const table of ["requirement_sources", "requirement_framework_versions", "requirement_sets", "requirements"]) {
    assert.match(migrationSource, new RegExp(`RAISE EXCEPTION 'kai\\.${table} is required`));
  }
});

test("B1.3 migration creates no table and no column", () => {
  assert.doesNotMatch(migrationSource, /CREATE TABLE/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE/);
});

test("B1.3 migration never writes to kai.engagement_requirement_sets", () => {
  assert.doesNotMatch(migrationSource, /INTO kai\.engagement_requirement_sets/);
});

test("B1.3 migration persists the fixed identity: kai_standard/kai_baseline_impact_requirements, kai_baseline_impact_v1/v1, draft", () => {
  assert.match(migrationSource, /'kai_standard',\s*'kai_baseline_impact_requirements'/);
  assert.match(migrationSource, /'kai_baseline_impact_v1',\s*'[^']*',\s*'v1',\s*'draft'/);
  assert.doesNotMatch(migrationSource, /'active'/);
});

test("B1.3 migration inserts exactly the 10 accepted set keys, each guarded by a canonical-drift existing-row lookup", () => {
  for (const setKey of SET_ORDER) {
    const pattern = new RegExp(
      `SELECT set_name INTO v_existing_text FROM kai\\.requirement_sets[\\s\\S]*?set_key = '${setKey}';[\\s\\S]*?IF v_existing_text IS NULL THEN[\\s\\S]*?VALUES \\(v_framework_version_id, '${setKey}',[\\s\\S]*?ELSIF v_existing_text IS DISTINCT FROM[\\s\\S]*?RAISE EXCEPTION 'B1\\.3 canonical drift`,
    );
    assert.match(migrationSource, pattern, `expected drift-guarded insert for set ${setKey}`);
  }
  const setKeyMatches = [...migrationSource.matchAll(/VALUES \(v_framework_version_id, '([a-z_]+)',/g)].map((m) => m[1]);
  assert.deepEqual(setKeyMatches.sort(), [...SET_ORDER].sort());
});

test("B1.3 migration inserts exactly the 21 accepted requirement keys, each attached to its expected set, guarded by a canonical-drift existing-row lookup", () => {
  const requirementInsertRegex =
    /VALUES \(v_set_id, '(ir_\w+)', '((?:[^']|'')*)', '((?:[^']|'')*)', (\d+)\);/g;
  const found = [];
  let m;
  while ((m = requirementInsertRegex.exec(migrationSource)) !== null) {
    found.push({
      key: m[1],
      label: m[2].replace(/''/g, "'"),
      description: m[3].replace(/''/g, "'"),
      displayOrder: Number(m[4]),
    });
  }
  assert.equal(found.length, 21, "expected exactly 21 guarded requirement inserts");
  assert.deepEqual(
    found.map((f) => f.key).sort(),
    [...ALL_REQUIREMENT_KEYS].sort(),
  );

  for (const f of found) {
    const canonical = canonicalRequirements[f.key];
    assert.ok(canonical, `unexpected requirement key ${f.key} not in canonical artefact`);
    assert.equal(f.label, canonical.label, `label mismatch for ${f.key}`);
    assert.equal(f.description, canonical.description, `description mismatch for ${f.key}`);
  }

  const expectedOrder = ALL_REQUIREMENT_KEYS;
  const actualOrderedKeys = [...found].sort((a, b) => a.displayOrder - b.displayOrder).map((f) => f.key);
  assert.deepEqual(actualOrderedKeys, expectedOrder, "display_order must preserve canonical domain and requirement order");

  const orders = found.map((f) => f.displayOrder).sort((a, b) => a - b);
  assert.deepEqual(orders, Array.from({ length: 21 }, (_, i) => i), "display_order must be the contiguous sequence 0-20");
});

test("B1.3 migration attaches every requirement to its accepted set via the same v_set_id in its enclosing block", () => {
  for (const setKey of SET_ORDER) {
    const setBlockRegex = new RegExp(`-- ${setKey}\\n[\\s\\S]*?(?=\\n\\s*-- |END \\$\\$;)`);
    const block = migrationSource.match(setBlockRegex);
    assert.ok(block, `expected a block for set ${setKey}`);
    const keysInBlock = [...block[0].matchAll(/VALUES \(v_set_id, '(ir_\w+)'/g)].map((m) => m[1]);
    assert.deepEqual(keysInBlock, MEMBERSHIP[setKey], `set ${setKey} must contain exactly its accepted requirement keys in order`);
  }
});

test("B1.3 migration fails closed (RAISE EXCEPTION) on conflicting B1.3-owned fields at every persisted level", () => {
  assert.match(migrationSource, /RAISE EXCEPTION 'B1\.3 canonical drift: kai\.requirement_sources/);
  assert.match(migrationSource, /RAISE EXCEPTION 'B1\.3 canonical drift: kai\.requirement_framework_versions/);
  assert.match(migrationSource, /RAISE EXCEPTION 'B1\.3 canonical drift: kai\.requirement_sets/);
  const requirementDriftExceptions = [
    ...migrationSource.matchAll(/RAISE EXCEPTION 'B1\.3 canonical drift: kai\.requirements \(requirement_set_id=%, requirement_key=(ir_\w+)\)/g),
  ].map((m) => m[1]);
  assert.deepEqual(requirementDriftExceptions.sort(), [...ALL_REQUIREMENT_KEYS].sort());
});

test("labels and descriptions embedded in the migration are exact SQL-escaped copies of the canonical artefact", () => {
  for (const key of ALL_REQUIREMENT_KEYS) {
    const canonical = canonicalRequirements[key];
    assert.ok(migrationSource.includes(sqlLiteral(canonical.label)), `expected exact escaped label literal for ${key}`);
    assert.ok(
      migrationSource.includes(sqlLiteral(canonical.description)),
      `expected exact escaped description literal for ${key}`,
    );
  }
});

test("B1.3 rollback is transactional, deletes rows only (no DROP), scoped to the accepted identity, in dependency-safe order", () => {
  assert.match(rollbackSource, /^BEGIN;/);
  assert.match(rollbackSource, /COMMIT;\s*$/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE/);
  assert.doesNotMatch(rollbackSource, /DROP INDEX/);
  assert.doesNotMatch(rollbackSource, /kai\.organizations\b/);
  assert.doesNotMatch(rollbackSource, /kai\.engagements\b/);

  const order = [
    "DELETE FROM kai.requirements",
    "DELETE FROM kai.requirement_sets",
    "DELETE FROM kai.requirement_framework_versions",
    "DELETE FROM kai.requirement_sources",
  ].map((stmt) => rollbackSource.indexOf(stmt));
  assert.ok(order.every((i) => i >= 0), "expected all four DELETE statements");
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i - 1] < order[i], "children must be deleted before the parents they reference");
  }

  assert.match(rollbackSource, /kai_baseline_impact_requirements/);
  assert.match(rollbackSource, /kai_baseline_impact_v1/);
});
