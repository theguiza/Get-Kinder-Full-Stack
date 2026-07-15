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

const ALLOWED_CORE_IMPORTERS = new Set([TEST_HARNESS_PATH]);
const ALLOWED_HARNESS_IMPORTERS = new Set([
  "__tests__/kai-sprint2-mutation-orchestration.spec.js",
  "__tests__/kai-sprint2-transaction-interface.spec.js",
]);
const ALLOWED_CORE_CALLERS = new Set([TEST_HARNESS_PATH]);
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
  for (const symbol of symbols) {
    const pattern = new RegExp(`\\b${escapeRegExp(symbol)}\\s*\\(`, "g");
    for (const match of source.matchAll(pattern)) {
      const prefix = source.slice(Math.max(0, match.index - 80), match.index);
      if (/\bfunction\s*$/.test(prefix)) continue;
      calls.push({ ...record(file, source, `call ${symbol}`, match), symbol });
    }
  }
  return calls;
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

test("internal orchestration and its deterministic harness have no production exposure or live caller", () => {
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

  for (const file of sourceFiles()) {
    const source = readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
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
      ...coreEdges.filter(() => !ALLOWED_CORE_IMPORTERS.has(file)),
      ...harnessEdges.filter(() => !ALLOWED_HARNESS_IMPORTERS.has(file)),
      ...coreCalls.filter(() => !ALLOWED_CORE_CALLERS.has(file)),
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
    [TEST_HARNESS_PATH],
  );
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
