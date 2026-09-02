import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_C3B2_C_CONCURRENT_CURRENTNESS_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`C3.B2.C concurrent-currentness integration suite refused a non-loopback runner-owned URL host: ${host}`);
  }
}

test("C3.B2.C PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("C3.B2.C concurrent-currentness integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runIntegrationSuite();
}

function sha256hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function runIntegrationSuite() {
  const { Pool } = await import("pg");
  const { createPostgresRequirementAssessmentRepository } = await import(
    "../Backend/kai/dictionary/postgresRequirementAssessmentRepository.js"
  );
  const {
    assessOrganizationRequirement,
    getOrganizationRequirementAssessment,
  } = await import("../Backend/kai/services/kaiRequirementAssessmentService.js");
  const { SUPPORTED_REQUIREMENT_KEY: IR_CONTRIB_002_KEY } = await import(
    "../Backend/kai/validators/kaiRequirementAssessmentValidators.js"
  );
  const { REQUIREMENT_KEY: IR_COMM_002_KEY } = await import(
    "../Backend/kai/validators/kaiCommunicationAccountabilityAssessmentValidators.js"
  );

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 10 });
  after(async () => {
    await pool.end();
  });

  async function runInTransaction(callback) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const repository = createPostgresRequirementAssessmentRepository({ runInTransaction });

  /**
   * A `runInTransaction` that pauses T1 exactly once, immediately after the
   * FIRST query whose text matches `pauseAfterTextIncludes` returns - i.e.
   * immediately after T1 has read its claim_review_decisions material input
   * and before it writes anything (insertAssessmentRow runs strictly later).
   * Returns { runInTransaction, paused, resume } - `paused` resolves once T1
   * has reached the pause point (safe to act as T2 at that moment), and
   * calling `resume()` releases T1 to continue inside the SAME transaction
   * and connection it started with (a real, uninterrupted PostgreSQL
   * transaction context - not a simulated one).
   */
  function createPausedRunInTransaction(pauseAfterTextIncludes) {
    let resolvePaused;
    const paused = new Promise((resolve) => {
      resolvePaused = resolve;
    });
    let releaseResume;
    const resumeGate = new Promise((resolve) => {
      releaseResume = resolve;
    });

    async function pausedRunInTransaction(callback) {
      const client = await pool.connect();
      let pausedOnce = false;
      const tx = {
        query: async (text, params) => {
          const result = await client.query(text, params);
          if (!pausedOnce && text.includes(pauseAfterTextIncludes)) {
            pausedOnce = true;
            resolvePaused();
            await resumeGate;
          }
          return result;
        },
      };
      try {
        await client.query("BEGIN");
        const result = await callback(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    return { runInTransaction: pausedRunInTransaction, paused, resume: () => releaseResume() };
  }

  function actorContext(role, organizationId, userId = crypto.randomUUID()) {
    return {
      actorType: "human",
      actorUserId: userId,
      kaiRoles: [],
      organizationMemberships: [
        { organization_id: organizationId, role_name: role, membership_status: "active" },
      ],
    };
  }

  const trueEnv = { KAI_SPRINT2_ENABLED: "true" };

  // ---------------------------------------------------------------------
  // Fixtures - identical shape to the existing C3.A3.B / C3.B2 integration
  // suites (same schema, same minimal real evidence/claim lineage). Each
  // test uses a fresh organization_id, so no cross-test TRUNCATE is needed.
  // ---------------------------------------------------------------------
  async function makeRequirement(keySuffix, key) {
    const suffix = `${keySuffix}_${Math.random().toString(36).slice(2)}`;
    const source = (
      await pool.query(
        "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('kai_standard', $1, 'C3.B2.C Fixture Source') RETURNING requirement_source_id",
        [`src_${suffix}`],
      )
    ).rows[0].requirement_source_id;
    const frameworkVersion = (
      await pool.query(
        "INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label) VALUES ($1, 'fw', 'Framework', 'v1') RETURNING requirement_framework_version_id",
        [source],
      )
    ).rows[0].requirement_framework_version_id;
    const set = (
      await pool.query(
        "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, 'set', 'Set') RETURNING requirement_set_id",
        [frameworkVersion],
      )
    ).rows[0].requirement_set_id;
    const requirement = (
      await pool.query(
        "INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, display_order) VALUES ($1, $2, 'Requirement', 0) RETURNING *",
        [set, key],
      )
    ).rows[0];
    return requirement;
  }

  async function buildEvidenceClaim(organizationId, suffix) {
    const checksum = sha256hex(`checksum|${suffix}`);
    const profileSha = sha256hex(`profile|${suffix}`);
    const sourceCode = sha256hex(`source|${suffix}`);
    const statementFingerprint = sha256hex(`evidence-statement|${suffix}`);
    const claimFingerprint = sha256hex(`claim-statement|${suffix}`);
    const locatorFingerprint = sha256hex(`locator|${suffix}`);

    const intakeFileId = (
      await pool.query(
        `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename, checksum, hash_algorithm)
         VALUES (gen_random_uuid(), gen_random_uuid(), $1, $2, $2, $3, 'sha256') RETURNING intake_file_id`,
        [organizationId, `f-${suffix}.csv`, checksum],
      )
    ).rows[0].intake_file_id;

    const parserRunId = (
      await pool.query(
        `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
         VALUES ($1, $2, 'csv_parser', 'v1', $3, 'running', now()) RETURNING parser_run_id`,
        [organizationId, intakeFileId, checksum],
      )
    ).rows[0].parser_run_id;

    const fileProfileId = (
      await pool.query(
        `INSERT INTO kai.intake_file_profiles (organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256)
         VALUES ($1, $2, $3, 'csv_parser', 'v1', $4, $5::jsonb, $6) RETURNING file_profile_id`,
        [organizationId, intakeFileId, parserRunId, checksum, JSON.stringify({ field_count: 1 }), profileSha],
      )
    ).rows[0].file_profile_id;

    await pool.query(
      `UPDATE kai.intake_parser_runs SET parser_status = 'completed', completed_at = now(), output_profile_id = $1 WHERE parser_run_id = $2`,
      [fileProfileId, parserRunId],
    );

    const dataDictionaryId = (
      await pool.query(
        `INSERT INTO kai.data_dictionaries (organization_id, intake_file_id, file_profile_id, profile_canonical_sha256)
         VALUES ($1, $2, $3, $4) RETURNING data_dictionary_id`,
        [organizationId, intakeFileId, fileProfileId, profileSha],
      )
    ).rows[0].data_dictionary_id;

    await pool.query(
      `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type)
       VALUES ($1, $2, $3, 'signup_count', 'Signup Count', 'number')`,
      [dataDictionaryId, organizationId, fileProfileId],
    );

    const sensitivityId = (
      await pool.query(
        `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
         VALUES ($1, $2, $3, $4, $5) RETURNING intake_sensitivity_profile_id`,
        [organizationId, intakeFileId, fileProfileId, dataDictionaryId, profileSha],
      )
    ).rows[0].intake_sensitivity_profile_id;

    const candidateId = (
      await pool.query(
        `INSERT INTO kai.intake_source_candidates (organization_id, intake_file_id, file_profile_id, data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256, candidate_status)
         VALUES ($1, $2, $3, $4, $5, $6, 'needs_gk_review') RETURNING intake_source_candidate_id`,
        [organizationId, intakeFileId, fileProfileId, dataDictionaryId, sensitivityId, profileSha],
      )
    ).rows[0].intake_source_candidate_id;

    const reviewItemId = (
      await pool.query(
        `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary, required_action)
         VALUES ($1, 'source_candidate_review', 'intake_source_candidate', $2, 'Review candidate.', 'Human review required.') RETURNING review_queue_item_id`,
        [organizationId, candidateId],
      )
    ).rows[0].review_queue_item_id;

    await pool.query(`UPDATE kai.intake_source_candidates SET candidate_status = 'promoted' WHERE intake_source_candidate_id = $1`, [candidateId]);
    await pool.query(`UPDATE kai.review_queue_items SET queue_status = 'resolved', review_status = 'resolved' WHERE review_queue_item_id = $1`, [reviewItemId]);

    const sourceId = (
      await pool.query(
        `INSERT INTO kai.sources (organization_id, source_code, reviewed_source_type, created_by_type)
         VALUES ($1, $2, 'organization_primary_record', 'human') RETURNING source_id`,
        [organizationId, sourceCode],
      )
    ).rows[0].source_id;

    const sourceVersionId = (
      await pool.query(
        `INSERT INTO kai.source_versions (organization_id, source_id, intake_source_candidate_id, intake_sensitivity_profile_id, profile_canonical_sha256, created_by_type)
         VALUES ($1, $2, $3, $4, $5, 'human') RETURNING source_version_id`,
        [organizationId, sourceId, candidateId, sensitivityId, profileSha],
      )
    ).rows[0].source_version_id;

    await pool.query(
      `INSERT INTO kai.intake_promotion_decisions (organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type, decision_status, source_id, source_version_id, promoted_at, created_by_type)
       VALUES ($1, $2, $3, 'organization_primary_record', 'promoted', $4, $5, now(), 'human')`,
      [organizationId, candidateId, reviewItemId, sourceId, sourceVersionId],
    );

    const sourceLocatorId = (
      await pool.query(
        `INSERT INTO kai.source_locators (organization_id, source_version_id, locator_type, coordinates, locator_fingerprint, created_by_type)
         VALUES ($1, $2, 'column', $3::jsonb, $4, 'system') RETURNING source_locator_id`,
        [organizationId, sourceVersionId, JSON.stringify({ column_name: "signup_count" }), locatorFingerprint],
      )
    ).rows[0].source_locator_id;

    const evidenceItemId = (
      await pool.query(
        `INSERT INTO kai.evidence_items (organization_id, source_id, source_version_id, source_locator_id, evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type)
         VALUES ($1, $2, $3, $4, 'dictionary_field_presence_fact', 'organization_committed_metadata', 'unknown', 'unassessed', 'Signup count field is present.', $5, 'system') RETURNING evidence_item_id`,
        [organizationId, sourceId, sourceVersionId, sourceLocatorId, statementFingerprint],
      )
    ).rows[0].evidence_item_id;

    const claimId = (
      await pool.query(
        `INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
         VALUES ($1, $2, 'finding', 'proposed', 'needs_gk_review', 'unassessed', 'Signups were recorded.', $3, 'system') RETURNING claim_id`,
        [organizationId, evidenceItemId, claimFingerprint],
      )
    ).rows[0].claim_id;

    return { evidenceItemId, claimId, sourceVersionId };
  }

  async function insertClaimDecision(organizationId, claimId, outcome, { supersedes = null, decidedBy = crypto.randomUUID(), decidedByRole = "gk_reviewer" } = {}) {
    const limitationNotes = outcome === "approved_with_limitation" ? ["Small sample size."] : null;
    const approvedAudiences = outcome === "approved" || outcome === "approved_with_limitation" ? ["internal"] : null;
    const { rows } = await pool.query(
      `INSERT INTO kai.claim_review_decisions
         (organization_id, claim_id, review_queue_item_id, decision_outcome, limitation_notes, approved_audiences, decided_by, decided_by_role, target_updated_at, supersedes_decision_id, created_by_type)
       VALUES ($1, $2, gen_random_uuid(), $3, $4, $5, $6, $7, now(), $8, 'human')
       RETURNING decision_id::text AS decision_id`,
      [organizationId, claimId, outcome, limitationNotes, approvedAudiences, decidedBy, decidedByRole, supersedes],
    );
    return { decisionId: rows[0].decision_id, decidedBy, decidedByRole };
  }

  async function readAssessmentRowById(requirementAssessmentId) {
    const { rows } = await pool.query(
      `SELECT requirement_assessment_id::text AS requirement_assessment_id, assessment_state, state_fingerprint, created_at
         FROM kai.requirement_assessments WHERE requirement_assessment_id = $1`,
      [requirementAssessmentId],
    );
    return rows[0] || null;
  }

  async function claimDecisionLinkDecisionIds(requirementAssessmentId) {
    const { rows } = await pool.query(
      `SELECT decision_id::text AS decision_id FROM kai.ra_claim_review_decision_links WHERE requirement_assessment_id = $1 ORDER BY decision_id`,
      [requirementAssessmentId],
    );
    return rows.map((row) => row.decision_id);
  }

  async function countAllAssessmentRows(organizationId, requirementId) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.requirement_assessments WHERE organization_id = $1 AND requirement_id = $2`,
      [organizationId, requirementId],
    );
    return rows[0].n;
  }

  async function auditEventCount(organizationId) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM kai.audit_events WHERE organization_id = $1`, [organizationId]);
    return rows[0].n;
  }

  // -----------------------------------------------------------------------
  // Both requirement keys share the exact same
  // postgresRequirementAssessmentRepository.js write/read transaction path
  // (assessOrganizationRequirement / readOrganizationRequirementAssessment) -
  // only the pure loadInputs/deriveState/computeFingerprint functions differ
  // per key. Running the same two-connection race against BOTH proves the
  // currentness guarantee is a property of the shared path, not an accident
  // of one requirement's own vocabulary.
  // -----------------------------------------------------------------------
  const REQUIREMENT_KEYS = [IR_COMM_002_KEY, IR_CONTRIB_002_KEY];

  for (const requirementKey of REQUIREMENT_KEYS) {
    test(`RACE A [${requirementKey}]: absence becomes decision underneath a paused assessment transaction never surfaces as current`, async () => {
      const orgA = crypto.randomUUID();
      const requirement = await makeRequirement(`racea_${requirementKey}`, requirementKey);
      const fixture = await buildEvidenceClaim(orgA, `racea-${requirementKey}`);

      const { runInTransaction: pausedRunInTransaction, paused, resume } = createPausedRunInTransaction("kai.claim_review_decisions");
      const repositoryT1 = createPostgresRequirementAssessmentRepository({ runInTransaction: pausedRunInTransaction });

      // T1 BEGIN; T1 loads claim X and observes NO current claim_review_decision.
      const t1Promise = assessOrganizationRequirement({
        organizationId: orgA,
        requirementId: requirement.requirement_id,
        actorContext: actorContext("gk_reviewer", orgA),
        now: new Date().toISOString(),
      }, { env: trueEnv, requirementAssessmentRepository: repositoryT1 });

      await paused; // T1 is now paused, having already read "no current decision".

      // T2 inserts the first valid decision for X and commits, fully
      // independently of T1's still-open transaction.
      const decision = await insertClaimDecision(orgA, fixture.claimId, "approved");

      resume(); // RESUME T1
      const t1Result = await t1Promise;

      // --- T1 operation result / persisted row ---
      assert.equal(t1Result.ok, true, "T1 must still complete (append-only write, not a hard failure)");
      assert.equal(t1Result.data.replayed, false);
      const t1AssessmentId = t1Result.data.requirement_assessment_id;
      const persistedRow = await readAssessmentRowById(t1AssessmentId);
      assert.ok(persistedRow, "T1's row must have committed");
      const t1DecisionLinks = await claimDecisionLinkDecisionIds(t1AssessmentId);
      assert.deepEqual(t1DecisionLinks, [], "T1's committed provenance must reflect the ABSENCE it actually read, never T2's decision");

      // --- subsequent GET / current-read result ---
      const freshRead = await getOrganizationRequirementAssessment({
        organizationId: orgA,
        requirementId: requirement.requirement_id,
        actorContext: actorContext("gk_operator", orgA),
      }, { env: trueEnv, requirementAssessmentRepository: repository });

      // The freshly recomputed fingerprint now reflects T2's committed
      // decision, which cannot equal T1's stale (no-decision) fingerprint -
      // so the current-read must NOT resolve to T1's stale row.
      assert.equal(freshRead.ok, false);
      assert.equal(freshRead.error.code, "not_found");

      // A fresh assessment call (unpaused, normal path) must now see the new
      // material state and mint a brand-new row/fingerprint - never replay
      // T1's stale row as current.
      const secondAssessment = await assessOrganizationRequirement({
        organizationId: orgA,
        requirementId: requirement.requirement_id,
        actorContext: actorContext("gk_reviewer", orgA),
        now: new Date().toISOString(),
      }, { env: trueEnv, requirementAssessmentRepository: repository });
      assert.equal(secondAssessment.ok, true);
      assert.equal(secondAssessment.data.replayed, false);
      assert.notEqual(secondAssessment.data.requirement_assessment_id, t1AssessmentId);
      assert.notEqual(secondAssessment.data.state_fingerprint, persistedRow.state_fingerprint);
      const secondDecisionLinks = await claimDecisionLinkDecisionIds(secondAssessment.data.requirement_assessment_id);
      assert.deepEqual(secondDecisionLinks, [decision.decisionId]);

      // The now-current read must resolve to the SECOND row, never T1's.
      const readBack = await getOrganizationRequirementAssessment({
        organizationId: orgA,
        requirementId: requirement.requirement_id,
        actorContext: actorContext("gk_operator", orgA),
      }, { env: trueEnv, requirementAssessmentRepository: repository });
      assert.equal(readBack.ok, true);
      assert.equal(readBack.data.assessment.requirement_assessment_id, secondAssessment.data.requirement_assessment_id);
      assert.notEqual(readBack.data.assessment.requirement_assessment_id, t1AssessmentId);

      // Historical row remains intact and correctly interpretable as what it
      // actually was at the time T1 read its inputs (append-only, never
      // mutated to reflect T2's later decision).
      const t1RowAfter = await readAssessmentRowById(t1AssessmentId);
      assert.equal(t1RowAfter.state_fingerprint, persistedRow.state_fingerprint);
      assert.equal(await countAllAssessmentRows(orgA, requirement.requirement_id), 2);
    });

    test(`RACE B [${requirementKey}]: decision head A superseded by B underneath a paused assessment transaction never surfaces as current`, async () => {
      const orgA = crypto.randomUUID();
      const requirement = await makeRequirement(`raceb_${requirementKey}`, requirementKey);
      const fixture = await buildEvidenceClaim(orgA, `raceb-${requirementKey}`);
      const decisionA = await insertClaimDecision(orgA, fixture.claimId, "approved", { decidedBy: crypto.randomUUID() });

      const { runInTransaction: pausedRunInTransaction, paused, resume } = createPausedRunInTransaction("kai.claim_review_decisions");
      const repositoryT1 = createPostgresRequirementAssessmentRepository({ runInTransaction: pausedRunInTransaction });

      // T1 BEGIN; T1 loads A as the current decision.
      const t1Promise = assessOrganizationRequirement({
        organizationId: orgA,
        requirementId: requirement.requirement_id,
        actorContext: actorContext("gk_reviewer", orgA),
        now: new Date().toISOString(),
      }, { env: trueEnv, requirementAssessmentRepository: repositoryT1 });

      await paused; // T1 is now paused, having already read decision A as current.

      // T2 inserts valid decision B superseding A, and commits.
      const decisionB = await insertClaimDecision(orgA, fixture.claimId, "rejected", {
        supersedes: decisionA.decisionId,
        decidedBy: crypto.randomUUID(),
      });

      resume(); // RESUME T1
      const t1Result = await t1Promise;

      // --- T1 operation result / persisted row ---
      assert.equal(t1Result.ok, true);
      assert.equal(t1Result.data.replayed, false);
      const t1AssessmentId = t1Result.data.requirement_assessment_id;
      const persistedRow = await readAssessmentRowById(t1AssessmentId);
      assert.ok(persistedRow);
      const t1DecisionLinks = await claimDecisionLinkDecisionIds(t1AssessmentId);
      assert.deepEqual(t1DecisionLinks, [decisionA.decisionId], "T1's committed provenance must cite A (what it actually read), never B");

      // --- subsequent GET / current-read result ---
      const freshRead = await getOrganizationRequirementAssessment({
        organizationId: orgA,
        requirementId: requirement.requirement_id,
        actorContext: actorContext("gk_operator", orgA),
      }, { env: trueEnv, requirementAssessmentRepository: repository });
      assert.equal(freshRead.ok, false);
      assert.equal(freshRead.error.code, "not_found");

      // A fresh assessment call must see B, not A, and mint a distinct row.
      const secondAssessment = await assessOrganizationRequirement({
        organizationId: orgA,
        requirementId: requirement.requirement_id,
        actorContext: actorContext("gk_reviewer", orgA),
        now: new Date().toISOString(),
      }, { env: trueEnv, requirementAssessmentRepository: repository });
      assert.equal(secondAssessment.ok, true);
      assert.equal(secondAssessment.data.replayed, false);
      assert.notEqual(secondAssessment.data.requirement_assessment_id, t1AssessmentId);
      assert.notEqual(secondAssessment.data.state_fingerprint, persistedRow.state_fingerprint);
      const secondDecisionLinks = await claimDecisionLinkDecisionIds(secondAssessment.data.requirement_assessment_id);
      assert.deepEqual(secondDecisionLinks, [decisionB.decisionId]);

      const readBack = await getOrganizationRequirementAssessment({
        organizationId: orgA,
        requirementId: requirement.requirement_id,
        actorContext: actorContext("gk_operator", orgA),
      }, { env: trueEnv, requirementAssessmentRepository: repository });
      assert.equal(readBack.ok, true);
      assert.equal(readBack.data.assessment.requirement_assessment_id, secondAssessment.data.requirement_assessment_id);
      assert.notEqual(readBack.data.assessment.requirement_assessment_id, t1AssessmentId);

      // Historical (A-based) row remains intact and correctly interpretable.
      const t1RowAfter = await readAssessmentRowById(t1AssessmentId);
      assert.equal(t1RowAfter.state_fingerprint, persistedRow.state_fingerprint);
      assert.equal(await countAllAssessmentRows(orgA, requirement.requirement_id), 2);
    });
  }

  test("REPLAY GUARD: unchanged material state across a paused/resumed transaction still replays as a true no-op (zero new provenance, zero new audit)", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("replay_guard", IR_COMM_002_KEY);
    const fixture = await buildEvidenceClaim(orgA, "replay-guard");
    const decision = await insertClaimDecision(orgA, fixture.claimId, "approved");

    // Establish the current row first (normal, unpaused path).
    const first = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(first.ok, true);
    const beforeAudit = await auditEventCount(orgA);

    const { runInTransaction: pausedRunInTransaction, paused, resume } = createPausedRunInTransaction("kai.claim_review_decisions");
    const repositoryT1 = createPostgresRequirementAssessmentRepository({ runInTransaction: pausedRunInTransaction });

    const t1Promise = assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repositoryT1 });

    await paused;
    // No concurrent state change this time - material state is unchanged
    // while T1 sits paused.
    resume();
    const t1Result = await t1Promise;

    assert.equal(t1Result.ok, true);
    assert.equal(t1Result.data.replayed, true, "unchanged state must still replay, even across a paused/resumed transaction");
    assert.equal(t1Result.data.requirement_assessment_id, first.data.requirement_assessment_id);
    assert.equal(await countAllAssessmentRows(orgA, requirement.requirement_id), 1);
    assert.equal(await auditEventCount(orgA), beforeAudit);
    assert.deepEqual(await claimDecisionLinkDecisionIds(first.data.requirement_assessment_id), [decision.decisionId]);
  });
}
