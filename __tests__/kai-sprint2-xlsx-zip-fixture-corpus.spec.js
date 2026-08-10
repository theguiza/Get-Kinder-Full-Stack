import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  EXTENSION_MIME_MATRIX_ALLOWED_PAIRINGS,
} from "./support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js";
import {
  XLSX_ZIP_FIXTURE_AUTHORITY_MAP,
  XLSX_ZIP_FIXTURE_CATEGORIES,
  XLSX_ZIP_FIXTURE_CORPUS_STATUSES,
  XLSX_ZIP_FIXTURE_POLICIES,
  XLSX_ZIP_FIXTURES,
  XLSX_ZIP_REQUIRED_ENTRIES,
  getXlsxZipFixtureExpectations,
} from "./support/kaiSprint2XlsxZipFixtureCorpus.js";

const textDecoder = new TextDecoder("utf-8", { fatal: true });

const fixtureKeys = Object.freeze([
  "fixture_id",
  "description",
  "extension",
  "declared_mime",
  "bytes",
  "entries",
  "expected_policy",
  "expected_category",
  "authority",
  "fixture_family",
  "structural_claim",
  "missing_required_entry",
  "wrong_case_entry",
  "malformed_defect",
  "synthetic_provenance",
  "corpus_status",
  "decompression_required",
  "raw_byte_search_proves_entry_presence",
  "production_detector_claim",
]);

const authorityKeys = Object.freeze([
  "source_document",
  "section_or_decision_key",
  "requirement_summary",
  "supported_expected_policy",
  "supported_expected_category",
  "authority_status",
]);

const expectedFixtureIds = Object.freeze([
  "XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX",
  "XLSXZIP-P0-05F-002-BLOCK-MISSING-CONTENT-TYPES",
  "XLSXZIP-P0-05F-003-BLOCK-MISSING-RELS",
  "XLSXZIP-P0-05F-004-BLOCK-MISSING-WORKBOOK",
  "XLSXZIP-P0-05F-005-BLOCK-WRONG-CASE-WORKBOOK",
  "XLSXZIP-P0-05F-006-BLOCK-RENAMED-NON-OOXML-ZIP",
  "XLSXZIP-P0-05F-007-BLOCK-ARBITRARY-ZIP-NON-XLSX-METADATA",
  "XLSXZIP-P0-05F-008-BLOCK-XLSX-METADATA-MISSING-OOXML",
  "XLSXZIP-P0-05F-010-BLOCK-TRUNCATED-LOCAL-SIGNATURE",
  "XLSXZIP-P0-05F-011-BLOCK-NO-CENTRAL-DIRECTORY",
  "XLSXZIP-P0-05F-012-BLOCK-OUT-OF-BOUNDS-CD-OFFSET",
  "XLSXZIP-P0-05F-013-BLOCK-TRUNCATED-CD-RECORD",
]);

const XLSX_DECLARED_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const removedStandaloneZipFixtureId = ["XLSXZIP", "P0", "05F", "009", "BLOCK", "STANDALONE", "ZIP", "SIGNATURE"].join("-");
const policyAllowlist = new Set(XLSX_ZIP_FIXTURE_POLICIES);
const categoryAllowlist = new Set(XLSX_ZIP_FIXTURE_CATEGORIES);
const corpusStatusAllowlist = new Set(XLSX_ZIP_FIXTURE_CORPUS_STATUSES);
const requiredEntrySet = new Set(XLSX_ZIP_REQUIRED_ENTRIES);

function readUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}

function hasSignature(bytes, offset, signature) {
  return offset >= 0 && offset + 4 <= bytes.byteLength && readUint32LE(bytes, offset) === signature;
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
    return proof;
  }

  return proof;
}

function fixtureById(fixtureId) {
  const fixture = XLSX_ZIP_FIXTURES.find((item) => item.fixture_id === fixtureId);
  assert.ok(fixture, fixtureId);
  return fixture;
}

