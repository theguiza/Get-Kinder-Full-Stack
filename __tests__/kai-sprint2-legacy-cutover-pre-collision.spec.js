import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.KAI_LEGACY_CUTOVER_PRE_DATABASE_URL) {
  test("legacy-cutover pre-collision proof requires the runner-owned database", { skip: true }, () => {});
} else {
  await runPreCollisionProof();
}

async function runPreCollisionProof() {
  const { Pool } = await import("pg");
  const { getScopedSourceCandidateByIdentity } = await import("../Backend/kai/db/kaiIntakeQueries.js");

  const DATABASE_URL = process.env.KAI_LEGACY_CUTOVER_PRE_DATABASE_URL;
  const ORG = "00000000-0000-4000-8000-000000000001";
  const LEGACY_CANDIDATE_ID = "9f1e0000-0000-4000-8000-00000000c0c0";

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 4 });
  test.after(async () => {
    await pool.end();
  });

  test("production-shaped legacy kai.intake_source_candidates reproduces the actual undefined_column collision", async () => {
    await assert.rejects(
      () => getScopedSourceCandidateByIdentity(
        { organizationId: ORG, intakeSourceCandidateId: LEGACY_CANDIDATE_ID },
        pool,
      ),
      (error) => {
        assert.equal(error.code, "42703");
        assert.match(error.message, /file_profile_id/);
        return true;
      },
    );
  });

  test("the legacy candidate row itself is present and readable by its own legacy columns", async () => {
    const { rows } = await pool.query(
      `SELECT intake_source_candidate_id, proposed_display_name, proposed_source_type
         FROM kai.intake_source_candidates
        WHERE organization_id = $1 AND intake_source_candidate_id = $2`,
      [ORG, LEGACY_CANDIDATE_ID],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].proposed_display_name, "Legacy synthetic candidate (pre-Sprint2 generation)");
  });
}
