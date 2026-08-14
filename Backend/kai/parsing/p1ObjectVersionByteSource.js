import { readVerifiedAssessmentBytes } from "../security/assessmentReadIntegrityBridge.js";
import { createBoundGcsAssessmentStorageAdapter } from "../security/productionSecurityAssessmentComposition.js";

/**
 * P1 activation exact-version byte source.
 *
 * `createParserProfileWorkerOrchestration` (Backend/kai/parsing/parserProfileWorkerOrchestration.js)
 * requires an injected `objectVersionByteSource` exposing exactly
 * `readObjectVersion({ objectVersionId }) -> { ok, data: { bytes } }`, matching the
 * same shape `Backend/kai/storage/localDevStorageAdapter.js#readObjectVersion`
 * already implements. This module adds no new byte-read or integrity-verification
 * logic: it is a thin per-file binding over the two exact-version read primitives
 * Gate C already established and this repository already trusts -
 * `createBoundGcsAssessmentStorageAdapter` (GCS exact-generation binding, reused
 * unchanged from `productionSecurityAssessmentComposition.js`) and
 * `readVerifiedAssessmentBytes` (the existing checksum/size integrity bridge, reused
 * unchanged from `assessmentReadIntegrityBridge.js`) - adapted to the narrower
 * `readObjectVersion` shape P1 already expects.
 *
 * A caller that already has a general-purpose storage adapter (for example the
 * local-dev storage adapter used by non-GCS/test composition, which already
 * implements `readObjectVersion` natively) may pass it directly as
 * `storageAdapter`; this module then performs no GCS binding and delegates the
 * read unchanged, after confirming the requested `objectVersionId` matches the
 * trusted, already-confirmed intake-file facts this source was constructed for.
 */
export function createP1ObjectVersionByteSource({
  trustedIntakeFacts,
  storageAdapter,
  gcsProvider,
  gcsParserReaderProvider,
  uploadLifecycleRepository,
  signal,
} = {}) {
  if (
    !trustedIntakeFacts
    || typeof trustedIntakeFacts.organizationId !== "string"
    || typeof trustedIntakeFacts.intakeFileId !== "string"
    || typeof trustedIntakeFacts.objectVersionId !== "string"
  ) {
    throw new TypeError("createP1ObjectVersionByteSource requires trusted intake-file facts.");
  }

  return Object.freeze({
    async readObjectVersion({ objectVersionId } = {}) {
      if (objectVersionId !== trustedIntakeFacts.objectVersionId) {
        return { ok: false, data: null, error: { code: "validation_blocker" } };
      }

      if (storageAdapter) {
        return await storageAdapter.readObjectVersion({ objectVersionId });
      }

      const exactGenerationReadProvider = gcsParserReaderProvider || gcsProvider;
      const boundAdapter = createBoundGcsAssessmentStorageAdapter({
        facts: {
          organizationId: trustedIntakeFacts.organizationId,
          intakeFileId: trustedIntakeFacts.intakeFileId,
          objectVersionId: trustedIntakeFacts.objectVersionId,
          storageProvider: trustedIntakeFacts.storageProvider,
          storageObjectKey: trustedIntakeFacts.storageObjectKey,
        },
        gcsProvider: exactGenerationReadProvider,
        uploadLifecycleRepository,
      });
      if (!boundAdapter) {
        return { ok: false, data: null, error: { code: "byte_source_unavailable" } };
      }

      const verified = await readVerifiedAssessmentBytes({
        objectVersionId,
        expectedChecksum: trustedIntakeFacts.verifiedChecksum,
        expectedSize: trustedIntakeFacts.verifiedSizeBytes,
        storageAdapter: boundAdapter,
        ...(signal ? { signal } : {}),
      });
      if (verified?.ok !== true) {
        return { ok: false, data: null, error: { code: "byte_source_unavailable" } };
      }
      return { ok: true, data: { bytes: verified.data.bytes }, error: null };
    },
  });
}

export const __testables = Object.freeze({
  createP1ObjectVersionByteSource,
});