function assertReadableZipProof(fixture, proof) {
  assert.equal(proof.begins_with_local_file_header_signature, true, fixture.fixture_id);
  assert.equal(proof.readable_eocd, true, fixture.fixture_id);
  assert.equal(proof.readable_central_directory, true, fixture.fixture_id);
  assert.equal(proof.directory_bounds_valid, true, fixture.fixture_id);
  assert.equal(proof.record_boundaries_valid, true, fixture.fixture_id);
  assert.equal(proof.local_header_offsets_valid, true, fixture.fixture_id);
  assert.equal(proof.entry_count_valid, true, fixture.fixture_id);
  assert.equal(proof.decompressed_entry_content, false, fixture.fixture_id);
  assert.equal(proof.raw_byte_search_used_for_entry_presence, false, fixture.fixture_id);
}

function p0PairIsAllowed(extension, declaredMime) {
  return EXTENSION_MIME_MATRIX_ALLOWED_PAIRINGS.some(
    (pairing) => pairing.normalized_extension === extension && pairing.normalized_declared_mime === declaredMime,
  );
}

function completeXlsxIdentityPresent(proof) {
  return XLSX_ZIP_REQUIRED_ENTRIES.every((name) => proof.entry_name_set.has(name));
}

test("XLSX/ZIP fixture authority map is closed and grounded in P0-05F", () => {
  for (const [authorityId, authority] of Object.entries(XLSX_ZIP_FIXTURE_AUTHORITY_MAP)) {
    assert.deepEqual(Object.keys(authority), authorityKeys, authorityId);
    assert.match(authorityId, /^OWNER_DECISION\.P0_05F\./, authorityId);
    assert.equal(authority.source_document, "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md", authorityId);
    assert.match(authority.section_or_decision_key, /P0-05F/, authorityId);
    assert.notEqual(authority.requirement_summary.trim(), "", authorityId);
    assert.ok(policyAllowlist.has(authority.supported_expected_policy), authorityId);
    assert.ok(categoryAllowlist.has(authority.supported_expected_category), authorityId);
    assert.equal(authority.authority_status, "contract_grounded", authorityId);
    assert.doesNotMatch(
      `${authority.section_or_decision_key} ${authority.requirement_summary}`,
      /current detector|runtime behavior|upload transport|parser|profiler|profile eligibility/i,
      authorityId,
    );
  }
});

test("XLSX/ZIP fixtures are synthetic, ordered, complete, closed-schema, and in-memory only", () => {
  assert.equal(XLSX_ZIP_FIXTURES.length, 12);
  assert.deepEqual(
    XLSX_ZIP_FIXTURES.map((fixture) => fixture.fixture_id),
    expectedFixtureIds,
  );
  assert.equal(new Set(XLSX_ZIP_FIXTURES.map((fixture) => fixture.fixture_id)).size, XLSX_ZIP_FIXTURES.length);
  assert.equal(
    XLSX_ZIP_FIXTURES.some((fixture) => fixture.fixture_id === removedStandaloneZipFixtureId),
    false,
  );

  for (const fixture of XLSX_ZIP_FIXTURES) {
    assert.deepEqual(Object.keys(fixture), fixtureKeys, fixture.fixture_id);
    assert.equal(typeof fixture.extension, "string", fixture.fixture_id);
    assert.notEqual(fixture.extension, "", fixture.fixture_id);
    assert.equal(typeof fixture.declared_mime, "string", fixture.fixture_id);
    assert.notEqual(fixture.declared_mime, "", fixture.fixture_id);
    assert.ok(fixture.bytes instanceof Uint8Array, fixture.fixture_id);
    assert.ok(policyAllowlist.has(fixture.expected_policy), fixture.fixture_id);
    assert.ok(categoryAllowlist.has(fixture.expected_category), fixture.fixture_id);
    assert.ok(corpusStatusAllowlist.has(fixture.corpus_status), fixture.fixture_id);
    assert.equal(fixture.corpus_status, "corpus_only", fixture.fixture_id);
    assert.ok(Object.hasOwn(XLSX_ZIP_FIXTURE_AUTHORITY_MAP, fixture.authority), fixture.fixture_id);
    assert.equal(fixture.decompression_required, false, fixture.fixture_id);
    assert.equal(fixture.raw_byte_search_proves_entry_presence, false, fixture.fixture_id);
    assert.equal(fixture.production_detector_claim, false, fixture.fixture_id);
    assert.ok(fixture.synthetic_provenance.includes("synthetic deterministic in-memory ZIP bytes"), fixture.fixture_id);
    assert.doesNotMatch(fixture.synthetic_provenance, /customer|database|cloud|filesystem|credential/i, fixture.fixture_id);
  }

  for (const fixture of XLSX_ZIP_FIXTURES.filter(
    (item) => item.fixture_id !== "XLSXZIP-P0-05F-007-BLOCK-ARBITRARY-ZIP-NON-XLSX-METADATA",
  )) {
    assert.equal(fixture.extension, ".xlsx", fixture.fixture_id);
    assert.equal(fixture.declared_mime, XLSX_DECLARED_MIME, fixture.fixture_id);
  }

  assert.deepEqual(
    getXlsxZipFixtureExpectations().map((fixture) => fixture.fixture_id),
    expectedFixtureIds,
  );
});

