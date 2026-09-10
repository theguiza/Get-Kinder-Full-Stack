// KAI P14-09 authority-source repair: the real P2-06 evaluator
// (evaluateClaimTraceabilityInTransaction) grants requestedAudience="funder"
// eligibility through the claim-review decision ledger (P2-12) plus the
// Phase-5 effective-funder-authority resolver
// (postgresEffectiveFunderAuthorityResolver.js) - never through the legacy
// claims.funder_use_allowed column, which stays schema-pinned false. Before
// this repair, generated-content generation's loadGenerationProjection()
// built generationClaims[].audienceAuthority.funder straight from that same
// legacy column, so a claim P2-06 correctly certified funder-eligible could
// still be rejected by VAL-GEN-005 (draft_audience_exceeds_authority) with no
// durable state and no way to ever succeed. This suite proves, against a
// real ephemeral PostgreSQL database (no mocked evaluator, no mocked
// authority), that generation now reuses the exact same authoritative
// computation (approvalForAudience, exposed via
// __claimTraceabilityRepositoryTestables) P2-06 itself uses, while every
// other governance boundary (pre-generation eligibility gate, post-generation
// revalidation, internal/public/Impact-Narrative semantics, persistence)
// remains exactly as before.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P14_09_FUNDER_AUTHORITY_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P14-09 funder-authority-repair integration suite refused a non-loopback KAI_P14_09_FUNDER_AUTHORITY_DATABASE_URL host: ${host}`);
  }
}

