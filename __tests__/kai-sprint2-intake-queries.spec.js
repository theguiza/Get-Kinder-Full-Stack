import test from "node:test";
import assert from "node:assert/strict";

import { findIntakeFileReservationByChecksum } from "../Backend/kai/db/kaiIntakeQueries.js";
import { getIntakeFileMetadata } from "../Backend/kai/db/kaiReadModels.js";

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

test("intake file metadata read includes private storage facts for upload service composition", async () => {
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

  const result = await getIntakeFileMetadata(
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
