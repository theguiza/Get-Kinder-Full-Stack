import React from "react";
import { PROVISIONAL_REPORT_STATUS, reportInformationNotes } from "../shared/kaiReportInformation.js";

// Presentation only (owner direction 2026-11-06): recorded sensitivity
// categories and incomplete review are shown as information. No control,
// acknowledgment or action depends on them.
export default function ReportInformation({ reasons = [] }) {
  const notes = reportInformationNotes(reasons);
  return React.createElement("div", { className: "small my-2", "data-report-information": "" },
    React.createElement("p", { className: "text-muted mb-1", "data-report-provisional-status": "" }, PROVISIONAL_REPORT_STATUS),
    notes.length > 0
      ? React.createElement("ul", { className: "mb-0 ps-3" }, notes.map((note) => React.createElement("li", {
        key: note.code,
        className: note.heightened ? "fw-semibold" : "text-muted",
        "data-report-information-note": note.code,
      }, note.message)))
      : null);
}
