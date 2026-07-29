import test from "node:test";
import assert from "node:assert/strict";

import { KAI_SPRINT2_P0_CSV_LIMITS } from "../Backend/kai/config/kaiSprint2P0Contract.js";
import {
  detectCsvRowLimitPolicy,
  __testables as csvRowLimitTestables,
} from "../Backend/kai/validators/csvRowLimitDetector.js";

const csvRowLimitExceededResult = Object.freeze({
  policy: "block",
  category: "csv_row_limit_exceeded",
});

function bytes(text) {
  return new TextEncoder().encode(text);
}

function csvInput(text) {
  return Object.freeze({
    extension: ".csv",
    declaredMime: "text/csv",
    bytes: bytes(text),
  });
}

function detectCsv(text) {
  return detectCsvRowLimitPolicy(csvInput(text));
}

function countCsv(text, maximumRecords = KAI_SPRINT2_P0_CSV_LIMITS.maxLogicalRecords) {
  return csvRowLimitTestables.countCsvLogicalRecordsUntilLimit(bytes(text), maximumRecords);
}

function assertSanitizedCsvFailure(operation) {
  assert.throws(
    operation,
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error.message, "CSV row-limit inspection failed.");
      assert.equal(error.message.includes("unterminated"), false);
      assert.equal(error.message.includes("quote"), false);
      assert.equal(error.message.includes("a,b"), false);
      return true;
    },
  );
}

test("P0-05 CSV row-limit counter matches the exact logical-record counting table", () => {
  for (const [input, expectedRecords] of [
    ["", 0],
    ["a", 1],
    ["a\n", 1],
    ["\n", 1],
    ["\n\n", 2],
    ["a\n\n", 2],
  ]) {
    const result = countCsv(input);
    assert.deepEqual(result, {
      records: expectedRecords,
      exceeded: false,
    }, JSON.stringify(input));
    assert.equal(detectCsv(input), undefined, JSON.stringify(input));
  }
});

test("P0-05 CSV row-limit detector returns undefined at exactly 100000 and blocks at 100001", () => {
  const atLimit = `${"r\n".repeat(KAI_SPRINT2_P0_CSV_LIMITS.maxLogicalRecords)}`;
  const overLimit = `${atLimit}r`;

  assert.equal(countCsv(atLimit).records, KAI_SPRINT2_P0_CSV_LIMITS.maxLogicalRecords);
  assert.equal(detectCsv(atLimit), undefined);

  const result = detectCsv(overLimit);
  assert.deepEqual(result, csvRowLimitExceededResult);
  assert.deepEqual(Object.keys(result), ["policy", "category"]);
});

test("P0-05 CSV row-limit detector handles LF, CRLF, quoted newlines, commas, and escaped quotes", () => {
  const input = [
    "alpha,beta",
    "\"quoted",
    "LF\",next",
    "\"quoted\r\nCRLF\",\"escaped \"\" quote\",tail",
    ",,",
  ].join("\n");

  assert.deepEqual(countCsv(input), {
    records: 4,
    exceeded: false,
  });
  assert.equal(detectCsv(input), undefined);
});

test("P0-05 CSV row-limit detector treats unterminated quotes and lone CR as sanitized failures", () => {
  assertSanitizedCsvFailure(() => detectCsv("\"unterminated"));
  assertSanitizedCsvFailure(() => detectCsv("a\rb"));
});

test("P0-05 CSV row-limit detector stops immediately at 100001", () => {
  const malformedAfterLimit = `${"r\n".repeat(KAI_SPRINT2_P0_CSV_LIMITS.maxLogicalRecords + 1)}"unterminated`;

  assert.deepEqual(detectCsv(malformedAfterLimit), csvRowLimitExceededResult);
});

test("P0-05 CSV row-limit detector is deterministic and exact result shape stays closed", () => {
  const overLimit = `${"r\n".repeat(KAI_SPRINT2_P0_CSV_LIMITS.maxLogicalRecords)}r`;
  const first = detectCsv(overLimit);
  const second = detectCsv(overLimit);

  assert.strictEqual(first, second);
  assert.deepEqual(first, csvRowLimitExceededResult);
  assert.deepEqual(Object.keys(first), ["policy", "category"]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(JSON.stringify(first).includes("records"), false);
});

test("P0-05 CSV row-limit detector keeps instruction-like and formula-like values inert", () => {
  const content = [
    "=cmd|'/C calc'!A0,+SUM(A1:A2),-10,@HYPERLINK(http://example.test)",
    "plain,=not executed,+not rewritten,-not returned,@not logged",
  ].join("\n");
  const observedConsoleCalls = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args) => observedConsoleCalls.push(args);
  console.warn = (...args) => observedConsoleCalls.push(args);
  console.error = (...args) => observedConsoleCalls.push(args);
  try {
    assert.equal(detectCsv(content), undefined);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.deepEqual(observedConsoleCalls, []);
  assert.equal(JSON.stringify(detectCsv(content)), undefined);
  assert.equal(content.includes("'"), true);
});

test("P0-05 CSV row-limit results and sanitized errors expose no raw content or internals", () => {
  const formulaRow = "=secret,+secret,-secret,@secret\n";
  const result = detectCsv(`${"r\n".repeat(KAI_SPRINT2_P0_CSV_LIMITS.maxLogicalRecords)}${formulaRow}`);

  assert.deepEqual(result, csvRowLimitExceededResult);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("record"), false);
  assertSanitizedCsvFailure(() => detectCsv("\"secret"));
});
