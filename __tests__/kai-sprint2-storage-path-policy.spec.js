import test from "node:test";
import assert from "node:assert/strict";

import { buildObjectKey, validateObjectKeyPolicy, validateSafeFilename } from "../Backend/kai/storage/storagePathPolicy.js";

const ids = {
  organizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f",
  intakeBatchId: "2e426ea1-2be3-4e48-b80f-9783ddbacda0",
  intakeFileId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
};

test("storage object key policy prevents path traversal and user-controlled prefixes", () => {
  assert.equal(validateSafeFilename("../secret.csv").ok, false);
  assert.equal(validateSafeFilename("folder/file.csv").ok, false);

  const built = buildObjectKey({ ...ids, safeFilename: "safe-file.csv" });
  assert.equal(built.ok, true);
  assert.equal(built.objectKey, `kai/org/${ids.organizationId}/intake/${ids.intakeBatchId}/${ids.intakeFileId}/safe-file.csv`);
  assert.equal(validateObjectKeyPolicy({ ...ids, safeFilename: "safe-file.csv", objectKey: built.objectKey }).ok, true);
  assert.equal(validateObjectKeyPolicy({ ...ids, safeFilename: "safe-file.csv", objectKey: `evil/${built.objectKey}` }).ok, false);
});
