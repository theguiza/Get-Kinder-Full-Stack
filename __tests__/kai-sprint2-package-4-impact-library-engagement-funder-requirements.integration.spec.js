import test, { after } from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_PACKAGE_4_FUNDER_REQUIREMENTS_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`Package 4 assembled-proof integration suite refused a non-loopback runner-owned URL host: ${host}`);
  }
}

test("Package 4 assembled-proof PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("Package 4 assembled proof requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runAssembledProof();
}

// This suite exercises the REAL, unmocked assembled path:
//   GET .../organizations/:organizationId/engagements/:engagementId/funder-requirements
//   -> the real Express route handler (extracted from the production router,
//      never re-registered or wrapped)
//   -> the real kaiEngagementFunderRequirementsCompositionService
//   -> the real Package 1B classifyEngagementFunderRequirementsState
//   -> the real Package 2B applicability rows (proposed/reviewed via the
//      real kaiEngagementRequirementApplicabilityService)
//   -> the real Package 3A/3B getEngagementRequirementAssessment (live gate
//      revalidation, never a stale/generic fallback)
//   -> the real Package 4 DTO -> the real frontend projectEngagementFunderRequirements
//
// Every one of those layers runs with ZERO dependency overrides, so every
// database call goes through the real, ambient production pool
// (Backend/db/pg.js) - this is only reachable because the runner script
// launches this file as its own Node process with the ambient pool's
// environment pointed at the loopback-only ephemeral PostgreSQL instance
// (discrete DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD, no URL env var).
// A SEPARATE, explicitly runner-owned connection (RUNNER_OWNED_DATABASE_URL)
// is used only for this suite's own fixture seeding and raw-row assertions -
// never for exercising the code path under proof.
async function runAssembledProof() {
  const { Pool } = await import("pg");
  const seedPool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false });
  after(async () => {
    await seedPool.end();
  });

  const router = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const {
    proposeEngagementRequirementSetApplicability,
    approveEngagementRequirementSetApplicability,
  } = await import("../Backend/kai/services/kaiEngagementRequirementApplicabilityService.js");
  const { assessEngagementRequirement } = await import(
    "../Backend/kai/services/kaiEngagementRequirementAssessmentService.js"
  );
  const { assessOrganizationRequirement } = await import("../Backend/kai/services/kaiRequirementAssessmentService.js");
  const { projectEngagementFunderRequirements, ENGAGEMENT_FUNDER_REQUIREMENTS_STATES } = await import(
    "../frontend/impactEvidenceLibraryLogic.js"
  );

  function routeHandler(path, method) {
    const layer = router.stack.find(
      (candidate) => candidate.route?.path === path && candidate.route?.methods?.[method],
    );
    assert.ok(layer, `${method.toUpperCase()} ${path} route exists on the real production router`);
    return layer.route.stack[0].handle;
  }

  function createResponse() {
    return {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return body;
      },
    };
  }

  const FUNDER_REQUIREMENTS_ROUTE = "/admin/organizations/:organizationId/engagements/:engagementId/funder-requirements";
  const getFunderRequirementsHandler = routeHandler(FUNDER_REQUIREMENTS_ROUTE, "get");

  async function callFunderRequirementsRoute(organizationId, engagementId, legacyUserId) {
    const res = createResponse();
    await getFunderRequirementsHandler({ params: { organizationId, engagementId }, user: { id: legacyUserId } }, res);
    return res;
  }

  const TARGET = Object.freeze({ target_funder_id: "city_impact_fund", target_framework: "annual_outcomes_v1" });
  const GHOST_TARGET = Object.freeze({ target_funder_id: "ghost_fund", target_framework: "ghost_outcomes_v1" });

  async function resetAllTables() {
    await seedPool.query(
      `TRUNCATE
         kai.ra_evidence_review_decision_links,
         kai.ra_claim_review_decision_links,
         kai.ra_gap_links,
         kai.ra_outcome_context_links,
         kai.ra_source_promotion_links,
         kai.ra_conflict_resolution_links,
         kai.requirement_assessment_evidence_links,
         kai.requirement_assessment_claim_links,
         kai.requirement_assessment_evaluation_result_links,
         kai.requirement_assessments,
         kai.engagement_requirement_sets,
         kai.requirements,
         kai.requirement_sets,
         kai.requirement_framework_versions,
         kai.requirement_sources
       RESTART IDENTITY CASCADE`,
    );
    await seedPool.query("TRUNCATE kai.audit_events RESTART IDENTITY CASCADE");
    await seedPool.query("TRUNCATE kai.organization_memberships RESTART IDENTITY CASCADE");
    await seedPool.query("TRUNCATE kai.users RESTART IDENTITY CASCADE");
    await seedPool.query("TRUNCATE kai.engagements, kai.organizations RESTART IDENTITY CASCADE");
    await seedPool.query("TRUNCATE public.organizations RESTART IDENTITY CASCADE");
  }

  async function seedOrganization(name) {
    const { rows } = await seedPool.query("INSERT INTO kai.organizations (name) VALUES ($1) RETURNING organization_id", [name]);
    return rows[0].organization_id;
  }

  async function seedEngagement(organizationId, engagementCode, target) {
    const { rows } = await seedPool.query(
      `INSERT INTO kai.engagements (organization_id, engagement_code, project_metadata)
       VALUES ($1, $2, $3::jsonb)
       RETURNING engagement_id`,
      [organizationId, engagementCode, JSON.stringify(target ? { engagement_requirement_target: target } : {})],
    );
    return rows[0].engagement_id;
  }

  async function seedRequirementCatalogue() {
    const source = (
      await seedPool.query(
        "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('funder', 'city_impact_fund', 'City Impact Fund') RETURNING requirement_source_id",
      )
    ).rows[0].requirement_source_id;
    const version = (
      await seedPool.query(
        `INSERT INTO kai.requirement_framework_versions
           (requirement_source_id, framework_code, framework_name, version_label, framework_status)
         VALUES ($1, 'annual_outcomes_v1', 'Annual Outcomes', 'v1', 'active')
         RETURNING requirement_framework_version_id`,
        [source],
      )
    ).rows[0].requirement_framework_version_id;
    const requirementSetId = (
      await seedPool.query(
        `INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
         VALUES ($1, 'annual_outcomes', 'Annual Outcomes')
         RETURNING requirement_set_id`,
        [version],
      )
    ).rows[0].requirement_set_id;
    // requirement_key must be exactly 'ir_contrib_002' - the one key the
    // real Package 3A/3B assessment repository/rule table supports
    // (Backend/kai/validators/kaiRequirementAssessmentValidators.js#SUPPORTED_REQUIREMENT_KEY).
    const requirementId = (
      await seedPool.query(
        `INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, display_order)
         VALUES ($1, 'ir_contrib_002', 'Known limitations affecting confidence in a reported result are documented', 0)
         RETURNING requirement_id`,
        [requirementSetId],
      )
    ).rows[0].requirement_id;
    return { requirementSetId, requirementId };
  }

  async function seedRequesterActor(legacyUserId, organizationId, roleName) {
    const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyUserId, email: null });
    await seedPool.query(
      `INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status)
       VALUES ($1, $2, $3, 'active')`,
      [organizationId, kaiUser.user_id, roleName],
    );
    return kaiUser.user_id;
  }

  function seededActorContext(actorUserId, organizationId, roleName) {
    return {
      actorType: "human",
      actorUserId,
      kaiRoles: [],
      organizationMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: "active" }],
    };
  }

  const PROPOSER_ID = "90000000-0000-4000-8000-000000000001";
  const REVIEWER_ID = "90000000-0000-4000-8000-000000000002";
  const ASSESSOR_ID = "90000000-0000-4000-8000-000000000003";

  async function proposeAndReview(organizationId, engagementId, requirementSetId, decision) {
    const proposeResult = await proposeEngagementRequirementSetApplicability({
      organizationId,
      engagementId,
      requirementSetId,
      actorContext: seededActorContext(PROPOSER_ID, organizationId, "gk_operator"),
    });
    assert.equal(proposeResult.ok, true, `propose failed: ${JSON.stringify(proposeResult.error)}`);

    const reviewResult = await approveEngagementRequirementSetApplicability({
      organizationId,
      engagementId,
      requirementSetId,
      decision,
      actorContext: seededActorContext(REVIEWER_ID, organizationId, "gk_reviewer"),
    });
    assert.equal(reviewResult.ok, true, `review failed: ${JSON.stringify(reviewResult.error)}`);
    return reviewResult.data;
  }

  await resetAllTables();

  await test("Package 4 assembled proof: engagement -> authoritative requirement set -> Package 2B applicability -> applicable requirements -> Package 3 current assessment", async (t) => {
    const orgA = await seedOrganization("KAI Package 4 Org A");
    const orgB = await seedOrganization("KAI Package 4 Org B");
    const { requirementSetId, requirementId } = await seedRequirementCatalogue();

    await seedRequesterActor(501, orgA, "gk_operator");
    await seedRequesterActor(502, orgB, "gk_operator");

    const engNoTarget = await seedEngagement(orgA, "eng-no-target", null);
    const engBadTarget = await seedEngagement(orgA, "eng-bad-target", GHOST_TARGET);
    const engNotApplicable = await seedEngagement(orgA, "eng-not-applicable", TARGET);
    const engApplicable = await seedEngagement(orgA, "eng-applicable", TARGET);
    const engIsolated = await seedEngagement(orgA, "eng-isolated", TARGET);

    await proposeAndReview(orgA, engNotApplicable, requirementSetId, "not_applicable");
    await proposeAndReview(orgA, engApplicable, requirementSetId, "applicable");
    await proposeAndReview(orgA, engIsolated, requirementSetId, "applicable");

    let case5AssessmentState;

    // -----------------------------------------------------------------
    // Case 1: no target selected.
    // -----------------------------------------------------------------
    await t.test("Case 1: no target selected -> no_target_selected, no external requirements fabricated", async () => {
      const res = await callFunderRequirementsRoute(orgA, engNoTarget, 501);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.data.state, ENGAGEMENT_FUNDER_REQUIREMENTS_STATES.noTargetSelected);
      assert.deepEqual(res.body.data.applicable_requirement_sets, []);

      const projected = projectEngagementFunderRequirements(res.body.data);
      assert.equal(projected.state, "no_target_selected");
      assert.deepEqual(projected.requirements, []);
    });

    // -----------------------------------------------------------------
    // Case 2: target selected, no authoritative external requirement set.
    // -----------------------------------------------------------------
    await t.test("Case 2: target with no authoritative external set -> target_selected_no_authoritative_requirement_set, no generic KAI fallback", async () => {
      const res = await callFunderRequirementsRoute(orgA, engBadTarget, 501);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.state, ENGAGEMENT_FUNDER_REQUIREMENTS_STATES.targetSelectedNoAuthoritativeRequirementSet);
      assert.deepEqual(res.body.data.applicable_requirement_sets, []);

      const projected = projectEngagementFunderRequirements(res.body.data);
      assert.equal(projected.state, "target_selected_no_authoritative_requirement_set");
      assert.deepEqual(projected.requirements, []);
    });

    // -----------------------------------------------------------------
    // Case 3: authoritative set exists but is not currently applicable.
    // -----------------------------------------------------------------
    await t.test("Case 3: authoritative set reviewed not_applicable -> authoritative_requirement_set_not_applicable", async () => {
      const res = await callFunderRequirementsRoute(orgA, engNotApplicable, 501);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.state, ENGAGEMENT_FUNDER_REQUIREMENTS_STATES.authoritativeRequirementSetNotApplicable);
      assert.deepEqual(res.body.data.applicable_requirement_sets, []);
    });

    // -----------------------------------------------------------------
    // Case 4: reviewed/current applicability -> applicable set + its real
    // governed requirements returned.
    // -----------------------------------------------------------------
    await t.test("Case 4: reviewed/current applicability -> applicable set and its real governed requirements returned", async () => {
      const res = await callFunderRequirementsRoute(orgA, engApplicable, 501);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.state, ENGAGEMENT_FUNDER_REQUIREMENTS_STATES.applicableRequirementSetAssessmentNotAvailable);
      assert.equal(res.body.data.applicable_requirement_sets.length, 1);
      const [set] = res.body.data.applicable_requirement_sets;
      assert.equal(set.requirement_set_id, requirementSetId);
      assert.equal(set.requirement_source.source_type, "funder");
      assert.equal(set.requirements.length, 1);
      assert.equal(set.requirements[0].requirement_id, requirementId);
      assert.equal(set.requirements[0].requirement_key, "ir_contrib_002");
      assert.equal(set.requirements[0].current_assessment, null);
    });

    // -----------------------------------------------------------------
    // Case 5: a real current engagement assessment is returned for the
    // correct requirement, and the frontend projection carries it through.
    // -----------------------------------------------------------------
    await t.test("Case 5: current engagement assessment is returned for the correct requirement, and the frontend projection matches it", async () => {
      const assessResult = await assessEngagementRequirement({
        organizationId: orgA,
        engagementId: engApplicable,
        requirementId,
        actorContext: seededActorContext(ASSESSOR_ID, orgA, "gk_reviewer"),
        now: new Date().toISOString(),
      });
      assert.equal(assessResult.ok, true, `assess failed: ${JSON.stringify(assessResult.error)}`);
      // The write path's success result is the flat toAssessmentRecord shape
      // (assessment fields at the top level), unlike the read path's
      // { requirement, assessment, ...provenance } nesting checked below.
      case5AssessmentState = assessResult.data.assessment_state;

      const res = await callFunderRequirementsRoute(orgA, engApplicable, 501);
      assert.equal(res.statusCode, 200);
      const [set] = res.body.data.applicable_requirement_sets;
      const requirement = set.requirements.find((r) => r.requirement_id === requirementId);
      assert.ok(requirement.current_assessment, "expected a current assessment to be returned");
      assert.equal(requirement.current_assessment.assessment.requirement_id, requirementId);
      assert.equal(requirement.current_assessment.assessment.engagement_id, engApplicable);
      assert.equal(requirement.current_assessment.assessment.assessment_state, case5AssessmentState);

      const projected = projectEngagementFunderRequirements(res.body.data);
      const projectedRequirement = projected.requirements.find((r) => r.requirementId === requirementId);
      assert.ok(projectedRequirement.currentAssessment, "frontend projection must carry the same current assessment");
      assert.equal(projectedRequirement.currentAssessment.assessmentState, case5AssessmentState);
    });

    // -----------------------------------------------------------------
    // Case 6: missing assessment remains missing - the generic
    // (organization-scope, engagement_id IS NULL) assessment is never
    // substituted, even though one exists for the same organization+requirement.
    // -----------------------------------------------------------------
    await t.test("Case 6: missing engagement assessment stays missing - never substituted by the generic organization-scope assessment", async () => {
      const genericAssessResult = await assessOrganizationRequirement({
        organizationId: orgA,
        requirementId,
        actorContext: seededActorContext(ASSESSOR_ID, orgA, "gk_reviewer"),
        now: new Date().toISOString(),
      });
      assert.equal(genericAssessResult.ok, true, `generic assess failed: ${JSON.stringify(genericAssessResult.error)}`);
      assert.equal(genericAssessResult.data.engagement_id, null);

      const res = await callFunderRequirementsRoute(orgA, engIsolated, 501);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.state, ENGAGEMENT_FUNDER_REQUIREMENTS_STATES.applicableRequirementSetAssessmentNotAvailable);
      const [set] = res.body.data.applicable_requirement_sets;
      const requirement = set.requirements.find((r) => r.requirement_id === requirementId);
      assert.equal(requirement.current_assessment, null, "a generic organization-scope assessment must never be substituted");

      const projected = projectEngagementFunderRequirements(res.body.data);
      assert.equal(projected.requirements.find((r) => r.requirementId === requirementId).currentAssessment, null);
    });

    // -----------------------------------------------------------------
    // Case 7: stale/superseded applicability - the historical assessment row
    // remains persisted, Package 3 rejects it as current, and Package 4/the
    // frontend never show it as current.
    // -----------------------------------------------------------------
    await t.test("Case 7: superseded applicability - the historical assessment row remains persisted, but is never shown as current", async () => {
      const preSupersedeRows = await seedPool.query(
        "SELECT requirement_assessment_id FROM kai.requirement_assessments WHERE organization_id = $1 AND engagement_id = $2 AND requirement_id = $3",
        [orgA, engApplicable, requirementId],
      );
      assert.equal(preSupersedeRows.rows.length, 1, "the Case 5 assessment row must exist before supersession");
      const staleAssessmentId = preSupersedeRows.rows[0].requirement_assessment_id;

      // A real Package 2B replacement review supersedes the confirmed
      // 'applicable' decision with 'not_applicable' - the prior row is never
      // mutated or deleted (Package 2A's append-only trigger), it simply stops
      // being current.
      const replacementReview = await approveEngagementRequirementSetApplicability({
        organizationId: orgA,
        engagementId: engApplicable,
        requirementSetId,
        decision: "not_applicable",
        actorContext: seededActorContext(REVIEWER_ID, orgA, "gk_reviewer"),
      });
      assert.equal(replacementReview.ok, true, `replacement review failed: ${JSON.stringify(replacementReview.error)}`);

      const postSupersedeRows = await seedPool.query(
        "SELECT requirement_assessment_id, assessment_state FROM kai.requirement_assessments WHERE requirement_assessment_id = $1",
        [staleAssessmentId],
      );
      assert.equal(postSupersedeRows.rows.length, 1, "the historical assessment row must remain persisted, unmutated, and undeleted");
      assert.equal(postSupersedeRows.rows[0].assessment_state, case5AssessmentState);

      const res = await callFunderRequirementsRoute(orgA, engApplicable, 501);
      assert.equal(res.statusCode, 200);
      assert.equal(
        res.body.data.state,
        ENGAGEMENT_FUNDER_REQUIREMENTS_STATES.authoritativeRequirementSetNotApplicable,
        "the requirement set is no longer currently applicable for this engagement",
      );
      assert.deepEqual(res.body.data.applicable_requirement_sets, [], "the stale assessment must never surface as a current applicable requirement");

      const projected = projectEngagementFunderRequirements(res.body.data);
      assert.deepEqual(projected.requirements, []);
    });

    // -----------------------------------------------------------------
    // Case 8: engagement A and engagement B remain isolated - proven via
    // two independent, differently-shaped engagements under the same
    // organization (no_target_selected vs. current-applicable-unassessed).
    // -----------------------------------------------------------------
    await t.test("Case 8: two engagements under the same organization remain fully isolated from each other", async () => {
      const noTargetRes = await callFunderRequirementsRoute(orgA, engNoTarget, 501);
      const isolatedRes = await callFunderRequirementsRoute(orgA, engIsolated, 501);

      assert.equal(noTargetRes.body.data.state, ENGAGEMENT_FUNDER_REQUIREMENTS_STATES.noTargetSelected);
      assert.equal(noTargetRes.body.data.engagement.engagement_id, engNoTarget);
      assert.deepEqual(noTargetRes.body.data.applicable_requirement_sets, []);

      assert.equal(isolatedRes.body.data.state, ENGAGEMENT_FUNDER_REQUIREMENTS_STATES.applicableRequirementSetAssessmentNotAvailable);
      assert.equal(isolatedRes.body.data.engagement.engagement_id, engIsolated);
      assert.equal(isolatedRes.body.data.applicable_requirement_sets.length, 1);
      assert.equal(
        isolatedRes.body.data.applicable_requirement_sets[0].requirements.find((r) => r.requirement_id === requirementId).current_assessment,
        null,
      );
    });

    // -----------------------------------------------------------------
    // Case 9: a cross-tenant route request fails closed with no
    // requirement/assessment leak.
    // -----------------------------------------------------------------
    await t.test("Case 9: cross-tenant route request fails closed with no requirement/assessment leak", async () => {
      const res = await callFunderRequirementsRoute(orgB, engIsolated, 502);
      assert.equal(res.body.ok, false);
      assert.ok(["not_found", "tenant_boundary_violation"].includes(res.body.error.code), `unexpected error code: ${res.body.error.code}`);
      assert.equal(res.body.data, null, "no requirement/assessment data may leak on a cross-tenant failure");
    });
  });
}
