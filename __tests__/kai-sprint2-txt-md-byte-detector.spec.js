import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { detectTxtMdBytePolicy } from "../Backend/kai/validators/txtMdByteDetector.js";
import {
  TXT_MD_BYTE_FIXTURES,
  bytesFromHex,
} from "./support/kaiSprint2TxtMdByteFixtureCorpus.js";

const requiredInvalidUtf8Ids = Object.freeze([
  "TXTMD-P0-05D-012-BLOCK-ISOLATED-CONTINUATION",
  "TXTMD-P0-05D-013-BLOCK-TRUNCATED-MULTIBYTE",
  "TXTMD-P0-05D-014-BLOCK-INVALID-LEADING-BYTE",
  "TXTMD-P0-05D-015-BLOCK-OVERLONG",
  "TXTMD-P0-05D-016-BLOCK-SURROGATE-ENCODED",
]);

const requiredUnsupportedBomIds = Object.freeze([
  "TXTMD-P0-05D-017-BLOCK-UTF16-LE-BOM",
  "TXTMD-P0-05D-018-BLOCK-UTF16-BE-BOM",
  "TXTMD-P0-05D-019-BLOCK-UTF32-LE-BOM",
  "TXTMD-P0-05D-020-BLOCK-UTF32-BE-BOM",
]);

const requiredControlBoundary = Object.freeze({
  tabAllows: "TXTMD-P0-05D-005-ALLOW-TAB",
  lfAllows: "TXTMD-P0-05D-003-ALLOW-LF",
  crlfAllows: "TXTMD-P0-05D-004-ALLOW-CRLF",
  prohibitedC0Blocks: "TXTMD-P0-05D-022-BLOCK-PROHIBITED-C0-US",
  delBlocks: "TXTMD-P0-05D-023-BLOCK-DEL",
  c1Blocks: "TXTMD-P0-05D-024-BLOCK-C1-NEL",
  loneCrBeginBlocks: "TXTMD-P0-05D-025-BLOCK-LONE-CR-BEGIN",
  loneCrMiddleBlocks: "TXTMD-P0-05D-026-BLOCK-LONE-CR-MIDDLE",
  loneCrEndBlocks: "TXTMD-P0-05D-027-BLOCK-LONE-CR-END",
});

const forbiddenResultKeys = Object.freeze([
  "bytes",
  "raw_bytes",
  "rawBytes",
  "content",
  "decoded",
  "decoded_content",
  "decodedContent",
  "text",
  "excerpt",
  "filename",
  "path",
]);

function fixtureById(fixtureId) {
  const fixture = TXT_MD_BYTE_FIXTURES.find((item) => item.fixture_id === fixtureId);
  assert.ok(fixture, fixtureId);
  return fixture;
}

function detectionForFixture(fixture) {
  const bytes = bytesFromHex(fixture.bytes_hex);
  const before = Array.from(bytes);
  let result;
  assert.doesNotThrow(() => {
    result = detectTxtMdBytePolicy(bytes);
  }, fixture.fixture_id);
  assert.deepEqual(Array.from(bytes), before, `${fixture.fixture_id}: input bytes unchanged`);
  return result;
}

function assertFixtureAgreement(fixture, result) {
  assert.equal(result.expected_policy, fixture.expected_policy, fixture.fixture_id);
  assert.equal(result.expected_category, fixture.expected_category, fixture.fixture_id);
  assert.equal(result.scope_note, fixture.scope_note, fixture.fixture_id);
}

function assertNoRawOrDecodedContent(value, path = "result") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    assert.equal(forbiddenResultKeys.includes(key), false, `${path}.${key}`);
    assertNoRawOrDecodedContent(nested, `${path}.${key}`);
  }
}

test("TXT/MD byte detector matches all committed corpus expectations without throwing", () => {
  const stats = {
    fixtureTotal: 0,
    matches: 0,
    mismatches: 0,
    falseAllows: 0,
    falseBlocks: 0,
    unclassifiedResults: 0,
    detectorLevelThrows: 0,
  };

  for (const fixture of TXT_MD_BYTE_FIXTURES) {
    stats.fixtureTotal += 1;
    let result;
    try {
      result = detectTxtMdBytePolicy(bytesFromHex(fixture.bytes_hex));
    } catch {
      stats.detectorLevelThrows += 1;
      continue;
    }

    const classified = result?.expected_policy === "allow" || result?.expected_policy === "block";
    if (!classified || !result?.expected_category) stats.unclassifiedResults += 1;
    if (fixture.expected_policy === "block" && result?.expected_policy === "allow") stats.falseAllows += 1;
    if (fixture.expected_policy === "allow" && result?.expected_policy === "block") stats.falseBlocks += 1;

    try {
      assertFixtureAgreement(fixture, result);
      stats.matches += 1;
    } catch {
      stats.mismatches += 1;
    }
  }

  assert.deepEqual(stats, {
    fixtureTotal: 27,
    matches: 27,
    mismatches: 0,
    falseAllows: 0,
    falseBlocks: 0,
    unclassifiedResults: 0,
    detectorLevelThrows: 0,
  });
});

test("invalid UTF-8 decoder failures are caught internally and returned as block results", () => {
  for (const fixtureId of requiredInvalidUtf8Ids) {
    const fixture = fixtureById(fixtureId);
    const result = detectionForFixture(fixture);
    assertFixtureAgreement(fixture, result);
    assert.equal(result.expected_policy, "block", fixtureId);
    assert.equal(result.expected_category, "invalid_utf8", fixtureId);
    assert.equal(result.evidence.decoder_error_caught, true, fixtureId);
  }
});

