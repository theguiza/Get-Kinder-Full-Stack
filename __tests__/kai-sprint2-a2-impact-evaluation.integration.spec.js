import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_A2_IMPACT_EVALUATION_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`A2 impact-evaluation integration suite refused a non-loopback KAI_A2_IMPACT_EVALUATION_DATABASE_URL host: ${host}`);
  }
}

test("A2 impact-evaluation PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("A2 impact-evaluation PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresImpactEvaluationRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("A2 impact-evaluation integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runA2IntegrationSuite();
}

async function runA2IntegrationSuite() {
  const { Pool } = await import("pg");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresImpactEvaluationRepository } = await import("../Backend/kai/dictionary/postgresImpactEvaluationRepository.js");
  const { createImpactEvaluation } = await import("../Backend/kai/services/kaiImpactEvaluationService.js");
  const { createProductionMetadataOnlyAuditForImpactEvaluation } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const NOW = "2026-09-02T10:00:00.000Z";
  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 10 });
  const transactionLog = [];

  async function withRunnerOwnedTransaction(callback) {
    const client = await pool.connect();
    const wrapped = {
      async query(sql, params) {
        transactionLog.push(String(sql));
        return client.query(sql, params);
      },
    };
    try {
      transactionLog.push("BEGIN");
      await client.query("BEGIN");
      const result = await callback(wrapped);
      transactionLog.push("COMMIT");
      await client.query("COMMIT");
      return result;
    } catch (error) {
      transactionLog.push("ROLLBACK");
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const actorContext = Object.freeze({
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
    ],
  });

  function auditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  const evidenceRepo = createPostgresEvidenceLineageRepository({ runInTransaction: withRunnerOwnedTransaction });
  const claimRepo = createPostgresClaimProposalRepository({ runInTransaction: withRunnerOwnedTransaction });

  test.after(async () => {
    await pool.end();
  });

  async function query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  }

  async function count(sql, params = []) {
    return (await query(sql, params))[0].count;
  }

  // A2's own deterministic evaluator seam (already exercised by
  // __tests__/kai-sprint2-a2-2-impact-evaluation-persistence.spec.js and
  // __tests__/kai-sprint2-a2-3-impact-evaluation-acceptance.spec.js): stands
  // in for the full P2-06 claim-traceability recomputation, which is P2-06's
  // own concern, not A2's. It never writes anything.
  function deterministicEligibleEvaluator(evidenceItemId) {
    return async (_tx, { claimId, requestedAudience }) => ({
      ok: true,
      data: {
        claim: { claim_id: claimId },
        evidence: { evidence_item_id: evidenceItemId },
        requestedAudience,
        eligible: true,
        blockerCodes: [],
      },
    });
  }

  let fixtures;
  async function prepareFixtures() {
    if (fixtures) return fixtures;

    await pool.query(
      `INSERT INTO kai.organizations (organization_id, name) VALUES ($1::uuid, 'A2 Synthetic Org')
         ON CONFLICT (organization_id) DO NOTHING`,
      [ORG],
    );

    // Real A2.1/A2.2 write path via the real, unmocked P2-01/P2-03 services
    // -- exactly as the existing P2-06 integration suite's own
    // prepareTwoClaims() helper does -- against the one real source_version
    // the Gate A/P1/P2-01 migration+smoke-seed chain already committed for
    // this organization.
    const sourceVersions = await query(
      `SELECT source_version_id
         FROM kai.source_versions
        WHERE organization_id = $1::uuid
          AND is_current = true
        ORDER BY source_version_id
        LIMIT 1`,
      [ORG],
    );
    const evidenceResult = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: sourceVersions[0].source_version_id, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceLineageRepository: evidenceRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceResult.ok, true, JSON.stringify(evidenceResult));
    const evidenceRows = await query(
      `SELECT evidence_item_id FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY evidence_item_id LIMIT 1`,
      [ORG],
    );
    const evidenceItemId = evidenceRows[0].evidence_item_id;
    const claimResult = await proposeClaim(
      { organizationId: ORG, evidenceItemId, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: claimRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(claimResult.ok, true, JSON.stringify(claimResult));
    const claimId = claimResult.data.claim.claim_id;

    // A1.1/A1.2 methodology fixtures: real INSERTs against the real A1
    // schema (never invented tables), mirroring the acceptance spec's own
    // "100 target-population participants" scenario.
    const outcomeContextId = "00000000-0000-4000-8000-0000000a0010";
    const frameworkVersionId = "00000000-0000-4000-8000-0000000a0020";
    const criterionWhat = "00000000-0000-4000-8000-0000000a0301";
    const criterionWho = "00000000-0000-4000-8000-0000000a0302";
    const criterionHowMuch = "00000000-0000-4000-8000-0000000a0303";
    const criterionContribution = "00000000-0000-4000-8000-0000000a0304";

    await pool.query(
      `INSERT INTO kai.impact_outcome_contexts (
         impact_outcome_context_id, organization_id, outcome_key, outcome_statement, stakeholder_key, stakeholder_label
       ) VALUES (
         $1::uuid, $2::uuid, 'school_readiness',
         'Target-population participants achieve the intended program outcome.',
         'target_population_participants', 'Target-population participants'
       )`,
      [outcomeContextId, ORG],
    );
    await pool.query(
      `INSERT INTO kai.impact_evaluation_framework_versions (
         framework_version_id, framework_code, framework_name, version_label, framework_status
       ) VALUES ($1::uuid, 'kai_core', 'KAI Core Impact Framework', 'v1', 'active')`,
      [frameworkVersionId],
    );
    const criteria = [
      [criterionWhat, "what", "What changed", "What outcome or change is claimed for the stakeholder.", "Assess whether the evidence demonstrates an outcome/change, not only reach.", 0],
      [criterionWho, "who", "Who benefited", "Who experienced the change.", "Assess whether the evidence identifies the stakeholder population.", 1],
      [criterionHowMuch, "how_much", "How much changed", "The magnitude of the outcome/change.", "Assess whether the evidence quantifies the outcome/change, not only reach.", 2],
      [criterionContribution, "contribution", "Organizational contribution", "The organization's contribution to the outcome/change.", "Assess whether the evidence addresses the organization's causal contribution.", 3],
    ];
    for (const [criterionId, key, label, description, guidance, displayOrder] of criteria) {
      await pool.query(
        `INSERT INTO kai.impact_evaluation_criteria (
           criterion_id, framework_version_id, criterion_key, criterion_label, description, evaluation_guidance, display_order
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)`,
        [criterionId, frameworkVersionId, key, label, description, guidance, displayOrder],
      );
    }

    fixtures = {
      evidenceItemId,
      claimId,
      outcomeContextId,
      frameworkVersionId,
      criterionWhat,
      criterionWho,
      criterionHowMuch,
      criterionContribution,
    };
    return fixtures;
  }

  // The exact canonical acceptance mock the task requires -- unchanged from
  // __tests__/kai-sprint2-a2-3-impact-evaluation-acceptance.spec.js.
  function acceptanceGeneratorResults(f) {
    return [
      {
        criterionId: f.criterionWhat,
        assessmentState: "needs_more_information",
        safeExplanation:
          "Reach is demonstrated: the governed claim shows 100 target-population participants were served during the reporting period. Participant outcome or change is not demonstrated by the currently governed evidence.",
        limitationNotes: null,
        claimIds: [f.claimId],
        evidenceItemIds: [f.evidenceItemId],
      },
      {
        criterionId: f.criterionWho,
        assessmentState: "supported",
        safeExplanation: "The governed claim explicitly identifies target-population participants as the stakeholder served.",
        limitationNotes: null,
        claimIds: [f.claimId],
        evidenceItemIds: [f.evidenceItemId],
      },
      {
        criterionId: f.criterionHowMuch,
        assessmentState: "needs_more_information",
        safeExplanation: "The governed claim quantifies reach at 100 participants, but does not quantify any outcome or change magnitude.",
        limitationNotes: null,
        claimIds: [f.claimId],
        evidenceItemIds: [f.evidenceItemId],
      },
      {
        criterionId: f.criterionContribution,
        assessmentState: "needs_more_information",
        safeExplanation: "No governed evidence addresses the organization's causal contribution to any outcome or change.",
        limitationNotes: null,
        claimIds: [],
        evidenceItemIds: [],
      },
    ];
  }

  function serviceInput(f) {
    return {
      organizationId: ORG,
      impactOutcomeContextId: f.outcomeContextId,
      frameworkVersionId: f.frameworkVersionId,
      requestedAudience: "internal",
      claimIds: [f.claimId],
      actorContext,
      now: NOW,
    };
  }

  test("A2 real-PostgreSQL acceptance: the canonical 100-participant reach scenario persists through the real service+repository+audit path and commits", async () => {
    const f = await prepareFixtures();
    transactionLog.length = 0;

    const repository = createPostgresImpactEvaluationRepository({
      runInTransaction: withRunnerOwnedTransaction,
      evaluator: deterministicEligibleEvaluator(f.evidenceItemId),
    });

    const beforeAuditCount = await count(`SELECT count(*)::int AS count FROM kai.audit_events`);
    const beforeEvalCount = await count(`SELECT count(*)::int AS count FROM kai.impact_evaluations WHERE organization_id = $1::uuid`, [ORG]);

    const result = await createImpactEvaluation(serviceInput(f), {
      env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
      impactEvaluationRepository: repository,
      impactEvaluationGenerator: async () => ({ results: acceptanceGeneratorResults(f) }),
      metadataOnlyAudit: createProductionMetadataOnlyAuditForImpactEvaluation({
        organizationId: ORG,
        impactOutcomeContextId: f.outcomeContextId,
        actorContext,
        now: NOW,
      }),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.results.length, 4);

    // The canonical A2 acceptance result.
    assert.deepEqual(result.data.classification, {
      classification: "OUTPUT_REACH",
      criterionKey: "what",
      assessmentState: "needs_more_information",
    });
    const byKey = Object.fromEntries(result.data.results.map((row) => [row.criterionKey, row]));
    assert.equal(byKey.who.assessmentState, "supported");
    assert.equal(byKey.what.assessmentState, "needs_more_information");
    assert.equal(byKey.how_much.assessmentState, "needs_more_information");
    assert.equal(byKey.contribution.assessmentState, "needs_more_information");
    const whatGap = result.data.gaps.find((gap) => gap.criterionKey === "what");
    assert.ok(whatGap);
    assert.equal(whatGap.gapReason, "Outcome-change evidence is absent.");
    const whatRecommendation = result.data.recommendations.find((rec) => rec.criterionKey === "what");
    assert.ok(whatRecommendation);
    assert.equal(whatRecommendation.advisory, true);
    assert.equal(
      whatRecommendation.recommendation,
      "Define/confirm the intended participant outcome, associate an appropriate indicator, and establish follow-up measurement.",
    );

    // COMMIT proof: reread through the pool (a connection independent of the
    // one the write transaction used) against real PostgreSQL.
    const evaluationRows = await query(
      `SELECT impact_evaluation_id, organization_id, impact_outcome_context_id, framework_version_id
         FROM kai.impact_evaluations WHERE impact_evaluation_id = $1::uuid`,
      [result.data.impactEvaluationId],
    );
    assert.equal(evaluationRows.length, 1);
    assert.equal(evaluationRows[0].organization_id, ORG);
    assert.equal(evaluationRows[0].impact_outcome_context_id, f.outcomeContextId);

    const resultRows = await query(
      `SELECT criterion_id, assessment_state, safe_explanation
         FROM kai.impact_evaluation_results WHERE impact_evaluation_id = $1::uuid`,
      [result.data.impactEvaluationId],
    );
    assert.equal(resultRows.length, 4);

    const evidenceLinkRows = await query(
      `SELECT l.evidence_item_id
         FROM kai.impact_evaluation_result_evidence_links l
         JOIN kai.impact_evaluation_results r ON r.impact_evaluation_result_id = l.impact_evaluation_result_id
        WHERE r.impact_evaluation_id = $1::uuid`,
      [result.data.impactEvaluationId],
    );
    assert.equal(evidenceLinkRows.length, 3);
    assert.ok(evidenceLinkRows.every((row) => row.evidence_item_id === f.evidenceItemId));

    const claimLinkRows = await query(
      `SELECT l.claim_id
         FROM kai.impact_evaluation_result_claim_links l
         JOIN kai.impact_evaluation_results r ON r.impact_evaluation_result_id = l.impact_evaluation_result_id
        WHERE r.impact_evaluation_id = $1::uuid`,
      [result.data.impactEvaluationId],
    );
    assert.equal(claimLinkRows.length, 3);
    assert.ok(claimLinkRows.every((row) => row.claim_id === f.claimId));

    // Required audit: a real row was committed to kai.audit_events.
    const afterAuditCount = await count(`SELECT count(*)::int AS count FROM kai.audit_events`);
    assert.equal(afterAuditCount, beforeAuditCount + 1);
    const [auditRow] = await query(
      `SELECT organization_id, action, object_type, metadata FROM kai.audit_events ORDER BY audit_event_id DESC LIMIT 1`,
    );
    assert.equal(auditRow.organization_id, ORG);
    assert.equal(auditRow.metadata.object_id, result.data.impactEvaluationId);
    assert.equal(auditRow.metadata.operation, "a2_02_impact_evaluation_created");

    const afterEvalCount = await count(`SELECT count(*)::int AS count FROM kai.impact_evaluations WHERE organization_id = $1::uuid`, [ORG]);
    assert.equal(afterEvalCount, beforeEvalCount + 1);

    // COMMIT actually ran, never a leftover open transaction.
    assert.ok(transactionLog.includes("COMMIT"));
    assert.ok(!transactionLog.includes("ROLLBACK"));

    // Evidence/claims/review/audience authority remain unchanged: no UPDATE
    // or DELETE ran anywhere, and no write touched kai.claims/kai.evidence_items.
    assert.ok(!transactionLog.some((sql) => /UPDATE|DELETE/i.test(sql)));
    assert.ok(!transactionLog.some((sql) => /INSERT INTO kai\.(claims|evidence_items)/i.test(sql)));
    const [claimRow] = await query(
      `SELECT claim_status, claim_review_status, internal_only FROM kai.claims WHERE claim_id = $1::uuid`,
      [f.claimId],
    );
    assert.equal(claimRow.claim_status, "proposed");
    assert.equal(claimRow.claim_review_status, "needs_gk_review");
    assert.equal(claimRow.internal_only, true);
    const [evidenceRow] = await query(
      `SELECT evidence_review_status, internal_only FROM kai.evidence_items WHERE evidence_item_id = $1::uuid`,
      [f.evidenceItemId],
    );
    assert.equal(evidenceRow.evidence_review_status, "needs_gk_review");
    assert.equal(evidenceRow.internal_only, true);
  });

  test("A2 real-PostgreSQL rollback: a rejected required audit after writes have begun leaves zero new rows and 0 successful audit rows", async () => {
    const f = await prepareFixtures();
    transactionLog.length = 0;

    const repository = createPostgresImpactEvaluationRepository({
      runInTransaction: withRunnerOwnedTransaction,
      evaluator: deterministicEligibleEvaluator(f.evidenceItemId),
    });

    const beforeAuditCount = await count(`SELECT count(*)::int AS count FROM kai.audit_events`);
    const beforeEvalCount = await count(`SELECT count(*)::int AS count FROM kai.impact_evaluations WHERE organization_id = $1::uuid`, [ORG]);
    const beforeResultCount = await count(
      `SELECT count(*)::int AS count FROM kai.impact_evaluation_results r
         JOIN kai.impact_evaluations e ON e.impact_evaluation_id = r.impact_evaluation_id
        WHERE e.organization_id = $1::uuid`,
      [ORG],
    );
    const beforeEvidenceLinkCount = await count(
      `SELECT count(*)::int AS count FROM kai.impact_evaluation_result_evidence_links WHERE organization_id = $1::uuid`,
      [ORG],
    );
    const beforeClaimLinkCount = await count(
      `SELECT count(*)::int AS count FROM kai.impact_evaluation_result_claim_links WHERE organization_id = $1::uuid`,
      [ORG],
    );

    // Existing A2 post-write/audit failure seam (unchanged from
    // __tests__/kai-sprint2-a2-2-impact-evaluation-persistence.spec.js'
    // fakeMetadataOnlyAudit({ shouldFail: true })): an unusable prepared
    // audit forces postgresImpactEvaluationRepository.js's
    // createImpactEvaluationSnapshot to roll the whole write back after the
    // evaluation/result/provenance rows have already been INSERTed inside
    // this same real PostgreSQL transaction. No schema is broken to produce
    // this failure.
    const rejectingAudit = {
      prepareMetadataOnlyAudit() {
        return { ok: false };
      },
    };

    const result = await createImpactEvaluation(serviceInput(f), {
      env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
      impactEvaluationRepository: repository,
      impactEvaluationGenerator: async () => ({ results: acceptanceGeneratorResults(f) }),
      metadataOnlyAudit: rejectingAudit,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "system_error");

    // The write did reach real INSERTs before the audit rejection rolled it back.
    assert.ok(transactionLog.some((sql) => /INSERT INTO kai\.impact_evaluations/.test(sql)));
    assert.ok(transactionLog.some((sql) => /INSERT INTO kai\.impact_evaluation_results/.test(sql)));
    assert.ok(transactionLog.includes("ROLLBACK"));
    assert.ok(!transactionLog.includes("COMMIT"));

    const afterAuditCount = await count(`SELECT count(*)::int AS count FROM kai.audit_events`);
    const afterEvalCount = await count(`SELECT count(*)::int AS count FROM kai.impact_evaluations WHERE organization_id = $1::uuid`, [ORG]);
    const afterResultCount = await count(
      `SELECT count(*)::int AS count FROM kai.impact_evaluation_results r
         JOIN kai.impact_evaluations e ON e.impact_evaluation_id = r.impact_evaluation_id
        WHERE e.organization_id = $1::uuid`,
      [ORG],
    );
    const afterEvidenceLinkCount = await count(
      `SELECT count(*)::int AS count FROM kai.impact_evaluation_result_evidence_links WHERE organization_id = $1::uuid`,
      [ORG],
    );
    const afterClaimLinkCount = await count(
      `SELECT count(*)::int AS count FROM kai.impact_evaluation_result_claim_links WHERE organization_id = $1::uuid`,
      [ORG],
    );

    assert.equal(afterAuditCount, beforeAuditCount, "0 successful audit rows must be committed");
    assert.equal(afterEvalCount, beforeEvalCount, "0 new evaluations must be committed");
    assert.equal(afterResultCount, beforeResultCount, "0 new criterion results must be committed");
    assert.equal(afterEvidenceLinkCount, beforeEvidenceLinkCount, "0 new evidence provenance links must be committed");
    assert.equal(afterClaimLinkCount, beforeClaimLinkCount, "0 new claim provenance links must be committed");
  });
}
