import test from "node:test";
import assert from "node:assert/strict";

/**
 * Organization factual review (owner authorization 2026-10-24) through the
 * real services and repositories on the Plan A normal-chain database, after
 * the P2-01M proof has left GK-reviewed measured and field-presence claims:
 * an active client_admin's evidence, claim, and internal coverage decisions
 * are refused, with nothing written, for unsupported (field-presence)
 * evidence and wherever Get Kinder has already decided. The ordinary
 * positive journey is the assembled browser acceptance's. Run only by
 * scripts/kai-sprint2-plan-a-normal-migration-chain-local-postgres.js.
 */
const DATABASE_URL = process.env.KAI_P2_01M_MEASUREMENT_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`organization factual review integration refused a non-loopback database URL host: ${host}`);
  }
}

if (!DATABASE_URL || process.env.KAI_PLAN_A_NORMAL_CHAIN !== "1") {
  test("organization factual review integration requires the Plan A normal-chain runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } = await import("../Backend/kai/auth/kaiOrganizationMembershipSource.js");
  const { recordEvidenceReviewDecision, recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { createPostgresHumanReviewRepository } = await import("../Backend/kai/dictionary/postgresHumanReviewRepository.js");
  const { acceptInternalCoverageLimitation } = await import("../Backend/kai/services/kaiCoverageReviewDecisionService.js");
  const { createPostgresCoverageReviewDecisionRepository } = await import("../Backend/kai/dictionary/postgresCoverageReviewDecisionRepository.js");
  const { getOrganizationFactualReview } = await import("../Backend/kai/services/kaiOrganizationFactualReviewService.js");
  const { createPostgresOrganizationFactualReviewRepository } = await import("../Backend/kai/dictionary/postgresOrganizationFactualReviewRepository.js");

  const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
  const NOW = new Date().toISOString();
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 2 });
  const query = async (sql, params = []) => (await pool.query(sql, params)).rows;
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
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });
  const humanReviewRepository = createPostgresHumanReviewRepository({ runInTransaction: withTx });
  const coverageReviewDecisionRepository = createPostgresCoverageReviewDecisionRepository({ runInTransaction: withTx });
  const organizationFactualReviewRepository = createPostgresOrganizationFactualReviewRepository({ runInTransaction: withTx });

  const claimOf = async (evidenceType, reviewed) => (await query(
    `SELECT c.organization_id::text AS organization_id, c.claim_id::text AS claim_id, e.evidence_item_id::text AS evidence_item_id,
            eq.review_queue_item_id::text AS evidence_queue_id, eq.updated_at AS evidence_queue_updated_at,
            cq.review_queue_item_id::text AS claim_queue_id, cq.updated_at AS claim_queue_updated_at
       FROM kai.claims c
       JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id AND e.organization_id = c.organization_id
       JOIN kai.source_versions v ON v.source_version_id = e.source_version_id AND v.is_current
       JOIN kai.review_queue_items eq ON eq.organization_id = e.organization_id AND eq.queue_type = 'evidence_review' AND eq.target_object_id = e.evidence_item_id
       JOIN kai.review_queue_items cq ON cq.organization_id = c.organization_id AND cq.queue_type = 'claim_review' AND cq.target_object_id = c.claim_id
      WHERE e.evidence_type = $1
        AND ($2::boolean IS FALSE OR EXISTS (SELECT 1 FROM kai.evidence_review_decisions d WHERE d.evidence_item_id = e.evidence_item_id))
      ORDER BY c.claim_id LIMIT 1`, [evidenceType, reviewed]))[0];
  const measured = await claimOf("source_record_count_measurement", true);
  const presence = await claimOf("dictionary_field_presence_fact", false);
  const storedAdmin = (organizationId) => ({
    actorType: "human",
    actorUserId: "9e000000-0000-4000-8000-0000000000fa",
    kaiRoles: [],
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, role_name: "client_admin", membership_status: "active", source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE }],
  });
  const ledgerCounts = async () => (await query(`SELECT
      (SELECT count(*) FROM kai.evidence_review_decisions)::int AS evidence,
      (SELECT count(*) FROM kai.claim_review_decisions)::int AS claim,
      (SELECT count(*) FROM kai.coverage_review_decisions)::int AS coverage,
      (SELECT count(*) FROM kai.upload_lifecycle_audit)::int AS lifecycle`))[0];
  const reasons = (result) => (result.blockers || []).map((blocker) => blocker.blocking_reason);

  try {
    test("the normal chain left a GK-reviewed measured claim and a GK-reviewed field-presence claim", () => {
      assert.ok(measured, "measured claim");
      assert.ok(presence, "field-presence claim");
    });

    test("unsupported evidence: an organization administrator's decisions on field-presence evidence are refused for Get Kinder review, with nothing written", async () => {
      const before = await ledgerCounts();
      const actorContext = storedAdmin(presence.organization_id);
      const evidence = await recordEvidenceReviewDecision({
        organizationId: presence.organization_id, evidenceItemId: presence.evidence_item_id, reviewQueueItemId: presence.evidence_queue_id,
        expectedUpdatedAt: new Date(presence.evidence_queue_updated_at).toISOString(), decision: "supported", actorContext, now: NOW,
      }, { env: ENV, humanReviewRepository, metadataOnlyAudit: noAudit() });
      assert.deepEqual([evidence.ok, evidence.error.code, evidence.error.status], [false, "blocked", 422], JSON.stringify(evidence));
      assert.ok(reasons(evidence).includes("evidence_type_requires_get_kinder_review"), reasons(evidence).join(","));
      const claim = await recordClaimReviewDecision({
        organizationId: presence.organization_id, claimId: presence.claim_id, reviewQueueItemId: presence.claim_queue_id,
        expectedUpdatedAt: new Date(presence.claim_queue_updated_at).toISOString(), decision: "rejected", actorContext, now: NOW,
      }, { env: ENV, humanReviewRepository, metadataOnlyAudit: noAudit() });
      assert.equal(claim.ok, false, JSON.stringify(claim));
      if (claim.error.code === "blocked") assert.ok(reasons(claim).includes("evidence_type_requires_get_kinder_review"), reasons(claim).join(","));
      else assert.equal(claim.error.code, "evidence_review_unresolved");
      const coverage = await acceptInternalCoverageLimitation({
        organizationId: presence.organization_id, claimId: presence.claim_id, dimensionKey: "small_cell_risk", actorContext, now: NOW,
      }, { env: ENV, coverageReviewDecisionRepository, metadataOnlyAudit: noAudit() });
      assert.equal(coverage.ok, false, JSON.stringify(coverage));
      if (coverage.error.code === "blocked") assert.ok(reasons(coverage).includes("evidence_type_requires_get_kinder_review"), reasons(coverage).join(","));
      const view = await getOrganizationFactualReview({ organizationId: presence.organization_id, claimId: presence.claim_id, actorContext },
        { env: ENV, organizationFactualReviewRepository });
      if (view.ok) {
        assert.equal(view.data.evidence_review.organization_may_decide, false);
        assert.ok(view.data.evidence_review.get_kinder_review_reasons.includes("evidence_type_requires_get_kinder_review"));
        assert.ok(view.data.coverage_limitations.every((row) => row.organization_may_accept === false));
      }
      assert.deepEqual(await ledgerCounts(), before, "nothing written");
    });

    test("Get Kinder's decision stands: the organization administrator cannot supersede a GK evidence or claim decision on a measured claim, and the view says so", async () => {
      const before = await ledgerCounts();
      const actorContext = storedAdmin(measured.organization_id);
      const evidence = await recordEvidenceReviewDecision({
        organizationId: measured.organization_id, evidenceItemId: measured.evidence_item_id, reviewQueueItemId: measured.evidence_queue_id,
        expectedUpdatedAt: new Date(measured.evidence_queue_updated_at).toISOString(), decision: "not_supported", actorContext, now: NOW,
      }, { env: ENV, humanReviewRepository, metadataOnlyAudit: noAudit() });
      assert.deepEqual([evidence.ok, evidence.error.code], [false, "blocked"], JSON.stringify(evidence));
      assert.ok(reasons(evidence).includes("get_kinder_decision_recorded"), reasons(evidence).join(","));
      const claim = await recordClaimReviewDecision({
        organizationId: measured.organization_id, claimId: measured.claim_id, reviewQueueItemId: measured.claim_queue_id,
        expectedUpdatedAt: new Date(measured.claim_queue_updated_at).toISOString(), decision: "rejected", actorContext, now: NOW,
      }, { env: ENV, humanReviewRepository, metadataOnlyAudit: noAudit() });
      assert.deepEqual([claim.ok, claim.error.code], [false, "blocked"], JSON.stringify(claim));
      assert.ok(reasons(claim).includes("get_kinder_decision_recorded"), reasons(claim).join(","));
      const funder = await recordClaimReviewDecision({
        organizationId: measured.organization_id, claimId: measured.claim_id, reviewQueueItemId: measured.claim_queue_id,
        expectedUpdatedAt: new Date(measured.claim_queue_updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal", "funder"], actorContext, now: NOW,
      }, { env: ENV, humanReviewRepository, metadataOnlyAudit: noAudit() });
      assert.deepEqual([funder.ok, funder.error.code, reasons(funder)], [false, "authorization_denied", ["audience_requires_get_kinder_review"]]);
      const view = await getOrganizationFactualReview({ organizationId: measured.organization_id, claimId: measured.claim_id, actorContext },
        { env: ENV, organizationFactualReviewRepository });
      if (view.ok) {
        assert.deepEqual([view.data.evidence_review.decided_by, view.data.evidence_review.organization_may_decide], ["get_kinder", false]);
        assert.ok(view.data.evidence_review.get_kinder_review_reasons.includes("get_kinder_decision_recorded"));
      } else {
        assert.equal(view.error.status, 409, JSON.stringify(view));
      }
      // Another organization's administrator, and an administrator without verified provenance, never reach the ledgers.
      const other = await recordEvidenceReviewDecision({
        organizationId: measured.organization_id, evidenceItemId: measured.evidence_item_id, reviewQueueItemId: measured.evidence_queue_id,
        expectedUpdatedAt: new Date(measured.evidence_queue_updated_at).toISOString(), decision: "supported",
        actorContext: storedAdmin("0e000000-0000-4000-8000-00000000ffff"), now: NOW,
      }, { env: ENV, humanReviewRepository, metadataOnlyAudit: noAudit() });
      assert.equal(other.error.code, "authorization_denied");
      const unverified = { ...actorContext, organizationMemberships: actorContext.organizationMemberships.map(({ source, ...rest }) => rest) };
      const noProvenance = await recordEvidenceReviewDecision({
        organizationId: measured.organization_id, evidenceItemId: measured.evidence_item_id, reviewQueueItemId: measured.evidence_queue_id,
        expectedUpdatedAt: new Date(measured.evidence_queue_updated_at).toISOString(), decision: "supported", actorContext: unverified, now: NOW,
      }, { env: ENV, humanReviewRepository, metadataOnlyAudit: noAudit() });
      assert.equal(noProvenance.error.code, "authorization_denied");
      assert.deepEqual(await ledgerCounts(), before, "nothing written");
    });
  } finally {
    test("close the pool", async () => { await pool.end(); });
  }
}
