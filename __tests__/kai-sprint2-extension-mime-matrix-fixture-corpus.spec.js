import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TEXT_TYPE_AGREEMENT_FIXTURES,
  bytesFromHex,
  normalizeTextTypeFixtureDeclaredMime,
  normalizeTextTypeFixtureExtension,
} from "./support/kaiSprint2TextTypeAgreementFixtureCorpus.js";
import {
  XLSX_ZIP_FIXTURES,
} from "./support/kaiSprint2XlsxZipFixtureCorpus.js";
import {
  EXTENSION_MIME_MATRIX_ALLOWED_PAIRINGS,
  EXTENSION_MIME_MATRIX_AUTHORITY_MAP,
  EXTENSION_MIME_MATRIX_BYTE_SOURCES,
  EXTENSION_MIME_MATRIX_DECLARED_MIME_VALUES,
  EXTENSION_MIME_MATRIX_EXTENSIONS,
  EXTENSION_MIME_MATRIX_FIXTURE_CATEGORIES,
  EXTENSION_MIME_MATRIX_FIXTURE_CORPUS_STATUSES,
  EXTENSION_MIME_MATRIX_FIXTURE_POLICIES,
  EXTENSION_MIME_MATRIX_FIXTURES,
  XLSX_MATRIX_EXACT_EXPORT_USED,
  XLSX_MATRIX_IMPORTED_POSITIVE_BYTES,
  XLSX_MATRIX_SOURCE_FIXTURE_ID,
  XLSX_MATRIX_SOURCE_MODULE,
  getExtensionMimeMatrixFixtureExpectations,
  normalizeExtensionMimeMatrixDeclaredMime,
  normalizeExtensionMimeMatrixExtension,
} from "./support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js";

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const policyAllowlist = new Set(EXTENSION_MIME_MATRIX_FIXTURE_POLICIES);
const categoryAllowlist = new Set(EXTENSION_MIME_MATRIX_FIXTURE_CATEGORIES);
const corpusStatusAllowlist = new Set(EXTENSION_MIME_MATRIX_FIXTURE_CORPUS_STATUSES);

const expectedNewFixtureIds = Object.freeze([
  "EXTMIME-P0-05F-001-BLOCK-CSV-TEXT-MARKDOWN-MISMATCH",
  "EXTMIME-P0-05F-002-BLOCK-CSV-TEXT-PLAIN-MISMATCH",
  "EXTMIME-P0-05F-003-BLOCK-CSV-XLSX-MIME-MISMATCH",
  "EXTMIME-P0-05F-004-BLOCK-CSV-APPLICATION-PDF-MISMATCH",
  "EXTMIME-P0-05F-005-BLOCK-XLSX-TEXT-CSV-MISMATCH",
  "EXTMIME-P0-05F-006-BLOCK-XLSX-APPLICATION-CSV-MISMATCH",
  "EXTMIME-P0-05F-007-BLOCK-XLSX-TEXT-MARKDOWN-MISMATCH",
  "EXTMIME-P0-05F-008-BLOCK-XLSX-TEXT-PLAIN-MISMATCH",
  "EXTMIME-P0-05F-009-ALLOW-XLSX-OFFICEDOCUMENT",
  "EXTMIME-P0-05F-010-BLOCK-XLSX-APPLICATION-PDF-MISMATCH",
  "EXTMIME-P0-05F-011-BLOCK-MD-TEXT-CSV-MISMATCH",
  "EXTMIME-P0-05F-012-BLOCK-MD-APPLICATION-CSV-MISMATCH",
  "EXTMIME-P0-05F-013-BLOCK-MD-XLSX-MIME-MISMATCH",
  "EXTMIME-P0-05F-014-BLOCK-MD-APPLICATION-PDF-MISMATCH",
  "EXTMIME-P0-05F-015-BLOCK-TXT-TEXT-CSV-MISMATCH",
  "EXTMIME-P0-05F-016-BLOCK-TXT-APPLICATION-CSV-MISMATCH",
  "EXTMIME-P0-05F-017-BLOCK-TXT-XLSX-MIME-MISMATCH",
  "EXTMIME-P0-05F-018-BLOCK-TXT-APPLICATION-PDF-MISMATCH",
  "EXTMIME-P0-05F-019-BLOCK-PDF-TEXT-CSV-MISMATCH",
  "EXTMIME-P0-05F-020-BLOCK-PDF-APPLICATION-CSV-MISMATCH",
  "EXTMIME-P0-05F-021-BLOCK-PDF-TEXT-MARKDOWN-MISMATCH",
  "EXTMIME-P0-05F-022-BLOCK-PDF-TEXT-PLAIN-MISMATCH",
  "EXTMIME-P0-05F-023-BLOCK-PDF-XLSX-MIME-MISMATCH",
  "EXTMIME-P0-05F-024-ALLOW-PDF-APPLICATION-PDF",
]);

