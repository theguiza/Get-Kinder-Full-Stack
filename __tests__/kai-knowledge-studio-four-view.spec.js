import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DEFAULT_KNOWLEDGE_STUDIO_VIEW,
  FINDING_CATEGORIES,
  KNOWLEDGE_STUDIO_VIEWS,
  buildFindings,
  findingCategory,
  findingTypeLabel,
  nextVisitedViews,
  projectFindingsState,
  projectIsConfirmedEmpty,
  shortStatement,
  audienceGateRows,
  claimRestatesFinding,
  findingDisplay,
  tabKeyTarget,
  traceabilityChain,
} from "../frontend/knowledgeStudio/knowledgeStudioViewsLogic.js";
import { composeMeasurementEvidenceStatement } from "../Backend/kai/validators/kaiSourceMeasurementValidators.js";
import { projectEvidenceLibraryItems } from "../frontend/impactEvidenceLibraryLogic.js";
import { listOrganizationEvidenceItems } from "../Backend/kai/db/kaiEvidenceLibraryReadModels.js";
import { listOrganizationEvidenceLibrary } from "../Backend/kai/services/kaiEvidenceLibraryService.js";

/**
 * Knowledge Studio four-view MVP (owner direction 2026-11-06): Impact |
 * Evidence | Sources | Drafts for the client Knowledge Studio and the Get
 * Kinder Impact Evidence Library. Pure logic, the read-model display field,
 * statically rendered components, and the state/race wiring.
 */

const ORG = "00000000-0000-4000-8000-0000000000a1";
const PROJECT = "00000000-0000-4000-8000-0000000000b1";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const evidence = (n, overrides = {}) => ({
  evidenceItemId: id(n),
  sourceVersionId: id(900),
  evidenceType: "source_document_statement",
  measurementFamily: null,
  statement: `Statement ${n}`,
  ...overrides,
});
const claim = (n, evidenceItemId, overrides = {}) => ({
  claimId: id(n),
  evidenceItemId,
  claimStatement: `Claim ${n}`,
  evidenceType: "source_document_statement",
  ...overrides,
});
const sources = [{ sourceId: id(800), sourceVersions: [{ sourceVersionId: id(900), safeFilename: "programme.csv", isCurrent: true }] }];

// ---------------------------------------------------------------------------
// Classification and grouping
// ---------------------------------------------------------------------------

test("exactly four views, Sources first with Impact the default", () => {
  assert.deepEqual(KNOWLEDGE_STUDIO_VIEWS.map(([key]) => key), ["sources", "impact", "evidence", "drafts"]);
  assert.equal(DEFAULT_KNOWLEDGE_STUDIO_VIEW, "impact");
  assert.deepEqual(nextVisitedViews(["impact"], "drafts"), ["impact", "drafts"]);
  assert.deepEqual(nextVisitedViews(["impact", "drafts"], "drafts"), ["impact", "drafts"]);
});

test("classification uses only recorded discriminators: outcome and reach need their recorded family; prose is never an outcome", () => {
  assert.equal(findingCategory("source_derived_measurement", "paired_outcome_change"), "outcomes");
  assert.equal(findingCategory("source_derived_measurement", "cross_source_reach"), "reach");
  assert.equal(findingCategory("source_derived_measurement", "tabular_count"), "measurements");
  assert.equal(findingCategory("source_derived_measurement", null), "measurements", "an unknown family stays neutral");
  // A record count is a count of records under its own definition, never relabelled as reach or impact.
  assert.equal(findingCategory("source_record_count_measurement", null), "measurements");
  assert.equal(findingCategory("source_record_count_measurement", "paired_outcome_change"), "measurements");
  // Document prose, whatever it says, is a finding, never an outcome.
  assert.equal(findingCategory("source_document_statement", "paired_outcome_change"), "findings");
  assert.equal(findingCategory("some_future_type", null), "findings", "other existing types keep a neutral fallback");
  assert.equal(findingCategory("dictionary_field_presence_fact", null), "technical");
  assert.equal(findingTypeLabel("source_record_count_measurement"), "Record count");
  assert.equal(findingTypeLabel("source_derived_measurement", "paired_outcome_change"), "Baseline and follow-up measurement");
  assert.deepEqual(FINDING_CATEGORIES, ["outcomes", "reach", "measurements", "findings", "technical"]);
});

test("buildFindings groups evidence with its claims, keeps claims whose evidence is not loaded, and orders by source and statement - never by id", () => {
  const items = [
    evidence(3, { statement: "Zebra statement" }),
    evidence(1, { statement: "Apple statement" }),
    evidence(2, { evidenceType: "source_derived_measurement", measurementFamily: "paired_outcome_change", statement: "12 of 20 improved" }),
    evidence(4, { evidenceType: "dictionary_field_presence_fact", statement: "Source has column field_5 (text_like)" }),
    evidence(5, { evidenceType: "source_derived_measurement", measurementFamily: "cross_source_reach", statement: "40 participants linked" }),
  ];
  const claims = [claim(11, id(1)), claim(12, id(1)), claim(13, id(77), { evidenceType: "source_record_count_measurement", claimStatement: "Orphan count" })];
  const grouped = buildFindings({ evidenceItems: items, claims, sources });
  assert.deepEqual(grouped.outcomes.map((entry) => entry.statement), ["12 of 20 improved"]);
  assert.deepEqual(grouped.reach.map((entry) => entry.statement), ["40 participants linked"]);
  assert.deepEqual(grouped.findings.map((entry) => entry.statement), ["Apple statement", "Zebra statement"]);
  assert.deepEqual(grouped.technical.map((entry) => entry.evidenceItemId), [id(4)]);
  assert.deepEqual(grouped.findings[0].claims.map((entry) => entry.claimId), [id(11), id(12)]);
  assert.equal(grouped.findings[0].sourceFileName, "programme.csv");
  // A claim whose evidence item is not loaded is still listed (selectable), as a neutral measurement.
  assert.equal(grouped.measurements.length, 1);
  assert.equal(grouped.measurements[0].evidence, null);
  assert.equal(grouped.measurements[0].claims[0].claimId, id(13));
});

