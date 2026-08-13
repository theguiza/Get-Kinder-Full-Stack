import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const REPOSITORY_ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "coverage", "dist", "build"]);

const INTERNAL_CORE_PATH = ["Backend", "kai", "internal", "kaiMutationOrchestration.js"].join("/");
const TEST_HARNESS_PATH = ["__tests__", "support", "kaiMutationOrchestrationTestHarness.js"].join("/");
const TRANSACTION_INTERFACE_PATH = ["Backend", "kai", "db", "kaiDb.js"].join("/");
const ROUTE_SPECIFIC_RUNTIME_COMPOSITION_PATH = ["Backend", "kai", "services", "kaiIntakeService.js"].join("/");
const FUTURE_REVIEW_QUEUE_RUNTIME_COMPOSITION_PATH = [
  "Backend",
  "kai",
  "services",
  "kaiReviewQueueService.js",
].join("/");

const ORCHESTRATION_SYMBOLS = [
  ["orchestrate", "Mutation", "With", "Required", "Audit"].join(""),
  ["Required", "Audit", "Persistence", "Error"].join(""),
  ["REQUIRED", "AUDIT", "METADATA", "ALLOWLIST"].join("_"),
  ["BEST", "EFFORT", "METRIC", "METADATA", "ALLOWLIST"].join("_"),
  ["sanitize", "Required", "Audit", "Metadata"].join(""),
  ["sanitize", "Best", "Effort", "Metric", "Metadata"].join(""),
];
const CORE_CALL_SYMBOL = ORCHESTRATION_SYMBOLS[0];
const TEST_HARNESS_SYMBOLS = [
  ["run", "Mutation", "Orchestration", "For", "Test"].join(""),
  ["create", "Transaction", "Harness"].join(""),
  ["with", "Test", "Transaction"].join(""),
];
const TRANSACTION_PROVIDER_SYMBOL = ["transaction", "Provider"].join("");
const LEGACY_TEST_OPTION_SYMBOL = ["test", "Only", "Transaction", "Provider"].join("");
const MARK_FILE_POLICY_BLOCKED_FUNCTION = "markIntakeFilePolicyBlocked";
const APPLY_CONFIRMED_SECURITY_ASSESSMENT_FUNCTION = "applyConfirmedSecurityAssessment";
const UPDATE_REVIEW_QUEUE_STATUS_FUNCTION = "updateReviewQueueStatus";

