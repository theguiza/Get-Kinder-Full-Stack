// Board Reporting production synthetic acceptance canary.
//
// Drives the full BR-02 -> BR-03A -> BR-03B -> BR-04 -> final-eligibility ->
// export-manifest -> FINAL markdown Board Reporting lifecycle end to end
// against a real, runner-owned, ephemeral local PostgreSQL database (never
// production data), through the EXISTING, unmodified, unmocked services this
// repository already ships:
//   Backend/kai/services/kaiBoardReportingCandidateService.js
//   Backend/kai/services/kaiBoardReportingCandidateHumanFinalReleaseAuthorityService.js
//   Backend/kai/services/kaiBoardReportingFinalEligibilityGateService.js
//   Backend/kai/services/kaiBoardReportingCandidateExportManifestService.js
//   Backend/kai/services/kaiBoardReportingCandidateExportManifestMarkdownSerializer.js
// These are exactly the services the mounted HTTP routes
// (Backend/kai/routes/sprint2IntakeApi.js) delegate to exactly once each -
// proven by __tests__/kai-sprint2-br-board-reporting-browser-api-composition.spec.js.
//
// This canary is modeled tightly on the repository's own already-verified
// real-DB proofs (in particular
// __tests__/kai-sprint2-board-reporting-candidate-export-manifest-real-db.integration.spec.js
// and the ephemeral-Postgres provisioning in
// scripts/kai-sprint2-board-reporting-candidate-export-manifest-foundation-local-postgres.js),
// reusing their exact migration chain, seed shape, and dependency-injection
// pattern rather than inventing a new one.
//
// Scope note (see also the final report this script's caller produces): the
// underlying eligible-Board-packet input (which claims/evidence/citations a
// generated-content draft carries) is computed by the separately-verified P1-P3
// intake/evidence/claim/review pipeline. No existing test in this repository
// re-derives that chain from raw SQL for a Board Reporting test - every one of
// them (BR-02, BR-04, the export-manifest real-DB proof) instead injects an
// already-eligible render model via the existing composeRenderModel
// dependency seam. This canary does the same, and is explicit about it below.
//
// Does not touch production data. Does not change migrations or schema. Does
// not add Board features. Provisions and tears down its own throwaway
// PostgreSQL cluster on loopback only.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { Pool } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_board_reporting_production_synthetic_canary";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-board-canary-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");

function reserveFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(String(address.port)));
    });
    server.on("error", reject);
  });
}

const port = await reserveFreeLoopbackPort();
const user = process.env.USER || "postgres";
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";
const runtimeDatabaseSelectors = Object.freeze([
  "DATABASE_URL",
  "RENDER_DATABASE_URL",
  "PROD_DATABASE_URL",
  "DATABASE_URL_LOCAL",
  "PGURL_LOCAL",
]);
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function isLoopbackDatabaseUrl(value) {
  try {
    const parsed = new URL(value);
    return loopbackHosts.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function assertLoopbackDatabaseUrl(value) {
  if (!isLoopbackDatabaseUrl(value)) {
    throw new Error("non_loopback_database_target_refused");
  }
}

function neutralizeRuntimeDatabaseSelectors(value) {
  assertLoopbackDatabaseUrl(value);
  for (const selector of runtimeDatabaseSelectors) {
    process.env[selector] = value;
  }
}

function sanitizeDiagnostic(value) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, "[redacted-db-url]")
    .replace(/\b(host|hostname|database|dbname|user|username|password|credential|secret|token)=\S+/gi, "$1=[redacted]")
    .replace(/\b(refusing non-loopback database URL host|host):\s*[^\s,}]+/gi, "$1: [redacted]");
}

