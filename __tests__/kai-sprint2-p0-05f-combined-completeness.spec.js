import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DETECTED_PERMITTED_TYPE_CONTRADICTION_AUTHORITY,
  DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES,
} from "./support/kaiSprint2DetectedPermittedTypeContradictionFixtureCorpus.js";
import {
  EXTENSION_MIME_MATRIX_ALLOWED_PAIRINGS,
  EXTENSION_MIME_MATRIX_AUTHORITY_MAP,
  EXTENSION_MIME_MATRIX_FIXTURES,
} from "./support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js";
import {
  PDF_SHALLOW_IDENTITY_AUTHORITY_MAP,
  PDF_SHALLOW_IDENTITY_FIXTURES,
} from "./support/kaiSprint2PdfShallowIdentityFixtureCorpus.js";
import {
  RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY_MAP,
  RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES,
} from "./support/kaiSprint2RecognizedDisallowedSignatureFixtureCorpus.js";
import {
  RESIDUAL_UNKNOWN_BINARY_AUTHORITY_MAP,
  RESIDUAL_UNKNOWN_BINARY_FIXTURES,
} from "./support/kaiSprint2ResidualUnknownBinaryFixtureCorpus.js";
import {
  TEXT_TYPE_AGREEMENT_AUTHORITY_MAP,
  TEXT_TYPE_AGREEMENT_FIXTURES,
} from "./support/kaiSprint2TextTypeAgreementFixtureCorpus.js";
import {
  TXT_MD_BYTE_FIXTURE_AUTHORITY_MAP,
  TXT_MD_BYTE_FIXTURES,
} from "./support/kaiSprint2TxtMdByteFixtureCorpus.js";
import {
  UNSUPPORTED_DECLARED_MIME_REQUIRED_CASES,
  UNSUPPORTED_EXTENSION_MIME_AUTHORITY_MAP,
  UNSUPPORTED_EXTENSION_MIME_FIXTURES,
  UNSUPPORTED_EXTENSION_REQUIRED_CASES,
} from "./support/kaiSprint2UnsupportedExtensionMimeFixtureCorpus.js";
import {
  XLSX_ZIP_FIXTURE_AUTHORITY_MAP,
  XLSX_ZIP_FIXTURES,
  XLSX_ZIP_REQUIRED_ENTRIES,
} from "./support/kaiSprint2XlsxZipFixtureCorpus.js";

const contractText = readFileSync(
  "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
  "utf8",
);
const execPlanText = readFileSync(
  "KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md",
  "utf8",
);

const importedCorpusModules = Object.freeze([
  "__tests__/support/kaiSprint2DetectedPermittedTypeContradictionFixtureCorpus.js",
  "__tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js",
  "__tests__/support/kaiSprint2PdfShallowIdentityFixtureCorpus.js",
  "__tests__/support/kaiSprint2RecognizedDisallowedSignatureFixtureCorpus.js",
  "__tests__/support/kaiSprint2ResidualUnknownBinaryFixtureCorpus.js",
  "__tests__/support/kaiSprint2TextTypeAgreementFixtureCorpus.js",
  "__tests__/support/kaiSprint2TxtMdByteFixtureCorpus.js",
  "__tests__/support/kaiSprint2UnsupportedExtensionMimeFixtureCorpus.js",
  "__tests__/support/kaiSprint2XlsxZipFixtureCorpus.js",
]);

const expectedChecklistItems = Object.freeze([
  "allowed extension/MIME pairings",
  "grounded cross-type mismatches",
  "uppercase extension normalization",
  "unsupported extensions",
  "unsupported MIME values",
  "application/json rejection",
  "application/octet-stream rejection",
  "MIME-parameter rejection",
  "empty text-family cases",
  "PDF positive and truncated cases",
  "XLSX positive minimum structure",
  "readable ZIP without complete XLSX identity",
  "renamed ZIP",
  "recognized MZ, ELF, RAR 4, RAR 5, 7z, and gzip signatures",
  "unknown binary",
  "instruction-like permitted text remaining inert",
  "ambiguous_file_type under the defensive-category rule",
]);

