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

  // ===================================================================
  // Client-safe Generated Drafts / Grant Response Packet / Board Reporting
  // previews over the same real PostgreSQL rows: the real Generated Drafts
  // index SQL (run on this runner's pool), the real generated-content
  // repository (packet validation, review-lifecycle and currentUseEligible
  // derivation, GRP/Board membership), and the real client service, with
  // this suite's established synthetic claim evaluator.
  // ===================================================================
  const {
    listGeneratedDraftLibraryIndex: readDraftIndexSql,
    readGeneratedDraftEngagementId: readDraftEngagementSql,
  } = await import("../Backend/kai/db/kaiGeneratedDraftLibraryReadModels.js");
  const { getEngagementForOrganization: readEngagementSql } = await import("../Backend/kai/db/kaiQueries.js");
  const {
    listClientGeneratedDrafts,
    getClientGeneratedDraft,
    getClientGrantResponsePacketPreview,
    getClientBoardReportingPreview,
  } = await import("../Backend/kai/services/kaiClientGeneratedContentService.js");
  const { getGeneratedDraftReviewPacket } = await import("../Backend/kai/services/kaiGeneratedContentService.js");
  const { getGrantResponsePacket } = await import("../Backend/kai/services/kaiGrantResponsePacketService.js");

  // Evidence rows must reference this runner's seeded source version, so the
  // client drafts live in the seeded organization; FOREIGN_ORG has no rows.
  const CLIENT_ORG = ORG;
  const FOREIGN_ORG = "00000000-0000-4000-8000-00000000c002";
  const clientActor = (role, organizationId = CLIENT_ORG) => Object.freeze({
    actorType: "human",
    actorUserId: `26020000-0000-4000-8000-00000000090${role === "client_admin" ? 1 : role === "client_reviewer" ? 2 : 3}`,
    source: "public.userdata",
    kaiRoles: [],
    organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: role }],
  });
  const CLIENT_ROLES = ["client_admin", "client_reviewer", "client_contributor"];

  async function seedClientDraft(tx, organizationId, engagementId, draft, audience) {
    await tx.query(
      `INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, $2)
       ON CONFLICT (organization_id) DO NOTHING`,
      [organizationId, `client-content-${organizationId.slice(-4)}`],
    );
    await tx.query(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (engagement_id) DO NOTHING`,
      [engagementId, organizationId, `client-content-${engagementId.slice(-6)}`],
    );
    await tx.query(
      `INSERT INTO kai.evidence_items (
         evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
         evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'dictionary_field_presence_fact',
               'organization_committed_metadata', 'unknown', 'unassessed', $6, $7, 'human')`,
      [draft.evidenceId, organizationId, evidence.source_id, evidence.source_version_id, evidence.source_locator_id,
        `${draft.label} RAW EVIDENCE STATEMENT`, draft.evidenceFingerprint],
    );
    await tx.query(
      `INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status,
         claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'finding', 'proposed', 'needs_gk_review', 'unassessed', $4, $5, 'human')`,
      [draft.claimId, organizationId, draft.evidenceId, `${draft.label} claim.`, draft.fingerprint],
    );
    await tx.query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'system') ON CONFLICT DO NOTHING`,
      [organizationId, draft.claimId, draft.evidenceId],
    );
    await tx.query(
      `INSERT INTO kai.generation_runs (generation_run_id, organization_id, engagement_id, idempotency_key,
         request_fingerprint, content_type, requested_audience, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 'system')`,
      [draft.runId, organizationId, engagementId, draft.idempotencyKey, draft.fingerprint, draft.contentType, audience],
    );
    await tx.query(
      `INSERT INTO kai.generated_content_drafts (generated_content_draft_id, generation_run_id, organization_id,
         content_type, requested_audience, draft_status, review_status, validator_results, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'draft', 'needs_gk_review', '[]'::jsonb, 'system')`,
      [draft.draftId, draft.runId, organizationId, draft.contentType, audience],
    );
    await tx.query(
      `INSERT INTO kai.generated_content_blocks (generated_content_block_id, generated_content_draft_id, organization_id, ordinal, text)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 1, $4)`,
      [draft.blockId, draft.draftId, organizationId, `${draft.label} client-visible text.`],
    );
    await tx.query(
      `INSERT INTO kai.generated_content_citations (generated_content_citation_id, generated_content_block_id,
         organization_id, claim_id, evidence_item_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)`,
      [draft.citationId, draft.blockId, organizationId, draft.claimId, draft.evidenceId],
    );
    await tx.query(
      `INSERT INTO kai.review_queue_items (review_queue_item_id, organization_id, queue_type, target_object_type,
         target_object_id, priority, queue_status, review_status, assigned_to, due_at, summary, required_action,
         queue_metadata, created_by_type)
       VALUES ($1::uuid, $2::uuid, 'generated_content_review', 'generated_content_draft', $3::uuid, 'medium', $4, $5,
               NULL, NULL, 'Generated draft requires human review.',
               'Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.',
               '{}'::jsonb, 'system')`,
      [draft.queueId, organizationId, draft.draftId, draft.queueStatus, draft.reviewStatus],
    );
  }

  // Synthetic evaluator states per claim, switchable to model a client
  // follow-up being answered.
  function clientEvaluator(drafts, stateByClaim) {
    const { evaluator: base } = makeEvaluator(drafts.map((draft) => ({ ...draft, contentType: "evidence_summary" })));
    return async (tx, input) => {
      const result = await base(tx, input);
      const state = stateByClaim.get(input.claimId) || "eligible";
      if (state === "eligible") return result;
      return { ...result, data: { ...result.data, eligible: false, blockerCodes: [state] } };
    };
  }

  const clientEngagement = "26020000-0000-4000-8000-000000000201";
  // Same fixture shape with fingerprints distinct from the earlier proofs'
  // (those derive from the ordinal alone and are unique-constrained).
  const clientFixture = (prefix, ordinal, contentType, options) => ({
    ...draftFixture(prefix, ordinal, contentType, options),
    fingerprint: `c${ordinal}`.repeat(32),
    evidenceFingerprint: `e${ordinal}`.repeat(32),
  });
  const visibleInternal = clientFixture("26020001", 1, "evidence_summary");
  const inGkReview = clientFixture("26020002", 2, "impact_narrative", { queueStatus: "in_progress", reviewStatus: "needs_gk_review" });
  const hiddenIneligible = clientFixture("26020003", 3, "evidence_summary");
  const awaitingClient = clientFixture("26020004", 4, "impact_narrative");
  const funderDraft = clientFixture("26020005", 5, "evidence_summary");
  const funderInReview = clientFixture("26020006", 6, "impact_narrative", { queueStatus: "open", reviewStatus: "needs_gk_review" });
  const internalDrafts = [visibleInternal, inGkReview, hiddenIneligible, awaitingClient];
  const clientDrafts = [...internalDrafts, funderDraft, funderInReview];
  await withRunnerOwnedTransaction(async (tx) => {
    for (const draft of internalDrafts) await seedClientDraft(tx, CLIENT_ORG, clientEngagement, draft, "internal");
    for (const draft of [funderDraft, funderInReview]) await seedClientDraft(tx, CLIENT_ORG, clientEngagement, draft, "funder");
  });
  // The earlier Board proofs' drafts in the same organization (same
  // deterministic fixtures): resolved ones are GK-reviewed and eligible
  // except 26010005, which that proof marks ineligible.
  const earlierDrafts = [
    draftFixture("26010001", 1, "evidence_summary"),
    draftFixture("26010002", 2, "data_gap_memo"),
    draftFixture("26010003", 3, "readiness_assessment"),
    draftFixture("26010004", 4, "impact_narrative", { queueStatus: "open", reviewStatus: "needs_gk_review" }),
    draftFixture("26010005", 5, "impact_narrative", { eligible: false }),
    draftFixture("26010006", 6, "data_gap_memo"),
    draftFixture("26010007", 7, "readiness_assessment"),
  ];
  const expectedVisibleDraftIds = [visibleInternal, funderDraft].map((draft) => draft.draftId).sort();

  const claimStates = new Map([
    [hiddenIneligible.claimId, "audience_gate_closed"],
    [awaitingClient.claimId, "client_followup_unresolved"],
    [earlierDrafts[4].claimId, "synthetic_ineligible"],
  ]);
  const clientRepository = createPostgresGeneratedContentRepository({
    runInTransaction: withRunnerOwnedTransaction,
    evaluator: clientEvaluator([...clientDrafts, ...earlierDrafts], claimStates),
  });
  const clientDeps = Object.freeze({
    env: enabledEnv,
    generatedContentRepository: clientRepository,
    listGeneratedDraftLibraryIndex: (organizationId, options) => readDraftIndexSql(organizationId, options, pool),
    readGeneratedDraftEngagementId: (organizationId, draftId) => readDraftEngagementSql(organizationId, draftId, pool),
    getEngagementForOrganization: (input) => readEngagementSql(input, pool),
  });
  const secrets = [
    "RAW EVIDENCE STATEMENT", inGkReview.draftId, hiddenIneligible.draftId, awaitingClient.draftId, funderInReview.draftId,
    earlierDrafts[3].draftId, earlierDrafts[4].draftId, "needs_gk_review", "review_queue", "reviewQueueItemId", "evidenceItemId",
    "sourceVersionId", "generationRunId", "blockerCodes", "exportReview", "exportManifest", "finalRelease",
    visibleInternal.evidenceId, visibleInternal.queueId, visibleInternal.runId, visibleInternal.citationId, visibleInternal.blockId,
    evidence.source_id, evidence.source_version_id,
  ];
  const assertClientSafe = (value, label) => {
    const serialized = JSON.stringify(value);
    for (const secret of secrets) assert.ok(!serialized.includes(secret), `${label} leaked ${secret}`);
  };
  async function mutationCounts() {
    const { rows } = await pool.query(`
      SELECT (SELECT count(*) FROM kai.review_queue_items)::int AS queue,
             (SELECT count(*) FROM kai.generated_content_drafts)::int AS drafts,
             (SELECT count(*) FROM kai.generated_content_blocks)::int AS blocks,
             (SELECT count(*) FROM kai.generation_runs)::int AS runs,
             (SELECT count(*) FROM kai.audit_events)::int AS audit,
             (SELECT string_agg(review_queue_item_id::text || queue_status || review_status || updated_at::text, ',' ORDER BY review_queue_item_id)
                FROM kai.review_queue_items WHERE organization_id = $1::uuid) AS queue_state`, [CLIENT_ORG]);
    return rows[0];
  }

  await test("client Generated Drafts (real PostgreSQL): only GK-reviewed, currently eligible drafts; identical for A/R/C; read-only", async () => {
    const before = await mutationCounts();
    const results = [];
    for (const role of CLIENT_ROLES) {
      const result = await listClientGeneratedDrafts({ organizationId: CLIENT_ORG, engagementId: clientEngagement, actorContext: clientActor(role) }, clientDeps);
      assert.equal(result.ok, true, `${role}: ${JSON.stringify(result)}`);
      assertClientSafe(result, `${role} list`);
      results.push(result.data);
    }
    assert.deepEqual(results[1], results[0]);
    assert.deepEqual(results[2], results[0]);
    assert.deepEqual(results[0].items.map((item) => item.generatedContentDraftId).sort(), expectedVisibleDraftIds);
    assert.equal(results[0].items.find((item) => item.generatedContentDraftId === funderDraft.draftId).audience, "funder");
    assert.equal(results[0].nextCursor, null);
    // The earlier proofs' reviewed, eligible drafts belong to other
    // engagements of the same organization and never appear in this project.
    for (const draft of [earlierDrafts[0], earlierDrafts[1], earlierDrafts[2], earlierDrafts[5], earlierDrafts[6]]) {
      assert.ok(!results[0].items.some((item) => item.generatedContentDraftId === draft.draftId), draft.draftId);
    }
    const otherProject = await listClientGeneratedDrafts(
      { organizationId: CLIENT_ORG, engagementId: "26010000-0000-4000-8000-000000000101", actorContext: clientActor("client_admin") },
      clientDeps,
    );
    assert.deepEqual(otherProject.data.items.map((item) => item.generatedContentDraftId).sort(), [earlierDrafts[0], earlierDrafts[1], earlierDrafts[2]].map((d) => d.draftId).sort());
    const crossProjectDetail = await getClientGeneratedDraft(
      { organizationId: CLIENT_ORG, engagementId: clientEngagement, generatedContentDraftId: earlierDrafts[0].draftId, actorContext: clientActor("client_admin") },
      clientDeps,
    );
    assert.equal(crossProjectDetail.error.code, "not_found", "another project's reviewed draft is not_found through this project's path");
    assert.equal(results[0].awaitingClientInputCount, 1, "the draft held only by an unresolved client follow-up is counted, not shown");
    assert.deepEqual(await mutationCounts(), before, "the list performs no write");
  });

  await test("client draft detail (real PostgreSQL): text and cited claim ids only; hidden, in-review, awaiting, and foreign drafts are not_found", async () => {
    const before = await mutationCounts();
    const detail = await getClientGeneratedDraft(
      { organizationId: CLIENT_ORG, engagementId: clientEngagement, generatedContentDraftId: visibleInternal.draftId, actorContext: clientActor("client_contributor") },
      clientDeps,
    );
    assert.equal(detail.ok, true, JSON.stringify(detail));
    assert.deepEqual(detail.data, {
      generatedContentDraftId: visibleInternal.draftId,
      contentType: "evidence_summary",
      audience: "internal",
      reviewState: "reviewed",
      blocks: [{ ordinal: 1, text: `${visibleInternal.label} client-visible text.`, supportingClaimIds: [visibleInternal.claimId] }],
    });
    assertClientSafe(detail, "detail");
    for (const draftId of [inGkReview.draftId, hiddenIneligible.draftId, awaitingClient.draftId, funderInReview.draftId, earlierDrafts[4].draftId, "26020000-0000-4000-8000-000000000999"]) {
      const denied = await getClientGeneratedDraft({ organizationId: CLIENT_ORG, engagementId: clientEngagement, generatedContentDraftId: draftId, actorContext: clientActor("client_reviewer") }, clientDeps);
      assert.equal(denied.ok, false, draftId);
      assert.equal(denied.error.code, "not_found", draftId);
      assertClientSafe(denied, `denied ${draftId}`);
    }
    assert.deepEqual(await mutationCounts(), before);
  });

  await test("client Grant Response Packet and Board Reporting previews (real PostgreSQL): governed membership only, no export/final state", async () => {
    const before = await mutationCounts();
    const grp = await getClientGrantResponsePacketPreview(
      { organizationId: CLIENT_ORG, engagementId: clientEngagement, actorContext: clientActor("client_admin") },
      clientDeps,
    );
    assert.equal(grp.ok, true, JSON.stringify(grp));
    assert.equal(grp.data.status, "available");
    assert.deepEqual(grp.data.drafts.map((draft) => draft.generatedContentDraftId), [funderDraft.draftId]);
    assert.deepEqual(Object.keys(grp.data).sort(), ["audience", "drafts", "engagementId", "status"]);
    const board = await getClientBoardReportingPreview(
      { organizationId: CLIENT_ORG, engagementId: clientEngagement, actorContext: clientActor("client_reviewer") },
      clientDeps,
    );
    assert.equal(board.ok, true, JSON.stringify(board));
    assert.deepEqual(board.data.drafts.map((draft) => draft.generatedContentDraftId), [visibleInternal.draftId], "Board keeps its own member types; the awaiting-client narrative stays out");
    assertClientSafe([grp, board], "previews");
    const foreignEngagement = await getClientBoardReportingPreview(
      { organizationId: CLIENT_ORG, engagementId: "26020000-0000-4000-8000-000000000202", actorContext: clientActor("client_admin") },
      clientDeps,
    );
    assert.equal(foreignEngagement.ok, false);
    assert.equal(foreignEngagement.error.code, "not_found");
    assert.deepEqual(await mutationCounts(), before);
  });

  await test("answering the client follow-up (evaluator no longer blocked) makes the held draft visible without creating any review, export, or final row", async () => {
    const before = await mutationCounts();
    claimStates.delete(awaitingClient.claimId);
    const list = await listClientGeneratedDrafts({ organizationId: CLIENT_ORG, engagementId: clientEngagement, actorContext: clientActor("client_reviewer") }, clientDeps);
    assert.equal(list.data.awaitingClientInputCount, 0);
    assert.ok(list.data.items.some((item) => item.generatedContentDraftId === awaitingClient.draftId));
    const detail = await getClientGeneratedDraft(
      { organizationId: CLIENT_ORG, engagementId: clientEngagement, generatedContentDraftId: awaitingClient.draftId, actorContext: clientActor("client_admin") },
      clientDeps,
    );
    assert.equal(detail.data.reviewState, "reviewed");
    assert.deepEqual(await mutationCounts(), before, "visibility changes create no review/export/final state");
    claimStates.set(awaitingClient.claimId, "client_followup_unresolved");
  });

  await test("cross-org clients are denied before any draft or packet row is read; GK reads of the same rows are unchanged", async () => {
    for (const result of [
      await listClientGeneratedDrafts({ organizationId: CLIENT_ORG, engagementId: clientEngagement, actorContext: clientActor("client_admin", FOREIGN_ORG) }, clientDeps),
      await getClientGeneratedDraft({ organizationId: CLIENT_ORG, engagementId: clientEngagement, generatedContentDraftId: visibleInternal.draftId, actorContext: clientActor("client_reviewer", FOREIGN_ORG) }, clientDeps),
      await getClientGrantResponsePacketPreview({ organizationId: CLIENT_ORG, engagementId: clientEngagement, actorContext: clientActor("client_contributor", FOREIGN_ORG) }, clientDeps),
    ]) {
      assert.equal(result.ok, false);
      assert.equal(result.blockers[0].validator_key, "VAL-AUT-003");
    }
    // A foreign-org member asking its own organization for this org's draft
    // ids gets nothing: every read is scoped to the requested organization.
    const ownForeign = await listClientGeneratedDrafts({ organizationId: FOREIGN_ORG, engagementId: clientEngagement, actorContext: clientActor("client_admin", FOREIGN_ORG) }, clientDeps);
    assert.equal(ownForeign.ok, false);
    assert.equal(ownForeign.error.code, "not_found", "this org's project is not a project of the foreign org");
    const foreignLookup = await getClientGeneratedDraft(
      { organizationId: FOREIGN_ORG, engagementId: clientEngagement, generatedContentDraftId: visibleInternal.draftId, actorContext: clientActor("client_admin", FOREIGN_ORG) },
      clientDeps,
    );
    assert.equal(foreignLookup.ok, false);
    assert.equal(foreignLookup.error.code, "not_found");
    assertClientSafe(foreignLookup, "foreign lookup");

    const gkActor = { ...ACTOR, organizationMemberships: [{ organization_id: CLIENT_ORG, membership_status: "active", role_name: "gk_reviewer" }] };
    const gkPacket = await getGeneratedDraftReviewPacket(
      { organizationId: CLIENT_ORG, generatedContentDraftId: inGkReview.draftId, actorContext: gkActor },
      { env: enabledEnv, generatedContentRepository: clientRepository },
    );
    assert.equal(gkPacket.ok, true, "GK still reads a draft that is in review");
    assert.equal(gkPacket.data.reviewStatus, "needs_gk_review");
    const gkGrp = await getGrantResponsePacket(
      { organizationId: CLIENT_ORG, engagementId: clientEngagement, actorContext: gkActor },
      { env: enabledEnv, generatedContentRepository: clientRepository },
    );
    assert.equal(gkGrp.ok, true, JSON.stringify(gkGrp));
    assert.deepEqual(gkGrp.data.drafts.map((draft) => draft.generatedContentDraftId), [funderDraft.draftId]);
    for (const role of CLIENT_ROLES) {
      const denied = await getGeneratedDraftReviewPacket(
        { organizationId: CLIENT_ORG, engagementId: clientEngagement, generatedContentDraftId: visibleInternal.draftId, actorContext: clientActor(role) },
        { env: enabledEnv, generatedContentRepository: clientRepository },
      );
      assert.equal(denied.ok, false, `${role} still cannot read the GK review packet`);
    }
  });

  await pool.end();
}