neutralizeRuntimeDatabaseSelectors(sentinelUrl);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      DATABASE_URL: sentinelUrl,
      RENDER_DATABASE_URL: sentinelUrl,
      PROD_DATABASE_URL: sentinelUrl,
      DATABASE_URL_LOCAL: sentinelUrl,
      PGURL_LOCAL: sentinelUrl,
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGDATABASE: dbName,
      PGUSER: user,
    },
  });
  if (result.status !== 0) {
    const logDetail = command === pgCtl && existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
    const detail = sanitizeDiagnostic([result.stdout, result.stderr, logDetail].filter(Boolean).join("\n"));
    throw new Error(`${command} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(path) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], { capture: true }).stdout;
}

function installRuntimeMigrationChain() {
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-converge.sql");
  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
  psqlFile("migrations/kai_sprint2_p1_parser_run_and_file_profile.sql");
  psqlFile("migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql");
  psqlFile("migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql");
  psqlFile("migrations/kai_sprint2_p1_06_review_queue.sql");
  psqlFile("migrations/kai_sprint2_p1_07_intake_source_candidate.sql");
  psqlFile("migrations/kai_sprint2_p1_08_source_promotion.sql");
  psqlFile("migrations/kai_sprint2_p2_01_evidence_lineage.sql");
  psqlFile("migrations/kai_sprint2_p2_03_claim_proposal.sql");
  psqlFile("migrations/kai_sprint2_p2_04_claim_gap_followup.sql");
  psqlFile("migrations/kai_sprint2_p2_05_conflict_review_candidate.sql");
  psqlFile("migrations/kai_sprint2_p3_01_generated_content_drafts.sql");
  psqlFile("migrations/kai_sprint2_p13_01_impact_narrative_content_type.sql");
  psqlFile("migrations/kai_sprint2_p14_01_generation_run_engagement_binding.sql");
  psqlFile("migrations/kai_sprint2_p3_04_generated_content_review_completion.sql");
  psqlFile("migrations/kai_sprint2_p3_05_export_review_request.sql");
  psqlFile("migrations/kai_sprint2_p3_09_export_review_start.sql");
  psqlFile("migrations/kai_sprint2_p3_13_export_review_completion.sql");
  psqlFile("migrations/kai_sprint2_p14_10_review_queue_target_object_type_repair.sql");
  psqlFile("migrations/kai_sprint2_p3_16_export_candidate_foundation.sql");
  psqlFile("migrations/kai_sprint2_p3_17_human_authority_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_p3_19_export_manifest_foundation.sql");
  psqlFile("migrations/kai_sprint2_br_02_board_reporting_candidate_foundation.sql");
  psqlFile("migrations/kai_sprint2_br_03a_board_reporting_candidate_review_request.sql");
  psqlFile("migrations/kai_sprint2_br_03b_board_reporting_candidate_review_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_br_04_board_reporting_candidate_human_authority_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_board_reporting_candidate_export_manifest_foundation.sql");
}

// ---------------------------------------------------------------------------
// Checkpoint runner: prints CHECKPOINT/STATUS/RESULT for every step and halts
// immediately (BOARD_CANARY_FAIL) on the first failure.
// ---------------------------------------------------------------------------

const checkpointResults = [];

async function checkpoint(name, expectedDescription, fn) {
  let outcome;
  try {
    outcome = process.env.KAI_BOARD_CANARY_FAIL_AT === name
      ? { ok: false, error: { code: "injected_failure_for_fail_closed_proof" } }
      : await fn();
  } catch (error) {
    console.log("BOARD_CANARY_FAIL");
    console.log(`checkpoint: ${name}`);
    console.log(`expected: ${expectedDescription}`);
    console.log(`actual: threw ${sanitizeDiagnostic(error?.message || error)}`);
    console.log("next_inspection: re-run with PG_BIN_DIR set correctly and inspect the ephemeral postgres.log; if the service call itself failed, inspect the ok:false error.code returned by the Board Reporting service named in this checkpoint");
    await cleanupAndExit(1);
  }
  if (!outcome || outcome.ok !== true) {
    console.log("BOARD_CANARY_FAIL");
    console.log(`checkpoint: ${name}`);
    console.log(`expected: ${expectedDescription}`);
    console.log(`actual: ${sanitizeDiagnostic(JSON.stringify(outcome?.error || outcome))}`);
    console.log("next_inspection: inspect the ok:false error.code returned by the Board Reporting service named in this checkpoint");
    await cleanupAndExit(1);
  }
  console.log(`CHECKPOINT: ${name}`);
  console.log("STATUS: PASS");
  console.log(`RESULT: ${outcome.result}`);
  console.log("");
  checkpointResults.push({ name, result: outcome.result });
  return outcome.data;
}

let pgStarted = false;
let pool = null;

async function cleanupAndExit(code) {
  try {
    if (pool) await pool.end();
  } catch { /* best effort */ }
  if (pgStarted) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  process.exit(code);
}

try {
  try {
    assertLoopbackDatabaseUrl("postgresql://example.invalid:5432/kai_synthetic");
    throw new Error("non_loopback_rejection_missing");
  } catch (error) {
    if (error?.message !== "non_loopback_database_target_refused") {
      throw new Error("non_loopback_rejection_missing");
    }
  }
  console.log("NON_LOOPBACK_SYNTHETIC_TARGET_REJECTION: PASS");
  console.log("");

  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  pgStarted = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  installRuntimeMigrationChain();

  const runnerOwnedDatabaseUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
  assertLoopbackDatabaseUrl(runnerOwnedDatabaseUrl);

  pool = new Pool({ connectionString: runnerOwnedDatabaseUrl, ssl: false, max: 5 });

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

  // Several of these modules transitively import Backend/db/pg.js. Before
  // importing them, every pg.js database selector is structurally neutralized
  // to the loopback sentinel above; logging is also suppressed so even the
  // sentinel selector details are not printed.
  let createPostgresBoardReportingCandidateRepository;
  let createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository;
  let createPostgresBoardReportingCandidateExportManifestRepository;
  let createPostgresBoardReportingCandidateExportManifestRenderModelRepository;
  let createBoardReportingCandidate;
  let requestBoardReportingCandidateReview;
  let startBoardReportingCandidateReview;
  let completeBoardReportingCandidateReview;
  let recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision;
  let evaluateBoardReportingFinalEligibility;
  let createBoardReportingCandidateExportManifest;
  let serializeBoardReportingCandidateExportManifestToMarkdown;
  let createProductionMetadataOnlyAuditForBoardReportingCandidate;
  let createProductionMetadataOnlyAuditForBoardReportingCandidateHumanFinalReleaseAuthority;
  let createProductionMetadataOnlyAuditForBoardReportingCandidateExportManifest;
  let composeBoardReportingPacketFingerprint;
  let buildBoardReportingPacketRepresentation;
  {
    neutralizeRuntimeDatabaseSelectors(sentinelUrl);
    const originalConsoleLog = console.log;
    const originalConsoleWarn = console.warn;
    console.log = (...args) => {
      if (args[0] === "[pg] Using remote connection" || args[0] === "[pg] Using remote connection string") return;
      originalConsoleLog(...args);
    };
    console.warn = (...args) => {
      if (typeof args[0] === "string" && args[0].startsWith("[pg] ")) return;
      originalConsoleWarn(...args);
    };
    try {
      ({ createPostgresBoardReportingCandidateRepository } = await import(
        "../Backend/kai/dictionary/postgresBoardReportingCandidateRepository.js"
      ));
      ({ createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository } = await import(
        "../Backend/kai/dictionary/postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js"
      ));
      ({ createPostgresBoardReportingCandidateExportManifestRepository } = await import(
        "../Backend/kai/dictionary/postgresBoardReportingCandidateExportManifestRepository.js"
      ));
      ({ createPostgresBoardReportingCandidateExportManifestRenderModelRepository } = await import(
        "../Backend/kai/dictionary/postgresBoardReportingCandidateExportManifestRenderModelRepository.js"
      ));
      ({
        createBoardReportingCandidate,
        requestBoardReportingCandidateReview,
        startBoardReportingCandidateReview,
        completeBoardReportingCandidateReview,
      } = await import("../Backend/kai/services/kaiBoardReportingCandidateService.js"));
      ({ recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision } = await import(
        "../Backend/kai/services/kaiBoardReportingCandidateHumanFinalReleaseAuthorityService.js"
      ));
      ({ evaluateBoardReportingFinalEligibility } = await import(
        "../Backend/kai/services/kaiBoardReportingFinalEligibilityGateService.js"
      ));
      ({ createBoardReportingCandidateExportManifest } = await import(
        "../Backend/kai/services/kaiBoardReportingCandidateExportManifestService.js"
      ));
      ({ serializeBoardReportingCandidateExportManifestToMarkdown } = await import(
        "../Backend/kai/services/kaiBoardReportingCandidateExportManifestMarkdownSerializer.js"
      ));
      ({
        createProductionMetadataOnlyAuditForBoardReportingCandidate,
        createProductionMetadataOnlyAuditForBoardReportingCandidateHumanFinalReleaseAuthority,
        createProductionMetadataOnlyAuditForBoardReportingCandidateExportManifest,
      } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js"));
      ({
        composeBoardReportingPacketFingerprint,
        buildBoardReportingPacketRepresentation,
      } = await import("../Backend/kai/services/kaiBoardReportingPacketFingerprintService.js"));
    } finally {
      console.log = originalConsoleLog;
      console.warn = originalConsoleWarn;
    }
  }

  // ---- Minimum synthetic fixture: organization, engagement, actor/role,
  // eligible Board packet inputs (two generated-content drafts) ----
  const ORG = "1a0a0000-0000-4000-8000-000000000001";
  const ENGAGEMENT = "1a0a0000-0000-4000-8000-000000000101";
  const DRAFT_A = "1a0a0000-0000-4000-8000-000000000201";
  const DRAFT_B = "1a0a0000-0000-4000-8000-000000000202";
  const ACTOR_ID = "1a0a0000-0000-4000-8000-000000000901";
  const ACTOR = Object.freeze({
    actorType: "human",
    actorUserId: ACTOR_ID,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  });
  const ENABLED_ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });

  await withRunnerOwnedTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO kai.organizations (organization_id, name, organization_code)
       VALUES ($1::uuid, 'Board Reporting Canary Org', 'board-canary-org')
       ON CONFLICT (organization_id) DO NOTHING`,
      [ORG],
    );
    await tx.query(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
       VALUES ($1::uuid, $2::uuid, 'board-canary-engagement')
       ON CONFLICT (engagement_id) DO NOTHING`,
      [ENGAGEMENT, ORG],
    );
    for (const [index, draftId] of [DRAFT_A, DRAFT_B].entries()) {
      const runId = `1a0a0000-0000-4000-8000-0000000001${index}1`;
      await tx.query(
        `INSERT INTO kai.generation_runs (
           generation_run_id, organization_id, idempotency_key, request_fingerprint,
           content_type, requested_audience, engagement_id
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'internal', $6::uuid)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
        [runId, ORG, `board-canary-run-${draftId}`, "c".repeat(64), index % 2 === 0 ? "evidence_summary" : "impact_narrative", ENGAGEMENT],
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

  // The claim/evidence/citation eligibility chain behind each draft is owned
  // and separately verified by the P1-P3 intake/evidence/claim/review
  // pipeline, not by Board Reporting. Exactly like BR-02, BR-04, and the
  // export-manifest real-DB proof already shipped in this repo, this canary
  // supplies that already-resolved, eligible render model via the existing
  // composeRenderModel dependency seam rather than re-deriving it from raw
  // SQL across tables Board Reporting does not own.
  function citation(index) {
    return {
      claimId: `1a0a0000-0000-4000-8000-0000000003${index}1`,
      evidenceItemId: `1a0a0000-0000-4000-8000-0000000003${index}2`,
      sourceId: `1a0a0000-0000-4000-8000-0000000003${index}3`,
      sourceVersionId: `1a0a0000-0000-4000-8000-0000000003${index}4`,
      generatedContentCitationId: `1a0a0000-0000-4000-8000-0000000003${index}5`,
      supportStrength: "strong",
      claimReviewStatus: "approved",
      evidenceReviewStatus: "approved",
      currentEligible: true,
      blockerCodes: [],
      affectedDimensionKeys: [],
      affectedObjectIds: [],
    };
  }

  function renderModel() {
    return {
      ok: true,
      data: {
        renderModelContractVersion: "kai-sprint2-board-reporting-render-model-v1",
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        packetAudience: "internal",
        supportedContentTypes: ["evidence_summary", "impact_narrative"],
        members: [DRAFT_A, DRAFT_B].map((draftId, index) => ({
          generationRunId: `1a0a0000-0000-4000-8000-0000000001${index}1`,
          generatedContentDraftId: draftId,
          contentType: index % 2 === 0 ? "evidence_summary" : "impact_narrative",
          draftStatus: "draft",
          requestedAudience: "internal",
          reviewQueueItemId: `1a0a0000-0000-4000-8000-0000000004${index}1`,
          queueStatus: "resolved",
          reviewStatus: "resolved",
          reviewUpdatedAt: "2026-09-14T12:00:00.000Z",
          currentUseEligible: true,
          blocks: [{
            ordinal: 0,
            generatedContentBlockId: `1a0a0000-0000-4000-8000-0000000005${index}1`,
            text: "not stored in Board Reporting production synthetic canary",
            citations: [citation(index)],
          }],
        })),
      },
      error: null,
    };
  }

  const composeRenderModel = async () => renderModel();

  const candidateRepository = createPostgresBoardReportingCandidateRepository({ runInTransaction: withRunnerOwnedTransaction });
  const authorityRepository = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({ runInTransaction: withRunnerOwnedTransaction });
  const manifestRepository = createPostgresBoardReportingCandidateExportManifestRepository({ runInTransaction: withRunnerOwnedTransaction });
  const manifestRenderModelRepository = createPostgresBoardReportingCandidateExportManifestRenderModelRepository({ runInTransaction: withRunnerOwnedTransaction });

  function candidateAudit(now) {
    return createProductionMetadataOnlyAuditForBoardReportingCandidate({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext: ACTOR, now });
  }
  function authorityAudit(now) {
    return createProductionMetadataOnlyAuditForBoardReportingCandidateHumanFinalReleaseAuthority({ organizationId: ORG, engagementId: ENGAGEMENT, actorContext: ACTOR, now });
  }
  function manifestAudit(now) {
    return createProductionMetadataOnlyAuditForBoardReportingCandidateExportManifest({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: candidateId,
      actorContext: ACTOR,
      now,
    });
  }

  const NOW = {
    create: "2026-09-14T12:00:00.000Z",
    request: "2026-09-14T12:05:00.000Z",
    start: "2026-09-14T13:00:00.000Z",
    complete: "2026-09-14T14:00:00.000Z",
    grant: "2026-09-14T15:00:00.000Z",
    manifest: "2026-09-14T16:00:00.000Z",
  };

  console.log(`synthetic organizationId=${ORG}`);
  console.log(`synthetic engagementId=${ENGAGEMENT}`);
  console.log(`synthetic actorUserId=${ACTOR_ID} role=gk_admin`);
  console.log("");

  // BOARD-01 PACKET RETRIEVAL
  const packet = await checkpoint(
    "BOARD-01 PACKET RETRIEVAL",
    "eligible internal Board packet with 2 members composed from the seeded synthetic generated-content drafts",
    async () => {
      const result = await composeRenderModel();
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.data,
        result: `packetAudience=${result.data.packetAudience} memberCount=${result.data.members.length}`,
      };
    },
  );
  if (packet.members.length !== 2 || packet.packetAudience !== "internal") {
    console.log("BOARD_CANARY_FAIL");
    console.log("checkpoint: BOARD-01 PACKET RETRIEVAL");
    console.log("expected: packetAudience=internal memberCount=2");
    console.log(`actual: packetAudience=${packet.packetAudience} memberCount=${packet.members.length}`);
    console.log("next_inspection: inspect the synthetic renderModel() fixture in this script");
    await cleanupAndExit(1);
  }

  // BOARD-02 CANDIDATE CREATION
  const candidateData = await checkpoint(
    "BOARD-02 CANDIDATE CREATION",
    "createBoardReportingCandidate returns ok:true with a new boardReportingCandidateId and memberCount=2",
    async () => {
      const result = await createBoardReportingCandidate({
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        idempotencyKey: "board-canary-create",
        actorContext: ACTOR,
        now: NOW.create,
      }, {
        env: ENABLED_ENV,
        boardReportingCandidateRepository: candidateRepository,
        metadataOnlyAudit: candidateAudit(NOW.create),
        composeRenderModel,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.data,
        result: `boardReportingCandidateId=${result.data.boardReportingCandidateId} memberCount=${result.data.memberCount} replayed=${result.data.replayed}`,
      };
    },
  );
  const candidateId = candidateData.boardReportingCandidateId;

  // BOARD-03 REVIEW REQUEST
  const reviewRequestData = await checkpoint(
    "BOARD-03 REVIEW REQUEST",
    "requestBoardReportingCandidateReview returns ok:true with a new reviewQueueItemId, queueStatus=open",
    async () => {
      const result = await requestBoardReportingCandidateReview({
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        boardReportingCandidateId: candidateId,
        actorContext: ACTOR,
        now: NOW.request,
      }, {
        env: ENABLED_ENV,
        boardReportingCandidateRepository: candidateRepository,
        metadataOnlyAudit: candidateAudit(NOW.request),
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.data,
        result: `reviewQueueItemId=${result.data.reviewQueueItemId} queueStatus=${result.data.queueStatus} reviewStatus=${result.data.reviewStatus}`,
      };
    },
  );
  const reviewQueueItemId = reviewRequestData.reviewQueueItemId;

  // BOARD-04 REVIEW START
  await checkpoint(
    "BOARD-04 REVIEW START",
    "startBoardReportingCandidateReview returns ok:true with queueStatus=in_progress",
    async () => {
      const requestRow = await pool.query(
        `SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
        [reviewQueueItemId],
      );
      const result = await startBoardReportingCandidateReview({
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        boardReportingCandidateId: candidateId,
        reviewQueueItemId,
        expectedUpdatedAt: requestRow.rows[0].updated_at.toISOString(),
        actorContext: ACTOR,
        now: NOW.start,
      }, {
        env: ENABLED_ENV,
        boardReportingCandidateRepository: candidateRepository,
        metadataOnlyAudit: candidateAudit(NOW.start),
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.data,
        result: `reviewQueueItemId=${result.data.reviewQueueItemId} queueStatus=${result.data.queueStatus}`,
      };
    },
  );

  // BOARD-05 REVIEW COMPLETION
  await checkpoint(
    "BOARD-05 REVIEW COMPLETION",
    "completeBoardReportingCandidateReview returns ok:true with queueStatus=resolved reviewStatus=resolved",
    async () => {
      const startRow = await pool.query(
        `SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
        [reviewQueueItemId],
      );
      const result = await completeBoardReportingCandidateReview({
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        boardReportingCandidateId: candidateId,
        reviewQueueItemId,
        expectedUpdatedAt: startRow.rows[0].updated_at.toISOString(),
        actorContext: ACTOR,
        now: NOW.complete,
      }, {
        env: ENABLED_ENV,
        boardReportingCandidateRepository: candidateRepository,
        metadataOnlyAudit: candidateAudit(NOW.complete),
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.data,
        result: `queueStatus=${result.data.queueStatus} reviewStatus=${result.data.reviewStatus}`,
      };
    },
  );

  // BOARD-06 FINAL RELEASE AUTHORITY
  const authorityData = await checkpoint(
    "BOARD-06 FINAL RELEASE AUTHORITY",
    "recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision (grant) returns ok:true effective=true",
    async () => {
      const result = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision({
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        boardReportingCandidateId: candidateId,
        reviewQueueItemId,
        decisionAction: "grant",
        actorContext: ACTOR,
        now: NOW.grant,
      }, {
        env: ENABLED_ENV,
        boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository,
        metadataOnlyAudit: authorityAudit(NOW.grant),
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.data,
        result: `decisionId=${result.data.decisionId} decisionAction=${result.data.decisionAction} effective=${result.data.effective}`,
      };
    },
  );
  if (authorityData.effective !== true) {
    console.log("BOARD_CANARY_FAIL");
    console.log("checkpoint: BOARD-06 FINAL RELEASE AUTHORITY");
    console.log("expected: effective=true");
    console.log(`actual: effective=${authorityData.effective}`);
    console.log("next_inspection: inspect kai.board_reporting_candidate_human_authority_decisions for this candidate");
    await cleanupAndExit(1);
  }

  // BOARD-07 FINAL ELIGIBILITY
  await checkpoint(
    "BOARD-07 FINAL ELIGIBILITY",
    "evaluateBoardReportingFinalEligibility returns ok:true finalEligibility=true",
    async () => {
      const result = await evaluateBoardReportingFinalEligibility({
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        boardReportingCandidateId: candidateId,
        actorContext: ACTOR,
      }, {
        candidateRepository,
        authorityRepository,
        composeRenderModel,
      });
      if (!result.ok) return result;
      if (result.data.finalEligibility !== true) {
        return { ok: false, error: { code: "final_eligibility_false", detail: result.data } };
      }
      return {
        ok: true,
        data: result.data,
        result: `finalEligibility=${result.data.finalEligibility} failedGates=${JSON.stringify(result.data.failedGates)}`,
      };
    },
  );

  // BOARD-08 EXPORT MANIFEST
  const manifestData = await checkpoint(
    "BOARD-08 EXPORT MANIFEST",
    "createBoardReportingCandidateExportManifest returns ok:true with a new boardReportingCandidateExportManifestId",
    async () => {
      const result = await createBoardReportingCandidateExportManifest({
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        boardReportingCandidateId: candidateId,
        actorContext: ACTOR,
      }, {
        env: ENABLED_ENV,
        now: NOW.manifest,
        repository: manifestRepository,
        metadataOnlyAudit: manifestAudit(NOW.manifest),
        evaluateEligibility: evaluateBoardReportingFinalEligibility,
        authorityRepository,
        eligibilityDependencies: { candidateRepository, authorityRepository, composeRenderModel },
        authorityEffectivenessDependencies: {},
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.data,
        result: `boardReportingCandidateExportManifestId=${result.data.boardReportingCandidateExportManifestId} replayed=${result.data.replayed}`,
      };
    },
  );
  const manifestId = manifestData.boardReportingCandidateExportManifestId;

  // BOARD-09 FINAL MARKDOWN RETRIEVAL
  const markdownData = await checkpoint(
    "BOARD-09 FINAL MARKDOWN RETRIEVAL",
    "serializeBoardReportingCandidateExportManifestToMarkdown returns ok:true deliveryClass=FINAL_MANIFEST_BOUND",
    async () => {
      const result = await serializeBoardReportingCandidateExportManifestToMarkdown({
        organizationId: ORG,
        boardReportingCandidateExportManifestId: manifestId,
        actorContext: ACTOR,
      }, {
        repository: manifestRenderModelRepository,
        renderModelDependencies: { composeRenderModel },
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.data,
        result: `markdownContractVersion=${result.data.markdownContractVersion} deliveryClass=${result.data.deliveryClass} markdownFirstLine=${JSON.stringify(result.data.markdown.split("\n")[0])}`,
      };
    },
  );
  if (markdownData.deliveryClass !== "FINAL_MANIFEST_BOUND") {
    console.log("BOARD_CANARY_FAIL");
    console.log("checkpoint: BOARD-09 FINAL MARKDOWN RETRIEVAL");
    console.log("expected: deliveryClass=FINAL_MANIFEST_BOUND");
    console.log(`actual: deliveryClass=${markdownData.deliveryClass}`);
    console.log("next_inspection: inspect kaiBoardReportingCandidateExportManifestMarkdownSerializer.js FINAL_DELIVERY_CLASS constant");
    await cleanupAndExit(1);
  }

  // BOARD-10 CITATION TRACEABILITY
  await checkpoint(
    "BOARD-10 CITATION TRACEABILITY",
    "final manifest-bound Board representation preserves governed citation traceability IDs from eligible generated-content members",
    async () => {
      const finalRenderModelResult = await manifestRenderModelRepository.composeBoardReportingCandidateExportManifestRenderModel({
        organizationId: ORG,
        boardReportingCandidateExportManifestId: manifestId,
        actorContext: ACTOR,
      }, { composeRenderModel });
      if (!finalRenderModelResult.ok) return finalRenderModelResult;

      const representationResult = buildBoardReportingPacketRepresentation(finalRenderModelResult.data.renderModel);
      if (!representationResult.representation) {
        return { ok: false, error: { code: representationResult.error || "invalid_render_model" } };
      }
      const fingerprintResult = composeBoardReportingPacketFingerprint(finalRenderModelResult.data.renderModel);
      if (fingerprintResult.fingerprint !== candidateData.canonicalFingerprint) {
        return { ok: false, error: { code: "final_representation_fingerprint_mismatch" } };
      }

      const expectedTraceKeys = new Set();
      for (const member of renderModel().data.members) {
        for (const block of member.blocks) {
          for (const item of block.citations) {
            expectedTraceKeys.add([
              member.generatedContentDraftId,
              block.generatedContentBlockId,
              item.generatedContentCitationId,
              item.claimId,
              item.evidenceItemId,
              item.sourceId,
              item.sourceVersionId,
            ].join("|"));
          }
        }
      }

      let citationCount = 0;
      const actualTraceKeys = new Set();
      for (const member of representationResult.representation.members) {
        for (const block of member.blocks) {
          for (const item of block.citations) {
            citationCount += 1;
            actualTraceKeys.add([
              member.generatedContentDraftId,
              block.generatedContentBlockId,
              item.generatedContentCitationId,
              item.claimId,
              item.evidenceItemId,
              item.sourceId,
              item.sourceVersionId,
            ].join("|"));
          }
        }
      }

      const allExpectedLinked = [...expectedTraceKeys].every((key) => actualTraceKeys.has(key));
      const markdownCarriesCitationIds = [...expectedTraceKeys].every((key) => {
        const [, , generatedContentCitationId, claimId, evidenceItemId, sourceId, sourceVersionId] = key.split("|");
        return markdownData.markdown.includes(generatedContentCitationId)
          && markdownData.markdown.includes(claimId)
          && markdownData.markdown.includes(evidenceItemId)
          && markdownData.markdown.includes(sourceId)
          && markdownData.markdown.includes(sourceVersionId);
      });
      if (!allExpectedLinked || !markdownCarriesCitationIds) {
        return { ok: false, error: { code: "citation_traceability_link_missing" } };
      }
      return {
        ok: true,
        data: { citationCount },
        result: `representationCitationCount=${citationCount} finalFingerprintMatchesCandidate=true markdownCitationIdsPresent=true`,
      };
    },
  );

  // BOARD-11 AUDIT TRACE
  await checkpoint(
    "BOARD-11 AUDIT TRACE",
    "metadata-only audit events persist for candidate creation, Board review lifecycle, human final-release authority, and export-manifest creation",
    async () => {
      const { rows } = await pool.query(
        `SELECT action, metadata
           FROM kai.audit_events
          ORDER BY audit_event_id ASC`,
      );

      const required = new Map([
        ["board_reporting_candidate_created", { objectType: "board_reporting_candidate" }],
        ["board_reporting_candidate_review_requested", { objectType: "board_reporting_candidate" }],
        ["board_reporting_candidate_review_started", { objectType: "board_reporting_candidate" }],
        ["board_reporting_candidate_review_completed", { objectType: "board_reporting_candidate" }],
        ["board_reporting_candidate_human_authority_decision_recorded", { objectType: "board_reporting_candidate" }],
        ["board_reporting_candidate_export_manifest_created", { objectType: "board_reporting_candidate_export_manifest" }],
      ]);
      const found = new Set();
      for (const row of rows) {
        const expected = required.get(row.action);
        const metadata = row.metadata || {};
        const metadataOnly = metadata.metadata_only === true
          && metadata.contains_raw_file_content === false
          && metadata.contains_raw_parsed_rows === false
          && metadata.contains_client_pii === false
          && metadata.contains_prompt_text === false
          && metadata.contains_unsafe_generated_text === false
          && metadata.contains_signed_urls === false
          && metadata.contains_storage_credentials === false;
        const identityMatches = row.action === "board_reporting_candidate_export_manifest_created"
          ? metadata.object_id === manifestId
            && metadata.board_reporting_candidate_id === candidateId
          : (metadata.board_reporting_candidate_id === candidateId || metadata.object_id === candidateId);
        if (
          expected
          && metadataOnly
          && identityMatches
          && metadata.object_type === expected.objectType
          && metadata.target_object_type === expected.objectType
          && metadata.operation === row.action
          && metadata.operation_type === row.action
        ) {
          found.add(row.action);
        }
      }
      const missing = [...required.keys()].filter((action) => !found.has(action));
      if (missing.length > 0) {
        const actionCounts = {};
        for (const row of rows) {
          actionCounts[row.action] = (actionCounts[row.action] || 0) + 1;
        }
        return {
          ok: false,
          error: {
            code: "metadata_only_audit_trace_missing",
            missingActions: missing,
            auditRowCount: rows.length,
            actionCounts,
          },
        };
      }
      return {
        ok: true,
        data: { auditEventCount: found.size },
        result: `metadataOnlyAuditEvents=${found.size} lifecycle=candidate_create,review_request,review_start,review_complete,human_authority,manifest_create`,
      };
    },
  );

  console.log("BOARD_CANARY_PASS");
  console.log("");
  console.log("checkpoint results:");
  for (const entry of checkpointResults) {
    console.log(`  ${entry.name}: PASS (${entry.result})`);
  }
  console.log("");
  console.log("generated synthetic IDs:");
  console.log(`  organizationId=${ORG}`);
  console.log(`  engagementId=${ENGAGEMENT}`);
  console.log(`  boardReportingCandidateId=${candidateId}`);
  console.log(`  reviewQueueItemId=${reviewQueueItemId}`);
  console.log(`  authorityDecisionId=${authorityData.decisionId}`);
  console.log(`  boardReportingCandidateExportManifestId=${manifestId}`);
  console.log("");
  console.log(`final manifest ID: ${manifestId}`);
  console.log(`final Markdown contract result: markdownContractVersion=${markdownData.markdownContractVersion} deliveryClass=${markdownData.deliveryClass}`);

  await cleanupAndExit(0);
} catch (error) {
  console.log("BOARD_CANARY_FAIL");
  console.log("checkpoint: provisioning");
  console.log("expected: ephemeral PostgreSQL provisioned and migrated successfully");
  console.log(`actual: ${sanitizeDiagnostic(error?.message || error)}`);
  console.log("next_inspection: check PG_BIN_DIR points at a valid PostgreSQL bin directory (initdb/pg_ctl/psql/createdb) and inspect the ephemeral postgres.log");
  await cleanupAndExit(1);
}
