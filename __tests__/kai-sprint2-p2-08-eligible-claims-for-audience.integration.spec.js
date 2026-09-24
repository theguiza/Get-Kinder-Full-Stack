import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_08_ELIGIBLE_CLAIMS_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P2-08 integration suite refused a non-loopback KAI_P2_08_ELIGIBLE_CLAIMS_DATABASE_URL host: ${host}`);
  }
}

test("P2-08 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P2-08 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresEligibleClaimsForAudienceRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P2-08 eligible-claims integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP208IntegrationSuite();
}

async function runP208IntegrationSuite() {
  const { Pool } = await import("pg");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { getClaimTraceabilitySummaryTool } = await import("../Backend/kai/services/kaiAssistantClaimTraceabilityTool.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { createPostgresEligibleClaimsForAudienceRepository } = await import("../Backend/kai/dictionary/postgresEligibleClaimsForAudienceRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-06T10:00:00.000Z";
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
      await client.query("BEGIN");
      const result = await callback(wrapped);
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

  function auditRecorder() {
    return {
      prepareMetadataOnlyAudit() {
        return { ok: true, async publish() {} };
      },
    };
  }

  const evidenceRepo = createPostgresEvidenceLineageRepository({ runInTransaction: withRunnerOwnedTransaction });
  const claimRepo = createPostgresClaimProposalRepository({ runInTransaction: withRunnerOwnedTransaction });
  const gapRepo = createPostgresClaimGapFollowupRepository({ runInTransaction: withRunnerOwnedTransaction });
  const eligibleRepo = createPostgresEligibleClaimsForAudienceRepository({ runInTransaction: withRunnerOwnedTransaction });

  test.after(async () => {
    await pool.end();
  });

  async function query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  }

  let preparedClaimId = null;
  async function prepareClaim() {
    if (preparedClaimId) return preparedClaimId;
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
      `SELECT evidence_item_id
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
    preparedClaimId = claimResult.data.claim.claim_id;
    return preparedClaimId;
  }

  test("P2-08 end-to-end wrapper returns successful empty list for accepted proposed internal-only review-gated claim without audience approval", async () => {
    await prepareClaim();
    const beforeAudit = await query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit`);
    transactionLog.length = 0;
    const result = await getClaimTraceabilitySummaryTool(
      {
        toolName: "list_eligible_claims_for_audience",
        arguments: { organizationId: ORG, requestedAudience: "internal", limit: 10, afterClaimId: null },
        actorContext,
      },
      {
        env: { KAI_SPRINT2_ENABLED: "true", KAI_ASSISTANT_TOOLS_ENABLED: "true" },
        eligibleClaimsForAudienceServiceDependencies: {
          env: { KAI_SPRINT2_ENABLED: "true" },
          eligibleClaimsForAudienceRepository: eligibleRepo,
        },
      },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, {
      requestedAudience: "internal",
      eligibleClaims: [],
      limit: 10,
      afterClaimId: null,
      truncated: false,
      nextAfterClaimId: null,
    });
    assert.equal(transactionLog.filter((sql) => /REPEATABLE READ READ ONLY/.test(sql)).length, 1);
    assert.equal(transactionLog.some((sql) => /\bINSERT\b|\bUPDATE\b|\bDELETE\b|prepareMetadataOnlyAudit|upload_lifecycle_audit/i.test(sql)), false);
    const afterAudit = await query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit`);
    assert.deepEqual(afterAudit, beforeAudit);
  });

  // Client-safe Impact Home summary over the same real, governed state: an
  // unreviewed/unapproved claim with internal-only evidence and its GK
  // review work must not count, leak, or make a client Home non-empty.
  const { getImpactHomeSummary } = await import("../Backend/kai/services/kaiImpactHomeSummaryService.js");
  const { listClientFollowupWorkflowsForOrganization } = await import("../Backend/kai/db/kaiIntakeQueries.js");
  const clientActor = (roleName) => ({
    ...actorContext,
    actorUserId: `90000000-0000-4000-8000-00000000000${roleName === "client_admin" ? 2 : 3}`,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: roleName }],
  });
  const summaryDependencies = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    eligibleClaimsForAudienceRepository: eligibleRepo,
    listClientFollowupWorkflowsForOrganization: (input) => listClientFollowupWorkflowsForOrganization(input, pool),
  };

  async function hiddenContents() {
    const rows = await query(
      `SELECT c.claim_id::text AS claim_id, c.statement AS claim_statement, e.statement AS evidence_statement,
              e.internal_only, q.review_queue_item_id::text AS review_queue_item_id, q.queue_type
         FROM kai.claims c
         JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id
         LEFT JOIN kai.review_queue_items q ON q.organization_id = c.organization_id
        WHERE c.organization_id = $1::uuid`,
      [ORG],
    );
    return rows;
  }

  test("Impact Home summary: client_admin over a real unreviewed internal-only claim with GK review work -> count 0, first-time, nothing leaked, read-only", async () => {
    await prepareClaim();
    const hidden = await hiddenContents();
    assert.ok(hidden.length > 0 && hidden.some((row) => row.internal_only === true), "fixture has internal-only evidence");
    assert.ok(hidden.some((row) => row.queue_type === "claim_review" || row.queue_type === "evidence_review"), "fixture has GK review work");
    transactionLog.length = 0;

    const result = await getImpactHomeSummary({ organizationId: ORG, actorContext: clientActor("client_admin") }, summaryDependencies);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.data, {
      reviewedImpactFactCount: 0,
      reviewedImpactFactCountIsLowerBound: false,
      clientActionCount: 0,
      clientActions: [],
      internalReviewAvailable: false,
      isFirstTime: true,
    });
    const serialized = JSON.stringify(result.data);
    for (const row of hidden) {
      for (const value of [row.claim_id, row.claim_statement, row.evidence_statement, row.review_queue_item_id]) {
        if (typeof value === "string" && value.length > 0) assert.ok(!serialized.includes(value), `summary leaked ${value}`);
      }
    }
    assert.equal(transactionLog.some((sql) => /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(sql)), false);
  });

  test("Impact Home summary: client_reviewer gets exactly the real completable client follow-ups, as id + question only", async () => {
    await prepareClaim();
    const completable = await query(
      `SELECT cf.client_followup_item_id::text AS id, cf.question_text
         FROM kai.client_followup_items cf
         JOIN kai.review_queue_items rq
           ON rq.organization_id = cf.organization_id AND rq.queue_type = 'client_followup'
          AND rq.target_object_type = 'client_followup_item' AND rq.target_object_id = cf.client_followup_item_id
        WHERE cf.organization_id = $1::uuid AND rq.queue_status = 'waiting_on_client' AND rq.review_status = 'proposed'`,
      [ORG],
    );
    assert.ok(completable.length > 0, "fixture has completable client follow-ups");
    const result = await getImpactHomeSummary({ organizationId: ORG, actorContext: clientActor("client_reviewer") }, summaryDependencies);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.internalReviewAvailable, false);
    assert.deepEqual(
      result.data.clientActions.map((action) => action.clientFollowupItemId).sort(),
      completable.map((row) => row.id).sort(),
    );
    for (const action of result.data.clientActions) assert.deepEqual(Object.keys(action).sort(), ["clientFollowupItemId", "questionText"]);
    const serialized = JSON.stringify(result.data);
    for (const row of await hiddenContents()) assert.ok(!serialized.includes(row.claim_id));
  });

  test("Impact Home summary: gk_reviewer count equals the governed P2-08 internal eligible set on the same real state", async () => {
    await prepareClaim();
    const eligible = await eligibleRepo.listEligibleClaimsForAudience({ organizationId: ORG, requestedAudience: "internal", limit: 100, afterClaimId: null });
    const result = await getImpactHomeSummary({ organizationId: ORG, actorContext }, summaryDependencies);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.reviewedImpactFactCount, eligible.data.eligibleClaims.length);
    assert.equal(result.data.internalReviewAvailable, true);
  });
}