const ALLOWED_CORE_IMPORTERS = new Set([TEST_HARNESS_PATH, ROUTE_SPECIFIC_RUNTIME_COMPOSITION_PATH]);
const ALLOWED_HARNESS_IMPORTERS = new Set([
  "__tests__/kai-sprint2-mutation-orchestration.spec.js",
  "__tests__/kai-sprint2-transaction-interface.spec.js",
]);
const ALLOWED_CORE_CALLERS = new Set([TEST_HARNESS_PATH, ROUTE_SPECIFIC_RUNTIME_COMPOSITION_PATH]);
const ALLOWED_HARNESS_CALLERS = new Set([
  TEST_HARNESS_PATH,
  ...ALLOWED_HARNESS_IMPORTERS,
]);
const ALLOWED_ORCHESTRATION_EXPORTERS = new Set([INTERNAL_CORE_PATH, TEST_HARNESS_PATH]);
const ALLOWED_HARNESS_EXPORTERS = new Set([TEST_HARNESS_PATH]);
const ALLOWED_TRANSACTION_PROVIDER_FILES = new Set([
  TRANSACTION_INTERFACE_PATH,
  TEST_HARNESS_PATH,
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskJavaScriptNonCode(source) {
  const chars = source.split("");
  const stack = [{ type: "code" }];
  const maskAt = (index) => {
    if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
  };
  const currentMode = () => stack[stack.length - 1];
  let index = 0;

  while (index < source.length) {
    const mode = currentMode();
    const char = source[index];
    const next = source[index + 1];

    if (mode.type === "template") {
      if (char === "\\") {
        maskAt(index);
        if (index + 1 < source.length) maskAt(index + 1);
        index += 2;
        continue;
      }
      if (char === "`") {
        maskAt(index);
        stack.pop();
        index += 1;
        continue;
      }
      if (char === "$" && next === "{") {
        maskAt(index);
        stack.push({ type: "templateExpression", depth: 1 });
        index += 2;
        continue;
      }
      maskAt(index);
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      maskAt(index);
      maskAt(index + 1);
      index += 2;
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") {
        maskAt(index);
        index += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      maskAt(index);
      maskAt(index + 1);
      index += 2;
      while (index < source.length) {
        if (source[index] === "*" && source[index + 1] === "/") {
          maskAt(index);
          maskAt(index + 1);
          index += 2;
          break;
        }
        maskAt(index);
        index += 1;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      const quote = char;
      maskAt(index);
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          maskAt(index);
          if (index + 1 < source.length) maskAt(index + 1);
          index += 2;
          continue;
        }
        maskAt(index);
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (char === "`") {
      maskAt(index);
      stack.push({ type: "template" });
      index += 1;
      continue;
    }

    if (mode.type === "templateExpression") {
      if (char === "{") {
        mode.depth += 1;
      } else if (char === "}") {
        mode.depth -= 1;
        if (mode.depth === 0) {
          stack.pop();
        }
      }
    }

    index += 1;
  }

  return chars.join("");
}

function findMatchingBrace(maskedSource, openBraceIndex) {
  assert.equal(maskedSource[openBraceIndex], "{", "function body locator must start at an opening brace");
  let depth = 0;
  for (let index = openBraceIndex; index < maskedSource.length; index += 1) {
    if (maskedSource[index] === "{") depth += 1;
    if (maskedSource[index] === "}") depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error("Unable to locate matching function body closing brace.");
}

function findFunctionBodyStart(maskedSource, searchStart) {
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let index = searchStart; index < maskedSource.length; index += 1) {
    const char = maskedSource[index];
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;
    if (char === "{" && parenDepth === 0 && bracketDepth === 0) return index;
  }
  return -1;
}

function exportedAsyncFunctionBody(source, functionName) {
  const functionBody = optionalExportedAsyncFunctionBody(source, functionName);
  assert.notEqual(functionBody, null, `Expected exactly one exported async function ${functionName}.`);
  return functionBody;
}

function optionalExportedAsyncFunctionBody(source, functionName) {
  const maskedSource = maskJavaScriptNonCode(source);
  const declarationPattern = new RegExp(
    `\\bexport\\s+async\\s+function\\s+${escapeRegExp(functionName)}\\b`,
    "g",
  );
  const declarations = [...maskedSource.matchAll(declarationPattern)];
  if (declarations.length === 0) return null;
  assert.equal(declarations.length, 1, `Expected exactly one exported async function ${functionName}.`);

  const bodyStart = findFunctionBodyStart(maskedSource, declarations[0].index + declarations[0][0].length);
  assert.notEqual(bodyStart, -1, `Expected ${functionName} to have a function body.`);
  const bodyEnd = findMatchingBrace(maskedSource, bodyStart);
  return {
    functionName,
    declarationStart: declarations[0].index,
    bodyStart,
    bodyEnd,
    startLine: lineNumberAt(source, declarations[0].index),
    endLine: lineNumberAt(source, bodyEnd),
  };
}

function sourceFiles(directory = REPOSITORY_ROOT) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(absolutePath));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.relative(REPOSITORY_ROOT, absolutePath).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function matchedText(source, index, length) {
  return source
    .slice(index, index + length)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function record(file, source, kind, match) {
  return {
    file,
    line: lineNumberAt(source, match.index),
    kind,
    match: matchedText(source, match.index, match[0].length),
    index: match.index,
    length: match[0].length,
  };
}

function resolveModuleSpecifier(file, specifier) {
  if (!specifier.startsWith(".")) return specifier;
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
}

function targetsModule(file, specifier, targetPath) {
  const resolved = resolveModuleSpecifier(file, specifier);
  const withoutExtension = (value) => value.replace(/\.(?:js|jsx|mjs|cjs|ts|tsx)$/, "");
  const targetBaseName = withoutExtension(path.posix.basename(targetPath));
  return (
    withoutExtension(resolved) === withoutExtension(targetPath) ||
    withoutExtension(path.posix.basename(specifier)) === targetBaseName
  );
}

function moduleEdges(file, source) {
  const edges = [];
  const patterns = [
    ["import", /\bimport\s+(?:[^"'`;]*?\s+from\s*)?["']([^"']+)["']/g],
    ["dynamic import", /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g],
    ["require", /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g],
    ["re-export", /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g],
  ];

  for (const [kind, pattern] of patterns) {
    for (const match of source.matchAll(pattern)) {
      edges.push({ ...record(file, source, kind, match), specifier: match[1] });
    }
  }
  return edges;
}

function symbolCalls(file, source, symbols) {
  const calls = [];
  const maskedSource = maskJavaScriptNonCode(source);
  for (const symbol of symbols) {
    const pattern = new RegExp(`\\b${escapeRegExp(symbol)}\\s*\\(`, "g");
    for (const match of maskedSource.matchAll(pattern)) {
      const prefix = maskedSource.slice(Math.max(0, match.index - 80), match.index);
      if (/\bfunction\s*$/.test(prefix)) continue;
      calls.push({ ...record(file, source, `call ${symbol}`, match), symbol });
    }
  }
  return calls;
}

function assertSingleDirectCoreCallInsideExportedAsyncFunction(source, file, functionName) {
  const functionBody = exportedAsyncFunctionBody(source, functionName);
  const coreCalls = symbolCalls(file, source, [CORE_CALL_SYMBOL]);
  const callsInsideTarget = coreCalls.filter(
    ({ index }) => index > functionBody.bodyStart && index < functionBody.bodyEnd,
  );
  const callsOutsideTarget = coreCalls.filter(
    ({ index }) => index <= functionBody.bodyStart || index >= functionBody.bodyEnd,
  );

  assert.equal(
    coreCalls.length,
    1,
    `Expected exactly one direct production call to ${CORE_CALL_SYMBOL}; found ${coreCalls.length}.`,
  );
  assert.equal(
    callsInsideTarget.length,
    1,
    `Expected the single ${CORE_CALL_SYMBOL} call to be inside ${functionName}.`,
  );
  assert.equal(
    callsOutsideTarget.length,
    0,
    `Expected zero ${CORE_CALL_SYMBOL} calls outside ${functionName}; found:\n${formatUnexpected(callsOutsideTarget)}`,
  );

  return {
    functionBody,
    call: callsInsideTarget[0],
    callsOutsideTarget,
  };
}

function assertSingleDirectCoreCallInsideMarkFilePolicyBlocked(source, file) {
  return assertSingleDirectCoreCallInsideExportedAsyncFunction(
    source,
    file,
    MARK_FILE_POLICY_BLOCKED_FUNCTION,
  );
}

/**
 * Gate C production post-confirm security-assessment handoff: the security
 * policy mutation reuses the same orchestration core as the file-policy
 * block route (Path A), inside its own exported async function. This
 * generalizes the single-function fence above to authorize exactly one
 * direct core call inside each of several named exported async functions in
 * one file, with zero calls anywhere else.
 */
function assertDirectCoreCallsInsideExportedAsyncFunctions(source, file, functionNames) {
  const coreCalls = symbolCalls(file, source, [CORE_CALL_SYMBOL]);
  const placements = functionNames.map((functionName) => {
    const functionBody = exportedAsyncFunctionBody(source, functionName);
    const callsInside = coreCalls.filter(
      ({ index }) => index > functionBody.bodyStart && index < functionBody.bodyEnd,
    );
    assert.equal(
      callsInside.length,
      1,
      `Expected exactly one ${CORE_CALL_SYMBOL} call inside ${functionName}; found ${callsInside.length}.`,
    );
    return { functionName, functionBody, call: callsInside[0] };
  });

  const callsInsideAnyTarget = new Set(placements.map(({ call }) => call.index));
  const callsOutsideTargets = coreCalls.filter(({ index }) => !callsInsideAnyTarget.has(index));

  assert.equal(
    coreCalls.length,
    functionNames.length,
    `Expected exactly ${functionNames.length} direct production calls to ${CORE_CALL_SYMBOL}; found ${coreCalls.length}.`,
  );
  assert.equal(
    callsOutsideTargets.length,
    0,
    `Expected zero ${CORE_CALL_SYMBOL} calls outside ${functionNames.join(", ")}; found:\n${formatUnexpected(callsOutsideTargets)}`,
  );

  return { placements, callsOutsideTargets };
}

function assertFutureReviewQueuePreauthorization(sourceByPath) {
  const source = sourceByPath.get(FUTURE_REVIEW_QUEUE_RUNTIME_COMPOSITION_PATH);
  if (source === undefined) {
    return {
      present: false,
      exactDeclarationDetected: false,
      authorized: false,
      activeProductionCoreFiles: [ROUTE_SPECIFIC_RUNTIME_COMPOSITION_PATH],
      reason: "future_service_absent",
    };
  }

  const file = FUTURE_REVIEW_QUEUE_RUNTIME_COMPOSITION_PATH;
  const coreEdges = moduleEdges(file, source).filter((edge) =>
    targetsModule(file, edge.specifier, INTERNAL_CORE_PATH)
  );
  const coreCalls = symbolCalls(file, source, [CORE_CALL_SYMBOL]);
  const functionBody = optionalExportedAsyncFunctionBody(source, UPDATE_REVIEW_QUEUE_STATUS_FUNCTION);

  if (!functionBody) {
    assert.equal(
      coreEdges.length,
      0,
      `Unauthorized orchestration core import before exact ${UPDATE_REVIEW_QUEUE_STATUS_FUNCTION} declaration:\n${formatUnexpected(coreEdges)}`,
    );
    assert.equal(
      coreCalls.length,
      0,
      `Unauthorized ${CORE_CALL_SYMBOL} call before exact ${UPDATE_REVIEW_QUEUE_STATUS_FUNCTION} declaration:\n${formatUnexpected(coreCalls)}`,
    );
    return {
      present: true,
      exactDeclarationDetected: false,
      authorized: false,
      activeProductionCoreFiles: [ROUTE_SPECIFIC_RUNTIME_COMPOSITION_PATH],
      reason: "exact_declaration_absent",
    };
  }

  assert.equal(
    coreEdges.filter(({ kind }) => kind === "import").length,
    1,
    `Expected ${file} to import the orchestration core exactly once after exact ${UPDATE_REVIEW_QUEUE_STATUS_FUNCTION} declaration.`,
  );
  assert.equal(
    coreEdges.filter(({ kind }) => kind !== "import").length,
    0,
    `Expected ${file} to have no non-import orchestration core module edges:\n${formatUnexpected(coreEdges.filter(({ kind }) => kind !== "import"))}`,
  );

  const placement = assertSingleDirectCoreCallInsideExportedAsyncFunction(
    source,
    file,
    UPDATE_REVIEW_QUEUE_STATUS_FUNCTION,
  );

  return {
    present: true,
    exactDeclarationDetected: true,
    authorized: true,
    activeProductionCoreFiles: [
      ROUTE_SPECIFIC_RUNTIME_COMPOSITION_PATH,
      FUTURE_REVIEW_QUEUE_RUNTIME_COMPOSITION_PATH,
    ],
    reason: "exact_declaration_authorized",
    functionStartLine: placement.functionBody.startLine,
    functionEndLine: placement.functionBody.endLine,
    callLine: placement.call.line,
    callsOutsideFunction: placement.callsOutsideTarget.length,
  };
}

function symbolExports(file, source, symbols) {
  const exports = [];
  for (const symbol of symbols) {
    const definitionPattern = new RegExp(
      `\\bexport\\s+(?:default\\s+)?(?:async\\s+)?(?:function|class|const|let|var)\\s+${escapeRegExp(symbol)}\\b`,
      "g",
    );
    for (const match of source.matchAll(definitionPattern)) {
      exports.push({ ...record(file, source, `definition export ${symbol}`, match), symbol });
    }
  }

  const exportListPattern = /\bexport\s*\{([\s\S]*?)\}\s*(?:from\s*["'][^"']+["'])?\s*;/g;
  for (const match of source.matchAll(exportListPattern)) {
    for (const symbol of symbols) {
      if (new RegExp(`\\b${escapeRegExp(symbol)}\\b`).test(match[1])) {
        const kind = /\}\s*from\s*["']/.test(match[0]) ? "named re-export" : "named export";
        exports.push({ ...record(file, source, `${kind} ${symbol}`, match), symbol });
      }
    }
  }
  return exports;
}

function symbolOccurrences(file, source, symbol, kind) {
  const pattern = new RegExp(`\\b${escapeRegExp(symbol)}\\b`, "g");
  return [...source.matchAll(pattern)].map((match) => record(file, source, kind, match));
}

function formatUnexpected(records) {
  return records
    .map(({ file, line, kind, match }) => `${file}:${line} [${kind}] ${match}`)
    .join("\n");
}

test("function body locator accepts only direct file-policy block orchestration placement", () => {
  const fixturePath = "synthetic/kaiIntakeService.js";
  const insideFixture = [
    "const ignored = \"orchestrateMutationWithRequiredAudit({ not: 'code' })\";",
    "export async function markIntakeFilePolicyBlocked(input = {}) {",
    "  const literal = \"{ this brace is not structural }\";",
    "  const template = `raw { text } ${input.ok ? { nested: true } : { nested: false }}`;",
    "  if (input.ok) {",
    "    return await orchestrateMutationWithRequiredAudit({ mutation: { value: \"}\" } }, {}, async () => ({}));",
    "  }",
    "  return null;",
    "}",
  ].join("\n");
  const otherFunctionFixture = [
    "export async function markIntakeFilePolicyBlocked() {",
    "  return null;",
    "}",
    "export async function markAnotherMutation() {",
    "  return await orchestrateMutationWithRequiredAudit({}, {}, async () => ({}));",
    "}",
  ].join("\n");
  const genericHelperFixture = [
    "function runMutation(input) {",
    "  return orchestrateMutationWithRequiredAudit(input, {}, async () => ({}));",
    "}",
    "export async function markIntakeFilePolicyBlocked(input = {}) {",
    "  return await runMutation(input);",
    "}",
  ].join("\n");
  const topLevelFixture = [
    "const eagerMutation = orchestrateMutationWithRequiredAudit({}, {}, async () => ({}));",
    "export async function markIntakeFilePolicyBlocked() {",
    "  return eagerMutation;",
    "}",
  ].join("\n");

  const fixtureProof = {};
  fixtureProof.inside_function = assertSingleDirectCoreCallInsideMarkFilePolicyBlocked(
    insideFixture,
    fixturePath,
  ).call.line;

  for (const [name, source] of [
    ["other_function", otherFunctionFixture],
    ["generic_helper", genericHelperFixture],
    ["top_level", topLevelFixture],
  ]) {
    assert.throws(
      () => assertSingleDirectCoreCallInsideMarkFilePolicyBlocked(source, fixturePath),
      (error) => {
        fixtureProof[name] = error.message;
        return /inside markIntakeFilePolicyBlocked|outside markIntakeFilePolicyBlocked/.test(error.message);
      },
    );
  }

  console.log(`ORCHESTRATION_BODY_LOCATOR_FIXTURE_PROOF ${JSON.stringify(fixtureProof)}`);
});

test("future review-queue status orchestration preauthorization is exact and conditional", () => {
  const futurePath = FUTURE_REVIEW_QUEUE_RUNTIME_COMPOSITION_PATH;
  const coreImport = [
    "import { orchestrateMutationWithRequiredAudit } from \"../internal/kaiMutationOrchestration.js\";",
    "",
  ].join("\n");
  const exactAcceptedFixture = [
    coreImport,
    "export async function updateReviewQueueStatus(input = {}) {",
    "  return await orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({}));",
    "}",
  ].join("\n");
  const proof = {
    absent_future_file: assertFutureReviewQueuePreauthorization(new Map()),
    no_exact_declaration_without_core_reference: assertFutureReviewQueuePreauthorization(new Map([
      [
        futurePath,
        [
          "export async function createReviewQueueItem(input = {}) {",
          "  return { ok: true, input };",
          "}",
        ].join("\n"),
      ],
    ])),
    exact_declaration_with_direct_call: assertFutureReviewQueuePreauthorization(new Map([
      [futurePath, exactAcceptedFixture],
    ])),
  };

  assert.equal(proof.absent_future_file.authorized, false);
  assert.deepEqual(proof.absent_future_file.activeProductionCoreFiles, [
    ROUTE_SPECIFIC_RUNTIME_COMPOSITION_PATH,
  ]);
  assert.equal(proof.no_exact_declaration_without_core_reference.authorized, false);
  assert.deepEqual(proof.no_exact_declaration_without_core_reference.activeProductionCoreFiles, [
    ROUTE_SPECIFIC_RUNTIME_COMPOSITION_PATH,
  ]);
  assert.equal(proof.exact_declaration_with_direct_call.exactDeclarationDetected, true);
  assert.deepEqual(proof.exact_declaration_with_direct_call.activeProductionCoreFiles, [
    ROUTE_SPECIFIC_RUNTIME_COMPOSITION_PATH,
    FUTURE_REVIEW_QUEUE_RUNTIME_COMPOSITION_PATH,
  ]);

  const rejectedFixtures = [
    [
      "no_exact_declaration_with_core_import",
      [
        coreImport,
        "export async function createReviewQueueItem(input = {}) {",
        "  return { ok: true, input };",
        "}",
      ].join("\n"),
      /core import before exact updateReviewQueueStatus declaration/,
    ],
    [
      "no_exact_declaration_with_core_call",
      [
        "export async function createReviewQueueItem(input = {}) {",
        "  return orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({}));",
        "}",
      ].join("\n"),
      /call before exact updateReviewQueueStatus declaration/,
    ],
    [
      "near_miss_function_name",
      [
        "export async function updateReviewQueueItemStatus(input = {}) {",
        "  return orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({}));",
        "}",
      ].join("\n"),
      /call before exact updateReviewQueueStatus declaration/,
    ],
    [
      "non_exported_exact_name",
      [
        "async function updateReviewQueueStatus(input = {}) {",
        "  return orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({}));",
        "}",
      ].join("\n"),
      /call before exact updateReviewQueueStatus declaration/,
    ],
    [
      "exported_sync_function_form",
      [
        "export function updateReviewQueueStatus(input = {}) {",
        "  return orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({}));",
        "}",
      ].join("\n"),
      /call before exact updateReviewQueueStatus declaration/,
    ],
    [
      "exported_constant_form",
      [
        "export const updateReviewQueueStatus = async (input = {}) => {",
        "  return orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({}));",
        "};",
      ].join("\n"),
      /call before exact updateReviewQueueStatus declaration/,
    ],
    [
      "named_export_alias_form",
      [
        "const updateReviewQueueStatus = (input = {}) => {",
        "  return orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({}));",
        "};",
        "export { updateReviewQueueStatus };",
      ].join("\n"),
      /call before exact updateReviewQueueStatus declaration/,
    ],
    [
      "object_method_form",
      [
        "export const reviewQueueService = {",
        "  updateReviewQueueStatus(input = {}) {",
        "    return orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({}));",
        "  },",
        "};",
      ].join("\n"),
      /call before exact updateReviewQueueStatus declaration/,
    ],
    [
      "class_method_form",
      [
        "export class ReviewQueueService {",
        "  async updateReviewQueueStatus(input = {}) {",
        "    return orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({}));",
        "  }",
        "}",
      ].join("\n"),
      /call before exact updateReviewQueueStatus declaration/,
    ],
    [
      "default_export_form",
      [
        "export default async function updateReviewQueueStatus(input = {}) {",
        "  return orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({}));",
        "}",
      ].join("\n"),
      /call before exact updateReviewQueueStatus declaration/,
    ],
    [
      "exact_declaration_call_in_other_function",
      [
        coreImport,
        "export async function updateReviewQueueStatus(input = {}) {",
        "  return { ok: true, input };",
        "}",
        "export async function closeReviewQueueStatus(input = {}) {",
        "  return orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({}));",
        "}",
      ].join("\n"),
      /inside updateReviewQueueStatus/,
    ],
    [
      "exact_declaration_generic_helper_wraps_call",
      [
        coreImport,
        "function runStatusMutation(input) {",
        "  return orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({}));",
        "}",
        "export async function updateReviewQueueStatus(input = {}) {",
        "  return runStatusMutation(input);",
        "}",
      ].join("\n"),
      /inside updateReviewQueueStatus/,
    ],
    [
      "exact_declaration_top_level_call",
      [
        coreImport,
        "const eagerMutation = orchestrateMutationWithRequiredAudit({}, {}, async () => ({}));",
        "export async function updateReviewQueueStatus(input = {}) {",
        "  return orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({})) || eagerMutation;",
        "}",
      ].join("\n"),
      /exactly one direct production call/,
    ],
    [
      "exact_declaration_multiple_calls",
      [
        coreImport,
        "export async function updateReviewQueueStatus(input = {}) {",
        "  await orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({}));",
        "  return orchestrateMutationWithRequiredAudit({ mutation: input }, {}, async () => ({}));",
        "}",
      ].join("\n"),
      /exactly one direct production call/,
    ],
  ];

  for (const [name, source, expectedMessage] of rejectedFixtures) {
    assert.throws(
      () => assertFutureReviewQueuePreauthorization(new Map([[futurePath, source]])),
      (error) => {
        proof[name] = {
          exactDeclarationDetected: optionalExportedAsyncFunctionBody(
            source,
            UPDATE_REVIEW_QUEUE_STATUS_FUNCTION,
          ) !== null,
          message: error.message,
        };
        return expectedMessage.test(error.message);
      },
    );
  }

  console.log(`FUTURE_REVIEW_QUEUE_PREAUTHORIZATION_FIXTURE_PROOF ${JSON.stringify(proof)}`);
});

test("internal orchestration has only the approved file-policy block runtime caller", () => {
  const sourceByPath = new Map(
    sourceFiles().map((file) => [file, readFileSync(path.join(REPOSITORY_ROOT, file), "utf8")]),
  );
  const futureReviewQueueAuthorization = assertFutureReviewQueuePreauthorization(sourceByPath);
  const activeCoreImporters = new Set([
    TEST_HARNESS_PATH,
    ...futureReviewQueueAuthorization.activeProductionCoreFiles,
  ]);
  const activeCoreCallers = new Set([
    TEST_HARNESS_PATH,
    ...futureReviewQueueAuthorization.activeProductionCoreFiles,
  ]);
  const report = {
    core_importers: [],
    test_harness_importers: [],
    core_callers: [],
    test_harness_callers: [],
    orchestration_exports: [],
    test_harness_exports: [],
    re_exports: [],
    transaction_provider_occurrences: [],
    legacy_test_option_occurrences: [],
    unexpected: [],
  };

  for (const [file, source] of sourceByPath) {
    const edges = moduleEdges(file, source);
    const coreEdges = edges.filter((edge) => targetsModule(file, edge.specifier, INTERNAL_CORE_PATH));
    const harnessEdges = edges.filter((edge) => targetsModule(file, edge.specifier, TEST_HARNESS_PATH));
    const reExports = [...coreEdges, ...harnessEdges].filter(({ kind }) => kind === "re-export");
    const coreCalls = symbolCalls(file, source, [CORE_CALL_SYMBOL]);
    const harnessCalls = symbolCalls(file, source, TEST_HARNESS_SYMBOLS);
    const orchestrationExports = symbolExports(file, source, ORCHESTRATION_SYMBOLS);
    const harnessExports = symbolExports(file, source, TEST_HARNESS_SYMBOLS);
    const transactionProviderOccurrences = symbolOccurrences(
      file,
      source,
      TRANSACTION_PROVIDER_SYMBOL,
      "transaction-provider seam",
    );
    const legacyTestOptionOccurrences = symbolOccurrences(
      file,
      source,
      LEGACY_TEST_OPTION_SYMBOL,
      "legacy orchestration test option",
    );

    report.core_importers.push(...coreEdges);
    report.test_harness_importers.push(...harnessEdges);
    report.core_callers.push(...coreCalls);
    report.test_harness_callers.push(...harnessCalls);
    report.orchestration_exports.push(...orchestrationExports);
    report.test_harness_exports.push(...harnessExports);
    report.re_exports.push(...reExports);
    report.transaction_provider_occurrences.push(...transactionProviderOccurrences);
    report.legacy_test_option_occurrences.push(...legacyTestOptionOccurrences);

    report.unexpected.push(
      ...coreEdges.filter(() => !activeCoreImporters.has(file)),
      ...harnessEdges.filter(() => !ALLOWED_HARNESS_IMPORTERS.has(file)),
      ...coreCalls.filter(() => !activeCoreCallers.has(file)),
      ...harnessCalls.filter(() => !ALLOWED_HARNESS_CALLERS.has(file)),
      ...orchestrationExports.filter(() => !ALLOWED_ORCHESTRATION_EXPORTERS.has(file)),
      ...harnessExports.filter(() => !ALLOWED_HARNESS_EXPORTERS.has(file)),
      ...transactionProviderOccurrences.filter(() => !ALLOWED_TRANSACTION_PROVIDER_FILES.has(file)),
      ...legacyTestOptionOccurrences,
    );
  }

  const serializableReport = Object.fromEntries(
    Object.entries(report).map(([key, records]) => [
      key,
      records.map(({ file, line, kind, match }) => ({ file, line, kind, match })),
    ]),
  );
  console.log(`ORCHESTRATION_BOUNDARY_REPORT ${JSON.stringify(serializableReport)}`);

  assert.equal(
    report.unexpected.length,
    0,
    `Unexpected orchestration boundary references:\n${formatUnexpected(report.unexpected)}`,
  );
  assert.deepEqual(
    [...new Set(report.core_importers.map(({ file }) => file))],
    [...futureReviewQueueAuthorization.activeProductionCoreFiles, TEST_HARNESS_PATH],
  );
  assert.deepEqual(
    [...new Set(report.core_importers.map(({ file }) => file).filter((file) => !file.startsWith("__tests__/")))],
    futureReviewQueueAuthorization.activeProductionCoreFiles,
  );
  assert.deepEqual(
    [...new Set(report.core_callers.map(({ file }) => file).filter((file) => !file.startsWith("__tests__/")))],
    futureReviewQueueAuthorization.activeProductionCoreFiles,
  );
  assert.deepEqual(
    report.core_callers
      .filter(({ file }) => file === ROUTE_SPECIFIC_RUNTIME_COMPOSITION_PATH)
      .map(({ kind }) => kind),
    [`call ${CORE_CALL_SYMBOL}`, `call ${CORE_CALL_SYMBOL}`],
  );
  const runtimeCompositionSource = readFileSync(
    path.join(REPOSITORY_ROOT, ROUTE_SPECIFIC_RUNTIME_COMPOSITION_PATH),
    "utf8",
  );
  const runtimePlacement = assertDirectCoreCallsInsideExportedAsyncFunctions(
    runtimeCompositionSource,
    ROUTE_SPECIFIC_RUNTIME_COMPOSITION_PATH,
    [MARK_FILE_POLICY_BLOCKED_FUNCTION, APPLY_CONFIRMED_SECURITY_ASSESSMENT_FUNCTION],
  );
  console.log(`ORCHESTRATION_RUNTIME_PLACEMENT_REPORT ${JSON.stringify({
    placements: runtimePlacement.placements.map(({ functionName, functionBody, call }) => ({
      function_name: functionName,
      function_start_line: functionBody.startLine,
      function_end_line: functionBody.endLine,
      call_line: call.line,
    })),
    calls_outside_functions: runtimePlacement.callsOutsideTargets.length,
  })}`);
  console.log(`FUTURE_REVIEW_QUEUE_ACTIVE_PREAUTHORIZATION_REPORT ${JSON.stringify(futureReviewQueueAuthorization)}`);
  assert.deepEqual(
    [...new Set(report.test_harness_importers.map(({ file }) => file))],
    [...ALLOWED_HARNESS_IMPORTERS],
  );
});

test("root index is the application entry point and neither index exposes orchestration", () => {
  const packageManifest = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, "package.json"), "utf8"));
  const rootIndex = readFileSync(path.join(REPOSITORY_ROOT, "index.js"), "utf8");
  const kaiBarrel = readFileSync(path.join(REPOSITORY_ROOT, "Backend/kai/index.js"), "utf8");
  const forbiddenReferences = [
    path.posix.basename(INTERNAL_CORE_PATH),
    path.posix.basename(TEST_HARNESS_PATH),
    ...ORCHESTRATION_SYMBOLS,
    ...TEST_HARNESS_SYMBOLS,
  ];

  assert.equal(packageManifest.main, "index.js");
  assert.equal(packageManifest.scripts.start, "node index.js");
  assert.match(rootIndex, /\bapp\.listen\s*\(/);
  assert.doesNotMatch(rootIndex, /^\s*export\b/m);
  assert.doesNotMatch(rootIndex, /\bmodule\.exports\b/);
  assert.match(kaiBarrel, /^export\s/m);

  for (const forbiddenReference of forbiddenReferences) {
    assert.equal(rootIndex.includes(forbiddenReference), false, `root index exposes ${forbiddenReference}`);
    assert.equal(kaiBarrel.includes(forbiddenReference), false, `KAI barrel exposes ${forbiddenReference}`);
  }
});
