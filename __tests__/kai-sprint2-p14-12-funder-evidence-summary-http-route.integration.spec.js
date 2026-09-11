// KAI P14-12: closes out the P14-09/P14-11 funder Evidence Summary
// production-audit-composition repair by exercising the ACTUAL mounted
// HTTP route end to end:
//
//   POST /api/kai/sprint2/intake/admin/organizations/:organizationId
//        /generated-content-drafts/evidence-summary/funder
//
// against a real ephemeral PostgreSQL database, the real repository/service
// stack (createDefaultGeneratedContentRepository -> real withTransaction ->
// real pg pool), and the real production audit adapter
// (createProductionMetadataOnlyAuditForGeneratedContentDraft, as the route
// itself constructs it) - not a stub. Only the LLM provider call inside
// createProductionEvidenceSummaryDraftGenerator() is replaced with a
// deterministic fixture, by patching the shared Anthropic SDK Messages
// resource prototype (the route hardcodes the production generator with no
// per-request injection seam) so no real network/LLM call is made.
//
// This is the final closure proof for the P14-11 repair
// (Backend/kai/dictionary/postgresGeneratedContentRepository.js:
// prepareRequiredAudit now receives generated_content_draft_id + db:tx) -
// it proves the fix holds through the real route, not just the repository
// call site directly.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P14_12_FUNDER_EVIDENCE_HTTP_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P14-12 funder-evidence-summary-http-route integration suite refused a non-loopback KAI_P14_12_FUNDER_EVIDENCE_HTTP_DATABASE_URL host: ${host}`);
  }
}