const expectedNewPermittedFixtureIds = Object.freeze([
  "EXTMIME-P0-05F-009-ALLOW-XLSX-OFFICEDOCUMENT",
  "EXTMIME-P0-05F-024-ALLOW-PDF-APPLICATION-PDF",
]);

const fixtureKeys = Object.freeze([
  "fixture_id",
  "description",
  "extension",
  "normalized_extension",
  "declared_mime",
  "normalized_declared_mime",
  "bytes",
  "byte_length",
  "byte_source_id",
  "byte_source_kind",
  "expected_policy",
  "expected_category",
  "scope_note",
  "authority",
  "fixture_family",
  "synthetic_provenance",
  "corpus_status",
  "usable_document_claim",
  "source_eligibility_claim",
  "production_detector_claim",
  "semantic_content_inspected",
  "production_detector_answer_key",
  "mismatch_changes_only_declared_mime",
  "malformed_fixture_claim",
  "decompression_required",
]);

function pairKey(fixture) {
  return `${fixture.normalized_extension}:${fixture.normalized_declared_mime}`;
}

function normalizePairKey(extension, declaredMime) {
  return `${extension.toLowerCase()}:${declaredMime.trim().toLowerCase()}`;
}

function p0PairIsAllowed(extension, declaredMime) {
  return EXTENSION_MIME_MATRIX_ALLOWED_PAIRINGS.some(
    (pairing) => pairing.normalized_extension === extension && pairing.normalized_declared_mime === declaredMime,
  );
}

function expectedCartesianKeys() {
  const keys = [];
  for (const extension of EXTENSION_MIME_MATRIX_EXTENSIONS) {
    for (const declaredMime of EXTENSION_MIME_MATRIX_DECLARED_MIME_VALUES) {
      keys.push(normalizePairKey(extension, declaredMime));
    }
  }
  return keys;
}

function textFixtureBytes(fixture) {
  return bytesFromHex(fixture.bytes_hex);
}

function assertUtf8TextBytes(bytes, fixtureId) {
  assert.doesNotThrow(() => textDecoder.decode(bytes), fixtureId);
}

test("P0-05F.2b2a matrix corpus is synthetic, unique, closed-schema, and authority-grounded", () => {
  assert.deepEqual(EXTENSION_MIME_MATRIX_FIXTURES.map((fixture) => fixture.fixture_id), expectedNewFixtureIds);
  assert.equal(new Set(EXTENSION_MIME_MATRIX_FIXTURES.map((fixture) => fixture.fixture_id)).size, 24);

  for (const fixture of EXTENSION_MIME_MATRIX_FIXTURES) {
    assert.deepEqual(Object.keys(fixture), fixtureKeys, fixture.fixture_id);
    assert.ok(policyAllowlist.has(fixture.expected_policy), fixture.fixture_id);
    assert.ok(categoryAllowlist.has(fixture.expected_category), fixture.fixture_id);
    assert.ok(corpusStatusAllowlist.has(fixture.corpus_status), fixture.fixture_id);
    assert.ok(Object.hasOwn(EXTENSION_MIME_MATRIX_AUTHORITY_MAP, fixture.authority), fixture.fixture_id);
    assert.ok(fixture.synthetic_provenance.includes("synthetic"), fixture.fixture_id);
    assert.doesNotMatch(fixture.synthetic_provenance, /customer|database|cloud|credential|real documents/i, fixture.fixture_id);
    assert.equal(fixture.corpus_status, "corpus_only", fixture.fixture_id);
    assert.equal(fixture.usable_document_claim, false, fixture.fixture_id);
    assert.equal(fixture.source_eligibility_claim, false, fixture.fixture_id);
    assert.equal(fixture.production_detector_claim, false, fixture.fixture_id);
    assert.equal(fixture.semantic_content_inspected, false, fixture.fixture_id);
    assert.equal(fixture.production_detector_answer_key, false, fixture.fixture_id);
    assert.equal(fixture.malformed_fixture_claim, false, fixture.fixture_id);
    assert.equal(fixture.decompression_required, false, fixture.fixture_id);
    assert.equal(fixture.scope_note, fixture.expected_policy === "allow" ? "type_agreement_pass_only" : "type_agreement_block_only", fixture.fixture_id);
    assert.equal(normalizeExtensionMimeMatrixExtension(fixture.extension), fixture.normalized_extension, fixture.fixture_id);
    assert.equal(normalizeExtensionMimeMatrixDeclaredMime(fixture.declared_mime), fixture.normalized_declared_mime, fixture.fixture_id);
    assert.equal(fixture.byte_length, fixture.bytes.byteLength, fixture.fixture_id);
  }

  assert.deepEqual(
    getExtensionMimeMatrixFixtureExpectations().map((fixture) => fixture.fixture_id),
    expectedNewFixtureIds,
  );
});

