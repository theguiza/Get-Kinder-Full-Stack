// P14-03 GRANT-RESPONSE-PACKET-EXPORT-CANDIDATE-FOUNDATION REAL-PERSISTED PROOF
//
// Proves, against a real, runner-owned Postgres database, that:
//  - packet structural identity is reused (FK to the existing P14-02
//    identity, never a second one)
//  - funder-only audience is enforced
//  - identical semantic state converges to the same candidate
//  - changed semantic state creates a new candidate
//  - a fabricated/nonexistent packet identity is rejected
//  - a cross-tenant packet identity is rejected
//  - a cross-tenant member/draft is rejected
//  - a member row's candidate_id is never confused with the packet identity id
//  - the member table has no exportManifestId column at all
//  - a duplicate member ordinal / duplicate (candidate, draft) is rejected
//  - candidate and member-snapshot UPDATE/DELETE are rejected at the DB level
//  - candidate creation creates no rows in any approval/manifest table
//
// This suite never reads or writes kai.export_candidates, kai.export_manifests,
// or any approval/human-authority-decision table - none of that is touched by
// this package.

import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P14_03_GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_FOUNDATION_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P14-03 grant-response-packet-export-candidate-foundation suite refused a non-loopback KAI_P14_03_GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_FOUNDATION_DATABASE_URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P14-03 grant-response-packet-export-candidate-foundation integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const {
    createPostgresGrantResponsePacketExportCandidateRepository,
  } = await import("../Backend/kai/dictionary/postgresGrantResponsePacketExportCandidateRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const ENGAGEMENT = "14030000-0000-4000-8000-000000000001";
  const ACTOR = { actorType: "human", actorUserId: "00000000-0000-4000-8000-000000000910" };
  const NOW = "2026-09-09T12:00:00.000Z";

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

  const noopAudit = Object.freeze({
    prepareMetadataOnlyAudit({ payload } = {}) {
      if (!payload || !payload.grant_response_packet_export_candidate_id) return { ok: false };
      return { ok: true, async publish() { return { ok: true }; } };
    },
  });

  function makeRepository() {
    return createPostgresGrantResponsePacketExportCandidateRepository({ runInTransaction: withRunnerOwnedTransaction });
  }

  function baseCitation(overrides = {}) {
    return {
      claimId: "14030000-0000-4000-8000-0000000000c1",
      evidenceItemId: "14030000-0000-4000-8000-0000000000e1",
      sourceId: "14030000-0000-4000-8000-0000000000s1",
      sourceVersionId: "14030000-0000-4000-8000-0000000000v1",
      generatedContentCitationId: "14030000-0000-4000-8000-0000000000cc1",
      supportStrength: "strong",
      claimReviewStatus: "resolved",
      evidenceReviewStatus: "resolved",
      currentEligible: true,
      blockerCodes: [],
      affectedDimensionKeys: [],
      affectedObjectIds: [],
      ...overrides,
    };
  }

  function makeRenderModel({ engagementId, draftIds, blockerCodes }) {
    return {
      ok: true,
      data: {
        renderModelContractVersion: "kai-sprint2-grant-response-packet-render-model-v1",
        organizationId: ORG,
        engagementId,
        packetAudience: "funder",
        members: draftIds.map((draftId, index) => ({
          generatedContentDraftId: draftId,
          contentType: "evidence_summary",
          requestedAudience: "funder",
          draftStatus: "client_reviewed",
          reviewUpdatedAt: new Date().toISOString(),
          currentUseEligible: true,
          exportManifestId: null,
          exportManifestHistory: [],
          blocks: [
            {
              ordinal: 0,
              generatedContentBlockId: `14030000-0000-4000-8000-0000000000b${index}`,
              text: "member block text",
              citations: [baseCitation({ blockerCodes: blockerCodes || [] })],
            },
          ],
        })),
      },
      error: null,
    };
  }

  async function seedEngagementAndDrafts(tx, { engagementId, orgId, draftIds }) {
    await tx.query(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
       VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT (engagement_id) DO NOTHING`,
      [engagementId, orgId, `p14-03-engagement-${engagementId}`],
    );
    for (const draftId of draftIds) {
      const generationRunId = `${draftId.slice(0, -12)}1${draftId.slice(-11)}`;
      await tx.query(
        `INSERT INTO kai.generation_runs (
           generation_run_id, organization_id, idempotency_key, request_fingerprint, content_type, requested_audience
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, 'evidence_summary', 'funder')
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
        [generationRunId, orgId, `p14-03-generation-run-${draftId}`, "a".repeat(64)],
      );
      await tx.query(
        `INSERT INTO kai.generated_content_drafts (
           generated_content_draft_id, generation_run_id, organization_id, content_type, requested_audience, validator_results
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'evidence_summary', 'funder', '[]'::jsonb)
         ON CONFLICT (generated_content_draft_id) DO NOTHING`,
        [draftId, generationRunId, orgId],
      );
    }
  }

  await test("packet structural identity is reused: candidate FKs to the existing P14-02 identity, never a new one", async () => {
    const engagementId = "14030000-0000-4000-8000-0000000000e1";
    const draftId = "14030000-0000-4000-8000-0000000000d1";
    await withRunnerOwnedTransaction((tx) => seedEngagementAndDrafts(tx, { engagementId, orgId: ORG, draftIds: [draftId] }));

    const repository = makeRepository();
    const result = await repository.createGrantResponsePacketExportCandidate(
      { organizationId: ORG, engagementId, actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel: async () => makeRenderModel({ engagementId, draftIds: [draftId] }) },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.replayed, false);

    const identityRows = await pool.query(
      `SELECT count(*)::int AS count FROM kai.grant_response_packet_export_identities
        WHERE organization_id = $1::uuid AND engagement_id = $2::uuid`,
      [ORG, engagementId],
    );
    assert.equal(identityRows.rows[0].count, 1);

    const candidateRows = await pool.query(
      `SELECT grant_response_packet_export_identity_id::text AS identity_id
         FROM kai.grant_response_packet_export_candidates
        WHERE grant_response_packet_export_candidate_id = $1::uuid`,
      [result.data.grantResponsePacketExportCandidateId],
    );
    assert.equal(candidateRows.rows[0].identity_id, result.data.grantResponsePacketExportIdentityId);
  });

  await test("funder-only audience is enforced - a non-funder render model is rejected", async () => {
    const engagementId = "14030000-0000-4000-8000-0000000000e2";
    const draftId = "14030000-0000-4000-8000-0000000000d2";
    await withRunnerOwnedTransaction((tx) => seedEngagementAndDrafts(tx, { engagementId, orgId: ORG, draftIds: [draftId] }));

    const repository = makeRepository();
    const nonFunderModel = makeRenderModel({ engagementId, draftIds: [draftId] });
    nonFunderModel.data.packetAudience = "internal";

    const result = await repository.createGrantResponsePacketExportCandidate(
      { organizationId: ORG, engagementId, actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel: async () => nonFunderModel },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
  });

  await test("identical semantic state converges to the same candidate", async () => {
    const engagementId = "14030000-0000-4000-8000-0000000000e3";
    const draftId = "14030000-0000-4000-8000-0000000000d3";
    await withRunnerOwnedTransaction((tx) => seedEngagementAndDrafts(tx, { engagementId, orgId: ORG, draftIds: [draftId] }));

    const repository = makeRepository();
    const composeRenderModel = async () => makeRenderModel({ engagementId, draftIds: [draftId] });

    const first = await repository.createGrantResponsePacketExportCandidate(
      { organizationId: ORG, engagementId, actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel },
    );
    assert.equal(first.ok, true);
    assert.equal(first.data.replayed, false);

    const second = await repository.createGrantResponsePacketExportCandidate(
      { organizationId: ORG, engagementId, actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel },
    );
    assert.equal(second.ok, true);
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.grantResponsePacketExportCandidateId, first.data.grantResponsePacketExportCandidateId);

    const rows = await pool.query(
      `SELECT count(*)::int AS count FROM kai.grant_response_packet_export_candidates
        WHERE grant_response_packet_export_identity_id = $1::uuid`,
      [first.data.grantResponsePacketExportIdentityId],
    );
    assert.equal(rows.rows[0].count, 1);
  });

  await test("changed semantic state creates a new candidate", async () => {
    const engagementId = "14030000-0000-4000-8000-0000000000e4";
    const draftId = "14030000-0000-4000-8000-0000000000d4";
    await withRunnerOwnedTransaction((tx) => seedEngagementAndDrafts(tx, { engagementId, orgId: ORG, draftIds: [draftId] }));

    const repository = makeRepository();
    const first = await repository.createGrantResponsePacketExportCandidate(
      { organizationId: ORG, engagementId, actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel: async () => makeRenderModel({ engagementId, draftIds: [draftId] }) },
    );
    assert.equal(first.ok, true);

    const second = await repository.createGrantResponsePacketExportCandidate(
      { organizationId: ORG, engagementId, actorContext: ACTOR, now: NOW },
      {
        metadataOnlyAudit: noopAudit,
        composeRenderModel: async () => makeRenderModel({ engagementId, draftIds: [draftId], blockerCodes: ["missing_citation"] }),
      },
    );
    assert.equal(second.ok, true);
    assert.notEqual(second.data.grantResponsePacketExportCandidateId, first.data.grantResponsePacketExportCandidateId);
    assert.notEqual(second.data.canonicalFingerprint, first.data.canonicalFingerprint);
    assert.equal(second.data.grantResponsePacketExportIdentityId, first.data.grantResponsePacketExportIdentityId);
  });

  await test("a fabricated/nonexistent packet export identity is rejected by the schema FK", async () => {
    await assert.rejects(() =>
      withRunnerOwnedTransaction((tx) =>
        tx.query(
          `INSERT INTO kai.grant_response_packet_export_candidates (
             organization_id, grant_response_packet_export_identity_id, fingerprint_contract_version,
             canonical_fingerprint, created_by
           ) VALUES ($1::uuid, $2::uuid, 'kai-sprint2-p14-03-grant-response-packet-export-candidate-fingerprint-v1', $3, $4::uuid)`,
          [ORG, "99999999-0000-4000-8000-000000000001", "a".repeat(64), ACTOR.actorUserId],
        ),
      ),
    );
  });

  await test("a cross-tenant packet identity is rejected", async () => {
    const engagementId = "14030000-0000-4000-8000-0000000000e5";
    const draftId = "14030000-0000-4000-8000-0000000000d5";
    await withRunnerOwnedTransaction((tx) => seedEngagementAndDrafts(tx, { engagementId, orgId: ORG, draftIds: [draftId] }));

    const identityRow = await pool.query(
      `SELECT grant_response_packet_export_identity_id::text AS id
         FROM kai.grant_response_packet_export_identities
        WHERE organization_id = $1::uuid AND engagement_id = $2::uuid`,
      [ORG, engagementId],
    );
    // If no identity exists yet for this engagement, mint one via the
    // repository first so there is a real identity to attempt cross-tenant
    // reuse against.
    let identityId = identityRow.rows[0]?.id;
    if (!identityId) {
      const repository = makeRepository();
      const seeded = await repository.createGrantResponsePacketExportCandidate(
        { organizationId: ORG, engagementId, actorContext: ACTOR, now: NOW },
        { metadataOnlyAudit: noopAudit, composeRenderModel: async () => makeRenderModel({ engagementId, draftIds: [draftId] }) },
      );
      identityId = seeded.data.grantResponsePacketExportIdentityId;
    }

    await assert.rejects(() =>
      withRunnerOwnedTransaction((tx) =>
        tx.query(
          `INSERT INTO kai.grant_response_packet_export_candidates (
             organization_id, grant_response_packet_export_identity_id, fingerprint_contract_version,
             canonical_fingerprint, created_by
           ) VALUES ($1::uuid, $2::uuid, 'kai-sprint2-p14-03-grant-response-packet-export-candidate-fingerprint-v1', $3, $4::uuid)`,
          [OTHER_ORG, identityId, "b".repeat(64), ACTOR.actorUserId],
        ),
      ),
    );
  });

  await test("a cross-tenant member/draft is rejected by the schema FK", async () => {
    const engagementId = "14030000-0000-4000-8000-0000000000e6";
    const draftId = "14030000-0000-4000-8000-0000000000d6";
    const otherOrgDraftId = "14030000-0000-4000-8000-0000000000d7";
    await withRunnerOwnedTransaction((tx) => seedEngagementAndDrafts(tx, { engagementId, orgId: ORG, draftIds: [draftId] }));
    await withRunnerOwnedTransaction((tx) =>
      tx.query(
        `INSERT INTO kai.organizations (organization_id, name, organization_code)
         VALUES ($1::uuid, 'P14-03 cross tenant org', 'p14-03-cross-tenant-org')
         ON CONFLICT (organization_id) DO NOTHING`,
        [OTHER_ORG],
      ),
    );
    await withRunnerOwnedTransaction((tx) => seedEngagementAndDrafts(tx, { engagementId: "14030000-0000-4000-8000-0000000000e7", orgId: OTHER_ORG, draftIds: [otherOrgDraftId] }));

    const repository = makeRepository();
    const seeded = await repository.createGrantResponsePacketExportCandidate(
      { organizationId: ORG, engagementId, actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel: async () => makeRenderModel({ engagementId, draftIds: [draftId] }) },
    );
    assert.equal(seeded.ok, true);

    await assert.rejects(() =>
      withRunnerOwnedTransaction((tx) =>
        tx.query(
          `INSERT INTO kai.grant_response_packet_export_candidate_members (
             grant_response_packet_export_candidate_id, organization_id, generated_content_draft_id, ordinal
           ) VALUES ($1::uuid, $2::uuid, $3::uuid, 1)`,
          [seeded.data.grantResponsePacketExportCandidateId, ORG, otherOrgDraftId],
        ),
      ),
    );
  });

  await test("a member row's candidate_id is never confused with the packet identity id", async () => {
    const engagementId = "14030000-0000-4000-8000-0000000000e8";
    const draftId = "14030000-0000-4000-8000-0000000000d8";
    await withRunnerOwnedTransaction((tx) => seedEngagementAndDrafts(tx, { engagementId, orgId: ORG, draftIds: [draftId] }));

    const repository = makeRepository();
    const result = await repository.createGrantResponsePacketExportCandidate(
      { organizationId: ORG, engagementId, actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel: async () => makeRenderModel({ engagementId, draftIds: [draftId] }) },
    );
    assert.equal(result.ok, true);
    assert.notEqual(result.data.grantResponsePacketExportCandidateId, result.data.grantResponsePacketExportIdentityId);

    const memberRow = await pool.query(
      `SELECT grant_response_packet_export_candidate_id::text AS candidate_id
         FROM kai.grant_response_packet_export_candidate_members
        WHERE grant_response_packet_export_candidate_id = $1::uuid`,
      [result.data.grantResponsePacketExportCandidateId],
    );
    assert.equal(memberRow.rows[0].candidate_id, result.data.grantResponsePacketExportCandidateId);
    assert.notEqual(memberRow.rows[0].candidate_id, result.data.grantResponsePacketExportIdentityId);
  });

  await test("the member table has no exportManifestId column at all", async () => {
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'kai' AND table_name = 'grant_response_packet_export_candidate_members'`,
    );
    const names = columns.rows.map((row) => row.column_name);
    assert.equal(names.includes("export_manifest_id"), false);
    assert.equal(names.includes("export_candidate_id"), false);
  });

  await test("a duplicate member ordinal within a candidate is rejected", async () => {
    const engagementId = "14030000-0000-4000-8000-0000000000e9";
    const draftId = "14030000-0000-4000-8000-0000000000d9";
    const secondDraftId = "14030000-0000-4000-8000-0000000000da";
    await withRunnerOwnedTransaction((tx) =>
      seedEngagementAndDrafts(tx, { engagementId, orgId: ORG, draftIds: [draftId, secondDraftId] }),
    );

    const repository = makeRepository();
    const result = await repository.createGrantResponsePacketExportCandidate(
      { organizationId: ORG, engagementId, actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel: async () => makeRenderModel({ engagementId, draftIds: [draftId] }) },
    );
    assert.equal(result.ok, true);

    await assert.rejects(() =>
      withRunnerOwnedTransaction((tx) =>
        tx.query(
          `INSERT INTO kai.grant_response_packet_export_candidate_members (
             grant_response_packet_export_candidate_id, organization_id, generated_content_draft_id, ordinal
           ) VALUES ($1::uuid, $2::uuid, $3::uuid, 0)`,
          [result.data.grantResponsePacketExportCandidateId, ORG, secondDraftId],
        ),
      ),
    );
  });

  await test("a duplicate (candidate, draft) member is rejected", async () => {
    const engagementId = "14030000-0000-4000-8000-0000000000eb";
    const draftId = "14030000-0000-4000-8000-0000000000db";
    await withRunnerOwnedTransaction((tx) => seedEngagementAndDrafts(tx, { engagementId, orgId: ORG, draftIds: [draftId] }));

    const repository = makeRepository();
    const result = await repository.createGrantResponsePacketExportCandidate(
      { organizationId: ORG, engagementId, actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel: async () => makeRenderModel({ engagementId, draftIds: [draftId] }) },
    );
    assert.equal(result.ok, true);

    await assert.rejects(() =>
      withRunnerOwnedTransaction((tx) =>
        tx.query(
          `INSERT INTO kai.grant_response_packet_export_candidate_members (
             grant_response_packet_export_candidate_id, organization_id, generated_content_draft_id, ordinal
           ) VALUES ($1::uuid, $2::uuid, $3::uuid, 5)`,
          [result.data.grantResponsePacketExportCandidateId, ORG, draftId],
        ),
      ),
    );
  });

  await test("candidate UPDATE/DELETE are rejected at the DB level", async () => {
    const engagementId = "14030000-0000-4000-8000-0000000000ec";
    const draftId = "14030000-0000-4000-8000-0000000000dc";
    await withRunnerOwnedTransaction((tx) => seedEngagementAndDrafts(tx, { engagementId, orgId: ORG, draftIds: [draftId] }));

    const repository = makeRepository();
    const result = await repository.createGrantResponsePacketExportCandidate(
      { organizationId: ORG, engagementId, actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel: async () => makeRenderModel({ engagementId, draftIds: [draftId] }) },
    );
    assert.equal(result.ok, true);

    await assert.rejects(() =>
      pool.query(
        `UPDATE kai.grant_response_packet_export_candidates SET created_by = $1::uuid WHERE grant_response_packet_export_candidate_id = $2::uuid`,
        [ACTOR.actorUserId, result.data.grantResponsePacketExportCandidateId],
      ),
    );
    await assert.rejects(() =>
      pool.query(
        `DELETE FROM kai.grant_response_packet_export_candidates WHERE grant_response_packet_export_candidate_id = $1::uuid`,
        [result.data.grantResponsePacketExportCandidateId],
      ),
    );
  });

  await test("member snapshot UPDATE/DELETE are rejected at the DB level", async () => {
    const engagementId = "14030000-0000-4000-8000-0000000000ed";
    const draftId = "14030000-0000-4000-8000-0000000000dd";
    await withRunnerOwnedTransaction((tx) => seedEngagementAndDrafts(tx, { engagementId, orgId: ORG, draftIds: [draftId] }));

    const repository = makeRepository();
    const result = await repository.createGrantResponsePacketExportCandidate(
      { organizationId: ORG, engagementId, actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel: async () => makeRenderModel({ engagementId, draftIds: [draftId] }) },
    );
    assert.equal(result.ok, true);

    const memberRow = await pool.query(
      `SELECT grant_response_packet_export_candidate_member_id::text AS id
         FROM kai.grant_response_packet_export_candidate_members
        WHERE grant_response_packet_export_candidate_id = $1::uuid`,
      [result.data.grantResponsePacketExportCandidateId],
    );
    const memberId = memberRow.rows[0].id;

    await assert.rejects(() =>
      pool.query(
        `UPDATE kai.grant_response_packet_export_candidate_members SET ordinal = 9 WHERE grant_response_packet_export_candidate_member_id = $1::uuid`,
        [memberId],
      ),
    );
    await assert.rejects(() =>
      pool.query(
        `DELETE FROM kai.grant_response_packet_export_candidate_members WHERE grant_response_packet_export_candidate_member_id = $1::uuid`,
        [memberId],
      ),
    );
  });

  await test("candidate creation creates no rows in any approval/final-release/manifest table", async () => {
    const engagementId = "14030000-0000-4000-8000-0000000000ee";
    const draftId = "14030000-0000-4000-8000-0000000000de";
    await withRunnerOwnedTransaction((tx) => seedEngagementAndDrafts(tx, { engagementId, orgId: ORG, draftIds: [draftId] }));

    const beforeCandidates = await pool.query(`SELECT count(*)::int AS count FROM kai.export_candidates`);
    const beforeManifests = await pool.query(`SELECT count(*)::int AS count FROM kai.export_manifests`);
    const beforeAuthority = await pool.query(`SELECT count(*)::int AS count FROM kai.human_authority_decisions`);

    const repository = makeRepository();
    const result = await repository.createGrantResponsePacketExportCandidate(
      { organizationId: ORG, engagementId, actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel: async () => makeRenderModel({ engagementId, draftIds: [draftId] }) },
    );
    assert.equal(result.ok, true);

    const afterCandidates = await pool.query(`SELECT count(*)::int AS count FROM kai.export_candidates`);
    const afterManifests = await pool.query(`SELECT count(*)::int AS count FROM kai.export_manifests`);
    const afterAuthority = await pool.query(`SELECT count(*)::int AS count FROM kai.human_authority_decisions`);

    assert.equal(afterCandidates.rows[0].count, beforeCandidates.rows[0].count);
    assert.equal(afterManifests.rows[0].count, beforeManifests.rows[0].count);
    assert.equal(afterAuthority.rows[0].count, beforeAuthority.rows[0].count);
  });

  await pool.end();
}