const checklistAuthorityPatterns = Object.freeze([
  /allowed extension\/MIME pairing/,
  /grounded cross-type mismatch/,
  /uppercase extension normalization/,
  /unsupported extensions/,
  /unsupported MIME values/,
  /`application\/json` rejection/,
  /`application\/octet-stream` declared-MIME rejection/,
  /MIME-parameter rejection/,
  /empty text-family cases/,
  /PDF positive and truncated cases/,
  /XLSX positive minimum structure/,
  /readable ZIP without complete XLSX identity|structurally readable ZIP without complete XLSX identity/,
  /renamed (?:non-OOXML )?ZIP/,
  /recognized .*MZ, ELF, RAR 4, RAR 5, 7z, and gzip/,
  /unknown binary/,
  /instruction-like permitted text remaining inert/,
  /ambiguous_file_type.*defensive-category rule/,
]);

const authorityMaps = Object.freeze([
  DETECTED_PERMITTED_TYPE_CONTRADICTION_AUTHORITY_MAP(),
  EXTENSION_MIME_MATRIX_AUTHORITY_MAP,
  PDF_SHALLOW_IDENTITY_AUTHORITY_MAP,
  RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY_MAP,
  RESIDUAL_UNKNOWN_BINARY_AUTHORITY_MAP,
  TEXT_TYPE_AGREEMENT_AUTHORITY_MAP,
  TXT_MD_BYTE_FIXTURE_AUTHORITY_MAP,
  UNSUPPORTED_EXTENSION_MIME_AUTHORITY_MAP,
  XLSX_ZIP_FIXTURE_AUTHORITY_MAP,
]);

const allFixtures = Object.freeze([
  ...DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES,
  ...EXTENSION_MIME_MATRIX_FIXTURES,
  ...PDF_SHALLOW_IDENTITY_FIXTURES,
  ...RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES,
  ...RESIDUAL_UNKNOWN_BINARY_FIXTURES,
  ...TEXT_TYPE_AGREEMENT_FIXTURES,
  ...TXT_MD_BYTE_FIXTURES,
  ...UNSUPPORTED_EXTENSION_MIME_FIXTURES,
  ...XLSX_ZIP_FIXTURES,
]);

function DETECTED_PERMITTED_TYPE_CONTRADICTION_AUTHORITY_MAP() {
  return Object.freeze({
    [DETECTED_PERMITTED_TYPE_CONTRADICTION_AUTHORITY]: Object.freeze({
      source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
      section_or_decision_key: "P0-05F detected permitted-type contradiction",
      requirement_summary:
        "Committed owner authority blocks deterministic permitted byte type contradiction as declared_type_mismatch.",
      supported_expected_policy: "block",
      supported_expected_category: "declared_type_mismatch",
      authority_status: "contract_grounded",
    }),
  });
}

function fixtureById(fixtures, fixtureId) {
  const fixture = fixtures.find((item) => item.fixture_id === fixtureId);
  assert.ok(fixture, fixtureId);
  return fixture;
}

function pairKey(fixture) {
  return `${fixture.normalized_extension}:${fixture.normalized_declared_mime}`;
}

function authorityFor(authorityToken) {
  for (const authorityMap of authorityMaps) {
    if (Object.hasOwn(authorityMap, authorityToken)) {
      return authorityMap[authorityToken];
    }
  }
  return null;
}

function assertPolicyCategory(fixture, expectedPolicy, expectedCategory) {
  assert.equal(fixture.expected_policy, expectedPolicy, fixture.fixture_id);
  assert.equal(fixture.expected_category, expectedCategory, fixture.fixture_id);
}

function assertAuthorityTokenResolves(authorityToken) {
  const authority = authorityFor(authorityToken);
  assert.ok(authority, authorityToken);
  assert.equal(authority.source_document, "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md", authorityToken);
  assert.equal(authority.authority_status, "contract_grounded", authorityToken);
  if (authorityToken.startsWith("OWNER_DECISION.")) {
    assert.match(contractText, new RegExp(authorityToken.replaceAll(".", "\\.")), authorityToken);
  }
}

function assertFixtureAuthority(fixture) {
  assertAuthorityTokenResolves(fixture.authority);
  for (const secondaryAuthorityField of ["text_byte_authority", "metadata_pairing_authority"]) {
    if (fixture[secondaryAuthorityField]) {
      assertAuthorityTokenResolves(fixture[secondaryAuthorityField]);
    }
  }
}

