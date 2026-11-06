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
 *   technical detail, kept available but never shown as a finding.
 */

export const KNOWLEDGE_STUDIO_VIEWS = Object.freeze([
  ["impact", "Impact"],
  ["evidence", "Evidence"],
  ["sources", "Sources"],
  ["drafts", "Drafts"],
]);
export const DEFAULT_KNOWLEDGE_STUDIO_VIEW = "impact";

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
  technical: "Which columns each source has. Useful for checking a source, not a finding about impact.",
});

export function findingCategory(evidenceType, measurementFamily) {
  if (evidenceType === EVIDENCE_TYPES.structural) return "technical";
  if (evidenceType === EVIDENCE_TYPES.derived) {
    if (measurementFamily === MEASUREMENT_FAMILIES.pairedOutcome) return "outcomes";
    if (measurementFamily === MEASUREMENT_FAMILIES.crossSourceReach) return "reach";
    return "measurements";
  }
  if (evidenceType === EVIDENCE_TYPES.recordCount) return "measurements";
  return "findings";
}

export function findingTypeLabel(evidenceType, measurementFamily) {
  if (evidenceType === EVIDENCE_TYPES.structural) return "Column in a source";
  if (evidenceType === EVIDENCE_TYPES.document) return "From a document";
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
      category: findingCategory(item.evidenceType, item.measurementFamily),
      typeLabel: findingTypeLabel(item.evidenceType, item.measurementFamily),
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
      typeLabel: findingTypeLabel(claim.evidenceType, null),
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
