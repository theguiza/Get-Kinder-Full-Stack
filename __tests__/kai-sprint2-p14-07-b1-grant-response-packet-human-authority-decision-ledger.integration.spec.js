import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P14_07B1_GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P14-07B1 integration suite refused a non-loopback KAI_P14_07B1_GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P14-07B1 grant-response-packet-human-authority-decision-ledger integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const {
    createPostgresGrantResponsePacketHumanAuthorityDecisionRepository,
  } = await import("../Backend/kai/dictionary/postgresGrantResponsePacketHumanAuthorityDecisionRepository.js");
  const {
    composeGrantResponsePacketExportCandidateFingerprint,
  } = await import("../Backend/kai/services/kaiGrantResponsePacketExportCandidateFingerprintService.js");
  const {
    GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_FINGERPRINT_CONTRACT_VERSION,
  } = await import("../Backend/kai/dictionary/grantResponsePacketExportCandidateContract.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const ENGAGEMENT = "14030000-0000-4000-8000-000000000001";
  const NOW = "2026-09-09T10:00:00.000Z";
  const LATER = "2026-09-09T10:05:00.000Z";
  const EVEN_LATER = "2026-09-09T10:10:00.000Z";

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 10 });

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

  async function query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  }

  function auditRecorder() {
    const published = [];
    return {
      published,
      metadataOnlyAudit: {
        prepareMetadataOnlyAudit({ payload }) {
          return {
            ok: true,
            async publish() {
              published.push(payload);
            },
          };
        },
      },
    };
  }

  function gkAdmin(id, memberships) {
    return {
      actorType: "human",
      actorUserId: id,
      organizationMemberships: memberships,
    };
  }

  function renderModelFor({ engagementId, seed, draftId }) {
    return {
      organizationId: ORG,
      engagementId,
      packetAudience: "funder",
      members: [
        {
          generatedContentDraftId: draftId,
          contentType: "evidence_summary",
          requestedAudience: "funder",
          draftStatus: "draft",
          currentUseEligible: true,
          blocks: [{ ordinal: 0, generatedContentBlockId: seed, citations: [] }],
        },
      ],
    };
  }

  const repository = createPostgresGrantResponsePacketHumanAuthorityDecisionRepository({ runInTransaction: withRunnerOwnedTransaction });

  let seedCounter = 0;
  function uuidFor(prefixDigit, n) {
    return `14070000-0000-4000-8000-${prefixDigit}${String(n).padStart(11, "0")}`;
  }
  async function seedCandidate({ organizationId = ORG, engagementId = ENGAGEMENT, renderModel }) {
    seedCounter += 1;
    const identityId = uuidFor("1", seedCounter);
    const candidateId = uuidFor("2", seedCounter);

    await query(
      `INSERT INTO kai.grant_response_packet_export_identities (
         grant_response_packet_export_identity_id, organization_id, engagement_id, packet_audience, created_by
       )
       VALUES ($1::uuid,$2::uuid,$3::uuid,'funder',$4::uuid)
       ON CONFLICT (organization_id, engagement_id, packet_audience) DO NOTHING`,
      [identityId, organizationId, engagementId, "00000000-0000-4000-8000-000000000901"],
    );
    const identityRows = await query(
      `SELECT grant_response_packet_export_identity_id::text AS id
         FROM kai.grant_response_packet_export_identities
        WHERE organization_id = $1::uuid AND engagement_id = $2::uuid AND packet_audience = 'funder'`,
      [organizationId, engagementId],
    );
    const resolvedIdentityId = identityRows[0].id;

    const { fingerprint } = composeGrantResponsePacketExportCandidateFingerprint(renderModel);
    assert.ok(fingerprint, "test render model must produce a real fingerprint");

    await query(
      `INSERT INTO kai.grant_response_packet_export_candidates (
         grant_response_packet_export_candidate_id, organization_id, grant_response_packet_export_identity_id,
         fingerprint_contract_version, canonical_fingerprint, created_by
       )
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid)
       ON CONFLICT (organization_id, grant_response_packet_export_identity_id, canonical_fingerprint) DO NOTHING`,
      [candidateId, organizationId, resolvedIdentityId, GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_FINGERPRINT_CONTRACT_VERSION, fingerprint, "00000000-0000-4000-8000-000000000901"],
    );
    const candidateRows = await query(
      `SELECT grant_response_packet_export_candidate_id::text AS id
         FROM kai.grant_response_packet_export_candidates
        WHERE organization_id = $1::uuid AND grant_response_packet_export_identity_id = $2::uuid AND canonical_fingerprint = $3`,
      [organizationId, resolvedIdentityId, fingerprint],
    );
    return { candidateId: candidateRows[0].id, fingerprint };
  }

  await query(
    `INSERT INTO kai.organizations (organization_id, name, organization_code)
     VALUES ($1::uuid, 'P14-07B1 Integration Org', 'p14-07b1-integration-org')
     ON CONFLICT (organization_id) DO NOTHING`,
    [ORG],
  );
  await query(
    `INSERT INTO kai.organizations (organization_id, name, organization_code)
     VALUES ($1::uuid, 'P14-07B1 Integration Other Org', 'p14-07b1-integration-other-org')
     ON CONFLICT (organization_id) DO NOTHING`,
    [OTHER_ORG],
  );
  await query(
    `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
     VALUES ($1::uuid, $2::uuid, 'p14-07b1-integration-engagement')
     ON CONFLICT (engagement_id) DO NOTHING`,
    [ENGAGEMENT, ORG],
  );

  const actor = gkAdmin("90000000-0000-4000-8000-000000000015", [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
    { organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_admin" },
  ]);

  test("P14-07B1 grant is persisted, effective, and discoverable", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-000000000001", draftId: "aaaaaaaa-0000-4000-8000-000000000101" });
    const { candidateId } = await seedCandidate({ renderModel });
    const audit = auditRecorder();

    const result = await repository.recordDecision(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        grantResponsePacketExportCandidateId: candidateId,
        decisionType: "export_authority_granted",
        decisionAction: "grant",
        actorContext: actor,
        now: NOW,
      },
      { ...audit, composeRenderModel: async () => ({ ok: true, data: renderModel }) },
    );

    assert.equal(result.ok, true);
    assert.equal(result.data.replayed, false);
    assert.equal(result.data.effective, true);
    assert.equal(result.data.decidedByRole, "gk_admin");
    assert.equal(audit.published.length, 1);
    assert.equal(audit.published[0].decision_action, "grant");

    const effectiveness = await repository.evaluateEffectiveness(
      { organizationId: ORG, engagementId: ENGAGEMENT, grantResponsePacketExportCandidateId: candidateId, decisionType: "export_authority_granted", actorContext: actor },
      { composeRenderModel: async () => ({ ok: true, data: renderModel }) },
    );
    assert.equal(effectiveness.ok, true);
    assert.equal(effectiveness.data.effective, true);
  });

  test("P14-07B1 replaying the same grant is idempotent - no new row, no new audit", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-000000000002", draftId: "aaaaaaaa-0000-4000-8000-000000000102" });
    const { candidateId } = await seedCandidate({ renderModel });
    const audit = auditRecorder();
    const input = {
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      grantResponsePacketExportCandidateId: candidateId,
      decisionType: "export_authority_granted",
      decisionAction: "grant",
      actorContext: actor,
    };
    const deps = { ...audit, composeRenderModel: async () => ({ ok: true, data: renderModel }) };

    const first = await repository.recordDecision({ ...input, now: NOW }, deps);
    assert.equal(first.data.replayed, false);
    const second = await repository.recordDecision({ ...input, now: LATER }, deps);
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.decisionId, first.data.decisionId);

    const rows = await query(
      `SELECT decision_id FROM kai.grant_response_packet_human_authority_decisions WHERE grant_response_packet_export_candidate_id = $1::uuid`,
      [candidateId],
    );
    assert.equal(rows.length, 1);
    assert.equal(audit.published.length, 1);
  });

  test("P14-07B1 revoke supersedes grant and becomes ineffective; the old grant row is never mutated", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-000000000003", draftId: "aaaaaaaa-0000-4000-8000-000000000103" });
    const { candidateId } = await seedCandidate({ renderModel });
    const audit = auditRecorder();
    const deps = { ...audit, composeRenderModel: async () => ({ ok: true, data: renderModel }) };
    const base = {
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      grantResponsePacketExportCandidateId: candidateId,
      decisionType: "export_authority_granted",
      actorContext: actor,
    };

    const granted = await repository.recordDecision({ ...base, decisionAction: "grant", now: NOW }, deps);
    const revoked = await repository.recordDecision({ ...base, decisionAction: "revoke", now: LATER }, deps);
    assert.equal(revoked.data.replayed, false);
    assert.equal(revoked.data.effective, false);
    assert.equal(revoked.data.supersedesDecisionId, granted.data.decisionId);

    const oldRow = await query(
      `SELECT decision_action FROM kai.grant_response_packet_human_authority_decisions WHERE decision_id = $1::uuid`,
      [granted.data.decisionId],
    );
    assert.equal(oldRow[0].decision_action, "grant");

    const effectiveness = await repository.evaluateEffectiveness(
      { organizationId: ORG, engagementId: ENGAGEMENT, grantResponsePacketExportCandidateId: candidateId, decisionType: "export_authority_granted", actorContext: actor },
      { composeRenderModel: async () => ({ ok: true, data: renderModel }) },
    );
    assert.equal(effectiveness.data.effective, false);
    assert.equal(effectiveness.data.reason, "head_is_revoke");

    const regranted = await repository.recordDecision({ ...base, decisionAction: "grant", now: EVEN_LATER }, deps);
    assert.equal(regranted.data.replayed, false);
    assert.equal(regranted.data.effective, true);
    assert.equal(regranted.data.supersedesDecisionId, revoked.data.decisionId);
  });

  test("P14-07B1 a root revoke (no prior grant) is rejected", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-000000000004", draftId: "aaaaaaaa-0000-4000-8000-000000000104" });
    const { candidateId } = await seedCandidate({ renderModel });
    const audit = auditRecorder();
    const result = await repository.recordDecision(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        grantResponsePacketExportCandidateId: candidateId,
        decisionType: "export_authority_granted",
        decisionAction: "revoke",
        actorContext: actor,
        now: NOW,
      },
      { ...audit, composeRenderModel: async () => ({ ok: true, data: renderModel }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(audit.published.length, 0);
  });

  test("P14-07B1 a stale/superseded candidate (recomposed fingerprint no longer matches) cannot be granted, and candidate A's decision never authorizes candidate B", async () => {
    const renderModelA = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-000000000005", draftId: "aaaaaaaa-0000-4000-8000-000000000105" });
    const { candidateId: candidateA } = await seedCandidate({ renderModel: renderModelA });
    const renderModelB = renderModelFor({ engagementId: ENGAGEMENT, seed: "bbbbbbbb-0000-4000-8000-000000000005", draftId: "bbbbbbbb-0000-4000-8000-000000000105" });
    const { candidateId: candidateB } = await seedCandidate({ renderModel: renderModelB });
    const audit = auditRecorder();

    // The current authoritative packet state now recomposes to candidate B's
    // fingerprint, not candidate A's - candidate A is a stale/superseded id.
    const staleResult = await repository.recordDecision(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        grantResponsePacketExportCandidateId: candidateA,
        decisionType: "export_authority_granted",
        decisionAction: "grant",
        actorContext: actor,
        now: NOW,
      },
      { ...audit, composeRenderModel: async () => ({ ok: true, data: renderModelB }) },
    );
    assert.equal(staleResult.ok, false);
    assert.equal(staleResult.error.code, "conflict_current_state_changed");
    assert.equal(audit.published.length, 0);

    // A genuine grant on candidate B (its own current fingerprint) succeeds
    // and creates no decision row visible to candidate A.
    const grantedB = await repository.recordDecision(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        grantResponsePacketExportCandidateId: candidateB,
        decisionType: "export_authority_granted",
        decisionAction: "grant",
        actorContext: actor,
        now: NOW,
      },
      { ...audit, composeRenderModel: async () => ({ ok: true, data: renderModelB }) },
    );
    assert.equal(grantedB.ok, true);

    const candidateARows = await query(
      `SELECT 1 FROM kai.grant_response_packet_human_authority_decisions WHERE grant_response_packet_export_candidate_id = $1::uuid`,
      [candidateA],
    );
    assert.equal(candidateARows.length, 0);
  });

  test("P14-07B1 a nonexistent packet candidate id is rejected as not_found - never resolved via latest/newest selection", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "cccccccc-0000-4000-8000-000000000006", draftId: "cccccccc-0000-4000-8000-000000000106" });
    const audit = auditRecorder();
    const result = await repository.recordDecision(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        grantResponsePacketExportCandidateId: "00000000-0000-4000-8000-0000000000ee",
        decisionType: "export_authority_granted",
        decisionAction: "grant",
        actorContext: actor,
        now: NOW,
      },
      { ...audit, composeRenderModel: async () => ({ ok: true, data: renderModel }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P14-07B1 a candidate from another organization is rejected as not_found (cross-tenant/wrong-organization)", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "dddddddd-0000-4000-8000-000000000007", draftId: "dddddddd-0000-4000-8000-000000000107" });
    const { candidateId } = await seedCandidate({ renderModel });
    const audit = auditRecorder();
    const result = await repository.recordDecision(
      {
        organizationId: OTHER_ORG,
        engagementId: ENGAGEMENT,
        grantResponsePacketExportCandidateId: candidateId,
        decisionType: "export_authority_granted",
        decisionAction: "grant",
        actorContext: actor,
        now: NOW,
      },
      { ...audit, composeRenderModel: async () => ({ ok: true, data: renderModel }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P14-07B1 a candidate whose packet identity belongs to a different engagement is rejected as not_found", async () => {
    const otherEngagement = "14070000-0000-4000-8000-000000009999";
    await query(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
       VALUES ($1::uuid, $2::uuid, 'p14-07b1-integration-other-engagement')
       ON CONFLICT (engagement_id) DO NOTHING`,
      [otherEngagement, ORG],
    );
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "eeeeeeee-0000-4000-8000-000000000008", draftId: "eeeeeeee-0000-4000-8000-000000000108" });
    const { candidateId } = await seedCandidate({ renderModel });
    const audit = auditRecorder();
    const result = await repository.recordDecision(
      {
        organizationId: ORG,
        engagementId: otherEngagement,
        grantResponsePacketExportCandidateId: candidateId,
        decisionType: "export_authority_granted",
        decisionAction: "grant",
        actorContext: actor,
        now: NOW,
      },
      { ...audit, composeRenderModel: async () => ({ ok: true, data: renderModel }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P14-07B1 client-supplied fingerprint/effectiveness/audience fields are refused by the exact input contract - a client can never manufacture a grant", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "ffffffff-0000-4000-8000-000000000009", draftId: "ffffffff-0000-4000-8000-000000000109" });
    const { candidateId } = await seedCandidate({ renderModel });
    const audit = auditRecorder();
    const result = await repository.recordDecision(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        grantResponsePacketExportCandidateId: candidateId,
        decisionType: "export_authority_granted",
        decisionAction: "grant",
        actorContext: actor,
        now: NOW,
        canonicalFingerprint: "f".repeat(64),
        effective: true,
        requestedAudience: "funder",
      },
      { ...audit, composeRenderModel: async () => ({ ok: true, data: renderModel }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
  });

  test("P14-07B1 this package creates no final-eligibility state, no packet manifest table, and no packet bytes", async () => {
    const manifestTable = await query(`SELECT to_regclass('kai.grant_response_packet_export_manifests') AS reg`);
    assert.equal(manifestTable[0].reg, null);
    const eligibilityTable = await query(`SELECT to_regclass('kai.grant_response_packet_final_eligibility') AS reg`);
    assert.equal(eligibilityTable[0].reg, null);
  });

  test.after(async () => {
    await pool.end();
  });
}