function assertNoOutOfScopeClaim(fixture) {
  assert.notEqual(fixture.production_detector_claim, true, fixture.fixture_id);
  assert.notEqual(fixture.production_detector_answer_key, true, fixture.fixture_id);
  assert.notEqual(fixture.runtime_mime_behavior_claim, true, fixture.fixture_id);
  assert.notEqual(fixture.upload_acceptance_claim, true, fixture.fixture_id);
  assert.notEqual(fixture.malware_scanning_claim, true, fixture.fixture_id);
  assert.notEqual(fixture.parser_safety_claim, true, fixture.fixture_id);
  assert.notEqual(fixture.semantic_content_inspected, true, fixture.fixture_id);
  assert.notEqual(fixture.source_eligibility_claim, true, fixture.fixture_id);
  assert.notEqual(fixture.usable_document_claim, true, fixture.fixture_id);
}

test("P0-05F.2e committed checklist is the current 17-item authority", () => {
  assert.equal(expectedChecklistItems.length, 17);
  assert.equal(checklistAuthorityPatterns.length, 17);
  assert.match(contractText, /future fixture corpus must include every allowed extension\/MIME pairing/);
  assert.match(execPlanText, /future fixture corpus must include every allowed extension\/MIME pairing/);

  for (let index = 0; index < checklistAuthorityPatterns.length; index += 1) {
    assert.match(contractText, checklistAuthorityPatterns[index], expectedChecklistItems[index]);
    assert.match(execPlanText, checklistAuthorityPatterns[index], expectedChecklistItems[index]);
  }
});

