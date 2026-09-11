// KAI P14-11: generated-content-draft audit-composition repair.
//
// P14-09/P14-10's own regression suites always exercised
// createGeneratedContentDraft's REQUIRED audit gate (prepareRequiredAudit)
// through a permissive test double (`{ prepareMetadataOnlyAudit() { return
// { ok: true, publish() {} } } }`), never through the real production
// composer (createProductionMetadataOnlyAuditForGeneratedContentDraft).
// That composer's prepareMetadataOnlyAudit REQUIRES
// payload.generated_content_draft_id (a CLAIM_ID_PATTERN-shaped uuid) before
// it will return { ok: true }, but createGeneratedContentDraft's call to
// prepareRequiredAudit (postgresGeneratedContentRepository.js, right after
// persistCompleteSet/rereadAsResult) never supplied that field - so every
// real production Evidence Summary / Impact Narrative draft creation
// (funder and internal alike) threw `required_audit_prepare_failed`
// immediately after successfully persisting the draft, which the outer
// catch converted into a bare `system_error`/500, rolling back the entire
// transaction (draft/blocks/citations/queue row) after it had already
// durably persisted and re-read clean.
//
// This suite proves, against a real ephemeral PostgreSQL database and the
// REAL production audit composer (not a stub), that:
//   1. generated content and its required audit event now commit together
//      in the one real production call path, and
//   2. when the real audit adapter's underlying write genuinely cannot
//      succeed (a legitimate downstream failure, not the now-fixed missing
//      draft-id defect), the whole transaction still rolls back and no
//      partial generated-content graph (draft/blocks/citations/queue item)
//      survives - fail-closed atomicity is preserved.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P14_11_GENERATED_CONTENT_AUDIT_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P14-11 generated-content-draft audit-composition integration suite refused a non-loopback KAI_P14_11_GENERATED_CONTENT_AUDIT_DATABASE_URL host: ${host}`);
  }
}