test("positive XLSX fixture identity is proven through parsed central-directory records", () => {
  const fixture = fixtureById("XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX");
  const proof = parseZipDirectory(fixture.bytes);
  const finalReport = {
    positive_xlsx_central_directory_parser_used: true,
    positive_xlsx_entry_names_obtained_from_parsed_directory_records: proof.entry_names,
    no_raw_byte_string_search_established_entry_presence: proof.raw_byte_search_used_for_entry_presence === false,
    positive_xlsx_directory_bounds_and_local_header_offsets_valid:
      proof.directory_bounds_valid && proof.local_header_offsets_valid,
    no_entry_content_was_decompressed: proof.decompressed_entry_content === false,
  };

  assertReadableZipProof(fixture, proof);
  assert.equal(fixture.expected_policy, "allow");
  assert.equal(fixture.expected_category, "type_agreement_pass");
  assert.deepEqual(proof.entry_names, XLSX_ZIP_REQUIRED_ENTRIES);
  assert.deepEqual([...proof.entry_name_set].sort(), [...requiredEntrySet].sort());
  assert.equal(proof.central_directory_offset > 0, true);
  assert.equal(proof.central_directory_length > 0, true);
  assert.equal(proof.local_header_offsets.every((offset) => hasSignature(fixture.bytes, offset, 0x04034b50)), true);
  assert.equal(finalReport.positive_xlsx_central_directory_parser_used, true);
  assert.deepEqual(finalReport.positive_xlsx_entry_names_obtained_from_parsed_directory_records, XLSX_ZIP_REQUIRED_ENTRIES);
  assert.equal(finalReport.no_raw_byte_string_search_established_entry_presence, true);
  assert.equal(finalReport.positive_xlsx_directory_bounds_and_local_header_offsets_valid, true);
  assert.equal(finalReport.no_entry_content_was_decompressed, true);
});

test("missing-entry XLSX fixtures are readable ZIPs minus exactly one required entry", () => {
  const missingFixtures = XLSX_ZIP_FIXTURES.filter((fixture) => fixture.missing_required_entry && fixture.fixture_family === "readable_zip_missing_or_non_xlsx_identity");
  assert.deepEqual(
    missingFixtures.map((fixture) => fixture.fixture_id),
    [
      "XLSXZIP-P0-05F-002-BLOCK-MISSING-CONTENT-TYPES",
      "XLSXZIP-P0-05F-003-BLOCK-MISSING-RELS",
      "XLSXZIP-P0-05F-004-BLOCK-MISSING-WORKBOOK",
    ],
  );

  const finalReportRows = [];
  for (const fixture of missingFixtures) {
    const proof = parseZipDirectory(fixture.bytes);
    assertReadableZipProof(fixture, proof);
    assert.equal(fixture.expected_policy, "block", fixture.fixture_id);
    assert.equal(fixture.expected_category, "standalone_archive_or_non_xlsx", fixture.fixture_id);
    assert.equal(proof.entry_names.length, 2, fixture.fixture_id);
    assert.equal(proof.entry_name_set.has(fixture.missing_required_entry), false, fixture.fixture_id);

    const presentRequired = XLSX_ZIP_REQUIRED_ENTRIES.filter((name) => proof.entry_name_set.has(name));
    const absentRequired = XLSX_ZIP_REQUIRED_ENTRIES.filter((name) => !proof.entry_name_set.has(name));
    assert.deepEqual(absentRequired, [fixture.missing_required_entry], fixture.fixture_id);
    assert.equal(presentRequired.length, 2, fixture.fixture_id);
    assert.equal(proof.defect, null, fixture.fixture_id);

    finalReportRows.push({
      fixture_id: fixture.fixture_id,
      readable_zip_confirmed: true,
      two_remaining_required_entries_present: presentRequired.length === 2,
      exactly_one_required_entry_absent: absentRequired.length === 1,
      expected_category: fixture.expected_category,
    });
  }

  assert.equal(finalReportRows.every((row) => row.readable_zip_confirmed), true);
  assert.equal(finalReportRows.every((row) => row.two_remaining_required_entries_present), true);
  assert.equal(finalReportRows.every((row) => row.exactly_one_required_entry_absent), true);
  assert.equal(finalReportRows.every((row) => row.expected_category === "standalone_archive_or_non_xlsx"), true);
});

