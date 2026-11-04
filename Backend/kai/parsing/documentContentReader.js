import { createHash } from "node:crypto";
import { getScopedIntakeFileParserProfileEligibilityFacts, lockKaiP1EligibleIntakeFileForShare } from "../db/kaiIntakeQueries.js";
import { readTrustedTextLines } from "../profiling/localProfilingKernel.js";
import { runPdfTextWorkerBoundary } from "../validators/pdfAssessorWorkerBoundary.js";
import { createP1ObjectVersionByteSource } from "./p1ObjectVersionByteSource.js";

/**
 * KAI document content reader: the one place document-statement evidence
 * reads a source version's bytes. It follows the cross-source reconciliation
 * worker exactly: for one promoted source version the caller has already
 * admitted through the shared governed loader (lineage, currentness,
 * effective allowed use, bound profile), inside the caller's transaction it
 * takes the P1 eligibility share lock on the intake file (still a confirmed,
 * passed upload of the profiled checksum), re-reads its stored object-version
 * facts, reads the bytes through the P1 exact-version byte source, re-checks
 * their sha256 against the profiled checksum, and decodes them as the
 * profiler does: plain text with the profiler's own decoder, a PDF through
 * the bounded mupdf worker after the same in-worker security assessment
 * (an encrypted, textless or active/embedded-content PDF is refused, never
 * read). The bytes never leave this module and nothing here persists the
 * text; `read` returns the document's lines (txt) or page text blocks (pdf)
 * to the caller only.
 */
function refusal(reason) {
  return { ok: false, reason };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const EXTENSION_BY_FORMAT = Object.freeze({ pdf: ".pdf", txt: ".txt" });

export function createDocumentContentReader({
  storageAdapter,
  gcsProvider,
  gcsParserReaderProvider,
  uploadLifecycleRepository,
  readEligibilityFacts = getScopedIntakeFileParserProfileEligibilityFacts,
  lockEligibleIntakeFile = lockKaiP1EligibleIntakeFileForShare,
  readPdfText = runPdfTextWorkerBoundary,
} = {}) {
  return Object.freeze({
    async read(tx, { organizationId, intakeFileId, checksum, format }) {
      const extension = EXTENSION_BY_FORMAT[format];
      if (!extension) return refusal("document_format_unsupported");
      if (!(await lockEligibleIntakeFile({ organizationId, intakeFileId, verifiedChecksum: checksum }, tx))) {
        return refusal("document_upload_not_eligible");
      }
      const facts = await readEligibilityFacts({ organizationId, intakeFileId }, tx);
      if (!facts || facts.organization_id !== organizationId || facts.verified_checksum !== checksum || facts.file_extension !== extension) {
        return refusal("document_upload_not_eligible");
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
        return refusal("document_bytes_unavailable");
      }
      const raw = read?.ok === true ? read.data?.bytes : null;
      if (!raw && ["checksum_mismatch", "size_mismatch"].includes(read?.error?.integrity_failure_kind)) return refusal("document_checksum_mismatch");
      if (!raw) return refusal("document_bytes_unavailable");
      // Bytes that are not the profiled version are never read for evidence.
      if (sha256(raw) !== checksum) return refusal("document_checksum_mismatch");
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);

      if (format === "txt") {
        const lines = readTrustedTextLines({ bytes, extension, declaredMime: facts.mime_type });
        if (!lines) return refusal("document_text_not_readable");
        return { ok: true, document: { format: "txt", lines } };
      }
      let text;
      try {
        text = await readPdfText({ bytes, byteSize: bytes.byteLength, extension, declaredMime: facts.mime_type });
      } catch {
        return refusal("document_text_not_readable");
      }
      if (text?.status === "not_profilable" && text.reason === "pdf_active_or_embedded_content") return refusal("document_pdf_security_blocked");
      if (text?.status === "not_profilable" && text.reason === "encrypted_or_password_protected") return refusal("document_pdf_security_blocked");
      // A busy or timed-out worker is transient: the file itself is not at fault.
      if (text?.status === "failed" && ["maximum_concurrent_pdf_assessor_workers_exceeded", "security_assessment_timeout"].includes(text.error?.category)) {
        return refusal("document_text_temporarily_unavailable");
      }
      if (text?.status !== "extracted") return refusal("document_text_not_readable");
      return { ok: true, document: { format: "pdf", pages: text.pages } };
    },
  });
}
