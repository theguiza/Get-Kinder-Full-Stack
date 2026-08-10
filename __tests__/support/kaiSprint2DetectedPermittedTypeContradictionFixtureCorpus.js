import {
  EXTENSION_MIME_MATRIX_BYTE_SOURCES,
} from "./kaiSprint2ExtensionMimeMatrixFixtureCorpus.js";
import {
  XLSX_ZIP_FIXTURES,
} from "./kaiSprint2XlsxZipFixtureCorpus.js";

export const DETECTED_PERMITTED_TYPE_CONTRADICTION_AUTHORITY =
  "OWNER_DECISION.P0_05F.DETECTED_PERMITTED_TYPE_CONTRADICTION_V1";

export const DETECTED_PERMITTED_TYPE_CONTRADICTION_SOURCE_MODULES = Object.freeze({
  pdf: "__tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js",
  xlsx: "__tests__/support/kaiSprint2XlsxZipFixtureCorpus.js",
});

export const DETECTED_PERMITTED_TYPE_CONTRADICTION_PDF_SOURCE_PROPERTY =
  'EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"].bytes';
export const DETECTED_PERMITTED_TYPE_CONTRADICTION_XLSX_SOURCE_EXPORT = "XLSX_ZIP_FIXTURES";
export const DETECTED_PERMITTED_TYPE_CONTRADICTION_XLSX_SOURCE_FIXTURE_ID =
  "XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX";

const sourcePdfBytes = EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"]?.bytes;
const sourceXlsxFixture = XLSX_ZIP_FIXTURES.find(
  (fixture) => fixture.fixture_id === DETECTED_PERMITTED_TYPE_CONTRADICTION_XLSX_SOURCE_FIXTURE_ID,
);

if (!sourcePdfBytes) {
  throw new Error("Missing positive PDF byte source for P0-05F.2d0 contradiction fixtures.");
}

if (!sourceXlsxFixture) {
  throw new Error(
    `Missing positive XLSX byte source for P0-05F.2d0 contradiction fixtures: ${DETECTED_PERMITTED_TYPE_CONTRADICTION_XLSX_SOURCE_FIXTURE_ID}`,
  );
}

const sharedClassificationExclusions = Object.freeze({
  unsupported_file_type: false,
  truncated_or_malformed_type: false,
  disallowed_binary_signature: false,
  standalone_archive_or_non_xlsx: false,
  ambiguous_file_type: false,
  unknown_binary: false,
});

function fixture({
  fixture_id,
  description,
  bytes,
  detected_type,
  detected_mime,
  byte_source_module,
  byte_source_export_or_property,
  byte_source_fixture_id,
  byte_source_kind,
  fixture_family,
  xlsx_zip_prefix_present,
}) {
  return Object.freeze({
    fixture_id,
    description,
    extension: ".txt",
    normalized_extension: ".txt",
    declared_mime: "text/plain",
    normalized_declared_mime: "text/plain",
    jointly_declared_metadata_type: "text",
    bytes,
    byte_length: bytes.byteLength,
    detected_type,
    detected_mime,
    detected_type_is_permitted: true,
    metadata_pairing_permitted: true,
    extension_and_mime_agree: true,
    declared_type_differs_from_detected_type: true,
    expected_policy: "block",
    expected_category: "declared_type_mismatch",
    scope_note: "detected_permitted_type_contradiction_only",
    authority: DETECTED_PERMITTED_TYPE_CONTRADICTION_AUTHORITY,
    fixture_family,
    byte_source_module,
    byte_source_export_or_property,
    byte_source_fixture_id,
    byte_source_kind,
    derivation: "imports and reuses the exact positive permitted-type Uint8Array object by reference",
    classification_exclusions: sharedClassificationExclusions,
    zip_prefix_present: xlsx_zip_prefix_present,
    complete_xlsx_identity_prevents_standalone_zip_classification: detected_type === "xlsx",
    synthetic_provenance:
      "synthetic detected permitted-type contradiction fixture row created locally for P0-05F.2d0; bytes are imported by object identity from committed positive fixture sources and are not copied, reconstructed, regenerated, read from disk, sourced from repository data, deployed data, external services, secrets, private material, or document sources",
    corpus_status: "corpus_only",
    usable_document_claim: false,
    source_eligibility_claim: false,
    production_detector_claim: false,
    production_detector_answer_key: false,
    malformed_fixture_claim: false,
    unsupported_fixture_claim: false,
    disallowed_signature_fixture_claim: false,
    ambiguous_fixture_claim: false,
    unknown_binary_fixture_claim: false,
    dependency_added_claim: false,
    runtime_mime_behavior_claim: false,
  });
}

export const DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES = Object.freeze([
  fixture({
    fixture_id: "DETPERMTYPE-P0-05F-2D0-001-BLOCK-TXT-TEXT-PLAIN-PDF-BYTES",
    description: "Permitted .txt plus text/plain metadata blocks when imported positive PDF shallow-identity bytes establish PDF.",
    bytes: sourcePdfBytes,
    detected_type: "pdf",
    detected_mime: "application/pdf",
    byte_source_module: DETECTED_PERMITTED_TYPE_CONTRADICTION_SOURCE_MODULES.pdf,
    byte_source_export_or_property: DETECTED_PERMITTED_TYPE_CONTRADICTION_PDF_SOURCE_PROPERTY,
    byte_source_fixture_id: EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"].source_id,
    byte_source_kind: "imported_p0_05f_2b2a_positive_pdf_bytes",
    fixture_family: "text_metadata_with_detected_permitted_pdf_bytes",
    xlsx_zip_prefix_present: false,
  }),
  fixture({
    fixture_id: "DETPERMTYPE-P0-05F-2D0-002-BLOCK-TXT-TEXT-PLAIN-XLSX-BYTES",
    description: "Permitted .txt plus text/plain metadata blocks when imported positive XLSX shallow-identity bytes establish XLSX.",
    bytes: sourceXlsxFixture.bytes,
    detected_type: "xlsx",
    detected_mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    byte_source_module: DETECTED_PERMITTED_TYPE_CONTRADICTION_SOURCE_MODULES.xlsx,
    byte_source_export_or_property: DETECTED_PERMITTED_TYPE_CONTRADICTION_XLSX_SOURCE_EXPORT,
    byte_source_fixture_id: sourceXlsxFixture.fixture_id,
    byte_source_kind: "imported_p0_05f_2a_positive_xlsx_bytes",
    fixture_family: "text_metadata_with_detected_permitted_xlsx_bytes",
    xlsx_zip_prefix_present: true,
  }),
]);

export function getDetectedPermittedTypeContradictionFixtureExpectations() {
  return DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES.map((item) =>
    Object.freeze({
      fixture_id: item.fixture_id,
      normalized_extension: item.normalized_extension,
      normalized_declared_mime: item.normalized_declared_mime,
      detected_type: item.detected_type,
      expected_policy: item.expected_policy,
      expected_category: item.expected_category,
      scope_note: item.scope_note,
      authority: item.authority,
    }),
  );
}