test("P0-05F.2b2a contributes exactly two permitted pairs and twenty-two declared_type_mismatch pairs", () => {
  const permitted = EXTENSION_MIME_MATRIX_FIXTURES.filter((fixture) => fixture.expected_policy === "allow");
  const mismatches = EXTENSION_MIME_MATRIX_FIXTURES.filter((fixture) => fixture.expected_policy === "block");

  assert.deepEqual(permitted.map((fixture) => fixture.fixture_id), expectedNewPermittedFixtureIds);
  assert.equal(permitted.length, 2);
  assert.equal(mismatches.length, 22);

  for (const fixture of permitted) {
    assert.equal(fixture.expected_category, "type_agreement_pass", fixture.fixture_id);
    assert.ok(p0PairIsAllowed(fixture.normalized_extension, fixture.normalized_declared_mime), fixture.fixture_id);
  }

  for (const fixture of mismatches) {
    assert.equal(fixture.expected_category, "declared_type_mismatch", fixture.fixture_id);
    assert.equal(fixture.mismatch_changes_only_declared_mime, true, fixture.fixture_id);
    assert.equal(p0PairIsAllowed(fixture.normalized_extension, fixture.normalized_declared_mime), false, fixture.fixture_id);
  }
});

test("P0-05F.2a positive XLSX bytes are imported directly and reused unchanged", () => {
  const sourceFixture = XLSX_ZIP_FIXTURES.find((fixture) => fixture.fixture_id === XLSX_MATRIX_SOURCE_FIXTURE_ID);
  assert.ok(sourceFixture);
  assert.equal(XLSX_MATRIX_SOURCE_MODULE, "__tests__/support/kaiSprint2XlsxZipFixtureCorpus.js");
  assert.equal(XLSX_MATRIX_SOURCE_FIXTURE_ID, "XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX");
  assert.equal(XLSX_MATRIX_EXACT_EXPORT_USED, "XLSX_ZIP_FIXTURES");
  assert.equal(XLSX_MATRIX_IMPORTED_POSITIVE_BYTES, sourceFixture.bytes);
  assert.equal(EXTENSION_MIME_MATRIX_BYTE_SOURCES[".xlsx"].bytes, sourceFixture.bytes);

  for (const fixture of EXTENSION_MIME_MATRIX_FIXTURES.filter((item) => item.normalized_extension === ".xlsx")) {
    assert.equal(fixture.bytes, sourceFixture.bytes, fixture.fixture_id);
    assert.equal(fixture.byte_source_id, XLSX_MATRIX_SOURCE_FIXTURE_ID, fixture.fixture_id);
    assert.equal(fixture.byte_source_kind, "imported_p0_05f_2a_positive_xlsx_bytes", fixture.fixture_id);
  }
});

test("approved byte source for each extension is reused by every new row for that extension", () => {
  for (const extension of EXTENSION_MIME_MATRIX_EXTENSIONS) {
    const byteSource = EXTENSION_MIME_MATRIX_BYTE_SOURCES[extension];
    assert.ok(byteSource, extension);
    const fixturesForExtension = EXTENSION_MIME_MATRIX_FIXTURES.filter((fixture) => fixture.normalized_extension === extension);
    assert.ok(fixturesForExtension.length > 0, extension);

    for (const fixture of fixturesForExtension) {
      assert.equal(fixture.bytes, byteSource.bytes, fixture.fixture_id);
      assert.equal(fixture.byte_source_id, byteSource.source_id, fixture.fixture_id);
    }
  }
});

