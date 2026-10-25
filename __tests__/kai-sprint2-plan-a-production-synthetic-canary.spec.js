import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  SYNTHETIC_CSV_PATH,
  countCsvRecords,
  launchBrowserHarnessForTest,
  validateMarkdown,
  authenticationBlocker,
  capabilityBlocker,
  shouldRepeatHumanAction,
  safeCdpEndpoint,
} from "../scripts/kai-sprint2-plan-a-production-synthetic-canary.js";
import { preflight as browserTerminalPreflight, start as browserTerminalStart } from "../scripts/kai-sprint2-plan-a-production-synthetic-canary.browser-terminal.mjs";

test("production canary fixture counts six rows, excludes one blank, and includes both exact duplicate rows", async () => {
  const csv = await readFile(SYNTHETIC_CSV_PATH, "utf8");
  assert.deepEqual(countCsvRecords(csv), {
    totalDataRows: 6,
    blankDataRows: 1,
    countedRecords: 5,
    duplicateNonblankRowsIncluded: 2,
  });
});

test("existing Chrome DevTools Protocol browser harness launches and evaluates locally", async () => {
  const userAgent = await launchBrowserHarnessForTest();
  assert.match(userAgent, /Chrome\//);
});

test("production browser connection is restricted to an existing local Chrome session", () => {
  assert.equal(safeCdpEndpoint(undefined).origin, "http://127.0.0.1:9222");
  assert.equal(safeCdpEndpoint("http://localhost:9222").hostname, "localhost");
  assert.throws(() => safeCdpEndpoint("https://example.com:9222"), /loopback/);
  assert.throws(() => safeCdpEndpoint("http://user:pass@127.0.0.1:9222"), /loopback/);
});

test("live modes attach the existing signed-in tab and never launch or close its browser", async () => {
  const source = await readFile(new URL("../scripts/kai-sprint2-plan-a-production-synthetic-canary.js", import.meta.url), "utf8");
  assert.match(source, /browser = await attachExistingChrome\(target, args\["browser-cdp-url"\]\)/);
  assert.match(source, /Target\.detachFromTarget/);
  assert.doesNotMatch(source.slice(source.indexOf("async function attachExistingChrome"), source.indexOf("function cleanResult")), /Browser\.close|spawn\(/);
  assert.match(source, /signed_in_app_tab_not_found/);
  assert.match(source, /Connected to the existing browser tab/);
});

test("browser-terminal canary uses the selected signed-in tab and stops when authentication is missing", async () => {
  const tab = {
    url: async () => "https://app.example.test/customer",
    playwright: { evaluate: async (_fn, arg) => ({ status: 401, body: { error: { code: "authentication_required" } }, requestedPath: arg.path }) },
  };
  await assert.rejects(browserTerminalPreflight({ tab }), /authentication_required/);
});

test("browser-terminal preflight verifies the authorized synthetic workspace and fails closed on a missing capability", async () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const engagementId = "22222222-2222-4222-8222-222222222222";
  const makeTab = (readInternalDrafts) => ({
    url: async () => "https://app.example.test/customer",
    playwright: { evaluate: async (_fn, arg) => {
      if (arg.path.endsWith("/admin/organizations")) return { status: 200, body: { data: [] } };
      if (arg.path.endsWith("/access-capabilities")) return { status: 200, body: { data: { intakeContribution: true, workflowOperations: { promoteSource: true, recordSourceMeasurement: true, generateDrafts: true, readInternalDrafts } } } };
      if (arg.path.endsWith("/engagements")) return { status: 200, body: { data: [{ engagementId }] } };
      return { status: 404, body: { error: { code: "not_found" } } };
    } },
  });
  const result = await browserTerminalPreflight({ tab: makeTab(true), organizationId, engagementId });
  assert.equal(result.capabilities, "PASS");
  assert.equal(result.engagement, "PASS");
  assert.deepEqual(result.fixture, { totalDataRows: 6, blankDataRows: 1, countedRecords: 5, duplicateNonblankRowsIncluded: 2 });
  await assert.rejects(browserTerminalPreflight({ tab: makeTab(false), organizationId, engagementId }), /required_capability_missing:readInternalDrafts/);
});

test("browser-terminal execution requires owner authorization, keeps every write in the UI, and has no review or release stage", async () => {
  await assert.rejects(browserTerminalStart({ ownerAuthorized: false }), /separate_owner_authorization/);
  const source = await readFile(new URL("../scripts/kai-sprint2-plan-a-production-synthetic-canary.browser-terminal.mjs", import.meta.url), "utf8");
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /every workflow[\s\S]*human action in the product UI/i);
  assert.doesNotMatch(source, /\.post\(|\.put\(|\.patch\(|\.delete\(|Browser\.close|remote-debugging|spawn\(/i);
  assert.doesNotMatch(source, /gk_review|factual_review|key: "release"|client-released-reports|KAI_PUBLIC_EXPORT_ENABLED/);
  assert.match(source, /client-internal-drafts\/\$\{id\}|\/markdown`/);
});

test("initial execution without the separate owner-authorization attestation stops before browser launch", () => {
  const run = spawnSync(process.execPath, [
    "scripts/kai-sprint2-plan-a-production-synthetic-canary.js",
    "--mode", "execute", "--url", "https://example.invalid", "--organization-id", "org-id", "--engagement-id", "engagement-id",
  ], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "postgres://127.0.0.1:9/kai_sentinel" } });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /separate prior owner authorization/);
  assert.doesNotMatch(run.stderr, /DevTools|Chrome/);
});

test("missing authentication and missing capabilities fail closed", () => {
  assert.equal(authenticationBlocker(200), null);
  assert.match(authenticationBlocker(401), /authentication_required/);
  assert.match(authenticationBlocker(403), /authentication_required/);
  assert.equal(capabilityBlocker({ intake: true, readInternalDrafts: true }), null);
  assert.equal(capabilityBlocker({ intake: true, readInternalDrafts: false }), "required_role_capability_missing:readInternalDrafts");
  assert.equal(capabilityBlocker({ intake: false, readInternalDrafts: true }), "required_role_capability_missing:intake");
});

test("resume re-reads a human-completed action instead of prompting the canary to repeat it", () => {
  assert.equal(shouldRepeatHumanAction("not_started"), true);
  assert.equal(shouldRepeatHumanAction("awaiting_verification"), false);
});

test("the live runner has no login, scanner, storage, or generation mocks", async () => {
  const source = await readFile(new URL("../scripts/kai-sprint2-plan-a-production-synthetic-canary.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /kai_harness_user|deterministicCreate|Messages\.create\s*=|synthetic-storage|ANTHROPIC_API_KEY/);
});

test("Markdown validation accepts the internal report and fails for incorrect count semantics, stale or absent citations, missing content, and unsupported narrative findings", () => {
  const identifiers = { periodStart: "2026-09-01", periodEnd: "2026-09-30", sourceVersionId: "source-version-current", claimId: "claim-current", evidenceId: "evidence-current" };
  assert.equal(validateMarkdown("Downloaded draft says 4 participant outcomes.", identifiers).ok, false);
  const validShape = [
    "# Internal Evidence Summary",
    "",
    "## Key findings",
    "",
    "- The promoted source records **5 programme sessions** for the reporting period 2026-09-01 to 2026-09-30. [CIT-001]",
    "",
    "## Measurement definition and counting method",
    "",
    "- **Arithmetic:** 6 data records after the header, minus 1 blank record excluded = **5** counted.",
    "",
    "## Duplicate records",
    "",
    "- [CIT-001] The profiler reported 2 exact-duplicate records. They are included in the count of 5, not removed or merged.",
    "",
    "## Data quality and limitations",
    "",
    "measurement.blank_records_excluded measurement.duplicate_records_included measurement.period_human_attested_not_row_verified measurement.record_meaning_human_defined",
    "coverage.conflicting_source_indicators.unresolved coverage.duplicates.resolved_risk_flagged coverage.missingness.resolved_risk_flagged coverage.requirement_alignment.unresolved coverage.small_cell_risk.unresolved coverage.time_period_clarity.resolved_risk_flagged",
    "",
    "## What this evidence does not establish",
    "",
    "- How many distinct people took part: no participant count was measured.",
    "- Any outcome for participants, or that the programme caused any result or impact.",
    "",
    "## Generated narrative",
    "",
    "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30; 1 blank record was excluded and 2 exact-duplicate records were included. [CIT-001]",
    "",
    "## Source and evidence traceability",
    "",
    "| CIT-001 | `claim-current` | `evidence-current` | `source-version-current` |",
    "",
    "## Conclusion",
    "",
    "It is not evidence of the number of people reached, of outcomes, or of impact.",
    "",
    "## References",
    "",
    "- Evidence: \"Source version record count: 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30, counting each CSV data record as one session.\"",
    "",
  ].join("\n");
  const result = validateMarkdown(validShape, identifiers);
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(validateMarkdown(validShape.replace("**5 programme sessions**", "**6 programme sessions**"), identifiers).ok, false, "wrong count");
  assert.equal(validateMarkdown(validShape.replace("claim-current", "claim-stale"), identifiers).ok, false);
  assert.equal(validateMarkdown(validShape.replace("evidence-current", ""), identifiers).ok, false);
  const noDuplicateLimitation = validShape.replaceAll("duplicate_records_included", "duplicate_records_removed").replace("They are included in the count", "They are removed from the count");
  assert.equal(validateMarkdown(noDuplicateLimitation, identifiers).ok, false);
  const unsupported = validShape.replace("2 exact-duplicate records were included. [CIT-001]", "2 exact-duplicate records were included, reaching 40 participants. [CIT-001]");
  assert.equal(validateMarkdown(unsupported, identifiers).checks.unsupportedClaimsAbsent, false, "an unsupported finding in the generated narrative");
  assert.equal(validateMarkdown(validShape.replace("## Generated narrative", "## Other"), identifiers).ok, false, "the narrative must be present");
  assert.equal(validateMarkdown(`${validShape}\n2026-09-16,mentoring,8\n`, identifiers).checks.noRawCsvRows, false, "a raw CSV row");
});

test("production PASS requires live authorized reads and validated downloaded Markdown", async () => {
  const source = await readFile(new URL("../scripts/kai-sprint2-plan-a-production-synthetic-canary.js", import.meta.url), "utf8");
  assert.match(source, /NOT_CONFIRMED/);
  assert.match(source, /credentials:'same-origin'/);
  assert.match(source, /resume_prior_source_state_stale_or_unverified/);
  assert.match(source, /internal_eligibility_blocked/);
  assert.doesNotMatch(source, /KAI_PUBLIC_EXPORT_ENABLED|client-released-reports|"gk_review"|"factual_review"|\["release"/);
  assert.match(source, /downloaded_markdown_assertions_failed/);
  assert.match(source, /CANARY PASS: \$\{state\.canaryId\}/);
  assert.doesNotMatch(source, /authoritative stage-specific verification is not implemented/);
  assert.doesNotMatch(source, /simulated production PASS|mocked provider accepted/);
});
