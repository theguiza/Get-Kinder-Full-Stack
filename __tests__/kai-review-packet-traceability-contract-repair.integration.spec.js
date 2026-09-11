// Proves the validateTraceabilityData repair (missing evidence_review_decision
// / claim_review_decision / graph_relationships / graph_trace_completeness
// root keys) end to end through the ACTUAL mounted HTTP routes:
//
//   POST /api/kai/sprint2/intake/admin/organizations/:organizationId
//        /generated-content-drafts/evidence-summary/funder
//   GET  /api/kai/sprint2/intake/admin/organizations/:organizationId
//        /generated-content-drafts/:generatedContentDraftId/review-packet
//
// against a real ephemeral PostgreSQL database and the real repository/
// service stack - not a stub. Mirrors the existing P14-12 funder-evidence-
// summary route harness (app-building/listen/postRequestJson pattern), with
// a getRequestJson helper added for the review-packet GET. Only the LLM
// provider call inside createProductionEvidenceSummaryDraftGenerator() is
// replaced with a deterministic fixture, exactly as P14-12 does.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_REVIEW_PACKET_CONTRACT_REPAIR_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`review-packet-contract-repair integration suite refused a non-loopback KAI_REVIEW_PACKET_CONTRACT_REPAIR_DATABASE_URL host: ${host}`);
  }
}

test("review-packet-contract-repair PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("review-packet-contract-repair PostgreSQL isolation: this file imports no database/app module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|"express"|kaiDb\.js|sprint2IntakeApi\.js|postgresGeneratedContentRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("review-packet-contract-repair integration requires the runner-owned database", { skip: true }, () => {});
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
  void traceRepo;

  async function buildFunderEligibleClaim() {
    await seedPool.query(`INSERT INTO kai.organizations (organization_id, name) VALUES ($1::uuid, 'Review-Packet Contract Repair Org') ON CONFLICT DO NOTHING;`, [ORG]);
    await seedPool.query(`INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ($1::uuid, $2::uuid, 'REVIEW-PACKET-CONTRACT-REPAIR') ON CONFLICT DO NOTHING;`, [ENGAGEMENT, ORG]);

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
    // Proves the exact production drift this suite closes: the real
    // evaluator's success DTO always carries these four root keys, which
    // the pre-repair validateTraceabilityData did not allowlist.
    assert.equal(finalTrace.data.blockerCodes.length, 0);
    assert.ok("evidence_review_decision" in finalTrace.data);
    assert.ok("claim_review_decision" in finalTrace.data);
    assert.ok("graph_relationships" in finalTrace.data);
    assert.ok("graph_trace_completeness" in finalTrace.data);

    return { claimId, evidenceItemId: evidenceRow.evidence_item_id };
  }

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

  async function getRequestJson(server, path) {
    const { port } = server.address();
    return await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      });
      request.on("error", reject);
      request.end();
    });
  }

  test("review-packet-contract-repair: POST funder Evidence Summary then GET its review packet, both through the real mounted route, succeed with no conflict_current_state_changed", async () => {
    const { claimId, evidenceItemId } = await buildFunderEligibleClaim();
    const idempotencyKey = "review-packet-contract-repair-fresh-success";
    const app = createApp();
    const server = await listen(app);
    test.after(() => server.close());

    const requestBody = { claim_ids: [claimId], idempotency_key: idempotencyKey, engagement_id: ENGAGEMENT };
    const postResponse = await postRequestJson(server, `${basePath}/admin/organizations/${ORG}/generated-content-drafts/evidence-summary/funder`, requestBody);

    assert.equal(postResponse.statusCode, 201, JSON.stringify(postResponse.body));
    assert.equal(postResponse.body.ok, true, JSON.stringify(postResponse.body));
    assert.equal(postResponse.body.data.requestedAudience, "funder");
    assert.match(postResponse.body.data.generatedContentDraftId, /^[0-9a-f-]{36}$/);

    const draftId = postResponse.body.data.generatedContentDraftId;

    const getResponse = await getRequestJson(server, `${basePath}/admin/organizations/${ORG}/generated-content-drafts/${draftId}/review-packet`);

    assert.equal(getResponse.statusCode, 200, JSON.stringify(getResponse.body));
    assert.equal(getResponse.body.ok, true, JSON.stringify(getResponse.body));
    assert.notEqual(getResponse.body.error?.code, "conflict_current_state_changed", JSON.stringify(getResponse.body));

    const packet = getResponse.body.data;
    assert.equal(packet.generatedContentDraftId, draftId);
    assert.equal(packet.requestedAudience, "funder");
    assert.equal(packet.currentUseEligible, true);
    assert.equal(packet.blocks.length, 1);
    assert.equal(packet.blocks[0].citations.length, 1);
    assert.equal(packet.blocks[0].citations[0].claimId, claimId);
    assert.equal(packet.blocks[0].citations[0].evidenceItemId, evidenceItemId);
    assert.match(packet.reviewQueueItemId, /^[0-9a-f-]{36}$/);
    assert.ok(["open", "in_progress", "resolved"].includes(packet.queueStatus), JSON.stringify(packet));
    assert.equal(typeof packet.reviewStatus, "string");
  });
}
