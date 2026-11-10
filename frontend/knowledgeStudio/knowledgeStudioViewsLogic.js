/**
 * Knowledge Studio four-view MVP (owner direction 2026-11-06): Impact |
 * Evidence | Sources | Drafts, shared by the client Knowledge Studio and the
 * Get Kinder Impact Evidence Library. Pure presentation logic only: every
 * number and statement shown comes from an existing governed read (Evidence
 * Library, Claim Library, Sources, client evidence pipeline). Nothing here
 * calculates a metric, totals results, ranks findings, or infers an outcome
 * from prose.
 *
 * Classification uses only recorded discriminators:
 * - a source-derived measurement whose recorded family is
 *   paired_outcome_change -> outcomes and observed change;
 * - a source-derived measurement whose recorded family is cross_source_reach
 *   -> reach and service delivery (its statement carries its own recorded
 *   definition of who or what was counted);
 * - every other measurement (record counts, tabular counts and rates, a
 *   derived measurement whose family is not known) -> other measurements;
 * - document statements and any other evidence type -> other findings;
 * - dictionary field-presence facts (which columns a source has) ->
 *   technical detail, kept available but never shown as a finding;
 * - a derived measurement's evidence stated under a superseded interpretation
 *   (measurementEvidenceCurrent === false, e.g. its first statement before the
 *   organization recorded what it means) -> technical detail too: the
 *   measurement's current statement is the finding, never both.
 */

import { documentStatementTypeLabel } from "../../shared/kaiDocumentStatementMeaning.js";

export const KNOWLEDGE_STUDIO_VIEWS = Object.freeze([
  ["sources", "Sources"],
  ["impact", "Impact"],
  ["evidence", "Evidence"],
  ["drafts", "Drafts"],
]);
export const DEFAULT_KNOWLEDGE_STUDIO_VIEW = "impact";

// No findings alone does not establish an empty Project. The existing client
// administrator reads cover uploads (including unpromoted files), sources,
// evidence and claims (including reuse). Other surfaces without all these
// reads keep their neutral Impact state. Never add a read just for this CTA.
export function projectIsConfirmedEmpty({ engagementId, scope, pipeline, sources, evidence, claims }) {
  const data = pipeline?.data;
  return Boolean(engagementId && scope === engagementId
    && pipeline?.status === "success_empty" && data?.engagementId === engagementId
    && data.truncated === false && data.reviewedImpactFactsTruncated === false
    && Array.isArray(data.files) && data.files.length === 0
    && Array.isArray(data.reviewedImpactFacts) && data.reviewedImpactFacts.length === 0
    && [sources, evidence, claims].every((read) => read?.status === "success"
      && read.complete === true && !read.loadingMore && !read.message
      && Array.isArray(read.items) && read.items.length === 0));
}

export const EVIDENCE_TYPES = Object.freeze({
  structural: "dictionary_field_presence_fact",
  document: "source_document_statement",
  recordCount: "source_record_count_measurement",
  derived: "source_derived_measurement",
});
export const MEASUREMENT_FAMILIES = Object.freeze({
  pairedOutcome: "paired_outcome_change",
  crossSourceReach: "cross_source_reach",
});

// Display order: outcomes before activity, findings after measurements,
// technical detail last.
export const FINDING_CATEGORIES = Object.freeze(["outcomes", "reach", "measurements", "findings", "technical"]);
export const FINDING_CATEGORY_LABELS = Object.freeze({
  outcomes: "Outcomes and observed change",
  reach: "Reach and service delivery",
  measurements: "Other measurements",
  findings: "Other findings",
  technical: "Supporting source detail",
});
export const FINDING_CATEGORY_DESCRIPTIONS = Object.freeze({
  outcomes: "Changes recorded between a baseline and a follow-up for the same people.",
  reach: "People, participation and services, counted under each measurement's own recorded definition.",
  measurements: "Counts and rates from your sources. Each counts what its own definition says, which is not necessarily people.",
  findings: "Statements found in your documents and other evidence.",
  technical: "Which columns each source has, and earlier statements of a measurement whose meaning has since been recorded. Useful for checking a source, not a finding about impact.",
});

export function findingCategory(evidenceType, measurementFamily, measurementEvidenceCurrent = null) {
  if (evidenceType === EVIDENCE_TYPES.structural) return "technical";
  if (evidenceType === EVIDENCE_TYPES.derived) {
    if (measurementEvidenceCurrent === false) return "technical";
    if (measurementFamily === MEASUREMENT_FAMILIES.pairedOutcome) return "outcomes";
    if (measurementFamily === MEASUREMENT_FAMILIES.crossSourceReach) return "reach";
    return "measurements";
  }
  if (evidenceType === EVIDENCE_TYPES.recordCount) return "measurements";
  return "findings";
}