test("P14-11 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P14-11 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresGeneratedContentRepository\.js|kaiMetadataOnlyAuditComposition\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P14-11 generated-content-draft audit-composition integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { createPostgresGeneratedContentRepository } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const { createProductionMetadataOnlyAuditForGeneratedContentDraft } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const ENGAGEMENT = "00000000-0000-4000-8000-000000000901";
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

  const actorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };

  function stubAuditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  const evidenceRepo = createPostgresEvidenceLineageRepository({ runInTransaction: withTx });
  const claimRepo = createPostgresClaimProposalRepository({ runInTransaction: withTx });
  const gapRepo = createPostgresClaimGapFollowupRepository({ runInTransaction: withTx });

  // Real content-generation path, but with the P2-06 traceability evaluator
  // swapped for a deterministic in-scope stub - this suite proves the
  // audit-composition fix, not the (already separately covered) P2-06
  // eligibility machinery. The claim/evidence graph itself is real and
  // persisted through the real proposal/gap pipeline.
  function generatedRepo(options = {}) {
    return createPostgresGeneratedContentRepository({
      runInTransaction: withTx,
      async evaluator(tx, input) {
        const rows = await tx.query(
          `SELECT claim_id::text AS claim_id, evidence_item_id::text AS evidence_item_id
             FROM kai.claims
            WHERE organization_id = $1::uuid AND claim_id = $2::uuid`,
          [input.organizationId, input.claimId],
        );
        const claim = rows.rows[0];
        return {
          ok: true,
          data: {
            claim: { claim_id: claim.claim_id },
            evidence: { evidence_item_id: claim.evidence_item_id },
            requestedAudience: input.requestedAudience,
            eligible: true,
            blockerCodes: [],
          },
          error: null,
        };
      },
      ...options,
    });
  }

  function realGeneratorFixture(calls) {
    return async (input) => {
      calls.push(input);
      const claim = input.claims[0];
      return { blocks: [{ ordinal: 1, text: claim.claimStatement, citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] }] };
    };
  }

  let preparedClaim;
  async function prepareClaim() {
    if (preparedClaim) return preparedClaim;
    await pool.query(`INSERT INTO kai.organizations (organization_id, name) VALUES ($1::uuid, 'P14-11 Audit Composition Repro Org') ON CONFLICT DO NOTHING;`, [ORG]);
    await pool.query(`INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ($1::uuid, $2::uuid, 'P14-11-AUDIT-COMPOSITION') ON CONFLICT DO NOTHING;`, [ENGAGEMENT, ORG]);
    const [sourceVersion] = await query(
      `SELECT source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1`,
      [ORG],
    );
    const evidenceResult = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: sourceVersion.source_version_id, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceLineageRepository: evidenceRepo, metadataOnlyAudit: stubAuditRecorder() },
    );
    assert.equal(evidenceResult.ok, true, JSON.stringify(evidenceResult));
    const [evidenceRow] = await query(
      `SELECT evidence_item_id FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY evidence_item_id ASC LIMIT 1`,
      [ORG],
    );
    const claimResult = await proposeClaim(
      { organizationId: ORG, evidenceItemId: evidenceRow.evidence_item_id, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: claimRepo, metadataOnlyAudit: stubAuditRecorder() },
    );
    assert.equal(claimResult.ok, true, JSON.stringify(claimResult));
    const claimId = claimResult.data.claim.claim_id;
    const gapResult = await generateClaimGapFollowups(
      { organizationId: ORG, claimId, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimGapFollowupRepository: gapRepo, metadataOnlyAudit: stubAuditRecorder() },
    );
    assert.equal(gapResult.ok, true, JSON.stringify(gapResult));
    preparedClaim = { claimId, evidenceItemId: evidenceRow.evidence_item_id };
    return preparedClaim;
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
    const queueItems = await query(
      `SELECT count(*)::int AS n FROM kai.review_queue_items q
         JOIN kai.generated_content_drafts d ON d.generated_content_draft_id = q.target_object_id
         JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id
        WHERE r.organization_id = $1::uuid AND r.idempotency_key = $2 AND q.queue_type = 'generated_content_review'`,
      [ORG, idempotencyKey],
    );
    return { generation_runs: runs[0].n, generated_content_drafts: drafts[0].n, generated_content_blocks: blocks[0].n, review_queue_items: queueItems[0].n };
  }

  test("P14-11: real production generated-content-draft audit adapter now receives generated_content_draft_id and the required audit event commits durably together with the generated-content graph in one transaction", async () => {
    const { claimId } = await prepareClaim();
    const idempotencyKey = "p14-11-success-real-production-audit";

    const productionAudit = createProductionMetadataOnlyAuditForGeneratedContentDraft({
      organizationId: ORG,
      actorContext,
      now: NOW,
      route: "p14_11_test_real_production_audit_composition",
    });

    const generatorCalls = [];
    const repository = generatedRepo();
    const result = await repository.createEvidenceSummaryDraft(
      { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "internal", claimIds: [claimId], idempotencyKey, actorContext, now: NOW },
      { draftGenerator: realGeneratorFixture(generatorCalls), metadataOnlyAudit: productionAudit },
    );

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(generatorCalls.length, 1);

    const graph = await durableGraphRowCount(idempotencyKey);
    assert.equal(graph.generation_runs, 1);
    assert.equal(graph.generated_content_drafts, 1);
    assert.equal(graph.generated_content_blocks, 1);
    assert.equal(graph.review_queue_items, 1);

    const draftId = result.data.generatedContentDraftId;
    assert.match(draftId, /^[0-9a-f-]{36}$/);

    const auditRows = await query(
      `SELECT object_type::text AS object_type, metadata
         FROM kai.audit_events
        WHERE organization_id = $1::uuid
          AND metadata->>'object_id' = $2
          AND metadata->>'operation' = 'generated_content_draft_created'`,
      [ORG, draftId],
    );
    assert.equal(auditRows.length, 1, "the required audit event for this exact draft must be durably committed, using the real production audit composer");
    assert.equal(auditRows[0].metadata.object_id, draftId);
    assert.equal(auditRows[0].metadata.target_object_type, "generated_content_draft");
  });

  test("P14-11: when the real production audit adapter's underlying write cannot succeed, the whole transaction rolls back and no partial generated-content graph survives", async () => {
    const { claimId } = await prepareClaim();
    const idempotencyKey = "p14-11-failure-audit-write-rejected";

    // The real composer/preparation/payload-validation logic runs exactly as
    // in production (including the generated_content_draft_id contract this
    // package repairs); only the terminal DB write is swapped for a
    // deterministic failure, using the composer's own pluggable
    // insertAuditEvent seam, to prove atomicity under a genuine downstream
    // audit-write failure without editing production code.
    const productionAuditWithFailingWrite = createProductionMetadataOnlyAuditForGeneratedContentDraft({
      organizationId: ORG,
      actorContext,
      now: NOW,
      route: "p14_11_test_real_production_audit_composition",
      insertAuditEvent: async () => ({ ok: false, skipped: true, reason: "simulated_audit_insert_rejection" }),
    });

    const auditCountBefore = await query(
      `SELECT count(*)::int AS n FROM kai.audit_events WHERE organization_id = $1::uuid AND metadata->>'operation' = 'generated_content_draft_created'`,
      [ORG],
    );

    const generatorCalls = [];
    const repository = generatedRepo();
    const result = await repository.createEvidenceSummaryDraft(
      { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "internal", claimIds: [claimId], idempotencyKey, actorContext, now: NOW },
      { draftGenerator: realGeneratorFixture(generatorCalls), metadataOnlyAudit: productionAuditWithFailingWrite },
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "system_error");
    assert.equal(generatorCalls.length, 1, "the generator still ran once before the audit write was rejected");

    const graph = await durableGraphRowCount(idempotencyKey);
    assert.equal(graph.generation_runs, 0);
    assert.equal(graph.generated_content_drafts, 0);
    assert.equal(graph.generated_content_blocks, 0);
    assert.equal(graph.review_queue_items, 0);

    // The rejected/rolled-back attempt must never add a new audit_events row
    // of its own - the count for this operation must be unchanged from
    // immediately before this attempt (whatever it already was, e.g. from
    // the success test above).
    const auditCountAfter = await query(
      `SELECT count(*)::int AS n FROM kai.audit_events WHERE organization_id = $1::uuid AND metadata->>'operation' = 'generated_content_draft_created'`,
      [ORG],
    );
    assert.equal(auditCountAfter[0].n, auditCountBefore[0].n, "no audit row must be committed for the rejected/rolled-back attempt");
  });
}
