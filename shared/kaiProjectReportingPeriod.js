// The KAI Project target, shared by configuration and measurement. No row filtering is implied.
export function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function projectReportingPeriodState({ engagementId, start, end } = {}) {
  if (!engagementId) return { status: "source_project_unresolved", engagement_id: null, period: null };
  const status = !start && !end ? "not_recorded"
    : isCalendarDate(start) && isCalendarDate(end) && start <= end ? "recorded" : "invalid";
  return {
    status, engagement_id: engagementId,
    period: status === "recorded" ? { start, end, engagementId } : null,
  };
}

export function projectPeriodProblem(state) {
  if (state?.status === "source_project_unresolved") return "KAI cannot resolve this source version to a Project. Entering dates on another Project will not repair its association. Ask your organization administrator to check the source's intake Project.";
  if (state?.status === "invalid") return "This source's KAI Project has an incomplete or invalid reporting period. Correct both dates in the Project reporting period editor.";
  if (state?.status !== "recorded") return "This source's KAI Project has no recorded reporting period. Set both dates in the Project reporting period editor.";
  return null;
}
