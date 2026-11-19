import { createHash } from "node:crypto";
import { getScopedIntakeFileParserProfileEligibilityFacts, lockKaiP1EligibleIntakeFileForShare } from "../db/kaiIntakeQueries.js";
import { profileLocalTrustedFile, readTrustedCsvRecords, readTrustedWorksheetRecords } from "../profiling/localProfilingKernel.js";
import { createP1ObjectVersionByteSource } from "./p1ObjectVersionByteSource.js";
import { CrossSourceDurationPrecisionError, reconcileLinkedReach } from "./crossSourceReachReconciliation.js";
import { assessPlanningTargetRecords } from "../validators/kaiPlanningTargetCandidates.js";
import { headerIndicatesPersonalAttribute } from "../profiling/tabularMeasurementBasis.js";
import { dataRecords } from "./crossSourceReachReconciliation.js";
import { reconcileServiceEvents, serviceHeadingTerms } from "./serviceEventReconciliation.js";

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
 * parses them with the profiler's own reader: a CSV, or the selected
 * worksheet of a workbook (with Excel date cells as their days). The bytes
 * and parsed records never leave this module except as `readSourceRecords`
 * hands one version's records to the calculation running in the same worker
 * transaction: `reconcile` returns only the counts and source row numbers of
 * reconcileLinkedReach. The caller supplies identities and the validated
 * mapping, never bytes, facts or a storage path.
 * A failed earlier survey discovery can also be recalculated on demand for
 * one admitted workbook. This uses the same bounded parser and exact-version
 * checks, returns aggregates only and never rewrites the committed profile.
 * A small worksheet's planned-target rows are read the same way: only the
 * screened candidates (planned value, unit, period, programme, status and row
 * number) leave this module, never the records or a free-text note.
 * A service-record table's single-source reconciliation is read the same way:
 * each heading leaves only as the listed service vocabulary words it contains
 * (and whether it names a personal attribute), and each plan the caller
 * resolves from them is reconciled here, returning counts, listed labels and
 * row numbers only.
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
  async function readVerifiedUpload(tx, { organizationId, intakeFileId, checksum, worksheetKey = null }) {
    if (!(await lockEligibleIntakeFile({ organizationId, intakeFileId, verifiedChecksum: checksum }, tx))) {
      return refusal("cross_source_upload_not_eligible");
    }
    const facts = await readEligibilityFacts({ organizationId, intakeFileId }, tx);
    if (!facts || facts.organization_id !== organizationId || facts.verified_checksum !== checksum || ![".csv", ".xlsx"].includes(facts.file_extension)
      || (facts.file_extension === ".csv" && worksheetKey !== null)) {
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
    const trusted = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return { ok: true, trusted, facts };
  }

  async function readRecords(tx, input) {
    const read = await readVerifiedUpload(tx, input);
    if (!read.ok) return read;
    const { trusted, facts } = read;
    const worksheetKey = input.worksheetKey ?? null;
    const records = facts.file_extension === ".xlsx"
      ? await readTrustedWorksheetRecords({ bytes: trusted, sheetKey: worksheetKey, declaredMime: facts.mime_type })
      : readTrustedCsvRecords({ bytes: trusted, declaredMime: facts.mime_type });
    if (!records) return refusal("cross_source_csv_not_readable");
    return { ok: true, records };
  }

  return Object.freeze({
    // Repair an earlier failed discovery from the SAME verified upload. Only
    // aggregate pairing counts/locators leave this worker; no profile is rewritten.
    async readPairedOutcomeBasis(tx, input) {
      const read = await readVerifiedUpload(tx, input);
      if (!read.ok) return read;
      if (read.facts.file_extension !== ".xlsx") return refusal("paired_outcome_source_not_workbook");
      const profile = await profileLocalTrustedFile({
        extension: ".xlsx", declaredMime: read.facts.mime_type,
        byteSize: read.trusted.byteLength, bytes: read.trusted,
      });
      const sheet = input.worksheetKey == null && profile.sheets?.length === 1
        ? profile.sheets[0] : profile.sheets?.find((item) => item.sheet_key === input.worksheetKey);
      if (!sheet?.paired_outcome_basis) return refusal("paired_outcome_worksheet_not_readable");
      return { ok: true, sheetKey: sheet.sheet_key, basis: sheet.paired_outcome_basis, recordCountBasis: sheet.record_count_basis };
    },
    // Planned targets stated in one worksheet of the SAME verified upload.
    // Read-only; the record count lets the caller confirm the profiled table.
    async readPlanningTargetCandidates(tx, input) {
      if (input.worksheetKey == null) return refusal("planning_target_worksheet_required");
      const read = await readRecords(tx, input);
      if (!read.ok) return read;
      return {
        ok: true,
        sheetKey: input.worksheetKey,
        dataRecordCount: read.records.length - 1,
        assessment: assessPlanningTargetRecords(read.records, { worksheetKey: input.worksheetKey }),
      };
    },
    // Service-delivery measurements of one table of the SAME verified upload:
    // `compute({headings, physicalRecordCount, reconcile})` resolves its plans
    // from the heading words and calls `reconcile(plan)`, which returns
    // aggregates only; the records never leave this module.
    async readServiceEvents(tx, { organizationId, intakeFileId, checksum, worksheetKey = null, compute }) {
      const read = await readRecords(tx, { organizationId, intakeFileId, checksum, worksheetKey });
      if (!read.ok) return read;
      const header = Array.isArray(read.records[0]) ? read.records[0] : [];
      const headings = Object.fromEntries(header.map((text, index) => [`field_${index + 1}`, {
        terms: serviceHeadingTerms(String(text ?? "").replace(/^\uFEFF/, "")),
        personal: headerIndicatesPersonalAttribute(String(text ?? "").replace(/^\uFEFF/, "")),
      }]));
      const physicalRecordCount = dataRecords(read.records).length;
      const records = read.records;
      return { ok: true, ...(await compute({ headings, physicalRecordCount, reconcile: (plan) => reconcileServiceEvents({ records, plan }) })) };
    },
    // One version's verified records, for a calculation in this same worker transaction.
    async readSourceRecords(tx, { organizationId, intakeFileId, checksum, worksheetKey = null }) {
      return readRecords(tx, { organizationId, intakeFileId, checksum, worksheetKey });
    },
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
