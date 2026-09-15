import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_BOARD_REPORTING_MIXED_CONTENT_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`Board mixed-content suite refused non-loopback database URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("Board Reporting mixed-content integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const {
    createPostgresGeneratedContentRepository,
  } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const {
    getBoardReportingPacket,
  } = await import("../Backend/kai/services/kaiBoardReportingPacketService.js");
  const {
    composeBoardReportingPacketFingerprint,
  } = await import("../Backend/kai/services/kaiBoardReportingPacketFingerprintService.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const ACTOR = Object.freeze({
    actorType: "human",
    actorUserId: "26010000-0000-4000-8000-000000000901",
    source: "public.userdata",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  });
  const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 4 });

  async function withRunnerOwnedTransaction(callback) {
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

  const evidenceContext = await pool.query(
    `SELECT e.evidence_item_id::text AS evidence_item_id,
            e.source_id::text AS source_id,
            e.source_version_id::text AS source_version_id,
            e.source_locator_id::text AS source_locator_id
       FROM kai.evidence_items e
      WHERE e.organization_id = $1::uuid
      ORDER BY e.evidence_item_id ASC
      LIMIT 1`,
    [ORG],
  );
  assert.equal(evidenceContext.rows.length, 1);
  const evidence = evidenceContext.rows[0];

  async function seedEngagement(tx, { engagementId, drafts }) {
    await tx.query(
      `INSERT INTO kai.organizations (organization_id, name, organization_code)
       VALUES ($1::uuid, 'Board Mixed Content Org', 'board-mixed-content-org')
       ON CONFLICT (organization_id) DO NOTHING`,
      [ORG],
    );
    await tx.query(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
       VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (engagement_id) DO NOTHING`,
      [engagementId, ORG, `board-mixed-${engagementId.slice(-6)}`],
    );

    for (const draft of drafts) {
      await tx.query(
        `INSERT INTO kai.evidence_items (
           evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
           evidence_type, data_class, sensitivity_level, support_strength, statement,
           statement_fingerprint, created_by_type
         )
         VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
           'dictionary_field_presence_fact', 'organization_committed_metadata', 'unknown',
           'unassessed', $6, $7, 'human'
         )
         ON CONFLICT (evidence_item_id) DO NOTHING`,
        [
          draft.evidenceId,
          ORG,
          evidence.source_id,
          evidence.source_version_id,
          evidence.source_locator_id,
          `${draft.label} synthetic evidence.`,
          draft.evidenceFingerprint,
        ],
      );
      await tx.query(
        `INSERT INTO kai.claims (
           claim_id, organization_id, evidence_item_id, claim_type, claim_status,
           claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'finding', 'proposed', 'needs_gk_review', 'unassessed', $4, $5, 'human')
         ON CONFLICT (claim_id) DO NOTHING`,
        [draft.claimId, ORG, draft.evidenceId, `${draft.label} synthetic claim.`, draft.fingerprint],
      );
      await tx.query(
        `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'system')
         ON CONFLICT DO NOTHING`,
        [ORG, draft.claimId, draft.evidenceId],
      );
      await tx.query(
        `INSERT INTO kai.generation_runs (
           generation_run_id, organization_id, engagement_id, idempotency_key, request_fingerprint,
           content_type, requested_audience, created_by_type
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'internal', 'system')
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
        [draft.runId, ORG, engagementId, draft.idempotencyKey, draft.fingerprint, draft.contentType],
      );
      await tx.query(
        `INSERT INTO kai.generated_content_drafts (
           generated_content_draft_id, generation_run_id, organization_id, content_type,
           requested_audience, draft_status, review_status, validator_results, created_by_type
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'internal', 'draft', 'needs_gk_review', '[]'::jsonb, 'system')
         ON CONFLICT (generated_content_draft_id) DO NOTHING`,
        [draft.draftId, draft.runId, ORG, draft.contentType],
      );
      await tx.query(
        `INSERT INTO kai.generated_content_blocks (
           generated_content_block_id, generated_content_draft_id, organization_id, ordinal, text
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, 1, $4)
         ON CONFLICT (generated_content_block_id) DO NOTHING`,
        [draft.blockId, draft.draftId, ORG, `${draft.label} generated content block.`],
      );
      await tx.query(
        `INSERT INTO kai.generated_content_citations (
           generated_content_citation_id, generated_content_block_id, organization_id, claim_id, evidence_item_id
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)
         ON CONFLICT (generated_content_citation_id) DO NOTHING`,
        [draft.citationId, draft.blockId, ORG, draft.claimId, draft.evidenceId],
      );
      await tx.query(
        `INSERT INTO kai.review_queue_items (
           review_queue_item_id, organization_id, queue_type, target_object_type, target_object_id,
           priority, queue_status, review_status, assigned_to, due_at, summary, required_action,
           queue_metadata, created_by_type
         )
         VALUES (
           $1::uuid, $2::uuid, 'generated_content_review', 'generated_content_draft', $3::uuid,
           'medium', $4, $5, NULL, NULL, 'Generated draft requires human review.',
           'Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.',
           '{}'::jsonb, 'system'
         )
         ON CONFLICT (review_queue_item_id) DO NOTHING`,
        [draft.queueId, ORG, draft.draftId, draft.queueStatus, draft.reviewStatus],
      );
    }
  }

  function draftFixture(prefix, ordinal, contentType, {
    queueStatus = "resolved",
    reviewStatus = "resolved",
    eligible = true,
  } = {}) {
    return {
      label: `${contentType}-${ordinal}`,
      contentType,
      eligible,
      runId: `${prefix}-0000-4000-8000-000000000${ordinal}01`,
      draftId: `${prefix}-0000-4000-8000-000000000${ordinal}02`,
      blockId: `${prefix}-0000-4000-8000-000000000${ordinal}03`,
      citationId: `${prefix}-0000-4000-8000-000000000${ordinal}04`,
      queueId: `${prefix}-0000-4000-8000-000000000${ordinal}05`,
      claimId: `${prefix}-0000-4000-8000-000000000${ordinal}06`,
      evidenceId: `${prefix}-0000-4000-8000-000000000${ordinal}07`,
      fingerprint: String(ordinal).repeat(64),
      evidenceFingerprint: String(ordinal + 1).repeat(64),
      idempotencyKey: `${prefix}-${contentType}-${ordinal}`,
      queueStatus,
      reviewStatus,
    };
  }

  function makeEvaluator(drafts) {
    const byClaim = new Map(drafts.map((draft) => [draft.claimId, draft]));
    const evaluatedClaimIds = [];
    const evaluator = async (_tx, { claimId, requestedAudience }) => {
      const draft = byClaim.get(claimId);
      if (!draft) throw new Error(`unexpected claim evaluated: ${claimId}`);
      evaluatedClaimIds.push(claimId);
      if (draft.contentType !== "evidence_summary" && draft.contentType !== "impact_narrative") {
        throw new Error(`non-Board content type reached evaluator: ${draft.contentType}`);
      }
      return {
        ok: true,
        data: {
          claim: {
            claim_id: claimId,
            claim_type: "finding",
            claim_status: "proposed",
            claim_review_status: "approved",
            claim_strength: "strong",
            audience_gates: {},
          },
          evidence: {
            evidence_item_id: draft.evidenceId,
            evidence_review_status: "approved",
            support_strength: "strong",
            review_queue_item_id: "26010000-0000-4000-8000-000000000999",
            review_queue_status: "closed",
            review_status: "approved",
            updated_at: "2026-09-15T00:00:00.000Z",
            sensitivity_level: "unknown",
          },
          locator: { source_locator_id: "26010000-0000-4000-8000-000000000998" },
          source: { source_id: evidence.source_id, source_code: null },
          source_version: { source_version_id: evidence.source_version_id, is_current: true },
          claim_review: {
            review_queue_item_id: "26010000-0000-4000-8000-000000000997",
            queue_status: "closed",
            review_status: "approved",
          },
          evidence_review_decision: {
            decision_id: "26010000-0000-4000-8000-000000000996",
            decision_outcome: "accepted",
          },
          claim_review_decision: {
            decision_id: "26010000-0000-4000-8000-000000000995",
            decision_outcome: "accepted",
            approved_audiences: ["internal"],
          },
          candidate: { intake_source_candidate_id: "26010000-0000-4000-8000-000000000994" },
          promotion_decision: { intake_promotion_decision_id: "26010000-0000-4000-8000-000000000993" },
          dimensions: {},
          gap_items: [],
          client_followup_workflows: [],
          potential_conflict_groups: [],
          graph_relationships: [
            {
              relationship_type: "claim_supported_by_evidence",
              from_object_type: "claim",
              from_object_id: claimId,
              to_object_type: "evidence_item",
              to_object_id: draft.evidenceId,
            },
          ],
          graph_trace_completeness: {
            complete: true,
            missing_relationship_types: [],
            invalid_relationship_count: 0,
          },
          requestedAudience,
          eligible: draft.eligible,
          blockerCodes: draft.eligible ? [] : ["synthetic_ineligible"],
          affectedDimensionKeys: [],
          affectedObjectIds: [],
          truncated: false,
        },
        error: null,
      };
    };
    return { evaluator, evaluatedClaimIds };
  }

  function makeRepository(evaluator) {
    return createPostgresGeneratedContentRepository({
      runInTransaction: withRunnerOwnedTransaction,
      evaluator,
    });
  }

  await test("Board Reporting mixed-content packet excludes non-Board, unresolved, and ineligible generated content before service projection", async () => {
    const engagementId = "26010000-0000-4000-8000-000000000101";
    const boardDraft = draftFixture("26010001", 1, "evidence_summary");
    const dataGapMemo = draftFixture("26010002", 2, "data_gap_memo");
    const readinessAssessment = draftFixture("26010003", 3, "readiness_assessment");
    const unresolvedBoard = draftFixture("26010004", 4, "impact_narrative", {
      queueStatus: "open",
      reviewStatus: "needs_gk_review",
    });
    const ineligibleBoard = draftFixture("26010005", 5, "impact_narrative", { eligible: false });
    const drafts = [boardDraft, dataGapMemo, readinessAssessment, unresolvedBoard, ineligibleBoard];
    await withRunnerOwnedTransaction((tx) => seedEngagement(tx, { engagementId, drafts }));

    const { evaluator, evaluatedClaimIds } = makeEvaluator(drafts);
    const repository = makeRepository(evaluator);
    const repositoryResult = await repository.getBoardReportingPacket({ organizationId: ORG, engagementId });
    assert.equal(repositoryResult.ok, true, JSON.stringify(repositoryResult));
    assert.deepEqual(repositoryResult.data.drafts.map((draft) => draft.contentType), ["evidence_summary"]);
    assert.deepEqual(repositoryResult.data.drafts.map((draft) => draft.generatedContentDraftId), [boardDraft.draftId]);
    assert.equal(repositoryResult.data.drafts.some((draft) => draft.generatedContentDraftId === dataGapMemo.draftId), false);
    assert.equal(repositoryResult.data.drafts.some((draft) => draft.generatedContentDraftId === readinessAssessment.draftId), false);
    assert.equal(repositoryResult.data.drafts.some((draft) => draft.generatedContentDraftId === unresolvedBoard.draftId), false);
    assert.equal(repositoryResult.data.drafts.some((draft) => draft.generatedContentDraftId === ineligibleBoard.draftId), false);

    const serviceResult = await getBoardReportingPacket({
      organizationId: ORG,
      engagementId,
      actorContext: ACTOR,
    }, {
      env: enabledEnv,
      generatedContentRepository: repository,
    });
    assert.equal(serviceResult.ok, true, JSON.stringify(serviceResult));
    assert.equal(serviceResult.error, null);
    assert.deepEqual(serviceResult.data.members.map((member) => member.contentType), ["evidence_summary"]);
    assert.deepEqual(serviceResult.data.members.map((member) => member.generatedContentDraftId), [boardDraft.draftId]);
    assert.equal(serviceResult.data.members.some((member) => member.generatedContentDraftId === dataGapMemo.draftId), false);
    assert.equal(serviceResult.data.members.some((member) => member.generatedContentDraftId === readinessAssessment.draftId), false);
    assert.equal(serviceResult.data.members.some((member) => member.generatedContentDraftId === unresolvedBoard.draftId), false);
    assert.equal(serviceResult.data.members.some((member) => member.generatedContentDraftId === ineligibleBoard.draftId), false);
    const fingerprint = composeBoardReportingPacketFingerprint(serviceResult.data);
    assert.equal(serviceResult.data.canonicalFingerprint, fingerprint.fingerprint);
    assert.deepEqual(fingerprint.orderedGeneratedContentDraftIds, [boardDraft.draftId]);
    assert.equal(evaluatedClaimIds.includes(dataGapMemo.claimId), false);
    assert.equal(evaluatedClaimIds.includes(readinessAssessment.claimId), false);
  });

  await test("Board Reporting preserves empty-member/null-fingerprint contract when an engagement has no eligible Board members", async () => {
    const engagementId = "26010000-0000-4000-8000-000000000102";
    const dataGapMemo = draftFixture("26010006", 6, "data_gap_memo");
    const readinessAssessment = draftFixture("26010007", 7, "readiness_assessment");
    const drafts = [dataGapMemo, readinessAssessment];
    await withRunnerOwnedTransaction((tx) => seedEngagement(tx, { engagementId, drafts }));

    const { evaluator, evaluatedClaimIds } = makeEvaluator(drafts);
    const repository = makeRepository(evaluator);
    const repositoryResult = await repository.getBoardReportingPacket({ organizationId: ORG, engagementId });
    assert.equal(repositoryResult.ok, true, JSON.stringify(repositoryResult));
    assert.deepEqual(repositoryResult.data.drafts, []);

    const serviceResult = await getBoardReportingPacket({
      organizationId: ORG,
      engagementId,
      actorContext: ACTOR,
    }, {
      env: enabledEnv,
      generatedContentRepository: repository,
    });
    assert.equal(serviceResult.ok, true, JSON.stringify(serviceResult));
    assert.deepEqual(serviceResult.data.members, []);
    assert.equal(serviceResult.data.fingerprintContractVersion, null);
    assert.equal(serviceResult.data.canonicalFingerprint, null);
    assert.deepEqual(evaluatedClaimIds, []);
  });

  await pool.end();
}