test("wrong-case XLSX fixture is readable and fails only exact case-sensitive name matching", () => {
  const fixture = fixtureById("XLSXZIP-P0-05F-005-BLOCK-WRONG-CASE-WORKBOOK");
  const proof = parseZipDirectory(fixture.bytes);
  const absentRequired = XLSX_ZIP_REQUIRED_ENTRIES.filter((name) => !proof.entry_name_set.has(name));

  assertReadableZipProof(fixture, proof);
  assert.equal(proof.entry_name_set.has("xl/workbook.xml"), false);
  assert.equal(proof.entry_name_set.has("xl/Workbook.xml"), true);
  assert.deepEqual(absentRequired, ["xl/workbook.xml"]);
  assert.equal(proof.entry_name_set.has("[Content_Types].xml"), true);
  assert.equal(proof.entry_name_set.has("_rels/.rels"), true);
  assert.equal(fixture.expected_category, "standalone_archive_or_non_xlsx");
});

test("renamed and generic standalone ZIP fixtures remain readable but non-XLSX", () => {
  const readableStandaloneFixtures = XLSX_ZIP_FIXTURES.filter((fixture) =>
    [
      "readable_renamed_non_ooxml_zip",
      "readable_arbitrary_zip",
      "readable_zip_xlsx_metadata_missing_ooxml",
    ].includes(fixture.fixture_family),
  );

  for (const fixture of readableStandaloneFixtures) {
    const proof = parseZipDirectory(fixture.bytes);
    assertReadableZipProof(fixture, proof);
    assert.equal(fixture.expected_policy, "block", fixture.fixture_id);
    assert.equal(fixture.expected_category, "standalone_archive_or_non_xlsx", fixture.fixture_id);
    assert.equal(XLSX_ZIP_REQUIRED_ENTRIES.every((name) => proof.entry_name_set.has(name)), false, fixture.fixture_id);
    assert.equal(proof.raw_byte_search_used_for_entry_presence, false, fixture.fixture_id);
    assert.equal(proof.decompressed_entry_content, false, fixture.fixture_id);
  }

  const renamed = fixtureById("XLSXZIP-P0-05F-006-BLOCK-RENAMED-NON-OOXML-ZIP");
  const renamedProof = parseZipDirectory(renamed.bytes);
  assert.equal(renamedProof.entry_name_set.has("xl/workbook.xml.txt"), true);
  assert.equal(renamedProof.entry_name_set.has("xl/workbook.xml"), false);
  assert.equal(renamedProof.entry_name_set.has("[Content_Types].xml"), false);
});

