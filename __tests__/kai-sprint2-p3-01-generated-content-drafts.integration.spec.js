import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P3_01_GENERATED_CONTENT_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P3-01 integration suite refused a non-loopback KAI_P3_01_GENERATED_CONTENT_DATABASE_URL host: ${host}`);
  }
}

test("P3-01 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P3-01 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresGeneratedContentRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P3-01 generated-content integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP301IntegrationSuite();
}

async function runP301IntegrationSuite() {
  const { Pool } = await import("pg");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { createEvidenceSummaryDraft } = await import("../Backend/kai/services/kaiGeneratedContentService.js");
  const { evaluateClaimTraceabilityInTransaction } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const {
    createPostgresGeneratedContentRepository,
    fingerprintEvidenceSummaryRequest,
  } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-06T10:00:00.000Z";
  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 20 });

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

  const actorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    source: "public.userdata",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
    ],
  };

  function auditRecorder({ prepareOk = true, publishThrows = false, published = [] } = {}) {
    return {
      prepareMetadataOnlyAudit() {
        if (!prepareOk) return { ok: false };
        return {
          ok: true,
          async publish() {
            if (publishThrows) throw new Error("forced audit publish failure");
            published.push(true);
          },
        };
      },
    };
  }

  function traceabilitySuccess(claim) {
    return {
      ok: true,
      data: {
        claim: { claim_id: claim.claim_id },
        evidence: { evidence_item_id: claim.evidence_item_id },
        requestedAudience: "internal",
        eligible: true,
      },
      error: null,
    };
  }

  function generator({ calls = [] } = {}) {
    return async (input) => {
      calls.push(input);
      return {
        blocks: [{
          ordinal: 1,
          text: input.claims[0].claimStatement,
          citations: [{ claimId: input.claims[0].claimId, evidenceItemId: input.claims[0].evidenceItemId }],
        }],
      };
    };
  }

  const evidenceRepo = createPostgresEvidenceLineageRepository({ runInTransaction: withRunnerOwnedTransaction });
  const claimRepo = createPostgresClaimProposalRepository({ runInTransaction: withRunnerOwnedTransaction });
  const gapRepo = createPostgresClaimGapFollowupRepository({ runInTransaction: withRunnerOwnedTransaction });

  test.after(async () => {
    await pool.end();
  });

  async function query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  }

  let preparedClaim = null;
  async function prepareClaim() {
    if (preparedClaim) return preparedClaim;
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
    assert.equal(evidenceResult.ok, true);
    const evidenceRows = await query(
      `SELECT evidence_item_id, statement
         FROM kai.evidence_items
        WHERE organization_id = $1::uuid
        ORDER BY evidence_item_id
        LIMIT 1`,
      [ORG],
    );
    const claimResult = await proposeClaim(
      { organizationId: ORG, evidenceItemId: evidenceRows[0].evidence_item_id, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: claimRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(claimResult.ok, true);
    const gapResult = await generateClaimGapFollowups(
      { organizationId: ORG, claimId: claimResult.data.claim.claim_id, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimGapFollowupRepository: gapRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(gapResult.ok, true);
    const rows = await query(
      `SELECT claim_id::text AS claim_id, evidence_item_id::text AS evidence_item_id, statement
         FROM kai.claims
        WHERE organization_id = $1::uuid
          AND claim_id = $2::uuid`,
      [ORG, claimResult.data.claim.claim_id],
    );
    preparedClaim = rows[0];
    return preparedClaim;
  }

  function serviceInput(claim, idempotencyKey) {
    return {
      organizationId: ORG,
      requestedAudience: "internal",
      claimIds: [claim.claim_id],
      idempotencyKey,
      actorContext,
      now: NOW,
    };
  }

  function generatedRepo(options = {}) {
    return createPostgresGeneratedContentRepository({
      runInTransaction: withRunnerOwnedTransaction,
      async evaluator(tx, input) {
        const rows = await tx.query(
          `SELECT claim_id::text AS claim_id, evidence_item_id::text AS evidence_item_id
             FROM kai.claims
            WHERE organization_id = $1::uuid AND claim_id = $2::uuid`,
          [input.organizationId, input.claimId],
        );
        return traceabilitySuccess(rows.rows[0]);
      },
      ...options,
    });
  }

  async function countsForKey(idempotencyKey) {
    const rows = await query(
      `WITH run AS (
         SELECT generation_run_id FROM kai.generation_runs
          WHERE organization_id = $1::uuid AND idempotency_key = $2
       ),
       draft AS (
         SELECT generated_content_draft_id FROM kai.generated_content_drafts
          WHERE generation_run_id IN (SELECT generation_run_id FROM run)
       ),
       block AS (
         SELECT generated_content_block_id FROM kai.generated_content_blocks
          WHERE generated_content_draft_id IN (SELECT generated_content_draft_id FROM draft)
       )
       SELECT
         (SELECT count(*)::int FROM run) AS runs,
         (SELECT count(*)::int FROM draft) AS drafts,
         (SELECT count(*)::int FROM block) AS blocks,
         (SELECT count(*)::int FROM kai.generated_content_citations
           WHERE generated_content_block_id IN (SELECT generated_content_block_id FROM block)) AS citations,
         (SELECT count(*)::int FROM kai.review_queue_items
           WHERE queue_type = 'generated_content_review'
             AND target_object_id IN (SELECT generated_content_draft_id FROM draft)) AS queues,
         (SELECT count(*)::int FROM kai.upload_lifecycle_audit
           WHERE operation = 'generated_content_draft_created'
             AND metadata->>'generation_run_id' IN (SELECT generation_run_id::text FROM run)) AS audits`,
      [ORG, idempotencyKey],
    );
    return rows[0];
  }

  test("Package 14-05: P3-01 real service path allows an internally governed but currently ineligible claim to generate an internal draft, while eligibility and blockers remain truthful before, during, and after generation", async () => {
    const claim = await prepareClaim();
    const key = "real-allow-ineligible";
    const before = await countsForKey(key);

    // BEFORE CREATION: the claim exists through the real governed path, and
    // the real (unmodified default) P2-06 evaluator reports it ineligible --
    // this freshly proposed claim has not completed evidence/claim review.
    const preEligibility = await withRunnerOwnedTransaction((tx) => evaluateClaimTraceabilityInTransaction(tx, {
      organizationId: ORG,
      claimId: claim.claim_id,
      requestedAudience: "internal",
    }));
    assert.equal(preEligibility.ok, true);
    assert.equal(preEligibility.data.eligible, false);
    const preBlockerCodes = preEligibility.data.blockerCodes;
    assert.ok(Array.isArray(preBlockerCodes) && preBlockerCodes.length > 0);

    // CREATE: the real default (unmodified) evaluator is used -- no injected
    // eligible:true stub -- and the real repository/service path is exercised
    // end to end.
    const calls = [];
    const published = [];
    const result = await createEvidenceSummaryDraft(
      serviceInput(claim, key),
      {
        env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
        generatedContentRepository: createPostgresGeneratedContentRepository({
          runInTransaction: withRunnerOwnedTransaction,
        }),
        draftGenerator: generator({ calls }),
        metadataOnlyAudit: auditRecorder({ published }),
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.replayed, false);
    assert.equal(calls.length, 1);
    // The generator received the real governed claim and its real current
    // limitation/blocker codes on the existing limitationCodes channel.
    assert.equal(calls[0].claims[0].claimId, claim.claim_id);
    assert.equal(calls[0].claims[0].evidenceItemId, claim.evidence_item_id);
    assert.deepEqual(calls[0].claims[0].limitationCodes, [...new Set(preBlockerCodes)].sort());

    assert.deepEqual(await countsForKey(key), { runs: 1, drafts: 1, blocks: 1, citations: 1, queues: 1, audits: 1 });
    assert.deepEqual(published, [true]);

    // AFTER CREATION: re-evaluate current traceability directly -- generation
    // must not itself alter review/eligibility state.
    const postEligibility = await withRunnerOwnedTransaction((tx) => evaluateClaimTraceabilityInTransaction(tx, {
      organizationId: ORG,
      claimId: claim.claim_id,
      requestedAudience: "internal",
    }));
    assert.equal(postEligibility.ok, true);
    assert.equal(postEligibility.data.eligible, false);

    // REQUIRED REVIEW-PACKET PROOF (spec section 13): read the newly-created
    // draft back through the real review-packet repository surface and prove
    // currentUseEligible=false and citation currentEligible=false, with
    // blocker/review/lineage metadata preserved and truthful.
    const packetResult = await createPostgresGeneratedContentRepository({
      runInTransaction: withRunnerOwnedTransaction,
    }).getGeneratedDraftReviewPacket({
      organizationId: ORG,
      generatedContentDraftId: result.data.generatedContentDraftId,
    });
    assert.equal(packetResult.ok, true, packetResult.error?.code);
    assert.equal(packetResult.data.draftStatus, "draft");
    assert.equal(packetResult.data.currentUseEligible, false);
    assert.equal(packetResult.data.blocks.length, 1);
    const [citation] = packetResult.data.blocks[0].citations;
    assert.equal(citation.claimId, claim.claim_id);
    assert.equal(citation.evidenceItemId, claim.evidence_item_id);
    assert.equal(citation.sourceId, postEligibility.data.source.source_id);
    assert.equal(citation.sourceVersionId, postEligibility.data.source_version.source_version_id);
    assert.equal(citation.currentEligible, false);
    assert.deepEqual(citation.blockerCodes, [...new Set(postEligibility.data.blockerCodes)]);
    assert.equal(citation.supportStrength, postEligibility.data.evidence.support_strength);
    assert.equal(citation.claimReviewStatus, postEligibility.data.claim.claim_review_status);
    assert.equal(citation.evidenceReviewStatus, postEligibility.data.evidence.evidence_review_status);
    assert.deepEqual(citation.affectedDimensionKeys, postEligibility.data.affectedDimensionKeys);
    assert.deepEqual(citation.affectedObjectIds, postEligibility.data.affectedObjectIds);

    const afterReadEligibility = await withRunnerOwnedTransaction((tx) => evaluateClaimTraceabilityInTransaction(tx, {
      organizationId: ORG,
      claimId: claim.claim_id,
      requestedAudience: "internal",
    }));
    assert.equal(afterReadEligibility.ok, true);
    assert.equal(afterReadEligibility.data.eligible, false);

    // DOWNSTREAM SAFETY (P2-08): the currently-ineligible claim continues to
    // be excluded from the P2-08 eligible-claims-for-audience result.
    const { listEligibleClaimsForAudience } = await import("../Backend/kai/services/kaiEligibleClaimsForAudienceService.js");
    const { createPostgresEligibleClaimsForAudienceRepository } = await import("../Backend/kai/dictionary/postgresEligibleClaimsForAudienceRepository.js");
    const eligibleClaimsResult = await listEligibleClaimsForAudience(
      { organizationId: ORG, requestedAudience: "internal", limit: 25, afterClaimId: null, actorContext },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        eligibleClaimsForAudienceRepository: createPostgresEligibleClaimsForAudienceRepository({ runInTransaction: withRunnerOwnedTransaction }),
      },
    );
    assert.equal(eligibleClaimsResult.ok, true);
    assert.ok(!eligibleClaimsResult.data.eligibleClaims.some((item) => item.claimId === claim.claim_id));
  });

  test("P3-01 injected repository path persists one complete run/draft/block/citation/queue/audit set and exact generator input", async () => {
    const claim = await prepareClaim();
    const calls = [];
    const published = [];
    const result = await createEvidenceSummaryDraft(
      serviceInput(claim, "fresh-ok-1"),
      {
        env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
        generatedContentRepository: generatedRepo(),
        draftGenerator: generator({ calls }),
        metadataOnlyAudit: auditRecorder({ published }),
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.replayed, false);
    assert.equal(calls.length, 1);
    assert.deepEqual(Object.keys(calls[0]).sort(), ["claims", "contentType", "requestedAudience"]);
    assert.deepEqual(Object.keys(calls[0].claims[0]).sort(), [
      "claimId",
      "claimStatement",
      "claimType",
      "evidenceItemId",
      "limitationCodes",
      "sourceId",
      "sourceVersionId",
    ]);
    assert.deepEqual(await countsForKey("fresh-ok-1"), { runs: 1, drafts: 1, blocks: 1, citations: 1, queues: 1, audits: 1 });
    assert.deepEqual(published, [true]);
  });

  test("P3-01 identical replay returns replayed with zero generator calls, writes, and audit", async () => {
    const claim = await prepareClaim();
    const calls = [];
    const replay = await createEvidenceSummaryDraft(
      serviceInput(claim, "fresh-ok-1"),
      {
        env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
        generatedContentRepository: generatedRepo(),
        draftGenerator: generator({ calls }),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);
    assert.equal(calls.length, 0);
    assert.deepEqual(await countsForKey("fresh-ok-1"), { runs: 1, drafts: 1, blocks: 1, citations: 1, queues: 1, audits: 1 });
  });

  test("P3-01 same key with changed fingerprint returns duplicate_conflict before generator or writes", async () => {
    const claim = await prepareClaim();
    let calls = 0;
    const result = await createEvidenceSummaryDraft(
      { ...serviceInput(claim, "fresh-ok-1"), claimIds: ["00000000-0000-4000-8000-000000000999"] },
      {
        env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
        generatedContentRepository: generatedRepo(),
        draftGenerator() {
          calls += 1;
          throw new Error("must not call");
        },
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(result.error.code, "duplicate_conflict");
    assert.equal(calls, 0);
  });

  test("P3-01 malformed partial existing state fails without repair", async () => {
    const claim = await prepareClaim();
    const request = serviceInput(claim, "partial-state");
    await query(
      `INSERT INTO kai.generation_runs (organization_id, idempotency_key, request_fingerprint, content_type, requested_audience, created_by_type, created_at)
       VALUES ($1::uuid,$2,$3,'evidence_summary','internal','system',$4::timestamptz)`,
      [ORG, request.idempotencyKey, fingerprintEvidenceSummaryRequest(request), NOW],
    );
    const result = await createEvidenceSummaryDraft(
      request,
      {
        env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
        generatedContentRepository: generatedRepo(),
        draftGenerator: generator(),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(result.error.code, "conflict_current_state_changed");
    assert.deepEqual(await countsForKey("partial-state"), { runs: 1, drafts: 0, blocks: 0, citations: 0, queues: 0, audits: 0 });
  });

  test("P3-01 concurrent identical calls converge to one generator invocation and one audit", async () => {
    const claim = await prepareClaim();
    const calls = [];
    const repo = generatedRepo();
    const request = serviceInput(claim, "concurrent-ok");
    const deps = {
      env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
      generatedContentRepository: repo,
      draftGenerator: generator({ calls }),
      metadataOnlyAudit: auditRecorder(),
    };
    const results = await Promise.all([
      createEvidenceSummaryDraft(request, deps),
      createEvidenceSummaryDraft(request, deps),
    ]);
    assert.equal(results.every((result) => result.ok), true);
    assert.equal(results.filter((result) => result.data.replayed === false).length, 1);
    assert.equal(results.filter((result) => result.data.replayed === true).length, 1);
    assert.equal(calls.length, 1);
    assert.deepEqual(await countsForKey("concurrent-ok"), { runs: 1, drafts: 1, blocks: 1, citations: 1, queues: 1, audits: 1 });
  });

  for (const [label, depsFactory] of [
    ["generator", () => ({ draftGenerator: async () => { throw new Error("forced generator failure"); } })],
    ["validator", () => ({ draftGenerator: async () => ({ blocks: [{ ordinal: 1, text: "Unsupported 999.", citations: [{ claimId: "00000000-0000-4000-8000-000000000999", evidenceItemId: "00000000-0000-4000-8000-000000000999" }] }] }) })],
    ["post-write", () => ({ repository: generatedRepo({ afterPersist: async () => { throw new Error("forced post write"); } }), draftGenerator: generator() })],
    ["audit-prepare", () => ({ draftGenerator: generator(), metadataOnlyAudit: auditRecorder({ prepareOk: false }) })],
    ["audit-publication", () => ({ draftGenerator: generator(), metadataOnlyAudit: auditRecorder({ publishThrows: true }) })],
  ]) {
    test(`P3-01 ${label} failure rolls back every generation row including reservation`, async () => {
      const claim = await prepareClaim();
      const key = `rollback-${label}`;
      const overrides = depsFactory();
      const result = await createEvidenceSummaryDraft(
        serviceInput(claim, key),
        {
          env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
          generatedContentRepository: overrides.repository || generatedRepo(),
          draftGenerator: overrides.draftGenerator,
          metadataOnlyAudit: overrides.metadataOnlyAudit || auditRecorder(),
        },
      );
      assert.equal(result.ok, false);
      assert.deepEqual(await countsForKey(key), { runs: 0, drafts: 0, blocks: 0, citations: 0, queues: 0, audits: 0 });
    });
  }
}