test("P0-05F.2e imports the focused corpora directly and excludes filename safety", () => {
  assert.equal(importedCorpusModules.length, 9);
  for (const modulePath of importedCorpusModules) {
    assert.match(modulePath, /^__tests__\/support\//, modulePath);
    assert.doesNotMatch(modulePath, /Filename|filename/, modulePath);
  }

  assert.equal(allFixtures.length, 101);
  assert.equal(
    allFixtures.some((fixture) => /filename/i.test(`${fixture.fixture_id} ${fixture.expected_category}`)),
    false,
  );
});

test("P0-05F.2e imported fixture IDs are unique and all mapped authorities resolve", () => {
  const fixtureIds = allFixtures.map((fixture) => fixture.fixture_id);
  assert.equal(new Set(fixtureIds).size, fixtureIds.length);

  for (const fixture of allFixtures) {
    assert.equal(fixture.corpus_status, "corpus_only", fixture.fixture_id);
    assert.ok(["allow", "block"].includes(fixture.expected_policy), fixture.fixture_id);
    assert.equal(typeof fixture.expected_category, "string", fixture.fixture_id);
    assert.notEqual(fixture.expected_category.trim(), "", fixture.fixture_id);
    assertFixtureAuthority(fixture);
    assertNoOutOfScopeClaim(fixture);
  }
});

test("P0-05F.2e covers all allowed extension and MIME pairings from fixture fields", () => {
  const allowedFixtureIds = Object.freeze([
    "TEXTTYPE-P0-05F-001-ALLOW-CSV-TEXT-CSV-UPPERCASE-EMPTY",
    "TEXTTYPE-P0-05F-002-ALLOW-CSV-APPLICATION-CSV-INSTRUCTION",
    "TEXTTYPE-P0-05F-003-ALLOW-MD-TEXT-MARKDOWN-EMPTY",
    "TEXTTYPE-P0-05F-004-ALLOW-MD-TEXT-PLAIN-HTML-SCRIPT-LOOKING",
    "TEXTTYPE-P0-05F-005-ALLOW-TXT-TEXT-PLAIN-EMPTY",
    "EXTMIME-P0-05F-009-ALLOW-XLSX-OFFICEDOCUMENT",
    "EXTMIME-P0-05F-024-ALLOW-PDF-APPLICATION-PDF",
  ]);
  const allowedFixtures = allowedFixtureIds.map((fixtureId) =>
    fixtureById([...TEXT_TYPE_AGREEMENT_FIXTURES, ...EXTENSION_MIME_MATRIX_FIXTURES], fixtureId),
  );

  assert.deepEqual(
    allowedFixtures.map(pairKey).sort(),
    EXTENSION_MIME_MATRIX_ALLOWED_PAIRINGS
      .map((pairing) => `${pairing.normalized_extension}:${pairing.normalized_declared_mime}`)
      .sort(),
  );
  for (const fixture of allowedFixtures) {
    assertPolicyCategory(fixture, "allow", "type_agreement_pass");
  }
});

test("P0-05F.2e covers grounded cross-type mismatches from committed fields", () => {
  const metadataMismatches = EXTENSION_MIME_MATRIX_FIXTURES.filter(
    (fixture) => fixture.expected_policy === "block" && fixture.expected_category === "declared_type_mismatch",
  );
  assert.equal(metadataMismatches.length, 22);
  assert.ok(metadataMismatches.every((fixture) => fixture.mismatch_changes_only_declared_mime === true));

  const textMismatch = fixtureById(
    TEXT_TYPE_AGREEMENT_FIXTURES,
    "TEXTTYPE-P0-05F-006-BLOCK-TXT-TEXT-MARKDOWN-MISMATCH",
  );
  assert.equal(textMismatch.normalized_extension, ".txt");
  assert.equal(textMismatch.normalized_declared_mime, "text/markdown");
  assertPolicyCategory(textMismatch, "block", "declared_type_mismatch");

  assert.deepEqual(
    DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES.map((fixture) => fixture.fixture_id),
    [
      "DETPERMTYPE-P0-05F-2D0-001-BLOCK-TXT-TEXT-PLAIN-PDF-BYTES",
      "DETPERMTYPE-P0-05F-2D0-002-BLOCK-TXT-TEXT-PLAIN-XLSX-BYTES",
    ],
  );
  for (const fixture of DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES) {
    assert.equal(fixture.normalized_extension, ".txt", fixture.fixture_id);
    assert.equal(fixture.normalized_declared_mime, "text/plain", fixture.fixture_id);
    assert.equal(fixture.detected_type_is_permitted, true, fixture.fixture_id);
    assert.equal(fixture.metadata_pairing_permitted, true, fixture.fixture_id);
    assert.equal(fixture.declared_type_differs_from_detected_type, true, fixture.fixture_id);
    assert.equal(fixture.classification_exclusions.ambiguous_file_type, false, fixture.fixture_id);
    assertPolicyCategory(fixture, "block", "declared_type_mismatch");
  }
});

test("P0-05F.2e covers normalization, unsupported metadata, JSON, octet-stream, and MIME parameters", () => {
  const uppercaseExtension = fixtureById(
    TEXT_TYPE_AGREEMENT_FIXTURES,
    "TEXTTYPE-P0-05F-001-ALLOW-CSV-TEXT-CSV-UPPERCASE-EMPTY",
  );
  assert.equal(uppercaseExtension.extension, ".CSV");
  assert.equal(uppercaseExtension.normalized_extension, ".csv");
  assertPolicyCategory(uppercaseExtension, "allow", "type_agreement_pass");

  assert.deepEqual(
    UNSUPPORTED_EXTENSION_MIME_FIXTURES
      .filter((fixture) => fixture.unsupported_signal === "extension")
      .map((fixture) => fixture.unsupported_case),
    [...UNSUPPORTED_EXTENSION_REQUIRED_CASES],
  );
  assert.deepEqual(
    UNSUPPORTED_EXTENSION_MIME_FIXTURES
      .filter((fixture) => fixture.unsupported_signal === "declared_mime")
      .map((fixture) => fixture.unsupported_case),
    [...UNSUPPORTED_DECLARED_MIME_REQUIRED_CASES],
  );

  const jsonMime = fixtureById(UNSUPPORTED_EXTENSION_MIME_FIXTURES, "UNSUPMETA-P0-05F-009-BLOCK-APPLICATION-JSON-MIME");
  assert.equal(jsonMime.normalized_declared_mime, "application/json");
  assert.match(jsonMime.runtime_alignment_note, /policy rejects application\/json/);

  const octetStream = fixtureById(UNSUPPORTED_EXTENSION_MIME_FIXTURES, "UNSUPMETA-P0-05F-010-BLOCK-OCTET-STREAM-MIME");
  assert.equal(octetStream.normalized_declared_mime, "application/octet-stream");
  assert.match(octetStream.transport_envelope_note, /not an accepted declared file MIME/);

  const parameterizedMime = fixtureById(UNSUPPORTED_EXTENSION_MIME_FIXTURES, "UNSUPMETA-P0-05F-018-BLOCK-TEXT-PLAIN-PARAMETER-MIME");
  assert.equal(parameterizedMime.declared_mime, "text/plain; charset=utf-8");
  assert.equal(parameterizedMime.normalized_declared_mime, "text/plain; charset=utf-8");
  assert.match(parameterizedMime.mime_parameter_rejection_note, /not normalized or stripped/);

  for (const fixture of UNSUPPORTED_EXTENSION_MIME_FIXTURES) {
    assertPolicyCategory(fixture, "block", "unsupported_file_type");
  }
});

test("P0-05F.2e covers empty and instruction-like permitted text as inert data", () => {
  const emptyTextFixtureIds = [
    "TEXTTYPE-P0-05F-001-ALLOW-CSV-TEXT-CSV-UPPERCASE-EMPTY",
    "TEXTTYPE-P0-05F-003-ALLOW-MD-TEXT-MARKDOWN-EMPTY",
    "TEXTTYPE-P0-05F-005-ALLOW-TXT-TEXT-PLAIN-EMPTY",
  ];
  for (const fixtureId of emptyTextFixtureIds) {
    const fixture = fixtureById(TEXT_TYPE_AGREEMENT_FIXTURES, fixtureId);
    assert.equal(fixture.byte_length, 0, fixtureId);
    assert.equal(fixture.fixture_family, "empty_text_family", fixtureId);
    assertPolicyCategory(fixture, "allow", "type_agreement_pass");
  }

  const emptyByteGate = fixtureById(TXT_MD_BYTE_FIXTURES, "TXTMD-P0-05D-006-ALLOW-EMPTY");
  assert.equal(emptyByteGate.bytes_hex, "");
  assert.equal(emptyByteGate.byte_case_family, "empty_content");
  assertPolicyCategory(emptyByteGate, "allow", "encoding_gate_pass");

  const instructionText = fixtureById(
    TEXT_TYPE_AGREEMENT_FIXTURES,
    "TEXTTYPE-P0-05F-002-ALLOW-CSV-APPLICATION-CSV-INSTRUCTION",
  );
  assert.equal(instructionText.fixture_family, "instruction_like_inert_text");
  assert.equal(instructionText.text_byte_authority, "OWNER_DECISION.P0_05C.INSTRUCTION_TEXT_IS_INERT_DATA");
  assertPolicyCategory(instructionText, "allow", "type_agreement_pass");

  const instructionBytes = fixtureById(TXT_MD_BYTE_FIXTURES, "TXTMD-P0-05D-007-ALLOW-INSTRUCTION-LIKE-TEXT");
  assert.equal(instructionBytes.byte_case_family, "instruction_like_inert_data");
  assertPolicyCategory(instructionBytes, "allow", "encoding_gate_pass");
});

test("P0-05F.2e covers PDF positive and truncated shallow identity cases", () => {
  const positive = fixtureById(PDF_SHALLOW_IDENTITY_FIXTURES, "PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF");
  assert.equal(positive.normalized_extension, ".pdf");
  assert.equal(positive.normalized_declared_mime, "application/pdf");
  assert.equal(positive.pdf_identity_conditions.header_pdf_marker_at_offset_zero, true);
  assert.equal(positive.pdf_identity_conditions.eof_marker_within_final_1024_bytes, true);
  assertPolicyCategory(positive, "allow", "type_agreement_pass");

  const negativeConditions = new Map([
    ["PDFIDENT-P0-05F-002-BLOCK-LEADING-BYTE-BEFORE-HEADER", "offset_zero_header"],
    ["PDFIDENT-P0-05F-003-BLOCK-TRUNCATED-PDF-PREFIX", "offset_zero_header"],
    ["PDFIDENT-P0-05F-004-BLOCK-MISSING-EOF", "eof_presence"],
    ["PDFIDENT-P0-05F-005-BLOCK-EOF-OUTSIDE-FINAL-1024", "eof_final_1024_window"],
  ]);
  for (const [fixtureId, violatedCondition] of negativeConditions) {
    const fixture = fixtureById(PDF_SHALLOW_IDENTITY_FIXTURES, fixtureId);
    assert.equal(fixture.violated_identity_condition, violatedCondition, fixtureId);
    assert.equal(fixture.violates_exactly_one_identity_condition, true, fixtureId);
    assertPolicyCategory(fixture, "block", "truncated_or_malformed_type");
  }
});

test("P0-05F.2e covers XLSX minimum identity, readable non-XLSX ZIP, and renamed ZIP", () => {
  const positive = fixtureById(XLSX_ZIP_FIXTURES, "XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX");
  assert.equal(positive.extension, ".xlsx");
  assert.equal(positive.declared_mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.deepEqual(positive.entries, XLSX_ZIP_REQUIRED_ENTRIES);
  assert.equal(positive.structural_claim, "readable_zip_with_minimum_ooxml_identity");
  assertPolicyCategory(positive, "allow", "type_agreement_pass");

  const readableZipWithoutXlsx = XLSX_ZIP_FIXTURES.filter(
    (fixture) =>
      fixture.expected_category === "standalone_archive_or_non_xlsx" &&
      fixture.structural_claim === "readable_zip",
  );
  assert.deepEqual(
    readableZipWithoutXlsx.map((fixture) => fixture.fixture_id),
    [
      "XLSXZIP-P0-05F-002-BLOCK-MISSING-CONTENT-TYPES",
      "XLSXZIP-P0-05F-003-BLOCK-MISSING-RELS",
      "XLSXZIP-P0-05F-004-BLOCK-MISSING-WORKBOOK",
      "XLSXZIP-P0-05F-005-BLOCK-WRONG-CASE-WORKBOOK",
      "XLSXZIP-P0-05F-006-BLOCK-RENAMED-NON-OOXML-ZIP",
      "XLSXZIP-P0-05F-007-BLOCK-ARBITRARY-ZIP-NON-XLSX-METADATA",
      "XLSXZIP-P0-05F-008-BLOCK-XLSX-METADATA-MISSING-OOXML",
    ],
  );
  for (const fixture of readableZipWithoutXlsx) {
    assertPolicyCategory(fixture, "block", "standalone_archive_or_non_xlsx");
  }

  const renamedZip = fixtureById(XLSX_ZIP_FIXTURES, "XLSXZIP-P0-05F-006-BLOCK-RENAMED-NON-OOXML-ZIP");
  assert.equal(renamedZip.fixture_family, "readable_renamed_non_ooxml_zip");
  assert.equal(renamedZip.missing_required_entry, "[Content_Types].xml");
  assert.equal(renamedZip.entries.includes("Content_Types.xml"), true);
});

test("P0-05F.2e covers recognized disallowed signatures and residual unknown binary", () => {
  assert.deepEqual(
    RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES.map((fixture) => [fixture.signature_family, fixture.signature_hex, fixture.signature_offset]),
    [
      ["DOS/PE MZ", "4D 5A", 0],
      ["ELF", "7F 45 4C 46", 0],
      ["gzip", "1F 8B", 0],
      ["7z", "37 7A BC AF 27 1C", 0],
      ["RAR 4", "52 61 72 21 1A 07 00", 0],
      ["RAR 5", "52 61 72 21 1A 07 01 00", 0],
    ],
  );
  for (const fixture of RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES) {
    assert.equal(fixture.normalized_extension, ".txt", fixture.fixture_id);
    assert.equal(fixture.normalized_declared_mime, "text/plain", fixture.fixture_id);
    assertPolicyCategory(fixture, "block", "disallowed_binary_signature");
  }

  const [unknownBinary] = RESIDUAL_UNKNOWN_BINARY_FIXTURES;
  assert.equal(unknownBinary.fixture_id, "UNKNOWNBIN-P0-05F-2D3-001-BLOCK-PDF-APPLICATION-PDF-0001");
  assert.deepEqual(Array.from(unknownBinary.bytes), [0x00, 0x01]);
  assert.equal(unknownBinary.bytes_hex, "00 01");
  assert.equal(unknownBinary.complete_pdf_identity_claim, false);
  assert.equal(unknownBinary.readable_zip_or_xlsx_claim, false);
  assert.equal(unknownBinary.recognized_disallowed_signature_claim, false);
  assertPolicyCategory(unknownBinary, "block", "unknown_binary");
});

test("P0-05F.2e proves ambiguous_file_type is defensive and currently unexercised by construction", () => {
  assert.match(contractText, /`ambiguous_file_type` is a defensive fail-closed category/);
  assert.match(contractText, /must not invent a contrived or semantically impossible byte case solely to exercise it/);
  assert.match(contractText, /do not treat absence of an ambiguity fixture as incomplete coverage when the category is unreachable by construction/);

  const ambiguousFixtures = allFixtures.filter(
    (fixture) =>
      fixture.expected_category === "ambiguous_file_type" ||
      fixture.ambiguous_fixture_claim === true ||
      fixture.classification_exclusions?.ambiguous_file_type === true,
  );
  assert.deepEqual(ambiguousFixtures, []);

  for (const fixture of DETECTED_PERMITTED_TYPE_CONTRADICTION_FIXTURES) {
    assert.equal(fixture.classification_exclusions.ambiguous_file_type, false, fixture.fixture_id);
    assert.equal(fixture.ambiguous_fixture_claim, false, fixture.fixture_id);
  }
});
