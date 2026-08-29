import test from "node:test";
import assert from "node:assert/strict";

import {
  findIntakeFileReservationByChecksum,
  getScopedIntakeFileSecurityAssessmentFacts,
  listActionableKaiP1WorkCandidates,
} from "../Backend/kai/db/kaiIntakeQueries.js";
import { getIntakeFileUploadMetadata } from "../Backend/kai/db/kaiReadModels.js";

function factsRow(overrides = {}) {
  return {
    organization_id: "a5d17c5a-c55f-43af-9b21-fe63aafe733f",
    intake_file_id: "9fe568b1-5c05-4c42-bb1f-6e20de216c7b",
    intake_batch_id: "8e426ea1-2be3-4e48-b80f-9783ddbacda0",
    engagement_id: null,
    object_version_id: "ov_18c0a1c5a81642958cee3f3973673451",
    verified_checksum: "40d8e54df6ebeebb58b77188ec2d06e3eb77a2fceeaf1c836cb1c86d9d20afbc",
    verified_size_bytes: "57",
    mime_type: "text/csv",
    file_extension: ".csv",
    file_policy_status: "pending",
    storage_provider: "gcs",
    storage_object_key: "kai/intake/some-object-key",
    ...overrides,
  };
}

async function readFactsWithRow(row) {
  return getScopedIntakeFileSecurityAssessmentFacts(
    { organizationId: row.organization_id, intakeFileId: row.intake_file_id },
    { async query() { return { rows: [row] }; } },
  );
}

test("Gate C facts read normalizes a canonical PostgreSQL bigint string verified_size_bytes to a JS number", async () => {
  const row = factsRow({ verified_size_bytes: "57" });
  const result = await readFactsWithRow(row);
  assert.equal(result.verified_size_bytes, 57);
  assert.equal(typeof result.verified_size_bytes, "number");
});

test("Gate C facts read leaves every other fact byte-for-byte unchanged", async () => {
  const row = factsRow();
  const result = await readFactsWithRow(row);
  assert.equal(result.object_version_id, row.object_version_id);
  assert.equal(result.verified_checksum, row.verified_checksum);
  assert.equal(result.mime_type, row.mime_type);
  assert.equal(result.file_extension, row.file_extension);
  assert.equal(result.organization_id, row.organization_id);
  assert.equal(result.intake_file_id, row.intake_file_id);
  assert.equal(result.file_policy_status, row.file_policy_status);
});

test("Gate C facts read leaves a malformed verified_size_bytes string untouched (fail-closed)", async () => {
  const row = factsRow({ verified_size_bytes: "57abc" });
  const result = await readFactsWithRow(row);
  assert.equal(result.verified_size_bytes, "57abc");
});

test("Gate C facts read leaves a noncanonical zero-padded verified_size_bytes string untouched (fail-closed)", async () => {
  const row = factsRow({ verified_size_bytes: "057" });
  const result = await readFactsWithRow(row);
  assert.equal(result.verified_size_bytes, "057");
});

test("Gate C facts read leaves a verified_size_bytes value outside Number.MAX_SAFE_INTEGER untouched (fail-closed)", async () => {
  const outOfRange = "9007199254740993";
  const row = factsRow({ verified_size_bytes: outOfRange });
  const result = await readFactsWithRow(row);
  assert.equal(result.verified_size_bytes, outOfRange);
  assert.equal(typeof result.verified_size_bytes, "string");
});

test("Gate C facts read leaves a null verified_size_bytes untouched (fail-closed)", async () => {
  const row = factsRow({ verified_size_bytes: null });
  const result = await readFactsWithRow(row);
  assert.equal(result.verified_size_bytes, null);
});

test("Gate C facts read converts a canonical negative bigint string, still leaving it out-of-contract for the caller's validator", async () => {
  const row = factsRow({ verified_size_bytes: "-5" });
  const result = await readFactsWithRow(row);
  assert.equal(result.verified_size_bytes, -5);
  assert.equal(typeof result.verified_size_bytes, "number");
});

