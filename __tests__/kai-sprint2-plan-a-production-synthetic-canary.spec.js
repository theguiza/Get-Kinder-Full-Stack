import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  SYNTHETIC_CSV_PATH,
  countCsvRecords,
  launchBrowserHarnessForTest,
  validateMarkdown,
} from "../scripts/kai-sprint2-plan-a-production-synthetic-canary.js";

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

test("initial execution without the separate owner-authorization attestation stops before browser launch", () => {
  const run = spawnSync(process.execPath, [
    "scripts/kai-sprint2-plan-a-production-synthetic-canary.js",
    "--mode", "execute", "--url", "https://example.invalid", "--organization-id", "org-id", "--engagement-id", "engagement-id",
  ], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "postgres://127.0.0.1:9/kai_sentinel" } });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /separate prior owner authorization/);
  assert.doesNotMatch(run.stderr, /DevTools|Chrome/);
});

test("the live runner has no login, scanner, storage, or generation mocks", async () => {
  const source = await readFile(new URL("../scripts/kai-sprint2-plan-a-production-synthetic-canary.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /kai_harness_user|deterministicCreate|Messages\.create\s*=|synthetic-storage|ANTHROPIC_API_KEY/);
});

test("Markdown validation fails for incorrect count semantics, stale or absent citations, and missing content", () => {
  const identifiers = { periodStart: "2026-09-01", periodEnd: "2026-09-30", sourceVersionId: "source-version-current", claimId: "claim-current", evidenceId: "evidence-current" };
  assert.equal(validateMarkdown("Downloaded draft says 4 participant outcomes.", identifiers).ok, false);
  const validShape = [
    "5 source records for 2026-09-01 to 2026-09-30.",
    "1 blank record excluded; 2 duplicate records included.",
    "source-version-current claim-current evidence-current",
    "measurement.blank_records_excluded measurement.duplicate_records_included measurement.period_human_attested_not_row_verified measurement.record_meaning_human_defined",
    "coverage.conflicting_source_indicators.accepted_internal_limitation coverage.duplicates.resolved_risk_flagged coverage.missingness.resolved_risk_flagged coverage.requirement_alignment.accepted_internal_limitation coverage.small_cell_risk.accepted_internal_limitation coverage.time_period_clarity.resolved_risk_flagged",
  ].join("\n");
  assert.equal(validateMarkdown(validShape, identifiers).ok, true);
  assert.equal(validateMarkdown(validShape.replace("claim-current", "claim-stale"), identifiers).ok, false);
  assert.equal(validateMarkdown(validShape.replace("evidence-current", ""), identifiers).ok, false);
  const noDuplicateLimitation = validShape.replaceAll("duplicate_records_included", "duplicate_records_removed").replace("2 duplicate records included", "2 duplicate records removed");
  assert.equal(validateMarkdown(noDuplicateLimitation, identifiers).ok, false);
});

test("a local synthetic report cannot be reported as production evidence", async () => {
  const source = await readFile(new URL("../scripts/kai-sprint2-plan-a-production-synthetic-canary.js", import.meta.url), "utf8");
  assert.match(source, /NOT_CONFIRMED/);
  assert.match(source, /authoritative stage-specific verification is not implemented/);
});