test("new mismatch fixtures use valid bytes for their extension and vary only declared MIME", () => {
  const allowedDeclaredMimeByExtension = new Map([
    [".csv", "text/csv"],
    [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    [".md", "text/markdown"],
    [".txt", "text/plain"],
    [".pdf", "application/pdf"],
  ]);

  for (const fixture of EXTENSION_MIME_MATRIX_FIXTURES.filter((item) => item.expected_policy === "block")) {
    assert.equal(EXTENSION_MIME_MATRIX_EXTENSIONS.includes(fixture.normalized_extension), true, fixture.fixture_id);
    assert.notEqual(fixture.normalized_declared_mime, allowedDeclaredMimeByExtension.get(fixture.normalized_extension), fixture.fixture_id);
    assert.equal(fixture.malformed_fixture_claim, false, fixture.fixture_id);
    assert.equal(fixture.expected_category, "declared_type_mismatch", fixture.fixture_id);
  }

  for (const extension of [".csv", ".md", ".txt"]) {
    assertUtf8TextBytes(EXTENSION_MIME_MATRIX_BYTE_SOURCES[extension].bytes, extension);
  }

  assert.equal(EXTENSION_MIME_MATRIX_BYTE_SOURCES[".xlsx"].bytes, XLSX_MATRIX_IMPORTED_POSITIVE_BYTES);

  const pdfBytes = EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"].bytes;
  assert.equal(new TextDecoder().decode(pdfBytes.slice(0, 5)), "%PDF-");
  const finalKilobyte = new TextDecoder().decode(pdfBytes.slice(Math.max(0, pdfBytes.byteLength - 1024)));
  assert.match(finalKilobyte, /%%EOF/);
});

test("combined P0-05F.2b1 and P0-05F.2b2a matrix coverage is exactly 30 normalized pairs", () => {
  const legacyRows = TEXT_TYPE_AGREEMENT_FIXTURES.map((fixture) => ({
    fixture_id: fixture.fixture_id,
    normalized_extension: normalizeTextTypeFixtureExtension(fixture.extension),
    normalized_declared_mime: normalizeTextTypeFixtureDeclaredMime(fixture.declared_mime),
    expected_policy: fixture.expected_policy,
    expected_category: fixture.expected_category,
    source: "P0-05F.2b1",
  }));
  const newRows = EXTENSION_MIME_MATRIX_FIXTURES.map((fixture) => ({
    fixture_id: fixture.fixture_id,
    normalized_extension: fixture.normalized_extension,
    normalized_declared_mime: fixture.normalized_declared_mime,
    expected_policy: fixture.expected_policy,
    expected_category: fixture.expected_category,
    source: "P0-05F.2b2a",
  }));
  const combinedRows = [...legacyRows, ...newRows];
  const expectedKeys = expectedCartesianKeys();
  const combinedKeys = combinedRows.map(pairKey);
  const duplicateKeys = combinedKeys.filter((key, index) => combinedKeys.indexOf(key) !== index);
  const missingKeys = expectedKeys.filter((key) => !combinedKeys.includes(key));
  const unexpectedKeys = combinedKeys.filter((key) => !expectedKeys.includes(key));

  assert.equal(legacyRows.length, 6);
  assert.equal(newRows.length, 24);
  assert.equal(combinedRows.length, 30);
  assert.equal(combinedRows.filter((fixture) => fixture.expected_policy === "allow").length, 7);
  assert.equal(combinedRows.filter((fixture) => fixture.expected_category === "declared_type_mismatch").length, 23);
  assert.deepEqual(duplicateKeys, []);
  assert.deepEqual(missingKeys, []);
  assert.deepEqual(unexpectedKeys, []);
});

test("P0-05F.2b1 normalization cases collapse to intended canonical keys without duplicate or gap", () => {
  const uppercaseExtension = TEXT_TYPE_AGREEMENT_FIXTURES.find(
    (fixture) => fixture.fixture_id === "TEXTTYPE-P0-05F-001-ALLOW-CSV-TEXT-CSV-UPPERCASE-EMPTY",
  );
  const mixedMime = TEXT_TYPE_AGREEMENT_FIXTURES.find(
    (fixture) => fixture.fixture_id === "TEXTTYPE-P0-05F-002-ALLOW-CSV-APPLICATION-CSV-INSTRUCTION",
  );
  const whitespaceMime = TEXT_TYPE_AGREEMENT_FIXTURES.find(
    (fixture) => fixture.fixture_id === "TEXTTYPE-P0-05F-004-ALLOW-MD-TEXT-PLAIN-HTML-SCRIPT-LOOKING",
  );

  assert.equal(uppercaseExtension.extension, ".CSV");
  assert.equal(normalizeTextTypeFixtureExtension(uppercaseExtension.extension), ".csv");
  assert.equal(pairKey(uppercaseExtension), ".csv:text/csv");

  assert.equal(mixedMime.declared_mime, "Application/CSV");
  assert.equal(normalizeTextTypeFixtureDeclaredMime(mixedMime.declared_mime), "application/csv");
  assert.equal(pairKey(mixedMime), ".csv:application/csv");

  assert.match(whitespaceMime.declared_mime, /^[\t\r\n ]/);
  assert.match(whitespaceMime.declared_mime, /[\t\r\n ]$/);
  assert.equal(normalizeTextTypeFixtureDeclaredMime(whitespaceMime.declared_mime), "text/plain");
  assert.equal(pairKey(whitespaceMime), ".md:text/plain");
});

test("fixture IDs are unique across both matrix corpora", () => {
  const fixtureIds = [
    ...TEXT_TYPE_AGREEMENT_FIXTURES.map((fixture) => fixture.fixture_id),
    ...EXTENSION_MIME_MATRIX_FIXTURES.map((fixture) => fixture.fixture_id),
  ];

  assert.equal(fixtureIds.length, 30);
  assert.equal(new Set(fixtureIds).size, 30);
});

test("P0-05F.2b1 mismatch and new mismatches are valid bytes with only declared MIME conflicting", () => {
  const legacyTxtMarkdownMismatch = TEXT_TYPE_AGREEMENT_FIXTURES.find(
    (fixture) => fixture.fixture_id === "TEXTTYPE-P0-05F-006-BLOCK-TXT-TEXT-MARKDOWN-MISMATCH",
  );
  assert.equal(legacyTxtMarkdownMismatch.expected_policy, "block");
  assert.equal(legacyTxtMarkdownMismatch.expected_category, "declared_type_mismatch");
  assertUtf8TextBytes(textFixtureBytes(legacyTxtMarkdownMismatch), legacyTxtMarkdownMismatch.fixture_id);

  for (const fixture of EXTENSION_MIME_MATRIX_FIXTURES.filter((item) => item.expected_policy === "block")) {
    assert.equal(fixture.expected_category, "declared_type_mismatch", fixture.fixture_id);
    assert.equal(fixture.mismatch_changes_only_declared_mime, true, fixture.fixture_id);
    assert.equal(fixture.malformed_fixture_claim, false, fixture.fixture_id);
  }
});

test("matrix corpus and proof do not import production detectors, decompress ZIP content, or add excluded scope", () => {
  const corpusSource = readFileSync("__tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js", "utf8");
  const testSource = readFileSync("__tests__/kai-sprint2-extension-mime-matrix-fixture-corpus.spec.js", "utf8");
  const forbiddenImportPattern = new RegExp(
    [
      String.raw`from\s+["']\.\.\/Backend\/`,
      "validate[A-Z]",
      "detect[A-Z]",
      "Det" + "ector",
      "process" + String.raw`\.env`,
      "DATA" + "BASE_URL",
      "fetch" + String.raw`\(`,
      "node:http",
      "node:https",
      "pg",
      "postgres" + String.raw`:\/`,
    ].join("|"),
  );

  assert.doesNotMatch(corpusSource, forbiddenImportPattern);
  assert.doesNotMatch(testSource, /from\s+["']\.\.\/Backend\//);
  assert.equal(corpusSource.includes("kai" + "IntakeService"), false);
  assert.equal(corpusSource.includes("txtMdByte" + "Detector"), false);
  assert.equal(corpusSource.includes("upload" + "Handler"), false);
  assert.equal(corpusSource.includes("storage" + "Provider"), false);
  assert.equal(corpusSource.includes("decompress" + "("), false);
  assert.equal(corpusSource.includes("inflate" + "("), false);
  assert.equal(corpusSource.includes("application" + "/json"), false);
  assert.equal(corpusSource.includes("application" + "/octet-stream"), false);
  assert.equal(corpusSource.includes("ambiguous" + "_file_type"), false);
  assert.equal(corpusSource.includes("unknown" + "_binary"), false);
  assert.equal(corpusSource.includes("disallowed" + "_binary_signature"), false);
  assert.equal(corpusSource.includes("unsupported" + "_file_type"), false);
});
