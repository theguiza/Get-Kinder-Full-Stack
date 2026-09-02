import test, { after } from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_B1_3_ACCEPTED_CATALOGUE_PERSISTENCE_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`B1.3 accepted-catalogue-persistence integration suite refused a non-loopback runner-owned URL host: ${host}`);
  }
}

test("B1.3 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("B1.3 integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runIntegrationSuite();
}

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

async function runIntegrationSuite() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false });
  after(async () => {
    await pool.end();
  });

  async function sourceRow() {
    return pool.query(
      "SELECT requirement_source_id FROM kai.requirement_sources WHERE source_type = 'kai_standard' AND source_code = 'kai_baseline_impact_requirements'",
    );
  }

  async function frameworkVersionRow(sourceId) {
    return pool.query(
      "SELECT requirement_framework_version_id, framework_status FROM kai.requirement_framework_versions WHERE requirement_source_id = $1 AND framework_code = 'kai_baseline_impact_v1' AND version_label = 'v1'",
      [sourceId],
    );
  }

  test("requirement_sources contains exactly one row matching the accepted identity", async () => {
    const { rows } = await sourceRow();
    assert.equal(rows.length, 1);
  });

  test("requirement_framework_versions contains exactly one kai_baseline_impact_v1/v1 row, with framework_status = draft", async () => {
    const source = (await sourceRow()).rows[0];
    const { rows } = await frameworkVersionRow(source.requirement_source_id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].framework_status, "draft");
  });

  test("requirement_sets contains exactly the 10 accepted set keys, each exactly once, under this framework version", async () => {
    const source = (await sourceRow()).rows[0];
    const fv = (await frameworkVersionRow(source.requirement_source_id)).rows[0];
    const { rows } = await pool.query(
      "SELECT set_key, set_name FROM kai.requirement_sets WHERE requirement_framework_version_id = $1",
      [fv.requirement_framework_version_id],
    );
    assert.equal(rows.length, 10);
    assert.deepEqual(
      rows.map((r) => r.set_key).sort(),
      [...SET_ORDER].sort(),
    );
  });

  test("requirements contains exactly the 21 accepted requirement keys, each exactly once, each attached to its expected set", async () => {
    const source = (await sourceRow()).rows[0];
    const fv = (await frameworkVersionRow(source.requirement_source_id)).rows[0];
    const { rows: sets } = await pool.query(
      "SELECT requirement_set_id, set_key FROM kai.requirement_sets WHERE requirement_framework_version_id = $1",
      [fv.requirement_framework_version_id],
    );
    const setIdToKey = new Map(sets.map((s) => [s.requirement_set_id, s.set_key]));

    const { rows: requirements } = await pool.query(
      "SELECT requirement_set_id, requirement_key, display_order FROM kai.requirements WHERE requirement_set_id = ANY($1)",
      [sets.map((s) => s.requirement_set_id)],
    );
    assert.equal(requirements.length, 21);

    const allKeys = SET_ORDER.flatMap((k) => MEMBERSHIP[k]);
    assert.deepEqual(
      requirements.map((r) => r.requirement_key).sort(),
      [...allKeys].sort(),
    );

    for (const setKey of SET_ORDER) {
      const expected = MEMBERSHIP[setKey];
      const actual = requirements
        .filter((r) => setIdToKey.get(r.requirement_set_id) === setKey)
        .sort((a, b) => a.display_order - b.display_order)
        .map((r) => r.requirement_key);
      assert.deepEqual(actual, expected, `set ${setKey} must contain exactly its accepted requirement keys`);
    }

    const orders = requirements.map((r) => r.display_order).sort((a, b) => a - b);
    assert.deepEqual(orders, Array.from({ length: 21 }, (_, i) => i));
  });

  test("no engagement_requirement_sets row was added by this package", async () => {
    const { rows } = await pool.query("SELECT count(*)::int AS count FROM kai.engagement_requirement_sets");
    assert.equal(rows[0].count, 0);
  });

  test("rerunning the forward migration converges without duplicates", async () => {
    const { readFileSync } = await import("node:fs");
    const migrationSql = readFileSync("migrations/kai_sprint2_b1_3_accepted_catalogue_persistence.sql", "utf8");
    await pool.query(migrationSql);

    const source = (await sourceRow()).rows;
    assert.equal(source.length, 1);
    const fv = (await frameworkVersionRow(source[0].requirement_source_id)).rows;
    assert.equal(fv.length, 1);
    const { rows: sets } = await pool.query(
      "SELECT requirement_set_id FROM kai.requirement_sets WHERE requirement_framework_version_id = $1",
      [fv[0].requirement_framework_version_id],
    );
    assert.equal(sets.length, 10);
    const { rows: reqs } = await pool.query(
      "SELECT requirement_id FROM kai.requirements WHERE requirement_set_id = ANY($1)",
      [sets.map((s) => s.requirement_set_id)],
    );
    assert.equal(reqs.length, 21);
  });

  async function catalogueCounts() {
    const { rows } = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM kai.requirement_sources WHERE source_type = 'kai_standard' AND source_code = 'kai_baseline_impact_requirements') AS sources,
        (SELECT count(*)::int FROM kai.requirement_framework_versions WHERE framework_code = 'kai_baseline_impact_v1' AND version_label = 'v1') AS framework_versions,
        (SELECT count(*)::int FROM kai.requirement_sets) AS sets,
        (SELECT count(*)::int FROM kai.requirements) AS requirements
    `);
    return rows[0];
  }

  async function runMigration() {
    const { readFileSync } = await import("node:fs");
    const migrationSql = readFileSync("migrations/kai_sprint2_b1_3_accepted_catalogue_persistence.sql", "utf8");
    return pool.query(migrationSql);
  }

  test("canonical drift safety: conflicting framework_name fails closed and leaves no partial catalogue change", async () => {
    const before = await catalogueCounts();
    await pool.query(
      "UPDATE kai.requirement_framework_versions SET framework_name = 'Tampered Name' WHERE framework_code = 'kai_baseline_impact_v1' AND version_label = 'v1'",
    );
    await assert.rejects(runMigration(), /B1\.3 canonical drift/);
    const after = await catalogueCounts();
    assert.deepEqual(after, before);
    await pool.query(
      "UPDATE kai.requirement_framework_versions SET framework_name = 'KAI Baseline Impact Requirements' WHERE framework_code = 'kai_baseline_impact_v1' AND version_label = 'v1'",
    );
  });

  test("canonical drift safety: conflicting set_name fails closed and leaves no partial catalogue change", async () => {
    const before = await catalogueCounts();
    await pool.query("UPDATE kai.requirement_sets SET set_name = 'Tampered Set Name' WHERE set_key = 'outcomes'");
    await assert.rejects(runMigration(), /B1\.3 canonical drift/);
    const after = await catalogueCounts();
    assert.deepEqual(after, before);
    await pool.query("UPDATE kai.requirement_sets SET set_name = 'Outcomes' WHERE set_key = 'outcomes'");
  });

  test("canonical drift safety: conflicting requirement_label fails closed and leaves no partial catalogue change", async () => {
    const before = await catalogueCounts();
    await pool.query(
      "UPDATE kai.requirements SET requirement_label = 'Tampered Label' WHERE requirement_key = 'ir_comm_002'",
    );
    await assert.rejects(runMigration(), /B1\.3 canonical drift/);
    const after = await catalogueCounts();
    assert.deepEqual(after, before);
    await pool.query(
      "UPDATE kai.requirements SET requirement_label = 'A reported result can be traced back to who is accountable for its accuracy' WHERE requirement_key = 'ir_comm_002'",
    );
  });

  test("canonical drift safety: conflicting requirement_description fails closed and leaves no partial catalogue change", async () => {
    const before = await catalogueCounts();
    await pool.query(
      "UPDATE kai.requirements SET requirement_description = 'Tampered description.' WHERE requirement_key = 'ir_data_001'",
    );
    await assert.rejects(runMigration(), /B1\.3 canonical drift/);
    const after = await catalogueCounts();
    assert.deepEqual(after, before);
    await pool.query(
      "UPDATE kai.requirements SET requirement_description = 'Each piece of data supporting a claim can be traced to a specific, classified source with a known review/promotion status.' WHERE requirement_key = 'ir_data_001'",
    );
  });

  test("canonical drift safety: conflicting display_order fails closed and leaves no partial catalogue change", async () => {
    const before = await catalogueCounts();
    await pool.query("UPDATE kai.requirements SET display_order = 99 WHERE requirement_key = 'ir_pur_001'");
    await assert.rejects(runMigration(), /B1\.3 canonical drift/);
    const after = await catalogueCounts();
    assert.deepEqual(after, before);
    await pool.query("UPDATE kai.requirements SET display_order = 0 WHERE requirement_key = 'ir_pur_001'");
  });

  test("canonical drift safety: a compatible partial hierarchy converges to 1 source / 1 framework / 10 sets / 21 requirements", async () => {
    await pool.query("DELETE FROM kai.requirements");
    await pool.query("DELETE FROM kai.requirement_sets");
    await pool.query("DELETE FROM kai.requirement_framework_versions");
    await pool.query("DELETE FROM kai.requirement_sources");
    await pool.query(`
      DO $$
      DECLARE
        v_source_id uuid;
        v_fv_id uuid;
        v_set_id uuid;
      BEGIN
        INSERT INTO kai.requirement_sources (source_type, source_code, source_name)
        VALUES ('kai_standard', 'kai_baseline_impact_requirements', 'KAI Baseline Impact Requirements')
        RETURNING requirement_source_id INTO v_source_id;

        INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label, framework_status)
        VALUES (v_source_id, 'kai_baseline_impact_v1', 'KAI Baseline Impact Requirements', 'v1', 'draft')
        RETURNING requirement_framework_version_id INTO v_fv_id;

        INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
        VALUES (v_fv_id, 'purpose_intended_change', 'Purpose & Intended Change')
        RETURNING requirement_set_id INTO v_set_id;

        INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
        VALUES (v_set_id, 'ir_pur_001', 'Intended outcome is explicitly defined', 'For each impact claim scope, the organization has articulated, in an explicit statement, the specific change it intends to create — distinct from the activities or outputs it delivers.', 0);
      END $$;
    `);
    await runMigration();
    const counts = await catalogueCounts();
    assert.deepEqual(counts, { sources: 1, framework_versions: 1, sets: 10, requirements: 21 });
  });
}
