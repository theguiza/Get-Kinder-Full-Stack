import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { runGateB1MockGcsProof } from "../scripts/kai-sprint2-gate-b1-gcs-verifier.js";

test("Gate B-1 verifier preserves separate signer and parser/read provider contexts through the existing seam", async () => {
  const result = await runGateB1MockGcsProof();

  assert.equal(result.gcsGeneration, "1700000000000001");
  assert.match(result.intakeFileId, /^[0-9a-f-]{36}$/);
  assert.match(result.objectVersionId, /^ov_[0-9a-f]{32}$/);
  assert.match(result.verifiedChecksum, /^[0-9a-f]{64}$/);
  assert.equal(result.verifiedSizeBytes, 30);
});

test("Gate B-1 verifier uses the existing provider injection seam without changing provider behavior", () => {
  const verifierSource = readFileSync("scripts/kai-sprint2-gate-b1-gcs-verifier.js", "utf8");
  const providerSource = readFileSync("Backend/kai/storage/googleCloudStorageProvider.js", "utf8");
  const factorySource = readFileSync("Backend/kai/storage/gcsImpersonatedStorageClientFactory.js", "utf8");

  assert.match(verifierSource, /storageClientFactory:\s*\(\)\s*=>\s*uploadSigningClient/);
  assert.match(verifierSource, /storageClientFactory:\s*\(\)\s*=>\s*parserReadClient/);
  assert.match(verifierSource, /createImpersonatedStorageClient/);
  assert.match(factorySource, /new Storage\(\{\s*authClient\s*\}\)/);
  assert.doesNotMatch(factorySource, /new GoogleAuth\(\{\s*authClient\s*\}\)/);
  assert.match(factorySource, /new Impersonated\(/);
  assert.match(providerSource, /storageClientFactory/);
  assert.doesNotMatch(providerSource, /KAI_GATE_B1|Impersonated|targetPrincipal/);
});

test("Gate B-1 verifier exercises the two missing negative signed-request requirements against the real target only", () => {
  const verifierSource = readFileSync("scripts/kai-sprint2-gate-b1-gcs-verifier.js", "utf8");

  assert.match(verifierSource, /export async function runGateB1LiveNegativeSignedRequestProof/);
  assert.match(
    verifierSource,
    /mutatedHeaders\s*=\s*\{\s*\.\.\.signedUpload\.data\.headers,\s*"Content-Type":\s*"application\/octet-stream"\s*\}/,
  );
  assert.match(verifierSource, /Buffer\.alloc\(KAI_SPRINT2_MAX_FILE_SIZE_BYTES \+ 1, 0x4b\)/);
  assert.match(verifierSource, /headers:\s*signedUpload\.data\.headers,/);
  assert.match(verifierSource, /freshSyntheticObjectKey\(\)/);
});
