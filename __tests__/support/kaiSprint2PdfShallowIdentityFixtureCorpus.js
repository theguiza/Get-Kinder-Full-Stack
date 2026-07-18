import {
  EXTENSION_MIME_MATRIX_BYTE_SOURCES,
} from "./kaiSprint2ExtensionMimeMatrixFixtureCorpus.js";

export const PDF_SHALLOW_IDENTITY_FIXTURE_POLICIES = Object.freeze(["allow", "block"]);

export const PDF_SHALLOW_IDENTITY_FIXTURE_CATEGORIES = Object.freeze([
  "type_agreement_pass",
  "truncated_or_malformed_type",
]);

export const PDF_SHALLOW_IDENTITY_FIXTURE_CORPUS_STATUSES = Object.freeze(["corpus_only"]);

export const PDF_SHALLOW_IDENTITY_AUTHORITY_MAP = Object.freeze({
  "OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1": Object.freeze({
    source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
    section_or_decision_key: "P0-05F PDF shallow identity rule and deterministic block outcomes",
    requirement_summary:
      "A PDF candidate must use .pdf, declare application/pdf, begin at byte offset zero with ASCII %PDF-, and contain ASCII %%EOF within the final 1024 bytes. Incomplete PDF minimum shallow identity blocks as truncated_or_malformed_type.",
    authority_status: "contract_grounded",
  }),
});

export const PDF_SHALLOW_IDENTITY_SOURCE_MODULE = "__tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js";
export const PDF_SHALLOW_IDENTITY_SOURCE_IDENTIFIER = "EXTMIME-P0-05F-BYTES-PDF-POSITIVE";
export const PDF_SHALLOW_IDENTITY_EXACT_EXPORT_PROPERTY_USED =
  'EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"].bytes';

const sourcePdfBytes = EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"]?.bytes;

if (!sourcePdfBytes) {
  throw new Error("Missing P0-05F.2b2a positive PDF byte source for PDF shallow-identity fixtures.");
}

if (EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"].source_id !== PDF_SHALLOW_IDENTITY_SOURCE_IDENTIFIER) {
  throw new Error(`Unexpected PDF byte source identifier: ${EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"].source_id}`);
}

export const PDF_SHALLOW_IDENTITY_IMPORTED_POSITIVE_BYTES = sourcePdfBytes;

const asciiEncoder = new TextEncoder();
const leadingBytePdfBytes = new Uint8Array(sourcePdfBytes.byteLength + 1);
leadingBytePdfBytes[0] = 0x58;
leadingBytePdfBytes.set(sourcePdfBytes, 1);

const truncatedPrefixPdfBytes = new Uint8Array(sourcePdfBytes.byteLength - 1);
truncatedPrefixPdfBytes.set(sourcePdfBytes.slice(0, 4), 0);
truncatedPrefixPdfBytes.set(sourcePdfBytes.slice(5), 4);

const missingEofPdfBytes = new Uint8Array(sourcePdfBytes);
missingEofPdfBytes.set(asciiEncoder.encode("%%EOX"), sourcePdfBytes.byteLength - 6);

const eofOutsideFinal1024PdfBytes = new Uint8Array(sourcePdfBytes.byteLength + 1024);
eofOutsideFinal1024PdfBytes.set(sourcePdfBytes, 0);
eofOutsideFinal1024PdfBytes.fill(0x41, sourcePdfBytes.byteLength);

function fixture({
  fixture_id,
  description,
  bytes,
  fixture_family,
  expected_policy,
  expected_category,
  derivation,
  violated_identity_condition,
}) {
  return Object.freeze({
    fixture_id,
    description,
    extension: ".pdf",
    normalized_extension: ".pdf",
    declared_mime: "application/pdf",
    normalized_declared_mime: "application/pdf",
    bytes,
    byte_length: bytes.byteLength,
    positive_pdf_source_module: PDF_SHALLOW_IDENTITY_SOURCE_MODULE,
    positive_pdf_source_identifier: PDF_SHALLOW_IDENTITY_SOURCE_IDENTIFIER,
    exact_export_property_used: PDF_SHALLOW_IDENTITY_EXACT_EXPORT_PROPERTY_USED,
    byte_source_kind:
      bytes === sourcePdfBytes
        ? "imported_p0_05f_2b2a_positive_pdf_bytes"
        : "deterministically_derived_from_imported_p0_05f_2b2a_positive_pdf_bytes",
    derived_from_source_identifier: PDF_SHALLOW_IDENTITY_SOURCE_IDENTIFIER,
    expected_policy,
    expected_category,
    scope_note: expected_policy === "allow" ? "type_agreement_pass_only" : "pdf_shallow_identity_block_only",
    authority: "OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1",
    fixture_family,
    derivation,
    pdf_identity_conditions: Object.freeze({
      extension_is_pdf: true,
      declared_mime_is_application_pdf: true,
      header_pdf_marker_at_offset_zero: violated_identity_condition !== "offset_zero_header",
      eof_marker_present: violated_identity_condition !== "eof_presence",
      eof_marker_within_final_1024_bytes: violated_identity_condition !== "eof_final_1024_window",
    }),
    violated_identity_condition,
    violates_exactly_one_identity_condition: violated_identity_condition === null ? false : true,
    synthetic_provenance:
      "synthetic PDF shallow-identity fixture row created locally for P0-05F.2c; positive bytes import the committed P0-05F.2b2a PDF source; negatives are deterministic byte-level derivations from that imported source and use no repository data, deployed data, external services, secrets, private material, disk files, or document sources",
    corpus_status: "corpus_only",
    usable_document_claim: false,
    complete_pdf_validity_claim: false,
    semantic_pdf_claim: false,
    machine_readable_text_layer_claim: false,
    encryption_or_password_claim: false,
    active_content_claim: false,
    embedded_file_claim: false,
    source_eligibility_claim: false,
    upload_acceptance_claim: false,
    complete_file_policy_pass_claim: false,
    production_detector_claim: false,
    production_detector_answer_key: false,
    runtime_mime_behavior_claim: false,
    dependency_added_claim: false,
  });
}