// A document statement is named by what it is (owner Package 4): the source's
// estimate or method guidance is not an observation; from its own words.
export function findingTypeLabel(evidenceType, measurementFamily, measurementEvidenceCurrent = null, statement = null) {
  if (evidenceType === EVIDENCE_TYPES.structural) return "Column in a source";
  if (evidenceType === EVIDENCE_TYPES.derived && measurementEvidenceCurrent === false) return "Earlier statement of a measurement (meaning since recorded)";
  if (evidenceType === EVIDENCE_TYPES.document) return documentStatementTypeLabel(statement);
  if (evidenceType === EVIDENCE_TYPES.recordCount) return "Record count";
  if (evidenceType === EVIDENCE_TYPES.derived) {
    if (measurementFamily === MEASUREMENT_FAMILIES.pairedOutcome) return "Baseline and follow-up measurement";
    if (measurementFamily === MEASUREMENT_FAMILIES.crossSourceReach) return "Linked reach measurement";
    return "Measurement";
  }
  return "Evidence";
}

// File name of a source version from the Sources read, when it is loaded.
export function sourceVersionIndex(sources) {
  const index = new Map();
  for (const source of Array.isArray(sources) ? sources : []) {
    for (const version of Array.isArray(source.sourceVersions) ? source.sourceVersions : []) {
      if (version?.sourceVersionId) {
        index.set(version.sourceVersionId, {
          fileName: version.safeFilename || "",
          isCurrent: version.isCurrent === true,
        });
      }
    }
  }
  return index;
}

const compareText = (a, b) => String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });

/**
 * One entry per loaded evidence item (with the loaded claims that restate it),
 * plus one entry per loaded claim whose evidence item is not loaded. Grouped by
 * category in FINDING_CATEGORIES order; within a group, sorted by source file
 * and statement - a stable reading order, never a ranking.
 */
export function buildFindings({ evidenceItems = [], claims = [], sources = [] } = {}) {
  const versions = sourceVersionIndex(sources);
  const claimsByEvidence = new Map();
  for (const claim of Array.isArray(claims) ? claims : []) {
    if (!claim?.evidenceItemId) continue;
    const list = claimsByEvidence.get(claim.evidenceItemId) || [];
    list.push(claim);
    claimsByEvidence.set(claim.evidenceItemId, list);
  }
  const entries = [];
  const seenEvidence = new Set();
  for (const item of Array.isArray(evidenceItems) ? evidenceItems : []) {
    if (!item?.evidenceItemId || seenEvidence.has(item.evidenceItemId)) continue;
    seenEvidence.add(item.evidenceItemId);
    const version = versions.get(item.sourceVersionId);
    entries.push({
      key: `evidence:${item.evidenceItemId}`,
      evidenceItemId: item.evidenceItemId,
      evidence: item,
      claims: claimsByEvidence.get(item.evidenceItemId) || [],
      statement: item.statement || "",
      evidenceType: item.evidenceType || null,
      category: findingCategory(item.evidenceType, item.measurementFamily, item.measurementEvidenceCurrent),
      typeLabel: findingTypeLabel(item.evidenceType, item.measurementFamily, item.measurementEvidenceCurrent, item.statement),
      sourceVersionId: item.sourceVersionId || null,
      sourceFileName: version?.fileName || "",
      sourceIsCurrent: version ? version.isCurrent : null,
    });
  }
  for (const [evidenceItemId, list] of claimsByEvidence) {
    if (seenEvidence.has(evidenceItemId)) continue;
    const claim = list[0];
    const version = versions.get(claim.evidenceSourceVersionId);
    entries.push({
      key: `claim-evidence:${evidenceItemId}`,
      evidenceItemId,
      evidence: null,
      claims: list,
      statement: claim.claimStatement || claim.evidenceStatement || "",
      evidenceType: claim.evidenceType || null,
      // The Claim Library does not carry the measurement family: a derived
      // measurement whose evidence is not loaded stays a neutral measurement.
      category: findingCategory(claim.evidenceType, null),
      typeLabel: findingTypeLabel(claim.evidenceType, null, null, claim.claimStatement || claim.evidenceStatement),
      sourceVersionId: claim.evidenceSourceVersionId || null,
      sourceFileName: version?.fileName || "",
      sourceIsCurrent: claim.evidenceSourceVersionIsCurrent ?? (version ? version.isCurrent : null),
    });
  }
  const grouped = Object.fromEntries(FINDING_CATEGORIES.map((category) => [category, []]));
  for (const entry of entries) grouped[entry.category].push(entry);
  for (const category of FINDING_CATEGORIES) {
    grouped[category].sort((a, b) => compareText(a.sourceFileName, b.sourceFileName) || compareText(a.statement, b.statement) || compareText(a.key, b.key));
  }
  return grouped;
}

