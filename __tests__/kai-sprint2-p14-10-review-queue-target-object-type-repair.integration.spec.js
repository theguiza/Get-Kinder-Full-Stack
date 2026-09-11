// P14-10 review_queue_items target_object_type schema-drift repair.
//
// USER_CONFIRMED production evidence: a deployed kai.review_queue_items
// simultaneously carried the canonical P3-01/P3-04
// review_queue_items_p3_04_generated_content_review_contract_chec (requiring
// target_object_type='generated_content_draft' for queue_type=
// 'generated_content_review') alongside an obsolete, pre-P1-06
// review_queue_items_target_object_type_check fixed allowlist that did NOT
// include 'generated_content_draft' - making the real
// persistCompleteSet/createGeneratedContentDraft generated-content-review
// queue-item write unpersistable in production (surfaced as HTTP 422
// VAL-GEN-PERSIST-P0-001 / persistence_validation_rejected).
//
// This suite proves, against a real ephemeral PostgreSQL database (no mocked
// client.query, no mocked persistence, no Anthropic call - a stub
// draftGenerator only), that:
//   1. the real funder Evidence Summary transaction is genuinely rejected
//      (23514, on exactly the stale legacy constraint name) BEFORE the P14-10
//      repair migration runs, with no durable state left behind;
//   2. the SAME transaction commits successfully AFTER the repair migration
//      runs, persisting generation_run/draft/block/citation/review-queue
//      rows with the exact expected shape;
//   3. both the P3-04 generated-content-specific contract and the canonical
//      generic length bound still fail closed on invalid input afterward.
//
// No generation application code, Anthropic call, P2-06/funder-authority
// logic, citation/VAL-GEN validator, frontend, packet-composition, or export
// behavior is touched or exercised beyond what P14-09's own suite already
// covers - this suite is schema-repair proof only.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P14_10_REVIEW_QUEUE_REPAIR_DATABASE_URL;
const PHASE = process.env.KAI_P14_10_REVIEW_QUEUE_REPAIR_PHASE;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P14-10 review-queue target_object_type repair integration suite refused a non-loopback KAI_P14_10_REVIEW_QUEUE_REPAIR_DATABASE_URL host: ${host}`);
  }
}

test("P14-10 review-queue target_object_type repair PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P14-10 review-queue target_object_type repair PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresGeneratedContentRepository\.js|postgresClaimTraceabilityRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL || (PHASE !== "pre" && PHASE !== "post")) {
  test("P14-10 review-queue target_object_type repair integration requires the runner-owned database and an explicit pre/post phase", { skip: true }, () => {});
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
  const { createPostgresClaimTraceabilityRepository } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");
  const { createPostgresCoverageReviewDecisionRepository } = await import("../Backend/kai/dictionary/postgresCoverageReviewDecisionRepository.js");
  const { createPostgresClientFollowupCompletionRepository } = await import("../Backend/kai/dictionary/postgresClientFollowupCompletionRepository.js");
  const { createPostgresGeneratedContentRepository } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");

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
    await pool.query(`INSERT INTO kai.organizations (organization_id, name) VALUES ($1::uuid, 'P14-10 Review-Queue Repair Org') ON CONFLICT DO NOTHING;`, [ORG]);
    await pool.query(`INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ($1::uuid, $2::uuid, 'P14-10-REVIEW-QUEUE-REPAIR') ON CONFLICT DO NOTHING;`, [ENGAGEMENT, ORG]);
    const DICTIONARY_ID = "60000000-0000-4000-8000-000000000001";
    const FILE_PROFILE_ID = "50000000-0000-4000-8000-000000000001";
    for (const suffix of ["03"]) {
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

  // Builds exactly one governed, funder-eligible claim through the real
  // proposal/gap/review/Phase-5/coverage pipeline - the same happy-path
  // shape P14-09 CASE 1 already proved reaches eligible=true,
  // audienceAuthority.funder=true, VAL-GEN-005 pass.
  async function buildFunderEligibleClaim() {
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
         true, $4::uuid, 'gk_reviewer', $5::timestamptz,
         $6, 'human', now()
       )`,
      [ORG, lineage.intake_sensitivity_profile_id, sensitivityQueue.review_queue_item_id, reviewerActor.actorUserId, NOW, currentHead?.decision_id ?? null],
    );

    const [claimQueue] = await query(
      `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_type = 'claim' AND target_object_id = $2::uuid`,
      [ORG, claimId],
    );
    const claimReviewResult = await recordClaimReviewDecision(
      {
        organizationId: ORG, claimId, reviewQueueItemId: claimQueue.review_queue_item_id,
        expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved",
        approvedAudiences: ["internal", "funder"], actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(claimReviewResult.ok, true, JSON.stringify(claimReviewResult));

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

    return { claimId, evidenceItemId: evidenceRow.evidence_item_id };
  }

  function stubDraftGenerator(calls) {
    return async (input) => {
      calls.push(input);
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

  if (PHASE === "pre") {
    test("P14-10 PRE-MIGRATION: the real funder Evidence Summary persistence transaction is rejected by the stale production-drift schema, with no durable state left behind", async () => {
      const { claimId } = await buildFunderEligibleClaim();

      // Reproduce the USER_CONFIRMED production-drift condition now - after
      // the claim/evidence/review pipeline above has already populated every
      // target_object_type the running organization legitimately uses - so
      // the reproduction allowlist reflects a real pre-generated-content
      // production vocabulary, and the ONLY thing it excludes is the one
      // USER_CONFIRMED fact: 'generated_content_draft'. This mirrors the
      // repository's documented reproduction-only fixture
      // (scripts/kai-sprint2-p14-10-review-queue-target-object-type-repair-reproduce-production-drift.sql)
      // and is not a migration.
      const driftFixturePath = join(fileURLToPath(new URL("../", import.meta.url)), "scripts/kai-sprint2-p14-10-review-queue-target-object-type-repair-reproduce-production-drift.sql");
      await pool.query(readFileSync(driftFixturePath, "utf8"));

      // Direct proof of the exact SQLSTATE/constraint the real
      // persistCompleteSet review_queue_items INSERT hits under the
      // reproduced production-drift schema, captured independently of the
      // repository's own error-code mapping.
      let capturedSqlstate = null;
      let capturedConstraint = null;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        try {
          await client.query(
            `INSERT INTO kai.review_queue_items (
               organization_id, engagement_id, queue_type, target_object_type, target_object_id,
               priority, queue_status, review_status, blocked_reason, assigned_to, due_at,
               summary, required_action, queue_metadata, created_by, created_by_type, created_at, updated_at
             )
             VALUES ($1::uuid,NULL,'generated_content_review','generated_content_draft',gen_random_uuid(),'medium','open','needs_gk_review',NULL,NULL,NULL,$2,$3,'{}'::jsonb,NULL,'system',now(),now())`,
            [ORG, "Generated draft requires human review.", "Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use."],
          );
        } catch (error) {
          capturedSqlstate = error.code;
          capturedConstraint = error.constraint;
        }
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      assert.equal(capturedSqlstate, "23514");
      assert.equal(capturedConstraint, "review_queue_items_target_object_type_check");

      // Now the real repository transaction, end to end, with no mocking.
      const repository = createPostgresGeneratedContentRepository({ runInTransaction: withTx });
      const result = await repository.createEvidenceSummaryDraft(
        { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "funder", claimIds: [claimId], idempotencyKey: "p14-10-pre-migration", actorContext: reviewerActor, now: NOW },
        { draftGenerator: stubDraftGenerator([]), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error.code, "validation_blocker");
      assert.ok(result.blockers.some((b) => b.validator_key === "VAL-GEN-PERSIST-P0-001" && b.blocking_reason === "persistence_validation_rejected"), JSON.stringify(result.blockers));

      const durable = await durableRowCount("p14-10-pre-migration");
      assert.equal(durable.generation_runs, 0, "the rolled-back transaction must leave no partial generation_runs row");
      assert.equal(durable.generated_content_drafts, 0, "the rolled-back transaction must leave no partial generated_content_drafts row");
    });
  }

  if (PHASE === "post") {
    test("P14-10 POST-MIGRATION: the same real funder Evidence Summary persistence transaction now commits, with the exact expected durable shape", async () => {
      const { claimId } = await buildFunderEligibleClaim();

      const generatorCalls = [];
      const repository = createPostgresGeneratedContentRepository({ runInTransaction: withTx });
      const result = await repository.createEvidenceSummaryDraft(
        { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "funder", claimIds: [claimId], idempotencyKey: "p14-10-post-migration", actorContext: reviewerActor, now: NOW },
        { draftGenerator: stubDraftGenerator(generatorCalls), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(generatorCalls.length, 1);

      const durable = await durableRowCount("p14-10-post-migration");
      assert.equal(durable.generation_runs, 1);
      assert.equal(durable.generated_content_drafts, 1);
      assert.equal(result.data.blocks.length, 1, "the one generated block must persist");
      assert.equal(result.data.blocks[0].citations.length, 1, "the block's one citation must persist");

      const [queueItem] = await query(
        `SELECT queue_type, target_object_type, queue_status, review_status
           FROM kai.review_queue_items
          WHERE organization_id = $1::uuid AND review_queue_item_id = $2::uuid`,
        [ORG, result.data.reviewQueueItemId],
      );
      assert.equal(queueItem.queue_type, "generated_content_review");
      assert.equal(queueItem.target_object_type, "generated_content_draft");
      assert.equal(queueItem.queue_status, "open");
      assert.equal(queueItem.review_status, "needs_gk_review");

      // Negative: the P3-04 generated-content-specific contract must still
      // fail closed on a wrong target for queue_type='generated_content_review'.
      await assert.rejects(
        () => pool.query(
          `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
           VALUES ($1::uuid,'generated_content_review','not_a_generated_content_draft',$2::uuid,'medium','open','needs_gk_review','Generated draft requires human review.','Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.','{}'::jsonb,'system')`,
          [ORG, result.data.generatedContentDraftId],
        ),
        (error) => error.code === "23514" && error.constraint === "review_queue_items_p3_04_generated_content_review_contract_chec",
      );

      // Negative: the canonical generic length bound must still fail closed.
      await assert.rejects(
        () => pool.query(
          `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, queue_metadata, created_by_type)
           VALUES ($1::uuid,'claim_review',$2,$3::uuid,'medium','open','needs_gk_review','x','{}'::jsonb,'system')`,
          [ORG, "x".repeat(129), claimId],
        ),
        (error) => error.code === "23514" && error.constraint === "review_queue_items_p1_06_target_object_type_check",
      );
    });
  }
}
