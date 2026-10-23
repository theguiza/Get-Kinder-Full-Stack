/**
 * KAI Plan A production canary for the in-app browser terminal.
 *
 * Run this module in the browser terminal after it has attached to the user's
 * current signed-in tab. It uses only same-origin GET reads; every workflow
 * write and every approval remains a human action in the product UI.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  countCsvRecords,
  validateMarkdown,
  MEASURED_LIMITATION_CODES,
} from "./kai-sprint2-plan-a-production-synthetic-canary.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "scripts/fixtures/kai-plan-a-production-synthetic-records.csv");
const STATE_ROOT = join(ROOT, ".kai-production-canary/browser-terminal");
const API = "/api/kai/sprint2/intake";
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const STAGES = [
  { key: "workspace", role: "customer", instruction: "Confirm the authorized customer administrator and the selected synthetic organization and engagement." },
  { key: "upload_processing", role: "customer", instruction: "In the customer Files UI, upload the generated synthetic CSV. Wait for the real scan and P1 profile to complete." },
  { key: "sensitivity_source", role: "customer", instruction: "Review the synthetic source in Data Sources. Record only human-attested sensitivity, allowed-use, AI-use, and promotion findings." },
  { key: "measurement", role: "customer", instruction: "In Count records, define one nonblank data row as one programme session; include exact duplicate rows; exclude the header and empty rows. Enter only a reporting period the organization can genuinely attest, then record the definition, measurement, and claim." },
  { key: "gk_review", role: "gk", instruction: "As the authorized GK reviewer, review the evidence, claim, and every applicable coverage dimension. Do not skip unresolved blockers." },
  { key: "generation", role: "customer", instruction: "As the customer administrator, create a live internal Evidence Summary in the product UI." },
  { key: "factual_review", role: "customer", instruction: "Inspect the generated text, citations, and limitations. Approve factual content only if accurate." },
  { key: "release", role: "customer", instruction: "Use the separate Release internal report action and confirm limitations only after review." },
  { key: "download_validation", role: "customer", instruction: "Open the released report receipt in the customer UI. The runner will retrieve and validate that authorized Markdown." },
];

function fail(code) { throw new Error(code); }
function assertUuid(value, name) { if (!UUID_RE.test(value || "")) fail(`${name}_must_be_a_canonical_application_uuid`); return value.toLowerCase(); }
function bodyOf(result) { return result?.body?.data ?? null; }
function apiCode(result) { return result?.body?.error?.code || result?.body?.error_code || `http_${result?.status || 0}`; }
function containsId(value, id) { return JSON.stringify(value || {}).includes(id); }
function allComplete(file, keys) { const stages = new Map((file?.stages || []).map((s) => [s.key, s.status])); return keys.every((key) => stages.get(key) === "complete"); }
function validDate(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false; const d = new Date(`${s}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s; }
function statePath(id) { if (!UUID_RE.test(id || "")) fail("invalid_run_id"); return join(STATE_ROOT, `${id}.json`); }

async function pageFetch(tab, path, accept = "application/json") {
  if (!path.startsWith(`${API}/`)) fail("refused_non_KAI_API_path");
  return tab.playwright.evaluate(async ({ path: requestPath, accept: requestedAccept }) => {
    const response = await fetch(requestPath, { credentials: "same-origin", headers: { Accept: requestedAccept } });
    if (requestedAccept === "text/markdown") return { status: response.status, disposition: response.headers.get("content-disposition"), text: await response.text() };
    let body = null; try { body = await response.json(); } catch {}
    return { status: response.status, body };
  }, { path, accept }, { timeoutMs: 15000 });
}

function verifyTab(tab) {
  if (!tab?.playwright?.evaluate || !tab?.url) fail("browser_terminal_tab_required: pass the selected signed-in browser tab");
}
async function verifyAppOrigin(tab, expectedOrigin) {
  const href = await tab.url();
  let current; try { current = new URL(href); } catch { fail("browser_tab_not_on_application"); }
  if (current.protocol !== "https:" || (expectedOrigin && current.origin !== expectedOrigin)) fail("browser_tab_origin_mismatch_or_not_https");
  return current.origin;
}
async function verifyWorkspace(tab, state) {
  const orgs = await pageFetch(tab, `${API}/admin/organizations`);
  if (orgs.status !== 200) fail(`authentication_or_organization_read_blocked:${apiCode(orgs)}`);
  const engagements = await pageFetch(tab, `${API}/admin/organizations/${state.organizationId}/engagements`);
  if (engagements.status !== 200 || !containsId(bodyOf(engagements), state.engagementId)) fail(`engagement_not_authorized_or_not_found:${apiCode(engagements)}`);
  const response = await pageFetch(tab, `${API}/admin/organizations/${state.organizationId}/access-capabilities`);
  const caps = bodyOf(response);
  if (response.status !== 200 || !caps || typeof caps !== "object") fail(`organization_capabilities_unavailable:${apiCode(response)}`);
  return caps;
}
function requireCaps(caps, role) {
  const ops = caps.workflowOperations || {};
  const needed = role === "gk"
    ? { evidenceReview: ops.recordEvidenceReview, claimReview: ops.recordClaimReview, coverageReview: ops.assessEvidenceCoverage }
    : { intake: caps.intakeContribution, promoteSource: ops.promoteSource, measurement: ops.recordSourceMeasurement, generation: ops.generateDrafts, factualReview: ops.reviewInternalDraftFactualContent, internalRelease: ops.releaseInternalReports };
  const absent = Object.entries(needed).filter(([, value]) => value !== true).map(([key]) => key);
  if (absent.length) fail(needed.internalRelease === false ? "feature_disabled:KAI_PUBLIC_EXPORT_ENABLED" : `required_capability_missing:${absent.join(",")}`);
}
async function poll(read, accept, label, timeoutMs = 120000) {
  const until = Date.now() + timeoutMs; let delay = 500; let last;
  while (Date.now() < until) {
    last = await read();
    if (last.status !== 200 && ![202, 404].includes(last.status)) fail(`${label}:${apiCode(last)}`);
    if (accept(last)) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, delay));
    delay = Math.min(5000, Math.ceil(delay * 1.5));
  }
  fail(`${label}:bounded_wait_expired:${apiCode(last)}`);
}
async function save(state) {
  await mkdir(STATE_ROOT, { recursive: true, mode: 0o700 });
  await writeFile(statePath(state.runId), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}
async function load(runId) { return JSON.parse(await readFile(statePath(runId), "utf8")); }
function publicState(state) {
  const next = STAGES[state.stageIndex];
  return {
    status: state.stageIndex >= STAGES.length ? "CANARY_PASS" : "WAITING_FOR_HUMAN",
    runId: state.runId,
    canaryId: state.canaryId,
    completedStages: state.stages,
    nextStage: next ? { stage: next.key, requiredRole: next.role, instruction: next.instruction } : null,
    fixturePath: state.fixturePath,
    reportPath: state.reportPath || null,
  };
}

export async function preflight({ tab = globalThis.tab, organizationId, engagementId, role = "customer" } = {}) {
  verifyTab(tab);
  const origin = await verifyAppOrigin(tab);
  const organizations = await pageFetch(tab, `${API}/admin/organizations`);
  const result = { mode: "preflight", origin, authenticated: organizations.status === 200, role, fixture: countCsvRecords(await readFile(FIXTURE, "utf8")), capabilities: "NOT_CHECKED", engagement: "NOT_CHECKED" };
  if (organizations.status !== 200) fail(`authentication_required:${apiCode(organizations)}`);
  if (organizationId) {
    const orgId = assertUuid(organizationId, "organization_id");
    const capResponse = await pageFetch(tab, `${API}/admin/organizations/${orgId}/access-capabilities`);
    const caps = bodyOf(capResponse);
    if (capResponse.status !== 200 || !caps || typeof caps !== "object") fail(`organization_capabilities_unavailable:${apiCode(capResponse)}`);
    requireCaps(caps, role);
    result.capabilities = "PASS";
    if (engagementId) {
      const engId = assertUuid(engagementId, "engagement_id");
      const engagements = await pageFetch(tab, `${API}/admin/organizations/${orgId}/engagements`);
      if (engagements.status !== 200 || !containsId(bodyOf(engagements), engId)) fail(`engagement_not_authorized_or_not_found:${apiCode(engagements)}`);
      result.engagement = "PASS";
    }
  }
  return result;
}

export async function start({ tab = globalThis.tab, organizationId, engagementId, ownerAuthorized = false } = {}) {
  if (ownerAuthorized !== true) fail("execution_requires_separate_owner_authorization");
  verifyTab(tab);
  const origin = await verifyAppOrigin(tab);
  const state = {
    runId: randomUUID(),
    canaryId: `KAI-SYNTH-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`,
    origin,
    organizationId: assertUuid(organizationId, "organization_id"),
    engagementId: assertUuid(engagementId, "engagement_id"),
    stageIndex: 0,
    ids: {},
    stages: [],
  };
  const caps = await verifyWorkspace(tab, state);
  requireCaps(caps, "customer");
  const fixture = await readFile(FIXTURE, "utf8");
  const counts = countCsvRecords(fixture);
  if (counts.totalDataRows !== 6 || counts.blankDataRows !== 1 || counts.countedRecords !== 5 || counts.duplicateNonblankRowsIncluded !== 2) fail("synthetic_fixture_count_assertion_failed");
  const fixturePath = join(STATE_ROOT, "fixtures", `${state.canaryId}.csv`);
  await mkdir(dirname(fixturePath), { recursive: true, mode: 0o700 });
  await writeFile(fixturePath, fixture, { mode: 0o600, flag: "wx" });
  state.fixturePath = fixturePath;
  await save(state);
  return { ...publicState(state), fixtureCounts: counts, instruction: "Use the existing Files UI; upload this fixture only to the designated synthetic organization and engagement." };
}

export async function resume({ tab = globalThis.tab, runId, role = "customer", sourceVersionId, periodStart, periodEnd, draftId } = {}) {
  verifyTab(tab);
  const state = await load(runId);
  const origin = await verifyAppOrigin(tab, state.origin);
  if (origin !== state.origin) fail("resume_origin_mismatch");
  if (state.stageIndex >= STAGES.length) return publicState(state);
  const current = STAGES[state.stageIndex];
  if (role !== current.role) fail(`human_identity_required:${current.role}`);
  const caps = await verifyWorkspace(tab, state);
  requireCaps(caps, role);
  const pipelinePath = `${API}/admin/organizations/${state.organizationId}/engagements/${state.engagementId}/client-evidence-pipeline`;
  const measurementPath = (version) => `${API}/admin/organizations/${state.organizationId}/source-versions/${version}/record-count-measurement`;
  const tracePath = `${API}/admin/organizations/${state.organizationId}/claims/${state.ids.claimId}/traceability?requested_audience=internal`;
  const draftPath = (id) => `${API}/admin/organizations/${state.organizationId}/engagements/${state.engagementId}/client-internal-drafts/${id}`;
  let result;
  try {
  switch (current.key) {
    case "workspace":
      result = { organizationAndEngagement: "authorized_and_verified" };
      break;
    case "upload_processing": {
      const response = await poll(() => pageFetch(tab, pipelinePath), (r) => {
        const file = (bodyOf(r)?.files || []).find((f) => String(f.safeFilename || "").includes(state.canaryId));
        const failed = (file?.stages || []).find((s) => ["failed", "blocked", "rejected"].includes(s.status));
        if (failed) fail(`scan_or_P1_failed:${failed.key}:${failed.status}`);
        return Boolean(file && allComplete(file, ["upload", "security_check", "processing", "data_dictionary", "sensitivity_classification"]));
      }, "upload_scan_P1_profile");
      const file = bodyOf(response).files.find((f) => String(f.safeFilename || "").includes(state.canaryId));
      state.ids.intakeFileId = assertUuid(file.intakeFileId, "intake_file_id");
      const detail = await pageFetch(tab, `${API}/admin/files/${state.ids.intakeFileId}`);
      const checksum = createHash("sha256").update(await readFile(state.fixturePath)).digest("hex");
      const hashValues = [];
      const scan = (value, key = "") => { if (!value || typeof value !== "object") { if (/checksum|sha256/i.test(key) && typeof value === "string") hashValues.push(value.toLowerCase()); return; } for (const [k, v] of Object.entries(value)) scan(v, k); };
      if (detail.status === 200) scan(bodyOf(detail));
      if (!hashValues.includes(checksum)) fail("uploaded_bytes_checksum_not_verified");
      result = { intakeFileId: state.ids.intakeFileId, scannerAndP1: "complete", uploadedBytesChecksum: "matched" };
      break;
    }
    case "sensitivity_source": {
      state.ids.sourceVersionId = assertUuid(sourceVersionId, "source_version_id");
      const pipeline = await pageFetch(tab, pipelinePath);
      const file = (bodyOf(pipeline)?.files || []).find((f) => f.intakeFileId === state.ids.intakeFileId);
      if (pipeline.status !== 200 || !allComplete(file, ["sensitivity_review", "source_review"])) fail(`customer_sensitivity_and_source_promotion_unverified:${apiCode(pipeline)}`);
      const measurement = await pageFetch(tab, measurementPath(state.ids.sourceVersionId));
      const basis = bodyOf(measurement)?.basis;
      if (measurement.status !== 200 || bodyOf(measurement)?.sourceVersion?.is_current !== true || basis?.data_record_count !== 6 || basis?.blank_record_count !== 1 || basis?.duplicate_record_count !== 2 || basis?.counted_record_count !== 5) fail(`current_source_profile_count_mismatch:${apiCode(measurement)}`);
      result = { sourceVersionId: state.ids.sourceVersionId, current: true, rows: 6, blank: 1, duplicatesIncluded: 2, counted: 5 };
      break;
    }
    case "measurement": {
      if (!validDate(periodStart) || !validDate(periodEnd) || periodStart > periodEnd) fail("genuinely_attested_synthetic_period_required");
      state.period = { start: periodStart, end: periodEnd, attestedByOperator: true };
      const response = await pageFetch(tab, measurementPath(state.ids.sourceVersionId));
      const recorded = bodyOf(response)?.recorded;
      const m = recorded?.measurement; const d = recorded?.definition; const c = recorded?.claim;
      if (response.status !== 200 || Number(m?.measured_value) !== 5 || Number(m?.total_record_count) !== 6 || Number(m?.blank_record_count) !== 1 || Number(m?.duplicate_record_count) !== 2 || !m?.evidence_item_id || d?.period_start !== periodStart || d?.period_end !== periodEnd || d?.counted_unit !== "programme session" || !c?.claim_id || !/(?:5|five) programme sessions?/i.test(String(c.statement || ""))) fail(`measurement_definition_or_claim_mismatch:${apiCode(response)}`);
      state.ids.evidenceId = m.evidence_item_id; state.ids.claimId = c.claim_id;
      result = { measured: 5, rows: 6, blank: 1, duplicatesIncluded: 2, unit: d.counted_unit, period: [periodStart, periodEnd], evidenceAndClaimLinked: true };
      break;
    }
    case "gk_review": {
      const response = await pageFetch(tab, tracePath); const trace = bodyOf(response);
      const dimensions = Object.values(trace?.dimensions || {});
      if (response.status !== 200 || trace?.eligible !== true || !Array.isArray(trace.blockerCodes) || trace.blockerCodes.length || !dimensions.length || dimensions.some((d) => d.assessment_status === "unresolved" && d.internal_limitation_accepted !== true)) fail(`GK_review_or_current_use_eligibility_blocked:${apiCode(response)}`);
      result = { eligible: true, applicableCoverageDimensions: dimensions.length, blockers: 0 };
      break;
    }
    case "generation": {
      state.ids.draftId = assertUuid(draftId, "draft_id");
      const response = await pageFetch(tab, draftPath(state.ids.draftId)); const draft = bodyOf(response);
      const generated = (draft?.blocks || []).map((b) => b.text || "").join("\n");
      const citations = new Set((draft?.blocks || []).flatMap((b) => b.supportingClaimIds || []));
      if (response.status !== 200 || draft?.contentType !== "evidence_summary" || draft?.audience !== "internal" || draft?.citedClaimsCurrentlyEligible !== true || citations.size !== 1 || !citations.has(state.ids.claimId) || !/(?:5|five)\s+(?:nonblank\s+)?(?:source records?|programme sessions?)/i.test(generated) || !generated.includes(state.period.start) || !generated.includes(state.period.end) || /\b(?:participants?|outcomes?|attendance rates?|percentages?|caused|resulted in|led to|impact)\b/i.test(generated)) fail(`live_draft_or_citations_unverified:${apiCode(response)}`);
      result = { draftId: state.ids.draftId, type: draft.contentType, audience: draft.audience, eligibleClaimCited: true, provider: "NOT_CONFIRMED_BY_CUSTOMER_READ" };
      break;
    }
    case "factual_review": {
      const response = await pageFetch(tab, draftPath(state.ids.draftId)); const draft = bodyOf(response);
      if (response.status !== 200 || draft?.reviewState !== "reviewed_by_your_organization" || draft?.citedClaimsCurrentlyEligible !== true) fail(`customer_factual_review_not_verified:${apiCode(response)}`);
      result = { factualReview: draft.reviewState, claimEligibility: true };
      break;
    }
    case "release": {
      const response = await pageFetch(tab, draftPath(state.ids.draftId)); const draft = bodyOf(response);
      if (response.status === 200 && draft?.release?.state === "unavailable") fail("feature_disabled:KAI_PUBLIC_EXPORT_ENABLED");
      if (response.status !== 200 || draft?.contentType !== "evidence_summary" || draft?.audience !== "internal" || draft?.reviewState !== "reviewed_by_your_organization" || draft?.citedClaimsCurrentlyEligible !== true || draft?.release?.state !== "released_for_internal_use" || draft?.organizationRelease?.releasedBy !== "your_organization") fail(`customer_internal_release_not_verified:${apiCode(response)}`);
      state.ids.manifestId = draft.release.releasedReportId;
      result = { released: true, manifestId: state.ids.manifestId, actorScope: "customer_organization" };
      break;
    }
    case "download_validation": {
      const response = await pageFetch(tab, `${API}/admin/organizations/${state.organizationId}/engagements/${state.engagementId}/client-released-reports/${state.ids.manifestId}/markdown`, "text/markdown");
      if (response.status !== 200 || !/attachment/i.test(response.disposition || "")) fail(`authorized_markdown_download_failed:${response.status}`);
      const validation = validateMarkdown(response.text, { periodStart: state.period.start, periodEnd: state.period.end, sourceVersionId: state.ids.sourceVersionId, claimId: state.ids.claimId, evidenceId: state.ids.evidenceId });
      if (!validation.ok) fail(`downloaded_markdown_assertions_failed:${Object.entries(validation.checks).filter(([, ok]) => !ok).map(([key]) => key).join(",")}`);
      state.reportPath = join(STATE_ROOT, "reports", `${state.canaryId}.md`);
      await mkdir(dirname(state.reportPath), { recursive: true, mode: 0o700 });
      await writeFile(state.reportPath, response.text, { mode: 0o600 });
      result = { markdown: "authorized_download", contentAssertions: "PASS", savedTo: state.reportPath, limitationCodes: MEASURED_LIMITATION_CODES.length };
      break;
    }
  }
  } catch (error) {
    state.lastFailure = { stage: current.key, status: "BLOCKED", evidenceClass: "NOT_CONFIRMED", blocker: String(error?.message || "unknown_failure").slice(0, 180), updatedAt: new Date().toISOString() };
    await save(state);
    throw error;
  }
  state.stages.push({ stage: current.key, status: "PASS", evidenceClass: "TOOL_VERIFIED", verifiedAt: new Date().toISOString(), result });
  state.stageIndex += 1;
  state.lastFailure = null;
  await save(state);
  return publicState(state);
}

export async function run(options = {}) {
  const mode = options.mode || "preflight";
  if (mode === "preflight") return preflight(options);
  if (mode === "execute") return start(options);
  if (mode === "resume") return resume(options);
  fail("mode_must_be_preflight_execute_or_resume");
}