test("unsupported UTF BOM prefixes block before charset detection or fallback decoding", () => {
  for (const fixtureId of requiredUnsupportedBomIds) {
    const fixture = fixtureById(fixtureId);
    const result = detectionForFixture(fixture);
    assertFixtureAgreement(fixture, result);
    assert.equal(result.expected_policy, "block", fixtureId);
    assert.equal(result.expected_category, "unsupported_bom_encoding", fixtureId);
    assert.equal(result.evidence.decoder_error_caught, false, fixtureId);
  }
});

test("control boundary permits TAB, LF, and CRLF while blocking committed controls", () => {
  const expectations = [
    [requiredControlBoundary.tabAllows, "allow", "encoding_gate_pass"],
    [requiredControlBoundary.lfAllows, "allow", "encoding_gate_pass"],
    [requiredControlBoundary.crlfAllows, "allow", "encoding_gate_pass"],
    [requiredControlBoundary.prohibitedC0Blocks, "block", "prohibited_control"],
    [requiredControlBoundary.delBlocks, "block", "prohibited_control"],
    [requiredControlBoundary.c1Blocks, "block", "prohibited_control"],
    [requiredControlBoundary.loneCrBeginBlocks, "block", "lone_cr"],
    [requiredControlBoundary.loneCrMiddleBlocks, "block", "lone_cr"],
    [requiredControlBoundary.loneCrEndBlocks, "block", "lone_cr"],
  ];

  for (const [fixtureId, expectedPolicy, expectedCategory] of expectations) {
    const result = detectionForFixture(fixtureById(fixtureId));
    assert.equal(result.expected_policy, expectedPolicy, fixtureId);
    assert.equal(result.expected_category, expectedCategory, fixtureId);
  }
});

test("UTF-8 BOM handling removes exactly one leading sequence and retains later U+FEFF", () => {
  const leadingBomText = detectionForFixture(fixtureById("TXTMD-P0-05D-008-ALLOW-LEADING-UTF8-BOM-TEXT"));
  assert.equal(leadingBomText.expected_policy, "allow");
  assert.equal(leadingBomText.evidence.utf8_bom_removed, true);
  assert.equal(leadingBomText.evidence.decoded_ufeff_count, 0);

  const bomOnly = detectionForFixture(fixtureById("TXTMD-P0-05D-009-ALLOW-LEADING-UTF8-BOM-ONLY"));
  assert.equal(bomOnly.expected_policy, "allow");
  assert.equal(bomOnly.scope_note, "encoding_gate_pass_only");
  assert.equal(bomOnly.evidence.utf8_bom_removed, true);
  assert.equal(bomOnly.evidence.decoded_ufeff_count, 0);

  const nonLeading = detectionForFixture(fixtureById("TXTMD-P0-05D-010-ALLOW-NONLEADING-UFEFF"));
  assert.equal(nonLeading.expected_policy, "allow");
  assert.equal(nonLeading.evidence.utf8_bom_removed, false);
  assert.equal(nonLeading.evidence.decoded_ufeff_count, 1);

  const twoInitial = detectionForFixture(fixtureById("TXTMD-P0-05D-011-ALLOW-TWO-INITIAL-EFBBBF"));
  assert.equal(twoInitial.expected_policy, "allow");
  assert.equal(twoInitial.evidence.utf8_bom_removed, true);
  assert.equal(twoInitial.evidence.decoded_ufeff_count, 1);
});

test("scope and safety metadata remain narrow and raw content is never exposed or logged", () => {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const logCalls = [];
  console.log = (...args) => logCalls.push(args);
  console.error = (...args) => logCalls.push(args);
  console.warn = (...args) => logCalls.push(args);
  try {
    for (const fixture of TXT_MD_BYTE_FIXTURES) {
      const result = detectionForFixture(fixture);
      assertNoRawOrDecodedContent(result);
      if (fixture.expected_policy === "allow") {
        assert.equal(result.evidence.encoding_gate_pass_only, true, fixture.fixture_id);
      }
    }
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }

  assert.deepEqual(logCalls, []);

  const empty = detectionForFixture(fixtureById("TXTMD-P0-05D-006-ALLOW-EMPTY"));
  assert.equal(empty.expected_policy, "allow");
  assert.equal(empty.expected_category, "encoding_gate_pass");
  assert.equal(empty.scope_note, "encoding_gate_pass_only");

  const instructionLike = detectionForFixture(fixtureById("TXTMD-P0-05D-007-ALLOW-INSTRUCTION-LIKE-TEXT"));
  assert.equal(instructionLike.expected_policy, "allow");
  assert.equal(instructionLike.expected_category, "encoding_gate_pass");
  assert.equal(instructionLike.scope_note, "encoding_gate_pass_only");
});

test("detector implementation owns BOM policy and has no integration imports", () => {
  const detectorSource = readFileSync("Backend/kai/validators/txtMdByteDetector.js", "utf8");
  assert.match(detectorSource, /const UTF8_BOM = Object\.freeze\(\[0xEF, 0xBB, 0xBF\]\)/);
  assert.match(detectorSource, /bytes\.subarray\(UTF8_BOM\.length\)/);
  assert.match(detectorSource, /ignoreBOM:\s*true/);
  assert.doesNotMatch(detectorSource, /toString\(["']utf8["']\)|Buffer\.from|fetch\(|from\s+["']node:fs|from\s+["']node:http|from\s+["']node:https|console\./);
  assert.doesNotMatch(detectorSource, /requestUploadUrl|confirmUpload|reserveIntakeFileMetadata|storage|worker|parser|profile|route/i);
});