test("P14-09 funder-authority-repair PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P14-09 funder-authority-repair PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresGeneratedContentRepository\.js|postgresClaimTraceabilityRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P14-09 funder-authority-repair integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { recordEvidenceReviewDecision, recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { getClaimTraceabilitySummary } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { completeClientFollowup } = await import("../Backend/kai/services/kaiClientFollowupCompletionService.js");
  const { acceptFunderCoverageLimitation } = await import("../Backend/kai/services/kaiCoverageReviewDecisionService.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { createPostgresHumanReviewRepository } = await import("../Backend/kai/dictionary/postgresHumanReviewRepository.js");
  const { createPostgresClaimTraceabilityRepository, evaluateClaimTraceabilityInTransaction } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");
  const { createPostgresCoverageReviewDecisionRepository } = await import("../Backend/kai/dictionary/postgresCoverageReviewDecisionRepository.js");
  const { createPostgresClientFollowupCompletionRepository } = await import("../Backend/kai/dictionary/postgresClientFollowupCompletionRepository.js");
  const {
    createPostgresGeneratedContentRepository,
    __generatedContentRepositoryTestables,
  } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const { loadGenerationProjection } = __generatedContentRepositoryTestables;

  const ORG = "00000000-0000-4000-8000-000000000001";
  const ENGAGEMENT = "00000000-0000-4000-8000-000000000501";
  const NOW = "2026-08-06T10:00:00.000Z";
  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 10 });

  async function withTx(callback) {
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
  async function query(sql, params = []) {
    return (await pool.query(sql, params)).rows;
  }

  test.after(async () => {
    await pool.end();
  });

  const reviewerActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };
  const clientReviewerActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000007",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_reviewer" }],
  };
  function auditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  const evidenceRepo = createPostgresEvidenceLineageRepository({ runInTransaction: withTx });
  const claimRepo = createPostgresClaimProposalRepository({ runInTransaction: withTx });
  const gapRepo = createPostgresClaimGapFollowupRepository({ runInTransaction: withTx });
  const humanReviewRepo = createPostgresHumanReviewRepository({ runInTransaction: withTx });
  const traceRepo = createPostgresClaimTraceabilityRepository({ runInTransaction: withTx });
  const coverageRepo = createPostgresCoverageReviewDecisionRepository({ runInTransaction: withTx });
  const clientFollowupRepo = createPostgresClientFollowupCompletionRepository({ runInTransaction: withTx });

  async function trace(claimId, requestedAudience) {
    return getClaimTraceabilitySummary(
      { organizationId: ORG, claimId, requestedAudience, actorContext: reviewerActor },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimTraceabilityRepository: traceRepo },
    );
  }

  let orgSeeded = false;
  async function seedOrganization() {
    if (orgSeeded) return;
    await pool.query(`INSERT INTO kai.organizations (organization_id, name) VALUES ($1::uuid, 'P14-09 Funder Authority Repair Org') ON CONFLICT DO NOTHING;`, [ORG]);
    await pool.query(`INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ($1::uuid, $2::uuid, 'P14-09-FUNDER-AUTHORITY-REPAIR') ON CONFLICT DO NOTHING;`, [ENGAGEMENT, ORG]);
    // The P1-04 smoke seed commits exactly two data_dictionary_fields rows
    // (field_1, field_2) under the one is_current source version, so
    // extractEvidenceFromSourceVersion (idempotent per field) can only ever
    // mint two evidence items from it. This suite needs one independent,
    // never-before-claimed evidence item per test case below - add four more
    // fields under that exact same dictionary/profile, in the same shape the
    // smoke seed itself used, so extraction mints four more evidence items.
    const DICTIONARY_ID = "60000000-0000-4000-8000-000000000001";
    const FILE_PROFILE_ID = "50000000-0000-4000-8000-000000000001";
    for (const suffix of ["03", "04", "05", "06"]) {
      await pool.query(
        `INSERT INTO kai.data_dictionary_fields (
           data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id,
           profile_field_key, field_label_safe, data_type, created_at
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, 'number', now())
         ON CONFLICT DO NOTHING`,
        [`70000000-0000-4000-8000-0000000000${suffix}`, DICTIONARY_ID, ORG, FILE_PROFILE_ID, `field_${Number(suffix)}`],
      );
    }
    orgSeeded = true;
  }

  // Builds one fresh claim through the real proposal/gap pipeline, records a
  // resolved/supported evidence review, and (unless suppressed) a Phase-5
  // allowed-use decision and a claim-review decision - each independently
  // controllable so every case below can omit or vary exactly one authority
  // ingredient. Returns claimId plus the base claim's legacy audience-gate
  // columns (always internal_only=true/funder_use_allowed=false/
  // public_use_allowed=false - matching the exact production contradiction).
  async function buildClaim({
    phase5FunderAllowed = true,
    claimReviewApprovedAudiences = ["internal", "funder"],
    resolveCoverageAndFollowups = true,
  } = {}) {
    await seedOrganization();
    const [sourceVersion] = await query(
      `SELECT source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1`,
      [ORG],
    );
    const evidenceResult = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: sourceVersion.source_version_id, actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceLineageRepository: evidenceRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceResult.ok, true, JSON.stringify(evidenceResult));
    // extractEvidenceFromSourceVersion is idempotent per dictionary field, so
    // re-running it against the same source version (each buildClaim call
    // needs its own claim) does not necessarily mint a new evidence item -
    // pick one this org has not already proposed a claim against.
    const [evidenceRow] = await query(
      `SELECT evidence_item_id FROM kai.evidence_items
        WHERE organization_id = $1::uuid
          AND NOT EXISTS (
                SELECT 1 FROM kai.claims c
                 WHERE c.organization_id = kai.evidence_items.organization_id
                   AND c.evidence_item_id = kai.evidence_items.evidence_item_id
              )
        ORDER BY evidence_item_id ASC LIMIT 1`,
      [ORG],
    );
    const claimResult = await proposeClaim(
      { organizationId: ORG, evidenceItemId: evidenceRow.evidence_item_id, actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: claimRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(claimResult.ok, true, JSON.stringify(claimResult));
    const claimId = claimResult.data.claim.claim_id;
    const gapResult = await generateClaimGapFollowups(
      { organizationId: ORG, claimId, actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimGapFollowupRepository: gapRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(gapResult.ok, true, JSON.stringify(gapResult));

    const [baseClaimRow] = await query(
      `SELECT internal_only, funder_use_allowed, public_use_allowed FROM kai.claims WHERE organization_id = $1::uuid AND claim_id = $2::uuid`,
      [ORG, claimId],
    );
    assert.equal(baseClaimRow.internal_only, true);
    assert.equal(baseClaimRow.funder_use_allowed, false);
    assert.equal(baseClaimRow.public_use_allowed, false);

    const [evidenceQueue] = await query(
      `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'evidence_review' AND target_object_type = 'evidence_item' AND target_object_id = $2::uuid`,
      [ORG, evidenceRow.evidence_item_id],
    );
    const evidenceReviewResult = await recordEvidenceReviewDecision(
      {
        organizationId: ORG, evidenceItemId: evidenceRow.evidence_item_id, reviewQueueItemId: evidenceQueue.review_queue_item_id,
        expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported", actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceReviewResult.ok, true, JSON.stringify(evidenceReviewResult));

    const [lineage] = await query(
      `SELECT sv.intake_sensitivity_profile_id
         FROM kai.claims c
         JOIN kai.evidence_items e ON e.organization_id = c.organization_id AND e.evidence_item_id = c.evidence_item_id
         JOIN kai.source_versions sv ON sv.organization_id = e.organization_id AND sv.source_version_id = e.source_version_id
        WHERE c.organization_id = $1::uuid AND c.claim_id = $2::uuid`,
      [ORG, claimId],
    );

    // The Phase-5 sensitivity/allowed-use decision ledger is scoped to the
    // intake_sensitivity_profile (shared by every evidence item/claim drawn
    // from this one source version), not to an individual claim, and only
    // ever admits one ROOT decision per profile - every later decision must
    // explicitly supersede the current head. Each buildClaim call here
    // therefore records a fresh head (superseding whatever head already
    // exists) reflecting exactly the funder-authorizing state this specific
    // test case needs, so cases can run in any order against the one shared
    // profile.
    let [sensitivityQueue] = await query(
      `SELECT review_queue_item_id FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_type = 'intake_sensitivity_profile' AND target_object_id = $2::uuid`,
      [ORG, lineage.intake_sensitivity_profile_id],
    );
    if (!sensitivityQueue) {
      [sensitivityQueue] = await query(
        `INSERT INTO kai.review_queue_items (
           organization_id, queue_type, target_object_type, target_object_id,
           priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
         ) VALUES ($1::uuid, 'sensitivity_review', 'intake_sensitivity_profile', $2::uuid, 'medium', 'open', 'needs_gk_review',
           'Review sensitivity and allowed-use metadata.', 'Review sensitivity and allowed-use metadata before governed use.', '{}'::jsonb, 'human')
         RETURNING review_queue_item_id`,
        [ORG, lineage.intake_sensitivity_profile_id],
      );
    }
    const [currentHead] = await query(
      `SELECT d.decision_id
         FROM kai.intake_sensitivity_review_decisions d
        WHERE d.organization_id = $1::uuid
          AND d.intake_sensitivity_profile_id = $2::uuid
          AND NOT EXISTS (
                SELECT 1 FROM kai.intake_sensitivity_review_decisions s
                 WHERE s.supersedes_decision_id = d.decision_id
              )`,
      [ORG, lineage.intake_sensitivity_profile_id],
    );
    await pool.query(
      `INSERT INTO kai.intake_sensitivity_review_decisions (
         organization_id, intake_sensitivity_profile_id, review_queue_item_id,
         decision_outcome, reviewed_personal_data_status, reviewed_minor_data_status,
         reviewed_health_housing_justice_immigration_status, reviewed_indigenous_governance_status,
         reviewed_staff_notes_status, reviewed_story_testimonial_status, reviewed_small_cell_risk_status,
         reviewed_financial_records_status, reviewed_consent_basis_status, reviewed_allowed_use_status,
         reviewed_llm_processing_allowed, reviewed_product_learning_allowed, reviewed_public_use_allowed,
         reviewed_funder_use_allowed, decided_by, decided_by_role, target_updated_at,
         supersedes_decision_id, created_by_type, created_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid,
         'reviewed', 'unknown', 'unknown',
         'unknown', 'unknown',
         'unknown', 'unknown', 'unknown',
         'unknown', 'present', 'allowed',
         false, false, false,
         $4, $5::uuid, 'gk_reviewer', $6::timestamptz,
         $7, 'human', now()
       )`,
      [ORG, lineage.intake_sensitivity_profile_id, sensitivityQueue.review_queue_item_id, phase5FunderAllowed, reviewerActor.actorUserId, NOW, currentHead?.decision_id ?? null],
    );

    if (claimReviewApprovedAudiences) {
      const [claimQueue] = await query(
        `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_type = 'claim' AND target_object_id = $2::uuid`,
        [ORG, claimId],
      );
      const claimReviewResult = await recordClaimReviewDecision(
        {
          organizationId: ORG, claimId, reviewQueueItemId: claimQueue.review_queue_item_id,
          expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved",
          approvedAudiences: claimReviewApprovedAudiences, actorContext: reviewerActor, now: NOW,
        },
        { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(claimReviewResult.ok, true, JSON.stringify(claimReviewResult));
    }

    if (resolveCoverageAndFollowups) {
      const traced = await trace(claimId, "funder");
      const unresolved = Object.entries(traced.data.dimensions).filter(([, v]) => v.assessment_status === "unresolved").map(([k]) => k);
      for (const dimensionKey of unresolved) {
        const acceptResult = await acceptFunderCoverageLimitation(
          { organizationId: ORG, claimId, dimensionKey, actorContext: reviewerActor, now: NOW },
          { env: { KAI_SPRINT2_ENABLED: "true" }, coverageReviewDecisionRepository: coverageRepo, metadataOnlyAudit: auditRecorder() },
        );
        assert.equal(acceptResult.ok, true, JSON.stringify(acceptResult));
      }
      const followupRows = await query(
        `SELECT cfi.client_followup_item_id, rq.updated_at
           FROM kai.client_followup_items cfi
           JOIN kai.review_queue_items rq ON rq.organization_id = cfi.organization_id AND rq.queue_type = 'client_followup'
            AND rq.target_object_type = 'client_followup_item' AND rq.target_object_id = cfi.client_followup_item_id
          WHERE cfi.organization_id = $1::uuid AND cfi.claim_id = $2::uuid ORDER BY cfi.dimension_key`,
        [ORG, claimId],
      );
      for (const row of followupRows) {
        const completeResult = await completeClientFollowup(
          { organizationId: ORG, claimId, clientFollowupItemId: row.client_followup_item_id, expectedUpdatedAt: new Date(row.updated_at).toISOString(), actorContext: clientReviewerActor, now: NOW },
          { env: { KAI_SPRINT2_ENABLED: "true" }, clientFollowupCompletionRepository: clientFollowupRepo, metadataOnlyAudit: auditRecorder() },
        );
        assert.equal(completeResult.ok, true, JSON.stringify(completeResult));
      }
    }

    return { claimId, evidenceItemId: evidenceRow.evidence_item_id };
  }

  function stubDraftGenerator(calls, onCalled) {
    return async (input) => {
      calls.push(input);
      if (onCalled) await onCalled();
      const claim = input.claims[0];
      return { blocks: [{ ordinal: 1, text: claim.claimStatement, citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] }] };
    };
  }

  async function durableRowCount(idempotencyKey) {
    const runs = await query(
      `SELECT count(*)::int AS n FROM kai.generation_runs WHERE organization_id = $1::uuid AND idempotency_key = $2`,
      [ORG, idempotencyKey],
    );
    const drafts = await query(
      `SELECT count(*)::int AS n FROM kai.generated_content_drafts d
         JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id
        WHERE r.organization_id = $1::uuid AND r.idempotency_key = $2`,
      [ORG, idempotencyKey],
    );
    return { generation_runs: runs[0].n, generated_content_drafts: drafts[0].n };
  }

  // --- CASE 1: exact production contradiction, now repaired ---
  test("P14-09 CASE 1: production-state claim (funder_use_allowed=false, claim-review+Phase-5 funder authority present) - real P2-06 eligible=true, generation audienceAuthority.funder=true, VAL-GEN-005 passes, funder generation succeeds", async () => {
    const { claimId, evidenceItemId } = await buildClaim();

    const step1 = await withTx(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      return evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "funder" });
    });
    assert.equal(step1.ok, true);
    assert.equal(step1.data.requestedAudience, "funder");
    assert.equal(step1.data.eligible, true);
    assert.deepEqual(step1.data.blockerCodes, []);

    const funderAuthorityByClaimId = new Map([[claimId, true]]);
    const projection = await withTx((tx) => loadGenerationProjection(
      tx,
      { organizationId: ORG, claimIds: [claimId], requestedAudience: "funder" },
      funderAuthorityByClaimId,
    ));
    assert.equal(projection[0].audienceAuthority.funder, true, "generation-time funder authority must now match P2-06's real grant, not the legacy funder_use_allowed=false column");

    const generatorCalls = [];
    const repository = createPostgresGeneratedContentRepository({ runInTransaction: withTx });
    const result = await repository.createEvidenceSummaryDraft(
      { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "funder", claimIds: [claimId], idempotencyKey: "case1-production-state", actorContext: reviewerActor, now: NOW },
      { draftGenerator: stubDraftGenerator(generatorCalls), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.requestedAudience, "funder");
    assert.equal(generatorCalls.length, 1);
    const durable = await durableRowCount("case1-production-state");
    assert.equal(durable.generation_runs, 1);
    assert.equal(durable.generated_content_drafts, 1);
  });

  // --- CASE 2: claim review does not approve funder ---
  test("P14-09 CASE 2: claim review approves only internal (not funder) - effective funder authority absent, generation fails closed before the generator runs", async () => {
    const { claimId } = await buildClaim({ claimReviewApprovedAudiences: ["internal"] });

    const step1 = await withTx((tx) => evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "funder" }));
    assert.equal(step1.data.eligible, false);
    assert.ok(step1.data.blockerCodes.includes("claim_not_approved_for_requested_audience"));

    const generatorCalls = [];
    const repository = createPostgresGeneratedContentRepository({ runInTransaction: withTx });
    const result = await repository.createEvidenceSummaryDraft(
      { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "funder", claimIds: [claimId], idempotencyKey: "case2-no-funder-approval", actorContext: reviewerActor, now: NOW },
      { draftGenerator: stubDraftGenerator(generatorCalls), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "funder_use_not_currently_eligible");
    assert.equal(generatorCalls.length, 0);
    const durable = await durableRowCount("case2-no-funder-approval");
    assert.equal(durable.generation_runs, 0);
    assert.equal(durable.generated_content_drafts, 0);
  });

  // --- CASE 3: Phase-5 effective funder authority absent ---
  test("P14-09 CASE 3: claim review approves funder but the Phase-5 effective-funder-authority decision is absent - generation fails closed before the generator runs", async () => {
    const { claimId } = await buildClaim({ phase5FunderAllowed: false, claimReviewApprovedAudiences: null, resolveCoverageAndFollowups: false });
    // recordClaimReviewDecision itself enforces the Phase-5 governance
    // ceiling for an approved_audiences write that includes "funder" (it
    // would reject the write outright), so this case must record the claim
    // review decision directly - it is testing P2-06/generation read-time
    // behavior against an already-approved decision, not the write-time
    // ceiling enforced elsewhere.
    const [claimQueue] = await query(
      `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_type = 'claim' AND target_object_id = $2::uuid`,
      [ORG, claimId],
    );
    await pool.query(
      `INSERT INTO kai.claim_review_decisions (
         organization_id, claim_id, review_queue_item_id, decision_outcome,
         limitation_notes, approved_audiences, decided_by, decided_by_role,
         target_updated_at, supersedes_decision_id, created_by_type, created_at
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'approved', NULL, $4, $5::uuid, 'gk_reviewer', $6::timestamptz, NULL, 'human', now())`,
      [ORG, claimId, claimQueue.review_queue_item_id, ["internal", "funder"], reviewerActor.actorUserId, new Date(claimQueue.updated_at).toISOString()],
    );

    const step1 = await withTx((tx) => evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "funder" }));
    assert.equal(step1.data.eligible, false);
    assert.ok(step1.data.blockerCodes.includes("claim_not_approved_for_requested_audience"));
    assert.ok(step1.data.blockerCodes.includes("requirement_authority_absent"));

    const generatorCalls = [];
    const repository = createPostgresGeneratedContentRepository({ runInTransaction: withTx });
    const result = await repository.createEvidenceSummaryDraft(
      { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "funder", claimIds: [claimId], idempotencyKey: "case3-no-phase5-authority", actorContext: reviewerActor, now: NOW },
      { draftGenerator: stubDraftGenerator(generatorCalls), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "funder_use_not_currently_eligible");
    assert.equal(generatorCalls.length, 0);
  });

  // --- CASE 4: authority present but a different P2-06 blocker keeps eligible=false ---
  test("P14-09 CASE 4: claim-review + Phase-5 funder authority both present, but coverage/follow-up gaps remain unresolved - eligible=false for an unrelated reason, generation still fails closed before the generator runs", async () => {
    const { claimId } = await buildClaim({ resolveCoverageAndFollowups: false });

    const step1 = await withTx((tx) => evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "funder" }));
    assert.equal(step1.data.eligible, false);
    assert.ok(!step1.data.blockerCodes.includes("claim_not_approved_for_requested_audience"), "authority itself must be present in this case");
    assert.ok(
      step1.data.blockerCodes.includes("coverage_dimension_unresolved") || step1.data.blockerCodes.includes("client_followup_unresolved"),
      `expected an unresolved coverage/follow-up blocker, got: ${JSON.stringify(step1.data.blockerCodes)}`,
    );

    const generatorCalls = [];
    const repository = createPostgresGeneratedContentRepository({ runInTransaction: withTx });
    const result = await repository.createEvidenceSummaryDraft(
      { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "funder", claimIds: [claimId], idempotencyKey: "case4-unresolved-coverage", actorContext: reviewerActor, now: NOW },
      { draftGenerator: stubDraftGenerator(generatorCalls), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "funder_use_not_currently_eligible");
    assert.equal(generatorCalls.length, 0);
  });

  // --- CASE 5: eligibility lost between pre-check and post-generation revalidation ---
  test("P14-09 CASE 5: funder eligibility lost after the generator runs but before persistence - rolls back with no durable generated-content state", async () => {
    const { claimId } = await buildClaim();

    const generatorCalls = [];
    const revokeFunderApproval = async () => {
      const [claimQueue] = await query(
        `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_type = 'claim' AND target_object_id = $2::uuid`,
        [ORG, claimId],
      );
      const revoked = await recordClaimReviewDecision(
        {
          organizationId: ORG, claimId, reviewQueueItemId: claimQueue.review_queue_item_id,
          expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved",
          approvedAudiences: ["internal"], actorContext: reviewerActor, now: NOW,
        },
        { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(revoked.ok, true, JSON.stringify(revoked));
    };

    const repository = createPostgresGeneratedContentRepository({ runInTransaction: withTx });
    const result = await repository.createEvidenceSummaryDraft(
      { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "funder", claimIds: [claimId], idempotencyKey: "case5-eligibility-lost-midflight", actorContext: reviewerActor, now: NOW },
      { draftGenerator: stubDraftGenerator(generatorCalls, revokeFunderApproval), metadataOnlyAudit: auditRecorder() },
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "funder_use_not_currently_eligible");
    assert.equal(generatorCalls.length, 1, "the generator ran once (pre-check passed on the still-approved decision) before revalidation caught the revoked approval");
    const durable = await durableRowCount("case5-eligibility-lost-midflight");
    assert.equal(durable.generation_runs, 0);
    assert.equal(durable.generated_content_drafts, 0);
  });

  // --- Persistence boundary: the repair never mutates the raw claim audience columns ---
  test("P14-09: repaired generation path never mutates claims.internal_only/funder_use_allowed/public_use_allowed", async () => {
    const { claimId } = await buildClaim();
    const before = await query(`SELECT internal_only, funder_use_allowed, public_use_allowed FROM kai.claims WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, claimId]);
    const repository = createPostgresGeneratedContentRepository({ runInTransaction: withTx });
    const result = await repository.createEvidenceSummaryDraft(
      { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "funder", claimIds: [claimId], idempotencyKey: "case9-no-column-mutation", actorContext: reviewerActor, now: NOW },
      { draftGenerator: stubDraftGenerator([]), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = await query(`SELECT internal_only, funder_use_allowed, public_use_allowed FROM kai.claims WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, claimId]);
    assert.deepEqual(after, before);
  });
}