test("fixtures 007 and 008 prove the two readable ZIP metadata classes without complete XLSX identity", () => {
  const permittedNonXlsxMetadata = fixtureById("XLSXZIP-P0-05F-007-BLOCK-ARBITRARY-ZIP-NON-XLSX-METADATA");
  const xlsxMetadata = fixtureById("XLSXZIP-P0-05F-008-BLOCK-XLSX-METADATA-MISSING-OOXML");
  const canonicalCoverage = new Map([
    ["permitted non-XLSX metadata + readable non-XLSX ZIP", permittedNonXlsxMetadata.fixture_id],
    ["XLSX metadata + readable non-XLSX ZIP", xlsxMetadata.fixture_id],
  ]);

  assert.equal(permittedNonXlsxMetadata.extension, ".txt");
  assert.equal(permittedNonXlsxMetadata.declared_mime, "text/plain");
  assert.equal(p0PairIsAllowed(permittedNonXlsxMetadata.extension, permittedNonXlsxMetadata.declared_mime), true);
  assert.equal(permittedNonXlsxMetadata.bytes.byteLength, 232);
  assert.equal(permittedNonXlsxMetadata.expected_policy, "block");
  assert.equal(permittedNonXlsxMetadata.expected_category, "standalone_archive_or_non_xlsx");
  for (const excludedCategory of [
    "declared_type_mismatch",
    "disallowed_binary_signature",
    "truncated_or_malformed_type",
    "unsupported_file_type",
    "ambiguous_file_type",
    "unknown_binary",
  ]) {
    assert.notEqual(permittedNonXlsxMetadata.expected_category, excludedCategory);
  }

  const permittedNonXlsxProof = parseZipDirectory(permittedNonXlsxMetadata.bytes);
  assertReadableZipProof(permittedNonXlsxMetadata, permittedNonXlsxProof);
  assert.deepEqual(permittedNonXlsxProof.entry_names, ["metadata.json", "notes/readme.txt"]);
  assert.equal(permittedNonXlsxProof.defect, null);
  assert.equal(completeXlsxIdentityPresent(permittedNonXlsxProof), false);

  assert.equal(xlsxMetadata.extension, ".xlsx");
  assert.equal(xlsxMetadata.declared_mime, XLSX_DECLARED_MIME);
  assert.equal(xlsxMetadata.bytes.byteLength, 234);
  assert.equal(xlsxMetadata.expected_policy, "block");
  assert.equal(xlsxMetadata.expected_category, "standalone_archive_or_non_xlsx");

  const xlsxMetadataProof = parseZipDirectory(xlsxMetadata.bytes);
  assertReadableZipProof(xlsxMetadata, xlsxMetadataProof);
  assert.deepEqual(xlsxMetadataProof.entry_names, ["docProps/core.xml", "xl/styles.xml"]);
  assert.equal(xlsxMetadataProof.defect, null);
  assert.equal(completeXlsxIdentityPresent(xlsxMetadataProof), false);

  assert.deepEqual(
    [...canonicalCoverage.entries()],
    [
      ["permitted non-XLSX metadata + readable non-XLSX ZIP", "XLSXZIP-P0-05F-007-BLOCK-ARBITRARY-ZIP-NON-XLSX-METADATA"],
      ["XLSX metadata + readable non-XLSX ZIP", "XLSXZIP-P0-05F-008-BLOCK-XLSX-METADATA-MISSING-OOXML"],
    ],
  );
});

