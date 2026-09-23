import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Impact Library redesign, Package B1/B2: the approved product shell
 * (design_handoff_impact_library/README.md §1/§3) renders inside the
 * standard site-header/site-footer partials, like every other authenticated
 * view, and the governed ImpactEvidenceLibrary component keeps rendering
 * (composed inside the new shell) rather than being replaced.
 */

test("views/impact-library.ejs includes the shared site-header/site-footer partials around the mount point", () => {
  const view = readFileSync("views/impact-library.ejs", "utf8");
  const headerIndex = view.indexOf('include("partials/site-header", { currentPage: "impact-library" })');
  const rootIndex = view.indexOf('id="impact-evidence-library-root"');
  const footerIndex = view.indexOf('include("partials/site-footer")');
  assert.ok(headerIndex > -1, "site header partial must be included");
  assert.ok(footerIndex > -1, "site footer partial must be included");
  assert.ok(headerIndex < rootIndex && rootIndex < footerIndex, "header, then app root, then footer");
  assert.equal(view.match(/include\("partials\/site-header"/g).length, 1);
  assert.equal(view.match(/include\("partials\/site-footer"/g).length, 1);
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

test("frontend/ImpactLibraryApp.jsx sources hasAttention from the real Package H Needs Attention hook, never a hardcoded/fabricated value", () => {
  const source = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
  assert.match(source, /import \{ useNeedsAttention \} from "\.\/needsAttention\/useNeedsAttention\.js";/);
  assert.match(source, /const needsAttention = useNeedsAttention\(selectedOrganizationId\);/);
  assert.match(source, /hasAttention=\{needsAttention\.hasAttention\}/);
});

test("frontend/kaiWebIntakeLogic.js exposes organizationProfilePath alongside the existing organizations/engagements path builders", () => {
  const source = readFileSync("frontend/kaiWebIntakeLogic.js", "utf8");
  assert.match(source, /export function organizationProfilePath\(organizationId\) \{/);
  assert.match(source, /admin\/organizations\/\$\{encodeURIComponent\(organizationId\)\}\/profile/);
});