test("Impact state distinguishes no Project, loading, error, no results and incomplete results; a failed or partial read is never 'no evidence'", () => {
  const empty = buildFindings({});
  const some = buildFindings({ evidenceItems: [evidence(1)] });
  const ok = { status: "success", complete: true };
  assert.deepEqual(projectFindingsState({ engagementId: "", reads: [ok], grouped: some }), { kind: "no_project" });
  assert.deepEqual(projectFindingsState({ engagementId: PROJECT, reads: [{ status: "loading" }], grouped: empty }), { kind: "loading" });
  assert.deepEqual(projectFindingsState({ engagementId: PROJECT, reads: [ok, { status: "error", message: "x" }], grouped: some }), { kind: "error", message: "x" });
  assert.deepEqual(projectFindingsState({ engagementId: PROJECT, reads: [ok, ok], grouped: empty }), { kind: "empty" });
  assert.deepEqual(projectFindingsState({ engagementId: PROJECT, reads: [{ status: "success", complete: false }], grouped: empty }), { kind: "incomplete_empty" });
  assert.deepEqual(projectFindingsState({ engagementId: PROJECT, reads: [{ status: "success", complete: false }], grouped: some }), { kind: "ready", complete: false, loading: false });
  // Structural facts alone are not results.
  assert.equal(projectFindingsState({ engagementId: PROJECT, reads: [ok], grouped: buildFindings({ evidenceItems: [evidence(4, { evidenceType: "dictionary_field_presence_fact" })] }) }).kind, "empty");
  assert.deepEqual(shortStatement("short"), { text: "short", shortened: false });
  assert.equal(shortStatement("word ".repeat(100), 50).shortened, true);
});

// ---------------------------------------------------------------------------
// Evidence Library: the recorded measurement family (display field only)
// ---------------------------------------------------------------------------

function fakeDb(rows, families) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: queries.length === 1 ? rows : families };
    },
  };
}

test("the evidence read adds the derived-measurement family with one tenant-scoped batched lookup, only when the page holds derived-measurement evidence", async () => {
  const plain = fakeDb([{ evidence_item_id: id(1), evidence_type: "source_document_statement" }], []);
  const plainRows = await listOrganizationEvidenceItems(ORG, { limit: 25 }, plain);
  assert.equal(plain.queries.length, 1, "no derived-measurement table is read without derived evidence");
  assert.equal(plainRows[0].measurement_family, null);

  const derived = fakeDb(
    [{ evidence_item_id: id(1), evidence_type: "source_derived_measurement" }, { evidence_item_id: id(2), evidence_type: "source_record_count_measurement" }],
    [{ evidence_item_id: id(1), measurement_family: "paired_outcome_change" }],
  );
  const derivedRows = await listOrganizationEvidenceItems(ORG, { limit: 25 }, derived);
  assert.equal(derived.queries.length, 2);
  assert.deepEqual(derived.queries[1].params, [ORG, [id(1)]]);
  assert.match(derived.queries[1].sql, /WHERE edm\.organization_id = \$1::uuid\s+AND edm\.evidence_item_id = ANY\(\$2::uuid\[\]\)/);
  assert.doesNotMatch(derived.queries[1].sql, /\b(INSERT|UPDATE|DELETE)\b/i);
  assert.deepEqual(derivedRows.map((row) => row.measurement_family), ["paired_outcome_change", null]);
});

