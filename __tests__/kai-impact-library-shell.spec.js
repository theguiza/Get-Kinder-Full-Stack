import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Impact Library redesign, Package B1/B2: the approved product shell
 * (design_handoff_impact_library/README.md §1/§3) replaces this one route's
 * chrome only - no Get Kinder branding/site-wide header/footer on
 * /impact-library, every other authenticated view unaffected, and the
 * governed ImpactEvidenceLibrary component keeps rendering (composed inside
 * the new shell) rather than being replaced.
 */

test("views/impact-library.ejs no longer includes the global site-header/site-footer partials", () => {
  const view = readFileSync("views/impact-library.ejs", "utf8");
  assert.doesNotMatch(view, /include\("partials\/site-header"/);
  assert.doesNotMatch(view, /include\("partials\/site-footer"\)/);
});

test("views/impact-library.ejs still contains the required mount point and loads entry.js (locked contract)", () => {
  const view = readFileSync("views/impact-library.ejs", "utf8");
  assert.match(view, /id="impact-evidence-library-root"/);
  assert.match(view, /\/js\/bundles\/entry\.js\?<%= assetTag %>/);
});

test("other authenticated views still include the global site-header/site-footer (unaffected by the /impact-library shell change)", () => {
  for (const view of ["views/dashboard.ejs", "views/org-portal.ejs", "views/profile.ejs"]) {
    const source = readFileSync(view, "utf8");
    assert.match(source, /include\("partials\/site-header"/, `${view} should still include the site header`);
  }
});

test("frontend/entry.jsx mounts ImpactLibraryApp (the shell) for renderImpactEvidenceLibrary, while still importing ImpactEvidenceLibrary.jsx", () => {
  const entry = readFileSync("frontend/entry.jsx", "utf8");
  assert.match(entry, /import ImpactLibraryApp from "\.\/ImpactLibraryApp\.jsx";/);
  assert.match(entry, /import ImpactEvidenceLibrary from "\.\/ImpactEvidenceLibrary\.jsx";/);
  const rendererIndex = entry.indexOf("window.renderImpactEvidenceLibrary");
  assert.ok(rendererIndex > -1);
  const rendererSlice = entry.slice(rendererIndex, rendererIndex + 400);
  assert.match(rendererSlice, /<ImpactLibraryApp\s*\{\.\.\.props\}\s*\/>/);
});

test("frontend/impactLibraryShell.jsx exposes exactly the five approved left-navigation sections, in order, and Needs Attention is not one of them", () => {
  const source = readFileSync("frontend/impactLibraryShell.jsx", "utf8");
  const keys = [...source.matchAll(/key:\s*"([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["home", "knowledgeStudio", "impactLibrary", "improvementPlan", "projects"]);
  assert.doesNotMatch(source, /"needsAttention"/, "Needs Attention must not be a left-nav destination");
});

test("frontend/ImpactLibraryApp.jsx composes the existing ImpactEvidenceLibrary component under the Knowledge Studio section only", () => {
  const source = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
  assert.match(source, /import ImpactEvidenceLibrary from "\.\/ImpactEvidenceLibrary\.jsx";/);
  const knowledgeStudioBranch = source.match(/activeSection === "knowledgeStudio"\) \{\s*sectionContent = \(\s*<ImpactEvidenceLibrary/);
  assert.ok(knowledgeStudioBranch, "ImpactEvidenceLibrary must be rendered when activeSection is knowledgeStudio");
  const otherRenders = [...source.matchAll(/<ImpactEvidenceLibrary\b/g)];
  assert.equal(otherRenders.length, 1, "ImpactEvidenceLibrary must be composed in exactly one place");
});

test("frontend/ImpactLibraryApp.jsx never sets hasAttention true without a real Needs Attention data source (no fabricated alert)", () => {
  const source = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
  assert.match(source, /hasAttention=\{false\}/);
});

test("frontend/kaiWebIntakeLogic.js exposes organizationProfilePath alongside the existing organizations/engagements path builders", () => {
  const source = readFileSync("frontend/kaiWebIntakeLogic.js", "utf8");
  assert.match(source, /export function organizationProfilePath\(organizationId\) \{/);
  assert.match(source, /admin\/organizations\/\$\{encodeURIComponent\(organizationId\)\}\/profile/);
});
