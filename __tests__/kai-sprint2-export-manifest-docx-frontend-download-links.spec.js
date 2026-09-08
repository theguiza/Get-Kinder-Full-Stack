import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  exportManifestCsvPath,
  exportManifestDocxPath,
  exportManifestMarkdownPath,
  exportManifestPdfPath,
} from "../frontend/gkExportReviewDetailLogic.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const exportManifestId = "00000000-0000-4000-8000-000000000901";

const jsxSource = readFileSync("frontend/gkExportReviewDetail.jsx", "utf8");

test("exportManifestDocxPath matches the exact accepted backend DOCX route", () => {
  assert.equal(
    exportManifestDocxPath(organizationId, exportManifestId),
    "/api/kai/sprint2/intake/admin/organizations/00000000-0000-4000-8000-000000000001"
      + "/export-manifests/00000000-0000-4000-8000-000000000901/docx",
  );
});

test("current-session Download DOCX link uses the exact current-session exportManifestId, alongside Markdown, CSV, and PDF", () => {
  assert.match(jsxSource, /exportManifestDocxPath\(organizationId, exportManifestId\)/);
  assert.match(jsxSource, /exportManifestMarkdownPath\(organizationId, exportManifestId\)/);
  assert.match(jsxSource, /exportManifestCsvPath\(organizationId, exportManifestId\)/);
  assert.match(jsxSource, /exportManifestPdfPath\(organizationId, exportManifestId\)/);
  assert.match(jsxSource, /Download DOCX/);
  assert.match(jsxSource, /Download Markdown/);
  assert.match(jsxSource, /Download CSV Evidence Appendix/);
  assert.match(jsxSource, /Download PDF/);
});

test("every exportManifestHistory entry renders its own exact Download DOCX link, alongside Markdown, CSV, and PDF, never one selected as latest/current/preferred/active", () => {
  assert.match(jsxSource, /exportManifestHistory\.map/);
  assert.match(jsxSource, /exportManifestDocxPath\(organizationId, entry\.exportManifestId\)/);
  assert.match(jsxSource, /exportManifestMarkdownPath\(organizationId, entry\.exportManifestId\)/);
  assert.match(jsxSource, /exportManifestCsvPath\(organizationId, entry\.exportManifestId\)/);
  assert.match(jsxSource, /exportManifestPdfPath\(organizationId, entry\.exportManifestId\)/);
  assert.doesNotMatch(jsxSource, /is_current|isLatest|isPreferred|isActive|latest manifest/i);
});

test("history entries and current-session control gating are unchanged by the DOCX link addition", () => {
  assert.match(jsxSource, /showPrepareCandidateControl\s*=\s*canPrepareExportCandidate\(model\)\s*&&\s*!exportCandidateId\s*&&\s*!exportManifestId/);
  assert.match(jsxSource, /showGrantAuthorityControl\s*=\s*!!exportCandidateId\s*&&\s*!authorityEffective\s*&&\s*!exportManifestId/);
  assert.match(jsxSource, /showFinalizeExportControl\s*=\s*!!exportCandidateId\s*&&\s*authorityEffective\s*&&\s*!exportManifestId/);
});

test("no client-side eligibility/selection logic was added for the DOCX link", () => {
  assert.doesNotMatch(jsxSource, /ORDER BY|LIMIT 1|latest manifest|preferredManifest|selectManifest/i);
});