export function findingCount(grouped, categories = FINDING_CATEGORIES) {
  return categories.reduce((sum, category) => sum + (grouped?.[category]?.length || 0), 0);
}

/**
 * The Impact / Evidence state for the selected Project, from read states of
 * the shape { status: "loading" | "success" | "error", items, complete }.
 * Distinguishes no Project, loading, retrieval error, no supported results,
 * and incomplete results; a failed or partial read never becomes "no
 * evidence".
 */
export function projectFindingsState({ engagementId, reads = [], grouped }) {
  if (!engagementId) return { kind: "no_project" };
  const failed = reads.find((read) => read?.status === "error");
  if (failed) return { kind: "error", message: failed.message || "" };
  const loading = reads.some((read) => !read || read.status === "loading" || read.status === "idle");
  const complete = reads.every((read) => read?.complete !== false);
  const shown = findingCount(grouped, ["outcomes", "reach", "measurements", "findings"]);
  if (loading && shown === 0) return { kind: "loading" };
  if (shown === 0) return complete ? { kind: "empty" } : { kind: "incomplete_empty" };
  return { kind: "ready", complete, loading };
}

export const IMPACT_SECTION_LIMIT = 4;

// Text shortening for list cards; the full statement stays one click away.
export function shortStatement(text, max = 220) {
  const value = String(text || "").trim();
  if (value.length <= max) return { text: value, shortened: false };
  const cut = value.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  return { text: `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`, shortened: true };
}

// Mounts a view the first time it is opened and keeps it mounted (hidden)
// afterwards, so in-progress forms and open panels survive navigation.
export function nextVisitedViews(visited, view) {
  return visited.includes(view) ? visited : [...visited, view];
}

// ---------------------------------------------------------------------------
// Readable presentation of a recorded statement (owner task 2026-11-07,
// "Finish the MVP UI"). Display only: every part returned is a verbatim
// fragment of the recorded statement, re-ordered so the result leads and the
// technical location (column keys, worksheet keys, linked register ids) sits
// in detail. Nothing is calculated, summarized or interpreted; a statement
// whose shape is not recognized is shown as recorded, or - when it names
// technical keys that cannot be separated from its result - with neutral
// wording and the full statement one click away.

const TECHNICAL_TEXT_RE = /\bfield_\d+\b|\bsheet_\d+\b|\(column [A-Z]{1,3}\)|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// A record count stated since the measurement-to-claim integrity repair
// (owner Package 1, 2026-11-10): the counted source records lead; the
// organization's attributed description follows as a note.
const RECORD_COUNT_RE = /^Source version record count: (\d+) source records(?: from selected worksheet (\S+?))? \(each (.+?) after the header row; (\d+ blank records?) excluded; (.+?)\)\. (Not applied by KAI: .+)$/s;
// A record count stated before it: the recorded label was worded as the
// counted entity, so the display leads with the counted records instead and
// shows the label only as the organization's recorded label.
const LEGACY_RECORD_COUNT_RE = /^Source version record count: (\d+) (.+?) (for the reporting period \S+ to \S+|with no reporting period defined),(?: from selected worksheet (\S+?),)? counting each (.+?) after the header row as one (.+?); (\d+ blank records?) excluded; (\d+ exact-duplicate records?) included\.$/s;
const INTERPRETATION_RE = /^(.+?) \((meaning stated by the organization(?:; [^)]*)?)\): (.+)$/s;
const PAIRED_BODY_RE = /^numeric outcome (\S+ \(column [A-Z]{1,3}\)), (in selected worksheet \S+|in the CSV data records), baseline to follow-up, no reporting period: (.+)$/s;

export function hasTechnicalText(text) {
  return TECHNICAL_TEXT_RE.test(String(text || ""));
}

const capitalize = (text) => (text ? `${text[0].toUpperCase()}${text.slice(1)}` : text);

/**
 * { headline, summary, note, location, full, neutral } for one recorded
 * statement. `headline` is the organization's recorded indicator label or the
 * counted value with its unit, when the statement states one; `summary` the
 * recorded result; `note` the recorded basis of its meaning; `location` the
 * recorded column/worksheet wording; `full` the statement exactly as recorded;
 * `neutral` true when the result cannot be shown without technical keys.
 */
