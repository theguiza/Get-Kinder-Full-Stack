import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P14_08A_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_FOUNDATION_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P14-08A integration suite refused a non-loopback KAI_P14_08A_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_FOUNDATION_DATABASE_URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P14-08A grant-response-packet-export-manifest-foundation integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const {
    createPostgresGrantResponsePacketExportManifestRepository,
  } = await import("../Backend/kai/dictionary/postgresGrantResponsePacketExportManifestRepository.js");
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
    return { actorType: "human", actorUserId: id, organizationMemberships: memberships };
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

  const manifestRepository = createPostgresGrantResponsePacketExportManifestRepository({ runInTransaction: withRunnerOwnedTransaction });
  const authorityRepository = createPostgresGrantResponsePacketHumanAuthorityDecisionRepository({ runInTransaction: withRunnerOwnedTransaction });

  function eligiblePasser() {
    return async () => ({ ok: true, data: { finalExportEligible: true }, error: null });
  }
  function eligibilityBlocker() {
    return async () => ({ ok: true, data: { finalExportEligible: false }, error: null });
  }
  function eligibilityNotFound() {
    return async () => ({ ok: false, data: null, error: { code: "not_found", status: 404 } });
  }
  // The real authorityRepository.evaluateEffectiveness's own default
  // composeRenderModel opens real render-model connections; tests supply the
  // exact same fake render model used to grant authority, mirroring how
  // grantAuthority() already does for recordDecision.
  function authorityEffectivenessDependencies(renderModel) {
    return { composeRenderModel: async () => ({ ok: true, data: renderModel }) };
  }

  let seedCounter = 0;
  function uuidFor(prefixDigit, n) {
    return `14080000-0000-4000-8000-${prefixDigit}${String(n).padStart(11, "0")}`;
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
    return { candidateId: candidateRows[0].id, fingerprint, renderModel };
  }

  async function grantAuthority(candidateId, renderModel, now = NOW) {
    const audit = auditRecorder();
    const result = await authorityRepository.recordDecision(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        grantResponsePacketExportCandidateId: candidateId,
        decisionType: "export_authority_granted",
        decisionAction: "grant",
        actorContext: actor,
        now,
      },
      { ...audit, composeRenderModel: async () => ({ ok: true, data: renderModel }) },
    );
    assert.equal(result.ok, true);
    return result.data;
  }

  await query(
    `INSERT INTO kai.organizations (organization_id, name, organization_code)
     VALUES ($1::uuid, 'P14-08A Integration Org', 'p14-08a-integration-org')
     ON CONFLICT (organization_id) DO NOTHING`,
    [ORG],
  );
  await query(
    `INSERT INTO kai.organizations (organization_id, name, organization_code)
     VALUES ($1::uuid, 'P14-08A Integration Other Org', 'p14-08a-integration-other-org')
     ON CONFLICT (organization_id) DO NOTHING`,
    [OTHER_ORG],
  );
  await query(
    `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
     VALUES ($1::uuid, $2::uuid, 'p14-08a-integration-engagement')
     ON CONFLICT (engagement_id) DO NOTHING`,
    [ENGAGEMENT, ORG],
  );

  const actor = gkAdmin("90000000-0000-4000-8000-000000000015", [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
    { organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_admin" },
  ]);

  test("P14-08A eligible + effective candidate: create-or-reuse succeeds, is discoverable by id, and appears in candidate history", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-000000000001", draftId: "aaaaaaaa-0000-4000-8000-000000000101" });
    const { candidateId } = await seedCandidate({ renderModel });
    await grantAuthority(candidateId, renderModel);
    const audit = auditRecorder();

    const result = await manifestRepository.createExportManifest(
      { organizationId: ORG, engagementId: ENGAGEMENT, grantResponsePacketExportCandidateId: candidateId, actorContext: actor, now: NOW },
      { ...audit, evaluateEligibility: eligiblePasser(), authorityRepository, authorityEffectivenessDependencies: authorityEffectivenessDependencies(renderModel) },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.replayed, false);
    assert.equal(result.data.grantResponsePacketExportCandidateId, candidateId);
    assert.equal(audit.published.length, 1);

    const read = await manifestRepository.readExportManifestById({ organizationId: ORG, grantResponsePacketExportManifestId: result.data.grantResponsePacketExportManifestId });
    assert.equal(read.ok, true);
    assert.equal(read.data.grantResponsePacketExportCandidateId, candidateId);

    const history = await manifestRepository.resolveExportManifestStateForCandidate({ organizationId: ORG, grantResponsePacketExportCandidateId: candidateId });
    assert.equal(history.ok, true);
    assert.equal(history.data.manifests.length, 1);
    assert.equal(history.data.manifests[0].grantResponsePacketExportManifestId, result.data.grantResponsePacketExportManifestId);
  });

  test("P14-08A replay for the same exact eligible candidate converges to exactly one row and publishes no additional audit", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-000000000002", draftId: "aaaaaaaa-0000-4000-8000-000000000102" });
    const { candidateId } = await seedCandidate({ renderModel });
    await grantAuthority(candidateId, renderModel);
    const audit = auditRecorder();
    const input = { organizationId: ORG, engagementId: ENGAGEMENT, grantResponsePacketExportCandidateId: candidateId, actorContext: actor };
    const deps = { ...audit, evaluateEligibility: eligiblePasser(), authorityRepository, authorityEffectivenessDependencies: authorityEffectivenessDependencies(renderModel) };

    const first = await manifestRepository.createExportManifest({ ...input, now: NOW }, deps);
    assert.equal(first.data.replayed, false);
    const second = await manifestRepository.createExportManifest({ ...input, now: LATER }, deps);
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.grantResponsePacketExportManifestId, first.data.grantResponsePacketExportManifestId);

    const rows = await query(
      `SELECT grant_response_packet_export_manifest_id FROM kai.grant_response_packet_export_manifests WHERE grant_response_packet_export_candidate_id = $1::uuid`,
      [candidateId],
    );
    assert.equal(rows.length, 1);
    assert.equal(audit.published.length, 1);
  });

  test("P14-08A eligibility BLOCKED (finalExportEligible false) creates no manifest", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-000000000003", draftId: "aaaaaaaa-0000-4000-8000-000000000103" });
    const { candidateId } = await seedCandidate({ renderModel });
    await grantAuthority(candidateId, renderModel);
    const audit = auditRecorder();

    const result = await manifestRepository.createExportManifest(
      { organizationId: ORG, engagementId: ENGAGEMENT, grantResponsePacketExportCandidateId: candidateId, actorContext: actor, now: NOW },
      { ...audit, evaluateEligibility: eligibilityBlocker(), authorityRepository, authorityEffectivenessDependencies: authorityEffectivenessDependencies(renderModel) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    const rows = await query(
      `SELECT 1 FROM kai.grant_response_packet_export_manifests WHERE grant_response_packet_export_candidate_id = $1::uuid`,
      [candidateId],
    );
    assert.equal(rows.length, 0);
    assert.equal(audit.published.length, 0);
  });

  test("P14-08A no authority decision (never granted) creates no manifest even if eligibility somehow passed", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-000000000004", draftId: "aaaaaaaa-0000-4000-8000-000000000104" });
    const { candidateId } = await seedCandidate({ renderModel });
    const audit = auditRecorder();

    const result = await manifestRepository.createExportManifest(
      { organizationId: ORG, engagementId: ENGAGEMENT, grantResponsePacketExportCandidateId: candidateId, actorContext: actor, now: NOW },
      { ...audit, evaluateEligibility: eligiblePasser(), authorityRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
  });

  test("P14-08A revoked authority creates no manifest", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-000000000005", draftId: "aaaaaaaa-0000-4000-8000-000000000105" });
    const { candidateId } = await seedCandidate({ renderModel });
    await grantAuthority(candidateId, renderModel, NOW);
    const revokeAudit = auditRecorder();
    const revoked = await authorityRepository.recordDecision(
      { organizationId: ORG, engagementId: ENGAGEMENT, grantResponsePacketExportCandidateId: candidateId, decisionType: "export_authority_granted", decisionAction: "revoke", actorContext: actor, now: LATER },
      { ...revokeAudit, composeRenderModel: async () => ({ ok: true, data: renderModel }) },
    );
    assert.equal(revoked.ok, true);
    assert.equal(revoked.data.effective, false);

    const audit = auditRecorder();
    const result = await manifestRepository.createExportManifest(
      { organizationId: ORG, engagementId: ENGAGEMENT, grantResponsePacketExportCandidateId: candidateId, actorContext: actor, now: LATER },
      { ...audit, evaluateEligibility: eligiblePasser(), authorityRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
  });

  test("P14-08A candidate A's manifest can never represent candidate B - independent candidates converge to independent manifest rows", async () => {
    const renderModelA = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-000000000006", draftId: "aaaaaaaa-0000-4000-8000-000000000106" });
    const { candidateId: candidateA } = await seedCandidate({ renderModel: renderModelA });
    await grantAuthority(candidateA, renderModelA);

    const renderModelB = renderModelFor({ engagementId: ENGAGEMENT, seed: "bbbbbbbb-0000-4000-8000-000000000006", draftId: "bbbbbbbb-0000-4000-8000-000000000106" });
    const { candidateId: candidateB } = await seedCandidate({ renderModel: renderModelB });
    await grantAuthority(candidateB, renderModelB);

    const auditA = auditRecorder();
    const resultA = await manifestRepository.createExportManifest(
      { organizationId: ORG, engagementId: ENGAGEMENT, grantResponsePacketExportCandidateId: candidateA, actorContext: actor, now: NOW },
      { ...auditA, evaluateEligibility: eligiblePasser(), authorityRepository, authorityEffectivenessDependencies: authorityEffectivenessDependencies(renderModelA) },
    );
    assert.equal(resultA.ok, true);

    const historyB = await manifestRepository.resolveExportManifestStateForCandidate({ organizationId: ORG, grantResponsePacketExportCandidateId: candidateB });
    assert.equal(historyB.ok, true);
    assert.equal(historyB.data.manifests.length, 0, "candidate A's manifest creates no manifest row for candidate B");

    const readAsB = await manifestRepository.readExportManifestById({ organizationId: ORG, grantResponsePacketExportManifestId: resultA.data.grantResponsePacketExportManifestId });
    assert.equal(readAsB.data.grantResponsePacketExportCandidateId, candidateA);
    assert.notEqual(readAsB.data.grantResponsePacketExportCandidateId, candidateB);
  });

  test("P14-08A a nonexistent packet candidate id is rejected as not_found", async () => {
    const audit = auditRecorder();
    const result = await manifestRepository.createExportManifest(
      { organizationId: ORG, engagementId: ENGAGEMENT, grantResponsePacketExportCandidateId: "00000000-0000-4000-8000-0000000000ee", actorContext: actor, now: NOW },
      { ...audit, evaluateEligibility: eligibilityNotFound(), authorityRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P14-08A a candidate from another organization is rejected as not_found (cross-tenant)", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-000000000007", draftId: "aaaaaaaa-0000-4000-8000-000000000107" });
    const { candidateId } = await seedCandidate({ renderModel });
    await grantAuthority(candidateId, renderModel);
    const audit = auditRecorder();
    const result = await manifestRepository.createExportManifest(
      { organizationId: OTHER_ORG, engagementId: ENGAGEMENT, grantResponsePacketExportCandidateId: candidateId, actorContext: actor, now: NOW },
      { ...audit, evaluateEligibility: eligibilityNotFound(), authorityRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P14-08A a candidate whose packet identity belongs to a different engagement is rejected as not_found", async () => {
    const otherEngagement = "14080000-0000-4000-8000-000000009999";
    await query(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
       VALUES ($1::uuid, $2::uuid, 'p14-08a-integration-other-engagement')
       ON CONFLICT (engagement_id) DO NOTHING`,
      [otherEngagement, ORG],
    );
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-000000000008", draftId: "aaaaaaaa-0000-4000-8000-000000000108" });
    const { candidateId } = await seedCandidate({ renderModel });
    await grantAuthority(candidateId, renderModel);
    const audit = auditRecorder();
    const result = await manifestRepository.createExportManifest(
      { organizationId: ORG, engagementId: otherEngagement, grantResponsePacketExportCandidateId: candidateId, actorContext: actor, now: NOW },
      { ...audit, evaluateEligibility: eligiblePasser(), authorityRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P14-08A client-supplied eligibility/fingerprint/member/manifest-identity fields are refused by the exact input contract", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-000000000009", draftId: "aaaaaaaa-0000-4000-8000-000000000109" });
    const { candidateId } = await seedCandidate({ renderModel });
    await grantAuthority(candidateId, renderModel);
    const audit = auditRecorder();
    const result = await manifestRepository.createExportManifest(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        grantResponsePacketExportCandidateId: candidateId,
        actorContext: actor,
        now: NOW,
        finalExportEligible: true,
        canonicalFingerprint: "f".repeat(64),
        members: [],
        grantResponsePacketExportManifestId: "14080000-0000-4000-8000-000000000999",
      },
      { ...audit, evaluateEligibility: eligiblePasser(), authorityRepository },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
  });

  test("P14-08A manifest creation returns metadata only - no final artifact bytes, no external publication", async () => {
    const renderModel = renderModelFor({ engagementId: ENGAGEMENT, seed: "aaaaaaaa-0000-4000-8000-00000000000a", draftId: "aaaaaaaa-0000-4000-8000-00000000010a" });
    const { candidateId } = await seedCandidate({ renderModel });
    await grantAuthority(candidateId, renderModel);
    const audit = auditRecorder();
    const result = await manifestRepository.createExportManifest(
      { organizationId: ORG, engagementId: ENGAGEMENT, grantResponsePacketExportCandidateId: candidateId, actorContext: actor, now: NOW },
      { ...audit, evaluateEligibility: eligiblePasser(), authorityRepository, authorityEffectivenessDependencies: authorityEffectivenessDependencies(renderModel) },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(
      Object.keys(result.data).sort(),
      ["canonicalFingerprint", "effectiveAuthorityDecisionId", "fingerprintContractVersion", "grantResponsePacketExportCandidateId", "grantResponsePacketExportManifestId", "replayed"],
    );
    assert.equal(audit.published.length, 1);
    assert.equal(audit.published[0].contains_raw_file_content, undefined);
  });

  test.after(async () => {
    await pool.end();
  });
}
