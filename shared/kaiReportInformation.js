// Owner direction 2026-11-06 (impact evidence first, draft first): recorded
// sensitivity categories and incomplete review are information shown with a
// provisional internal report. They are never an acknowledgment, a task or an
// approval stage, and they change no permission, eligibility or action.
export const REPORT_INFORMATION_TEXT = Object.freeze({
  personal_information_not_cleared: "A cited source may contain personal information. Keep participant names and direct identifiers out of anything shared outside the organization.",
  minor_information_not_cleared: "A cited source may contain information about minors. Take extra care before sharing details outside the organization.",
  sensitive_information_not_cleared: "A cited source may contain health, housing, justice or immigration information. Share only generalized findings outside the organization.",
  indigenous_governance_not_cleared: "A cited source may contain Indigenous or community-governed information. Follow the community's data governance before sharing it.",
  small_cell_risk_not_cleared: "Some groups in a cited source may be small enough to identify people. Combine or omit small groups before sharing figures outside the organization.",
  cited_claims_not_currently_eligible: "Some findings have open source notes or clarifications. You can use this report and update it as more information becomes available.",
});

export const MINOR_SMALL_CELL_ALERT_CODE = "minor_small_cell_combined";
export const MINOR_SMALL_CELL_ALERT = "Heightened care: a cited source involves minors and may include groups small enough to identify people. Together these raise the chance that a young person could be identified; generalize or omit small-group details before any sharing outside the organization.";

// Reason codes -> ordered { code, message } notes. The combined alert leads
// when both minors and small-cell risk are recorded. Unknown codes are skipped.
export function reportInformationNotes(reasons) {
  const present = new Set(Array.isArray(reasons) ? reasons : []);
  const notes = [];
  if (present.has("minor_information_not_cleared") && present.has("small_cell_risk_not_cleared")) {
    notes.push({ code: MINOR_SMALL_CELL_ALERT_CODE, message: MINOR_SMALL_CELL_ALERT, heightened: true });
  }
  for (const [code, message] of Object.entries(REPORT_INFORMATION_TEXT)) {
    if (present.has(code)) notes.push({ code, message, heightened: false });
  }
  return notes;
}

export const PROVISIONAL_REPORT_STATUS = "Working report. Source references and limitations are included; update it as more information becomes available.";