// Final local acceptance (2026-11-07): a paired measurement recorded and then
// given its meaning has two evidence items - the first, uninterpreted
// statement and the current one. Impact showed both as outcome findings, and
// offered the first for drafts although P2-03 refuses it
// (derived_measurement_claim_basis_invalid).
test("derived evidence stated under a superseded interpretation is supporting detail, never an Impact finding; the read uses the current-interpretation rule", async () => {
  const derived = fakeDb(
    [{ evidence_item_id: id(1), evidence_type: "source_derived_measurement" }, { evidence_item_id: id(2), evidence_type: "source_derived_measurement" },
      { evidence_item_id: id(3), evidence_type: "source_document_statement" }],
    [{ evidence_item_id: id(1), measurement_family: "paired_outcome_change", measurement_evidence_current: false },
      { evidence_item_id: id(2), measurement_family: "paired_outcome_change", measurement_evidence_current: true }],
  );
  const rows = await listOrganizationEvidenceItems(ORG, { limit: 25 }, derived);
  assert.deepEqual(rows.map((row) => row.measurement_evidence_current), [false, true, null]);
  const sql = derived.queries[1].sql;
  assert.match(sql, /COALESCE\(edm\.interpretation_id::text, ''\) = COALESCE\(\(/, "uninterpreted evidence is current only while the measurement has no interpretation");
  assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM kai\.source_derived_measurement_interpretations n[\s\S]*n\.organization_id = c\.organization_id[\s\S]*n\.supersedes_interpretation_id = c\.interpretation_id/, "current = the interpretation nothing supersedes, tenant-scoped");
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/i);
  const plain = fakeDb([{ evidence_item_id: id(3), evidence_type: "source_document_statement" }], []);
  assert.equal((await listOrganizationEvidenceItems(ORG, { limit: 25 }, plain))[0].measurement_evidence_current, null);

  const actorContext = { actorType: "human", actorUserId: "user-1", globalRoles: ["gk_admin"], organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }] };
  const row = (current) => ({ evidence_item_id: id(1), organization_id: ORG, evidence_type: "source_derived_measurement", statement: "s", measurement_family: "paired_outcome_change", measurement_evidence_current: current });
  const read = (current) => listOrganizationEvidenceLibrary({ organizationId: ORG, limit: 25, actorContext },
    { env: { KAI_SPRINT2_ENABLED: "true" }, listOrganizationEvidenceItems: async () => [row(current)] });
  assert.equal((await read(false)).data.items[0].measurementEvidenceCurrent, false);
  assert.equal((await read(undefined)).data.items[0].measurementEvidenceCurrent, null);
  assert.equal((await read("no")).ok, false, "a malformed flag fails closed");
  assert.equal(projectEvidenceLibraryItems({ items: [{ evidenceItemId: id(1), measurementEvidenceCurrent: false }] })[0].measurementEvidenceCurrent, false);
  assert.equal(projectEvidenceLibraryItems({ items: [{ evidenceItemId: id(1), measurementEvidenceCurrent: "false" }] })[0].measurementEvidenceCurrent, null);

  const grouped = buildFindings({ evidenceItems: [
    evidence(1, { evidenceType: "source_derived_measurement", measurementFamily: "paired_outcome_change", measurementEvidenceCurrent: false, statement: "4 of 6 higher (first statement)" }),
    evidence(2, { evidenceType: "source_derived_measurement", measurementFamily: "paired_outcome_change", measurementEvidenceCurrent: true, statement: "Confidence: 4 of 6 higher" }),
    evidence(3, { evidenceType: "source_derived_measurement", measurementFamily: "cross_source_reach", statement: "No flag: still reach" }),
  ], sources });
  assert.deepEqual(grouped.outcomes.map((entry) => entry.evidenceItemId), [id(2)], "only the current statement is an outcome finding");
  assert.deepEqual(grouped.technical.map((entry) => entry.evidenceItemId), [id(1)]);
  assert.equal(grouped.technical[0].typeLabel, "Earlier statement of a measurement (meaning since recorded)");
  assert.deepEqual(grouped.reach.map((entry) => entry.evidenceItemId), [id(3)], "a missing flag never hides a finding");
  assert.equal(findingCategory("source_derived_measurement", "cross_source_reach", false), "technical");
  assert.equal(findingTypeLabel("source_derived_measurement", "paired_outcome_change", null), "Baseline and follow-up measurement");
  const state = projectFindingsState({ engagementId: PROJECT, reads: [{ status: "success", complete: true }],
    grouped: buildFindings({ evidenceItems: [evidence(1, { evidenceType: "source_derived_measurement", measurementFamily: "paired_outcome_change", measurementEvidenceCurrent: false })] }) });
  assert.equal(state.kind, "empty", "a superseded statement alone is not a result");
});

test("the Evidence Library DTO carries measurementFamily, fails closed on a malformed one, and the client projection keeps it", async () => {
  const actorContext = { actorType: "human", actorUserId: "user-1", globalRoles: ["gk_admin"], organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }] };
  const row = (family) => ({ evidence_item_id: id(1), organization_id: ORG, evidence_type: "source_derived_measurement", statement: "s", measurement_family: family });
  const deps = (family) => ({ env: { KAI_SPRINT2_ENABLED: "true" }, listOrganizationEvidenceItems: async () => [row(family)] });
  const ok = await listOrganizationEvidenceLibrary({ organizationId: ORG, limit: 25, actorContext }, deps("cross_source_reach"));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.data.items[0].measurementFamily, "cross_source_reach");
  const none = await listOrganizationEvidenceLibrary({ organizationId: ORG, limit: 25, actorContext }, deps(undefined));
  assert.equal(none.data.items[0].measurementFamily, null);
  const malformed = await listOrganizationEvidenceLibrary({ organizationId: ORG, limit: 25, actorContext }, deps("Paired Outcome!"));
  assert.equal(malformed.ok, false);
  assert.equal(projectEvidenceLibraryItems({ items: [{ evidenceItemId: id(1), measurementFamily: "paired_outcome_change" }] })[0].measurementFamily, "paired_outcome_change");
  assert.equal(projectEvidenceLibraryItems({ items: [{ evidenceItemId: id(1) }] })[0].measurementFamily, null);
});

// ---------------------------------------------------------------------------
// Rendered components (static render: no effects, so no request is issued)
// ---------------------------------------------------------------------------

