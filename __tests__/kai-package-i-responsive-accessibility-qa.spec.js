import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Package I - final cross-product responsive/accessibility/interaction QA
 * pass. This is a repair/verification pass, not a new redesign: no new
 * testing framework is introduced (this repo's established convention for
 * frontend checks is readFileSync + regex under node:test - confirmed by
 * inspection, no jsdom/Playwright/Cypress/Storybook exists anywhere for
 * this product). These checks close a real, previously-untested gap (the
 * shared shell's responsive/focus-visibility CSS had zero test coverage)
 * and verify the two genuinely new Package G2 surfaces (Improvement Plan,
 * Gap Detail's Add to Plan) against the approved responsive/accessibility
 * checklist.
 */

const fullCss = readFileSync("public/css/gk-design-tokens.css", "utf8");
// The shell's own responsive rules live after its section comment; two
// unrelated, pre-existing site-wide surfaces earlier in this same file
// happen to reuse the identical 767.98px breakpoint value, so every lookup
// below is scoped to the shell section, never the whole file.
const shellCss = fullCss.slice(fullCss.indexOf("Impact Library product shell"));
const shellSource = readFileSync("frontend/impactLibraryShell.jsx", "utf8");
const improvementPlanViewSource = readFileSync("frontend/improvementPlan/ImprovementPlanView.jsx", "utf8");
const gapDetailSource = readFileSync("frontend/knowledgeStudio/KnowledgeStudioGapDetail.jsx", "utf8");

test("the approved three-breakpoint responsive system exists exactly as designed: desktop (implicit >=1200px), tablet (<=1199.98px), mobile (<=767.98px)", () => {
  assert.match(shellCss, /@media \(max-width: 1199\.98px\)/);
  assert.match(shellCss, /@media \(max-width: 767\.98px\)/);
  const tabletIndex = shellCss.indexOf("@media (max-width: 1199.98px)");
  const mobileIndex = shellCss.indexOf("@media (max-width: 767.98px)");
  assert.ok(tabletIndex > -1 && mobileIndex > -1 && tabletIndex < mobileIndex);
});

test("tablet collapses the sidebar to an icon-only rail (nav labels hidden, not removed)", () => {
  const tabletBlock = shellCss.slice(
    shellCss.indexOf("@media (max-width: 1199.98px)"),
    shellCss.indexOf("@media (max-width: 767.98px)"),
  );
  assert.match(tabletBlock, /\.gk-shell-sidebar \{ width: 64px/);
  assert.match(tabletBlock, /\.gk-shell-nav-label \{ display: none; \}/);
});

test("mobile uses a fixed bottom tab bar with a 44px touch-target floor on every nav item", () => {
  const mobileBlock = shellCss.slice(shellCss.indexOf("@media (max-width: 767.98px)"));
  assert.match(mobileBlock, /\.gk-shell-sidebar \{[\s\S]*?position: fixed;[\s\S]*?bottom: 0;/);
  assert.match(mobileBlock, /\.gk-shell-nav-item \{[\s\S]*?min-width: 44px; min-height: 44px;/);
});

test("keyboard focus is visible on every interactive shell control, at every breakpoint (no breakpoint-scoped override removes it)", () => {
  assert.match(
    shellCss,
    /\.gk-shell-nav-item:focus-visible,\s*\n\.gk-shell-org-switcher-btn:focus-visible,\s*\n\.gk-shell-bell-btn:focus-visible,\s*\n\.gk-shell-org-switcher-option:focus-visible \{\s*\n\s*outline: 2px solid #FF5656;/,
  );
  assert.doesNotMatch(shellCss, /@media[\s\S]*?outline:\s*none/);
});

test("the Needs Attention bell lives in the always-visible header (not the nav footer, which mobile hides) - reachable at every breakpoint", () => {
  const bellButtonIndex = shellSource.indexOf('className="gk-shell-bell-btn"');
  const headerOpenIndex = shellSource.indexOf('<header className="gk-shell-header">');
  const navFooterCloseIndex = shellSource.indexOf("</div>", shellSource.indexOf('className="gk-shell-nav-footer"'));
  assert.ok(bellButtonIndex > headerOpenIndex, "the bell must be inside the header, not the nav footer");
  assert.ok(bellButtonIndex > navFooterCloseIndex, "the bell must render after (outside) the nav footer block");
  assert.match(shellCss, /\.gk-shell-nav-footer \{ display: none; \}/, "confirms the nav footer really is hidden on mobile");
  assert.doesNotMatch(shellCss.slice(shellCss.indexOf("@media (max-width: 767.98px)")), /\.gk-shell-header \{[^}]*display:\s*none/);
});

test("ImprovementPlanView's create-form inputs have accessible names (aria-label), not placeholder text alone", () => {
  assert.match(improvementPlanViewSource, /placeholder="Practice title"\s*\n\s*aria-label="Practice title"/);
  assert.match(improvementPlanViewSource, /placeholder="Why this matters"\s*\n\s*aria-label="Why this matters"/);
});

test("ImprovementPlanView's per-row status control has an accessible name and meets the 44px touch-target floor", () => {
  assert.match(improvementPlanViewSource, /aria-label="Practice status"/);
  assert.match(improvementPlanViewSource, /minHeight: 44,/);
});

test("ImprovementPlanView's status is never color-only: the colored dot is decorative (aria-hidden) and the select's own current value always shows the real, humanized status text alongside it", () => {
  assert.match(improvementPlanViewSource, /aria-hidden="true"/);
  assert.match(improvementPlanViewSource, /value=\{practice\.status\}/);
  assert.match(improvementPlanViewSource, /<option value="recommended">\{humanizeImprovementPracticeStatus\("recommended"\)\}<\/option>/);
});

test("ImprovementPlanView never leaks a raw UUID as a primary label (engagement_id/gap_log_item_id/improvement_practice_id are only ever used as keys/lookups, never rendered as text)", () => {
  const renderedSource = improvementPlanViewSource.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(renderedSource, />\{practice\.improvement_practice_id\}</);
  assert.doesNotMatch(renderedSource, />\{practice\.engagement_id\}</);
  assert.doesNotMatch(renderedSource, />\{practice\.gap_log_item_id\}</);
});

test("Gap Detail's Add to Plan button is a real control with a real handler - never a dead button - and is keyboard-operable (native <button>)", () => {
  assert.match(gapDetailSource, /<button\s*\n\s*type="button"/);
  assert.match(gapDetailSource, /onClick=\{\(\) => onAddToPlan\(gap\.gapLogItemId\)\}/);
  assert.doesNotMatch(gapDetailSource, /onClick=\{\(\) => \{\}\}/);
});

test("the five approved primary destinations and bell-based Needs Attention are unchanged by this continuation (no new top-level nav destination was added)", () => {
  const keys = [...shellSource.matchAll(/key:\s*"([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["home", "knowledgeStudio", "impactLibrary", "improvementPlan", "projects"]);
  assert.doesNotMatch(shellSource, /"needsAttention"/);
});
