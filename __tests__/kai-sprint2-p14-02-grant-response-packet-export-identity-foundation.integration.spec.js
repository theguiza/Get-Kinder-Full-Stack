// P14-02 GRANT-RESPONSE-PACKET-EXPORT-IDENTITY-FOUNDATION REAL-PERSISTED PROOF
//
// Proves, against a real, runner-owned Postgres database, that the durable
// organizationId + engagementId + packetAudience composite identity
// introduced by
// migrations/kai_sprint2_p14_02_grant_response_packet_export_identity_foundation.sql
// converges deterministically (get-or-create), is tenant-safe, and is
// immutable once minted. This suite does not read or write packet
// membership, drafts, export candidates, export manifests, or any governed
// authority/eligibility state - none of that exists on this table or this
// repository.

import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P14_02_GRANT_RESPONSE_PACKET_EXPORT_IDENTITY_FOUNDATION_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P14-02 grant-response-packet-export-identity-foundation suite refused a non-loopback KAI_P14_02_GRANT_RESPONSE_PACKET_EXPORT_IDENTITY_FOUNDATION_DATABASE_URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P14-02 grant-response-packet-export-identity-foundation integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runGrantResponsePacketExportIdentityFoundationSuite();
}

async function runGrantResponsePacketExportIdentityFoundationSuite() {
  const { Pool } = await import("pg");
  const { createPostgresGrantResponsePacketExportIdentityRepository, loadGrantResponsePacketExportIdentityInTransaction } = await import(
    "../Backend/kai/dictionary/postgresGrantResponsePacketExportIdentityRepository.js"
  );

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const ENGAGEMENT = "14020000-0000-4000-8000-000000000001";
  const ACTOR = { actorType: "human", actorUserId: "00000000-0000-4000-8000-000000000910" };

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

  const repository = createPostgresGrantResponsePacketExportIdentityRepository({ runInTransaction: withRunnerOwnedTransaction });

  await test("get-or-create converges to the same identity on repeated calls", async () => {
    const engagementForThisTest = "14020000-0000-4000-8000-000000000003";
    await withRunnerOwnedTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
         VALUES ($1::uuid, $2::uuid, 'p14-02-convergence-test-engagement')
         ON CONFLICT (engagement_id) DO NOTHING`,
        [engagementForThisTest, ORG],
      );
    });

    const first = await repository.getOrCreateGrantResponsePacketExportIdentity({
      organizationId: ORG,
      engagementId: engagementForThisTest,
      actorContext: ACTOR,
    });
    assert.equal(first.ok, true);
    assert.equal(first.data.created, true);
    assert.equal(first.data.packetAudience, "funder");

    const second = await repository.getOrCreateGrantResponsePacketExportIdentity({
      organizationId: ORG,
      engagementId: engagementForThisTest,
      actorContext: ACTOR,
    });
    assert.equal(second.ok, true);
    assert.equal(second.data.created, false);
    assert.equal(second.data.grantResponsePacketExportIdentityId, first.data.grantResponsePacketExportIdentityId);
  });

  await test("a fabricated engagementId is rejected", async () => {
    const result = await repository.getOrCreateGrantResponsePacketExportIdentity({
      organizationId: ORG,
      engagementId: "99999999-0000-4000-8000-000000000001",
      actorContext: ACTOR,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
  });

  await test("an engagement belonging to a different organization is rejected", async () => {
    const result = await repository.getOrCreateGrantResponsePacketExportIdentity({
      organizationId: OTHER_ORG,
      engagementId: ENGAGEMENT,
      actorContext: ACTOR,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
  });

  await test("loadGrantResponsePacketExportIdentityInTransaction is read-only and never mints a row", async () => {
    const freshEngagement = "14020000-0000-4000-8000-000000000002";
    await withRunnerOwnedTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
         VALUES ($1::uuid, $2::uuid, 'p14-02-second-smoke-engagement')
         ON CONFLICT (engagement_id) DO NOTHING`,
        [freshEngagement, ORG],
      );
    });

    await withRunnerOwnedTransaction(async (tx) => {
      const before = await loadGrantResponsePacketExportIdentityInTransaction(tx, {
        organizationId: ORG,
        engagementId: freshEngagement,
      });
      assert.equal(before.grantResponsePacketExportIdentityId, null);
    });

    const created = await repository.getOrCreateGrantResponsePacketExportIdentity({
      organizationId: ORG,
      engagementId: freshEngagement,
      actorContext: ACTOR,
    });
    assert.equal(created.ok, true);

    await withRunnerOwnedTransaction(async (tx) => {
      const after = await loadGrantResponsePacketExportIdentityInTransaction(tx, {
        organizationId: ORG,
        engagementId: freshEngagement,
      });
      assert.equal(after.grantResponsePacketExportIdentityId, created.data.grantResponsePacketExportIdentityId);
    });
  });

  await test("an existing identity row is immutable", async () => {
    const existing = await repository.getOrCreateGrantResponsePacketExportIdentity({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      actorContext: ACTOR,
    });
    assert.equal(existing.ok, true);

    await assert.rejects(() =>
      withRunnerOwnedTransaction((tx) =>
        tx.query(
          `UPDATE kai.grant_response_packet_export_identities SET created_by = $1::uuid WHERE grant_response_packet_export_identity_id = $2::uuid`,
          [ACTOR.actorUserId, existing.data.grantResponsePacketExportIdentityId],
        ),
      ),
    );

    await assert.rejects(() =>
      withRunnerOwnedTransaction((tx) =>
        tx.query(
          `DELETE FROM kai.grant_response_packet_export_identities WHERE grant_response_packet_export_identity_id = $1::uuid`,
          [existing.data.grantResponsePacketExportIdentityId],
        ),
      ),
    );
  });

  await pool.end();
}
