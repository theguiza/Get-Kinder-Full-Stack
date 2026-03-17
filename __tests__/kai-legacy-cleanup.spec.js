import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function repoPathExists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

const retiredCallerPattern =
  /\/api\/chat\/message|["']\/kai-chat(?:\/stream)?["']|assistant\.js|\/js\/chat\.js/;

test("current KAI pages still include the floating /api/kai partial", () => {
  const pagePaths = [
    "views/index.ejs",
    "views/dashboard.ejs",
    "views/events.ejs",
    "views/friendQuiz.ejs",
  ];

  for (const pagePath of pagePaths) {
    const source = readRepoFile(pagePath);
    assert.match(
      source,
      /include\(['"]partials\/kai-chat-floating['"]/,
      `${pagePath} should include the current KAI floating partial`,
    );
    assert.doesNotMatch(
      source,
      retiredCallerPattern,
      `${pagePath} should not reference retired OpenAI KAI callers`,
    );
  }
});

test("floating KAI partial targets the live /api/kai endpoints", () => {
  const partial = readRepoFile("views/partials/kai-chat-floating.ejs");

  assert.match(partial, /\/api\/kai\/message/, "partial should post authenticated chat to /api/kai/message");
  assert.match(partial, /\/api\/kai\/guest/, "partial should post guest chat to /api/kai/guest");
  assert.doesNotMatch(
    partial,
    retiredCallerPattern,
    "partial should not reference retired OpenAI KAI endpoints or assets",
  );
});

test("legacy OpenAI KAI modules and asset were removed", () => {
  assert.equal(repoPathExists("Backend/assistant.js"), false, "Backend/assistant.js should be removed");
  assert.equal(repoPathExists("openaiFunctions.js"), false, "openaiFunctions.js should be removed");
  assert.equal(repoPathExists("public/js/chat.js"), false, "public/js/chat.js should be removed");
});

test("index.js keeps the current /api/kai router and quarantines legacy KAI routes", () => {
  const indexSource = readRepoFile("index.js");

  assert.match(indexSource, /app\.use\("\/api\/kai",\s*kaiRouter\)/, "index.js should still mount /api/kai");
  assert.match(indexSource, /legacyKaiDeprecatedJson\("\/api\/chat\/init"\)/, "legacy /api/chat/init should be quarantined");
  assert.match(indexSource, /legacyKaiDeprecatedJson\("\/api\/chat\/message"\)/, "legacy /api/chat/message should be quarantined");
  assert.match(indexSource, /legacyKaiDeprecatedJson\("\/chat"\)/, "legacy /chat should be quarantined");
  assert.match(indexSource, /legacyKaiDeprecatedJson\("\/kai-chat"\)/, "legacy /kai-chat should be quarantined");
  assert.match(indexSource, /legacyKaiDeprecatedSse\("\/kai-chat\/stream"\)/, "legacy /kai-chat/stream should be quarantined");
  assert.doesNotMatch(
    indexSource,
    /from ["']openai["']|\.\/Backend\/assistant\.js|\.\/openaiFunctions\.js/,
    "index.js should not import the retired OpenAI KAI stack",
  );
});
