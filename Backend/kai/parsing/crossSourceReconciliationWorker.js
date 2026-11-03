import { createHash } from "node:crypto";
import { getScopedIntakeFileParserProfileEligibilityFacts, lockKaiP1EligibleIntakeFileForShare } from "../db/kaiIntakeQueries.js";
import { readTrustedCsvRecords } from "../profiling/localProfilingKernel.js";
import { createP1ObjectVersionByteSource } from "./p1ObjectVersionByteSource.js";
import { CrossSourceDurationPrecisionError, reconcileLinkedReach } from "./crossSourceReachReconciliation.js";

/**
 * KAI cross-source reconciliation worker: the one place a cross-source
 * measurement reads source bytes. It is a parser-worker read, through the
 * same exact-version byte source P1 uses (createP1ObjectVersionByteSource:
 * exact GCS generation, checksum and size verified), for exactly two
 * promoted source versions the caller has already loaded through the
 * governed measurement loader (lineage, currentness, effective allowed use,
 * bound profile). For each, inside the caller's transaction, it takes the
 * P1 eligibility share lock on the intake file (still a confirmed, passed
 * upload of the profiled checksum), re-reads its stored object-version facts,
 * reads the bytes, re-checks their sha256 against the profiled checksum, and
 * parses them with the profiler's own CSV reader. The bytes and parsed
 * records never leave this module: `reconcile` returns only the counts and
 * source row numbers of reconcileLinkedReach. The caller supplies identities
 * and the validated mapping, never bytes, facts or a storage path.
 */
function refusal(reason) {
  return { ok: false, reason };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createCrossSourceReconciliationWorker({
  storageAdapter,
  gcsProvider,
  gcsParserReaderProvider,
  uploadLifecycleRepository,
  readEligibilityFacts = getScopedIntakeFileParserProfileEligibilityFacts,
  lockEligibleIntakeFile = lockKaiP1EligibleIntakeFileForShare,
} = {}) {
  async function readRecords(tx, { organizationId, intakeFileId, checksum }) {
    if (!(await lockEligibleIntakeFile({ organizationId, intakeFileId, verifiedChecksum: checksum }, tx))) {
      return refusal("cross_source_upload_not_eligible");
    }
    const facts = await readEligibilityFacts({ organizationId, intakeFileId }, tx);
    if (!facts || facts.organization_id !== organizationId || facts.verified_checksum !== checksum || facts.file_extension !== ".csv") {
      return refusal("cross_source_upload_not_eligible");
    }
    const byteSource = createP1ObjectVersionByteSource({
      trustedIntakeFacts: {
        organizationId,
        intakeFileId,
        objectVersionId: facts.object_version_id,
        verifiedChecksum: facts.verified_checksum,
        verifiedSizeBytes: facts.verified_size_bytes,
        storageProvider: facts.storage_provider,
        storageObjectKey: facts.storage_object_key,
      },
      storageAdapter,
      gcsProvider,
      gcsParserReaderProvider,
      uploadLifecycleRepository,
    });
    let read;
    try {
      read = await byteSource.readObjectVersion({ objectVersionId: facts.object_version_id });
    } catch {
      return refusal("cross_source_bytes_unavailable");
    }
    const bytes = read?.ok === true ? read.data?.bytes : null;
    if (!bytes && ["checksum_mismatch", "size_mismatch"].includes(read?.error?.integrity_failure_kind)) return refusal("cross_source_checksum_mismatch");
    if (!bytes) return refusal("cross_source_bytes_unavailable");
    // Bytes that are not the profiled version are never reconciled or retried.
    if (sha256(bytes) !== checksum) return refusal("cross_source_checksum_mismatch");
    const records = readTrustedCsvRecords({ bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), declaredMime: facts.mime_type });
    if (!records) return refusal("cross_source_csv_not_readable");
    return { ok: true, records };
  }

  return Object.freeze({
    async reconcile(tx, { organizationId, events, register, mapping }) {
      const eventRead = await readRecords(tx, { organizationId, ...events });
      if (!eventRead.ok) return eventRead;
      const registerRead = await readRecords(tx, { organizationId, ...register });
      if (!registerRead.ok) return registerRead;
      try {
        return { ok: true, reconciliation: reconcileLinkedReach({ eventRecords: eventRead.records, registerRecords: registerRead.records, mapping }) };
      } catch (error) {
        if (error instanceof CrossSourceDurationPrecisionError) return refusal("cross_source_duration_precision_unsupported");
        throw error;
      }
    },
  });
}