test("malformed and truncated ZIP fixtures are distinct from readable missing-entry cases", () => {
  const expectedDefects = new Map([
    ["XLSXZIP-P0-05F-010-BLOCK-TRUNCATED-LOCAL-SIGNATURE", "truncated local-file-header signature"],
    ["XLSXZIP-P0-05F-011-BLOCK-NO-CENTRAL-DIRECTORY", "local header without readable central directory"],
    ["XLSXZIP-P0-05F-012-BLOCK-OUT-OF-BOUNDS-CD-OFFSET", "invalid or out-of-bounds central-directory offset"],
    ["XLSXZIP-P0-05F-013-BLOCK-TRUNCATED-CD-RECORD", "truncated central-directory record"],
  ]);

  const finalReportRows = [];
  for (const [fixtureId, expectedDefect] of expectedDefects) {
    const fixture = fixtureById(fixtureId);
    const proof = parseZipDirectory(fixture.bytes);

    assert.equal(fixture.expected_policy, "block", fixture.fixture_id);
    assert.equal(fixture.expected_category, "truncated_or_malformed_type", fixture.fixture_id);
    assert.equal(fixture.malformed_defect, expectedDefect, fixture.fixture_id);
    assert.notEqual(proof.defect, null, fixture.fixture_id);
    assert.equal(proof.decompressed_entry_content, false, fixture.fixture_id);
    assert.equal(proof.raw_byte_search_used_for_entry_presence, false, fixture.fixture_id);

    if (expectedDefect === "truncated local-file-header signature") {
      assert.equal(proof.begins_with_local_file_header_signature, false, fixture.fixture_id);
      assert.equal(proof.readable_eocd, false, fixture.fixture_id);
      assert.equal(proof.defect, "missing end-of-central-directory record", fixture.fixture_id);
    }
    if (expectedDefect === "local header without readable central directory") {
      assert.equal(proof.begins_with_local_file_header_signature, true, fixture.fixture_id);
      assert.equal(proof.readable_eocd, false, fixture.fixture_id);
      assert.equal(proof.defect, "missing end-of-central-directory record", fixture.fixture_id);
    }
    if (expectedDefect === "invalid or out-of-bounds central-directory offset") {
      assert.equal(proof.readable_eocd, true, fixture.fixture_id);
      assert.equal(proof.directory_bounds_valid, false, fixture.fixture_id);
      assert.equal(proof.defect, "central-directory offset or length is out of fixture bounds", fixture.fixture_id);
    }
    if (expectedDefect === "truncated central-directory record") {
      assert.equal(proof.readable_eocd, true, fixture.fixture_id);
      assert.equal(proof.directory_bounds_valid, true, fixture.fixture_id);
      assert.equal(proof.record_boundaries_valid, false, fixture.fixture_id);
      assert.equal(proof.defect, "central-directory record length exceeds recorded directory bounds", fixture.fixture_id);
    }

    finalReportRows.push({
      fixture_id: fixture.fixture_id,
      exact_structural_defect: expectedDefect,
      expected_category: fixture.expected_category,
    });
  }

  assert.equal(finalReportRows.every((row) => row.expected_category === "truncated_or_malformed_type"), true);
  assert.deepEqual(finalReportRows.map((row) => row.exact_structural_defect), [...expectedDefects.values()]);
});

test("XLSX/ZIP corpus construction and integrity validation avoid decompression, filesystems, external ZIP utilities, and raw-byte entry search", () => {
  const corpusSource = readFileSync("__tests__/support/kaiSprint2XlsxZipFixtureCorpus.js", "utf8");
  const testSource = readFileSync("__tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js", "utf8");
  const combined = `${corpusSource}\n${testSource}`;

  assert.doesNotMatch(
    corpusSource,
    /function fixture\(\{[\s\S]*extension\s*=\s*["']\.xlsx["'][\s\S]*\}\)/,
    "fixture constructor must not default extension to XLSX",
  );
  assert.doesNotMatch(
    corpusSource,
    /function fixture\(\{[\s\S]*declared_mime\s*=\s*["']application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet["'][\s\S]*\}\)/,
    "fixture constructor must not default declared_mime to XLSX",
  );
  assert.equal(corpusSource.includes("extension: \".xlsx\",\n    declared_mime:"), false);
  assert.equal(corpusSource.includes(removedStandaloneZipFixtureId), false);

  for (const forbidden of [
    "from " + "\"node:z" + "lib",
    "from " + "'node:z" + "lib",
    "from " + "\"node:child" + "_process",
    "from " + "'node:child" + "_process",
    "exec" + "File",
    "spa" + "wn",
    "un" + "zip",
    "adm" + "-zip",
    "yau" + "zl",
    "js" + "zip",
  ]) {
    assert.equal(combined.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
  assert.doesNotMatch(corpusSource, /from\s+["']node:fs|readFile|writeFile|createReadStream|createWriteStream/i);
  assert.equal(corpusSource.includes("includes(" + "XLSX_ZIP_REQUIRED_ENTRIES"), false);
  assert.equal(corpusSource.includes("process" + ".env"), false);
  assert.equal(testSource.includes("console" + "."), false);
  assert.equal(testSource.includes("diagnostic" + "("), false);
});
