import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_B1_1_BASELINE_IMPACT_REQUIREMENTS_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`B1.1 baseline-impact-requirements integration suite refused a non-loopback runner-owned URL host: ${host}`);
  }
}

test("B1.1 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("B1.1 integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runIntegrationSuite();
}

async function runIntegrationSuite() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false });
  after(async () => {
    await pool.end();
  });

  let orgA;
  let orgB;
  let engagementA;
  let engagementB;

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE kai.engagement_requirement_sets, kai.requirements, kai.requirement_sets, kai.requirement_framework_versions, kai.requirement_sources RESTART IDENTITY CASCADE",
    );
    await pool.query("TRUNCATE kai.engagements, kai.organizations RESTART IDENTITY CASCADE");

    const orgs = await pool.query(
      "INSERT INTO kai.organizations (name) VALUES ('Org A'), ('Org B') RETURNING organization_id",
    );
    [orgA, orgB] = orgs.rows.map((r) => r.organization_id);

    const engagements = await pool.query(
      "INSERT INTO kai.engagements (organization_id, engagement_code) VALUES ($1, 'eng-a'), ($2, 'eng-b') RETURNING engagement_id",
      [orgA, orgB],
    );
    [engagementA, engagementB] = engagements.rows.map((r) => r.engagement_id);
  });

  async function insertSharedSource(sourceType, sourceCode, sourceName = "Shared Source") {
    return pool.query(
      "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ($1, $2, $3) RETURNING requirement_source_id",
      [sourceType, sourceCode, sourceName],
    );
  }

  async function insertOrgSource(organizationId, sourceCode, sourceName = "Org Source") {
    return pool.query(
      "INSERT INTO kai.requirement_sources (source_type, source_code, source_name, organization_id) VALUES ('organization', $1, $2, $3) RETURNING requirement_source_id",
      [sourceCode, sourceName, organizationId],
    );
  }

  test("forward migration produced all five canonical B1.1 tables", async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'kai' AND table_name IN
       ('requirement_sources', 'requirement_framework_versions', 'requirement_sets', 'requirements', 'engagement_requirement_sets')`,
    );
    assert.deepEqual(
      rows.map((r) => r.table_name).sort(),
      ["engagement_requirement_sets", "requirement_framework_versions", "requirement_sets", "requirement_sources", "requirements"].sort(),
    );
  });

  test("a valid shared source succeeds and a valid organization source succeeds", async () => {
    const shared = await insertSharedSource("kai_standard", "kai_baseline");
    assert.ok(shared.rows[0].requirement_source_id);
    const org = await insertOrgSource(orgA, "acme_local");
    assert.ok(org.rows[0].requirement_source_id);
  });

  test("an organization source without organization_id fails", async () => {
    await assert.rejects(
      pool.query("INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('organization', 'no_org', 'x')"),
    );
  });

  test("a shared source with organization_id fails", async () => {
    await assert.rejects(
      pool.query(
        "INSERT INTO kai.requirement_sources (source_type, source_code, source_name, organization_id) VALUES ('kai_standard', 'bad', 'x', $1)",
        [orgA],
      ),
    );
  });

  test("duplicate shared identity fails", async () => {
    await insertSharedSource("funder", "dup_shared");
    await assert.rejects(insertSharedSource("funder", "dup_shared"));
  });

  test("duplicate org-local identity within one org fails, but the same org-local source_code in two different organizations succeeds", async () => {
    await insertOrgSource(orgA, "shared_code");
    await assert.rejects(insertOrgSource(orgA, "shared_code"));
    const secondOrg = await insertOrgSource(orgB, "shared_code");
    assert.ok(secondOrg.rows[0].requirement_source_id);
  });

  test("duplicate framework source/code/version fails and invalid framework status fails", async () => {
    const source = (await insertSharedSource("kai_standard", "fw_source")).rows[0].requirement_source_id;
    await pool.query(
      "INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label) VALUES ($1, 'fw_code', 'Framework', 'v1')",
      [source],
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label) VALUES ($1, 'fw_code', 'Framework', 'v1')",
        [source],
      ),
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label, framework_status) VALUES ($1, 'fw_code', 'Framework', 'v2', 'bogus')",
        [source],
      ),
    );
  });

  test("duplicate set_key within a framework version fails, and the same set_key across different framework versions succeeds", async () => {
    const source = (await insertSharedSource("kai_standard", "set_source")).rows[0].requirement_source_id;
    const fv1 = (
      await pool.query(
        "INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label) VALUES ($1, 'fw1', 'Framework 1', 'v1') RETURNING requirement_framework_version_id",
        [source],
      )
    ).rows[0].requirement_framework_version_id;
    const fv2 = (
      await pool.query(
        "INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label) VALUES ($1, 'fw2', 'Framework 2', 'v1') RETURNING requirement_framework_version_id",
        [source],
      )
    ).rows[0].requirement_framework_version_id;

    await pool.query(
      "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, 'core', 'Core Set')",
      [fv1],
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, 'core', 'Core Set Dup')",
        [fv1],
      ),
    );
    const otherVersion = await pool.query(
      "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, 'core', 'Core Set Other Version') RETURNING requirement_set_id",
      [fv2],
    );
    assert.ok(otherVersion.rows[0].requirement_set_id);
  });

  test("duplicate requirement_key within a set fails, and the same requirement_key across different sets succeeds", async () => {
    const source = (await insertSharedSource("kai_standard", "req_source")).rows[0].requirement_source_id;
    const fv = (
      await pool.query(
        "INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label) VALUES ($1, 'fw', 'Framework', 'v1') RETURNING requirement_framework_version_id",
        [source],
      )
    ).rows[0].requirement_framework_version_id;
    const set1 = (
      await pool.query(
        "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, 'set1', 'Set 1') RETURNING requirement_set_id",
        [fv],
      )
    ).rows[0].requirement_set_id;
    const set2 = (
      await pool.query(
        "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, 'set2', 'Set 2') RETURNING requirement_set_id",
        [fv],
      )
    ).rows[0].requirement_set_id;

    await pool.query(
      "INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, display_order) VALUES ($1, 'req_one', 'Requirement One', 0)",
      [set1],
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, display_order) VALUES ($1, 'req_one', 'Requirement One Dup', 1)",
        [set1],
      ),
    );
    const otherSet = await pool.query(
      "INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, display_order) VALUES ($1, 'req_one', 'Requirement One Other Set', 0) RETURNING requirement_id",
      [set2],
    );
    assert.ok(otherSet.rows[0].requirement_id);
  });

  async function makeRequirementSet() {
    const source = (await insertSharedSource("kai_standard", `src_${Math.random().toString(36).slice(2)}`)).rows[0]
      .requirement_source_id;
    const fv = (
      await pool.query(
        "INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label) VALUES ($1, 'fw', 'Framework', 'v1') RETURNING requirement_framework_version_id",
        [source],
      )
    ).rows[0].requirement_framework_version_id;
    return (
      await pool.query(
        "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, 'set', 'Set') RETURNING requirement_set_id",
        [fv],
      )
    ).rows[0].requirement_set_id;
  }

  test("invalid applicability status fails and same-tenant engagement applicability succeeds", async () => {
    const set = await makeRequirementSet();
    await assert.rejects(
      pool.query(
        "INSERT INTO kai.engagement_requirement_sets (organization_id, engagement_id, requirement_set_id, applicability_status) VALUES ($1, $2, $3, 'bogus')",
        [orgA, engagementA, set],
      ),
    );
    const ok = await pool.query(
      "INSERT INTO kai.engagement_requirement_sets (organization_id, engagement_id, requirement_set_id) VALUES ($1, $2, $3) RETURNING engagement_requirement_set_id",
      [orgA, engagementA, set],
    );
    assert.ok(ok.rows[0].engagement_requirement_set_id);
  });

  test("cross-tenant engagement applicability fails", async () => {
    const set = await makeRequirementSet();
    await assert.rejects(
      pool.query(
        "INSERT INTO kai.engagement_requirement_sets (organization_id, engagement_id, requirement_set_id) VALUES ($1, $2, $3)",
        [orgB, engagementA, set],
      ),
    );
  });

  test("duplicate engagement/set applicability fails", async () => {
    const set = await makeRequirementSet();
    await pool.query(
      "INSERT INTO kai.engagement_requirement_sets (organization_id, engagement_id, requirement_set_id) VALUES ($1, $2, $3)",
      [orgA, engagementA, set],
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO kai.engagement_requirement_sets (organization_id, engagement_id, requirement_set_id) VALUES ($1, $2, $3)",
        [orgA, engagementA, set],
      ),
    );
  });
}
