import test from "node:test";
import assert from "node:assert/strict";

import {
  findIntakeFileReservationByChecksum,
  getScopedIntakeFileSecurityAssessmentFacts,
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
