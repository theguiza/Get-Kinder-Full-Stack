import test from "node:test";
import assert from "node:assert/strict";

import {
  EXTENSION_MIME_MATRIX_ALLOWED_PAIRINGS,
  EXTENSION_MIME_MATRIX_BYTE_SOURCES,
} from "./support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js";
import {
  XLSX_ZIP_FIXTURES,
  XLSX_ZIP_REQUIRED_ENTRIES,
} from "./support/kaiSprint2XlsxZipFixtureCorpus.js";
import {
  DETECTED_PERMITTED_TYPE_CONTRADICTION_AUTHORITY,
  DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES,
  DETECTED_PERMITTED_TYPE_CONTRADICTION_PDF_SOURCE_PROPERTY,
  DETECTED_PERMITTED_TYPE_CONTRADICTION_SOURCE_MODULES,
  DETECTED_PERMITTED_TYPE_CONTRADICTION_XLSX_SOURCE_EXPORT,
  DETECTED_PERMITTED_TYPE_CONTRADICTION_XLSX_SOURCE_FIXTURE_ID,
  getDetectedPermittedTypeContradictionFixtureExpectations,
} from "./support/kaiSprint2DetectedPermittedTypeContradictionFixtureCorpus.js";

const textDecoder = new TextDecoder("utf-8", { fatal: true });

