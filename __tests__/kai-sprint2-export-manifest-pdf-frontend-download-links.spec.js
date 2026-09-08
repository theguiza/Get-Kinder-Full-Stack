import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  exportManifestCsvPath,
  exportManifestMarkdownPath,
  exportManifestPdfPath,
} from "../frontend/gkExportReviewDetailLogic.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const exportManifestId = "00000000-0000-4000-8000-000000000901";

const jsxSource = readFileSync("frontend/gkExportReviewDetail.jsx", "utf8");

test("exportManifestPdfPath matches the exact accepted backend PDF route", () => {
  assert.equal(
    exportManifestPdfPath(organizationId, exportManifestId),
    "/api/kai/sprint2/intake/admin/organizations/00000000-0000-4000-8000-000000000001"
      + "/export-manifests/00000000-0000-4000-8000-000000000901/pdf",
  );
});

test("current-session Download PDF link uses the exact current-session exportManifestId, alongside Markdown and CSV", () => {
  assert.match(jsxSource, /exportManifestPdfPath\(organizationId, exportManifestId\)/);
  assert.match(jsxSource, /exportManifestMarkdownPath\(organizationId, exportManifestId\)/);
  assert.match(jsxSource, /exportManifestCsvPath\(organizationId, exportManifestId\)/);
  assert.match(jsxSource, /Download PDF/);
  assert.match(jsxSource, /Download Markdown/);
  assert.match(jsxSource, /Download CSV Evidence Appendix/);
});

test("every exportManifestHistory entry renders its own exact Download PDF link, alongside Markdown and CSV, never one selected as latest/current/preferred/active", () => {
  assert.match(jsxSource, /exportManifestHistory\.map/);
  assert.match(jsxSource, /exportManifestPdfPath\(organizationId, entry\.exportManifestId\)/);
  assert.match(jsxSource, /exportManifestMarkdownPath\(organizationId, entry\.exportManifestId\)/);
  assert.match(jsxSource, /exportManifestCsvPath\(organizationId, entry\.exportManifestId\)/);
  assert.doesNotMatch(jsxSource, /is_current|isLatest|isPreferred|isActive|latest manifest/i);
});

test("history entries and current-session control gating are unchanged by the PDF link addition", () => {
  assert.match(jsxSource, /showPrepareCandidateControl\s*=\s*canPrepareExportCandidate\(model\)\s*&&\s*!exportCandidateId\s*&&\s*!exportManifestId/);
  assert.match(jsxSource, /showGrantAuthorityControl\s*=\s*!!exportCandidateId\s*&&\s*!authorityEffective\s*&&\s*!exportManifestId/);
  assert.match(jsxSource, /showFinalizeExportControl\s*=\s*!!exportCandidateId\s*&&\s*authorityEffective\s*&&\s*!exportManifestId/);
});

test("no client-side eligibility/selection logic was added for the PDF link", () => {
  assert.doesNotMatch(jsxSource, /ORDER BY|LIMIT 1|latest manifest|preferredManifest|selectManifest/i);
});