const repoRoot = new URL("..", import.meta.url).pathname;
async function loadComponent(relativePath) {
  const cacheRoot = join(repoRoot, "node_modules", ".cache");
  mkdirSync(cacheRoot, { recursive: true });
  const dir = mkdtempSync(join(cacheRoot, "kai-four-view-"));
  const outfile = join(dir, "component.mjs");
  await build({
    entryPoints: [join(repoRoot, relativePath)],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    jsx: "automatic",
    loader: { ".js": "jsx", ".css": "empty" },
    external: ["react", "react/*", "react-dom", "react-dom/*"],
    logLevel: "silent",
  });
  try {
    return await import(pathToFileURL(outfile).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const markupOrder = (markup, needles) => needles.map((needle) => {
  const index = markup.indexOf(needle);
  assert.ok(index > -1, `missing: ${needle}`);
  return index;
});

test("rendered Impact: outcomes, then reach, then other findings, then what needs attention; structural facts are not shown; each finding links to its evidence", async () => {
  const { ImpactView } = await loadComponent("frontend/knowledgeStudio/KnowledgeStudioViews.jsx");
  const grouped = buildFindings({
    evidenceItems: [
      evidence(1, { statement: "Document says the programme ran weekly" }),
      evidence(2, { evidenceType: "source_derived_measurement", measurementFamily: "paired_outcome_change", statement: "12 of 20 participants improved" }),
      evidence(3, { evidenceType: "source_derived_measurement", measurementFamily: "cross_source_reach", statement: "40 distinct participants attended" }),
      evidence(4, { evidenceType: "dictionary_field_presence_fact", statement: "Source has column field_5 (text_like)" }),
    ],
    sources,
  });
  const state = projectFindingsState({ engagementId: PROJECT, reads: [{ status: "success", complete: true }], grouped });
  const markup = renderToStaticMarkup(React.createElement(ImpactView, {
    projectName: "Harbourline", engagementId: PROJECT, state, grouped,
    attention: [{ key: "x", text: "2 file(s) need a step" }], onOpenFinding: () => {}, onOpenEvidence: () => {},
  }));
  const [heading, outcomes, reach, other, attention] = markupOrder(markup, [
    "What this Project tells us about our impact", "12 of 20 participants improved", "40 distinct participants attended",
    "Document says the programme ran weekly", "2 file(s) need a step",
  ]);
  assert.ok(heading < outcomes && outcomes < reach && reach < other && other < attention);
  assert.doesNotMatch(markup, /field_5|text_like/);
  assert.match(markup, /Evidence, definition and limitations/);
  assert.doesNotMatch(markup, /data-impact-state="incomplete"/);
});

test("rendered Impact: partial, failed, empty and no-Project states say so and never claim there is no evidence", async () => {
  const { ImpactView } = await loadComponent("frontend/knowledgeStudio/KnowledgeStudioViews.jsx");
  const render = (state, grouped = buildFindings({ evidenceItems: [evidence(1)] })) => renderToStaticMarkup(React.createElement(ImpactView, {
    engagementId: state.kind === "no_project" ? "" : PROJECT, state, grouped, onLoadMore: () => {},
  }));
  const partial = render({ kind: "ready", complete: false });
  assert.match(partial, /data-impact-state="incomplete"/);
  assert.match(partial, /covers the evidence loaded so far/);
  assert.match(partial, /in the evidence loaded so far/, "an empty section of a partial read is not 'none recorded'");
  assert.match(partial, /Load more evidence/);
  assert.match(render({ kind: "error", message: "" }), /This does not mean the Project has no evidence/);
  assert.match(render({ kind: "loading" }), /data-impact-state="loading"/);
  assert.match(render({ kind: "empty" }, buildFindings({})), /No findings or measurements are recorded for this Project yet/);
  assert.match(render({ kind: "incomplete_empty" }, buildFindings({})), /more evidence exists/);
  const none = render({ kind: "no_project" });
  assert.match(none, /Select a Project above/);
  assert.doesNotMatch(none, /What needs attention/);
});

test("empty Project prompt requires complete Project uploads, sources, evidence and claims, never just no findings", () => {
  const read = { status: "success", complete: true, items: [] };
  const data = { engagementId: PROJECT, files: [], reviewedImpactFacts: [], truncated: false, reviewedImpactFactsTruncated: false };
  const input = { engagementId: PROJECT, scope: PROJECT, pipeline: { status: "success_empty", data }, sources: read, evidence: read, claims: read };
  assert.equal(projectIsConfirmedEmpty(input), true);
  for (const status of ["loading", "not_started", "error", "success_with_data"]) {
    assert.equal(projectIsConfirmedEmpty({ ...input, pipeline: { status, data } }), false, status);
  }
  for (const change of [{ truncated: true }, { reviewedImpactFactsTruncated: true }, { files: [{}] },
    { reviewedImpactFacts: [{}] }, { engagementId: ORG }, { files: null }, { truncated: undefined }]) {
    assert.equal(projectIsConfirmedEmpty({ ...input, pipeline: { status: "success_empty", data: { ...data, ...change } } }), false, JSON.stringify(change));
  }
  for (const key of ["sources", "evidence", "claims"]) {
    for (const change of [{ status: "loading" }, { status: "error" }, { complete: false }, { items: [{}] },
      { loadingMore: true }, { message: "Read failed" }, { items: null }]) {
      assert.equal(projectIsConfirmedEmpty({ ...input, [key]: { ...read, ...change } }), false, `${key}: ${JSON.stringify(change)}`);
    }
    assert.equal(projectIsConfirmedEmpty({ ...input, [key]: undefined }), false);
  }
  assert.equal(projectIsConfirmedEmpty({ ...input, engagementId: "" }), false);
  assert.equal(projectIsConfirmedEmpty({ ...input, scope: "" }), false, "organization-library expansion cannot establish Project emptiness");
  assert.equal(projectIsConfirmedEmpty({ ...input, pipeline: undefined }), false, "GK without upload data keeps neutral Impact");
});

test("rendered Impact offers the exact empty-Project CTA only after confirmation; uncertain states stay neutral", async () => {
  const { ImpactView } = await loadComponent("frontend/knowledgeStudio/KnowledgeStudioViews.jsx");
  const render = (kind, projectEmpty) => renderToStaticMarkup(React.createElement(ImpactView, {
    engagementId: PROJECT, state: { kind, complete: true }, grouped: buildFindings({}),
    projectEmpty, onOpenSources: () => {},
  }));
  const empty = render("empty", true);
  assert.match(empty, /Start building your impact picture/);
  assert.match(empty, /Add your existing reports, spreadsheets and other files so KAI can begin organizing your impact evidence\./);
  assert.match(empty, />Add files<\/button>/);
  for (const kind of ["loading", "error", "incomplete_empty", "ready", "no_project"]) {
    assert.doesNotMatch(render(kind, true), /data-impact-empty-project|Start building your impact picture/);
  }
  assert.doesNotMatch(render("empty", false), /data-impact-empty-project/);
  assert.match(render("empty", false), /No findings or measurements are recorded/);
});

const adminCapabilities = {
  internalKnowledgeWorkspace: false,
  intakeContribution: true,
  workflowOperations: { extractEvidence: true, proposeClaim: true, generateDrafts: true, readInternalDrafts: true, recordSourceMeasurement: true },
};

test("rendered client Knowledge Studio: the Project name leads, four tabs, Impact is open, and only the Impact view is mounted (one shared workflow controller)", async () => {
  const { default: ClientKnowledgeStudio } = await loadComponent("frontend/knowledgeStudio/ClientKnowledgeStudio.jsx");
  for (const capabilities of [adminCapabilities, { internalKnowledgeWorkspace: false, intakeContribution: true }]) {
    const markup = renderToStaticMarkup(React.createElement(ClientKnowledgeStudio, {
      organizationId: ORG, engagementId: PROJECT, projectName: "Harbourline Project", capabilities, facts: { status: "success", items: [] },
    }));
    const tabs = [...markup.matchAll(/data-knowledge-studio-tab="([a-z]+)"/g)].map((match) => match[1]);
    assert.deepEqual(tabs, ["sources", "impact", "evidence", "drafts"]);
    assert.match(markup, /aria-selected="true"[^>]*data-knowledge-studio-tab="impact"/);
    assert.match(markup, /<h1 class="admin-title mb-0">Harbourline Project<\/h1>/);
    const views = [...markup.matchAll(/data-knowledge-studio-view="([a-z]+)"/g)].map((match) => match[1]);
    assert.deepEqual(views, ["impact"], "only the active view is mounted on open");
    assert.match(markup, /What this Project tells us about our impact/);
    for (const old of ["Data Sources", "Funder Requirements", "Generated Drafts", "Gaps and Risks"]) {
      assert.ok(!markup.includes(`>${old}<`), `${old} is not stacked under Impact`);
    }
    const controllers = (markup.match(/data-client-evidence-workflow=""/g) || []).length;
    assert.equal(controllers, capabilities === adminCapabilities ? 1 : 0);
    // Ask KAI keeps its function but states its organization-wide scope.
    assert.match(markup, /answers from your whole organization library/);
  }
  const noProject = renderToStaticMarkup(React.createElement(ClientKnowledgeStudio, {
    organizationId: ORG, engagementId: "", capabilities: adminCapabilities, facts: { status: "success", items: [] },
  }));
  assert.match(noProject, /No Project selected/);
  assert.match(noProject, /Select a Project above to see what its evidence shows/);
});

test("rendered GK Knowledge Studio: four tabs with Impact open; Claims, Traceability, drafting and Sources sections are not stacked under it", async () => {
  const { default: ImpactEvidenceLibrary } = await loadComponent("frontend/ImpactEvidenceLibrary.jsx");
  const markup = renderToStaticMarkup(React.createElement(ImpactEvidenceLibrary, {
    organizationId: ORG, onOrganizationIdChange: () => {}, engagementId: PROJECT, onEngagementIdChange: () => {},
    projectName: "Harbourline Project", workflowOperations: { generateDrafts: true, readGeneratedDrafts: true, extractEvidence: true },
  }));
  const tabs = [...markup.matchAll(/data-knowledge-studio-tab="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ["sources", "impact", "evidence", "drafts"]);
  assert.match(markup, /aria-selected="true"[^>]*data-knowledge-studio-tab="impact"/);
  assert.match(markup, /What this Project tells us about our impact/);
  for (const heading of ["Claims", "Traceability", "Generated Drafts", "Grant Response Packet", "Board Reporting", "KAI Baseline Readiness", "Data Sources", "Review Queue", "Gaps and Risks"]) {
    assert.ok(!markup.includes(`>${heading}</h5>`), `${heading} is not stacked under Impact`);
  }
  assert.match(markup, /answers from the whole organization library/);
});

// ---------------------------------------------------------------------------
// Shared state and asynchronous context safety (wiring)
// ---------------------------------------------------------------------------

const read = (path) => readFileSync(path, "utf8");

test("client: one stable workflow controller presents all four views; selections, pending state and idempotency keys live in it, not in a view", () => {
  const studio = read("frontend/knowledgeStudio/ClientKnowledgeStudio.jsx");
  const workflow = read("frontend/knowledgeStudio/ClientEvidenceWorkflow.jsx");
  assert.equal((studio.match(/<ClientEvidenceWorkflow\b/g) || []).length, 1, "a single controller instance");
  // Mounted for the studio, not inside one view pane.
  const mount = studio.indexOf("<ClientEvidenceWorkflow");
  assert.doesNotMatch(studio.slice(Math.max(0, mount - 120), mount), /<ViewPane/);
  assert.match(studio, /view=\{tab\}\s+visitedViews=\{visitedViews\}\s+onSelectView=\{selectTab\}/);
  for (const pane of ["impact", "evidence", "sources", "drafts"]) {
    assert.match(workflow, new RegExp(`<ViewPane name="${pane}" active=\\{view === "${pane}"\\} mounted=\\{visitedViews\\.includes\\("${pane}"\\)\\}>`));
  }
  // Views stay mounted (hidden) once opened, so forms and open panels survive navigation.
  const views = read("frontend/knowledgeStudio/KnowledgeStudioViews.jsx");
  assert.match(views, /if \(!mounted\) return null;\s*return \(\s*<div hidden=\{!active\}/);
  // Selection is cleared only on an organization/Project change, never on a view change.
  assert.match(workflow, /useEffect\(\(\) => \{\s*setSelectedClaimIds\(\[\]\);[\s\S]*?setPending\(""\);\s*\}, \[organizationId, engagementId\]\);/);
  assert.doesNotMatch(workflow, /\[view\][^\n]*setSelectedClaimIds|setSelectedClaimIds\(\[\]\);[^\n]*view/);
  // Generation still uses the selected claim ids and the retained idempotency key.
  assert.match(workflow, /internalDraftRequestBody\(\{ claimIds: selectedClaimIds, idempotencyKey, engagementId \}\)/);
  assert.match(workflow, /const idempotencyKey = draftKeys\[contentType\] \|\| `client-\$\{contentType\}-\$\{globalThis\.crypto\.randomUUID\(\)\}`;/);
  // Draft citations resolve from the controller's claims, not from a mounted Evidence view.
  assert.match(workflow, /<ClientInternalDrafts organizationId=\{organizationId\} engagementId=\{engagementId\} claims=\{claims\.items\}/);
  // Switching views neither re-reads the libraries (loaded pages survive) nor clears a selection.
  assert.doesNotMatch(studio, /setWorkflowRefreshSignal|refreshSignal/);
  assert.doesNotMatch(workflow, /refreshSignal/);
  // The organization-library expansion is unchanged and resets per Project.
  assert.match(workflow, /useEffect\(\(\) => \{ setIncludeOrganizationLibrary\(false\); \}, \[organizationId, engagementId\]\);/);
  assert.match(workflow, /const scope = isRouteUuid\(engagementId\) && !includeOrganizationLibrary \? engagementId : "";/);
});

test("context safety: Ask KAI, internal draft reading and GK draft packets discard responses from a previous Project and recover pending controls", () => {
  const kai = read("frontend/ImpactLibraryKai.jsx");
  assert.match(kai, /const requestContext = contextRef\.current;[\s\S]*?if \(contextRef\.current !== requestContext\) return;\s*setSending\(false\);/);
  assert.match(kai, /setInput\(""\);\s*setSending\(false\);\s*\}, \[organizationId, engagementId\]\);/);
  assert.match(kai, /not only the selected Project/);
  const drafts = read("frontend/knowledgeStudio/ClientInternalDrafts.jsx");
  assert.match(drafts, /if \(detailSeqRef\.current !== seq \|\| contextRef\.current !== requestContext\) return;/);
  assert.match(drafts, /const current = \(\) => reportSeqRef\.current === seq && contextRef\.current === requestContext;/);
  assert.match(drafts, /detailSeqRef\.current \+= 1;\s*reportSeqRef\.current \+= 1;\s*setDetail\(\{ status: "idle"/);
  // Focused reader with a return path.
  assert.match(drafts, /data-client-internal-draft-back=""/);
  assert.match(drafts, /const listShown = !readerOpen && /);
  const gk = read("frontend/ImpactEvidenceLibrary.jsx");
  assert.match(gk, /const request = \+\+generatedDraftPacketRequestRef\.current;[\s\S]*?if \(request !== generatedDraftPacketRequestRef\.current\) return;/);
  assert.match(gk, /generatedDraftPacketRequestRef\.current \+= 1;\s*setGeneratedDraftPacket\(null\);\s*\}, \[organizationId, engagementId\]\);/);
});

test("GK: Evidence, Claims, Sources and Drafts reads pass the selected Project; organization-wide eligibility never adds another Project's claim; rollups are labelled organization-wide", () => {
  const gk = read("frontend/ImpactEvidenceLibrary.jsx");
  assert.match(gk, /getJson\(claimLibraryCandidatesPath\(organizationId, null, engagementId \|\| null\)\)/);
  assert.match(gk, /getJson\(evidenceLibraryCandidatesPath\(organizationId, null, engagementId \|\| null\)\)/);
  assert.match(gk, /getJson\(organizationSourcesPath\(organizationId, engagementId \|\| null\)\)/);
  assert.match(gk, /getJson\(generatedDraftLibraryIndexPath\(requestOrganizationId, engagementId \|\| null\)\)/);
  assert.match(gk, /const listedEligible = engagementId \? eligibleClaims\.filter\(\(claim\) => candidateIds\.has\(claim\.claimId\)\) : eligibleClaims;/);
  assert.match(gk, /setCandidateClaims\(\[\]\);\s*setCandidateClaimsTruncated\(false\);\s*if \(organizationId\) loadCandidateClaims\(\);/);
  assert.match(gk, /Across the organization \(all Projects\)/);
  assert.match(gk, /This is not limited to the selected Project\./);
  // Generation still requires a selected Project and the existing selection rules.
  assert.match(gk, /if \(audience !== "internal" \|\| !engagementId\) return;/);
  assert.match(gk, /canSelectClaimForInternalGeneration\(claim, audience\)/);
  assert.match(gk, /canSelectClaimForFunderGeneration\(claim, audience\)/);
});


// ---------------------------------------------------------------------------
// MVP UI completion (owner task 2026-11-07): readable recorded statements,
// claim/finding repetition, accessible tabs, traceability presentation.

const PAIRED_STATEMENT = "Derived measurement: Confidence self-rating (meaning stated by the organization; values self-reported): numeric outcome field_4 (column D), "
  + "in selected worksheet sheet_1, baseline to follow-up, no reporting period: 4 of 6 comparable participant pairs (66.67%) have a numerically higher follow-up value, "
  + "1 the same, 1 lower; the organization states higher is better. Pairs need the same participant (no instrument version recorded); 0 of 6 participants excluded as not comparable.";

test("readable statement: a paired measurement leads with the organization's recorded label and result; column and worksheet keys move to the recorded detail", () => {
  const display = findingDisplay(PAIRED_STATEMENT);
  assert.equal(display.headline, "Confidence self-rating");
  assert.match(display.summary, /^Baseline to follow-up: 4 of 6 comparable participant pairs \(66\.67%\) have a numerically higher follow-up value, 1 the same, 1 lower;/);
  assert.doesNotMatch(`${display.headline} ${display.summary} ${display.note}`, /field_\d|sheet_\d|column D/);
  assert.equal(display.note, "Meaning stated by the organization; values self-reported");
  assert.equal(display.location, "Numeric outcome field_4 (column D), in selected worksheet sheet_1");
  assert.equal(display.full, PAIRED_STATEMENT, "the recorded statement is kept exactly");
  // Every shown fragment is verbatim recorded text (nothing calculated or added).
  for (const part of [display.headline, display.summary.replace(/^Baseline to follow-up: /, ""), "meaning stated by the organization; values self-reported"]) {
    assert.ok(PAIRED_STATEMENT.includes(part), part);
  }
});

test("readable statement: a record count leads with its counted source records, from the real composer; the organization's label is a note, never the headline; an unrecognized technical statement is neutral; prose is unchanged", () => {
  const recorded = composeMeasurementEvidenceStatement({
    measurement: { measuredValue: 5, calculationMethod: "csv", blankRecordCount: 0, duplicateRecordCount: 2, countedDuplicates: { memberRecordCount: 2, excessCopyCount: 1 } },
    definition: { unitLabel: "programme sessions", countedUnit: "programme session", periodStart: "2026-01-01", periodEnd: "2026-06-30" },
  });
  const count = findingDisplay(recorded);
  assert.equal(count.headline, "5 source records");
  assert.equal(count.summary, "Counting each CSV data record after the header row as one record; 0 blank records excluded; 2 in exact-duplicate groups (1 excess copy), not removed.");
  assert.equal(count.note, "Not applied by KAI: the organization's description of each record as one programme session, its stated period 2026-01-01 to 2026-06-30, and its inclusion and exclusion rules.");
  assert.equal(count.full, recorded);
  // A statement recorded before owner Package 1 never leads with its label.
  const legacy = findingDisplay("Source version record count: 217 completed FY contacts for the reporting period 2025-04-01 to 2026-03-31, counting each CSV data record after the header row as one completed contact; 0 blank records excluded; 4 exact-duplicate records included.");
  assert.equal(legacy.headline, "217 data records");
  assert.match(legacy.note, /^Recorded label and period, not applied by the count: completed FY contacts, for the reporting period 2025-04-01 to 2026-03-31\.$/);
  assert.doesNotMatch(`${legacy.headline} ${legacy.summary}`, /completed|FY/);
  const technical = findingDisplay("Derived measurement: 3 records in selected worksheet sheet_1 have field_3 = Yes, across all dates.");
  assert.equal(technical.neutral, true);
  assert.equal(technical.summary, "");
  assert.equal(technical.headline, "", "no label is invented");
  const prose = findingDisplay("Participants reported feeling safer at sessions.");
  assert.deepEqual([prose.headline, prose.summary, prose.neutral], ["", "Participants reported feeling safer at sessions.", false]);
});

test("claim wording: a claim that restates its finding is not repeated; materially different wording is kept available", () => {
  assert.equal(claimRestatesFinding("Confidence self-rating (meaning stated by the organization): 4 of 6.", "Derived measurement: Confidence self-rating (meaning stated by the organization): 4 of 6"), true);
  assert.equal(claimRestatesFinding("The promoted source records 5 programme sessions with no reporting period defined (record count: one programme session per CSV data record).",
    "Source version record count: 5 programme sessions with no reporting period defined, counting each CSV data record after the header row as one programme session."), false);
});

test("tabs: arrow keys, Home and End move within the four views; other keys do nothing", () => {
  assert.equal(tabKeyTarget("ArrowRight", "impact"), "evidence");
  assert.equal(tabKeyTarget("ArrowRight", "drafts"), "sources");
  assert.equal(tabKeyTarget("ArrowLeft", "impact"), "sources");
  assert.equal(tabKeyTarget("Home", "evidence"), "sources");
  assert.equal(tabKeyTarget("End", "evidence"), "drafts");
  assert.equal(tabKeyTarget("Enter", "evidence"), null);
  assert.equal(tabKeyTarget("ArrowRight", "unknown"), null);
});

test("rendered tabs: one tab stop, aria-controls to a tabpanel labelled by its tab; GK uses one shared panel; the row does not wrap", async () => {
  const { KnowledgeStudioNav, ViewPane } = await loadComponent("frontend/knowledgeStudio/KnowledgeStudioViews.jsx");
  const nav = renderToStaticMarkup(React.createElement(KnowledgeStudioNav, { view: "evidence", onSelect: () => {} }));
  assert.equal((nav.match(/tabindex="0"/g) || []).length, 1);
  assert.equal((nav.match(/tabindex="-1"/g) || []).length, 3);
  assert.match(nav, /id="knowledge-studio-tab-evidence" aria-selected="true" aria-controls="knowledge-studio-panel-evidence" tabindex="0"/);
  assert.match(nav, /flex-nowrap/);
  assert.match(nav, /aria-label="Knowledge Studio views"/);
  const pane = renderToStaticMarkup(React.createElement(ViewPane, { name: "evidence", active: false, mounted: true }, "x"));
  assert.match(pane, /hidden="" role="tabpanel" id="knowledge-studio-panel-evidence" aria-labelledby="knowledge-studio-tab-evidence"/);
  const gk = renderToStaticMarkup(React.createElement(KnowledgeStudioNav, { view: "sources", onSelect: () => {}, idPrefix: "ks-gk", singlePanelId: "ks-gk-panel" }));
  assert.equal((gk.match(/aria-controls="ks-gk-panel"/g) || []).length, 1, "only the selected tab controls the shared panel");
});

test("rendered finding text: readable first, the recorded statement kept mounted behind a disclosure", async () => {
  const { FindingText } = await loadComponent("frontend/knowledgeStudio/KnowledgeStudioViews.jsx");
  const markup = renderToStaticMarkup(React.createElement(FindingText, { statement: PAIRED_STATEMENT }));
  const visible = markup.replace(/<div id="ks-disclosure-[^"]*" hidden=""[\s\S]*$/, "");
  assert.match(visible, /Confidence self-rating/);
  assert.doesNotMatch(visible, /field_4|sheet_1/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /hidden="" data-knowledge-studio-reveal="recorded-statement-[^"]+"/);
  assert.ok(markup.includes("numeric outcome field_4 (column D)"), "the recorded statement is available in detail");
});

test("traceability presentation: the claim -> evidence -> source chain and audience gates as readable rows, from the read's own fields only", () => {
  const rows = traceabilityChain({
    claim: { statement: "The promoted source records 5 programme sessions." },
    evidence: { statement: "Source version record count: 5 programme sessions." },
    source: { source_id: id(7), source_code: "SRC-7" },
    sourceVersion: { source_version_id: id(8), is_current: false },
  }, { sourceFileName: "sessions.csv" });
  assert.deepEqual(rows.map((row) => [row.label, row.text]), [
    ["Claim", "The promoted source records 5 programme sessions."],
    ["Evidence", "Source version record count: 5 programme sessions."],
    ["Source", "sessions.csv, earlier version (not current)"],
  ]);
  const same = traceabilityChain({ claim: { statement: "A: b." }, evidence: { statement: "Derived measurement: A: b" }, source: { source_code: "SRC" }, sourceVersion: { is_current: true } });
  assert.deepEqual(same.map((row) => row.label), ["Claim (restates its evidence)", "Source"]);
  assert.equal(same[1].text, "SRC, current version");
  assert.deepEqual(traceabilityChain(null), []);
  assert.deepEqual(audienceGateRows({ internal_only: true, funder_use_allowed: false, public_use_allowed: null, export_ready: false }).map((row) => `${row.label}: ${row.value}`), [
    "Internal use only: Yes", "Funder use allowed: No", "Public use allowed: Not recorded", "Ready for export: No",
  ]);
});

test("wording: system-determined internal use is not presented as a human review; no approval language added; no new request in the changed views", () => {
  const workflow = readFileSync("frontend/knowledgeStudio/ClientEvidenceWorkflow.jsx", "utf8");
  const studio = readFileSync("frontend/knowledgeStudio/ClientKnowledgeStudio.jsx", "utf8");
  const views = readFileSync("frontend/knowledgeStudio/KnowledgeStudioViews.jsx", "utf8");
  assert.match(workflow, /Usable in internal reports now \(determined by KAI&rsquo;s checks\)/);
  assert.doesNotMatch(workflow, /No further review is needed for internal use/);
  assert.doesNotMatch(studio, /Reviewed for internal use/);
  assert.match(studio, /Usable internally/);
  assert.doesNotMatch(views, /getJson|postJson|fetch\(/, "shared views make no request");
  const kai = readFileSync("frontend/ImpactLibraryKai.jsx", "utf8");
  assert.match(kai, /<label className="form-label small fw-semibold mb-1" htmlFor=\{inputId\}>/);
  assert.match(kai, /id=\{inputId\}\s+aria-describedby=\{scopeId\}/);
});

test("a saved draft's citation shows the finding's label and readable result, never internal field or worksheet keys; the recorded statement stays available", async () => {
  const { citedFindingDisplay } = await import("../frontend/knowledgeStudio/knowledgeStudioViewsLogic.js");
  const paired = "Digital confidence (meaning stated by the organization; values self-reported): numeric outcome field_6 (column F), in selected worksheet sheet_1, baseline to follow-up, no reporting period: 25 of 38 comparable participant pairs (65.79%) have a numerically higher follow-up value, 10 the same, 3 lower; the organization states higher is better. Pairs need the same participant and instrument version; 24 of 62 participants excluded as not comparable.";
  const shown = citedFindingDisplay(paired);
  assert.match(shown.text, /^Digital confidence — Baseline to follow-up: 25 of 38 comparable participant pairs \(65\.79%\)/);
  assert.doesNotMatch(shown.text, /field_\d|sheet_\d/);
  assert.deepEqual([shown.full, shown.hasFull], [paired, true]);
  const reach = citedFindingDisplay("People served (meaning stated by the organization; values are organization records): 80 distinct register participants served, each counted once, among 223 eligible encounters: field_1 events, field_6 = completed.");
  assert.deepEqual([reach.text, reach.hasFull], ["People served", true]);
  const quote = 'Source-reported, not independently verified (line 1): "Follow-up information remains incomplete."';
  assert.deepEqual(citedFindingDisplay(quote), { text: quote, full: quote, hasFull: false });
});

test("a saved assessment shows each section title once and its measurement disclosure apart, without losing any text", async () => {
  const { assessmentBlockParts } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const first = "[[assessment:evidence_findings]]\nPeople served: 67 distinct people. Measurement disclosure for the cited measurement: KAI did not check the recorded values against any other source.";
  const second = "[[assessment:evidence_findings]]\nCommunity-connection confidence: 36 comparable participants.";
  const third = "[[assessment:impact_stories]]\nNo participant account is stated beyond the cited findings.";
  assert.deepEqual(assessmentBlockParts(first, null), { heading: "What Your Evidence Tells Us", prose: "People served: 67 distinct people.",
    disclosure: "Measurement disclosure for the cited measurement: KAI did not check the recorded values against any other source." });
  assert.deepEqual(assessmentBlockParts(second, first), { heading: null, prose: "Community-connection confidence: 36 comparable participants.", disclosure: null });
  assert.equal(assessmentBlockParts(third, second).heading, "Impact Stories");
  // An ordinary (non-assessment) block is unchanged.
  assert.deepEqual(assessmentBlockParts("Plain summary text.", null), { heading: null, prose: "Plain summary text.", disclosure: null });
});