test("P14-12 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P14-12 PostgreSQL isolation: this file imports no database/app module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|"express"|kaiDb\.js|sprint2IntakeApi\.js|postgresGeneratedContentRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P14-12 funder-evidence-summary-http-route integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const http = await import("node:http");
  const { default: express } = await import("express");
  const { Pool } = await import("pg");
  const AnthropicModule = await import("@anthropic-ai/sdk");
  const Anthropic = AnthropicModule.default;

  // The route hardcodes createProductionEvidenceSummaryDraftGenerator() with
  // no per-request injection point, and the module under test builds its
  // own private `new Anthropic()` instance at import time. All instances of
  // the SDK's Messages resource share one prototype, so patching it here -
  // before any request is made - deterministically intercepts every call
  // without touching production code or making a real network/LLM call.
  const probe = new Anthropic({ apiKey: "sk-ant-test-unused-dummy-key" });
  const messagesPrototype = Object.getPrototypeOf(probe.messages);
  const originalCreate = messagesPrototype.create;
  messagesPrototype.create = async function fakeCreate(payload) {
    const requestBody = JSON.parse(payload.messages[0].content);
    const claim = requestBody.claims[0];
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          blocks: [{
            text: claim.claimStatement,
            citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }],
          }],
        }),
      }],
    };
  };
  test.after(() => {
    messagesPrototype.create = originalCreate;
  });

  const {
    default: sprint2IntakeApiRouter,
  } = await import("../Backend/kai/routes/sprint2IntakeApi.js");
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const {
    handleKaiSprint2JsonParserError,
    kaiSprint2ActorMutationLimiter,
    kaiSprint2MetadataJsonParser,
    kaiSprint2OrganizationMutationLimiter,
    setKaiSprint2NoStore,
  } = await import("../Backend/kai/middleware/kaiSprint2RequestSafety.js");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { recordEvidenceReviewDecision, recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { completeClientFollowup } = await import("../Backend/kai/services/kaiClientFollowupCompletionService.js");
  const { acceptFunderCoverageLimitation } = await import("../Backend/kai/services/kaiCoverageReviewDecisionService.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { createPostgresHumanReviewRepository } = await import("../Backend/kai/dictionary/postgresHumanReviewRepository.js");
  const { createPostgresClaimTraceabilityRepository, evaluateClaimTraceabilityInTransaction } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");
  const { createPostgresCoverageReviewDecisionRepository } = await import("../Backend/kai/dictionary/postgresCoverageReviewDecisionRepository.js");
  const { createPostgresClientFollowupCompletionRepository } = await import("../Backend/kai/dictionary/postgresClientFollowupCompletionRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const ENGAGEMENT = "00000000-0000-4000-8000-000000000501";
  const NOW = "2026-08-06T10:00:00.000Z";
  const basePath = "/api/kai/sprint2/intake";

  // Seeding pool: a separate connection to the exact same real, ephemeral,
  // synthetic-only database the mounted route's own (env-wired) pool talks
  // to - used only to build a real, funder-eligible claim/evidence graph
  // through the real proposal/review/authority pipeline before the HTTP
  // request is made.
  const seedPool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 10 });
  async function withTx(callback) {
    const client = await seedPool.connect();
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
    return (await seedPool.query(sql, params)).rows;
  }
  test.after(async () => {
    await seedPool.end();
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
  function stubAuditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  const evidenceRepo = createPostgresEvidenceLineageRepository({ runInTransaction: withTx });
  const claimRepo = createPostgresClaimProposalRepository({ runInTransaction: withTx });
  const gapRepo = createPostgresClaimGapFollowupRepository({ runInTransaction: withTx });
  const humanReviewRepo = createPostgresHumanReviewRepository({ runInTransaction: withTx });
  const traceRepo = createPostgresClaimTraceabilityRepository({ runInTransaction: withTx });
  const coverageRepo = createPostgresCoverageReviewDecisionRepository({ runInTransaction: withTx });
  const clientFollowupRepo = createPostgresClientFollowupCompletionRepository({ runInTransaction: withTx });

  async function buildFunderEligibleClaim() {
    await seedPool.query(`INSERT INTO kai.organizations (organization_id, name) VALUES ($1::uuid, 'P14-12 Funder Evidence HTTP Route Org') ON CONFLICT DO NOTHING;`, [ORG]);
    await seedPool.query(`INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ($1::uuid, $2::uuid, 'P14-12-FUNDER-EVIDENCE-HTTP') ON CONFLICT DO NOTHING;`, [ENGAGEMENT, ORG]);

    const [sourceVersion] = await query(
      `SELECT source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1`,
      [ORG],
    );
    const evidenceResult = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: sourceVersion.source_version_id, actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceLineageRepository: evidenceRepo, metadataOnlyAudit: stubAuditRecorder() },
    );
    assert.equal(evidenceResult.ok, true, JSON.stringify(evidenceResult));
    const [evidenceRow] = await query(
      `SELECT evidence_item_id FROM kai.evidence_items
        WHERE organization_id = $1::uuid
          AND NOT EXISTS (SELECT 1 FROM kai.claims c WHERE c.organization_id = kai.evidence_items.organization_id AND c.evidence_item_id = kai.evidence_items.evidence_item_id)
        ORDER BY evidence_item_id ASC LIMIT 1`,
      [ORG],
    );
    const claimResult = await proposeClaim(
      { organizationId: ORG, evidenceItemId: evidenceRow.evidence_item_id, actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: claimRepo, metadataOnlyAudit: stubAuditRecorder() },
    );
    assert.equal(claimResult.ok, true, JSON.stringify(claimResult));
    const claimId = claimResult.data.claim.claim_id;
    const gapResult = await generateClaimGapFollowups(
      { organizationId: ORG, claimId, actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimGapFollowupRepository: gapRepo, metadataOnlyAudit: stubAuditRecorder() },
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
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: stubAuditRecorder() },
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
          AND NOT EXISTS (SELECT 1 FROM kai.intake_sensitivity_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)`,
      [ORG, lineage.intake_sensitivity_profile_id],
    );
    await seedPool.query(
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
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: stubAuditRecorder() },
    );
    assert.equal(claimReviewResult.ok, true, JSON.stringify(claimReviewResult));

    const traced = await withTx((tx) => evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "funder" }));
    const unresolved = Object.entries(traced.data.dimensions).filter(([, v]) => v.assessment_status === "unresolved").map(([k]) => k);
    for (const dimensionKey of unresolved) {
      const acceptResult = await acceptFunderCoverageLimitation(
        { organizationId: ORG, claimId, dimensionKey, actorContext: reviewerActor, now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, coverageReviewDecisionRepository: coverageRepo, metadataOnlyAudit: stubAuditRecorder() },
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
        { env: { KAI_SPRINT2_ENABLED: "true" }, clientFollowupCompletionRepository: clientFollowupRepo, metadataOnlyAudit: stubAuditRecorder() },
      );
      assert.equal(completeResult.ok, true, JSON.stringify(completeResult));
    }

    const finalTrace = await withTx((tx) => evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "funder" }));
    assert.equal(finalTrace.data.eligible, true, "fixture must be funder-eligible before exercising the real mounted route");

    return { claimId, evidenceItemId: evidenceRow.evidence_item_id };
  }

  // --- real mounted-route HTTP harness (mirrors the existing P14-09
  // funder-evidence-summary route-boundary harness's app-building/listen/
  // postRequestJson pattern) ---
  function createApp() {
    const app = express();
    app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
    app.use(basePath, handleKaiSprint2JsonParserError);
    app.use(basePath, (req, res, next) => {
      req.isAuthenticated = () => true;
      req.user = { id: 46 };
      req.kaiSprint2ActorContext = reviewerActor;
      return next();
    });
    app.use(
      basePath,
      requireKaiSprint2Enabled,
      kaiSprint2OrganizationMutationLimiter,
      kaiSprint2ActorMutationLimiter,
      (req, res, next) => (req.isAuthenticated() ? next() : res.status(401).json({ ok: false, error: { code: "unauthorized" }, data: null })),
      sprint2IntakeApiRouter,
    );
    return app;
  }

  async function listen(app) {
    return await new Promise((resolve, reject) => {
      const server = app.listen(0, "127.0.0.1");
      server.once("listening", () => resolve(server));
      server.once("error", reject);
    });
  }

  async function postRequestJson(server, path, body) {
    const { port } = server.address();
    return await new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const request = http.request({
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      });
      request.on("error", reject);
      request.end(payload);
    });
  }

  async function durableGraphRowCount(idempotencyKey) {
    const runs = await query(`SELECT count(*)::int AS n FROM kai.generation_runs WHERE organization_id = $1::uuid AND idempotency_key = $2`, [ORG, idempotencyKey]);
    const drafts = await query(
      `SELECT count(*)::int AS n FROM kai.generated_content_drafts d
         JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id
        WHERE r.organization_id = $1::uuid AND r.idempotency_key = $2`,
      [ORG, idempotencyKey],
    );
    const blocks = await query(
      `SELECT count(*)::int AS n FROM kai.generated_content_blocks b
         JOIN kai.generated_content_drafts d ON d.generated_content_draft_id = b.generated_content_draft_id
         JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id
        WHERE r.organization_id = $1::uuid AND r.idempotency_key = $2`,
      [ORG, idempotencyKey],
    );
    const citations = await query(
      `SELECT count(*)::int AS n FROM kai.generated_content_citations c
         JOIN kai.generated_content_blocks b ON b.generated_content_block_id = c.generated_content_block_id
         JOIN kai.generated_content_drafts d ON d.generated_content_draft_id = b.generated_content_draft_id
         JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id
        WHERE r.organization_id = $1::uuid AND r.idempotency_key = $2`,
      [ORG, idempotencyKey],
    );
    const queueItems = await query(
      `SELECT count(*)::int AS n FROM kai.review_queue_items q
         JOIN kai.generated_content_drafts d ON d.generated_content_draft_id = q.target_object_id
         JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id
        WHERE r.organization_id = $1::uuid AND r.idempotency_key = $2 AND q.queue_type = 'generated_content_review'`,
      [ORG, idempotencyKey],
    );
    return { generation_runs: runs[0].n, generated_content_drafts: drafts[0].n, generated_content_blocks: blocks[0].n, generated_content_citations: citations[0].n, review_queue_items: queueItems[0].n };
  }

  test("P14-12: the actual mounted funder Evidence Summary HTTP route, backed by real PostgreSQL and the real production audit adapter, succeeds end to end with no system_error", async () => {
    const { claimId, evidenceItemId } = await buildFunderEligibleClaim();
    const idempotencyKey = "p14-12-http-route-fresh-success";
    const app = createApp();
    const server = await listen(app);
    test.after(() => server.close());

    const requestBody = { claim_ids: [claimId], idempotency_key: idempotencyKey, engagement_id: ENGAGEMENT };
    const response = await postRequestJson(server, `${basePath}/admin/organizations/${ORG}/generated-content-drafts/evidence-summary/funder`, requestBody);

    assert.equal(response.statusCode, 201, JSON.stringify(response.body));
    assert.equal(response.body.ok, true, JSON.stringify(response.body));
    assert.ok(response.body.error === null || response.body.error === undefined, JSON.stringify(response.body));
    assert.equal(response.body.data.requestedAudience, "funder");
    assert.match(response.body.data.generatedContentDraftId, /^[0-9a-f-]{36}$/);
    assert.equal(response.body.data.replayed, false);
    assert.ok(Array.isArray(response.body.data.blocks) && response.body.data.blocks.length === 1);
    assert.ok(Array.isArray(response.body.data.blocks[0].citations) && response.body.data.blocks[0].citations.length === 1);
    assert.equal(response.body.data.blocks[0].citations[0].claimId, claimId);
    assert.equal(response.body.data.blocks[0].citations[0].evidenceItemId, evidenceItemId);
    assert.match(response.body.data.reviewQueueItemId, /^[0-9a-f-]{36}$/);

    const draftId = response.body.data.generatedContentDraftId;
    const graph = await durableGraphRowCount(idempotencyKey);
    assert.equal(graph.generation_runs, 1);
    assert.equal(graph.generated_content_drafts, 1);
    assert.equal(graph.generated_content_blocks, 1);
    assert.equal(graph.generated_content_citations, 1);
    assert.equal(graph.review_queue_items, 1, "the generated_content_review queue row must exist");

    const auditRows = await query(
      `SELECT metadata FROM kai.audit_events
        WHERE organization_id = $1::uuid AND metadata->>'object_id' = $2 AND metadata->>'operation' = 'generated_content_draft_created'`,
      [ORG, draftId],
    );
    assert.equal(auditRows.length, 1, "the required audit event, written by the real production audit adapter, must be durably committed for this exact draft");
    assert.equal(auditRows[0].metadata.target_object_type, "generated_content_draft");

    // --- identical replay with the same idempotency key ---
    const replayResponse = await postRequestJson(server, `${basePath}/admin/organizations/${ORG}/generated-content-drafts/evidence-summary/funder`, requestBody);
    assert.equal(replayResponse.statusCode, 201, JSON.stringify(replayResponse.body));
    assert.equal(replayResponse.body.ok, true, JSON.stringify(replayResponse.body));
    assert.equal(replayResponse.body.data.generatedContentDraftId, draftId, "replay must return the exact same draft, not a new one");
    assert.equal(replayResponse.body.data.replayed, true);

    const graphAfterReplay = await durableGraphRowCount(idempotencyKey);
    assert.deepEqual(graphAfterReplay, graph, "the identical idempotency-key replay must not create any duplicate generation graph or duplicate review queue item");

    const auditRowsAfterReplay = await query(
      `SELECT count(*)::int AS n FROM kai.audit_events WHERE organization_id = $1::uuid AND metadata->>'object_id' = $2 AND metadata->>'operation' = 'generated_content_draft_created'`,
      [ORG, draftId],
    );
    assert.equal(auditRowsAfterReplay[0].n, 1, "replay must not write a duplicate audit event either");
  });
}