test("Gate C facts read returns null unchanged when no row matches", async () => {
  const result = await getScopedIntakeFileSecurityAssessmentFacts(
    { organizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f", intakeFileId: "9fe568b1-5c05-4c42-bb1f-6e20de216c7b" },
    { async query() { return { rows: [] }; } },
  );
  assert.equal(result, null);
});

test("declared checksum duplicate lookup matches the existing organization checksum index contract", async () => {
  const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
  const checksum = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  let queryText = null;
  let queryParams = null;
  const expected = { intake_file_id: "9fe568b1-5c05-4c42-bb1f-6e20de216c7b", checksum };

  const result = await findIntakeFileReservationByChecksum(
    { organizationId, checksum },
    {
      async query(text, params) {
        queryText = text;
        queryParams = params;
        return { rows: [expected] };
      },
    },
  );

  assert.equal(result, expected);
  assert.deepEqual(queryParams, [organizationId, checksum]);
  assert.match(queryText, /WHERE organization_id = \$1[\s\S]*AND checksum = \$2/);
  assert.match(queryText, /AND force_new_version = false/);
  assert.doesNotMatch(queryText, /storage|verified/i);
});

test("upload-authorization metadata read includes private storage facts for upload service composition", async () => {
  const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
  const intakeFileId = "7d5482be-ad6b-4ed5-95cc-1a1bf4fcb749";
  let queryText = null;
  let queryParams = null;
  const expected = {
    intake_file_id: intakeFileId,
    organization_id: organizationId,
    storage_provider: "gcs",
    storage_object_key: "kai/org/intake/file.pdf",
    checksum: "a".repeat(64),
    hash_algorithm: "sha256",
  };

  const result = await getIntakeFileUploadMetadata(
    organizationId,
    intakeFileId,
    {
      async query(text, params) {
        queryText = text;
        queryParams = params;
        return { rows: [expected] };
      },
    },
  );

  assert.equal(result, expected);
  assert.deepEqual(queryParams, [organizationId, intakeFileId]);
  assert.match(queryText, /storage_provider/);
  assert.match(queryText, /storage_object_key/);
  assert.match(queryText, /checksum/);
  assert.match(queryText, /hash_algorithm/);
});

test("P1 worker candidate discovery sweeps every organization, bounded at 25, excluding already-satisfied and non-automatically-actionable P1 work", async () => {
  let queryText = null;
  let queryParams = null;
  const rows = [
    { organization_id: "a5d17c5a-c55f-43af-9b21-fe63aafe733f", intake_file_id: "9fe568b1-5c05-4c42-bb1f-6e20de216c7b" },
    { organization_id: "b6e28d6b-d66f-54bf-ac32-0f74bbf844f0", intake_file_id: "7d5482be-ad6b-4ed5-95cc-1a1bf4fcb749" },
  ];

  const result = await listActionableKaiP1WorkCandidates({
    async query(text, params) {
      queryText = text;
      queryParams = params;
      return { rows };
    },
  });

  assert.deepEqual(result, rows);
  assert.deepEqual(queryParams, undefined);
  // No organization_id bound as a query parameter - the candidate sweep is not
  // scoped to any one organization.
  assert.match(queryText, /FROM kai\.intake_files f/);
  assert.match(queryText, /file_policy_status = 'passed'/);
  // Satisfied automatic P1 work (a persisted P1-05 sensitivity profile) is
  // excluded so it can never permanently occupy the bounded window.
  assert.match(queryText, /NOT EXISTS[\s\S]*kai\.intake_sensitivity_profiles s[\s\S]*s\.organization_id = f\.organization_id[\s\S]*s\.intake_file_id = f\.intake_file_id/);
  // A parser run stuck running/failed/cancelled can never auto-advance under
  // retry:false (only a queued row is claimable, and only explicit retry:true
  // - never issued by the automatic worker - re-queues a failed run), so it
  // is excluded rather than permanently occupying the window - but only for
  // the file's CURRENT parser-run identity: a historical row under a
  // superseded checksum is irrelevant to a fresh activation call (which
  // always re-derives its identity from the file's current checksum), so the
  // exclusion is scoped by checksum, never by organization_id/intake_file_id
  // alone.
  assert.match(queryText, /NOT EXISTS[\s\S]*kai\.intake_parser_runs r[\s\S]*r\.organization_id = f\.organization_id[\s\S]*r\.intake_file_id = f\.intake_file_id[\s\S]*r\.checksum = f\.verified_checksum[\s\S]*r\.parser_status IN \('running', 'failed', 'cancelled'\)/);
  // Global chronological (created_at) ordering, not a per-organization rank:
  // a fixed candidate's position relative to every other candidate never
  // moves once created, so no organization's backlog - however large or
  // continuously replenished, and regardless of how many other organizations
  // are simultaneously backlogged - can push a fixed candidate out of the
  // bounded window indefinitely.
  assert.doesNotMatch(queryText, /ROW_NUMBER/);
  assert.doesNotMatch(queryText, /PARTITION BY/);
  assert.match(queryText, /ORDER BY f\.created_at ASC, f\.organization_id ASC, f\.intake_file_id ASC/);
  assert.match(queryText, /LIMIT 25/);
  assert.doesNotMatch(queryText, /WHERE.*organization_id = \$1/s);
});

test("P1 worker candidate discovery returns organization_id and intake_file_id on every candidate", async () => {
  const rows = [{ organization_id: "org-a", intake_file_id: "file-a" }];
  const result = await listActionableKaiP1WorkCandidates({ async query() { return { rows }; } });
  assert.equal(result[0].organization_id, "org-a");
  assert.equal(result[0].intake_file_id, "file-a");
});
