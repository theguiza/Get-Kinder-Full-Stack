// What a saved working report is called, in the organization's words (owner
// direction 2026-11-20): a Free Impact Assessment, a report for its purpose
// (with its version), or its type and audience. Shared by the reports view
// (the label and the download link it offers) and the Markdown route (the
// attachment's file name), so the file a person saves is named as the report
// they opened. `item` is { contentType, audience, report: { isAssessment,
// purpose, version } }.
export const PURPOSE_REPORT_LABELS = Object.freeze({
  internal_planning: "Internal planning report",
  board_update: "Board report",
  funder_report: "Funder report",
  annual_report: "Annual-report content",
});
export const WORKING_REPORT_TYPE_LABELS = Object.freeze({
  "evidence_summary:internal": "Internal evidence summary",
  "evidence_summary:funder": "Funder evidence summary",
  "evidence_summary:public": "Public evidence summary",
  "impact_narrative:internal": "Internal impact narrative",
  "board_update:internal": "Board update",
  "annual_report_section:internal": "Annual-report section",
  "annual_report_section:funder": "Annual-report section",
  "annual_report_section:public": "Annual-report section",
  "funder_outcome_table:funder": "Funder outcome table",
  "case_for_support:internal": "Case for support",
  "case_for_support:funder": "Case for support",
  "grant_response_paragraph:internal": "Grant response",
  "grant_response_paragraph:funder": "Grant response",
  "grant_response_paragraph:public": "Grant response",
});

export function workingReportLabel(item) {
  const context = item?.report || null;
  if (context?.isAssessment) return "Free Impact Assessment";
  const base = (context?.purpose && PURPOSE_REPORT_LABELS[context.purpose])
    || WORKING_REPORT_TYPE_LABELS[`${item?.contentType}:${item?.audience}`]
    || "Saved report";
  return context && context.version > 1 ? `${base} · version ${context.version}` : base;
}

export function workingReportDownloadName(item) {
  const label = workingReportLabel(item).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `kai-${label || "report"}.md`;
}
