import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  proposeEngagementRequirementSetApplicability,
  approveEngagementRequirementSetApplicability,
} from "../Backend/kai/services/kaiEngagementRequirementApplicabilityService.js";
import { classifyEngagementFunderRequirementsState } from "../Backend/kai/services/kaiEngagementContextService.js";
import * as kaiQueries from "../Backend/kai/db/kaiQueries.js";
import { insertRequiredSuccessfulAuditEvent } from "../Backend/kai/db/kaiAuditQueries.js";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_PACKAGE_2B_ENGAGEMENT_REQUIREMENT_APPLICABILITY_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`Package 2B integration suite refused a non-loopback runner-owned URL host: ${host}`);
  }
}

test("Package 2B PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("Package 2B integration requires the runner-owned database", { skip: true }, () => {});
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

  const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

  // Every db-shaped dependency defaults to this suite's own runner-owned
  // pool when the service calls it outside a transaction (no explicit db
  // argument) - never the shared production pool from kaiDb.js. Calls made
  // inside a transaction always receive the transaction client explicitly
  // from the service itself, so this default only ever applies to the
  // pre-transaction reads (propose's initial engagement/authority lookups).
  function withPool(fn) {
    return (input, db) => fn(input, db || pool);
  }

  async function runInTransaction(callback) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  function dependenciesFor(overrides = {}) {
    return Object.freeze({
      env: enabledEnv,
      runInTransaction,
      getEngagementForOrganization: withPool(kaiQueries.getEngagementForOrganization),
      getRequirementSetAuthority: withPool(kaiQueries.getRequirementSetAuthority),
      insertEngagementRequirementSetProposal: withPool(kaiQueries.insertEngagementRequirementSetProposal),
      getCurrentEngagementRequirementSetForIdentity: withPool(kaiQueries.getCurrentEngagementRequirementSetForIdentity),
      insertEngagementRequirementSetReviewApproval: withPool(kaiQueries.insertEngagementRequirementSetReviewApproval),
      insertRequiredSuccessfulAuditEvent: withPool(insertRequiredSuccessfulAuditEvent),
      ...overrides,
    });
  }

  const dependencies = dependenciesFor();

  const classifierDependencies = Object.freeze({
    env: enabledEnv,
    getEngagementForOrganization: withPool(kaiQueries.getEngagementForOrganization),
    listExternalRequirementSetsForTarget: withPool(kaiQueries.listExternalRequirementSetsForTarget),
    listEngagementRequirementSetsForOrganization: withPool(kaiQueries.listEngagementRequirementSetsForOrganization),
  });

  const target = Object.freeze({
    target_funder_id: "city_impact_fund",
    target_framework: "annual_outcomes_v1",
  });

  let orgA;
  let orgB;
  let engagementA;
  let engagementB;
  let requirementSet;
  let kaiStandardRequirementSet;

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE kai.audit_events RESTART IDENTITY CASCADE",
    );
    await pool.query(
      "TRUNCATE kai.engagement_requirement_sets, kai.requirements, kai.requirement_sets, kai.requirement_framework_versions, kai.requirement_sources RESTART IDENTITY CASCADE",
    );
    await pool.query("TRUNCATE kai.engagements, kai.organizations RESTART IDENTITY CASCADE");

    const orgs = await pool.query(
      "INSERT INTO kai.organizations (name) VALUES ('Org A'), ('Org B') RETURNING organization_id",
    );
    [orgA, orgB] = orgs.rows.map((r) => r.organization_id);

    const engagements = await pool.query(
      `INSERT INTO kai.engagements (organization_id, engagement_code, project_metadata)
       VALUES ($1, 'eng-a', $3::jsonb), ($2, 'eng-b', '{}'::jsonb)
       RETURNING engagement_id`,
      [orgA, orgB, JSON.stringify({ engagement_requirement_target: target })],
    );
    [engagementA, engagementB] = engagements.rows.map((r) => r.engagement_id);

    const funderSource = (
      await pool.query(
        "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('funder', 'city_impact_fund', 'City Impact Fund') RETURNING requirement_source_id",
      )
    ).rows[0].requirement_source_id;
    const kaiStandardSource = (
      await pool.query(
        "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('kai_standard', 'kai_baseline', 'KAI Baseline') RETURNING requirement_source_id",
      )
    ).rows[0].requirement_source_id;
    const version = (
      await pool.query(
        "INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label, framework_status) VALUES ($1, 'annual_outcomes_v1', 'Annual Outcomes', 'v1', 'active') RETURNING requirement_framework_version_id",
        [funderSource],
      )
    ).rows[0].requirement_framework_version_id;
    const kaiStandardVersion = (
      await pool.query(
        "INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label, framework_status) VALUES ($1, 'kai_baseline_v1', 'KAI Baseline', 'v1', 'active') RETURNING requirement_framework_version_id",
        [kaiStandardSource],
      )
    ).rows[0].requirement_framework_version_id;
    requirementSet = (
      await pool.query(
        "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, 'annual_outcomes', 'Annual Outcomes') RETURNING requirement_set_id",
        [version],
      )
    ).rows[0].requirement_set_id;
    kaiStandardRequirementSet = (
      await pool.query(
        "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, 'kai_baseline', 'KAI Baseline') RETURNING requirement_set_id",
        [kaiStandardVersion],
      )
    ).rows[0].requirement_set_id;
  });

  function actorFor(organizationId, actorUserId, roleName = "gk_reviewer") {
    return {
      actorType: "human",
      actorUserId,
      kaiRoles: [],
      organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: roleName }],
    };
  }

  const PROPOSER_ID = "90000000-0000-4000-8000-000000000001";
  const REVIEWER_ID = "90000000-0000-4000-8000-000000000002";
  const OTHER_REVIEWER_ID = "90000000-0000-4000-8000-000000000003";
  const THIRD_REVIEWER_ID = "90000000-0000-4000-8000-000000000004";

  test("propose against real Postgres: kai_standard authority is rejected before any row is written", async () => {
    const result = await proposeEngagementRequirementSetApplicability(
      {
        organizationId: orgA,
        engagementId: engagementA,
        requirementSetId: kaiStandardRequirementSet,
        actorContext: actorFor(orgA, PROPOSER_ID, "gk_operator"),
      },
      dependencies,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    const { rows } = await pool.query("SELECT count(*)::int AS count FROM kai.engagement_requirement_sets");
    assert.equal(rows[0].count, 0);
  });

  test("propose against real Postgres: cross-tenant engagement fails closed as not_found", async () => {
    const result = await proposeEngagementRequirementSetApplicability(
      {
        organizationId: orgA,
        engagementId: engagementB,
        requirementSetId: requirementSet,
        actorContext: actorFor(orgA, PROPOSER_ID, "gk_operator"),
      },
      dependencies,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("propose then review against real Postgres creates the reviewed/current row, a stale review of a superseded identity fails closed, and Package 1B reaches state 4", async () => {
    const proposeResult = await proposeEngagementRequirementSetApplicability(
      {
        organizationId: orgA,
        engagementId: engagementA,
        requirementSetId: requirementSet,
        actorContext: actorFor(orgA, PROPOSER_ID, "gk_operator"),
      },
      dependencies,
    );
    assert.equal(proposeResult.ok, true);
    assert.equal(proposeResult.data.applicability_status, "proposed");

    const reviewResult = await approveEngagementRequirementSetApplicability(
      {
        organizationId: orgA,
        engagementId: engagementA,
        requirementSetId: requirementSet,
        decision: "applicable",
        actorContext: actorFor(orgA, REVIEWER_ID, "gk_reviewer"),
      },
      dependencies,
    );
    assert.equal(reviewResult.ok, true);
    assert.equal(reviewResult.data.applicability_status, "confirmed");
    assert.equal(reviewResult.data.applicability_effective_state, "applicable");
    assert.equal(reviewResult.data.reviewed_by, REVIEWER_ID);
    assert.equal(reviewResult.data.reviewed_by_role, "gk_reviewer");
    assert.equal(reviewResult.data.supersedes_engagement_requirement_set_id, proposeResult.data.engagement_requirement_set_id);
    assert.deepEqual(reviewResult.data.target_context_identity, target);

    const auditRows = await pool.query(
      "SELECT action, reason_code, actor_user_id FROM kai.audit_events ORDER BY audit_event_id ASC",
    );
    assert.equal(auditRows.rows.length, 2);
    assert.equal(auditRows.rows[0].action, "propose_engagement_requirement_set_applicability");
    assert.equal(auditRows.rows[1].action, "approve_engagement_requirement_set_applicability");
    assert.equal(auditRows.rows[1].reason_code, "engagement_requirement_set_applicability_reviewed_applicable");
    assert.equal(auditRows.rows[1].actor_user_id, REVIEWER_ID);

    // Package 1 classifier states 1-3 (no target/no authority/authority not
    // applicable) are exercised by the unit spec; here state 4 is proven
    // end-to-end against the real writer output and the unmodified reader.
    const classifierResult = await classifyEngagementFunderRequirementsState(
      { organizationId: orgA, engagementId: engagementA, actorContext: actorFor(orgA, PROPOSER_ID, "gk_operator") },
      classifierDependencies,
    );
    assert.equal(classifierResult.ok, true);
    assert.equal(classifierResult.data.state, "applicable_requirement_set_assessment_not_available");
    assert.equal(classifierResult.data.applicable_requirement_sets.length, 1);
    assert.equal(classifierResult.data.applicable_requirement_sets[0].requirement_set_id, requirementSet);
  });

  test("replacement (Package 2B-B) against real Postgres: a second review supersedes the confirmed decision, the prior row remains historically readable and no longer current, and UPDATE/DELETE of it stays prohibited", async () => {
    const proposeResult = await proposeEngagementRequirementSetApplicability(
      { organizationId: orgA, engagementId: engagementA, requirementSetId: requirementSet, actorContext: actorFor(orgA, PROPOSER_ID, "gk_operator") },
      dependencies,
    );
    const firstReview = await approveEngagementRequirementSetApplicability(
      { organizationId: orgA, engagementId: engagementA, requirementSetId: requirementSet, decision: "applicable", actorContext: actorFor(orgA, REVIEWER_ID, "gk_reviewer") },
      dependencies,
    );
    assert.equal(firstReview.ok, true);

    const secondReview = await approveEngagementRequirementSetApplicability(
      { organizationId: orgA, engagementId: engagementA, requirementSetId: requirementSet, decision: "not_applicable", actorContext: actorFor(orgA, OTHER_REVIEWER_ID, "gk_reviewer") },
      dependencies,
    );
    assert.equal(secondReview.ok, true);
    assert.equal(secondReview.data.applicability_effective_state, "not_applicable");
    assert.equal(secondReview.data.supersedes_engagement_requirement_set_id, firstReview.data.engagement_requirement_set_id);

    // The prior (first) reviewed row is preserved unchanged as history - it
    // is still readable by primary key with its original content intact.
    const historical = await pool.query(
      "SELECT applicability_status, applicability_effective_state, reviewed_by FROM kai.engagement_requirement_sets WHERE engagement_requirement_set_id = $1",
      [firstReview.data.engagement_requirement_set_id],
    );
    assert.equal(historical.rows.length, 1);
    assert.equal(historical.rows[0].applicability_status, "confirmed");
    assert.equal(historical.rows[0].applicability_effective_state, "applicable");
    assert.equal(historical.rows[0].reviewed_by, REVIEWER_ID);

    // It no longer qualifies as current: the Package 2A current-authority
    // predicate now resolves to the second (replacement) row only.
    const current = await kaiQueries.getCurrentEngagementRequirementSetForIdentity(
      { organizationId: orgA, engagementId: engagementA, requirementSetId: requirementSet },
      pool,
    );
    assert.equal(current.engagement_requirement_set_id, secondReview.data.engagement_requirement_set_id);

    // UPDATE/DELETE of the historical (now-superseded) row remains
    // prohibited by Package 2A's unmodified append-only trigger.
    await assert.rejects(
      pool.query(
        "UPDATE kai.engagement_requirement_sets SET applicability_effective_state = 'retired' WHERE engagement_requirement_set_id = $1",
        [firstReview.data.engagement_requirement_set_id],
      ),
      /append-only/,
    );
    await assert.rejects(
      pool.query(
        "DELETE FROM kai.engagement_requirement_sets WHERE engagement_requirement_set_id = $1",
        [firstReview.data.engagement_requirement_set_id],
      ),
      /append-only/,
    );

    // A third review attempt referencing the now-stale first row (via the
    // identity, since the client never supplies a row id) always resolves to
    // the true current row - it cannot resurrect or fork the superseded one.
    const thirdReview = await approveEngagementRequirementSetApplicability(
      { organizationId: orgA, engagementId: engagementA, requirementSetId: requirementSet, decision: "retired", actorContext: actorFor(orgA, THIRD_REVIEWER_ID, "gk_reviewer") },
      dependencies,
    );
    assert.equal(thirdReview.ok, true);
    assert.equal(thirdReview.data.supersedes_engagement_requirement_set_id, secondReview.data.engagement_requirement_set_id);

    const currentCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM kai.engagement_requirement_sets ers
        WHERE ers.organization_id = $1 AND ers.engagement_id = $2 AND ers.requirement_set_id = $3
          AND NOT EXISTS (
            SELECT 1 FROM kai.engagement_requirement_sets successor
             WHERE successor.supersedes_engagement_requirement_set_id = ers.engagement_requirement_set_id
          )`,
      [orgA, engagementA, requirementSet],
    );
    assert.equal(currentCount.rows[0].count, 1, "exactly one current row must exist for the identity at all times");
  });

  test("concurrency: two transactions that both lock the same current row before either commits cannot both create a current authoritative decision", async () => {
    const proposeResult = await proposeEngagementRequirementSetApplicability(
      { organizationId: orgA, engagementId: engagementA, requirementSetId: requirementSet, actorContext: actorFor(orgA, PROPOSER_ID, "gk_operator") },
      dependencies,
    );
    assert.equal(proposeResult.ok, true);
    const currentId = proposeResult.data.engagement_requirement_set_id;

    // A real Postgres race, deliberately forced rather than hoped-for: two
    // separate connections/transactions, using the exact same current-
    // authority read (getCurrentEngagementRequirementSetForIdentity, FOR
    // UPDATE) and the exact same writer
    // (insertEngagementRequirementSetReviewApproval) the service itself
    // uses - no new locking subsystem, just the existing conventions driven
    // by hand so the second transaction's lock-wait is genuine, not a
    // coincidence of scheduling.
    const client1 = await pool.connect();
    const client2 = await pool.connect();
    try {
      await client1.query("BEGIN");
      await client2.query("BEGIN");

      const read1 = await kaiQueries.getCurrentEngagementRequirementSetForIdentity(
        { organizationId: orgA, engagementId: engagementA, requirementSetId: requirementSet, lockForUpdate: true },
        client1,
      );
      assert.equal(read1.engagement_requirement_set_id, currentId);

      // client2 issues the identical locked read against the same row -
      // this call will not resolve until client1 releases the lock.
      const read2Promise = kaiQueries.getCurrentEngagementRequirementSetForIdentity(
        { organizationId: orgA, engagementId: engagementA, requirementSetId: requirementSet, lockForUpdate: true },
        client2,
      );
      let read2Settled = false;
      read2Promise.then(() => {
        read2Settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(read2Settled, false, "client2's locked read must still be blocked while client1 holds the row lock");

      const approved1 = await kaiQueries.insertEngagementRequirementSetReviewApproval(
        {
          organizationId: orgA,
          engagementId: engagementA,
          requirementSetId: requirementSet,
          supersedesEngagementRequirementSetId: read1.engagement_requirement_set_id,
          reviewedBy: REVIEWER_ID,
          reviewedByRole: "gk_reviewer",
          reviewedAt: new Date().toISOString(),
          applicabilityEffectiveState: "applicable",
          targetContextIdentity: target,
          createdBy: REVIEWER_ID,
          createdByType: "human",
        },
        client1,
      );
      assert.ok(approved1.engagement_requirement_set_id);
      await client1.query("COMMIT");

      // client2's lock-wait now resolves against the post-commit state.
      const read2 = await read2Promise;

      if (read2 && read2.engagement_requirement_set_id === read1.engagement_requirement_set_id) {
        // client2's re-fetched row still looks current to it - the
        // insert-time partial unique index (one successor per superseded
        // row, Package 2A) must be what stops the second decision.
        await assert.rejects(
          kaiQueries.insertEngagementRequirementSetReviewApproval(
            {
              organizationId: orgA,
              engagementId: engagementA,
              requirementSetId: requirementSet,
              supersedesEngagementRequirementSetId: read2.engagement_requirement_set_id,
              reviewedBy: OTHER_REVIEWER_ID,
              reviewedByRole: "gk_reviewer",
              reviewedAt: new Date().toISOString(),
              applicabilityEffectiveState: "not_applicable",
              targetContextIdentity: target,
              createdBy: OTHER_REVIEWER_ID,
              createdByType: "human",
            },
            client2,
          ),
          (error) => error.code === "23505",
        );
        await client2.query("ROLLBACK");
      } else {
        // client2's blocked read was re-evaluated on unblock and no longer
        // finds a current row to supersede - it must not create a decision.
        assert.equal(read2, null);
        await client2.query("COMMIT");
      }
    } finally {
      client1.release();
      client2.release();
    }

    // The database invariant, independent of which mechanism stopped the
    // second transaction: only one row ever superseded the original
    // proposal, and exactly one row is current for the identity.
    const successorCount = await pool.query(
      "SELECT count(*)::int AS count FROM kai.engagement_requirement_sets WHERE supersedes_engagement_requirement_set_id = $1",
      [currentId],
    );
    assert.equal(successorCount.rows[0].count, 1, "exactly one successor may ever be created for one superseded row");

    const currentCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM kai.engagement_requirement_sets ers
        WHERE ers.organization_id = $1 AND ers.engagement_id = $2 AND ers.requirement_set_id = $3
          AND NOT EXISTS (
            SELECT 1 FROM kai.engagement_requirement_sets successor
             WHERE successor.supersedes_engagement_requirement_set_id = ers.engagement_requirement_set_id
          )`,
      [orgA, engagementA, requirementSet],
    );
    assert.equal(currentCount.rows[0].count, 1, "exactly one current row must exist for the identity after the race resolves");
  });

  test("review against real Postgres: engagement target changed since proposal fails closed and cannot inherit stale applicability", async () => {
    const proposeResult = await proposeEngagementRequirementSetApplicability(
      { organizationId: orgA, engagementId: engagementA, requirementSetId: requirementSet, actorContext: actorFor(orgA, PROPOSER_ID, "gk_operator") },
      dependencies,
    );
    assert.equal(proposeResult.ok, true);

    await pool.query(
      "UPDATE kai.engagements SET project_metadata = $2::jsonb WHERE engagement_id = $1",
      [engagementA, JSON.stringify({ engagement_requirement_target: { target_funder_id: "city_impact_fund", target_framework: "changed_framework_v9" } })],
    );

    const reviewResult = await approveEngagementRequirementSetApplicability(
      { organizationId: orgA, engagementId: engagementA, requirementSetId: requirementSet, decision: "applicable", actorContext: actorFor(orgA, REVIEWER_ID, "gk_reviewer") },
      dependencies,
    );
    assert.equal(reviewResult.ok, false);
    assert.equal(reviewResult.error.code, "conflict_current_state_changed");

    const { rows } = await pool.query(
      "SELECT count(*)::int AS count FROM kai.engagement_requirement_sets WHERE applicability_status = 'confirmed'",
    );
    assert.equal(rows[0].count, 0);
  });

  test("tenant negative against real Postgres: reviewing another organization's identity fails closed", async () => {
    const proposeResult = await proposeEngagementRequirementSetApplicability(
      { organizationId: orgA, engagementId: engagementA, requirementSetId: requirementSet, actorContext: actorFor(orgA, PROPOSER_ID, "gk_operator") },
      dependencies,
    );
    assert.equal(proposeResult.ok, true);

    const result = await approveEngagementRequirementSetApplicability(
      { organizationId: orgB, engagementId: engagementB, requirementSetId: requirementSet, decision: "applicable", actorContext: actorFor(orgB, REVIEWER_ID, "gk_reviewer") },
      dependencies,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });
}
