import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_PACKAGE_2A_ENGAGEMENT_REQUIREMENT_SETS_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`Package 2A engagement-requirement-sets integration suite refused a non-loopback runner-owned URL host: ${host}`);
  }
}

test("Package 2A PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("Package 2A integration requires the runner-owned database", { skip: true }, () => {});
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
  let requirementSet;
  let otherRequirementSet;
  const reviewer = "90000000-0000-4000-8000-000000000001";
  const target = Object.freeze({
    target_funder_id: "city_impact_fund",
    target_framework: "annual_outcomes_v1",
  });

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

    const source = (
      await pool.query(
        "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('funder', 'city_impact_fund', 'City Impact Fund') RETURNING requirement_source_id",
      )
    ).rows[0].requirement_source_id;
    const version = (
      await pool.query(
        "INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label, framework_status) VALUES ($1, 'annual_outcomes_v1', 'Annual Outcomes', 'v1', 'active') RETURNING requirement_framework_version_id",
        [source],
      )
    ).rows[0].requirement_framework_version_id;
    requirementSet = (
      await pool.query(
        "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, 'annual_outcomes', 'Annual Outcomes') RETURNING requirement_set_id",
        [version],
      )
    ).rows[0].requirement_set_id;
    otherRequirementSet = (
      await pool.query(
        "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, 'annual_outputs', 'Annual Outputs') RETURNING requirement_set_id",
        [version],
      )
    ).rows[0].requirement_set_id;
  });

  async function insertApplicability(overrides = {}) {
    const values = {
      organizationId: orgA,
      engagementId: engagementA,
      requirementSetId: requirementSet,
      reviewedBy: reviewer,
      reviewedByRole: "gk_operator",
      reviewedAt: "2026-09-05T00:00:00.000Z",
      state: "applicable",
      supersedes: null,
      target,
      ...overrides,
    };
    return pool.query(
      `INSERT INTO kai.engagement_requirement_sets (
         organization_id,
         engagement_id,
         requirement_set_id,
         applicability_status,
         reviewed_by,
         reviewed_by_role,
         reviewed_at,
         applicability_effective_state,
         supersedes_engagement_requirement_set_id,
         target_context_identity
       ) VALUES ($1, $2, $3, 'confirmed', $4, $5, $6::timestamptz, $7, $8, $9::jsonb)
       RETURNING engagement_requirement_set_id`,
      [
        values.organizationId,
        values.engagementId,
        values.requirementSetId,
        values.reviewedBy,
        values.reviewedByRole,
        values.reviewedAt,
        values.state,
        values.supersedes,
        JSON.stringify(values.target),
      ],
    );
  }

  test("Package 2A forward migration added the approved columns", async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'kai'
         AND table_name = 'engagement_requirement_sets'
         AND column_name IN (
           'reviewed_by',
           'reviewed_by_role',
           'reviewed_at',
           'applicability_effective_state',
           'supersedes_engagement_requirement_set_id',
           'target_context_identity'
         )`,
    );
    assert.deepEqual(rows.map((r) => r.column_name).sort(), [
      "applicability_effective_state",
      "reviewed_at",
      "reviewed_by",
      "reviewed_by_role",
      "supersedes_engagement_requirement_set_id",
      "target_context_identity",
    ].sort());
  });

  test("reviewed current applicable row with approved target context succeeds", async () => {
    const result = await insertApplicability();
    assert.ok(result.rows[0].engagement_requirement_set_id);
  });

  test("partial reviewed authority, invalid effective state, and missing target identity fail", async () => {
    await assert.rejects(insertApplicability({ reviewedAt: null }));
    await assert.rejects(insertApplicability({ state: "maybe_applicable" }));
    await assert.rejects(insertApplicability({ target: { target_funder_id: "city_impact_fund" } }));
  });

  test("replacement lineage permits one successor for the same engagement/set and rejects a second successor", async () => {
    const first = (await insertApplicability()).rows[0].engagement_requirement_set_id;
    const second = (await insertApplicability({
      supersedes: first,
      state: "not_applicable",
      reviewedAt: "2026-09-05T01:00:00.000Z",
    })).rows[0].engagement_requirement_set_id;
    assert.ok(second);
    await assert.rejects(insertApplicability({
      supersedes: first,
      state: "applicable",
      reviewedAt: "2026-09-05T02:00:00.000Z",
    }));
  });

  test("applicability authority history is append-only", async () => {
    const first = (await insertApplicability()).rows[0].engagement_requirement_set_id;
    await assert.rejects(
      pool.query(
        "UPDATE kai.engagement_requirement_sets SET applicability_effective_state = 'not_applicable' WHERE engagement_requirement_set_id = $1",
        [first],
      ),
      /append-only/,
    );
    await assert.rejects(
      pool.query(
        "DELETE FROM kai.engagement_requirement_sets WHERE engagement_requirement_set_id = $1",
        [first],
      ),
      /append-only/,
    );
  });

  test("root identity and supersession lineage cannot cross engagement, organization, or requirement set", async () => {
    const first = (await insertApplicability()).rows[0].engagement_requirement_set_id;
    await assert.rejects(insertApplicability({ supersedes: null }));
    await assert.rejects(insertApplicability({
      organizationId: orgB,
      engagementId: engagementB,
      supersedes: first,
    }));
    await assert.rejects(insertApplicability({
      requirementSetId: otherRequirementSet,
      supersedes: first,
    }));
  });
}
