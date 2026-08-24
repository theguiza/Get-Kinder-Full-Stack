import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("GET /impact-library is registered with ensureAuthenticated and renders \"impact-library\"", () => {
  const index = readFileSync("index.js", "utf8");
  assert.match(
    index,
    /app\.get\("\/impact-library",\s*ensureAuthenticated,\s*\(req,\s*res\)\s*=>\s*{[\s\S]{0,200}?res\.render\("impact-library",/,
  );
});

test("views/impact-library.ejs exists and contains impact-evidence-library-root", () => {
  const view = readFileSync("views/impact-library.ejs", "utf8");
  assert.match(view, /id="impact-evidence-library-root"/);
});

test("views/impact-library.ejs loads /js/bundles/entry.js", () => {
  const view = readFileSync("views/impact-library.ejs", "utf8");
  assert.match(view, /\/js\/bundles\/entry\.js\?<%= assetTag %>/);
});

test("frontend/entry.jsx source contains renderImpactEvidenceLibrary", () => {
  const entry = readFileSync("frontend/entry.jsx", "utf8");
  assert.match(entry, /window\.renderImpactEvidenceLibrary\s*=/);
  assert.match(entry, /import ImpactEvidenceLibrary from "\.\/ImpactEvidenceLibrary\.jsx";/);
});
