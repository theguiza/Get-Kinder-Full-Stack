import { XLSX_ZIP_FIXTURES } from "./kaiSprint2XlsxZipFixtureCorpus.js";

export const EXTENSION_MIME_MATRIX_FIXTURE_POLICIES = Object.freeze(["allow", "block"]);

export const EXTENSION_MIME_MATRIX_FIXTURE_CATEGORIES = Object.freeze([
  "type_agreement_pass",
  "declared_type_mismatch",
]);

export const EXTENSION_MIME_MATRIX_FIXTURE_CORPUS_STATUSES = Object.freeze(["corpus_only"]);

export const EXTENSION_MIME_MATRIX_EXTENSIONS = Object.freeze([".csv", ".xlsx", ".md", ".txt", ".pdf"]);

export const EXTENSION_MIME_MATRIX_DECLARED_MIME_VALUES = Object.freeze([
  "text/csv",
  "application/csv",
  "text/markdown",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/pdf",
]);

export const EXTENSION_MIME_MATRIX_ALLOWED_PAIRINGS = Object.freeze([
  Object.freeze({ normalized_extension: ".csv", normalized_declared_mime: "text/csv" }),
  Object.freeze({ normalized_extension: ".csv", normalized_declared_mime: "application/csv" }),
  Object.freeze({ normalized_extension: ".xlsx", normalized_declared_mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  Object.freeze({ normalized_extension: ".md", normalized_declared_mime: "text/markdown" }),
  Object.freeze({ normalized_extension: ".md", normalized_declared_mime: "text/plain" }),
  Object.freeze({ normalized_extension: ".txt", normalized_declared_mime: "text/plain" }),
  Object.freeze({ normalized_extension: ".pdf", normalized_declared_mime: "application/pdf" }),
]);

export const EXTENSION_MIME_MATRIX_AUTHORITY_MAP = Object.freeze({
  "OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1": Object.freeze({
    source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
    section_or_decision_key: "P0-05F declared file-MIME matrix and deterministic block outcomes",
    requirement_summary:
      "Allowed extension and declared-MIME pairs pass only when all type signals agree; every grounded cross-type extension/MIME disagreement blocks as declared_type_mismatch.",
    authority_status: "contract_grounded",
  }),
  "OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1": Object.freeze({
    source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
    section_or_decision_key: "P0-05F XLSX shallow identity rule",
    requirement_summary:
      "XLSX matrix fixtures reuse the committed positive P0-05F.2a XLSX bytes and do not create a second independent XLSX byte source.",
    authority_status: "contract_grounded",
  }),
});

export const XLSX_MATRIX_SOURCE_MODULE = "__tests__/support/kaiSprint2XlsxZipFixtureCorpus.js";
export const XLSX_MATRIX_SOURCE_FIXTURE_ID = "XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX";
export const XLSX_MATRIX_EXACT_EXPORT_USED = "XLSX_ZIP_FIXTURES";

const sourceXlsxFixture = XLSX_ZIP_FIXTURES.find((fixture) => fixture.fixture_id === XLSX_MATRIX_SOURCE_FIXTURE_ID);

if (!sourceXlsxFixture) {
  throw new Error(`Missing XLSX matrix source fixture: ${XLSX_MATRIX_SOURCE_FIXTURE_ID}`);
}

export const XLSX_MATRIX_IMPORTED_POSITIVE_BYTES = sourceXlsxFixture.bytes;

export const EXTENSION_MIME_MATRIX_BYTE_SOURCES = Object.freeze({
  ".csv": Object.freeze({
    source_id: "EXTMIME-P0-05F-BYTES-CSV-VALID",
    source_kind: "synthetic_valid_csv_bytes",
    bytes: new TextEncoder().encode("name,value\nalpha,1\n"),
  }),
  ".xlsx": Object.freeze({
    source_id: XLSX_MATRIX_SOURCE_FIXTURE_ID,
    source_kind: "imported_p0_05f_2a_positive_xlsx_bytes",
    bytes: XLSX_MATRIX_IMPORTED_POSITIVE_BYTES,
  }),
  ".md": Object.freeze({
    source_id: "EXTMIME-P0-05F-BYTES-MD-VALID",
    source_kind: "synthetic_valid_markdown_bytes",
    bytes: new TextEncoder().encode("# Matrix Fixture\n\nValid Markdown bytes.\n"),
  }),
  ".txt": Object.freeze({
    source_id: "EXTMIME-P0-05F-BYTES-TXT-VALID",
    source_kind: "synthetic_valid_txt_bytes",
    bytes: new TextEncoder().encode("Plain text matrix fixture.\n"),
  }),
  ".pdf": Object.freeze({
    source_id: "EXTMIME-P0-05F-BYTES-PDF-POSITIVE",
    source_kind: "synthetic_positive_pdf_shallow_identity_bytes",
    bytes: new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"),
  }),
});

function normalizeExtension(extension) {
  return extension.toLowerCase();
}

function normalizeDeclaredMime(declaredMime) {
  return declaredMime.trim().toLowerCase();
}

function fixture({
  fixture_id,
  description,
  extension,
  declared_mime,
  expected_policy,
  expected_category,
  authority = "OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1",
  fixture_family,
}) {
  const normalized_extension = normalizeExtension(extension);
  const normalized_declared_mime = normalizeDeclaredMime(declared_mime);
  const byteSource = EXTENSION_MIME_MATRIX_BYTE_SOURCES[normalized_extension];

  if (!byteSource) {
    throw new Error(`Missing matrix byte source for ${normalized_extension}`);
  }

  return Object.freeze({
    fixture_id,
    description,
    extension,
    normalized_extension,
    declared_mime,
    normalized_declared_mime,
    bytes: byteSource.bytes,
    byte_length: byteSource.bytes.byteLength,
    byte_source_id: byteSource.source_id,
    byte_source_kind: byteSource.source_kind,
    expected_policy,
    expected_category,
    scope_note: expected_policy === "allow" ? "type_agreement_pass_only" : "type_agreement_block_only",
    authority,
    fixture_family,
    synthetic_provenance:
      "synthetic extension/MIME matrix fixture row created locally for P0-05F.2b2a; generated without repository data, deployed data, external services, secrets, private material, disk files, or document sources; XLSX rows import the P0-05F.2a positive fixture bytes unchanged",
    corpus_status: "corpus_only",
    usable_document_claim: false,
    source_eligibility_claim: false,
    production_detector_claim: false,
    semantic_content_inspected: false,
    production_detector_answer_key: false,
    mismatch_changes_only_declared_mime: expected_policy === "block",
    malformed_fixture_claim: false,
    decompression_required: false,
  });
}

export const EXTENSION_MIME_MATRIX_FIXTURES = Object.freeze([
  fixture({
    fixture_id: "EXTMIME-P0-05F-001-BLOCK-CSV-TEXT-MARKDOWN-MISMATCH",
    description: "Valid CSV bytes with .csv extension block when declared as text/markdown.",
    extension: ".csv",
    declared_mime: "text/markdown",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "csv_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-002-BLOCK-CSV-TEXT-PLAIN-MISMATCH",
    description: "Valid CSV bytes with .csv extension block when declared as text/plain.",
    extension: ".csv",
    declared_mime: "text/plain",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "csv_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-003-BLOCK-CSV-XLSX-MIME-MISMATCH",
    description: "Valid CSV bytes with .csv extension block when declared as XLSX.",
    extension: ".csv",
    declared_mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "csv_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-004-BLOCK-CSV-APPLICATION-PDF-MISMATCH",
    description: "Valid CSV bytes with .csv extension block when declared as application/pdf.",
    extension: ".csv",
    declared_mime: "application/pdf",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "csv_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-005-BLOCK-XLSX-TEXT-CSV-MISMATCH",
    description: "Imported positive XLSX bytes with .xlsx extension block when declared as text/csv.",
    extension: ".xlsx",
    declared_mime: "text/csv",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    authority: "OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1",
    fixture_family: "xlsx_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-006-BLOCK-XLSX-APPLICATION-CSV-MISMATCH",
    description: "Imported positive XLSX bytes with .xlsx extension block when declared as application/csv.",
    extension: ".xlsx",
    declared_mime: "application/csv",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    authority: "OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1",
    fixture_family: "xlsx_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-007-BLOCK-XLSX-TEXT-MARKDOWN-MISMATCH",
    description: "Imported positive XLSX bytes with .xlsx extension block when declared as text/markdown.",
    extension: ".xlsx",
    declared_mime: "text/markdown",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    authority: "OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1",
    fixture_family: "xlsx_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-008-BLOCK-XLSX-TEXT-PLAIN-MISMATCH",
    description: "Imported positive XLSX bytes with .xlsx extension block when declared as text/plain.",
    extension: ".xlsx",
    declared_mime: "text/plain",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    authority: "OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1",
    fixture_family: "xlsx_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-009-ALLOW-XLSX-OFFICEDOCUMENT",
    description: "Imported positive XLSX bytes with the committed XLSX declared MIME pass type agreement only.",
    extension: ".xlsx",
    declared_mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    expected_policy: "allow",
    expected_category: "type_agreement_pass",
    authority: "OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1",
    fixture_family: "xlsx_permitted_pairing",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-010-BLOCK-XLSX-APPLICATION-PDF-MISMATCH",
    description: "Imported positive XLSX bytes with .xlsx extension block when declared as application/pdf.",
    extension: ".xlsx",
    declared_mime: "application/pdf",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    authority: "OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1",
    fixture_family: "xlsx_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-011-BLOCK-MD-TEXT-CSV-MISMATCH",
    description: "Valid Markdown bytes with .md extension block when declared as text/csv.",
    extension: ".md",
    declared_mime: "text/csv",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "md_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-012-BLOCK-MD-APPLICATION-CSV-MISMATCH",
    description: "Valid Markdown bytes with .md extension block when declared as application/csv.",
    extension: ".md",
    declared_mime: "application/csv",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "md_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-013-BLOCK-MD-XLSX-MIME-MISMATCH",
    description: "Valid Markdown bytes with .md extension block when declared as XLSX.",
    extension: ".md",
    declared_mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "md_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-014-BLOCK-MD-APPLICATION-PDF-MISMATCH",
    description: "Valid Markdown bytes with .md extension block when declared as application/pdf.",
    extension: ".md",
    declared_mime: "application/pdf",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "md_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-015-BLOCK-TXT-TEXT-CSV-MISMATCH",
    description: "Valid TXT bytes with .txt extension block when declared as text/csv.",
    extension: ".txt",
    declared_mime: "text/csv",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "txt_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-016-BLOCK-TXT-APPLICATION-CSV-MISMATCH",
    description: "Valid TXT bytes with .txt extension block when declared as application/csv.",
    extension: ".txt",
    declared_mime: "application/csv",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "txt_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-017-BLOCK-TXT-XLSX-MIME-MISMATCH",
    description: "Valid TXT bytes with .txt extension block when declared as XLSX.",
    extension: ".txt",
    declared_mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "txt_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-018-BLOCK-TXT-APPLICATION-PDF-MISMATCH",
    description: "Valid TXT bytes with .txt extension block when declared as application/pdf.",
    extension: ".txt",
    declared_mime: "application/pdf",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "txt_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-019-BLOCK-PDF-TEXT-CSV-MISMATCH",
    description: "Positive PDF bytes with .pdf extension block when declared as text/csv.",
    extension: ".pdf",
    declared_mime: "text/csv",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "pdf_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-020-BLOCK-PDF-APPLICATION-CSV-MISMATCH",
    description: "Positive PDF bytes with .pdf extension block when declared as application/csv.",
    extension: ".pdf",
    declared_mime: "application/csv",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "pdf_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-021-BLOCK-PDF-TEXT-MARKDOWN-MISMATCH",
    description: "Positive PDF bytes with .pdf extension block when declared as text/markdown.",
    extension: ".pdf",
    declared_mime: "text/markdown",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "pdf_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-022-BLOCK-PDF-TEXT-PLAIN-MISMATCH",
    description: "Positive PDF bytes with .pdf extension block when declared as text/plain.",
    extension: ".pdf",
    declared_mime: "text/plain",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "pdf_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-023-BLOCK-PDF-XLSX-MIME-MISMATCH",
    description: "Positive PDF bytes with .pdf extension block when declared as XLSX.",
    extension: ".pdf",
    declared_mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    fixture_family: "pdf_declared_mime_mismatch",
  }),
  fixture({
    fixture_id: "EXTMIME-P0-05F-024-ALLOW-PDF-APPLICATION-PDF",
    description: "Positive PDF bytes with the committed application/pdf declared MIME pass type agreement only.",
    extension: ".pdf",
    declared_mime: "application/pdf",
    expected_policy: "allow",
    expected_category: "type_agreement_pass",
    fixture_family: "pdf_permitted_pairing",
  }),
]);

export function normalizeExtensionMimeMatrixExtension(extension) {
  return normalizeExtension(extension);
}

export function normalizeExtensionMimeMatrixDeclaredMime(declaredMime) {
  return normalizeDeclaredMime(declaredMime);
}

export function getExtensionMimeMatrixFixtureExpectations() {
  return EXTENSION_MIME_MATRIX_FIXTURES.map((fixture) => Object.freeze({
    fixture_id: fixture.fixture_id,
    normalized_extension: fixture.normalized_extension,
    normalized_declared_mime: fixture.normalized_declared_mime,
    byte_source_id: fixture.byte_source_id,
    expected_policy: fixture.expected_policy,
    expected_category: fixture.expected_category,
    scope_note: fixture.scope_note,
    authority: fixture.authority,
  }));
}