export function findingDisplay(statement) {
  const full = String(statement || "").trim();
  const plain = { headline: "", summary: full, note: "", location: "", full, neutral: false };
  if (!full) return plain;
  const count = RECORD_COUNT_RE.exec(full);
  if (count) {
    const [, value, sheet, noun, blank, duplicates, attribution] = count;
    return {
      headline: `${value} source records`,
      summary: `Counting each ${noun} after the header row as one record; ${blank} excluded; ${duplicates}.`,
      note: attribution,
      location: sheet ? `From selected worksheet ${sheet}` : "",
      full,
      neutral: false,
    };
  }
  const legacy = LEGACY_RECORD_COUNT_RE.exec(full);
  if (legacy) {
    const [, value, unit, period, sheet, noun, , blank, duplicates] = legacy;
    return {
      headline: `${value} data records`,
      summary: `Counting each ${noun} after the header row as one record; ${blank} excluded; ${duplicates} included.`,
      note: `Recorded label and period, not applied by the count: ${unit}, ${period}.`,
      location: sheet ? `From selected worksheet ${sheet}` : "",
      full,
      neutral: false,
    };
  }
  const body = full.replace(/^Derived measurement:\s*/, "");
  if (body === full && !INTERPRETATION_RE.test(full)) {
    return hasTechnicalText(full) ? { ...plain, summary: "", neutral: true } : plain;
  }
  const interpreted = INTERPRETATION_RE.exec(body);
  const label = interpreted ? interpreted[1] : "";
  const note = interpreted ? capitalize(interpreted[2]) : "";
  const result = interpreted ? interpreted[3] : body;
  const paired = PAIRED_BODY_RE.exec(result);
  if (paired) {
    return {
      headline: label, summary: `Baseline to follow-up: ${paired[3]}`, note,
      location: `Numeric outcome ${paired[1]}, ${paired[2]}`, full, neutral: false,
    };
  }
  if (hasTechnicalText(result)) return { headline: label, summary: "", note, location: "", full, neutral: true };
  return { headline: label, summary: capitalize(result), note, location: "", full, neutral: false };
}

// Whether a claim restates its evidence (the same words apart from the
// recorded prefix, case and punctuation): such a claim's wording is not shown
// again; a materially different wording stays available on request.
const comparable = (text) => String(text || "")
  .replace(/^(Derived measurement|Source version record count):\s*/i, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "");
export function claimRestatesFinding(claimText, findingStatement) {
  return comparable(claimText) === comparable(findingStatement);
}

// Keyboard movement within the four-tab list (WAI-ARIA tabs pattern).
export function tabKeyTarget(key, current, keys = KNOWLEDGE_STUDIO_VIEWS.map(([value]) => value)) {
  const index = keys.indexOf(current);
  if (index < 0) return null;
  if (key === "ArrowRight") return keys[(index + 1) % keys.length];
  if (key === "ArrowLeft") return keys[(index - 1 + keys.length) % keys.length];
  if (key === "Home") return keys[0];
  if (key === "End") return keys[keys.length - 1];
  return null;
}

/**
 * The claim -> evidence -> source chain of one claim's traceability read
 * (projectTraceability), as readable rows. Presentation only: every value is
 * a field of that read (or the file name of its source version from the
 * loaded Sources read); no relationship is looked up or inferred, and the raw
 * read stays available in technical details.
 */
const AUDIENCE_GATE_LABELS = Object.freeze({
  internal_only: "Internal use only",
  funder_use_allowed: "Funder use allowed",
  public_use_allowed: "Public use allowed",
  export_ready: "Ready for export",
});
export function audienceGateRows(gates) {
  if (!gates || typeof gates !== "object") return [];
  return Object.entries(AUDIENCE_GATE_LABELS)
    .filter(([key]) => key in gates)
    .map(([key, label]) => ({ key, label, value: gates[key] === true ? "Yes" : gates[key] === false ? "No" : "Not recorded" }));
}
export function traceabilityChain(traceability, { sourceFileName = "" } = {}) {
  if (!traceability) return [];
  const rows = [];
  const claimText = traceability.claim?.statement;
  const evidenceText = traceability.evidence?.statement;
  const restates = Boolean(claimText && evidenceText && claimRestatesFinding(claimText, evidenceText));
  if (claimText) rows.push({ key: "claim", label: restates ? "Claim (restates its evidence)" : "Claim", text: claimText });
  if (evidenceText && !restates) rows.push({ key: "evidence", label: "Evidence", text: evidenceText });
  const current = traceability.sourceVersion?.is_current;
  const versionText = current === true ? "current version" : current === false ? "earlier version (not current)" : "";
  const sourceName = sourceFileName || traceability.source?.source_code || "";
  if (sourceName || versionText) {
    rows.push({ key: "source", label: "Source", text: [sourceName || "Source", versionText].filter(Boolean).join(", ") });
  }
  return rows;
}
