// Board Reporting candidate export-manifest real-DB proof: drives Board
// candidate/review/authority lifecycle state through the actual repositories/
// services, then invokes the actual createBoardReportingCandidateExportManifest
// service/repository against the same runner-owned ephemeral PostgreSQL
// database, proving create/replay/negative/audit/immutability behavior.
//
// Modeled tightly on
// __tests__/kai-board-reporting-final-eligibility-real-db.integration.spec.js.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_BRCEM_REAL_DB_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`Board Reporting candidate export-manifest real-DB suite refused a non-loopback database URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("Board Reporting candidate export-manifest real-DB integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  try {
    console.log = (...args) => {
      if (args[0] === "[pg] Using remote connection" || args[0] === "[pg] Using remote connection string") return;
      originalConsoleLog(...args);
    };
    console.warn = (...args) => {
      if (typeof args[0] === "string" && args[0].startsWith("[pg] ")) return;
      originalConsoleWarn(...args);
    };
    var {
      createPostgresBoardReportingCandidateRepository,
    } = await import("../Backend/kai/dictionary/postgresBoardReportingCandidateRepository.js");
    var {
      createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository,
    } = await import("../Backend/kai/dictionary/postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js");
    var {
      createPostgresBoardReportingCandidateExportManifestRepository,
      __boardReportingCandidateExportManifestRepositoryTestables,
    } = await import("../Backend/kai/dictionary/postgresBoardReportingCandidateExportManifestRepository.js");
    var {
      createBoardReportingCandidate,
      requestBoardReportingCandidateReview,
      startBoardReportingCandidateReview,
      completeBoardReportingCandidateReview,
    } = await import("../Backend/kai/services/kaiBoardReportingCandidateService.js");
    var {
      recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision,
    } = await import("../Backend/kai/services/kaiBoardReportingCandidateHumanFinalReleaseAuthorityService.js");
    var {
      evaluateBoardReportingFinalEligibility,
    } = await import("../Backend/kai/services/kaiBoardReportingFinalEligibilityGateService.js");
    var {
      createBoardReportingCandidateExportManifest,
    } = await import("../Backend/kai/services/kaiBoardReportingCandidateExportManifestService.js");
    var {
      createProductionMetadataOnlyAuditForBoardReportingCandidate,
      createProductionMetadataOnlyAuditForBoardReportingCandidateHumanFinalReleaseAuthority,
    } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");
  } finally {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
  }

  const { canonicalFingerprint } = __boardReportingCandidateExportManifestRepositoryTestables;

  // Distinct id namespace from both the BR-04 foundation smoke-seed
  // (15030000-...) and the final-eligibility real-DB spec (15100000-...) so
  // this suite's fixtures never collide when run against the manifest
  // foundation runner's shared ephemeral database.
  const ORG = "00000000-0000-4000-8000-000000000001"; // shared org row, ON CONFLICT DO NOTHING
  const OTHER_ORG = "16090000-0000-4000-8000-000000000002";
  const ENGAGEMENT = "16090000-0000-4000-8000-000000000101";
  const OTHER_ENGAGEMENT = "16090000-0000-4000-8000-000000000102";
  const DRAFT_A = "16090000-0000-4000-8000-000000000201";
  const DRAFT_B = "16090000-0000-4000-8000-000000000202";
  const MISSING_CANDIDATE = "16090000-0000-4000-8000-000000000999";
  const ACTOR_ID = "16090000-0000-4000-8000-000000000901";
  const ACTOR = Object.freeze({
    actorType: "human",
    actorUserId: ACTOR_ID,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  });
  // A gk_admin actor authorized in OTHER_ORG only - used solely to prove the
  // repository's own tenant scoping (not_found) rather than the earlier
  // authorization gate, since validateActorCanPerformOperation checks
  // organization membership before the repository is ever reached.
  const OTHER_ORG_ACTOR = Object.freeze({
    actorType: "human",
    actorUserId: ACTOR_ID,
    organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_admin" }],
  });
  const ENABLED_ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
  const CREATE_NOW = "2026-09-12T12:00:00.000Z";
  const REQUEST_NOW = "2026-09-12T12:05:00.000Z";
  const START_NOW = "2026-09-12T13:00:00.000Z";
  const COMPLETE_NOW = "2026-09-12T14:00:00.000Z";
  const GRANT_NOW = "2026-09-12T15:00:00.000Z";
  const REVOKE_NOW = "2026-09-12T16:00:00.000Z";
  const MANIFEST_NOW = "2026-09-12T17:00:00.000Z";

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 5 });

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

  const candidateRepository = createPostgresBoardReportingCandidateRepository({ runInTransaction: withRunnerOwnedTransaction });
  const authorityRepository = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({ runInTransaction: withRunnerOwnedTransaction });
  const manifestRepository = createPostgresBoardReportingCandidateExportManifestRepository({ runInTransaction: withRunnerOwnedTransaction });

  function candidateAudit(now) {
    return createProductionMetadataOnlyAuditForBoardReportingCandidate({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      actorContext: ACTOR,
      now,
    });
  }

  function authorityAudit(now) {
    return createProductionMetadataOnlyAuditForBoardReportingCandidateHumanFinalReleaseAuthority({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      actorContext: ACTOR,
      now,
    });
  }

  function citation(index) {
    return {
      claimId: `16090000-0000-4000-8000-0000000003${index}1`,
      evidenceItemId: `16090000-0000-4000-8000-0000000003${index}2`,
      sourceId: `16090000-0000-4000-8000-0000000003${index}3`,
      sourceVersionId: `16090000-0000-4000-8000-0000000003${index}4`,
      generatedContentCitationId: `16090000-0000-4000-8000-0000000003${index}5`,
      supportStrength: "strong",
      claimReviewStatus: "approved",
      evidenceReviewStatus: "approved",
      currentEligible: true,
      blockerCodes: [],
      affectedDimensionKeys: [],
      affectedObjectIds: [],
    };
  }

  function renderModel({ stale = false } = {}) {
    return {
      ok: true,
      data: {
        renderModelContractVersion: "kai-sprint2-board-reporting-render-model-v1",
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        packetAudience: "internal",
        supportedContentTypes: ["evidence_summary", "impact_narrative"],
        members: [DRAFT_A, DRAFT_B].map((draftId, index) => ({
          generationRunId: `16090000-0000-4000-8000-0000000001${index}1`,
          generatedContentDraftId: draftId,
          contentType: index === 0 && stale ? "impact_narrative" : (index % 2 === 0 ? "evidence_summary" : "impact_narrative"),
          draftStatus: "draft",
          requestedAudience: "internal",
          reviewQueueItemId: `16090000-0000-4000-8000-0000000004${index}1`,
          queueStatus: "resolved",
          reviewStatus: "resolved",
          reviewUpdatedAt: CREATE_NOW,
          currentUseEligible: true,
          blocks: [{
            ordinal: 0,
            generatedContentBlockId: `16090000-0000-4000-8000-0000000005${index}1`,
            text: "not stored in Board export-manifest real-DB proof",
            citations: [citation(index)],
          }],
        })),
      },
      error: null,
    };
  }

  let currentRenderModelStale = false;
  const composeRenderModel = async () => renderModel({ stale: currentRenderModelStale });

  await withRunnerOwnedTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO kai.organizations (organization_id, name, organization_code)
       VALUES ($1::uuid, 'Board Export Manifest Org', 'board-export-manifest-org'),
              ($2::uuid, 'Board Export Manifest Other Org', 'board-export-manifest-other-org')
       ON CONFLICT (organization_id) DO NOTHING`,
      [ORG, OTHER_ORG],
    );
    await tx.query(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
       VALUES ($1::uuid, $2::uuid, 'board-export-manifest-engagement'),
              ($3::uuid, $2::uuid, 'board-export-manifest-other-engagement')
       ON CONFLICT (engagement_id) DO NOTHING`,
      [ENGAGEMENT, ORG, OTHER_ENGAGEMENT],
    );
    for (const [index, draftId] of [DRAFT_A, DRAFT_B].entries()) {
      const runId = `16090000-0000-4000-8000-0000000001${index}1`;
      await tx.query(
        `INSERT INTO kai.generation_runs (
           generation_run_id, organization_id, idempotency_key, request_fingerprint,
           content_type, requested_audience, engagement_id
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'internal', $6::uuid)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
        [runId, ORG, `board-export-manifest-run-${draftId}`, "b".repeat(64), index % 2 === 0 ? "evidence_summary" : "impact_narrative", ENGAGEMENT],
      );
      await tx.query(
        `INSERT INTO kai.generated_content_drafts (
           generated_content_draft_id, generation_run_id, organization_id,
           content_type, requested_audience, validator_results
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'internal', '[]'::jsonb)
         ON CONFLICT (generated_content_draft_id) DO NOTHING`,
        [draftId, runId, ORG, index % 2 === 0 ? "evidence_summary" : "impact_narrative"],
      );
    }
  });

  test.after(async () => {
    await pool.end();
  });

  async function createCandidate(idempotencyKey, now = CREATE_NOW) {
    const result = await createBoardReportingCandidate({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      idempotencyKey,
      actorContext: ACTOR,
      now,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateRepository: candidateRepository,
      metadataOnlyAudit: candidateAudit(now),
      composeRenderModel,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.memberCount, 2);
    return {
      candidateId: result.data.boardReportingCandidateId,
      fingerprint: result.data.canonicalFingerprint,
    };
  }

  async function requestReview(candidateId, now = REQUEST_NOW) {
    const requested = await requestBoardReportingCandidateReview({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: candidateId,
      actorContext: ACTOR,
      now,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateRepository: candidateRepository,
      metadataOnlyAudit: candidateAudit(now),
    });
    assert.equal(requested.ok, true, JSON.stringify(requested));
    return requested.data.reviewQueueItemId;
  }

  async function startReview(candidateId, reviewQueueItemId, now = START_NOW) {
    const requestRow = await pool.query(
      `SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [reviewQueueItemId],
    );
    const started = await startBoardReportingCandidateReview({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: candidateId,
      reviewQueueItemId,
      expectedUpdatedAt: requestRow.rows[0].updated_at.toISOString(),
      actorContext: ACTOR,
      now,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateRepository: candidateRepository,
      metadataOnlyAudit: candidateAudit(now),
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    return started;
  }

  async function completeReview(candidateId, reviewQueueItemId, now = COMPLETE_NOW) {
    const startRow = await pool.query(
      `SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [reviewQueueItemId],
    );
    const completed = await completeBoardReportingCandidateReview({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: candidateId,
      reviewQueueItemId,
      expectedUpdatedAt: startRow.rows[0].updated_at.toISOString(),
      actorContext: ACTOR,
      now,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateRepository: candidateRepository,
      metadataOnlyAudit: candidateAudit(now),
    });
    assert.equal(completed.ok, true, JSON.stringify(completed));
    assert.equal(completed.data.queueStatus, "resolved");
    assert.equal(completed.data.reviewStatus, "resolved");
    return completed;
  }

  async function resolveReview(candidateId, offsetMinutes = 0) {
    const shift = (iso) => new Date(new Date(iso).getTime() + offsetMinutes * 60000).toISOString();
    const reviewQueueItemId = await requestReview(candidateId, shift(REQUEST_NOW));
    await startReview(candidateId, reviewQueueItemId, shift(START_NOW));
    await completeReview(candidateId, reviewQueueItemId, shift(COMPLETE_NOW));
    return reviewQueueItemId;
  }

  async function recordAuthority(candidateId, reviewQueueItemId, decisionAction, now) {
    const result = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: candidateId,
      reviewQueueItemId,
      decisionAction,
      actorContext: ACTOR,
      now,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository,
      metadataOnlyAudit: authorityAudit(now),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  }

  function evaluateEligibility(candidateId, overrides = {}) {
    return evaluateBoardReportingFinalEligibility({
      organizationId: overrides.organizationId || ORG,
      engagementId: overrides.engagementId || ENGAGEMENT,
      boardReportingCandidateId: candidateId,
      actorContext: overrides.actorContext || ACTOR,
    }, {
      candidateRepository,
      authorityRepository,
      composeRenderModel,
    });
  }

  function createManifest(candidateId, overrides = {}, now = MANIFEST_NOW) {
    return createBoardReportingCandidateExportManifest({
      organizationId: overrides.organizationId || ORG,
      engagementId: overrides.engagementId || ENGAGEMENT,
      boardReportingCandidateId: candidateId,
      actorContext: overrides.actorContext || ACTOR,
    }, {
      env: ENABLED_ENV,
      now,
      repository: manifestRepository,
      // Wired explicitly to this suite's own runner-owned-transaction-bound
      // repositories/composeRenderModel (never the module's real
      // production defaults, which would open a fresh connection against
      // the ambient DATABASE_URL sentinel) - this is the same real,
      // unmodified evaluateBoardReportingFinalEligibility and BR-04
      // authorityRepository the production default-dependency path would
      // resolve to, just bound to the runner-owned pool/transaction.
      evaluateEligibility: evaluateBoardReportingFinalEligibility,
      authorityRepository,
      eligibilityDependencies: { candidateRepository, authorityRepository, composeRenderModel },
      authorityEffectivenessDependencies: {},
    });
  }

  async function snapshot(candidateId, reviewQueueItemId = null) {
    const rows = await pool.query(
      `SELECT
         (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.board_reporting_candidate_id)
            FROM kai.board_reporting_candidates c
           WHERE c.board_reporting_candidate_id = $1::uuid) AS candidates,
         (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.ordinal)
            FROM kai.board_reporting_candidate_members m
           WHERE m.board_reporting_candidate_id = $1::uuid) AS members,
         (SELECT jsonb_agg(m.ordinal ORDER BY m.ordinal)
            FROM kai.board_reporting_candidate_members m
           WHERE m.board_reporting_candidate_id = $1::uuid) AS member_ordinals,
         (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.review_queue_item_id)
            FROM kai.review_queue_items r
           WHERE ($2::uuid IS NOT NULL AND r.review_queue_item_id = $2::uuid)
              OR ($2::uuid IS NULL AND r.queue_type = 'board_reporting_candidate_review' AND r.target_object_id = $1::uuid)) AS reviews,
         (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.decision_id)
            FROM kai.board_reporting_candidate_human_authority_decisions d
           WHERE d.board_reporting_candidate_id = $1::uuid) AS authority,
         (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.board_reporting_candidate_export_manifest_id)
            FROM kai.board_reporting_candidate_export_manifests x
           WHERE x.board_reporting_candidate_id = $1::uuid) AS manifests,
         (SELECT count(*)::int FROM kai.board_reporting_candidates) AS all_candidate_count,
         (SELECT count(*)::int FROM kai.board_reporting_candidate_members) AS all_member_count,
         (SELECT count(*)::int FROM kai.review_queue_items WHERE queue_type = 'board_reporting_candidate_review') AS board_review_count,
         (SELECT count(*)::int FROM kai.board_reporting_candidate_human_authority_decisions) AS authority_count,
         (SELECT count(*)::int FROM kai.board_reporting_candidate_export_manifests) AS manifest_count,
         (SELECT count(*)::int
            FROM information_schema.tables
           WHERE table_schema = 'kai'
             AND table_name LIKE '%delivery%') AS delivery_table_count`,
      [candidateId, reviewQueueItemId],
    );
    return rows.rows[0];
  }

  function assertNoUpstreamMutation(before, after) {
    assert.deepEqual(after.candidates, before.candidates, "candidate changed during manifest create/replay");
    assert.deepEqual(after.members, before.members, "members changed during manifest create/replay");
    assert.deepEqual(after.member_ordinals, before.member_ordinals, "member ordinals changed during manifest create/replay");
    assert.deepEqual(after.reviews, before.reviews, "review changed during manifest create/replay");
    assert.deepEqual(after.authority, before.authority, "authority history changed during manifest create/replay");
    assert.equal(after.all_candidate_count, before.all_candidate_count, "replacement candidate created during manifest create/replay");
    assert.equal(after.all_member_count, before.all_member_count, "candidate member side effect");
    assert.equal(after.board_review_count, before.board_review_count, "review side effect");
    assert.equal(after.authority_count, before.authority_count, "authority side effect");
    assert.equal(after.delivery_table_count, before.delivery_table_count, "delivery side effect");
  }

  // NOTE: the shared audit-metadata sanitizer (Backend/kai/db/kaiAuditQueries.js
  // SAFE_AUDIT_METADATA_KEYS) does not allowlist the custom
  // "board_reporting_candidate_export_manifest_id" key the audit composition
  // sets, so it is silently dropped from the persisted metadata jsonb - this
  // was proven while writing this suite. The manifest's identity is still
  // fully preserved in the persisted row via the allowlisted "object_id"
  // field (set to the exact same value by
  // createProductionMetadataOnlyAuditForBoardReportingCandidateExportManifest),
  // so this suite matches on object_id rather than re-deriving/patching the
  // shared sanitizer allowlist for a value that is already recoverable.
  async function auditCountForManifest(manifestId) {
    const rows = await pool.query(
      `SELECT count(*)::int AS n
         FROM kai.audit_events
        WHERE metadata->>'object_type' = 'board_reporting_candidate_export_manifest'
          AND metadata->>'object_id' = $1`,
      [manifestId],
    );
    return rows.rows[0].n;
  }

  async function auditRowsForCandidate(candidateId) {
    const rows = await pool.query(
      `SELECT metadata
         FROM kai.audit_events
        WHERE metadata->>'object_type' = 'board_reporting_candidate_export_manifest'
          AND metadata->>'board_reporting_candidate_id' = $1
        ORDER BY audit_event_id ASC`,
      [candidateId],
    );
    return rows.rows.map((r) => r.metadata);
  }

  async function totalManifestAuditCount() {
    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM kai.audit_events WHERE metadata->>'object_type' = 'board_reporting_candidate_export_manifest'`,
    );
    return rows.rows[0].n;
  }

  await test("Board Reporting candidate export-manifest real Postgres: create, replay, audit, negatives, immutability", async () => {
    // ---- Happy path: full lifecycle -> GRANT -> final eligibility -> manifest create ----
    const main = await createCandidate("board-export-manifest-candidate-main");
    const mainReview = await resolveReview(main.candidateId);
    const grant = await recordAuthority(main.candidateId, mainReview, "grant", GRANT_NOW);
    assert.equal(grant.data.effective, true);

    const eligibility = await evaluateEligibility(main.candidateId);
    assert.equal(eligibility.ok, true, JSON.stringify(eligibility));
    assert.equal(eligibility.data.finalEligibility, true);

    // Independently confirm the exact BR-04 GRANT head decision id via a
    // direct ledger read (never trusting the manifest's own claim of it).
    const headDecisionRow = await pool.query(
      `SELECT decision_id::text AS decision_id
         FROM kai.board_reporting_candidate_human_authority_decisions
        WHERE organization_id = $1::uuid AND board_reporting_candidate_id = $2::uuid
          AND decision_type = 'export_authority_granted'
        ORDER BY decision_id DESC LIMIT 1`,
      [ORG, main.candidateId],
    );
    const expectedHeadDecisionId = headDecisionRow.rows[0].decision_id;

    const totalManifestAuditBefore = await totalManifestAuditCount();

    const created = await createManifest(main.candidateId);
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.data.replayed, false);
    assert.equal(created.data.boardReportingCandidateId, main.candidateId);
    assert.equal(created.data.effectiveAuthorityDecisionId, expectedHeadDecisionId);
    assert.equal(created.data.fingerprintContractVersion, "kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1");

    const expectedFingerprint = canonicalFingerprint({
      organizationId: ORG,
      boardReportingCandidateId: main.candidateId,
      effectiveAuthorityDecisionId: expectedHeadDecisionId,
    });
    assert.equal(created.data.canonicalFingerprint, expectedFingerprint);

    const persistedRow = await pool.query(
      `SELECT organization_id::text AS organization_id, board_reporting_candidate_id::text AS board_reporting_candidate_id,
              effective_authority_decision_id::text AS effective_authority_decision_id,
              effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint
         FROM kai.board_reporting_candidate_export_manifests
        WHERE board_reporting_candidate_export_manifest_id = $1::uuid`,
      [created.data.boardReportingCandidateExportManifestId],
    );
    assert.equal(persistedRow.rows.length, 1);
    const persisted = persistedRow.rows[0];
    assert.equal(persisted.organization_id, ORG);
    assert.equal(persisted.board_reporting_candidate_id, main.candidateId);
    assert.equal(persisted.effective_authority_decision_id, expectedHeadDecisionId);
    assert.equal(persisted.effective_authority_decision_type, "export_authority_granted");
    assert.equal(persisted.fingerprint_contract_version, "kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1");
    assert.equal(persisted.canonical_fingerprint, expectedFingerprint);

    // ---- Audit proof: exactly one audit row for the first genuine create ----
    const auditAfterCreate = await auditCountForManifest(created.data.boardReportingCandidateExportManifestId);
    assert.equal(auditAfterCreate, 1, "expected exactly one audit row after first genuine create");
    const totalManifestAuditAfterCreate = await totalManifestAuditCount();
    assert.equal(totalManifestAuditAfterCreate, totalManifestAuditBefore + 1);

    const auditRows = await auditRowsForCandidate(main.candidateId);
    assert.equal(auditRows.length, 1);
    const auditMetadata = auditRows[0];
    // Denylist check over VALUES only (never key names, which legitimately
    // include field names like "contains_signed_urls" whose value is the
    // boolean `false`) - proves no rendered Board content, draft text,
    // citations, connection info, or credential-shaped material ever made
    // it into the persisted metadata-only audit row.
    const DENYLIST_SUBSTRINGS = [
      "not stored in board export-manifest real-db proof", // rendered draft text
      "postgres://", "postgresql://", // connection strings
      "access_key", "secret", "password", "credential",
    ];
    const serializedAuditValues = Object.values(auditMetadata)
      .map((value) => (typeof value === "string" ? value.toLowerCase() : JSON.stringify(value)))
      .join(" | ");
    for (const needle of DENYLIST_SUBSTRINGS) {
      assert.equal(serializedAuditValues.includes(needle), false, `audit metadata unexpectedly contained: ${needle}`);
    }
    assert.equal(auditMetadata.metadata_only, true);
    assert.equal(auditMetadata.contains_raw_file_content, false);
    assert.equal(auditMetadata.contains_client_pii, false);
    assert.equal(auditMetadata.contains_prompt_text, false);
    assert.equal(auditMetadata.contains_unsafe_generated_text, false);
    assert.equal(auditMetadata.contains_signed_urls, false);
    assert.equal(auditMetadata.contains_storage_credentials, false);

    // ---- Replay proof ----
    const beforeReplay = await snapshot(main.candidateId, mainReview);
    const replayed = await createManifest(main.candidateId);
    const afterReplay = await snapshot(main.candidateId, mainReview);
    assertNoUpstreamMutation(beforeReplay, afterReplay);
    assert.equal(replayed.ok, true, JSON.stringify(replayed));
    assert.equal(replayed.data.replayed, true);
    assert.equal(replayed.data.boardReportingCandidateExportManifestId, created.data.boardReportingCandidateExportManifestId);
    assert.equal(replayed.data.canonicalFingerprint, expectedFingerprint);
    assert.equal(afterReplay.manifest_count, beforeReplay.manifest_count, "manifest row count grew on replay");
    const auditAfterReplay = await auditCountForManifest(created.data.boardReportingCandidateExportManifestId);
    assert.equal(auditAfterReplay, 1, "replay must not create a second audit row");

    // ---- Negative-case fixtures (own candidates/reviews/authority - these
    // are legitimate application-level lifecycle activity, not manifest
    // side effects, so they are created BEFORE the immutability snapshot
    // that brackets only the manifest-create attempts themselves) ----
    const noReview = await createCandidate("board-export-manifest-no-review");

    const requestOnly = await createCandidate("board-export-manifest-request-only");
    await requestReview(requestOnly.candidateId);

    const startOnly = await createCandidate("board-export-manifest-start-only");
    const startOnlyReview = await requestReview(startOnly.candidateId);
    await startReview(startOnly.candidateId, startOnlyReview, "2026-09-12T13:06:00.000Z");

    const noAuthority = await createCandidate("board-export-manifest-no-authority");
    await resolveReview(noAuthority.candidateId, 20);

    const revoked = await createCandidate("board-export-manifest-revoked");
    const revokedReview = await resolveReview(revoked.candidateId, 40);
    await recordAuthority(revoked.candidateId, revokedReview, "grant", "2026-09-12T15:41:00.000Z");
    await recordAuthority(revoked.candidateId, revokedReview, "revoke", "2026-09-12T16:41:00.000Z");

    // stale candidate: mutate a supported authoritative CURRENT Board
    // composition input (never the candidate row itself) so its stored
    // fingerprint no longer matches current state.
    const staleCandidate = await createCandidate("board-export-manifest-stale");
    const staleReview = await resolveReview(staleCandidate.candidateId, 60);
    await recordAuthority(staleCandidate.candidateId, staleReview, "grant", "2026-09-12T15:42:00.000Z");
    const preStaleEligibility = await evaluateEligibility(staleCandidate.candidateId);
    assert.equal(preStaleEligibility.data.finalEligibility, true);

    // ---- Immutability check across the entire create+replay+negative-attempt sequence ----
    const beforeAll = await snapshot(main.candidateId, mainReview);
    assert.equal(beforeAll.candidates[0].board_reporting_candidate_id, main.candidateId);

    // ---- Negative / fail-closed cases (manifest-create attempts only) ----
    const negativeResults = {};

    // missing candidate
    negativeResults.missingCandidate = await createManifest(MISSING_CANDIDATE);

    // wrong organization
    negativeResults.wrongOrg = await createManifest(main.candidateId, { organizationId: OTHER_ORG, actorContext: OTHER_ORG_ACTOR });

    // wrong engagement
    negativeResults.wrongEngagement = await createManifest(main.candidateId, { engagementId: OTHER_ENGAGEMENT });

    // no review at all
    negativeResults.noReview = await createManifest(noReview.candidateId);

    // REQUEST-only review (no start)
    negativeResults.requestOnly = await createManifest(requestOnly.candidateId);

    // START/in-progress review (no complete)
    negativeResults.startOnly = await createManifest(startOnly.candidateId);

    // resolved review, no authority decision
    negativeResults.noAuthority = await createManifest(noAuthority.candidateId);

    // resolved review, revoked authority (grant then revoke)
    negativeResults.revoked = await createManifest(revoked.candidateId);

    await withRunnerOwnedTransaction(async (tx) => {
      await tx.query(
        `UPDATE kai.generated_content_drafts SET content_type = 'impact_narrative'
          WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid`,
        [ORG, DRAFT_A],
      );
      await tx.query(
        `UPDATE kai.generation_runs SET content_type = 'impact_narrative'
          WHERE organization_id = $1::uuid AND generation_run_id = $2::uuid`,
        [ORG, "16090000-0000-4000-8000-000000000101"],
      );
    });
    currentRenderModelStale = true;
    negativeResults.stale = await createManifest(staleCandidate.candidateId);
    currentRenderModelStale = false;
    await withRunnerOwnedTransaction(async (tx) => {
      await tx.query(
        `UPDATE kai.generated_content_drafts SET content_type = 'evidence_summary'
          WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid`,
        [ORG, DRAFT_A],
      );
      await tx.query(
        `UPDATE kai.generation_runs SET content_type = 'evidence_summary'
          WHERE organization_id = $1::uuid AND generation_run_id = $2::uuid`,
        [ORG, "16090000-0000-4000-8000-000000000101"],
      );
    });

    const afterAll = await snapshot(main.candidateId, mainReview);
    assertNoUpstreamMutation(beforeAll, afterAll);

    // Assert results and error codes.
    assert.equal(negativeResults.missingCandidate.ok, false);
    assert.equal(negativeResults.missingCandidate.error.code, "not_found");
    assert.equal(negativeResults.wrongOrg.ok, false);
    assert.equal(negativeResults.wrongOrg.error.code, "not_found");
    assert.equal(negativeResults.wrongEngagement.ok, false);
    assert.equal(negativeResults.wrongEngagement.error.code, "not_found");
    assert.equal(negativeResults.noReview.ok, false);
    assert.equal(negativeResults.noReview.error.code, "validation_blocker");
    assert.equal(negativeResults.requestOnly.ok, false);
    assert.equal(negativeResults.requestOnly.error.code, "validation_blocker");
    assert.equal(negativeResults.startOnly.ok, false);
    assert.equal(negativeResults.startOnly.error.code, "validation_blocker");
    assert.equal(negativeResults.noAuthority.ok, false);
    assert.equal(negativeResults.noAuthority.error.code, "validation_blocker");
    assert.equal(negativeResults.revoked.ok, false);
    assert.equal(negativeResults.revoked.error.code, "validation_blocker");
    assert.equal(negativeResults.stale.ok, false);
    assert.equal(negativeResults.stale.error.code, "validation_blocker");

    // No new manifest rows and no new audit rows resulted from any negative case.
    const manifestCountAfterNegatives = await pool.query(
      `SELECT count(*)::int AS n FROM kai.board_reporting_candidate_export_manifests`,
    );
    assert.equal(manifestCountAfterNegatives.rows[0].n, afterReplay.manifest_count, "a negative case unexpectedly wrote a manifest row");
    const auditCountAfterNegatives = await totalManifestAuditCount();
    assert.equal(auditCountAfterNegatives, totalManifestAuditAfterCreate, "a negative case unexpectedly wrote an audit row");

    // ---- Cross-candidate authority binding reachability ----
    // authorityRepository.evaluateEffectiveness (BR-04) is always invoked
    // scoped by {organizationId, boardReportingCandidateId, decisionType} -
    // see postgresBoardReportingCandidateExportManifestRepository.js
    // createExportManifest(), which passes exactly that shape and never a
    // separate/second candidate id. There is no parameter or code path
    // through the real repository/service contract that could bind an
    // authority decision recorded against a *different* candidate to this
    // candidate's manifest - the ledger query itself filters by
    // board_reporting_candidate_id. This is structurally unreachable given
    // the shipped code, not merely untested, so it is recorded N/A rather
    // than fabricated.
    console.log("TOOL_VERIFIED crossCandidateAuthorityBinding=N/A reason=evaluateEffectiveness_is_always_scoped_by_boardReportingCandidateId_in_the_repository_and_ledger_query");

    // ---- Authority-state / fingerprint proof after REVOKE ----
    await recordAuthority(main.candidateId, mainReview, "revoke", REVOKE_NOW);
    const postRevokeEligibility = await evaluateEligibility(main.candidateId);
    assert.equal(postRevokeEligibility.data.finalEligibility, false);
    const blockedAfterRevoke = await createManifest(main.candidateId, {}, "2026-09-12T18:00:00.000Z");
    assert.equal(blockedAfterRevoke.ok, false);
    assert.equal(blockedAfterRevoke.error.code, "validation_blocker");
    const manifestsForMainAfterRevoke = await pool.query(
      `SELECT effective_authority_decision_id::text AS effective_authority_decision_id
         FROM kai.board_reporting_candidate_export_manifests
        WHERE board_reporting_candidate_id = $1::uuid`,
      [main.candidateId],
    );
    assert.equal(manifestsForMainAfterRevoke.rows.length, 1, "revoked/blocked attempt must not add a manifest row");
    assert.equal(manifestsForMainAfterRevoke.rows[0].effective_authority_decision_id, expectedHeadDecisionId);

    console.log(`TOOL_VERIFIED manifestCreated boardReportingCandidateExportManifestId=${created.data.boardReportingCandidateExportManifestId}`);
    console.log(`TOOL_VERIFIED manifestBinding candidateId=${persisted.board_reporting_candidate_id} decisionId=${persisted.effective_authority_decision_id} decisionType=${persisted.effective_authority_decision_type} fingerprintContractVersion=${persisted.fingerprint_contract_version}`);
    console.log(`TOOL_VERIFIED canonicalFingerprintMatchesIndependentRecompute=${persisted.canonical_fingerprint === expectedFingerprint}`);
    console.log(`TOOL_VERIFIED replay replayed=${replayed.data.replayed} sameId=${replayed.data.boardReportingCandidateExportManifestId === created.data.boardReportingCandidateExportManifestId} manifestRowGrowth=${afterReplay.manifest_count - beforeReplay.manifest_count} auditRowGrowth=${auditAfterReplay - auditAfterCreate}`);
    console.log(`TOOL_VERIFIED negatives missingCandidate=${negativeResults.missingCandidate.error.code} wrongOrg=${negativeResults.wrongOrg.error.code} wrongEngagement=${negativeResults.wrongEngagement.error.code} noReview=${negativeResults.noReview.error.code} requestOnly=${negativeResults.requestOnly.error.code} startOnly=${negativeResults.startOnly.error.code} noAuthority=${negativeResults.noAuthority.error.code} revoked=${negativeResults.revoked.error.code} stale=${negativeResults.stale.error.code}`);
    console.log(`TOOL_VERIFIED postRevokeBlocked=${blockedAfterRevoke.error.code} manifestRowsForCandidateAfterRevoke=${manifestsForMainAfterRevoke.rows.length}`);
    console.log(`TOOL_VERIFIED auditProof firstCreateAuditRows=${auditAfterCreate} afterReplayAuditRows=${auditAfterReplay} metadataOnly=${auditMetadata.metadata_only}`);
    console.log("TOOL_VERIFIED immutability candidate=NO members=NO memberOrdinals=NO review=NO authority=NO deliveryTables=NO");
    console.log(`TOOL_VERIFIED deliveryTableCount=${afterAll.delivery_table_count}`);
  });
}