export const PDF_SHALLOW_IDENTITY_FIXTURES = Object.freeze([
  fixture({
    fixture_id: "PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF",
    description: "Imported positive PDF bytes with .pdf extension and application/pdf declared MIME pass shallow type agreement only.",
    bytes: sourcePdfBytes,
    fixture_family: "positive_minimum_pdf",
    expected_policy: "allow",
    expected_category: "type_agreement_pass",
    derivation: "imports and reuses the exact P0-05F.2b2a positive PDF Uint8Array object",
    violated_identity_condition: null,
  }),
  fixture({
    fixture_id: "PDFIDENT-P0-05F-002-BLOCK-LEADING-BYTE-BEFORE-HEADER",
    description: "One deterministic ASCII byte before the imported PDF source blocks because %PDF- no longer begins at offset zero.",
    bytes: leadingBytePdfBytes,
    fixture_family: "leading_byte_before_pdf_header",
    expected_policy: "block",
    expected_category: "truncated_or_malformed_type",
    derivation: "prepends exactly one deterministic ASCII X byte to the imported positive PDF bytes",
    violated_identity_condition: "offset_zero_header",
  }),
  fixture({
    fixture_id: "PDFIDENT-P0-05F-003-BLOCK-TRUNCATED-PDF-PREFIX",
    description: "Removing the hyphen from the offset-zero %PDF- marker leaves a strict %PDF prefix and blocks incomplete header identity.",
    bytes: truncatedPrefixPdfBytes,
    fixture_family: "truncated_pdf_prefix",
    expected_policy: "block",
    expected_category: "truncated_or_malformed_type",
    derivation: "removes exactly the hyphen byte from the imported positive PDF %PDF- header",
    violated_identity_condition: "offset_zero_header",
  }),
  fixture({
    fixture_id: "PDFIDENT-P0-05F-004-BLOCK-MISSING-EOF",
    description: "Replacing only the qualifying %%EOF marker blocks because no exact EOF marker remains.",
    bytes: missingEofPdfBytes,
    fixture_family: "missing_pdf_eof_marker",
    expected_policy: "block",
    expected_category: "truncated_or_malformed_type",
    derivation: "replaces only the imported positive PDF %%EOF marker with %%EOX",
    violated_identity_condition: "eof_presence",
  }),
  fixture({
    fixture_id: "PDFIDENT-P0-05F-005-BLOCK-EOF-OUTSIDE-FINAL-1024",
    description: "Appending deterministic safe ASCII after the original EOF marker blocks because EOF is outside the final 1024 bytes.",
    bytes: eofOutsideFinal1024PdfBytes,
    fixture_family: "eof_outside_final_1024_bytes",
    expected_policy: "block",
    expected_category: "truncated_or_malformed_type",
    derivation: "appends 1024 deterministic ASCII A bytes after the imported positive PDF bytes",
    violated_identity_condition: "eof_final_1024_window",
  }),
]);

export const PDF_SHALLOW_IDENTITY_CROSS_TYPE_CONTRADICTION_DEFERRAL = Object.freeze({
  deferred_case:
    "positive PDF bytes plus an otherwise permitted non-PDF extension/MIME pairing",
  status: "deferred_to_separate_general_cross_type_owner_decision_before_P0_05F_2d",
  category_inferred: false,
  fixture_added: false,
});

export function getPdfShallowIdentityFixtureExpectations() {
  return PDF_SHALLOW_IDENTITY_FIXTURES.map((item) => Object.freeze({
    fixture_id: item.fixture_id,
    normalized_extension: item.normalized_extension,
    normalized_declared_mime: item.normalized_declared_mime,
    expected_policy: item.expected_policy,
    expected_category: item.expected_category,
    scope_note: item.scope_note,
    authority: item.authority,
    violated_identity_condition: item.violated_identity_condition,
  }));
}