const PDF_HEADER = Object.freeze([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PDF_EOF = Object.freeze([0x25, 0x25, 0x45, 0x4f, 0x46]);
const permittedDetectedTypes = new Set(["pdf", "xlsx"]);
const requiredEntrySet = new Set(XLSX_ZIP_REQUIRED_ENTRIES);

const expectedFixtureIds = Object.freeze([
  "DETPERMTYPE-P0-05F-2D0-001-BLOCK-TXT-TEXT-PLAIN-PDF-BYTES",
  "DETPERMTYPE-P0-05F-2D0-002-BLOCK-TXT-TEXT-PLAIN-XLSX-BYTES",
]);

const fixtureKeys = Object.freeze([
  "fixture_id",
  "description",
  "extension",
  "normalized_extension",
  "declared_mime",
  "normalized_declared_mime",
  "jointly_declared_metadata_type",
  "bytes",
  "byte_length",
  "detected_type",
  "detected_mime",
  "detected_type_is_permitted",
  "metadata_pairing_permitted",
  "extension_and_mime_agree",
  "declared_type_differs_from_detected_type",
  "expected_policy",
  "expected_category",
  "scope_note",
  "authority",
  "fixture_family",
  "byte_source_module",
  "byte_source_export_or_property",
  "byte_source_fixture_id",
  "byte_source_kind",
  "derivation",
  "classification_exclusions",
  "zip_prefix_present",
  "complete_xlsx_identity_prevents_standalone_zip_classification",
  "synthetic_provenance",
  "corpus_status",
  "usable_document_claim",
  "source_eligibility_claim",
  "production_detector_claim",
  "production_detector_answer_key",
  "malformed_fixture_claim",
  "unsupported_fixture_claim",
  "disallowed_signature_fixture_claim",
  "ambiguous_fixture_claim",
  "unknown_binary_fixture_claim",
  "dependency_added_claim",
  "runtime_mime_behavior_claim",
]);

const classificationExclusionKeys = Object.freeze([
  "unsupported_file_type",
  "truncated_or_malformed_type",
  "disallowed_binary_signature",
  "standalone_archive_or_non_xlsx",
  "ambiguous_file_type",
  "unknown_binary",
]);

function readUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}

function hasSignature(bytes, offset, signature) {
  return offset >= 0 && offset + 4 <= bytes.byteLength && readUint32LE(bytes, offset) === signature;
}

function markerBytesEqual(bytes, offset, marker) {
  if (offset < 0 || offset + marker.length > bytes.byteLength) return false;
  return marker.every((byte, index) => bytes[offset + index] === byte);
}

function findAllMarkerOffsets(bytes, marker) {
  const offsets = [];
  for (let offset = 0; offset <= bytes.byteLength - marker.length; offset += 1) {
    if (markerBytesEqual(bytes, offset, marker)) offsets.push(offset);
  }
  return offsets;
}

function findEocdOffset(bytes) {
  const minimumEocdLength = 22;
  for (let offset = bytes.byteLength - minimumEocdLength; offset >= 0; offset -= 1) {
    if (hasSignature(bytes, offset, 0x06054b50)) return offset;
  }
  return -1;
}

function parseZipDirectory(bytes) {
  const proof = {
    begins_with_local_file_header_signature: hasSignature(bytes, 0, 0x04034b50),
    eocd_offset: null,
    readable_eocd: false,
    readable_central_directory: false,
    directory_bounds_valid: false,
    record_boundaries_valid: false,
    local_header_offsets_valid: false,
    entry_count_valid: false,
    entry_names: [],
    entry_name_set: new Set(),
    central_directory_offset: null,
    central_directory_length: null,
    central_directory_end: null,
    expected_entry_count: null,
    parsed_entry_count: 0,
    local_header_offsets: [],
    decompressed_entry_content: false,
    raw_byte_search_used_for_entry_presence: false,
    defect: null,
  };

  const eocdOffset = findEocdOffset(bytes);
  proof.eocd_offset = eocdOffset;
  if (eocdOffset < 0) {
    proof.defect = "missing end-of-central-directory record";
    return proof;
  }

  if (eocdOffset + 22 > bytes.byteLength) {
    proof.defect = "truncated end-of-central-directory record";
    return proof;
  }

  const commentLength = readUint16LE(bytes, eocdOffset + 20);
  if (eocdOffset + 22 + commentLength > bytes.byteLength) {
    proof.defect = "end-of-central-directory comment exceeds fixture bounds";
    return proof;
  }

  proof.readable_eocd = true;
  proof.expected_entry_count = readUint16LE(bytes, eocdOffset + 10);
  proof.central_directory_length = readUint32LE(bytes, eocdOffset + 12) >>> 0;
  proof.central_directory_offset = readUint32LE(bytes, eocdOffset + 16) >>> 0;
  proof.central_directory_end = proof.central_directory_offset + proof.central_directory_length;

  if (
    proof.central_directory_offset > bytes.byteLength ||
    proof.central_directory_length > bytes.byteLength ||
    proof.central_directory_end > bytes.byteLength ||
    proof.central_directory_end > eocdOffset
  ) {
    proof.defect = "central-directory offset or length is out of fixture bounds";
    return proof;
  }

  proof.directory_bounds_valid = true;
  proof.readable_central_directory = true;

  let offset = proof.central_directory_offset;
  while (offset < proof.central_directory_end) {
    if (offset + 46 > proof.central_directory_end) {
      proof.defect = "central-directory record fixed header is truncated";
      return proof;
    }
    if (!hasSignature(bytes, offset, 0x02014b50)) {
      proof.defect = "central-directory record signature is invalid";
      return proof;
    }

    const nameLength = readUint16LE(bytes, offset + 28);
    const extraLength = readUint16LE(bytes, offset + 30);
    const commentLengthForRecord = readUint16LE(bytes, offset + 32);
    const recordLength = 46 + nameLength + extraLength + commentLengthForRecord;
    const nextOffset = offset + recordLength;
    if (recordLength < 46 || nextOffset > proof.central_directory_end) {
      proof.defect = "central-directory record length exceeds recorded directory bounds";
      return proof;
    }

    const localHeaderOffset = readUint32LE(bytes, offset + 42) >>> 0;
    if (!hasSignature(bytes, localHeaderOffset, 0x04034b50)) {
      proof.defect = "central-directory local-header offset does not point to a valid local-file-header";
      return proof;
    }

    const name = textDecoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    proof.entry_names.push(name);
    proof.entry_name_set.add(name);
    proof.local_header_offsets.push(localHeaderOffset);
    offset = nextOffset;
  }

  proof.record_boundaries_valid = offset === proof.central_directory_end;
  proof.local_header_offsets_valid = true;
  proof.parsed_entry_count = proof.entry_names.length;
  proof.entry_count_valid = proof.expected_entry_count === proof.parsed_entry_count;

  if (!proof.entry_count_valid) {
    proof.defect = "parsed central-directory entry count does not match EOCD metadata";
  }

  return proof;
}

function p0PairIsAllowed(extension, declaredMime) {
  return EXTENSION_MIME_MATRIX_ALLOWED_PAIRINGS.some(
    (pairing) => pairing.normalized_extension === extension && pairing.normalized_declared_mime === declaredMime,
  );
}

function fixtureById(fixtureId) {
  const fixture = DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES.find((item) => item.fixture_id === fixtureId);
  assert.ok(fixture, fixtureId);
  return fixture;
}

function sourceXlsxFixture() {
  const fixture = XLSX_ZIP_FIXTURES.find(
    (item) => item.fixture_id === DETECTED_PERMITTED_TYPE_CONTRADICTION_XLSX_SOURCE_FIXTURE_ID,
  );
  assert.ok(fixture);
  return fixture;
}

function assertCompleteXlsxIdentity(fixture) {
  const proof = parseZipDirectory(fixture.bytes);
  assert.equal(proof.begins_with_local_file_header_signature, true, fixture.fixture_id);
  assert.equal(proof.readable_eocd, true, fixture.fixture_id);
  assert.equal(proof.readable_central_directory, true, fixture.fixture_id);
  assert.equal(proof.directory_bounds_valid, true, fixture.fixture_id);
  assert.equal(proof.record_boundaries_valid, true, fixture.fixture_id);
  assert.equal(proof.local_header_offsets_valid, true, fixture.fixture_id);
  assert.equal(proof.entry_count_valid, true, fixture.fixture_id);
  assert.deepEqual(proof.entry_names, XLSX_ZIP_REQUIRED_ENTRIES, fixture.fixture_id);
  assert.deepEqual([...proof.entry_name_set].sort(), [...requiredEntrySet].sort(), fixture.fixture_id);
  assert.equal(proof.expected_entry_count, XLSX_ZIP_REQUIRED_ENTRIES.length, fixture.fixture_id);
  assert.equal(proof.parsed_entry_count, XLSX_ZIP_REQUIRED_ENTRIES.length, fixture.fixture_id);
  assert.equal(proof.central_directory_offset > 0, true, fixture.fixture_id);
  assert.equal(proof.central_directory_length > 0, true, fixture.fixture_id);
  assert.equal(proof.central_directory_end <= fixture.bytes.byteLength, true, fixture.fixture_id);
  assert.equal(proof.local_header_offsets.every((offset) => hasSignature(fixture.bytes, offset, 0x04034b50)), true, fixture.fixture_id);
  assert.equal(proof.decompressed_entry_content, false, fixture.fixture_id);
  assert.equal(proof.raw_byte_search_used_for_entry_presence, false, fixture.fixture_id);
  assert.equal(proof.defect, null, fixture.fixture_id);
  return proof;
}

test("P0-05F.2d0 detected permitted-type contradiction corpus has exactly two unique closed-schema fixtures", () => {
  assert.deepEqual(DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES.map((fixture) => fixture.fixture_id), expectedFixtureIds);
  assert.equal(new Set(DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES.map((fixture) => fixture.fixture_id)).size, 2);

  for (const fixture of DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES) {
    assert.deepEqual(Object.keys(fixture), fixtureKeys, fixture.fixture_id);
    assert.equal(fixture.extension, ".txt", fixture.fixture_id);
    assert.equal(fixture.normalized_extension, ".txt", fixture.fixture_id);
    assert.equal(fixture.declared_mime, "text/plain", fixture.fixture_id);
    assert.equal(fixture.normalized_declared_mime, "text/plain", fixture.fixture_id);
    assert.equal(fixture.jointly_declared_metadata_type, "text", fixture.fixture_id);
    assert.ok(fixture.bytes instanceof Uint8Array, fixture.fixture_id);
    assert.equal(fixture.byte_length, fixture.bytes.byteLength, fixture.fixture_id);
    assert.equal(fixture.metadata_pairing_permitted, true, fixture.fixture_id);
    assert.equal(p0PairIsAllowed(fixture.normalized_extension, fixture.normalized_declared_mime), true, fixture.fixture_id);
    assert.equal(fixture.extension_and_mime_agree, true, fixture.fixture_id);
    assert.equal(fixture.detected_type_is_permitted, true, fixture.fixture_id);
    assert.equal(permittedDetectedTypes.has(fixture.detected_type), true, fixture.fixture_id);
    assert.equal(fixture.declared_type_differs_from_detected_type, true, fixture.fixture_id);
    assert.equal(fixture.expected_policy, "block", fixture.fixture_id);
    assert.equal(fixture.expected_category, "declared_type_mismatch", fixture.fixture_id);
    assert.equal(fixture.scope_note, "detected_permitted_type_contradiction_only", fixture.fixture_id);
    assert.equal(fixture.authority, DETECTED_PERMITTED_TYPE_CONTRADICTION_AUTHORITY, fixture.fixture_id);
    assert.equal(fixture.corpus_status, "corpus_only", fixture.fixture_id);
    assert.ok(fixture.synthetic_provenance.includes("synthetic"), fixture.fixture_id);
    assert.ok(fixture.synthetic_provenance.includes("imported by object identity"), fixture.fixture_id);
    assert.equal(fixture.usable_document_claim, false, fixture.fixture_id);
    assert.equal(fixture.source_eligibility_claim, false, fixture.fixture_id);
    assert.equal(fixture.production_detector_claim, false, fixture.fixture_id);
    assert.equal(fixture.production_detector_answer_key, false, fixture.fixture_id);
    assert.equal(fixture.malformed_fixture_claim, false, fixture.fixture_id);
    assert.equal(fixture.unsupported_fixture_claim, false, fixture.fixture_id);
    assert.equal(fixture.disallowed_signature_fixture_claim, false, fixture.fixture_id);
    assert.equal(fixture.ambiguous_fixture_claim, false, fixture.fixture_id);
    assert.equal(fixture.unknown_binary_fixture_claim, false, fixture.fixture_id);
    assert.equal(fixture.dependency_added_claim, false, fixture.fixture_id);
    assert.equal(fixture.runtime_mime_behavior_claim, false, fixture.fixture_id);
    assert.deepEqual(Object.keys(fixture.classification_exclusions), classificationExclusionKeys, fixture.fixture_id);
    for (const category of classificationExclusionKeys) {
      assert.equal(fixture.classification_exclusions[category], false, `${fixture.fixture_id} ${category}`);
    }
  }

  assert.deepEqual(
    getDetectedPermittedTypeContradictionFixtureExpectations().map((fixture) => fixture.fixture_id),
    expectedFixtureIds,
  );
});

test("PDF contradiction fixture imports the positive PDF source by object identity and preserves complete PDF shallow identity", () => {
  const fixture = fixtureById("DETPERMTYPE-P0-05F-2D0-001-BLOCK-TXT-TEXT-PLAIN-PDF-BYTES");
  const sourceBytes = EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"].bytes;
  const headerOffsets = findAllMarkerOffsets(fixture.bytes, PDF_HEADER);
  const eofOffsets = findAllMarkerOffsets(fixture.bytes, PDF_EOF);
  const qualifyingEofOffsets = eofOffsets.filter((offset) => fixture.bytes.byteLength - offset <= 1024);

  assert.equal(fixture.byte_source_module, DETECTED_PERMITTED_TYPE_CONTRADICTION_SOURCE_MODULES.pdf);
  assert.equal(fixture.byte_source_export_or_property, DETECTED_PERMITTED_TYPE_CONTRADICTION_PDF_SOURCE_PROPERTY);
  assert.equal(fixture.byte_source_fixture_id, EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"].source_id);
  assert.equal(fixture.byte_source_kind, "imported_p0_05f_2b2a_positive_pdf_bytes");
  assert.equal(fixture.bytes, sourceBytes);
  assert.deepEqual(headerOffsets, [0]);
  assert.ok(eofOffsets.length >= 1);
  assert.deepEqual(qualifyingEofOffsets, eofOffsets);
  assert.equal(fixture.detected_type, "pdf");
  assert.equal(fixture.detected_mime, "application/pdf");
  assert.equal(fixture.zip_prefix_present, false);
  assert.equal(fixture.complete_xlsx_identity_prevents_standalone_zip_classification, false);
  assert.equal(fixture.classification_exclusions.truncated_or_malformed_type, false);
  assert.equal(fixture.classification_exclusions.unsupported_file_type, false);
  assert.equal(fixture.classification_exclusions.disallowed_binary_signature, false);
  assert.equal(fixture.classification_exclusions.ambiguous_file_type, false);
  assert.equal(fixture.classification_exclusions.unknown_binary, false);
});

test("XLSX contradiction fixture imports the positive XLSX source by object identity and proves XLSX through parsed ZIP structure", () => {
  const fixture = fixtureById("DETPERMTYPE-P0-05F-2D0-002-BLOCK-TXT-TEXT-PLAIN-XLSX-BYTES");
  const sourceFixture = sourceXlsxFixture();
  const proof = assertCompleteXlsxIdentity(fixture);

  assert.equal(fixture.byte_source_module, DETECTED_PERMITTED_TYPE_CONTRADICTION_SOURCE_MODULES.xlsx);
  assert.equal(fixture.byte_source_export_or_property, DETECTED_PERMITTED_TYPE_CONTRADICTION_XLSX_SOURCE_EXPORT);
  assert.equal(fixture.byte_source_fixture_id, DETECTED_PERMITTED_TYPE_CONTRADICTION_XLSX_SOURCE_FIXTURE_ID);
  assert.equal(fixture.byte_source_kind, "imported_p0_05f_2a_positive_xlsx_bytes");
  assert.equal(fixture.bytes, sourceFixture.bytes);
  assert.equal(fixture.detected_type, "xlsx");
  assert.equal(fixture.detected_mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(fixture.zip_prefix_present, true);
  assert.equal(proof.begins_with_local_file_header_signature, true);
  assert.equal(proof.readable_eocd, true);
  assert.equal(proof.directory_bounds_valid, true);
  assert.equal(proof.record_boundaries_valid, true);
  assert.equal(proof.local_header_offsets_valid, true);
  assert.equal(proof.entry_count_valid, true);
  assert.equal(fixture.classification_exclusions.truncated_or_malformed_type, false);
  assert.equal(fixture.classification_exclusions.standalone_archive_or_non_xlsx, false);
  assert.equal(fixture.classification_exclusions.disallowed_binary_signature, false);
});

test("permitted text metadata plus permitted byte identity isolates only the declared metadata type versus detected permitted-type contradiction", () => {
  for (const fixture of DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES) {
    assert.equal(fixture.normalized_extension, ".txt", fixture.fixture_id);
    assert.equal(fixture.normalized_declared_mime, "text/plain", fixture.fixture_id);
    assert.equal(p0PairIsAllowed(fixture.normalized_extension, fixture.normalized_declared_mime), true, fixture.fixture_id);
    assert.equal(fixture.metadata_pairing_permitted, true, fixture.fixture_id);
    assert.equal(fixture.extension_and_mime_agree, true, fixture.fixture_id);
    assert.equal(fixture.detected_type_is_permitted, true, fixture.fixture_id);
    assert.equal(fixture.declared_type_differs_from_detected_type, true, fixture.fixture_id);
    assert.equal(fixture.expected_category, "declared_type_mismatch", fixture.fixture_id);
    assert.equal(fixture.scope_note, "detected_permitted_type_contradiction_only", fixture.fixture_id);
  }
});

test("complete XLSX identity takes precedence over standalone ZIP and disallowed ZIP-signature classification", () => {
  const fixture = fixtureById("DETPERMTYPE-P0-05F-2D0-002-BLOCK-TXT-TEXT-PLAIN-XLSX-BYTES");
  const proof = assertCompleteXlsxIdentity(fixture);

  assert.equal(proof.begins_with_local_file_header_signature, true);
  assert.equal(fixture.zip_prefix_present, true);
  assert.equal(fixture.complete_xlsx_identity_prevents_standalone_zip_classification, true);
  assert.equal(fixture.classification_exclusions.standalone_archive_or_non_xlsx, false);
  assert.equal(fixture.classification_exclusions.disallowed_binary_signature, false);
  assert.equal(fixture.expected_category, "declared_type_mismatch");
});
