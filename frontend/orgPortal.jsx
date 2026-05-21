import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { CreateEvent } from "./events/views/CreateEvent.jsx";
import { InviteModal } from "./events/components/InviteModal.jsx";
import { PoolLedgerModal } from "./events/components/PoolLedgerModal.jsx";

const ROOTS = new WeakMap();
const KPI_REFRESH_EVENT = "orgportal:kpis:refresh";

const TABS = [
  { key: "opportunities", label: "Opportunities" },
  { key: "schedule", label: "Schedule" },
  { key: "checkin", label: "Check-in & Check-Out" },
  { key: "credits", label: "Reconcile" },
  { key: "comms", label: "Comms" },
  { key: "myevents", label: "Funding & Events" },
  { key: "programsProjects", label: "Programs & Projects" },
  { key: "reports", label: "Reports" },
];

const KPI_CARDS = [
  { key: "totalHours", label: "Total Hours", icon: "fa-clock" },
  { key: "fillRate", label: "Fill Rate", icon: "fa-bullseye" },
  { key: "impactCredits", label: "Impacts Credits Avail", icon: "fa-coins" },
  { key: "noShowRate", label: "No-Show Rate", icon: "fa-user-slash" },
];
const MY_EVENTS_ZERO_SUMMARY = {
  events_count: 0,
  funded_credits_total: 0,
  deficit_credits_total: 0,
  pool_credits_remaining: 0,
};
const MY_EVENTS_STATUS_BADGE = {
  draft: "Draft",
  published: "Published",
  cancelled: "Cancelled",
  completed: "Completed",
};
const PROGRAM_STATUS_LABELS = {
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};
const PROJECT_LIFECYCLE_STAGES = ["draft", "recruiting", "live", "closing_out", "reported"];
const PROJECT_LIFECYCLE_LABELS = {
  draft: "Draft",
  recruiting: "Recruiting",
  live: "Live",
  closing_out: "Closing out",
  reported: "Reported",
};
const PROGRAM_EQUITY_GROUPS = [
  "women & girls",
  "Indigenous peoples",
  "racialized communities",
  "persons with disabilities",
  "2SLGBTQI+",
  "newcomers",
  "low-income",
];
const PROJECT_LANGUAGE_OPTIONS = ["English", "French", "Other"];
const PROGRAM_FORM_EMPTY = {
  name: "",
  description: "",
  funder: "",
  reportingPeriodStart: "",
  reportingPeriodEnd: "",
  intendedEquityGroups: [],
};
const PROJECT_FORM_EMPTY = {
  name: "",
  programId: "",
  description: "",
  startDate: "",
  endDate: "",
  languages: [],
  partnerOrgNames: "",
};
const ZERO_PENDING_ACTION_COUNTS = Object.freeze({
  pendingJoinCount: 0,
  pendingVerifyCount: 0,
  pendingActionsCount: 0,
  approvedCount: 0,
  checkedInCount: 0,
  totalCount: 0,
});

function getCommsTemplate(itemType) {
  if (itemType === "thankyou" || itemType === "comms-thankyou") {
    return `Subject: Thank you for showing up for [Food Drive]!

Hi [First Name],

Thank you for volunteering [X] hrs at [Food Drive] on [Date].
Your [X] impact credits have been added to your wallet.

We couldn't do it without you. Hope to see you again soon!

- The GetKinder Team`;
  }

  if (itemType === "reminder" || itemType === "comms-reminder") {
    return `Subject: Your shift at [Tutoring] is tomorrow!

Hi [First Name],

Just a reminder that your volunteer shift at [Tutoring]
is on [Date] at [Time].

Please arrive a few minutes early. See you there!

- The GetKinder Team`;
  }

  return `Subject: How did it go at [Book Drive]?

Hi [First Name],

Thank you for volunteering at [Book Drive] on [Date].
We'd love to hear how it went!

[Leave Feedback ->] (link placeholder)

- The GetKinder Team`;
}

function resolveCommsPreview(templateBody, commsItem, selectedRecipientName) {
  if (!templateBody) return "";
  const firstName = (selectedRecipientName || "Volunteer").split(/\s+/)[0] || "Volunteer";
  const opportunityName = commsItem?.opportunityName || "Opportunity";
  const opportunityDate = commsItem?.opportunityDate || "Date";
  const opportunityTime = commsItem?.opportunityTime || "Time";

  let preview = templateBody
    .replace(/\[First Name\]/g, firstName)
    .replace(/\[(Food Drive|Tutoring|Book Drive)\]/g, opportunityName)
    .replace(/\[Date\]/g, opportunityDate)
    .replace(/\[Time\]/g, opportunityTime);

  let replacementIndex = 0;
  const replacementValues = ["3", "6"];
  preview = preview.replace(/\[X\]/g, () => {
    const value = replacementValues[Math.min(replacementIndex, replacementValues.length - 1)];
    replacementIndex += 1;
    return value;
  });

  return preview;
}

function parseCommsEditorValue(editorValue) {
  const raw = String(editorValue || "").replace(/\r\n/g, "\n");
  const subjectMatch = raw.match(/^Subject:\s*(.+)\n?/i);
  if (!subjectMatch) {
    return { subject: "Get Kinder update", body: raw };
  }
  const subject = String(subjectMatch[1] || "").trim() || "Get Kinder update";
  const body = raw.replace(/^Subject:\s*.+\n?/i, "").trimStart();
  return { subject, body };
}

function toHourDeltaText(targetIso, mode) {
  const dt = targetIso ? new Date(targetIso) : null;
  if (!dt || Number.isNaN(dt.getTime())) return mode === "past" ? "0 hrs ago" : "0 hrs";
  const deltaHours = Math.max(0, Math.round(Math.abs(dt.getTime() - Date.now()) / (1000 * 60 * 60)));
  if (mode === "past") return `${deltaHours} hrs ago`;
  return `${deltaHours} hrs`;
}

function titleCaseCommsType(typeValue) {
  const normalized = String(typeValue || "").toLowerCase();
  if (normalized === "thankyou") return "Thank-You";
  if (normalized === "feedback") return "Feedback";
  return "Reminder";
}

function toDateInputValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function formatProgramProjectDate(value) {
  if (!value) return "";
  const input = typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? `${value.slice(0, 10)}T00:00:00`
    : value;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatProjectDateRange(project) {
  const start = formatProgramProjectDate(project?.start_date);
  const end = formatProgramProjectDate(project?.end_date);
  if (start && end) return `${start} - ${end}`;
  if (start) return `${start} - No end date`;
  if (end) return `Until ${end}`;
  return "No dates set";
}

function pluralizeProgramProject(count, singular, plural = `${singular}s`) {
  const total = safeNumber(count, 0);
  return `${total} ${total === 1 ? singular : plural}`;
}

function programToForm(program) {
  return {
    name: program?.name || "",
    description: program?.description || "",
    funder: program?.funder || "",
    reportingPeriodStart: toDateInputValue(program?.reporting_period_start),
    reportingPeriodEnd: toDateInputValue(program?.reporting_period_end),
    intendedEquityGroups: Array.isArray(program?.intended_equity_groups) ? program.intended_equity_groups : [],
  };
}

function projectToForm(project) {
  return {
    name: project?.name || "",
    programId: project?.program_id || "",
    description: project?.description || "",
    startDate: toDateInputValue(project?.start_date),
    endDate: toDateInputValue(project?.end_date),
    languages: Array.isArray(project?.languages) ? project.languages : [],
    partnerOrgNames: "",
  };
}

async function parseOrgPortalApiError(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  return payload?.message || payload?.error || fallback;
}

function formatEventDateRange(startIso, endIso) {
  if (!startIso) return "Date TBD";
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "Date TBD";
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (!endIso) return startLabel;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return startLabel;
  const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (startLabel === endLabel) return startLabel;
  return `${startLabel} – ${endLabel}`;
}

function formatDaysAway(startIso) {
  if (!startIso) return "";
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "";
  const diffMs = start.getTime() - Date.now();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    const ago = Math.abs(diffDays);
    return ago === 0 ? "Today" : `${ago}d ago`;
  }
  if (diffDays === 0) return "Today";
  return `${diffDays}d away`;
}

function fillBarClass(pct, capacity) {
  if (!capacity) return "";
  if (pct >= 100) return "full";
  if (pct < 30) return "urgent";
  return "";
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseSdgGoalNumber(goalLabel) {
  if (!goalLabel || typeof goalLabel !== "string") return "";
  return String(goalLabel).split(/\s*[-–—]\s*/)[0].trim();
}

function normalizePendingActionCounts(rawCounts) {
  return {
    pendingJoinCount: safeNumber(
      rawCounts?.pendingJoinCount ?? rawCounts?.pending_join_count,
      0
    ),
    pendingVerifyCount: safeNumber(
      rawCounts?.pendingVerifyCount ?? rawCounts?.pending_verify_count,
      0
    ),
    pendingActionsCount: safeNumber(
      rawCounts?.pendingActionsCount ?? rawCounts?.pending_actions_count,
      0
    ),
    approvedCount: safeNumber(rawCounts?.approvedCount ?? rawCounts?.approved_count, 0),
    checkedInCount: safeNumber(rawCounts?.checkedInCount ?? rawCounts?.checked_in_count, 0),
    totalCount: safeNumber(rawCounts?.totalCount ?? rawCounts?.total_count, 0),
  };
}

function formatShortDate(iso) {
  if (!iso) return "Date TBD";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "Date TBD";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildReportFallbackLabels(rangeDays) {
  const days = Math.max(1, safeNumber(rangeDays, 30));
  const end = new Date();
  end.setHours(0, 0, 0, 0);

  return Array.from({ length: days }, (_, index) => {
    const dt = new Date(end);
    dt.setDate(end.getDate() - (days - 1 - index));
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });
}

function formatTime(iso) {
  if (!iso) return "Time TBD";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "Time TBD";
  return dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatDateTimeInZone(isoValue, timeZone, opts = {}) {
  if (!isoValue) return "Date TBD";
  const dt = new Date(isoValue);
  if (Number.isNaN(dt.getTime())) return "Date TBD";
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
    ...opts,
  });
  return formatter.format(dt);
}

function formatTimeInZone(isoValue, timeZone) {
  if (!isoValue) return "Time TBD";
  const dt = new Date(isoValue);
  if (Number.isNaN(dt.getTime())) return "Time TBD";
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
  return formatter.format(dt);
}

function formatEventDateTime(startIso, endIso, eventTz) {
  if (!startIso) return "Date TBD";
  const savedTimeZone = String(eventTz || "America/Vancouver");
  const eventStart = formatDateTimeInZone(startIso, savedTimeZone);
  const hasEnd = Boolean(endIso && !Number.isNaN(new Date(endIso).getTime()));
  const eventEnd = hasEnd ? formatTimeInZone(endIso, savedTimeZone) : "Time TBD";
  return `${eventStart} - ${eventEnd} (${savedTimeZone})`;
}

function hasDisplayText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function formatCommsDate(iso) {
  if (!iso) return "Date TBD";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "Date TBD";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatScheduleLine(opportunity) {
  const dateLabel = formatShortDate(opportunity.startAt);
  const timeLabel = formatTime(opportunity.startAt);
  return `${dateLabel} - ${timeLabel} - ${opportunity.locationText || "Location TBD"}`;
}

const SCHEDULE_PROBLEM_LABELS = {
  open_capacity: "Open capacity",
  pending_approvals: "Pending approvals",
  no_shows: "No-shows",
  pending_verification: "Pending verification",
  missing_location: "Missing location",
  missing_start_time: "Missing start time",
  missing_capacity: "Missing capacity",
};

function formatScheduleYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getScheduleTodayYmd() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return formatScheduleYmd(today);
}

function addDaysToScheduleYmd(ymd, days) {
  const [year, month, day] = String(ymd || getScheduleTodayYmd()).split("-").map((part) => Number(part));
  const dt = new Date(year, month - 1, day);
  if (Number.isNaN(dt.getTime())) return getScheduleTodayYmd();
  dt.setDate(dt.getDate() + days);
  return formatScheduleYmd(dt);
}

function buildScheduleWeekRange(startYmd) {
  const start = startYmd || getScheduleTodayYmd();
  return {
    start,
    end: addDaysToScheduleYmd(start, 7),
    endExclusive: true,
  };
}

function fillPercent(approvedCount, capacity) {
  const approved = safeNumber(approvedCount, 0);
  const cap = safeNumber(capacity, 0);
  if (!cap || cap <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((approved / cap) * 100)));
}

function formatScheduleDateLabel(dateValue) {
  if (!dateValue) return "Date not set";
  const dt = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return String(dateValue);
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatScheduleRangeLabel(range) {
  if (!range?.start || !range?.end) return "Next 7 days";
  if (!range.endExclusive) {
    return `${formatScheduleDateLabel(range.start)} - ${formatScheduleDateLabel(range.end)}`;
  }
  const inclusiveEnd = addDaysToScheduleYmd(range.end, -1);
  return `${formatScheduleDateLabel(range.start)} - ${formatScheduleDateLabel(inclusiveEnd)} (end exclusive ${formatScheduleDateLabel(range.end)})`;
}

function formatScheduleTimeRange(startAt, endAt, eventTz) {
  if (!startAt) return "Time not set";
  const startLabel = eventTz ? formatTimeInZone(startAt, eventTz) : formatTime(startAt);
  const endLabel = endAt ? (eventTz ? formatTimeInZone(endAt, eventTz) : formatTime(endAt)) : "Time TBD";
  return `${startLabel} - ${endLabel}`;
}

function formatScheduleCount(value, fallback = "0") {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return String(num);
}

function formatScheduleCapacity(capacity) {
  return capacity == null ? "No cap" : formatScheduleCount(capacity);
}

function formatScheduleOpenSpots(openSpots) {
  return openSpots == null ? "—" : formatScheduleCount(openSpots);
}

function formatCheckinTime(isoValue) {
  if (!isoValue) return "—";
  const dt = new Date(isoValue);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function isSameCalendarDay(isoValue, now = new Date()) {
  if (!isoValue) return false;
  const dt = new Date(isoValue);
  if (Number.isNaN(dt.getTime())) return false;
  return (
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate()
  );
}

function pendingLabel(opportunity) {
  const pendingCount = safeNumber(opportunity?.pendingCount, 0);
  return pendingCount > 0
    ? `${opportunity.name} - ${opportunity.shortDate} - ${pendingCount} pending approvals`
    : `${opportunity.name} - ${opportunity.shortDate}`;
}

function upcomingLabel(opportunity) {
  const cap = opportunity.capacity || 0;
  return `${opportunity.name} - ${opportunity.shortDate} - ${opportunity.approvedCount} / ${cap} spots`;
}

function activeLabel(opportunity) {
  const activeCount = Math.max(opportunity.checkedInCount || 0, opportunity.approvedCount || 0);
  return `${opportunity.name} - ${activeCount} active volunteers`;
}

function completedLabel(opportunity) {
  return `${opportunity.name} - ${opportunity.shortDate}`;
}

function isPast(startAt) {
  if (!startAt) return false;
  const dt = new Date(startAt);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getTime() < Date.now();
}

function isFuture(startAt) {
  if (!startAt) return false;
  const dt = new Date(startAt);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getTime() > Date.now();
}

function daysUntil(startAt) {
  if (!startAt) return Number.POSITIVE_INFINITY;
  const dt = new Date(startAt);
  if (Number.isNaN(dt.getTime())) return Number.POSITIVE_INFINITY;
  return (dt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
}

function ratingFromPast(pastShifts) {
  const shifts = safeNumber(pastShifts, 0);
  const stars = Math.max(1, Math.min(5, Math.round(3 + shifts / 3)));
  return "★★★★★".slice(0, stars) + "☆☆☆☆☆".slice(0, 5 - stars);
}

function normalizeOpportunity(row) {
  const id = String(row?.id || "").trim();
  return {
    id,
    name: row?.title || "Untitled opportunity",
    startAt: row?.start_at || null,
    endAt: row?.end_at || null,
    status: row?.status || "published",
    shortDate: formatShortDate(row?.start_at),
    locationText: "Location TBD",
    pendingCount: safeNumber(row?.pending, 0),
    approvedCount: safeNumber(row?.approved, 0),
    checkedInCount: safeNumber(row?.checked_in, 0),
    totalCount: safeNumber(row?.total, 0),
    capacity: row?.capacity == null ? null : safeNumber(row.capacity, null),
    creditsPerHour: 2,
    estimatedHours: Math.max(0, safeNumber(row?.approved, 0) * 2),
    funderPool: "General Community Pool",
  };
}

function normalizeQueuePayload(payload) {
  return {
    needsAttention: Array.isArray(payload?.needsAttention) ? payload.needsAttention : [],
    upcoming: Array.isArray(payload?.upcoming) ? payload.upcoming : [],
    active: Array.isArray(payload?.active) ? payload.active : [],
    drafts: Array.isArray(payload?.drafts) ? payload.drafts : [],
    completed: Array.isArray(payload?.completed) ? payload.completed : [],
    cancelled: Array.isArray(payload?.cancelled) ? payload.cancelled : [],
    hasOpportunities: Boolean(payload?.hasOpportunities),
  };
}

function LoadingSpinner({ text = "Loading..." }) {
  return (
    <div className="d-flex align-items-center gap-2 text-muted">
      <div className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></div>
      <span>{text}</span>
    </div>
  );
}

function EmptySelectionDetail() {
  return (
    <div className="orgp-empty-detail">
      <i className="fas fa-hand-pointer" aria-hidden="true"></i>
      <p className="mb-0">Select an item from the queue</p>
    </div>
  );
}

function Phase2Placeholder({ compact = false }) {
  return (
    <div className={`orgp-phase2 ${compact ? "orgp-phase2-compact" : ""}`}>
      <i className="fas fa-hard-hat" aria-hidden="true"></i>
      <p className="mb-0">Coming in Phase 2</p>
    </div>
  );
}

function OpportunitiesEmptyLeft({ onCreateClick }) {
  return (
    <div className="orgp-empty-panel">
      <i className="fas fa-clipboard" aria-hidden="true"></i>
      <div className="orgp-empty-title">No opportunities yet.</div>
      <div className="orgp-empty-sub">Post your first one to start coordinating volunteers.</div>
      <button type="button" className="btn orgp-btn-coral w-100" onClick={onCreateClick}>+ New Opportunity</button>
    </div>
  );
}

function OpportunitiesEmptyRight({ onCreateClick }) {
  return (
    <div className="orgp-empty-detail orgp-empty-detail-lg">
      <i className="fas fa-clipboard-list" aria-hidden="true"></i>
      <h3 className="orgp-detail-heading mb-1">No opportunities posted yet.</h3>
      <p className="text-muted mb-2 text-center">
        When you create an opportunity, applicants, check-ins, and credits will all appear here.
      </p>
      <button type="button" className="btn orgp-btn-coral" onClick={onCreateClick}>+ Post Your First Opportunity</button>
    </div>
  );
}

function CheckinEmptyDetail() {
  return (
    <div className="orgp-empty-detail orgp-empty-detail-lg">
      <i className="fas fa-qrcode" aria-hidden="true"></i>
      <h3 className="orgp-detail-heading mb-1">Select a shift from the queue</h3>
      <p className="text-muted mb-0">The QR code and live roster will appear here.</p>
    </div>
  );
}

function CreditsEmptyDetail() {
  return (
    <div className="orgp-empty-detail orgp-empty-detail-lg">
      <i className="fas fa-coins" aria-hidden="true"></i>
      <h3 className="orgp-detail-heading mb-1">Select an opportunity or volunteer</h3>
      <p className="text-muted mb-0">Credits earned and funder attribution will appear here.</p>
    </div>
  );
}

function KpiValue({ cardKey, kpis, kpisLoading }) {
  if (kpisLoading) {
    return (
      <>
        <div className="org-kpi-value">
          <span className="spinner-border spinner-border-sm" role="status" aria-label="Loading"></span>
        </div>
        <div className="org-kpi-sub">&nbsp;</div>
      </>
    );
  }

  if (!kpis) {
    return (
      <>
        <div className="org-kpi-value">—</div>
        <div className="org-kpi-sub">unavailable</div>
      </>
    );
  }

  if (cardKey === "totalHours") {
    const value = safeNumber(kpis.totalHours, 0);
    const change = safeNumber(kpis.totalHoursChange, 0);
    return (
      <>
        <div className="org-kpi-value">{value === 0 ? "0" : `${value} hrs`}</div>
        <div className="org-kpi-sub">
          {change >= 0 ? `↑ +${change} this week` : `↓ ${change} this week`}
        </div>
      </>
    );
  }

  if (cardKey === "fillRate") {
    const value = safeNumber(kpis.fillRate, 0);
    const change = safeNumber(kpis.fillRateChange, 0);
    return (
      <>
        <div className="org-kpi-value">{`${value}%`}</div>
        <div className="org-kpi-sub">
          {change >= 0 ? `↑ +${change}% vs last period` : `↓ ${change}% vs last period`}
        </div>
      </>
    );
  }

  if (cardKey === "impactCredits") {
    const value = safeNumber(kpis.impactCredits, 0);
    return (
      <>
        <div className="org-kpi-value">{value}</div>
        <div className="org-kpi-sub">{`$${(value * 0.5).toFixed(0)} est. value`}</div>
      </>
    );
  }

  const value = safeNumber(kpis.noShowRate, 0);
  return (
    <>
      <div className="org-kpi-value">{`${value}%`}</div>
      <div className="org-kpi-sub">{value <= 10 ? "↓ Looking good 👍" : "↑ Review needed"}</div>
    </>
  );
}

function OrgPortalKpiStrip() {
  const [kpis, setKpis] = useState(null);
  const [kpisLoading, setKpisLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadKpis = () => {
      setKpisLoading(true);
      fetch("/api/org/kpis", { credentials: "include" })
        .then((res) => {
          if (!res.ok) throw new Error("kpi_failed");
          return res.json();
        })
        .then((data) => {
          if (!mounted) return;
          setKpis(data || {});
          setKpisLoading(false);
        })
        .catch(() => {
          if (!mounted) return;
          setKpis(null);
          setKpisLoading(false);
        });
    };

    const handleRefresh = () => loadKpis();
    window.addEventListener(KPI_REFRESH_EVENT, handleRefresh);
    loadKpis();

    return () => {
      mounted = false;
      window.removeEventListener(KPI_REFRESH_EVENT, handleRefresh);
    };
  }, []);

  return (
    <section className="mb-3" aria-label="Organization KPIs (React)">
      <div className="row g-3">
        {KPI_CARDS.map((card) => (
          <div className="col-12 col-md-6" key={card.key}>
            <div className="card org-kpi-card h-100">
              <div className="card-body">
                <div className="org-kpi-label">
                  <i className={`fas ${card.icon} org-kpi-icon`} aria-hidden="true"></i>
                  <span>{card.label}</span>
                </div>
                <KpiValue cardKey={card.key} kpis={kpis} kpisLoading={kpisLoading} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function OrgPortal({ csrfToken = "", userId = "", orgName = "" }) {
  const [activeTab, setActiveTab] = useState("opportunities");
  const [selectedQueueItem, setSelectedQueueItem] = useState(null);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [cancelledExpanded, setCancelledExpanded] = useState(false);

  const [queue, setQueue] = useState(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState(false);
  const [scheduleData, setScheduleData] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleRangeOverride, setScheduleRangeOverride] = useState(null);
  const [myEventsPoolSummary, setMyEventsPoolSummary] = useState(null);
  const [myEventsPoolLoading, setMyEventsPoolLoading] = useState(false);
  const [myEvents, setMyEvents] = useState([]);
  const [myEventsLoading, setMyEventsLoading] = useState(false);
  const [myEventsSubTab, setMyEventsSubTab] = useState("upcoming");
  const [myEventsPoolFilter, setMyEventsPoolFilter] = useState("");
  const [selectedMyEvent, setSelectedMyEvent] = useState(null);
  const [myEventsLedgerPreview, setMyEventsLedgerPreview] = useState([]);
  const [myEventsLedgerOpen, setMyEventsLedgerOpen] = useState(false);
  const [myEventsInviteModal, setMyEventsInviteModal] = useState({ open: false, event: null });
  const [myEventsToast, setMyEventsToast] = useState(null);
  const [eventsListFilter, setEventsListFilter] = useState({ status: "all", projectId: "all" });
  const [eventsListData, setEventsListData] = useState(null);
  const [eventsListLoading, setEventsListLoading] = useState(false);
  const [workspaceSubNav, setWorkspaceSubNav] = useState("overview");
  const CLOSEOUT_EMPTY = {
    step: 1,
    beneficiaryCount: "",
    confidence: "Estimated",
    equityRows: [
      { group: "women & girls", checked: false, pct: "" },
      { group: "Indigenous peoples", checked: false, pct: "" },
      { group: "racialized communities", checked: false, pct: "" },
      { group: "persons with disabilities", checked: false, pct: "" },
      { group: "2SLGBTQI+", checked: false, pct: "" },
      { group: "newcomers", checked: false, pct: "" },
      { group: "low-income", checked: false, pct: "" },
    ],
    methodology: "",
    saving: false,
    error: "",
  };
  const [closeoutModal, setCloseoutModal] = useState({ open: false, ...CLOSEOUT_EMPTY });
  const [programs, setPrograms] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectMetricsById, setProjectMetricsById] = useState({});
  const [programsProjectsLoading, setProgramsProjectsLoading] = useState(false);
  const [programsProjectsError, setProgramsProjectsError] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [programFormModal, setProgramFormModal] = useState({ open: false, mode: "create", program: null, values: PROGRAM_FORM_EMPTY, error: "", saving: false });
  const [projectFormModal, setProjectFormModal] = useState({ open: false, mode: "create", project: null, values: PROJECT_FORM_EMPTY, error: "", saving: false });
  const [programsProjectsToast, setProgramsProjectsToast] = useState(null);
  const [programsProjectsConfirm, setProgramsProjectsConfirm] = useState({ open: false, type: "", item: null, error: "", saving: false });
  const [projectLifecycleModal, setProjectLifecycleModal] = useState({ open: false, project: null, error: "", savingStage: "" });
  const [programMenuId, setProgramMenuId] = useState("");
  const [projectMenuId, setProjectMenuId] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingOpportunityId, setEditingOpportunityId] = useState(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [cancelModalTarget, setCancelModalTarget] = useState(null);
  const [forceCancelMode, setForceCancelMode] = useState(false);
  const [forceCancelConfirmed, setForceCancelConfirmed] = useState(false);

  const [applicants, setApplicants] = useState(null);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [actionLoadingByUser, setActionLoadingByUser] = useState({});
  const [approveAllLoading, setApproveAllLoading] = useState(false);
  const [approveAllProgress, setApproveAllProgress] = useState({ current: 0, total: 0 });
  const [actionError, setActionError] = useState("");
  const [opportunityInviteModal, setOpportunityInviteModal] = useState({
    open: false,
    email: "",
    name: "",
    sending: false,
    error: "",
  });
  const [adminSignupModal, setAdminSignupModal] = useState({
    open: false,
    name: "",
    email: "",
    sendEmail: true,
    sending: false,
    error: null,
  });
  const [opportunityInviteNotice, setOpportunityInviteNotice] = useState(null);
  const [applicantCounts, setApplicantCounts] = useState(ZERO_PENDING_ACTION_COUNTS);
  const [selectedOpportunityDetail, setSelectedOpportunityDetail] = useState(null);
  const [selectedOpportunityDetailLoading, setSelectedOpportunityDetailLoading] = useState(false);
  const [selectedOpportunityDetailError, setSelectedOpportunityDetailError] = useState("");
  const [applicantProfileModal, setApplicantProfileModal] = useState({ open: false, applicant: null });
  const [approvedDeclineModal, setApprovedDeclineModal] = useState({ open: false, applicant: null });
  const [approveAllConfirmOpen, setApproveAllConfirmOpen] = useState(false);

  const [checkinQueueItems, setCheckinQueueItems] = useState([]);
  const [checkinQueueLoading, setCheckinQueueLoading] = useState(false);
  const [checkinQueueError, setCheckinQueueError] = useState(false);
  const [roster, setRoster] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState(false);
  const [markPresentByUser, setMarkPresentByUser] = useState({});
  const [noShowByUser, setNoShowByUser] = useState({});
  const [verifyAttendanceByUser, setVerifyAttendanceByUser] = useState({});
  const [rateVolunteerByUser, setRateVolunteerByUser] = useState({});
  const [verifyAllAttendanceLoading, setVerifyAllAttendanceLoading] = useState(false);
  const [creditsQueue, setCreditsQueue] = useState(null);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [creditDetail, setCreditDetail] = useState(null);
  const [creditDetailLoading, setCreditDetailLoading] = useState(false);
  const [creditsVerifyAllLoading, setCreditsVerifyAllLoading] = useState(false);
  const [creditsActionError, setCreditsActionError] = useState("");
  const [reportData, setReportData] = useState(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportFilters, setReportFilters] = useState({
    range: 30,
    opportunityId: "all",
    volunteerId: "all",
  });

  const hoursChartCanvasRef = useRef(null);
  const fillRateChartCanvasRef = useRef(null);
  const noShowChartCanvasRef = useRef(null);
  const impactChartCanvasRef = useRef(null);
  const hoursChartRef = useRef(null);
  const fillRateChartRef = useRef(null);
  const noShowChartRef = useRef(null);
  const impactChartRef = useRef(null);
  const commsConfirmModalRef = useRef(null);
  const commsConfirmModalInstanceRef = useRef(null);
  const commsToastRef = useRef(null);
  const commsToastInstanceRef = useRef(null);
  const detailPanelRef = useRef(null);
  const opportunityDetailTopRef = useRef(null);
  const pendingScheduleNavigationRef = useRef(null);
  const scheduleRequestIdRef = useRef(0);

  const [commsQueue, setCommsQueue] = useState(null);
  const [commsLoading, setCommsLoading] = useState(false);
  const [commsError, setCommsError] = useState("");
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [commsRecipients, setCommsRecipients] = useState([]);
  const [commsRecipientsLoading, setCommsRecipientsLoading] = useState(false);
  const [commsActionError, setCommsActionError] = useState("");
  const [selectedRecipientIds, setSelectedRecipientIds] = useState([]);
  const [selectedCommsItemId, setSelectedCommsItemId] = useState(null);
  const [messageBody, setMessageBody] = useState("");
  const [messageBodyByItem, setMessageBodyByItem] = useState({});
  const [selectedRecipient, setSelectedRecipient] = useState("");
  const [selectedChannel, setSelectedChannel] = useState("email");
  const [recipientEditorOpen, setRecipientEditorOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [pendingDetailScroll, setPendingDetailScroll] = useState(null);

  const fetchQueue = useCallback(() => {
    setQueueLoading(true);
    setQueueError(false);
    return fetch("/api/org/queue", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("queue_failed");
        return res.json();
      })
      .then((data) => {
        setQueue(normalizeQueuePayload(data));
        setQueueLoading(false);
      })
      .catch(() => {
        setQueueError(true);
        setQueue(null);
        setQueueLoading(false);
      });
  }, []);

  const fetchSchedule = useCallback(async () => {
    const requestId = scheduleRequestIdRef.current + 1;
    scheduleRequestIdRef.current = requestId;
    setScheduleLoading(true);
    setScheduleError("");

    try {
      const params = new URLSearchParams();
      if (scheduleRangeOverride?.start && scheduleRangeOverride?.end) {
        params.set("start", scheduleRangeOverride.start);
        params.set("end", scheduleRangeOverride.end);
      }
      const query = params.toString();
      const response = await fetch(`/api/org/schedule${query ? `?${query}` : ""}`, { credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "schedule_failed");
      }
      if (requestId !== scheduleRequestIdRef.current) return;
      setScheduleData(payload);
    } catch (_) {
      if (requestId !== scheduleRequestIdRef.current) return;
      setScheduleData(null);
      setScheduleError("Could not load schedule. Please refresh.");
    } finally {
      if (requestId === scheduleRequestIdRef.current) {
        setScheduleLoading(false);
      }
    }
  }, [scheduleRangeOverride?.end, scheduleRangeOverride?.start]);

  const myEventsSummary = useMemo(() => {
    const totals = myEventsPoolSummary?.totals || {};
    return {
      ...MY_EVENTS_ZERO_SUMMARY,
      ...totals,
    };
  }, [myEventsPoolSummary]);

  const myEventsPoolOptions = useMemo(() => {
    const slugs = Array.isArray(myEventsPoolSummary?.pools)
      ? myEventsPoolSummary.pools
          .map((row) => String(row?.funding_pool_slug || "").trim())
          .filter(Boolean)
      : [];
    return Array.from(new Set(slugs)).sort((a, b) => a.localeCompare(b));
  }, [myEventsPoolSummary]);

  const fetchMyEventsPoolSummary = useCallback(async () => {
    setMyEventsPoolLoading(true);
    try {
      const response = await fetch("/api/me/events/pools/summary", { credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to load pool summary");
      }
      setMyEventsPoolSummary(payload?.data || { pools: [], totals: { ...MY_EVENTS_ZERO_SUMMARY } });
    } catch {
      setMyEventsPoolSummary({ pools: [], totals: { ...MY_EVENTS_ZERO_SUMMARY } });
    } finally {
      setMyEventsPoolLoading(false);
    }
  }, []);

  const fetchMyEvents = useCallback(async () => {
    setMyEventsLoading(true);
    try {
      const params = new URLSearchParams({
        tab: myEventsSubTab,
        limit: "20",
        offset: "0",
      });
      if (myEventsPoolFilter) {
        params.set("funding_pool_slug", myEventsPoolFilter);
      }

      const response = await fetch(`/api/me/events?${params.toString()}`, { credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to load events");
      }
      setMyEvents(Array.isArray(payload?.data) ? payload.data : []);
    } catch {
      setMyEvents([]);
    } finally {
      setMyEventsLoading(false);
    }
  }, [myEventsPoolFilter, myEventsSubTab]);

  const fetchMyEventsLedgerPreview = useCallback(async (poolSlug) => {
    if (!poolSlug) {
      setMyEventsLedgerPreview([]);
      return;
    }
    try {
      const params = new URLSearchParams({
        pool_slug: poolSlug,
        limit: "3",
        offset: "0",
      });
      const response = await fetch(`/api/me/events/pools/transactions?${params.toString()}`, {
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to load ledger preview");
      }
      setMyEventsLedgerPreview(Array.isArray(payload?.data?.items) ? payload.data.items : []);
    } catch {
      setMyEventsLedgerPreview([]);
    }
  }, []);

  const fetchCreditsQueue = useCallback(async () => {
    setCreditsLoading(true);
    setCreditsActionError("");

    try {
      const tabs = ["upcoming", "past", "drafts"];
      const responses = await Promise.all(
        tabs.map(async (tab) => {
          const params = new URLSearchParams({
            tab,
            limit: "200",
            offset: "0",
          });
          const res = await fetch(`/api/me/events?${params.toString()}`, { credentials: "include" });
          const payload = await res.json().catch(() => ({}));
          if (!res.ok || !payload?.ok) return [];
          return Array.isArray(payload.data) ? payload.data : [];
        })
      );

      const byId = new Map();
      responses.flat().forEach((row) => {
        const eventId = String(row?.id || "").trim();
        if (!eventId) return;
        byId.set(eventId, row);
      });

      const fundingRows = [...byId.values()]
        .map((row) => ({
          id: String(row.id),
          title: row.title || "Untitled event",
          start_at: row.start_at || null,
          volunteer_count: safeNumber(row?.rsvp_counts?.accepted, 0),
          verified_credits_total: safeNumber(row?.verified_credits_total, 0),
          funded_credits_total: safeNumber(row?.funded_credits_total, 0),
          deficit_credits_total: safeNumber(row?.deficit_credits_total, 0),
          funding_pool_slug: row?.funding_pool_slug || "general",
        }))
        .filter((row) => row.verified_credits_total > 0)
        .sort((a, b) => {
          const aTs = Date.parse(a.start_at || "");
          const bTs = Date.parse(b.start_at || "");
          const aValid = Number.isFinite(aTs);
          const bValid = Number.isFinite(bTs);
          if (!aValid && !bValid) return 0;
          if (!aValid) return 1;
          if (!bValid) return -1;
          return bTs - aTs;
        });

      let volunteerSummary = [];
      try {
        const creditsRes = await fetch("/api/org/credits", { credentials: "include" });
        const creditsPayload = await creditsRes.json().catch(() => ({}));
        if (creditsRes.ok && Array.isArray(creditsPayload?.volunteerSummary)) {
          volunteerSummary = creditsPayload.volunteerSummary;
        }
      } catch {}

      setCreditsQueue({
        pendingReconcile: fundingRows.filter((row) => row.deficit_credits_total > 0),
        reconciled: fundingRows.filter((row) => row.deficit_credits_total <= 0),
        volunteerSummary,
      });
      setCreditsLoading(false);
    } catch (_) {
      setCreditsQueue({ pendingReconcile: [], reconciled: [], volunteerSummary: [] });
      setCreditsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  useEffect(() => {
    if (activeTab !== "opportunities") return;
    setEventsListLoading(true);
    fetch("/api/org/opportunities", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("opportunities_failed");
        return res.json();
      })
      .then((data) => {
        setEventsListData(Array.isArray(data) ? data : []);
        setEventsListLoading(false);
      })
      .catch(() => {
        setEventsListData([]);
        setEventsListLoading(false);
      });
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "myevents") return;
    fetchMyEventsPoolSummary();
  }, [activeTab, fetchMyEventsPoolSummary]);

  useEffect(() => {
    if (activeTab !== "myevents") return;
    fetchMyEvents();
  }, [activeTab, myEventsSubTab, myEventsPoolFilter, fetchMyEvents]);

  useEffect(() => {
    if (activeTab !== "myevents" || !selectedMyEvent?.id) {
      setMyEventsLedgerPreview([]);
      return;
    }
    const poolSlug = selectedMyEvent.funding_pool_slug || "general";
    fetchMyEventsLedgerPreview(poolSlug);
  }, [activeTab, selectedMyEvent?.id, selectedMyEvent?.funding_pool_slug, fetchMyEventsLedgerPreview]);

  useEffect(() => {
    if (!selectedMyEvent?.id) return;
    const match = (Array.isArray(myEvents) ? myEvents : []).find(
      (eventRow) => String(eventRow?.id || "") === String(selectedMyEvent.id || "")
    );
    if (match) {
      setSelectedMyEvent(match);
    } else {
      setSelectedMyEvent(null);
      setMyEventsLedgerPreview([]);
    }
  }, [myEvents, selectedMyEvent?.id]);

  useEffect(() => {
    if (!myEventsToast) return undefined;
    const timerId = window.setTimeout(() => setMyEventsToast(null), 3200);
    return () => window.clearTimeout(timerId);
  }, [myEventsToast]);

  useEffect(() => {
    if (!programsProjectsToast) return undefined;
    const timerId = window.setTimeout(() => setProgramsProjectsToast(null), 3600);
    return () => window.clearTimeout(timerId);
  }, [programsProjectsToast]);

  useEffect(() => {
    function handleOrgPortalEventCreated() {
      setShowCreateModal(false);
      setEditingOpportunityId(null);
      setActiveTab("opportunities");
      setSelectedQueueItem(null);
      fetchQueue();
    }

    window.addEventListener("orgPortalEventCreated", handleOrgPortalEventCreated);
    return () => {
      window.removeEventListener("orgPortalEventCreated", handleOrgPortalEventCreated);
    };
  }, [fetchQueue]);

  useEffect(() => {
    setSelectedQueueItem(null);
    scheduleRequestIdRef.current += 1;
    setCompletedExpanded(false);
    setCancelledExpanded(false);
    setApplicants(null);
    setApplicantCounts(ZERO_PENDING_ACTION_COUNTS);
    setDetailError("");
    setActionError("");
    setActionLoadingByUser({});
    setScheduleData(null);
    setScheduleLoading(false);
    setScheduleError("");
    setApprovedDeclineModal({ open: false, applicant: null });
    setApproveAllConfirmOpen(false);
    setApproveAllLoading(false);
    setApproveAllProgress({ current: 0, total: 0 });
    setRoster([]);
    setRosterLoading(false);
    setRosterError(false);
    setMarkPresentByUser({});
    setVerifyAttendanceByUser({});
    setRateVolunteerByUser({});
    setVerifyAllAttendanceLoading(false);
    setCreditsQueue(null);
    setCreditsLoading(false);
    setCreditDetail(null);
    setCreditDetailLoading(false);
    setCreditsVerifyAllLoading(false);
    setCreditsActionError("");
    setCommsQueue(null);
    setCommsLoading(false);
    setCommsError("");
    setSending(false);
    setSendSuccess(false);
    setCommsRecipients([]);
    setCommsRecipientsLoading(false);
    setCommsActionError("");
    setSelectedRecipientIds([]);
    setSelectedCommsItemId(null);
    setMessageBody("");
    setSelectedRecipient("");
    setSelectedChannel("email");
    setRecipientEditorOpen(false);
    setScheduleOpen(false);
    setShowConfirmModal(false);
    setShowToast(false);
    setShowCreateModal(false);
    setEditingOpportunityId(null);
    setShowCancelModal(false);
    setCancelLoading(false);
    setCancelError("");
    setCancelModalTarget(null);
    setMyEventsPoolSummary(null);
    setMyEventsPoolLoading(false);
    setMyEvents([]);
    setMyEventsLoading(false);
    setMyEventsSubTab("upcoming");
    setMyEventsPoolFilter("");
    setSelectedMyEvent(null);
    setMyEventsLedgerPreview([]);
    setMyEventsLedgerOpen(false);
    setMyEventsInviteModal({ open: false, event: null });
    setMyEventsToast(null);
  }, [activeTab]);

  useEffect(() => {
    const pendingNavigation = pendingScheduleNavigationRef.current;
    if (!pendingNavigation) return;
    if (pendingNavigation.activeTab !== activeTab) {
      if (activeTab !== "schedule") {
        pendingScheduleNavigationRef.current = null;
      }
      return;
    }
    pendingScheduleNavigationRef.current = null;

    if (pendingNavigation.selectedQueueItem) {
      setSelectedQueueItem(pendingNavigation.selectedQueueItem);
    }
    if (pendingNavigation.scrollToDetail) {
      setPendingDetailScroll("tabs");
    }
  }, [activeTab]);

  const opportunitiesQueueSections = useMemo(() => {
    const mapRows = (rows, section) =>
      rows.map((row, idx) => ({
        ...normalizePendingActionCounts(row),
        id: String(row?.id || `${section}-${idx}`),
        tab: "opportunities",
        type: row?.type || `opp-${section}`,
        opportunityId: String(row?.opportunityId || ""),
        opportunityName: row?.opportunityName || "Opportunity",
        label: row?.label || row?.opportunityName || "Opportunity",
        icon:
          section === "needsAttention"
            ? "fa-user-check"
            : section === "upcoming"
              ? "fa-calendar"
              : section === "active"
                ? "fa-circle"
                : section === "drafts"
                  ? "fa-file"
                : section === "cancelled"
                  ? "fa-ban"
                  : "fa-check-circle",
        startTime: row?.startTime || row?.start_at || null,
        endTime: row?.endTime || row?.end_at || null,
        timeZone: row?.startTz || row?.timeZone || row?.tz || "America/Vancouver",
        pendingCount: safeNumber(
          row?.pendingJoinCount ?? row?.pending_join_count ?? row?.pendingCount ?? row?.pendingActionsCount ?? row?.pending_actions_count,
          0
        ),
        approvedCount: safeNumber(row?.approvedCount, 0),
        capacity: row?.capacity == null ? null : safeNumber(row?.capacity, null),
      }));

    const queueNeedsAttention = mapRows(queue?.needsAttention || [], "needsAttention");
    const queueUpcoming = mapRows(queue?.upcoming || [], "upcoming");
    const normalizedUpcomingCandidates = [...queueNeedsAttention, ...queueUpcoming].map((item) => ({
      ...item,
      type: item.pendingCount > 0 ? "opp-approval" : "opp-upcoming",
      icon: item.pendingCount > 0 ? "fa-user-check" : "fa-calendar",
    }));
    const needsAttention = normalizedUpcomingCandidates.filter((item) => item.pendingCount > 0);
    const upcoming = normalizedUpcomingCandidates.filter((item) => item.pendingCount <= 0);

    return {
      needsAttention,
      upcoming,
      active: mapRows(queue?.active || [], "active"),
      drafts: mapRows(queue?.drafts || [], "drafts"),
      completed: mapRows(queue?.completed || [], "completed"),
      cancelled: mapRows(queue?.cancelled || [], "cancelled"),
    };
  }, [queue]);

  const selectedOpportunityId =
    selectedQueueItem?.tab === "opportunities" ? String(selectedQueueItem.opportunityId || "") : "";
  const hasOpportunities = Boolean(queue?.hasOpportunities);
  const selectedOpportunity = selectedQueueItem?.tab === "opportunities" ? selectedQueueItem : null;

  const scrollToOpportunityDetailTop = useCallback((showTabs = false) => {
    if (typeof window === "undefined") return;
    const navEl = document.querySelector(".navbar");
    const navHeight = navEl ? Math.max(0, Math.round(navEl.getBoundingClientRect().height)) : 0;
    let target, extraReveal;
    if (showTabs) {
      target = document.querySelector(".orgp-tabs") || opportunityDetailTopRef.current || detailPanelRef.current;
      extraReveal = 8;
    } else {
      target = opportunityDetailTopRef.current || detailPanelRef.current;
      const isDesktop = window.matchMedia("(min-width: 768px)").matches;
      extraReveal = isDesktop ? 84 : 24;
    }
    if (!target) return;
    const targetTop = target.getBoundingClientRect().top + window.pageYOffset;
    const top = Math.max(0, targetTop - navHeight - extraReveal);
    window.scrollTo({ top, behavior: "smooth" });
  }, []);

  const parseApplicantsPayload = useCallback((payload) => {
    const applicantRows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.applicants)
        ? payload.applicants
        : [];
    const parsedCounts = payload && !Array.isArray(payload)
      ? normalizePendingActionCounts(payload?.counts)
      : null;
    const fallbackCounts = {
      pendingJoinCount: applicantRows.filter(
        (row) => String(row?.status || row?.rsvpStatus || row?.rsvp_status || "").toLowerCase() === "pending"
      ).length,
      pendingVerifyCount: applicantRows.filter((row) => {
        const status = String(row?.status || row?.rsvpStatus || row?.rsvp_status || "").toLowerCase();
        const verificationStatus = String(
          row?.verification_status ?? row?.verificationStatus ?? "pending"
        ).toLowerCase();
        return ["accepted", "checked_in"].includes(status) && verificationStatus === "pending";
      }).length,
      pendingActionsCount: 0,
      approvedCount: applicantRows.filter(
        (row) => String(row?.status || row?.rsvpStatus || row?.rsvp_status || "").toLowerCase() === "accepted"
      ).length,
      checkedInCount: applicantRows.filter(
        (row) => String(row?.status || row?.rsvpStatus || row?.rsvp_status || "").toLowerCase() === "checked_in"
      ).length,
      totalCount: applicantRows.length,
    };
    fallbackCounts.pendingActionsCount = fallbackCounts.pendingJoinCount + fallbackCounts.pendingVerifyCount;
    return {
      applicants: applicantRows,
      counts: parsedCounts || fallbackCounts,
    };
  }, []);

  const fetchApplicantsForOpportunity = useCallback(
    async (opportunityId, { showLoading = true } = {}) => {
      if (!opportunityId) return;
      if (showLoading) {
        setApplicantsLoading(true);
        setApplicantCounts(ZERO_PENDING_ACTION_COUNTS);
      }
      setDetailError("");
      setActionError("");

      try {
        const response = await fetch(
          `/api/org/opportunities/${encodeURIComponent(opportunityId)}/applicants`,
          { credentials: "include" }
        );
        if (!response.ok) throw new Error("applicants_failed");
        const payload = await response.json();
        const parsed = parseApplicantsPayload(payload);
        setApplicants(parsed.applicants);
        setApplicantCounts(parsed.counts);
      } catch (_) {
        setApplicants(null);
        setApplicantCounts(ZERO_PENDING_ACTION_COUNTS);
        setDetailError("Could not load applicants.");
      } finally {
        if (showLoading) setApplicantsLoading(false);
      }
    },
    [parseApplicantsPayload]
  );

  useEffect(() => {
    if (activeTab === "opportunities" && selectedOpportunityId) {
      fetchApplicantsForOpportunity(selectedOpportunityId, { showLoading: true });
    } else {
      setApplicants(null);
      setApplicantCounts(ZERO_PENDING_ACTION_COUNTS);
      setApplicantsLoading(false);
      setDetailError("");
      setActionError("");
      setOpportunityInviteModal({
        open: false,
        email: "",
        name: "",
        sending: false,
        error: "",
      });
      setAdminSignupModal({
        open: false,
        name: "",
        email: "",
        sendEmail: true,
        sending: false,
        error: null,
      });
      setOpportunityInviteNotice(null);
      setSelectedOpportunityDetail(null);
      setSelectedOpportunityDetailLoading(false);
      setSelectedOpportunityDetailError("");
      setActionLoadingByUser({});
      setApproveAllLoading(false);
      setApproveAllProgress({ current: 0, total: 0 });
      setApplicantProfileModal({ open: false, applicant: null });
    }
  }, [activeTab, selectedOpportunityId, fetchApplicantsForOpportunity]);

  const fetchOpportunityDetail = useCallback(async (opportunityId, { showLoading = true } = {}) => {
    if (!opportunityId) return;
    if (showLoading) setSelectedOpportunityDetailLoading(true);
    setSelectedOpportunityDetailError("");

    try {
      const response = await fetch(`/api/events/${encodeURIComponent(opportunityId)}`, {
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "event_details_failed");
      }
      setSelectedOpportunityDetail(payload?.data || null);
    } catch (_) {
      setSelectedOpportunityDetail(null);
      setSelectedOpportunityDetailError("Could not load event details.");
    } finally {
      if (showLoading) setSelectedOpportunityDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "opportunities" && selectedOpportunityId) {
      fetchOpportunityDetail(selectedOpportunityId, { showLoading: true });
    } else {
      setSelectedOpportunityDetail(null);
      setSelectedOpportunityDetailLoading(false);
      setSelectedOpportunityDetailError("");
    }
  }, [activeTab, selectedOpportunityId, fetchOpportunityDetail]);

  useEffect(() => {
    if (!pendingDetailScroll) return;
    if (activeTab !== "opportunities" || !selectedOpportunityId) {
      setPendingDetailScroll(null);
      return;
    }
    if (typeof window === "undefined") {
      setPendingDetailScroll(null);
      return;
    }
    const showTabs = pendingDetailScroll === "tabs";
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollToOpportunityDetailTop(showTabs);
        setPendingDetailScroll(null);
      });
    });
  }, [pendingDetailScroll, activeTab, selectedOpportunityId, scrollToOpportunityDetailTop]);

  const selectedCheckinEventId =
    selectedQueueItem?.tab === "checkin" ? String(selectedQueueItem.opportunityId || "") : "";
  const selectedCheckinStartTime =
    selectedQueueItem?.tab === "checkin" ? selectedQueueItem.startTime || null : null;
  const selectedCheckinEndTime =
    selectedQueueItem?.tab === "checkin" ? selectedQueueItem.endTime || null : null;
  const selectedCreditsItem = selectedQueueItem?.tab === "credits" ? selectedQueueItem : null;

  const commsQueueSections = useMemo(() => {
    const source = {
      sendNow: Array.isArray(commsQueue?.sendNow) ? commsQueue.sendNow : [],
      dueSoon: Array.isArray(commsQueue?.dueSoon) ? commsQueue.dueSoon : [],
      upcoming: Array.isArray(commsQueue?.upcoming) ? commsQueue.upcoming : [],
      sentHistory: Array.isArray(commsQueue?.sentHistory) ? commsQueue.sentHistory : [],
    };

    const toQueueItem = (row, groupKey) => {
      const eventId = String(row?.eventId || row?.event_id || "").trim();
      const title = row?.title || "Untitled event";
      const commsType = String(row?.type || (groupKey === "sendNow" ? "thankyou" : "reminder")).toLowerCase();
      const typeLabel = titleCaseCommsType(commsType);
      const recipientCount = safeNumber(row?.recipient_count ?? row?.recipientCount, 0);
      const startAt = row?.start_at || row?.startAt || null;
      const endAt = row?.end_at || row?.endAt || null;
      const sentAt = row?.sent_at || row?.sentAt || null;
      const channel = String(row?.channel || "email").toLowerCase();

      let subtext = `${recipientCount} volunteers`;
      let icon = "fa-bell";
      let iconTone = "warning";

      if (groupKey === "sendNow") {
        icon = "fa-heart";
        iconTone = "coral";
        subtext = `${recipientCount} volunteers · shift ended ${toHourDeltaText(endAt, "past")}`;
      } else if (groupKey === "dueSoon") {
        icon = "fa-bell";
        iconTone = "warning";
        subtext = `Shift in ${toHourDeltaText(startAt, "future")} · ${recipientCount} volunteers`;
      } else if (groupKey === "upcoming") {
        icon = "fa-bell";
        iconTone = "muted";
        subtext = `Shift in ${toHourDeltaText(startAt, "future")} · ${recipientCount} volunteers`;
      } else if (groupKey === "sentHistory") {
        icon = "fa-check-circle";
        iconTone = "success";
        const sentDateText = sentAt ? formatShortDate(sentAt) : "Date TBD";
        subtext = `Sent ${sentDateText} · ${recipientCount} recipients`;
      }

      const queueType = groupKey === "sentHistory" ? "comms-sent" : `comms-${commsType}`;
      return {
        id: String(row?.id || `${groupKey}-${eventId}-${commsType}`),
        eventId,
        type: queueType,
        commsType,
        templateType: commsType,
        icon,
        iconTone,
        title: `${typeLabel} · ${title}`,
        subtext,
        opportunityName: title,
        opportunityDate: formatShortDate(startAt),
        opportunityTime: formatTime(startAt),
        recipientsCount: recipientCount,
        sentOnText: sentAt ? formatCommsDate(sentAt) : "",
        channel,
      };
    };

    return {
      sendNow: source.sendNow.map((row) => toQueueItem(row, "sendNow")),
      dueSoon: source.dueSoon.map((row) => toQueueItem(row, "dueSoon")),
      upcoming: source.upcoming.map((row) => toQueueItem(row, "upcoming")),
      sentHistory: source.sentHistory.map((row) => toQueueItem(row, "sentHistory")),
    };
  }, [commsQueue]);

  const commsItemsById = useMemo(() => {
    const map = new Map();
    [
      ...commsQueueSections.sendNow,
      ...commsQueueSections.dueSoon,
      ...commsQueueSections.upcoming,
      ...commsQueueSections.sentHistory,
    ].forEach((item) => {
      map.set(item.id, item);
    });
    return map;
  }, [commsQueueSections]);

  const selectedCommsItem = selectedCommsItemId ? commsItemsById.get(selectedCommsItemId) || null : null;

  useEffect(() => {
    if (activeTab !== "comms") return;
    if (selectedCommsItemId && !commsItemsById.has(selectedCommsItemId)) {
      setSelectedCommsItemId(null);
    }
  }, [activeTab, selectedCommsItemId, commsItemsById]);

  const fetchCheckinQueue = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) setCheckinQueueLoading(true);
    setCheckinQueueError(false);

    try {
      const res = await fetch("/api/org/opportunities", { credentials: "include" });
      if (!res.ok) throw new Error("checkin_queue_failed");
      const rows = await res.json();

      const now = new Date();
      const soonLimit = new Date(now.getTime() + 4 * 60 * 60 * 1000);
      const items = (Array.isArray(rows) ? rows : [])
        .map((row) => {
          const id = String(row?.id || "").trim();
          const status = String(row?.status || "").toLowerCase();
          if (status === "cancelled") return null;
          const startAt = row?.start_at ? new Date(row.start_at) : null;
          const endAt = row?.end_at ? new Date(row.end_at) : null;
          if (!id) return null;
          const validStart = startAt && !Number.isNaN(startAt.getTime()) ? startAt : null;
          const validEnd = endAt && !Number.isNaN(endAt.getTime()) ? endAt : null;
          const fallbackEnd =
            validStart && !validEnd ? new Date(validStart.getTime() + 3 * 60 * 60 * 1000) : null;
          const effectiveEnd = validEnd || fallbackEnd;
          const checkedInCount = safeNumber(row?.checked_in, 0);
          const pendingVerifyCount = safeNumber(
            row?.pending_verify_count ?? row?.pendingVerifyCount,
            0
          );
          const approvedAttendanceCount = safeNumber(row?.approved, 0) + checkedInCount;

          let queueGroup = null;
          if (validStart && effectiveEnd && validStart <= now && effectiveEnd >= now) {
            queueGroup = "activeNow";
          } else if (validStart && validStart > now && validStart <= soonLimit) {
            queueGroup = "startingSoon";
          } else if (validStart && validStart > now && isSameCalendarDay(validStart, now)) {
            queueGroup = "laterToday";
          } else if (effectiveEnd && effectiveEnd < now && pendingVerifyCount > 0) {
            queueGroup = "checkoutPending";
          } else if (!validStart) {
            queueGroup = "startingSoon";
          }

          if (!queueGroup) return null;
          const expectedCount = Math.max(approvedAttendanceCount, checkedInCount);
          const startLabel = validStart
            ? validStart.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
            : "Time TBD";
          const dateLabel = validStart
            ? validStart.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "Date TBD";
          const endLabel = effectiveEnd
            ? effectiveEnd.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
            : "Time TBD";

          return {
            id: `checkin-${id}`,
            tab: "checkin",
            opportunityId: id,
            icon:
              queueGroup === "activeNow"
                ? "fa-qrcode"
                : queueGroup === "startingSoon"
                  ? "fa-clock"
                  : queueGroup === "laterToday"
                    ? "fa-calendar-day"
                    : "fa-clipboard-check",
            iconColor: queueGroup === "activeNow" ? "coral" : "",
            queueGroup,
            label:
              queueGroup === "checkoutPending"
                ? `${row?.title || "Untitled event"} · ended ${endLabel} — ${pendingVerifyCount} awaiting verification`
                : `${row?.title || "Untitled event"} · ${startLabel} — ${checkedInCount} checked / ${expectedCount} approved`,
            detailName: row?.title || "Untitled event",
            detailDateTime: `${dateLabel} · ${startLabel} – ${endLabel}`,
            summaryChecked: checkedInCount,
            summaryExpected: expectedCount,
            startTime: validStart ? validStart.toISOString() : null,
            endTime: effectiveEnd ? effectiveEnd.toISOString() : null,
            timeZone: row?.tz || "America/Vancouver",
          };
        })
        .filter(Boolean);

      setCheckinQueueItems(items);
      setCheckinQueueLoading(false);
    } catch {
      setCheckinQueueError(true);
      setCheckinQueueItems([]);
      setCheckinQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "checkin") return undefined;
    fetchCheckinQueue({ showLoading: true });
    const intervalId = setInterval(() => {
      fetchCheckinQueue({ showLoading: false });
    }, 30000);
    return () => clearInterval(intervalId);
  }, [activeTab, fetchCheckinQueue]);

  const checkinQueueSections = useMemo(
    () => ({
      activeNow: checkinQueueItems.filter((item) => item.queueGroup === "activeNow"),
      startingSoon: checkinQueueItems.filter((item) => item.queueGroup === "startingSoon"),
      laterToday: checkinQueueItems.filter((item) => item.queueGroup === "laterToday"),
      checkoutPending: checkinQueueItems.filter((item) => item.queueGroup === "checkoutPending"),
    }),
    [checkinQueueItems]
  );

  async function fetchRoster(eventId = selectedCheckinEventId, eventStartTime = selectedCheckinStartTime) {
    if (!eventId) return;
    setRosterLoading(true);
    setRosterError(false);

    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/roster`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("roster_failed");
      const payload = await response.json();
      if (!payload?.ok) {
        setRosterError(true);
        setRosterLoading(false);
        return;
      }

      const eventStart = eventStartTime ? new Date(eventStartTime) : null;
      const rows = (Array.isArray(payload.data) ? payload.data : []).map((row, idx) => {
        const attendeeUserId = String(row?.attendee_user_id || row?.attendeeUserId || "");
        const checkedInAt = row?.checked_in_at || row?.checkedInAt || null;
        const checkedInDate = checkedInAt ? new Date(checkedInAt) : null;
        const hasCheckedIn = Boolean(checkedInDate && !Number.isNaN(checkedInDate.getTime()));
        const isNoShow = row?.no_show === true || row?.noShow === true;

        let status = "expected";
        if (hasCheckedIn) status = "checked-in";
        else if (isNoShow) status = "no-show";
        else if (
          eventStart &&
          !Number.isNaN(eventStart.getTime()) &&
          Date.now() - eventStart.getTime() > 15 * 60 * 1000
        ) {
          status = "late";
        }

        return {
          id: `${eventId}-${attendeeUserId || idx}`,
          attendeeUserId,
          name: `${row?.firstname || ""} ${row?.lastname || ""}`.trim() || row?.email || "Volunteer",
          noShow: isNoShow,
          status,
          time: formatCheckinTime(checkedInAt),
          checkedInAt,
          attendedMinutes:
            row?.attended_minutes == null ? null : safeNumber(row.attended_minutes, null),
          verificationStatus: row?.verification_status || "",
          statusRaw: row?.status || "",
          rowError: "",
        };
      });

      setRoster(rows);
      setRosterLoading(false);
    } catch (_) {
      setRosterError(true);
      setRosterLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "checkin" && selectedCheckinEventId) {
      fetchRoster(selectedCheckinEventId, selectedCheckinStartTime);
    } else {
      setRoster([]);
      setRosterLoading(false);
      setRosterError(false);
      setMarkPresentByUser({});
      setNoShowByUser({});
      setVerifyAttendanceByUser({});
      setRateVolunteerByUser({});
      setVerifyAllAttendanceLoading(false);
    }
  }, [activeTab, selectedCheckinEventId, selectedCheckinStartTime]);

  useEffect(() => {
    if (activeTab !== "checkin" || !selectedCheckinEventId) return undefined;
    const intervalId = setInterval(() => {
      fetchRoster(selectedCheckinEventId, selectedCheckinStartTime);
    }, 30000);
    return () => clearInterval(intervalId);
  }, [activeTab, selectedCheckinEventId, selectedCheckinStartTime]);

  useEffect(() => {
    if (activeTab !== "schedule") return;
    fetchSchedule();
  }, [activeTab, fetchSchedule]);

  useEffect(() => {
    if (activeTab !== "credits") return;
    fetchCreditsQueue();
  }, [activeTab, fetchCreditsQueue]);

  useEffect(() => {
    if (activeTab !== "credits" || !selectedCreditsItem) {
      setCreditDetail(null);
      setCreditDetailLoading(false);
      setCreditsActionError("");
      setCreditsVerifyAllLoading(false);
      return;
    }

    if (selectedCreditsItem.type === "credits-volunteer") {
      setCreditDetail(null);
      setCreditDetailLoading(false);
      setCreditsActionError("");
      setCreditsVerifyAllLoading(false);
      return;
    }

    let mounted = true;
    setCreditDetailLoading(true);
    setCreditsActionError("");

    fetch(`/api/org/credits/${encodeURIComponent(selectedCreditsItem.opportunityId)}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("credit_detail_failed");
        return res.json();
      })
      .then((data) => {
        if (!mounted) return;
        setCreditDetail(Array.isArray(data?.data) ? data.data : []);
        setCreditDetailLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setCreditDetail([]);
        setCreditDetailLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeTab, selectedCreditsItem?.id, selectedCreditsItem?.type, selectedCreditsItem?.opportunityId]);

  useEffect(() => {
    if (activeTab !== "comms") return;
    let mounted = true;

    setCommsLoading(true);
    setCommsError("");

    fetch("/api/org/comms/queue", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("comms_queue_failed");
        return res.json();
      })
      .then((data) => {
        if (!mounted) return;
        setCommsQueue({
          sendNow: Array.isArray(data?.sendNow) ? data.sendNow : [],
          dueSoon: Array.isArray(data?.dueSoon) ? data.dueSoon : [],
          upcoming: Array.isArray(data?.upcoming) ? data.upcoming : [],
          sentHistory: Array.isArray(data?.sentHistory) ? data.sentHistory : [],
        });
        setCommsLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setCommsQueue({ sendNow: [], dueSoon: [], upcoming: [], sentHistory: [] });
        setCommsError("Could not load communications queue.");
        setCommsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "comms" || !selectedCommsItem?.eventId) {
      setCommsRecipients([]);
      setCommsRecipientsLoading(false);
      setSelectedRecipient("");
      setSelectedRecipientIds([]);
      return;
    }

    let mounted = true;
    setCommsRecipientsLoading(true);
    setCommsActionError("");

    fetch(`/api/org/opportunities/${encodeURIComponent(selectedCommsItem.eventId)}/applicants`, {
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error("comms_recipients_failed");
        return res.json();
      })
      .then((payload) => {
        if (!mounted) return;
        const applicantRows = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.applicants)
            ? payload.applicants
            : [];
        const recipients = applicantRows
          .map((row) => {
            const userId = String(row?.userId || row?.user_id || row?.attendee_user_id || "").trim();
            if (!userId) return null;
            const firstName = row?.firstname || row?.first_name || "";
            const lastName = row?.lastname || row?.last_name || "";
            const displayName = `${firstName} ${lastName}`.trim() || row?.name || row?.email || "Volunteer";
            const status = String(row?.status || row?.rsvpStatus || "").toLowerCase();
            const verificationStatus = String(
              row?.verification_status || row?.verificationStatus || ""
            ).toLowerCase();
            return {
              userId,
              name: displayName,
              status,
              verificationStatus,
            };
          })
          .filter(Boolean)
          .filter((row) => row.status === "accepted" || row.verificationStatus === "verified");

        const fallbackRecipients = recipients.length
          ? recipients
          : applicantRows
              .map((row) => {
                const userId = String(row?.userId || row?.user_id || row?.attendee_user_id || "").trim();
                if (!userId) return null;
                const displayName = row?.name || row?.email || "Volunteer";
                return { userId, name: displayName, status: "", verificationStatus: "" };
              })
              .filter(Boolean);

        setCommsRecipients(fallbackRecipients);
        setSelectedRecipient(fallbackRecipients[0]?.userId || "");
        setSelectedRecipientIds(fallbackRecipients.map((row) => row.userId));
        setCommsRecipientsLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setCommsRecipients([]);
        setSelectedRecipient("");
        setSelectedRecipientIds([]);
        setCommsRecipientsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeTab, selectedCommsItem?.id, selectedCommsItem?.eventId]);

  useEffect(() => {
    if (activeTab !== "comms" || !selectedCommsItem) {
      setMessageBody("");
      setScheduleOpen(false);
      return;
    }

    const template = getCommsTemplate(selectedCommsItem.templateType || selectedCommsItem.commsType || selectedCommsItem.type);
    const existingBody = messageBodyByItem[selectedCommsItem.id];
    setMessageBody(existingBody || template);
    setSelectedChannel("email");
    setRecipientEditorOpen(false);
    setScheduleOpen(false);
    setCommsActionError("");
  }, [activeTab, selectedCommsItem?.id, selectedCommsItem?.type, selectedCommsItem?.commsType]);

  useEffect(() => {
    if (!window.bootstrap || !window.bootstrap.Modal || !commsConfirmModalRef.current) return undefined;
    const instance = window.bootstrap.Modal.getOrCreateInstance(commsConfirmModalRef.current);
    commsConfirmModalInstanceRef.current = instance;

    const handleHidden = () => setShowConfirmModal(false);
    commsConfirmModalRef.current.addEventListener("hidden.bs.modal", handleHidden);

    return () => {
      commsConfirmModalRef.current?.removeEventListener("hidden.bs.modal", handleHidden);
      instance.hide();
      commsConfirmModalInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!commsConfirmModalInstanceRef.current) return;
    if (showConfirmModal) commsConfirmModalInstanceRef.current.show();
    else commsConfirmModalInstanceRef.current.hide();
  }, [showConfirmModal]);

  useEffect(() => {
    if (!window.bootstrap || !window.bootstrap.Toast || !commsToastRef.current) return undefined;
    const instance = window.bootstrap.Toast.getOrCreateInstance(commsToastRef.current, { delay: 3000 });
    commsToastInstanceRef.current = instance;

    const handleHidden = () => setShowToast(false);
    commsToastRef.current.addEventListener("hidden.bs.toast", handleHidden);

    return () => {
      commsToastRef.current?.removeEventListener("hidden.bs.toast", handleHidden);
      instance.hide();
      commsToastInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!commsToastInstanceRef.current) return undefined;
    if (showToast) commsToastInstanceRef.current.show();
    else commsToastInstanceRef.current.hide();

    if (!showToast) return undefined;
    const timer = setTimeout(() => {
      setShowToast(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [showToast]);

  useEffect(() => {
    if (!sendSuccess) return undefined;
    const timer = setTimeout(() => setSendSuccess(false), 3000);
    return () => clearTimeout(timer);
  }, [sendSuccess]);

  useEffect(() => {
    if (activeTab !== "reports") return;
    let mounted = true;
    setReportsLoading(true);

    const params = new URLSearchParams({
      range: String(reportFilters.range),
      opportunityId: String(reportFilters.opportunityId || "all"),
      volunteerId: String(reportFilters.volunteerId || "all"),
    }).toString();

    fetch(`/api/org/reports?${params}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("reports_failed");
        return res.json();
      })
      .then((data) => {
        if (!mounted) return;
        setReportData(data || null);
        setReportsLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setReportData({
          hoursByMonth: [],
          fillRateByMonth: [],
          noShowRate: 0,
          impactByMonth: [],
          topVolunteers: [],
          opportunityList: [],
          volunteerList: [],
        });
        setReportsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeTab, reportFilters]);

  function destroyReportsCharts() {
    if (hoursChartRef.current) {
      hoursChartRef.current.destroy();
      hoursChartRef.current = null;
    }
    if (fillRateChartRef.current) {
      fillRateChartRef.current.destroy();
      fillRateChartRef.current = null;
    }
    if (noShowChartRef.current) {
      noShowChartRef.current.destroy();
      noShowChartRef.current = null;
    }
    if (impactChartRef.current) {
      impactChartRef.current.destroy();
      impactChartRef.current = null;
    }
  }

  useEffect(() => {
    if (activeTab !== "reports") {
      destroyReportsCharts();
      return undefined;
    }

    const Chart = window.Chart;
    if (!Chart) return undefined;

    destroyReportsCharts();

    const baseOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
    };

    const hoursByMonth = Array.isArray(reportData?.hoursByMonth) ? reportData.hoursByMonth : [];
    const fillRateByMonth = Array.isArray(reportData?.fillRateByMonth) ? reportData.fillRateByMonth : [];
    const impactByMonth = Array.isArray(reportData?.impactByMonth) ? reportData.impactByMonth : [];
    const fallbackLabels = buildReportFallbackLabels(reportFilters.range);
    const periodLabels = (hoursByMonth.length ? hoursByMonth : fillRateByMonth.length ? fillRateByMonth : impactByMonth)
      .map((row) => row.label || row.month || "")
      .filter(Boolean);
    const chartLabels = periodLabels.length ? periodLabels : fallbackLabels;
    const maxTicksLimit = Number(reportFilters.range) === 7 ? 7 : Number(reportFilters.range) === 30 ? 6 : 8;
    const commonXAxis = {
      grid: { display: false },
      ticks: {
        autoSkip: true,
        maxTicksLimit,
      },
    };

    if (hoursChartCanvasRef.current) {
      hoursChartRef.current = new Chart(hoursChartCanvasRef.current, {
        type: "bar",
        data: {
          labels: chartLabels,
          datasets: [
            {
              data: (hoursByMonth.length ? hoursByMonth.map((row) => safeNumber(row.hours, 0)) : chartLabels.map(() => 0)),
              backgroundColor: "#455a7c",
              borderRadius: 6,
              maxBarThickness: 18,
            },
          ],
        },
        options: {
          ...baseOptions,
          scales: {
            x: commonXAxis,
            y: { beginAtZero: true, ticks: { precision: 0 } },
          },
        },
      });
    }

    if (fillRateChartCanvasRef.current) {
      fillRateChartRef.current = new Chart(fillRateChartCanvasRef.current, {
        type: "line",
        data: {
          labels: chartLabels,
          datasets: [
            {
              data: (fillRateByMonth.length ? fillRateByMonth.map((row) => safeNumber(row.rate, 0)) : chartLabels.map(() => 0)),
              borderColor: "#ff5656",
              backgroundColor: "#ff5656",
              fill: false,
              tension: 0.3,
              pointRadius: 3,
            },
          ],
        },
        options: {
          ...baseOptions,
          scales: {
            x: commonXAxis,
            y: { beginAtZero: true, max: 100 },
          },
        },
      });
    }

    if (noShowChartCanvasRef.current) {
      const noShowRate = Math.max(0, Math.min(100, safeNumber(reportData?.noShowRate, 0)));
      noShowChartRef.current = new Chart(noShowChartCanvasRef.current, {
        type: "doughnut",
        data: {
          labels: ["No-show", "Attended"],
          datasets: [
            {
              data: [noShowRate, Math.max(0, 100 - noShowRate)],
              backgroundColor: ["#ffc107", "#e9ecef"],
              borderWidth: 0,
            },
          ],
        },
        options: {
          ...baseOptions,
          cutout: "72%",
        },
      });
    }

    if (impactChartCanvasRef.current) {
      impactChartRef.current = new Chart(impactChartCanvasRef.current, {
        type: "bar",
        data: {
          labels: chartLabels,
          datasets: [
            {
              data: (impactByMonth.length ? impactByMonth.map((row) => safeNumber(row.value, 0)) : chartLabels.map(() => 0)),
              backgroundColor: "#28a745",
              borderRadius: 6,
              maxBarThickness: 18,
            },
          ],
        },
        options: {
          ...baseOptions,
          scales: {
            x: commonXAxis,
            y: { beginAtZero: true, ticks: { precision: 0 } },
          },
        },
      });
    }

    return () => {
      destroyReportsCharts();
    };
  }, [activeTab, reportData, reportFilters.range]);

  async function handleMarkPresent(rowId, { refreshQueue = false } = {}) {
    const target = roster.find((entry) => entry.id === rowId);
    if (!selectedCheckinEventId || !target?.attendeeUserId) return false;

    setMarkPresentByUser((prev) => ({ ...prev, [rowId]: true }));
    setRoster((prev) =>
      prev.map((entry) =>
        entry.id === rowId
          ? {
              ...entry,
              rowError: "",
            }
          : entry
      )
    );

    try {
      const response = await fetch(`/api/events/${encodeURIComponent(selectedCheckinEventId)}/checkins`, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-CSRF-Token": csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId: target.attendeeUserId }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "mark_present_failed");
      }

      const checkedInAt = payload?.data?.checked_in_at || new Date().toISOString();
      const checkedInLabel = formatCheckinTime(checkedInAt);

      setRoster((prev) =>
        prev.map((entry) =>
          entry.id === rowId
            ? {
                ...entry,
                status: "checked-in",
                statusRaw: "checked_in",
                noShow: false,
                time: checkedInLabel,
                checkedInAt,
                rowError: "",
              }
            : entry
        )
      );
      if (refreshQueue) {
        await fetchCheckinQueue({ showLoading: false });
      }
      return true;
    } catch (error) {
      setRoster((prev) =>
        prev.map((entry) =>
          entry.id === rowId
            ? {
                ...entry,
                rowError:
                  error?.message === "Accept the invite before checking in"
                    ? "Volunteer must accept RSVP first."
                    : "Failed. Try again.",
              }
            : entry
        )
      );
      return false;
    } finally {
      setMarkPresentByUser((prev) => {
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
    }
  }

  async function handleMarkNoShow(rowId, { refreshQueue = true } = {}) {
    const target = roster.find((entry) => entry.id === rowId);
    if (!selectedCheckinEventId || !target?.attendeeUserId) return false;

    setNoShowByUser((prev) => ({ ...prev, [rowId]: true }));
    setRoster((prev) =>
      prev.map((entry) =>
        entry.id === rowId
          ? {
              ...entry,
              rowError: "",
            }
          : entry
      )
    );

    try {
      const response = await fetch(`/api/events/${encodeURIComponent(selectedCheckinEventId)}/no-show`, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-CSRF-Token": csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ attendee_user_id: target.attendeeUserId }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "mark_no_show_failed");
      }

      setRoster((prev) =>
        prev.map((entry) =>
          entry.id === rowId
            ? {
                ...entry,
                noShow: true,
                status: "no-show",
                time: "—",
                checkedInAt: null,
                verificationStatus: "pending",
                attendedMinutes: null,
                rowError: "",
              }
            : entry
        )
      );
      if (refreshQueue) {
        await fetchCheckinQueue({ showLoading: false });
      }
      return true;
    } catch (error) {
      setRoster((prev) =>
        prev.map((entry) =>
          entry.id === rowId
            ? {
                ...entry,
                rowError:
                  error?.message === "No-show can only be marked after the shift ends"
                    ? "You can mark no-show after the shift ends."
                    : "Failed. Try again.",
              }
            : entry
        )
      );
      return false;
    } finally {
      setNoShowByUser((prev) => {
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
    }
  }

  function computeSelectedEventAttendedMinutes() {
    const startTs = selectedCheckinStartTime ? new Date(selectedCheckinStartTime).getTime() : NaN;
    const endTs = selectedCheckinEndTime ? new Date(selectedCheckinEndTime).getTime() : NaN;
    if (Number.isNaN(startTs) || Number.isNaN(endTs) || endTs <= startTs) return undefined;
    return Math.max(15, Math.round((endTs - startTs) / 60000));
  }

  async function handleVerifyAttendance(rowId, { refreshQueue = true } = {}) {
    const target = roster.find((entry) => entry.id === rowId);
    if (!selectedCheckinEventId || !target?.attendeeUserId) return;

    setVerifyAttendanceByUser((prev) => ({ ...prev, [rowId]: true }));
    setRoster((prev) =>
      prev.map((entry) =>
        entry.id === rowId
          ? {
              ...entry,
              rowError: "",
            }
          : entry
      )
    );

    try {
      const attendedMinutes = computeSelectedEventAttendedMinutes();
      const requestBody = {
        attendee_user_id: target.attendeeUserId,
        decision: "verified",
      };
      if (Number.isFinite(attendedMinutes)) {
        requestBody.attended_minutes = attendedMinutes;
      }

      const response = await fetch(`/api/events/${encodeURIComponent(selectedCheckinEventId)}/verify`, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-CSRF-Token": csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "verify_failed");
      }

      setRoster((prev) =>
        prev.map((entry) =>
          entry.id === rowId
            ? {
                ...entry,
                verificationStatus: "verified",
                attendedMinutes: safeNumber(payload?.attended_minutes, entry.attendedMinutes),
                rowError: "",
              }
            : entry
        )
      );
      if (refreshQueue) {
        void fetchCheckinQueue({ showLoading: false });
      }
    } catch (_) {
      setRoster((prev) =>
        prev.map((entry) =>
          entry.id === rowId
            ? {
                ...entry,
                rowError: "Verification failed. Try again.",
              }
            : entry
        )
      );
    } finally {
      setVerifyAttendanceByUser((prev) => {
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
    }
  }

  async function handleRateVolunteer(row) {
    const attendeeUserId = String(row?.attendeeUserId || "").trim();
    if (!selectedCheckinEventId || !attendeeUserId) return;

    const starsInput = window.prompt(`Rate ${row?.name || "this volunteer"} (1-5 stars)`, "5");
    if (starsInput === null) return;
    const stars = Number(starsInput);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      setRoster((prev) =>
        prev.map((entry) =>
          entry.id === row.id
            ? {
                ...entry,
                rowError: "Enter a whole number from 1 to 5.",
              }
            : entry
        )
      );
      return;
    }

    const noteInput = window.prompt("Optional note (max 280 chars)", "");
    const note = noteInput == null ? "" : String(noteInput).trim().slice(0, 280);

    setRateVolunteerByUser((prev) => ({
      ...prev,
      [attendeeUserId]: {
        ...(prev[attendeeUserId] || {}),
        submitting: true,
        error: "",
      },
    }));

    try {
      const response = await fetch(`/api/events/${encodeURIComponent(selectedCheckinEventId)}/ratings`, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-CSRF-Token": csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target_user_id: attendeeUserId,
          stars,
          ...(note ? { note } : {}),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 || payload?.error === "DUPLICATE_RATING") {
        setRateVolunteerByUser((prev) => ({
          ...prev,
          [attendeeUserId]: {
            ...(prev[attendeeUserId] || {}),
            submitting: false,
            rated: true,
            error: "",
          },
        }));
        return;
      }
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || payload?.error || "rating_failed");
      }

      setRateVolunteerByUser((prev) => ({
        ...prev,
        [attendeeUserId]: {
          submitting: false,
          rated: true,
          stars,
          error: "",
        },
      }));
      setRoster((prev) =>
        prev.map((entry) =>
          entry.id === row.id
            ? {
                ...entry,
                rowError: "",
              }
            : entry
        )
      );
    } catch (error) {
      setRateVolunteerByUser((prev) => ({
        ...prev,
        [attendeeUserId]: {
          ...(prev[attendeeUserId] || {}),
          submitting: false,
          error: error?.message || "Unable to rate volunteer.",
        },
      }));
      setRoster((prev) =>
        prev.map((entry) =>
          entry.id === row.id
            ? {
                ...entry,
                rowError: "Failed to submit rating.",
              }
            : entry
        )
      );
    }
  }

  async function handleVerifyAllCheckedIn() {
    if (verifyAllAttendanceLoading || !selectedCheckinEventId) return;
    const targets = roster.filter(
      (row) =>
        ["accepted", "checked_in"].includes(String(row.statusRaw || "").toLowerCase()) &&
        String(row.verificationStatus || "").toLowerCase() !== "verified" &&
        Boolean(row.attendeeUserId)
    );
    if (!targets.length) return;

    setVerifyAllAttendanceLoading(true);
    try {
      // Run sequentially to keep server-side host verification consistent and predictable.
      for (const row of targets) {
        // eslint-disable-next-line no-await-in-loop
        await handleVerifyAttendance(row.id, { refreshQueue: false });
      }
      await fetchCheckinQueue({ showLoading: false });
    } finally {
      setVerifyAllAttendanceLoading(false);
    }
  }

  async function handleMarkAllPresent() {
    const targets = roster.filter((entry) => {
      const rsvpStatus = String(entry.statusRaw || "").toLowerCase();
      return (
        ["accepted", "checked_in"].includes(rsvpStatus) &&
        (entry.status === "expected" || entry.status === "late")
      );
    });
    if (!targets.length) return;

    for (const row of targets) {
      // eslint-disable-next-line no-await-in-loop
      await handleMarkPresent(row.id, { refreshQueue: false });
    }
    await fetchCheckinQueue({ showLoading: false });
    await fetchRoster(selectedCheckinEventId, selectedCheckinStartTime);
  }

  async function handleVerifyAllCreditsPending() {
    if (creditsVerifyAllLoading || !selectedCreditsItem || selectedCreditsItem.type === "credits-volunteer") return;
    const eventId = String(selectedCreditsItem.opportunityId || "").trim();
    const detailRows = Array.isArray(creditDetail) ? creditDetail : [];
    const pendingRows = detailRows.filter(
      (row) => String(row?.verification_status || "").toLowerCase() !== "verified"
    );
    if (!eventId || !pendingRows.length) return;

    setCreditsVerifyAllLoading(true);
    setCreditsActionError("");

    try {
      for (const row of pendingRows) {
        const attendeeUserId = String(row?.id || "").trim();
        if (!attendeeUserId) continue;
        const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/verify`, {
          method: "POST",
          credentials: "include",
          headers: {
            "X-CSRF-Token": csrfToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            attendee_user_id: attendeeUserId,
            decision: "verified",
          }),
        });
        if (!response.ok) {
          throw new Error("verify_failed");
        }
      }

      await fetchCreditsQueue();
      const detailResponse = await fetch(`/api/org/credits/${encodeURIComponent(eventId)}`, {
        credentials: "include",
      });
      const detailPayload = await detailResponse.json().catch(() => ({}));
      if (!detailResponse.ok) {
        throw new Error("credit_detail_refresh_failed");
      }
      setCreditDetail(Array.isArray(detailPayload?.data) ? detailPayload.data : []);
    } catch (_) {
      setCreditsActionError("Failed. Try again.");
    } finally {
      setCreditsVerifyAllLoading(false);
    }
  }

  function updateReportsFilter(key, value) {
    setReportFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function handleReportsQuickView(viewName) {
    console.log(viewName);
  }

  function handleCommsSelectItem(item) {
    setSelectedCommsItemId(item.id);
    setCommsActionError("");
  }

  function handleCommsBodyChange(nextBody) {
    setMessageBody(nextBody);
    if (!selectedCommsItem) return;
    setMessageBodyByItem((prev) => ({
      ...prev,
      [selectedCommsItem.id]: nextBody,
    }));
  }

  function toggleRecipientSelection(userId) {
    setSelectedRecipientIds((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(userId)) nextSet.delete(userId);
      else nextSet.add(userId);
      return [...nextSet];
    });
  }

  async function handleConfirmSendComms() {
    if (!selectedCommsItem || selectedCommsItem.type === "comms-sent" || sending) return;

    const selectedIds = selectedRecipientIds.length
      ? selectedRecipientIds
      : commsRecipients.map((recipient) => recipient.userId);

    if (!selectedIds.length) {
      setCommsActionError("Please select at least one recipient.");
      return;
    }

    setSending(true);
    setCommsActionError("");

    const parsed = parseCommsEditorValue(messageBody);

    try {
      const response = await fetch("/api/org/comms/send", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          eventId: selectedCommsItem.eventId,
          type: selectedCommsItem.commsType,
          subject: parsed.subject,
          body: parsed.body,
          channel: selectedChannel,
          recipientUserIds: selectedIds.map((value) => Number.parseInt(value, 10)).filter(Number.isInteger),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "send_failed");
      }

      const nowIso = new Date().toISOString();
      const sentEntry = {
        id: `sent-${selectedCommsItem.eventId}-${Date.now()}`,
        eventId: selectedCommsItem.eventId,
        type: selectedCommsItem.commsType,
        title: selectedCommsItem.opportunityName,
        sent_at: nowIso,
        recipient_count: Number(data.sentCount) || selectedIds.length,
        channel: selectedChannel,
      };

      setCommsQueue((prev) => {
        const current = prev || { sendNow: [], dueSoon: [], upcoming: [], sentHistory: [] };
        const removeItem = (rows = [], groupKey = "") =>
          rows.filter((row) => {
            const rowKey = String(
              row?.id || `${groupKey}-${row?.eventId || row?.event_id || ""}-${row?.type || "reminder"}`
            );
            return rowKey !== String(selectedCommsItem.id);
          });
        return {
          ...current,
          sendNow: removeItem(current.sendNow, "sendNow"),
          dueSoon: removeItem(current.dueSoon, "dueSoon"),
          upcoming: removeItem(current.upcoming, "upcoming"),
          sentHistory: [sentEntry, ...(Array.isArray(current.sentHistory) ? current.sentHistory : [])],
        };
      });

      setSelectedCommsItemId(sentEntry.id);
      setShowConfirmModal(false);
      setShowToast(true);
      setSendSuccess(true);
    } catch (_) {
      setCommsActionError("Action failed. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const normalizedApplicants = useMemo(
    () =>
      (Array.isArray(applicants) ? applicants : []).map((applicant) => {
        const userId = String(applicant?.userId || applicant?.user_id || "");
        const rsvpStatus = String(
          applicant?.rsvpStatus || applicant?.rsvp_status || applicant?.status || ""
        ).toLowerCase();
        const verificationStatus = String(
          applicant?.verification_status ?? applicant?.verificationStatus ?? "pending"
        ).toLowerCase();
        const firstName = applicant?.firstname || applicant?.first_name || "";
        const lastName = applicant?.lastname || applicant?.last_name || "";
        const fullName = `${firstName} ${lastName}`.trim();
        const picture = typeof applicant?.picture === "string" && applicant.picture.trim()
          ? applicant.picture.trim()
          : typeof applicant?.avatar === "string" && applicant.avatar.trim()
            ? applicant.avatar.trim()
            : typeof applicant?.photo === "string" && applicant.photo.trim()
              ? applicant.photo.trim()
              : "";
        const ratingValueRaw = Number(applicant?.ratingValue ?? applicant?.rating_value);
        const ratingValue = Number.isFinite(ratingValueRaw) ? ratingValueRaw : 5;
        const ratingCount = safeNumber(applicant?.ratingCount ?? applicant?.rating_count, 0);
        const ratingStarsFilled = Math.max(
          1,
          Math.min(5, safeNumber(applicant?.ratingStarsFilled ?? applicant?.rating_stars_filled, Math.round(ratingValue)))
        );
        const priorityTier = String(applicant?.priorityTier || applicant?.priority_tier || "Bronze").trim() || "Bronze";
        const sdgGoals = Array.from(
          new Set(
            [
              applicant?.sdg1,
              applicant?.sdg2,
              applicant?.sdg3,
              ...(Array.isArray(applicant?.sdgGoals) ? applicant.sdgGoals : []),
            ]
              .map((value) => String(value || "").trim())
              .filter(Boolean)
          )
        );
        const locationLabel = String(
          applicant?.locationLabel
          || applicant?.location_label
          || applicant?.homeBaseLabel
          || applicant?.home_base_label
          || applicant?.city
          || ""
        ).trim() || "Location not set";
        return {
          ...applicant,
          userId,
          rsvpStatus,
          status: rsvpStatus,
          verificationStatus,
          firstName,
          lastName,
          picture,
          avatarUrl: picture || "/images/nerdy-KAI.png",
          displayName: fullName || applicant?.name || applicant?.email || "Volunteer",
          locationLabel,
          priorityTier,
          sdgGoals,
          reliabilityScore: safeNumber(applicant?.reliabilityScore ?? applicant?.reliability_score, 0),
          verifiedHours: safeNumber(applicant?.verifiedHours ?? applicant?.verified_hours_total, 0),
          ratingValue,
          ratingCount,
          ratingStarsFilled,
          pastShifts: safeNumber(applicant?.pastShifts ?? applicant?.past_shifts, 0),
          pastCredits: safeNumber(applicant?.pastCredits ?? applicant?.past_credits, 0),
        };
      }),
    [applicants]
  );

  const pendingJoinApplicants = useMemo(
    () => normalizedApplicants.filter((applicant) => applicant.rsvpStatus === "pending"),
    [normalizedApplicants]
  );

  const approvedApplicants = useMemo(
    () =>
      normalizedApplicants.filter((applicant) => {
        if (applicant.rsvpStatus === "pending" || applicant.rsvpStatus === "declined") return false;
        return (
          applicant.rsvpStatus === "accepted" ||
          applicant.rsvpStatus === "checked_in" ||
          applicant.verificationStatus === "verified"
        );
      }),
    [normalizedApplicants]
  );

  async function refreshOpportunityQueueAndDetail(opportunityId = selectedOpportunityId) {
    if (!opportunityId) return;
    await Promise.all([
      fetchQueue(),
      fetchApplicantsForOpportunity(opportunityId, { showLoading: false }),
      fetchOpportunityDetail(opportunityId, { showLoading: false }),
    ]);
  }

  function openCreateOpportunityModal() {
    setEditingOpportunityId(null);
    setShowCreateModal(true);
  }

  function openOpportunityInviteModal() {
    if (!selectedOpportunityId) return;
    setOpportunityInviteModal({
      open: true,
      email: "",
      name: "",
      sending: false,
      error: "",
    });
  }

  function openAdminSignupModal() {
    if (!selectedOpportunityId) return;
    setAdminSignupModal({
      open: true,
      name: "",
      email: "",
      sendEmail: true,
      sending: false,
      error: null,
    });
  }

  function closeOpportunityInviteModal() {
    setOpportunityInviteModal((prev) => (
      prev.sending
        ? prev
        : {
            open: false,
            email: "",
            name: "",
            sending: false,
            error: "",
        }
    ));
  }

  function closeAdminSignupModal() {
    setAdminSignupModal((prev) => (
      prev.sending
        ? prev
        : {
            open: false,
            name: "",
            email: "",
            sendEmail: true,
            sending: false,
            error: null,
          }
    ));
  }

  function openEditOpportunityModal(opportunityId) {
    if (!opportunityId) return;
    setEditingOpportunityId(String(opportunityId));
    setShowCreateModal(true);
  }

  function getNextAction(stage, detail) {
    const approved = safeNumber(detail?.approved_count ?? applicantCounts?.approvedCount, 0);
    const capacity = detail?.capacity != null ? safeNumber(detail.capacity, 0) : null;
    const pending = safeNumber(applicantCounts?.pendingJoinCount, 0);

    if (stage === "draft") {
      return {
        label: "NEXT ACTION",
        title: "Finish drafting this event",
        body: "Complete event details and add roles before publishing.",
        cta: "Continue draft",
        ctaAction: () => openEditOpportunityModal(selectedOpportunityId),
      };
    }
    if (stage === "recruiting") {
      if (pending > 0) {
        return {
          label: "NEXT ACTION",
          title: `Recruit ${pending} pending volunteer${pending !== 1 ? "s" : ""}`,
          body: `${pending} application${pending !== 1 ? "s" : ""} waiting for approval.`,
          cta: "Review now",
          ctaAction: null,
        };
      }
      return {
        label: "NEXT ACTION",
        title: "Keep recruiting",
        body: capacity ? `${approved} of ${capacity} spots filled.` : "No capacity set.",
        cta: "Invite volunteers",
        ctaAction: openOpportunityInviteModal,
      };
    }
    if (stage === "live") {
      return {
        label: "NEXT ACTION",
        title: "Event is live",
        body: "Check in volunteers as they arrive.",
        cta: "Open check-in",
        ctaAction: null,
      };
    }
    if (stage === "closing_out") {
      return {
        label: "NEXT ACTION",
        title: "Capture beneficiary reach",
        body: "Enter total participants and equity-group estimates.",
        cta: "Start close-out",
        ctaAction: () => setCloseoutModal((prev) => ({ ...prev, open: true })),
      };
    }
    if (stage === "reported") {
      return {
        label: "NEXT ACTION",
        title: "Report submitted",
        body: "Final report has been submitted.",
        cta: "View report",
        ctaAction: null,
      };
    }
    return {
      label: "NEXT ACTION",
      title: "No action required",
      body: "",
      cta: null,
      ctaAction: null,
    };
  }

  async function submitCloseout() {
    const projectId = selectedOpportunityDetail?.project_id;
    if (!projectId) {
      setCloseoutModal((prev) => ({
        ...prev,
        error: "This event is not linked to a project. Assign it to a project before closing out.",
      }));
      return;
    }

    setCloseoutModal((prev) => ({ ...prev, saving: true, error: "" }));

    const equityBreakdown = closeoutModal.equityRows
      .filter((row) => row.checked)
      .reduce((acc, row) => {
        acc[row.group] = row.pct ? Number(row.pct) : null;
        return acc;
      }, {});

    try {
      const patchRes = await fetch(`/api/org/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          beneficiaryCount: closeoutModal.beneficiaryCount
            ? Number(closeoutModal.beneficiaryCount)
            : null,
          beneficiaryEquityBreakdown: equityBreakdown,
        }),
      });
      if (!patchRes.ok) {
        throw new Error(await parseOrgPortalApiError(patchRes, "Could not save beneficiary data."));
      }

      const lifecycleRes = await fetch(
        `/api/org/projects/${encodeURIComponent(projectId)}/lifecycle`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({ stage: "reported" }),
        }
      );
      if (!lifecycleRes.ok) {
        throw new Error(
          await parseOrgPortalApiError(lifecycleRes, "Could not transition lifecycle.")
        );
      }

      setCloseoutModal({ open: false, ...CLOSEOUT_EMPTY });
      await fetchOpportunityDetail(selectedOpportunityId, { showLoading: false });
    } catch (error) {
      setCloseoutModal((prev) => ({
        ...prev,
        saving: false,
        error: error?.message || "Close-out failed. Please try again.",
      }));
    }
  }

  function openCancelOpportunityModal() {
    if (!selectedOpportunityId) return;
    const isDraftOpportunity = String(selectedOpportunity?.type || "").toLowerCase() === "opp-draft";
    setCancelModalTarget({
      source: "opportunities",
      eventId: String(selectedOpportunityId),
      isDraft: isDraftOpportunity,
      title: selectedOpportunity?.opportunityName || "Opportunity",
      opportunity: selectedOpportunity ? { ...selectedOpportunity } : null,
    });
    setCancelError("");
    setForceCancelMode(false);
    setForceCancelConfirmed(false);
    setShowCancelModal(true);
  }

  async function confirmCancelOpportunity() {
    const target = cancelModalTarget;
    if (!target?.eventId) return;
    const targetEventId = String(target.eventId);
    const isDraftOpportunity = Boolean(target.isDraft);
    setCancelLoading(true);
    setCancelError("");

    try {
      const endpoint = isDraftOpportunity
        ? `/api/events/${encodeURIComponent(targetEventId)}`
        : `/api/events/${encodeURIComponent(targetEventId)}/cancel`;
      const response = await fetch(endpoint, {
        method: isDraftOpportunity ? "DELETE" : "POST",
        credentials: "include",
        headers: {
          ...(isDraftOpportunity ? {} : { "Content-Type": "application/json" }),
          "X-CSRF-Token": csrfToken,
        },
        ...(isDraftOpportunity ? {} : { body: JSON.stringify({}) }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(
          payload?.error || (isDraftOpportunity ? "Unable to delete draft." : "Unable to cancel event.")
        );
      }

      if (isDraftOpportunity) {
        if (target.source === "opportunities") {
          setQueue((prev) => {
            if (!prev) return prev;
            const removeEvent = (rows = []) =>
              rows.filter((row) => String(row?.opportunityId || "") !== targetEventId);
            const nextQueue = {
              ...prev,
              needsAttention: removeEvent(prev.needsAttention),
              upcoming: removeEvent(prev.upcoming),
              active: removeEvent(prev.active),
              drafts: removeEvent(prev.drafts),
              completed: removeEvent(prev.completed),
              cancelled: removeEvent(prev.cancelled),
            };
            const remainingCount =
              nextQueue.needsAttention.length +
              nextQueue.upcoming.length +
              nextQueue.active.length +
              nextQueue.drafts.length +
              nextQueue.completed.length +
              nextQueue.cancelled.length;
            nextQueue.hasOpportunities = remainingCount > 0;
            return nextQueue;
          });

          setCheckinQueueItems((prev) =>
            (Array.isArray(prev) ? prev : []).filter(
              (item) => String(item?.opportunityId || "") !== targetEventId
            )
          );

          setSelectedQueueItem(null);
          setApplicants(null);
          setApplicantCounts(ZERO_PENDING_ACTION_COUNTS);
          setDetailError("");
          setActionError("");
          setShowCancelModal(false);
          setCancelModalTarget(null);
          return;
        }

        if (target.source === "myevents") {
          if (String(selectedMyEvent?.id || "") === targetEventId) {
            setSelectedMyEvent(null);
          }
          setMyEventsToast({ type: "success", message: "Draft deleted." });
          await refreshMyEventsData();
          void fetchQueue();
          setShowCancelModal(false);
          setCancelModalTarget(null);
          return;
        }
      }

      const cancelledItem = {
        id: `cancelled-${targetEventId}`,
        tab: "opportunities",
        type: "opp-cancelled",
        opportunityId: targetEventId,
        opportunityName: target?.opportunity?.opportunityName || target?.title || "Cancelled event",
        label: target?.opportunity?.opportunityName || target?.title || "Cancelled event",
        icon: "fa-ban",
        startTime: target?.opportunity?.startTime || null,
        endTime: target?.opportunity?.endTime || null,
        timeZone: target?.opportunity?.timeZone || "America/Vancouver",
        pendingCount: 0,
        approvedCount: safeNumber(target?.opportunity?.approvedCount, 0),
        capacity: target?.opportunity?.capacity == null ? null : safeNumber(target?.opportunity?.capacity, null),
      };

      if (target.source === "opportunities") {
        setQueue((prev) => {
          if (!prev) return prev;
          const removeEvent = (rows = []) =>
            rows.filter((row) => String(row?.opportunityId || "") !== targetEventId);
          const remainingCancelled = removeEvent(prev.cancelled || []);
          return {
            ...prev,
            needsAttention: removeEvent(prev.needsAttention),
            upcoming: removeEvent(prev.upcoming),
            active: removeEvent(prev.active),
            drafts: removeEvent(prev.drafts),
            completed: removeEvent(prev.completed),
            cancelled: [cancelledItem, ...remainingCancelled],
            hasOpportunities: true,
          };
        });

        setCheckinQueueItems((prev) =>
          (Array.isArray(prev) ? prev : []).filter(
            (item) => String(item?.opportunityId || "") !== targetEventId
          )
        );

        setSelectedQueueItem(cancelledItem);
        setShowCancelModal(false);
        setCancelModalTarget(null);
        setCancelledExpanded(true);
        return;
      }

      if (target.source === "myevents") {
        if (String(selectedMyEvent?.id || "") === targetEventId) {
          setSelectedMyEvent(null);
        }
        setMyEventsToast({ type: "success", message: "Event cancelled." });
        await refreshMyEventsData();
        void fetchQueue();
        setShowCancelModal(false);
        setCancelModalTarget(null);
      }
    } catch (error) {
      const msg = error?.message || (isDraftOpportunity ? "Unable to delete draft." : "Unable to cancel event.");
      if (msg === "Event already started or past") {
        setForceCancelMode(true);
        setCancelError("");
      } else {
        setCancelError(msg);
      }
    } finally {
      setCancelLoading(false);
    }
  }

  async function confirmForceCancelOpportunity() {
    const target = cancelModalTarget;
    if (!target?.eventId) return;
    const targetEventId = String(target.eventId);
    setCancelLoading(true);
    setCancelError("");

    try {
      const response = await fetch(`/api/events/${encodeURIComponent(targetEventId)}/force-cancel`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({}),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "Unable to force cancel event.");
      }

      const cancelledItem = {
        id: `cancelled-${targetEventId}`,
        tab: "opportunities",
        type: "opp-cancelled",
        opportunityId: targetEventId,
        opportunityName: target?.opportunity?.opportunityName || target?.title || "Cancelled event",
        label: target?.opportunity?.opportunityName || target?.title || "Cancelled event",
        icon: "fa-ban",
        startTime: target?.opportunity?.startTime || null,
        endTime: target?.opportunity?.endTime || null,
        timeZone: target?.opportunity?.timeZone || "America/Vancouver",
        pendingCount: 0,
        approvedCount: safeNumber(target?.opportunity?.approvedCount, 0),
        capacity: target?.opportunity?.capacity == null ? null : safeNumber(target?.opportunity?.capacity, null),
      };

      if (target.source === "opportunities") {
        setQueue((prev) => {
          if (!prev) return prev;
          const removeEvent = (rows = []) =>
            rows.filter((row) => String(row?.opportunityId || "") !== targetEventId);
          const remainingCancelled = removeEvent(prev.cancelled || []);
          return {
            ...prev,
            needsAttention: removeEvent(prev.needsAttention),
            upcoming: removeEvent(prev.upcoming),
            active: removeEvent(prev.active),
            drafts: removeEvent(prev.drafts),
            completed: removeEvent(prev.completed),
            cancelled: [cancelledItem, ...remainingCancelled],
            hasOpportunities: true,
          };
        });
        setCheckinQueueItems((prev) =>
          (Array.isArray(prev) ? prev : []).filter(
            (item) => String(item?.opportunityId || "") !== targetEventId
          )
        );
        setSelectedQueueItem(cancelledItem);
        setShowCancelModal(false);
        setCancelModalTarget(null);
        setForceCancelMode(false);
        setForceCancelConfirmed(false);
        setCancelledExpanded(true);
        return;
      }

      if (target.source === "myevents") {
        if (String(selectedMyEvent?.id || "") === targetEventId) {
          setSelectedMyEvent(null);
        }
        setMyEventsToast({ type: "success", message: "Event cancelled." });
        await refreshMyEventsData();
        void fetchQueue();
        setShowCancelModal(false);
        setCancelModalTarget(null);
        setForceCancelMode(false);
        setForceCancelConfirmed(false);
      }
    } catch (error) {
      setCancelError(error?.message || "Unable to force cancel event.");
    } finally {
      setCancelLoading(false);
    }
  }

  async function submitOpportunityInvite(event) {
    event?.preventDefault?.();
    const inviteEmail = String(opportunityInviteModal.email || "").trim();
    const inviteName = String(opportunityInviteModal.name || "").trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail);

    if (!selectedOpportunityId || !emailValid || opportunityInviteModal.sending) {
      setOpportunityInviteModal((prev) => ({
        ...prev,
        error: emailValid ? prev.error : "Enter a valid email address.",
      }));
      return;
    }

    setOpportunityInviteModal((prev) => ({ ...prev, sending: true, error: "" }));

    try {
      const response = await fetch(`/api/events/${encodeURIComponent(selectedOpportunityId)}/invites`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          invitee_email: inviteEmail,
          invitee_name: inviteName,
          invite_style: "org_portal",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "Unable to send invite.");
      }
      const recipientLabel = payload?.data?.invitee_name || payload?.data?.invitee_email || inviteEmail;
      setOpportunityInviteNotice({ type: "success", message: `Invite sent to ${recipientLabel}.` });
      setOpportunityInviteModal({
        open: false,
        email: "",
        name: "",
        sending: false,
        error: "",
      });
    } catch (error) {
      setOpportunityInviteModal((prev) => ({
        ...prev,
        sending: false,
        error: error?.message || "Unable to send invite.",
      }));
    }
  }

  async function submitAdminSignup(event) {
    event?.preventDefault?.();
    const signupName = String(adminSignupModal.name || "").trim();
    const signupEmail = String(adminSignupModal.email || "").trim();
    const emailValid = !signupEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupEmail);

    if (!selectedOpportunityId || !signupName || !emailValid || adminSignupModal.sending) {
      setAdminSignupModal((prev) => ({
        ...prev,
        error: !signupName
          ? "Enter the volunteer's name."
          : emailValid
            ? prev.error
            : "Enter a valid email address.",
      }));
      return;
    }

    setAdminSignupModal((prev) => ({ ...prev, sending: true, error: null }));

    try {
      const body = {
        invitee_name: signupName,
        send_email: Boolean(signupEmail) && Boolean(adminSignupModal.sendEmail),
      };
      if (signupEmail) {
        body.invitee_email = signupEmail;
      }

      const response = await fetch(`/api/events/${encodeURIComponent(selectedOpportunityId)}/admin-signup`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "Unable to sign up volunteer.");
      }

      await refreshOpportunityQueueAndDetail(selectedOpportunityId);
      setOpportunityInviteNotice({ type: "success", message: "Volunteer signed up successfully." });
      setAdminSignupModal({
        open: false,
        name: "",
        email: "",
        sendEmail: true,
        sending: false,
        error: null,
      });
    } catch (error) {
      setAdminSignupModal((prev) => ({
        ...prev,
        sending: false,
        error: error?.message || "Unable to sign up volunteer.",
      }));
    }
  }

  async function handleApplicantAction(userId, action) {
    if (!selectedOpportunityId || !userId) return false;

    setActionLoadingByUser((prev) => ({ ...prev, [userId]: true }));
    setActionError("");

    try {
      const response = await fetch(
        `/api/org/opportunities/${encodeURIComponent(selectedOpportunityId)}/applicants/${encodeURIComponent(userId)}/${action}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({}),
        }
      );

      if (!response.ok) throw new Error("action_failed");
      const payload = await response.json().catch(() => ({}));
      if (payload.skipped === true) {
        setActionError("This volunteer's attendance was already verified. No IC was awarded.");
        return false;
      }
      await refreshOpportunityQueueAndDetail(selectedOpportunityId);
      return true;
    } catch (_) {
      setActionError("Failed. Try again.");
      return false;
    } finally {
      setActionLoadingByUser((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }
  }

  function openApprovedDeclineModal(applicant) {
    setActionError("");
    setApprovedDeclineModal({ open: true, applicant });
  }

  async function confirmApprovedVolunteerDecline() {
    const targetUserId = String(approvedDeclineModal?.applicant?.userId || "");
    if (!targetUserId) return;
    const ok = await handleApplicantAction(targetUserId, "decline");
    if (ok) {
      setApprovedDeclineModal({ open: false, applicant: null });
    }
  }

  async function handleApproveAll() {
    if (!selectedOpportunityId || !pendingJoinApplicants.length) return;

    setApproveAllLoading(true);
    setActionError("");
    setApproveAllProgress({ current: 0, total: pendingJoinApplicants.length });

    const pendingIds = pendingJoinApplicants.map((applicant) => String(applicant.userId));
    const loadingMap = {};
    pendingIds.forEach((id) => {
      loadingMap[id] = true;
    });
    setActionLoadingByUser((prev) => ({ ...prev, ...loadingMap }));

    try {
      let completed = 0;
      const succeeded = [];

      for (const userId of pendingIds) {
        const response = await fetch(
          `/api/org/opportunities/${encodeURIComponent(selectedOpportunityId)}/applicants/${encodeURIComponent(userId)}/approve`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken,
            },
            body: JSON.stringify({}),
          }
        );

        completed += 1;
        setApproveAllProgress({ current: completed, total: pendingIds.length });

        if (!response.ok) {
          setActionError("Failed. Try again.");
          continue;
        }

        succeeded.push(userId);
      }

      await refreshOpportunityQueueAndDetail(selectedOpportunityId);
    } catch (_) {
      setActionError("Failed. Try again.");
    } finally {
      setApproveAllLoading(false);
      setApproveAllProgress({ current: 0, total: 0 });
      setActionLoadingByUser({});
    }
  }

  function openApproveAllConfirm() {
    setActionError("");
    setApproveAllConfirmOpen(true);
  }

  function openApplicantProfileModal(applicant) {
    if (!applicant) return;
    setApplicantProfileModal({ open: true, applicant });
  }

  function closeApplicantProfileModal() {
    setApplicantProfileModal({ open: false, applicant: null });
  }

  const fetchProgramsProjects = useCallback(async () => {
    setProgramsProjectsLoading(true);
    setProgramsProjectsError("");
    try {
      const [programsResponse, projectsResponse] = await Promise.all([
        fetch("/api/org/programs?limit=100", { credentials: "include" }),
        fetch("/api/org/projects?limit=100", { credentials: "include" }),
      ]);
      if (!programsResponse.ok) {
        throw new Error(await parseOrgPortalApiError(programsResponse, "Could not load programs."));
      }
      if (!projectsResponse.ok) {
        throw new Error(await parseOrgPortalApiError(projectsResponse, "Could not load projects."));
      }
      const [programsPayload, projectsPayload] = await Promise.all([
        programsResponse.json(),
        projectsResponse.json(),
      ]);
      const nextPrograms = Array.isArray(programsPayload?.programs) ? programsPayload.programs : [];
      const nextProjects = Array.isArray(projectsPayload?.projects) ? projectsPayload.projects : [];
      setPrograms(nextPrograms);
      setProjects(nextProjects);
      setSelectedProgramId((current) => (
        current && !nextPrograms.some((program) => String(program.id) === String(current)) ? "" : current
      ));

      const metricsEntries = await Promise.all(
        nextProjects.map(async (project) => {
          if (!project?.id) return null;
          const response = await fetch(`/api/org/projects/${encodeURIComponent(project.id)}/metrics`, {
            credentials: "include",
          });
          if (!response.ok) return [String(project.id), null];
          const payload = await response.json().catch(() => ({}));
          return [String(project.id), payload?.metrics || null];
        })
      );
      setProjectMetricsById(Object.fromEntries(metricsEntries.filter(Boolean)));
    } catch (error) {
      setPrograms([]);
      setProjects([]);
      setProjectMetricsById({});
      setProgramsProjectsError(error?.message || "Could not load programs and projects.");
    } finally {
      setProgramsProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "programsProjects") return;
    fetchProgramsProjects();
  }, [activeTab, fetchProgramsProjects]);

  function showProgramsProjectsToast(type, message) {
    setProgramsProjectsToast({ type, message });
  }

  function closeProgramFormModal() {
    if (programFormModal.saving) return;
    setProgramFormModal({ open: false, mode: "create", program: null, values: PROGRAM_FORM_EMPTY, error: "", saving: false });
  }

  function closeProjectFormModal() {
    if (projectFormModal.saving) return;
    setProjectFormModal({ open: false, mode: "create", project: null, values: PROJECT_FORM_EMPTY, error: "", saving: false });
  }

  function openCreateProgramModal() {
    setProgramMenuId("");
    setProgramFormModal({ open: true, mode: "create", program: null, values: PROGRAM_FORM_EMPTY, error: "", saving: false });
  }

  function openEditProgramModal(program) {
    if (!program) return;
    setProgramMenuId("");
    setProgramFormModal({ open: true, mode: "edit", program, values: programToForm(program), error: "", saving: false });
  }

  function openCreateProjectModal() {
    setProjectMenuId("");
    setProjectFormModal({
      open: true,
      mode: "create",
      project: null,
      values: { ...PROJECT_FORM_EMPTY, programId: selectedProgramId || "" },
      error: "",
      saving: false,
    });
  }

  function openEditProjectModal(project) {
    if (!project) return;
    setProjectMenuId("");
    setProjectFormModal({ open: true, mode: "edit", project, values: projectToForm(project), error: "", saving: false });
  }

  function updateProgramFormValue(key, value) {
    setProgramFormModal((prev) => ({
      ...prev,
      error: "",
      values: { ...prev.values, [key]: value },
    }));
  }

  function updateProjectFormValue(key, value) {
    setProjectFormModal((prev) => ({
      ...prev,
      error: "",
      values: { ...prev.values, [key]: value },
    }));
  }

  function toggleProgramEquityGroup(group) {
    setProgramFormModal((prev) => {
      const current = Array.isArray(prev.values.intendedEquityGroups) ? prev.values.intendedEquityGroups : [];
      const nextGroups = current.includes(group)
        ? current.filter((item) => item !== group)
        : [...current, group];
      return { ...prev, error: "", values: { ...prev.values, intendedEquityGroups: nextGroups } };
    });
  }

  function toggleProjectLanguage(language) {
    setProjectFormModal((prev) => {
      const current = Array.isArray(prev.values.languages) ? prev.values.languages : [];
      const nextLanguages = current.includes(language)
        ? current.filter((item) => item !== language)
        : [...current, language];
      return { ...prev, error: "", values: { ...prev.values, languages: nextLanguages } };
    });
  }

  async function submitProgramForm(event) {
    event.preventDefault();
    const values = programFormModal.values || PROGRAM_FORM_EMPTY;
    if (!String(values.name || "").trim()) {
      setProgramFormModal((prev) => ({ ...prev, error: "Name is required." }));
      return;
    }

    setProgramFormModal((prev) => ({ ...prev, saving: true, error: "" }));
    const body = {
      name: values.name.trim(),
      description: values.description || null,
      funder: values.funder || null,
      reportingPeriodStart: values.reportingPeriodStart || null,
      reportingPeriodEnd: values.reportingPeriodEnd || null,
      intendedEquityGroups: Array.isArray(values.intendedEquityGroups) ? values.intendedEquityGroups : [],
    };
    const isEdit = programFormModal.mode === "edit" && programFormModal.program?.id;
    try {
      const response = await fetch(isEdit
        ? `/api/org/programs/${encodeURIComponent(programFormModal.program.id)}`
        : "/api/org/programs", {
        method: isEdit ? "PATCH" : "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(await parseOrgPortalApiError(response, "Program could not be saved."));
      }
      closeProgramFormModal();
      showProgramsProjectsToast("success", isEdit ? "Program saved." : "Program created.");
      await fetchProgramsProjects();
    } catch (error) {
      setProgramFormModal((prev) => ({ ...prev, saving: false, error: error?.message || "Program could not be saved." }));
    }
  }

  async function submitProjectForm(event) {
    event.preventDefault();
    const values = projectFormModal.values || PROJECT_FORM_EMPTY;
    if (!String(values.name || "").trim()) {
      setProjectFormModal((prev) => ({ ...prev, error: "Name is required." }));
      return;
    }

    setProjectFormModal((prev) => ({ ...prev, saving: true, error: "" }));
    const body = {
      name: values.name.trim(),
      programId: values.programId || null,
      description: values.description || null,
      startDate: values.startDate || null,
      endDate: values.endDate || null,
      languages: Array.isArray(values.languages) ? values.languages : [],
      partnerOrgIds: [],
    };
    const isEdit = projectFormModal.mode === "edit" && projectFormModal.project?.id;
    try {
      const response = await fetch(isEdit
        ? `/api/org/projects/${encodeURIComponent(projectFormModal.project.id)}`
        : "/api/org/projects", {
        method: isEdit ? "PATCH" : "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(await parseOrgPortalApiError(response, "Project could not be saved."));
      }
      closeProjectFormModal();
      showProgramsProjectsToast("success", isEdit ? "Project saved." : "Project created.");
      await fetchProgramsProjects();
    } catch (error) {
      setProjectFormModal((prev) => ({ ...prev, saving: false, error: error?.message || "Project could not be saved." }));
    }
  }

  async function archiveProgram(program) {
    if (!program?.id) return;
    setProgramMenuId("");
    try {
      const response = await fetch(`/api/org/programs/${encodeURIComponent(program.id)}/archive`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(await parseOrgPortalApiError(response, "Program could not be archived."));
      }
      showProgramsProjectsToast("success", "Program archived.");
      await fetchProgramsProjects();
    } catch (error) {
      showProgramsProjectsToast("error", error?.message || "Program could not be archived.");
    }
  }

  function openProgramDeleteConfirm(program) {
    setProgramMenuId("");
    setProgramsProjectsConfirm({ open: true, type: "program-delete", item: program, error: "", saving: false });
  }

  function openProjectDeleteConfirm(project) {
    setProjectMenuId("");
    setProgramsProjectsConfirm({ open: true, type: "project-delete", item: project, error: "", saving: false });
  }

  async function confirmProgramsProjectsDelete() {
    const target = programsProjectsConfirm.item;
    if (!target?.id) return;
    const isProgram = programsProjectsConfirm.type === "program-delete";
    setProgramsProjectsConfirm((prev) => ({ ...prev, saving: true, error: "" }));
    try {
      const response = await fetch(`/api/org/${isProgram ? "programs" : "projects"}/${encodeURIComponent(target.id)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRF-Token": csrfToken },
      });
      if (!response.ok) {
        if (response.status === 409) {
          throw new Error(isProgram
            ? "Cannot delete this program while projects are linked. Move or delete the projects first."
            : "Cannot delete this project while events or roles are linked. Reassign or delete them first.");
        }
        throw new Error(await parseOrgPortalApiError(response, `${isProgram ? "Program" : "Project"} could not be deleted.`));
      }
      setProgramsProjectsConfirm({ open: false, type: "", item: null, error: "", saving: false });
      if (isProgram && String(selectedProgramId) === String(target.id)) {
        setSelectedProgramId("");
      }
      showProgramsProjectsToast("success", `${isProgram ? "Program" : "Project"} deleted.`);
      await fetchProgramsProjects();
    } catch (error) {
      setProgramsProjectsConfirm((prev) => ({ ...prev, saving: false, error: error?.message || "Delete failed." }));
    }
  }

  function openLifecycleModal(project) {
    if (!project) return;
    setProjectMenuId("");
    setProjectLifecycleModal({ open: true, project, error: "", savingStage: "" });
  }

  async function transitionProjectLifecycle(stage) {
    const project = projectLifecycleModal.project;
    if (!project?.id || !stage) return;
    setProjectLifecycleModal((prev) => ({ ...prev, error: "", savingStage: stage }));
    try {
      const response = await fetch(`/api/org/projects/${encodeURIComponent(project.id)}/lifecycle`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ stage }),
      });
      if (!response.ok) {
        throw new Error(await parseOrgPortalApiError(response, "Lifecycle could not be updated."));
      }
      setProjectLifecycleModal({ open: false, project: null, error: "", savingStage: "" });
      showProgramsProjectsToast("success", "Project lifecycle updated.");
      await fetchProgramsProjects();
    } catch (error) {
      setProjectLifecycleModal((prev) => ({
        ...prev,
        savingStage: "",
        error: error?.message || "Lifecycle could not be updated.",
      }));
    }
  }

  function showProjectComingSoon(project) {
    showProgramsProjectsToast("info", `${project?.name || "Project"} detail coming soon.`);
  }

  function getProgramProjectCount(programId) {
    return projects.filter((project) => String(project?.program_id || "") === String(programId || "")).length;
  }

  function getProgramName(programId) {
    if (!programId) return "";
    return programs.find((program) => String(program.id) === String(programId))?.name || "";
  }

  function renderProgramStatusBadge(status) {
    const key = String(status || "active").toLowerCase();
    return (
      <span className={`gk-program-status-pill gk-program-${key}`}>{PROGRAM_STATUS_LABELS[key] || key}</span>
    );
  }

  function renderProjectLifecycleBadge(stage) {
    const key = String(stage || "draft").toLowerCase();
    return (
      <span className={`gk-stage-pill gk-stage-${key}`}>{PROJECT_LIFECYCLE_LABELS[key] || key}</span>
    );
  }

  function renderProgramActions(program) {
    const isOpen = String(programMenuId) === String(program.id);
    return (
      <div className="gk-action-menu-wrap" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="btn btn-sm btn-link text-muted p-0"
          style={{ width: 30, height: 30, lineHeight: 1, textDecoration: "none" }}
          aria-label={`Actions for ${program.name || "program"}`}
          onClick={() => setProgramMenuId(isOpen ? "" : String(program.id))}
        >
          <i className="fas fa-ellipsis-vertical" aria-hidden="true"></i>
        </button>
        {isOpen ? (
          <div className="gk-action-menu">
            <button type="button" onClick={() => openEditProgramModal(program)}>Edit</button>
            <button type="button" onClick={() => archiveProgram(program)}>Archive</button>
            <button type="button" className="text-danger" onClick={() => openProgramDeleteConfirm(program)}>Delete</button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderProjectActions(project) {
    const isOpen = String(projectMenuId) === String(project.id);
    return (
      <div className="gk-action-menu-wrap" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="btn btn-sm btn-link text-muted p-0"
          style={{ width: 30, height: 30, lineHeight: 1, textDecoration: "none" }}
          aria-label={`Actions for ${project.name || "project"}`}
          onClick={() => setProjectMenuId(isOpen ? "" : String(project.id))}
        >
          <i className="fas fa-ellipsis-vertical" aria-hidden="true"></i>
        </button>
        {isOpen ? (
          <div className="gk-action-menu">
            <button type="button" onClick={() => openEditProjectModal(project)}>Edit</button>
            <button type="button" onClick={() => openLifecycleModal(project)}>Transition lifecycle</button>
            <button type="button" className="text-danger" onClick={() => openProjectDeleteConfirm(project)}>Delete</button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderProgramsPanel() {
    if (programsProjectsLoading && !programs.length && !projects.length) {
      return (
        <div className="d-flex justify-content-center py-4">
          <div className="spinner-border" role="status" aria-label="Loading programs and projects"></div>
        </div>
      );
    }

    return (
      <div>
        <div className="d-flex justify-content-between align-items-center gap-2 mb-3">
          <h3 className="orgp-opp-title mb-0">Programs</h3>
          <button type="button" className="btn btn-sm gk-btn-coral" onClick={openCreateProgramModal}>
            + New program
          </button>
        </div>

        {programsProjectsError ? (
          <div className="alert alert-warning py-2 small" role="alert">
            {programsProjectsError}
            <button type="button" className="btn btn-link btn-sm p-0 ms-2 orgp-link-btn" onClick={fetchProgramsProjects}>
              Retry
            </button>
          </div>
        ) : null}

        {!programs.length && !programsProjectsLoading ? (
          <div className="gk-empty py-4">
            <p className="text-muted small mb-0">
              No programs yet. Create one to bundle related projects under a grant or initiative.
            </p>
          </div>
        ) : (
          <div>
            {programs.map((program) => {
              const isSelected = String(selectedProgramId) === String(program.id);
              return (
                <div
                  key={`program-${program.id}`}
                  className="gk-card"
                  style={isSelected ? { borderLeft: "3px solid var(--gk-coral)", background: "#fff9f9" } : undefined}
                >
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <button
                      type="button"
                      className="btn btn-link p-0 text-start fw-bold"
                      style={{ color: "var(--gk-slate)" }}
                      onClick={() => setSelectedProgramId(isSelected ? "" : String(program.id))}
                    >
                      {program.name || "Untitled program"}
                    </button>
                    {renderProgramActions(program)}
                  </div>
                  <div className="d-flex align-items-center gap-2 flex-wrap mt-2">
                    {renderProgramStatusBadge(program.status)}
                    <span className="small text-muted">{pluralizeProgramProject(getProgramProjectCount(program.id), "project")}</span>
                  </div>
                  {program.funder ? (
                    <div className="small text-muted mt-1">
                      Funder: <strong>{program.funder}</strong>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderProjectsPanel() {
    const selectedProgram = selectedProgramId
      ? programs.find((program) => String(program.id) === String(selectedProgramId))
      : null;
    const visibleProjects = selectedProgramId
      ? projects.filter((project) => String(project?.program_id || "") === String(selectedProgramId))
      : projects;
    const emptyText = selectedProgram
      ? "No projects under this program yet."
      : "No projects yet. Create your first project to start organizing events.";

    if (programsProjectsLoading && !programs.length && !projects.length) {
      return (
        <div className="d-flex justify-content-center py-4">
          <div className="spinner-border" role="status" aria-label="Loading projects"></div>
        </div>
      );
    }

    return (
      <div>
        <div className="d-flex justify-content-between align-items-start gap-2 mb-3">
          <div>
            <h3 className="orgp-opp-title mb-0">
              {selectedProgram ? `Projects in ${selectedProgram.name}` : "Projects"}
            </h3>
            {selectedProgram ? (
              <button
                type="button"
                className="btn btn-link btn-sm p-0"
                style={{ color: "var(--gk-slate)" }}
                onClick={() => setSelectedProgramId("")}
              >
                Show all projects
              </button>
            ) : null}
          </div>
          <button type="button" className="btn btn-sm gk-btn-coral" onClick={openCreateProjectModal}>
            + New project
          </button>
        </div>

        {!visibleProjects.length && !programsProjectsLoading ? (
          <div className="gk-empty py-4">
            <p className="text-muted small mb-0">{emptyText}</p>
          </div>
        ) : (
          <div className="d-grid gap-2">
            {visibleProjects.map((project) => {
              const metrics = projectMetricsById[String(project.id)] || {};
              const programName = getProgramName(project.program_id);
              return (
                <div key={`project-${project.id}`} className="gk-card mb-2">
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="btn btn-link p-0 text-start fw-bold"
                        style={{ color: "var(--gk-slate)" }}
                        onClick={() => showProjectComingSoon(project)}
                      >
                        {project.name || "Untitled project"}
                      </button>
                      <div className="d-flex align-items-center gap-2 flex-wrap mt-1">
                        {renderProjectLifecycleBadge(project.lifecycle_stage)}
                        {programName ? <span className="badge text-bg-light border">{programName}</span> : null}
                      </div>
                    </div>
                    {renderProjectActions(project)}
                  </div>
                  <div className="small text-muted mt-2">{formatProjectDateRange(project)}</div>
                  <div className="small text-muted mt-1">
                    {safeNumber(metrics.total_events, 0)} events · {safeNumber(metrics.total_verified_hours, 0)} verified hours
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function formatMyEventsListDate(startAt, timeZone) {
    if (!startAt) return "Date TBD";
    return formatDateTimeInZone(startAt, timeZone || "America/Vancouver", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatLocationShort(locationText) {
    if (!locationText || typeof locationText !== "string") return "Location TBD";
    const parts = locationText
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) return "Location TBD";
    return parts.slice(0, 2).join(", ");
  }

  function selectMyEvent(eventRow) {
    if (!eventRow) return;
    setSelectedMyEvent(eventRow);
  }

  async function refreshMyEventsData() {
    await Promise.all([fetchMyEventsPoolSummary(), fetchMyEvents()]);
    if (selectedMyEvent?.funding_pool_slug) {
      fetchMyEventsLedgerPreview(selectedMyEvent.funding_pool_slug);
    }
  }

  function openMyEventsInvite(eventRow) {
    if (!eventRow?.id) return;
    setMyEventsInviteModal({ open: true, event: eventRow });
  }

  async function handleMyEventCancel(eventRow) {
    if (!eventRow?.id) return;
    const isDraftEvent = String(eventRow?.status || "").toLowerCase() === "draft";
    setCancelModalTarget({
      source: "myevents",
      eventId: String(eventRow.id),
      isDraft: isDraftEvent,
      title: eventRow?.title || "Event",
      event: eventRow,
    });
    setCancelError("");
    setForceCancelMode(false);
    setForceCancelConfirmed(false);
    setShowCancelModal(true);
  }

  async function handleMyEventComplete(eventRow) {
    if (!eventRow?.id) return;
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventRow.id)}/complete`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "Unable to complete event.");
      }
      setMyEventsToast({ type: "success", message: "Event marked as completed." });
      await refreshMyEventsData();
    } catch (error) {
      setMyEventsToast({ type: "error", message: error?.message || "Unable to mark event completed." });
    }
  }

  async function copyMyEventLink(eventRow) {
    if (!eventRow?.id) return;
    try {
      const url = `${window.location.origin}/events/${encodeURIComponent(eventRow.id)}`;
      await navigator?.clipboard?.writeText(url);
      setMyEventsToast({ type: "success", message: "Event link copied." });
    } catch {
      setMyEventsToast({ type: "error", message: "Clipboard unavailable. Copy manually." });
    }
  }

  function showMyEventQrToast() {
    setMyEventsToast({ type: "info", message: "QR tools coming soon." });
  }

  function renderMyEventsPoolTile(label, value, { warning = false, compact = false } = {}) {
    return (
      <div className={`orgp-my-tile ${compact ? "orgp-my-tile-compact" : ""} ${warning ? "orgp-my-tile-warning" : ""}`}>
        <div className="orgp-my-tile-label">{label}</div>
        <div className="orgp-my-tile-value">{safeNumber(value, 0)}</div>
      </div>
    );
  }

  function renderMyEventsPoolHealthGrid({ compact = false } = {}) {
    return (
      <div className={`orgp-my-tile-grid ${compact ? "orgp-my-tile-grid-compact" : ""}`}>
        {renderMyEventsPoolTile("Pool Balance", myEventsSummary.pool_credits_remaining, { compact })}
        {renderMyEventsPoolTile("Funded Credits", myEventsSummary.funded_credits_total, { compact })}
        {renderMyEventsPoolTile("Pending Deficit", myEventsSummary.deficit_credits_total, {
          compact,
          warning: safeNumber(myEventsSummary.deficit_credits_total, 0) > 0,
        })}
        {renderMyEventsPoolTile("Events in Pool", myEventsSummary.events_count, { compact })}
      </div>
    );
  }

  function renderMyEventsFundingIndicator(eventRow) {
    const verified = safeNumber(eventRow?.verified_credits_total, 0);
    const funded = safeNumber(eventRow?.funded_credits_total, 0);
    const deficit = safeNumber(eventRow?.deficit_credits_total, 0);
    if (deficit > 0) {
      return (
        <span className="orgp-my-funding-warn">
          <i className="fas fa-triangle-exclamation me-1" aria-hidden="true"></i>
          {deficit}
        </span>
      );
    }
    if (verified > 0 && funded >= verified) {
      return (
        <span className="orgp-my-funding-good">
          <i className="fas fa-check me-1" aria-hidden="true"></i>✓
        </span>
      );
    }
    return <span className="text-muted">—</span>;
  }

  function renderMyEventsQueue() {
    if (myEventsLoading) {
      return (
        <div className="d-flex justify-content-center py-4">
          <div className="spinner-border" role="status" aria-label="Loading events"></div>
        </div>
      );
    }

    if (!myEvents.length) {
      if (myEventsSubTab === "past") return <div className="text-muted small py-4 text-center">No past events yet.</div>;
      if (myEventsSubTab === "drafts") return <div className="text-muted small py-4 text-center">No drafts saved.</div>;
      return (
        <div className="text-muted small py-4 text-center">
          No upcoming events. Create one from the Opportunities tab.
        </div>
      );
    }

    return (
      <div className="list-group orgp-queue-list">
        {myEvents.map((eventRow) => {
          const isSelected = String(selectedMyEvent?.id || "") === String(eventRow?.id || "");
          return (
            <button
              key={`myevent-row-${eventRow.id}`}
              type="button"
              className={`list-group-item list-group-item-action orgp-queue-item orgp-my-event-item ${isSelected ? "active" : ""}`}
              onClick={() => selectMyEvent(eventRow)}
            >
              <div className="d-flex justify-content-between gap-2">
                <div className="text-start flex-grow-1 orgp-truncate-wrap">
                  <div className="fw-semibold text-truncate">{eventRow.title || "Untitled event"}</div>
                  <div className="small text-muted text-truncate">
                    {formatMyEventsListDate(eventRow.start_at, eventRow.tz)} · {formatLocationShort(eventRow.location_text)}
                  </div>
                </div>
                <div className="text-end">
                  {renderMyEventsFundingIndicator(eventRow)}
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 mt-2 flex-wrap">
                <span className="badge text-bg-light border">
                  {MY_EVENTS_STATUS_BADGE[String(eventRow.status || "").toLowerCase()] || eventRow.status || "Event"}
                </span>
                <span className="badge text-bg-light border">{eventRow.visibility || "public"}</span>
                <span className="badge rounded-pill text-bg-secondary">Budget {safeNumber(eventRow.reward_pool_kind, 0)}</span>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  function renderMyEventsQueuePanel() {
    return (
      <div>
        <div className="orgp-my-strip mb-3">
          {renderMyEventsPoolHealthGrid({ compact: true })}
          <div className="d-flex gap-2 flex-wrap mt-2">
            <button
              type="button"
              className="btn btn-sm orgp-btn-ink-outline"
              onClick={refreshMyEventsData}
              disabled={myEventsPoolLoading || myEventsLoading}
            >
              <i className="fas fa-rotate-right me-1" aria-hidden="true"></i>
              {myEventsPoolLoading ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              className="btn btn-sm orgp-btn-ink-outline"
              onClick={() => setMyEventsLedgerOpen(true)}
            >
              View Ledger
            </button>
            <span className="small text-muted align-self-center">Pool top-ups are admin-managed.</span>
          </div>
        </div>

        <div className="d-flex align-items-center gap-2 flex-wrap mb-3">
          <select
            className="form-select form-select-sm orgp-my-pool-select"
            value={myEventsPoolFilter}
            onChange={(e) => {
              setMyEventsPoolFilter(e.target.value || "");
              setSelectedMyEvent(null);
            }}
          >
            <option value="">All pools</option>
            {myEventsPoolOptions.map((slug) => (
              <option key={`myevents-pool-${slug}`} value={slug}>
                {slug}
              </option>
            ))}
          </select>
          <div className="d-flex align-items-center gap-1 flex-wrap">
            {["upcoming", "past", "drafts"].map((tabKey) => (
              <button
                key={`myevents-tab-${tabKey}`}
                type="button"
                className={`btn btn-sm orgp-my-subtab ${myEventsSubTab === tabKey ? "active" : ""}`}
                onClick={() => {
                  setMyEventsSubTab(tabKey);
                  setSelectedMyEvent(null);
                }}
              >
                {tabKey === "upcoming" ? "Upcoming" : tabKey === "past" ? "Past" : "Drafts"}
              </button>
            ))}
          </div>
        </div>

        {renderMyEventsQueue()}
      </div>
    );
  }

  function renderMyEventsDefaultDetail() {
    return (
      <div className="orgp-empty-detail orgp-empty-detail-lg">
        <h3 className="orgp-detail-heading mb-0">Funding Pool Health</h3>
        <div className="w-100">{renderMyEventsPoolHealthGrid()}</div>
        <div className="d-flex gap-2 flex-wrap justify-content-center">
          <button
            type="button"
            className="btn orgp-btn-ink-outline"
            onClick={() => setMyEventsLedgerOpen(true)}
          >
            View Pool Ledger
          </button>
        </div>
        <p className="text-muted small mb-0">Pool top-ups are admin-managed.</p>
        <p className="text-muted small mb-0">
          Select an event from the queue to see its funding detail and manage volunteers.
        </p>
      </div>
    );
  }

  function renderMyEventsDetail() {
    const eventRow = selectedMyEvent;
    if (!eventRow) return renderMyEventsDefaultDetail();

    const acceptedCount = safeNumber(eventRow?.rsvp_counts?.accepted, 0);
    const capacity = eventRow?.capacity == null ? null : safeNumber(eventRow.capacity, null);
    const fillPct = capacity == null ? 0 : fillPercent(acceptedCount, capacity);
    const eventDateLine = formatEventDateTime(eventRow.start_at, eventRow.end_at, eventRow.tz);
    const locationLine = formatLocationShort(eventRow.location_text);
    const statusKey = String(eventRow.status || "").toLowerCase();
    const isDraft = statusKey === "draft";
    const isCancelled = statusKey === "cancelled";
    const isCompleted = statusKey === "completed";
    const startTs = eventRow.start_at ? new Date(eventRow.start_at).getTime() : NaN;
    const endTs = eventRow.end_at ? new Date(eventRow.end_at).getTime() : NaN;
    const isUpcoming = !Number.isNaN(startTs) && startTs > Date.now();
    const hasEnded = !Number.isNaN(endTs) && endTs <= Date.now();

    return (
      <div>
        <div className="d-flex justify-content-between align-items-start gap-2 mb-3">
          <div>
            <h3 className="orgp-opp-title">{eventRow.title || "Untitled event"}</h3>
            <div className="text-muted small">{eventDateLine} · {locationLine}</div>
            <div className="d-flex align-items-center gap-2 mt-1">
              <span className="badge text-bg-light border">
                {MY_EVENTS_STATUS_BADGE[statusKey] || eventRow.status || "Event"}
              </span>
              <span className="badge text-bg-light border">{eventRow.visibility || "public"}</span>
            </div>
          </div>
          <div className="d-flex gap-2">
            <button
              type="button"
              className="btn btn-link btn-sm p-0 orgp-link-btn"
              onClick={() => openEditOpportunityModal(eventRow.id)}
              disabled={isCancelled}
            >
              <i className="fas fa-pen me-1" aria-hidden="true"></i>Edit
            </button>
            {(isDraft || isUpcoming) && !isCancelled ? (
              <button
                type="button"
                className="btn btn-link btn-sm p-0 text-danger"
                onClick={() => handleMyEventCancel(eventRow)}
              >
                <i className="fas fa-trash me-1" aria-hidden="true"></i>{isDraft ? "Delete Draft" : "Cancel"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="orgp-section-label">RSVP & CAPACITY</div>
        <div className="orgp-block mb-3">
          {capacity == null ? (
            <div className="small text-muted mb-2">No cap set</div>
          ) : (
            <>
              <div className="d-flex justify-content-between small mb-1">
                <span>{acceptedCount} / {capacity} spots filled</span>
                <span>{fillPct}%</span>
              </div>
              <div className="progress mb-2">
                <div className="progress-bar orgp-progress-ink" style={{ width: `${fillPct}%` }}>
                  {fillPct}%
                </div>
              </div>
            </>
          )}
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => openMyEventsInvite(eventRow)}
            disabled={isCancelled}
          >
            + Invite Volunteers
          </button>
        </div>

        <div className="orgp-section-label">FUNDING</div>
        <div className="row g-2 mb-2">
          <div className="col-12 col-md-4">
            <div className="orgp-my-stat-card">
              <div className="orgp-my-stat-label">Reward Budget</div>
              <div className="orgp-my-stat-value">{safeNumber(eventRow.reward_pool_kind, 0)}</div>
            </div>
          </div>
          <div className="col-12 col-md-4">
            <div className="orgp-my-stat-card">
              <div className="orgp-my-stat-label">Verified Credits</div>
              <div className="orgp-my-stat-value">{safeNumber(eventRow.verified_credits_total, 0)}</div>
            </div>
          </div>
          <div className="col-12 col-md-4">
            <div className="orgp-my-stat-card">
              <div className="orgp-my-stat-label">Deficit</div>
              <div className={`orgp-my-stat-value ${safeNumber(eventRow.deficit_credits_total, 0) > 0 ? "orgp-my-deficit" : ""}`}>
                {safeNumber(eventRow.deficit_credits_total, 0)}
              </div>
            </div>
          </div>
        </div>
        <div className="small text-muted mb-3">
          Pool: <strong>{eventRow.funding_pool_slug || "general"}</strong>
        </div>
        <div className="small text-muted mb-3">Pool top-ups are admin-managed.</div>

        <div className="orgp-section-label">ACTIONS</div>
        <div className="d-flex gap-2 flex-wrap mb-3">
          {!isDraft && !isCancelled ? (
            <>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => {
                  window.location.hash = `#/events/${eventRow.id}`;
                }}
              >
                Open Roster
              </button>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => copyMyEventLink(eventRow)}>
                Copy Link
              </button>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={showMyEventQrToast}>
                Show QR
              </button>
            </>
          ) : null}
          {isUpcoming && !isCancelled && !isDraft ? (
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => handleMyEventCancel(eventRow)}>
              Cancel Event
            </button>
          ) : null}
          {hasEnded && !isCompleted && !isCancelled && !isDraft ? (
            <button type="button" className="btn btn-sm orgp-btn-coral" onClick={() => handleMyEventComplete(eventRow)}>
              Mark Completed
            </button>
          ) : null}
        </div>

        <div className="orgp-section-label">RECENT POOL ACTIVITY</div>
        <div className="orgp-block">
          {myEventsLedgerPreview.length ? (
            <div className="d-grid gap-2">
              {myEventsLedgerPreview.map((tx) => {
                const isCredit = String(tx.direction || "").toLowerCase() === "credit";
                const signed = `${isCredit ? "+" : "-"}${safeNumber(tx.amount_credits, 0)}`;
                const timeLabel = tx.created_at
                  ? new Date(tx.created_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "Unknown time";
                return (
                  <div key={`myevent-ledger-${tx.id || `${signed}-${timeLabel}`}`} className="orgp-my-ledger-row">
                    <div className={`orgp-my-ledger-amount ${isCredit ? "credit" : "debit"}`}>{signed}</div>
                    <div className="small text-muted flex-grow-1">
                      <div>{tx.reason_label || tx.reason || "Activity"} · {timeLabel}</div>
                      {tx.event_title ? <div>Event: {tx.event_title}</div> : null}
                      {tx.donation_id ? <div>Donation #{tx.donation_id}</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-muted small">No recent pool activity for this pool.</div>
          )}
          <button
            type="button"
            className="btn btn-link btn-sm p-0 mt-2 orgp-link-btn"
            onClick={() => setMyEventsLedgerOpen(true)}
          >
            View Full Ledger →
          </button>
        </div>
      </div>
    );
  }

  function renderQueueItem(item) {
    const isActive =
      selectedQueueItem &&
      selectedQueueItem.tab === item.tab &&
      String(selectedQueueItem.opportunityId) === String(item.opportunityId);

    const iconClass = item.icon === "fa-circle" ? "fas fa-circle text-success" : `fas ${item.icon}`;
    const iconColorClass = item.iconColor === "coral" ? "orgp-item-icon-coral" : "";
    const iconToneClass = item.iconTone ? `orgp-item-icon-${item.iconTone}` : "";
    const pendingApprovalCount = safeNumber(
      item?.pendingJoinCount ?? item?.pending_join_count ?? item?.pendingCount,
      0
    );
    const approvedCount = safeNumber(item?.approvedCount ?? item?.approved_count, 0);
    const capacity = item?.capacity == null ? null : safeNumber(item?.capacity, null);
    const showUpcomingFillBadge =
      item.tab === "opportunities" &&
      String(item?.type || "") === "opp-upcoming" &&
      capacity != null &&
      capacity > 0;
    const queueLabel = item.tab === "opportunities"
      ? (item.opportunityName || item.label || "Opportunity")
      : item.label;

    const handleQueueSelect = () => {
      setSelectedQueueItem(item);
      if (activeTab === "opportunities" && item.tab === "opportunities") {
        setPendingDetailScroll("detail");
      }
    };

    return (
      <button
        key={`${item.tab}-${item.id}`}
        type="button"
        className={`list-group-item list-group-item-action orgp-queue-item ${isActive ? "active" : ""}`}
        onClick={handleQueueSelect}
      >
        <div className="d-flex align-items-center gap-2">
          <i className={`${iconClass} orgp-item-icon ${iconColorClass} ${iconToneClass}`} aria-hidden="true"></i>
          <span className="flex-grow-1">{queueLabel}</span>
          {item.tab === "opportunities" && pendingApprovalCount > 0 ? (
            <span className="badge text-bg-warning">{pendingApprovalCount}</span>
          ) : showUpcomingFillBadge ? (
            <span className="badge text-bg-light border">{`${approvedCount}/${capacity}`}</span>
          ) : null}
        </div>
      </button>
    );
  }

  function renderOpportunitiesQueue() {
    if (queueLoading) {
      return (
        <div className="d-flex justify-content-center py-4">
          <div className="spinner-border" role="status" aria-label="Loading queue"></div>
        </div>
      );
    }

    if (queueError) {
      return (
        <div className="text-muted text-center py-4">
          Could not load queue. Please refresh.
        </div>
      );
    }

    if (!hasOpportunities) {
      return <OpportunitiesEmptyLeft onCreateClick={openCreateOpportunityModal} />;
    }

    const sections = opportunitiesQueueSections;

    return (
      <>
        <button
          type="button"
          className="btn orgp-btn-ink-outline w-100 mb-3"
          onClick={openCreateOpportunityModal}
        >
          + New Opportunity
        </button>

        {sections.needsAttention.length ? (
          <div className="mb-3">
            <div className="orgp-group-label">
              <span className="orgp-dot orgp-dot-urgent" aria-hidden="true"></span>
              NEEDS ATTENTION
            </div>
            <div className="list-group orgp-queue-list">
              {sections.needsAttention.map((item) => renderQueueItem(item))}
            </div>
          </div>
        ) : null}

        {sections.upcoming.length ? (
          <div className="mb-3">
            <div className="orgp-group-label">
              <span className="orgp-dot orgp-dot-today" aria-hidden="true"></span>
              UPCOMING
            </div>
            <div className="list-group orgp-queue-list">
              {sections.upcoming.map((item) => renderQueueItem(item))}
            </div>
          </div>
        ) : null}

        {sections.drafts.length ? (
          <div className="mb-3">
            <div className="orgp-group-label">
              <span className="orgp-dot orgp-dot-week" aria-hidden="true"></span>
              DRAFT
            </div>
            <div className="list-group orgp-queue-list">
              {sections.drafts.map((item) => renderQueueItem(item))}
            </div>
          </div>
        ) : null}

        {sections.active.length ? (
          <div className="mb-3">
            <div className="orgp-group-label">
              <span className="orgp-dot orgp-dot-week" aria-hidden="true"></span>
              ACTIVE / ONGOING
            </div>
            <div className="list-group orgp-queue-list">
              {sections.active.map((item) => renderQueueItem(item))}
            </div>
          </div>
        ) : null}

        {sections.completed.length ? (
          <div>
            <button
              type="button"
              className="btn btn-link p-0 orgp-collapse-toggle"
              onClick={() => setCompletedExpanded((prev) => !prev)}
              aria-expanded={completedExpanded}
            >
              {completedExpanded ? "-" : "+"} COMPLETED
            </button>

            {completedExpanded ? (
              <div className="list-group orgp-queue-list mt-2">
                {sections.completed.map((item) => renderQueueItem(item))}
              </div>
            ) : null}
          </div>
        ) : null}

        {sections.cancelled.length ? (
          <div className="mt-3">
            <button
              type="button"
              className="btn btn-link p-0 orgp-collapse-toggle"
              onClick={() => setCancelledExpanded((prev) => !prev)}
              aria-expanded={cancelledExpanded}
            >
              {cancelledExpanded ? "-" : "+"} CANCELLED
            </button>
            {cancelledExpanded ? (
              <div className="list-group orgp-queue-list mt-2">
                {sections.cancelled.map((item) => renderQueueItem(item))}
              </div>
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  function renderEventsListView() {
    const allEvents = Array.isArray(eventsListData) ? eventsListData : [];

    const projectOptions = [...new Map(
      allEvents
        .map((row) => {
          const id = row?.project_id ?? row?.projectId;
          const name = row?.project_name ?? row?.projectName;
          return id && name ? [String(id), String(name)] : null;
        })
        .filter(Boolean)
    ).entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const filtered = allEvents.filter((row) => {
      const statusKey = String(row.status || "").toLowerCase();
      if (eventsListFilter.status !== "all" && statusKey !== eventsListFilter.status) return false;
      if (eventsListFilter.projectId !== "all") {
        const projectId = row?.project_id ?? row?.projectId;
        if (String(projectId || "") !== eventsListFilter.projectId) return false;
      }
      return true;
    });

    const active = filtered.filter((row) =>
      ["published", "active"].includes(String(row.status || "").toLowerCase())
    );
    const drafts = filtered.filter((row) =>
      String(row.status || "").toLowerCase() === "draft"
    );
    const reported = filtered.filter((row) =>
      ["completed", "cancelled", "reported"].includes(String(row.status || "").toLowerCase())
    );

    const statusOptions = [...new Set(allEvents.map((row) => String(row.status || "").toLowerCase()).filter(Boolean))].sort();

    function renderRow(row) {
      const approved = safeNumber(row.approved, 0);
      const capacity = row.capacity != null ? safeNumber(row.capacity, 0) : null;
      const pct = capacity ? Math.min(100, Math.round((approved / capacity) * 100)) : 0;
      const pending = safeNumber(row.pending, 0);
      const statusKey = String(row.status || "").toLowerCase();
      const dateRange = formatEventDateRange(row.start_at, row.end_at);
      const daysAway = formatDaysAway(row.start_at);
      const barClass = fillBarClass(pct, capacity);
      const projectName = row?.project_name || row?.projectName || "";
      const locationLabel = row?.location || row?.location_name || row?.venue || row?.address || row?.tz || "Location TBD";

      const queueItem = {
        id: `opp-list-${row.id}`,
        tab: "opportunities",
        type: pending > 0 ? "opp-approval" : statusKey === "draft" ? "opp-draft" : "opp-upcoming",
        opportunityId: String(row.id),
        opportunityName: row.title || "Untitled event",
        label: row.title || "Untitled event",
        icon: pending > 0 ? "fa-user-check" : "fa-calendar",
        startTime: row.start_at || null,
        endTime: row.end_at || null,
        timeZone: row.tz || "America/Vancouver",
        pendingCount: pending,
        pendingJoinCount: pending,
        approvedCount: approved,
        capacity,
      };

      const selectRow = () => {
        setSelectedQueueItem(queueItem);
        setPendingDetailScroll("tabs");
      };

      return (
        <div
          key={`evlist-${row.id}`}
          className="gk-event-row"
          role="button"
          tabIndex={0}
          onClick={selectRow}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              selectRow();
            }
          }}
        >
          <div>
            <div className="gk-event-row-title">
              {row.title || "Untitled event"}
              {pending > 0 ? (
                <span className="gk-urgent-badge ms-2">{pending} URGENT</span>
              ) : null}
            </div>
            <div className="gk-event-row-meta">
              {locationLabel}
            </div>
            {projectName ? <span className="gk-event-row-badge">{projectName}</span> : null}
          </div>
          <div className="gk-event-status-col">
            <span className={`gk-stage-pill gk-stage-${statusKey}`}>
              {statusKey.charAt(0).toUpperCase() + statusKey.slice(1).replace("_", " ")}
            </span>
          </div>
          <div className="gk-event-dates-col">
            <div>{dateRange}</div>
            <div className="gk-event-dates-away">{daysAway}</div>
          </div>
          <div className="gk-fill-col">
            {capacity != null ? (
              <>
                <div className="gk-fill-bar-wrap">
                  <div className={`gk-fill-bar ${barClass}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="gk-fill-fraction">{approved}/{capacity}</div>
              </>
            ) : (
              <div className="gk-fill-fraction text-muted">No cap</div>
            )}
          </div>
        </div>
      );
    }

    function renderSection(label, rows) {
      if (!rows.length) return null;
      return (
        <div key={`evlist-section-${label}`} className="mb-3">
          <div className="gk-events-section-label">{label} {rows.length}</div>
          {rows.map((row) => renderRow(row))}
        </div>
      );
    }

    return (
      <div>
        <div className="gk-events-list-header">
          <span className="gk-events-list-count">{filtered.length}</span>
          <span className="gk-events-list-count-of">of {allEvents.length}</span>
        </div>
        <div className="gk-events-list-subtitle">
          Every volunteer-facing thing happening across your projects
        </div>

        <div className="gk-events-filter-bar">
          <select
            className="form-select form-select-sm"
            value={eventsListFilter.status}
            onChange={(e) => setEventsListFilter((prev) => ({ ...prev, status: e.target.value }))}
          >
            <option value="all">Status</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>

          <select
            className="form-select form-select-sm"
            value={eventsListFilter.projectId}
            onChange={(e) => setEventsListFilter((prev) => ({ ...prev, projectId: e.target.value }))}
            disabled={!projectOptions.length}
          >
            <option value="all">Project</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>

          <select className="form-select form-select-sm" value="all" disabled>
            <option value="all">Date</option>
          </select>

          <div className="gk-events-view-toggle">
            <button type="button" className="btn btn-sm gk-btn-coral">List</button>
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled>Calendar</button>
          </div>
        </div>

        {eventsListLoading ? (
          <div className="d-flex justify-content-center py-4">
            <div className="spinner-border" role="status" aria-label="Loading events"></div>
          </div>
        ) : !allEvents.length ? (
          <div className="gk-empty py-4">
            <i className="fas fa-calendar-days" aria-hidden="true"></i>
            <p className="mb-0">No events yet. Create your first opportunity.</p>
            <button type="button" className="btn btn-sm gk-btn-coral mt-2" onClick={openCreateOpportunityModal}>
              + New Opportunity
            </button>
          </div>
        ) : (
          <>
            {renderSection("ACTIVE", active)}
            {renderSection("DRAFTS", drafts)}
            {renderSection("REPORTED", reported)}
          </>
        )}
      </div>
    );
  }

  function renderCloseoutModal() {
    if (!closeoutModal.open) return null;
    const { step, beneficiaryCount, confidence, equityRows, methodology, saving, error } = closeoutModal;
    const eventTitle = selectedOpportunityDetail?.title || "Event";
    const STEPS = ["Total reach", "Equity breakdown", "Methodology"];

    return (
      <div
        className="modal fade show d-block gk-closeout-modal"
        tabIndex="-1"
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gkCloseoutTitle"
      >
        <div className="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <div>
                <div className="gk-closeout-modal-kicker">Close-out</div>
                <h5 className="gk-closeout-modal-title" id="gkCloseoutTitle">{eventTitle}</h5>
              </div>
              <button
                type="button"
                className="btn-close"
                aria-label="Close"
                onClick={() => setCloseoutModal({ open: false, ...CLOSEOUT_EMPTY })}
                disabled={saving}
              />
            </div>

            <div className="modal-body">
              <div className="gk-closeout-step-indicator">
                {STEPS.map((label, idx) => {
                  const stepNum = idx + 1;
                  const isDone = step > stepNum;
                  const isActive = step === stepNum;
                  return (
                    <React.Fragment key={label}>
                      <div className={`gk-closeout-step${isDone ? " is-done" : ""}${isActive ? " is-active" : ""}`}>
                        <div className="gk-closeout-step-num">
                          {isDone ? <i className="fas fa-check" aria-hidden="true" /> : stepNum}
                        </div>
                        <div className="gk-closeout-step-label">{label}</div>
                      </div>
                      {idx < STEPS.length - 1 ? (
                        <div className="gk-closeout-step-divider" aria-hidden="true" />
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </div>

              {step === 1 ? (
                <div>
                  <h6 className="fw-bold mb-1" style={{ color: "var(--gk-slate)" }}>
                    How many people did this event reach?
                  </h6>
                  <p className="small text-muted mb-3">
                    Count beneficiaries — the participants this event served — not volunteers.
                    Best estimate is fine if exact numbers are not available.
                  </p>
                  <label className="gk-section-label" htmlFor="gkCloseoutCount">
                    Total beneficiary count
                  </label>
                  <div className="d-flex align-items-center gap-2 mb-3">
                    <input
                      id="gkCloseoutCount"
                      type="number"
                      min="0"
                      className="form-control"
                      style={{ maxWidth: 120 }}
                      value={beneficiaryCount}
                      onChange={(e) =>
                        setCloseoutModal((prev) => ({ ...prev, beneficiaryCount: e.target.value }))
                      }
                    />
                    <span className="small text-muted">people reached</span>
                  </div>
                  <div className="gk-section-label mb-1">Confidence</div>
                  <div className="gk-confidence-grid">
                    {[
                      { key: "Counted", sub: "Sign-in / registration" },
                      { key: "Estimated", sub: "Best informed guess" },
                      { key: "Sampled", sub: "Extrapolated from survey" },
                    ].map(({ key, sub }) => (
                      <button
                        key={key}
                        type="button"
                        className={`gk-confidence-btn${confidence === key ? " selected" : ""}`}
                        onClick={() =>
                          setCloseoutModal((prev) => ({ ...prev, confidence: key }))
                        }
                      >
                        <div className="gk-confidence-btn-label">{key}</div>
                        <div className="gk-confidence-btn-sub">{sub}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : step === 2 ? (
                <div>
                  <h6 className="fw-bold mb-1" style={{ color: "var(--gk-slate)" }}>
                    Equity-deserving group breakdown
                  </h6>
                  <p className="small text-muted mb-3">
                    Check any groups represented and optionally enter an estimated percentage.
                  </p>
                  {equityRows.map((row, idx) => (
                    <div key={row.group} className="gk-equity-row">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        id={`gk-equity-${idx}`}
                        checked={row.checked}
                        onChange={(e) =>
                          setCloseoutModal((prev) => ({
                            ...prev,
                            equityRows: prev.equityRows.map((r, i) =>
                              i === idx ? { ...r, checked: e.target.checked } : r
                            ),
                          }))
                        }
                      />
                      <label className="gk-equity-label" htmlFor={`gk-equity-${idx}`}>
                        {row.group}
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        className="form-control form-control-sm gk-equity-pct-input"
                        placeholder="%"
                        value={row.pct}
                        disabled={!row.checked}
                        onChange={(e) =>
                          setCloseoutModal((prev) => ({
                            ...prev,
                            equityRows: prev.equityRows.map((r, i) =>
                              i === idx ? { ...r, pct: e.target.value } : r
                            ),
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  <h6 className="fw-bold mb-1" style={{ color: "var(--gk-slate)" }}>
                    Methodology notes
                  </h6>
                  <p className="small text-muted mb-3">
                    Optional. Describe how you counted or estimated reach.
                  </p>
                  <textarea
                    className="form-control"
                    rows={5}
                    value={methodology}
                    onChange={(e) =>
                      setCloseoutModal((prev) => ({ ...prev, methodology: e.target.value }))
                    }
                    placeholder="e.g. Attendance counted via sign-in sheet at registration desk."
                  />
                </div>
              )}

              {error ? (
                <div className="alert alert-warning py-2 mt-3 mb-0" role="alert">{error}</div>
              ) : null}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => {
                  if (step > 1) {
                    setCloseoutModal((prev) => ({ ...prev, step: prev.step - 1, error: "" }));
                  } else {
                    setCloseoutModal({ open: false, ...CLOSEOUT_EMPTY });
                  }
                }}
                disabled={saving}
              >
                {step === 1 ? "Cancel" : "Back"}
              </button>
              {step < 3 ? (
                <button
                  type="button"
                  className="btn gk-btn-coral"
                  onClick={() =>
                    setCloseoutModal((prev) => ({ ...prev, step: prev.step + 1, error: "" }))
                  }
                  disabled={saving}
                >
                  Continue <i className="fas fa-arrow-right ms-1" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  className="btn gk-btn-coral"
                  onClick={submitCloseout}
                  disabled={saving}
                >
                  {saving ? "Submitting..." : "Submit close-out"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderEventWorkspace() {
    const detail = selectedOpportunityDetail;
    const loading = selectedOpportunityDetailLoading;
    const eventTitle = detail?.title || selectedOpportunity?.opportunityName || "Event";
    const roles = Array.isArray(detail?.roles) ? detail.roles : [];
    const approved = safeNumber(applicantCounts?.approvedCount, 0);
    const capacity = detail?.capacity != null ? safeNumber(detail.capacity, 0) : null;
    const fillPct = capacity ? Math.min(100, Math.round((approved / capacity) * 100)) : 0;
    const verifiedHours = safeNumber(detail?.verified_hours, 0);
    const stage = String(
      detail?.lifecycle_stage ||
      selectedOpportunity?.type?.replace("opp-", "") ||
      "draft"
    ).toLowerCase();
    const LIFECYCLE_STAGES = ["draft","recruiting","live","closing_out","reported"];
    const LIFECYCLE_LABELS = {
      draft: "Draft",
      recruiting: "Recruiting",
      live: "Live",
      closing_out: "Closing out",
      reported: "Reported",
    };
    const normalizedStage = LIFECYCLE_STAGES.includes(stage) ? stage : "draft";
    const currentStageIndex = LIFECYCLE_STAGES.indexOf(normalizedStage);
    const nextAction = getNextAction(normalizedStage, detail);
    const dateRange = formatEventDateRange(detail?.start_at, detail?.end_at);
    const locationCount = Array.isArray(detail?.locations) ? detail.locations.length : 0;
    const subtitleParts = [
      dateRange,
      detail?.duration_days ? `${detail.duration_days} days` : null,
      locationCount > 0 ? `${locationCount} location${locationCount !== 1 ? "s" : ""}` : null,
    ].filter(Boolean);
    const SUBNAV_TABS = ["Overview","Roster","Schedule","Comms","Check-in","Close-out","Reports"];

    return (
      <div>
        <button
          type="button"
          className="gk-workspace-back-btn"
          onClick={() => {
            setSelectedQueueItem(null);
            setWorkspaceSubNav("overview");
          }}
        >
          <i className="fas fa-chevron-left" aria-hidden="true"></i>
          Back to events
        </button>

        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
          <div>
            <div className="gk-workspace-breadcrumb">
              <span>{detail?.program_name || "Events"}</span>
              <i className="fas fa-chevron-right" style={{ fontSize: "0.65rem" }} aria-hidden="true"></i>
              <span>Events</span>
              <i className="fas fa-chevron-right" style={{ fontSize: "0.65rem" }} aria-hidden="true"></i>
              <span>{eventTitle}</span>
            </div>
            <h2 className="gk-workspace-title">{eventTitle}</h2>
            <div className="gk-workspace-subtitle">{subtitleParts.join(" · ")}</div>
          </div>
          <div className="gk-workspace-actions">
            <button type="button" className="btn btn-sm btn-outline-secondary">
              <i className="fas fa-envelope me-1" aria-hidden="true"></i>
              Message volunteers
            </button>
            <button
              type="button"
              className="btn btn-sm gk-btn-coral"
              onClick={openCreateOpportunityModal}
            >
              + Add opportunity
            </button>
          </div>
        </div>

        <div className="gk-lifecycle-bar" role="list" aria-label="Lifecycle stages">
          {LIFECYCLE_STAGES.map((s, idx) => {
            const isDone = idx < currentStageIndex;
            const isCurrent = idx === currentStageIndex;
            return (
              <div
                key={s}
                className={`gk-lifecycle-stage${isDone ? " is-done" : ""}${isCurrent ? " is-current" : ""}`}
                role="listitem"
              >
                {isDone ? <i className="fas fa-check me-1" aria-hidden="true"></i> : null}
                {LIFECYCLE_LABELS[s]}
              </div>
            );
          })}
        </div>

        <div className="gk-workspace-subnav" role="tablist">
          {SUBNAV_TABS.map((tab) => {
            const key = tab.toLowerCase().replace(/[^a-z]/g, "");
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={workspaceSubNav === key}
                className={`gk-workspace-subnav-btn${workspaceSubNav === key ? " active" : ""}`}
                onClick={() => setWorkspaceSubNav(key)}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="d-flex justify-content-center py-4">
            <div className="spinner-border" role="status" aria-label="Loading event"></div>
          </div>
        ) : workspaceSubNav !== "overview" ? (
          <div className="gk-empty py-4">
            <i className="fas fa-hard-hat" aria-hidden="true"></i>
            <p className="mb-0">
              {SUBNAV_TABS.find((t) => t.toLowerCase().replace(/[^a-z]/g, "") === workspaceSubNav) || "This"} tab coming soon.
            </p>
          </div>
        ) : (
          <div className="gk-workspace-root">
            <div>
              <div className="gk-metric-grid">
                <div className="gk-metric-card">
                  <div className="gk-metric-label">
                    {normalizedStage === "live"
                      ? "Spots Filled"
                      : normalizedStage === "reported"
                        ? "Spots Filled (Final)"
                        : "Spots Planned"}
                  </div>
                  <div className="gk-metric-value-fraction">
                    {capacity != null ? `${approved}/${capacity}` : "—"}
                    {capacity != null ? (
                      <span className="ms-2" style={{ fontSize: "0.9rem", color: "var(--gk-text-muted)" }}>
                        {fillPct}%
                      </span>
                    ) : null}
                  </div>
                  <div className="gk-metric-sub">
                    {normalizedStage === "recruiting"
                      ? `${safeNumber(applicantCounts?.pendingJoinCount, 0)} urgent`
                      : ""}
                  </div>
                </div>

                <div className="gk-metric-card">
                  <div className="gk-metric-label">Verified Hours</div>
                  <div className="gk-metric-value">{verifiedHours > 0 ? verifiedHours : "—"}</div>
                  <div className="gk-metric-sub">Logged at check-out</div>
                </div>

                <div className="gk-metric-card">
                  <div className="gk-metric-label">
                    {normalizedStage === "live" ? "Currently on Site" : "Beneficiary Reach"}
                  </div>
                  <div className="gk-metric-value">
                    {normalizedStage === "live"
                      ? safeNumber(applicantCounts?.checkedInCount, 0) || "—"
                      : safeNumber(detail?.beneficiary_count, 0) || "—"}
                  </div>
                  <div className="gk-metric-sub">
                    {normalizedStage === "live"
                      ? `Of ${approved} expected`
                      : normalizedStage === "reported"
                        ? `${safeNumber(detail?.beneficiary_equity_pct, 0)}% equity-deserving`
                        : "Captured at close-out"}
                  </div>
                </div>
              </div>

              <div className={`gk-next-action-card stage-${normalizedStage}`}>
                <div className="gk-next-action-icon">
                  <i className="fas fa-star" aria-hidden="true"></i>
                </div>
                <div className="flex-grow-1">
                  <div className="gk-next-action-label">{nextAction.label}</div>
                  <div className="gk-next-action-title">{nextAction.title}</div>
                  {nextAction.body ? (
                    <div className="gk-next-action-body">{nextAction.body}</div>
                  ) : null}
                  {nextAction.cta ? (
                    <div className="gk-next-action-btns">
                      <button
                        type="button"
                        className={`btn btn-sm${normalizedStage === "recruiting" ? " gk-btn-coral" : " btn-outline-secondary"}`}
                        onClick={nextAction.ctaAction || (() => {})}
                      >
                        {nextAction.cta}
                        <i className="fas fa-arrow-right ms-1" aria-hidden="true"></i>
                      </button>
                      <button type="button" className="btn btn-sm btn-outline-secondary">
                        Snooze
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="gk-opps-section">
                <div className="gk-opps-header">
                  <div>
                    <span className="gk-opps-header-title">Opportunities</span>
                    {roles.length > 0 ? (
                      <span className="gk-opps-header-meta ms-2">
                        {roles.length} role{roles.length !== 1 ? "s" : ""}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-link p-0"
                    style={{ color: "var(--gk-slate)" }}
                    onClick={openCreateOpportunityModal}
                  >
                    + Add
                  </button>
                </div>

                {roles.length === 0 ? (
                  <div className="gk-empty py-3">
                    <p className="mb-0 small">No roles yet. Add an opportunity to get started.</p>
                  </div>
                ) : (
                  roles.map((role) => {
                    const spotsFilled = safeNumber(role.spots_filled, 0);
                    const spotsNeeded = safeNumber(role.spots_needed, 0);
                    const dots = spotsNeeded > 0 ? Math.min(spotsNeeded, 6) : 4;
                    const filledDots = spotsNeeded > 0
                      ? Math.round((spotsFilled / spotsNeeded) * dots)
                      : 0;
                    const isFull = spotsNeeded > 0 && spotsFilled >= spotsNeeded;
                    const isPartial = !isFull && filledDots > 0 && filledDots < dots;
                    return (
                      <div key={`role-${role.id}`} className="gk-role-row">
                        <div className="flex-grow-1 min-w-0">
                          <div className="gk-role-name">{role.title || "Untitled role"}</div>
                          {role.requirements ? (
                            <div className="gk-role-sub">{role.requirements}</div>
                          ) : null}
                        </div>
                        <div className="gk-dot-row">
                          {Array.from({ length: dots }).map((_, dotIdx) => {
                            const isFilled = dotIdx < filledDots;
                            const dotClass = isFilled
                              ? isFull ? "filled full" : isPartial ? "filled partial" : "filled"
                              : "";
                            return <div key={dotIdx} className={`gk-dot${dotClass ? ` ${dotClass}` : ""}`} />;
                          })}
                        </div>
                        <div className="gk-role-fraction">{spotsFilled}/{spotsNeeded}</div>
                        <i
                          className="fas fa-chevron-right"
                          style={{ color: "var(--gk-text-muted)", fontSize: "0.8rem" }}
                          aria-hidden="true"
                        ></i>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <div className="gk-card">
                <div className="gk-workspace-sidebar-section">
                  <div className="gk-workspace-sidebar-label">
                    <i className="fas fa-circle-info" aria-hidden="true"></i> ABOUT
                  </div>
                  <div className="gk-sidebar-text">
                    {detail?.description || "No description added yet."}
                  </div>
                </div>

                {detail?.project_name ? (
                  <div className="gk-workspace-sidebar-section">
                    <div className="gk-workspace-sidebar-label">
                      <i className="fas fa-folder" aria-hidden="true"></i> PARENT PROJECT
                    </div>
                    <div className="gk-card" style={{ background: "#f5f7fb" }}>
                      <div className="fw-semibold" style={{ color: "var(--gk-slate)", fontSize: "0.9rem" }}>
                        {detail.project_name}
                      </div>
                      {detail.program_name ? (
                        <div className="small text-muted">{detail.program_name}</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {Array.isArray(detail?.languages) && detail.languages.length > 0 ? (
                  <div className="gk-workspace-sidebar-section">
                    <div className="gk-workspace-sidebar-label">
                      <i className="fas fa-language" aria-hidden="true"></i> LANGUAGES
                    </div>
                    <div className="d-flex gap-2 flex-wrap">
                      {detail.languages.map((lang) => (
                        <span key={lang} className="badge text-bg-light border">{lang}</span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {Array.isArray(detail?.locations) && detail.locations.length > 0 ? (
                  <div className="gk-workspace-sidebar-section">
                    <div className="gk-workspace-sidebar-label">
                      <i className="fas fa-location-dot" aria-hidden="true"></i> LOCATIONS
                    </div>
                    {detail.locations.map((loc, idx) => (
                      <div key={idx} className="gk-sidebar-location-row">
                        <span className="gk-sidebar-location-num">{idx + 1}</span>
                        <span>{loc.name || loc.text || loc}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {Array.isArray(detail?.recent_activity) && detail.recent_activity.length > 0 ? (
                  <div className="gk-workspace-sidebar-section">
                    <div className="gk-workspace-sidebar-label">
                      <i className="fas fa-clock-rotate-left" aria-hidden="true"></i> RECENT ACTIVITY
                    </div>
                    {detail.recent_activity.slice(0, 5).map((act, idx) => {
                      const initials = String(act.name || "?")
                        .split(" ")
                        .map((w) => w[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase();
                      return (
                        <div key={idx} className="gk-sidebar-activity-row">
                          <div className="gk-sidebar-activity-avatar">{initials}</div>
                          <div>
                            <div className="gk-sidebar-activity-text">
                              {act.text || act.description || ""}
                            </div>
                            <div className="gk-sidebar-activity-time">{act.time_ago || ""}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderOpportunityDetail() {
    if (!hasOpportunities) {
      return <OpportunitiesEmptyRight onCreateClick={openCreateOpportunityModal} />;
    }
    if (!selectedOpportunity) return <EmptySelectionDetail />;

    const approvedCount = safeNumber(
      applicantCounts?.approvedCount,
      safeNumber(selectedOpportunity.approvedCount, 0)
    );
    const pendingJoinCount = safeNumber(
      applicantCounts?.pendingJoinCount,
      pendingJoinApplicants.length
    );
    const capacity =
      selectedOpportunity.capacity == null ? null : safeNumber(selectedOpportunity.capacity, null);
    const fillPct = capacity == null ? 0 : fillPercent(approvedCount, capacity);
    const isCancelledOpportunity = String(selectedOpportunity.type || "") === "opp-cancelled";
    const isDraftOpportunity = String(selectedOpportunity.type || "") === "opp-draft";
    const eventDateTimeLabel = formatEventDateTime(
      selectedOpportunityDetail?.start_at || selectedOpportunity.startTime,
      selectedOpportunityDetail?.end_at || selectedOpportunity.endTime,
      selectedOpportunityDetail?.tz || selectedOpportunity.timeZone
    );
    const descriptionText = hasDisplayText(selectedOpportunityDetail?.description)
      ? selectedOpportunityDetail.description.trim()
      : "";
    const requirementsText = hasDisplayText(selectedOpportunityDetail?.requirements)
      ? selectedOpportunityDetail.requirements.trim()
      : "";

    return (
      <div ref={opportunityDetailTopRef}>
        <div className="d-flex justify-content-between align-items-start gap-2 mb-3">
          <div>
            <h3 className="orgp-opp-title">{selectedOpportunity.opportunityName || "Opportunity"}</h3>
            <div className="text-muted small">{eventDateTimeLabel}</div>
          </div>
          <div className="d-flex gap-2">
            <button
              type="button"
              className="btn btn-link btn-sm p-0 orgp-link-btn"
              onClick={() => openEditOpportunityModal(selectedOpportunityId)}
              disabled={isCancelledOpportunity}
            >
              <i className="fas fa-pen me-1" aria-hidden="true"></i>Edit
            </button>
            <button
              type="button"
              className="btn btn-link btn-sm p-0 text-danger"
              onClick={openCancelOpportunityModal}
              disabled={isCancelledOpportunity}
            >
              <i className="fas fa-trash me-1" aria-hidden="true"></i>{isDraftOpportunity ? "Delete Draft" : "Cancel"}
            </button>
          </div>
        </div>

        <div className="orgp-section-label">FILL STATUS</div>
        <div className="orgp-block mb-3">
          {capacity == null ? (
            <div className="small text-muted mb-2">No cap set</div>
          ) : (
            <>
              <div className="d-flex justify-content-between small mb-1">
                <span>
                  {approvedCount} / {capacity} spots filled
                </span>
                <span>{fillPct}%</span>
              </div>
              <div
                className="progress mb-2"
                role="progressbar"
                aria-valuenow={fillPct}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label="Fill rate"
              >
                <div className="progress-bar orgp-progress-ink" style={{ width: `${fillPct}%` }}>{fillPct}%</div>
              </div>
            </>
          )}
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={openOpportunityInviteModal}
            disabled={isCancelledOpportunity}
          >
            + Invite Volunteers
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm ms-2"
            onClick={openAdminSignupModal}
            disabled={isCancelledOpportunity}
          >
            + Sign Up Volunteer
          </button>
          {opportunityInviteNotice ? (
            <div className="alert alert-success py-2 mt-2 mb-0" role="status">
              {opportunityInviteNotice.message}
            </div>
          ) : null}
        </div>

        <div className="orgp-section-label">PENDING APPROVALS ({pendingJoinCount})</div>
        <div className="mb-3">
          {applicantsLoading ? (
            <LoadingSpinner text="Loading applicants..." />
          ) : detailError ? (
            <div className="alert alert-warning py-2 mb-0" role="alert">
              {detailError}
            </div>
          ) : pendingJoinApplicants.length ? (
            <>
              {pendingJoinApplicants.map((applicant) => {
                const userId = String(applicant.userId);
                const saving = Boolean(actionLoadingByUser[userId]);
                return (
                  <div key={userId} className="orgp-applicant-row">
                    <div>
                      <div className="fw-semibold">{applicant.displayName}</div>
                      <div className="small text-muted">
                        <span className="badge text-bg-secondary me-2">
                          pending join
                        </span>
                        {safeNumber(applicant.pastCredits, 0)} credits prev
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm org-btn-ink mt-2"
                        onClick={() => openApplicantProfileModal(applicant)}
                      >
                        Profile
                      </button>
                    </div>
                    <div className="d-flex gap-2 align-items-start">
                      <button
                        type="button"
                        className="btn btn-sm orgp-btn-coral"
                        disabled={saving || approveAllLoading}
                        onClick={() => handleApplicantAction(userId, "approve")}
                      >
                        {saving ? "Saving..." : <><i className="fas fa-check me-1" aria-hidden="true"></i>Approve</>}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        disabled={saving || approveAllLoading}
                        onClick={() => handleApplicantAction(userId, "decline")}
                      >
                        {saving ? "Saving..." : <><i className="fas fa-xmark me-1" aria-hidden="true"></i>Decline</>}
                      </button>
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                className="btn btn-outline-secondary w-100 mt-2"
                onClick={openApproveAllConfirm}
                disabled={approveAllLoading || !pendingJoinApplicants.length}
              >
                {approveAllLoading
                  ? `Approving ${approveAllProgress.current} of ${approveAllProgress.total}...`
                  : "Approve All"}
              </button>
            </>
          ) : (
            <div className="text-muted small">No pending approvals.</div>
          )}

          {actionError ? (
            <div className="alert alert-warning py-2 mt-2 mb-0" role="alert">
              {actionError}
            </div>
          ) : null}
        </div>

        <div className="orgp-section-label">APPROVED VOLUNTEERS ({approvedApplicants.length})</div>
        <div className="orgp-block mb-3">
          {applicantsLoading ? (
            <LoadingSpinner text="Loading applicants..." />
          ) : approvedApplicants.length ? (
            <ul className="list-group list-group-flush">
              {approvedApplicants.map((applicant) => {
                const userId = String(applicant.userId);
                const saving = Boolean(actionLoadingByUser[userId]);
                return (
                  <li
                    key={`approved-${applicant.userId}`}
                    className="list-group-item px-0 d-flex justify-content-between align-items-center gap-2 flex-wrap"
                  >
                    <span>{applicant.displayName}</span>
                    <div className="d-flex align-items-center gap-2 flex-wrap justify-content-end">
                      <span className="small text-muted">
                        <span className="badge text-bg-success me-2">
                          {applicant.verificationStatus === "verified" ? "Verified" : "Approved"}
                        </span>
                        {safeNumber(applicant.pastCredits, 0)} credits prev
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        disabled={saving}
                        onClick={() => openApprovedDeclineModal(applicant)}
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-muted small">No approved volunteers yet.</div>
          )}
        </div>

        <div className="orgp-block">
          <div className="orgp-section-label">OPPORTUNITY DETAILS</div>
          {selectedOpportunityDetailLoading ? (
            <div className="mt-2">
              <LoadingSpinner text="Loading event details..." />
            </div>
          ) : selectedOpportunityDetailError ? (
            <div className="alert alert-warning py-2 mt-2 mb-0" role="alert">
              {selectedOpportunityDetailError}
            </div>
          ) : (
            <div className="orgp-opportunity-details">
              <div className="orgp-opportunity-detail-copy">
                <div className="orgp-opportunity-detail-label">Description</div>
                <div className="orgp-opportunity-detail-copy-value">
                  {descriptionText || "No description has been added yet."}
                </div>
              </div>

              {requirementsText ? (
                <div className="orgp-opportunity-detail-copy">
                  <div className="orgp-opportunity-detail-label">Requirements</div>
                  <div className="orgp-opportunity-detail-copy-value">{requirementsText}</div>
                </div>
              ) : null}

              {!descriptionText ? (
                <div className="orgp-opportunity-detail-empty">
                  Add details to the event description to show them here.
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderScheduleOverview() {
    if (scheduleLoading) {
      return (
        <div className="d-flex justify-content-center py-4">
          <div className="spinner-border" role="status" aria-label="Loading schedule"></div>
        </div>
      );
    }

    if (scheduleError) {
      return (
        <div className="text-muted text-center py-4">
          {scheduleError}
          <button type="button" className="btn btn-link btn-sm orgp-link-btn d-block mx-auto mt-2" onClick={fetchSchedule}>
            Retry
          </button>
        </div>
      );
    }

    const locations = Array.isArray(scheduleData?.locations) ? scheduleData.locations : [];
    const problemLocations = locations.filter((location) => location?.hasProblems);

    if (!scheduleData) {
      return <div className="text-muted text-center py-4">Schedule not loaded.</div>;
    }

    return (
      <div>
        <div className="orgp-block mb-3">
          <div className="orgp-section-label">RANGE</div>
          <div className="fw-semibold" style={{ color: "#455a7c" }}>
            {formatScheduleRangeLabel(scheduleData.range)}
          </div>
          <div className="small text-muted mt-1">
            {formatScheduleCount(scheduleData?.totals?.opportunities)} opportunities
          </div>
        </div>

        <div className="orgp-section-label">PROBLEM LOCATIONS</div>
        <div className="list-group orgp-queue-list">
          {problemLocations.length ? (
            problemLocations.map((location) => (
              <div key={`schedule-problem-${location.locationText}`} className="list-group-item orgp-queue-item">
                <div className="d-flex align-items-center gap-2">
                  <i className="fas fa-triangle-exclamation orgp-item-icon orgp-item-icon-warning" aria-hidden="true"></i>
                  <span className="flex-grow-1">{location.locationText}</span>
                  <span className="badge text-bg-warning">
                    {formatScheduleCount(location?.totals?.opportunities)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="text-muted small">No problem locations in this range.</div>
          )}
        </div>
      </div>
    );
  }

  function renderScheduleMetric(label, value) {
    return (
      <div className="orgp-schedule-metric" key={label}>
        <div className="orgp-schedule-metric-label">{label}</div>
        <div className="orgp-schedule-metric-value">{value}</div>
      </div>
    );
  }

  function goToPreviousScheduleRange() {
    const currentRange = scheduleRangeOverride || scheduleData?.range;
    if (!currentRange?.start) return;
    setScheduleData(null);
    setScheduleRangeOverride(buildScheduleWeekRange(addDaysToScheduleYmd(currentRange.start, -7)));
  }

  function goToNextScheduleRange() {
    const currentRange = scheduleRangeOverride || scheduleData?.range;
    if (!currentRange?.start) return;
    setScheduleData(null);
    setScheduleRangeOverride(buildScheduleWeekRange(addDaysToScheduleYmd(currentRange.start, 7)));
  }

  function goToTodayScheduleRange() {
    setScheduleData(null);
    if (!scheduleRangeOverride) {
      fetchSchedule();
      return;
    }
    setScheduleRangeOverride(null);
  }

  function renderScheduleDateControls(activeRange) {
    const rangeForDisplay = activeRange || null;
    const canShiftRange = Boolean(rangeForDisplay?.start);

    return (
      <div className="d-flex flex-column align-items-start align-items-md-end gap-2">
        <div className="text-md-end">
          <div className="orgp-section-label mb-1">ACTIVE RANGE</div>
          <div className="fw-semibold" style={{ color: "#455a7c" }}>
            {formatScheduleRangeLabel(rangeForDisplay)}
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2 justify-content-md-end">
          <div className="btn-group btn-group-sm" role="group" aria-label="Schedule view">
            <button type="button" className="btn btn-sm orgp-btn-ink-outline active" aria-pressed="true">
              Week
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              disabled
              title="Month view is coming next"
            >
              Month
            </button>
          </div>
          <div className="btn-group btn-group-sm" role="group" aria-label="Schedule date navigation">
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={goToPreviousScheduleRange} disabled={!canShiftRange}>
              <i className="fas fa-chevron-left me-1" aria-hidden="true"></i>
              Previous
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={goToTodayScheduleRange}>
              Today
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={goToNextScheduleRange} disabled={!canShiftRange}>
              Next
              <i className="fas fa-chevron-right ms-1" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    );
  }

  function findScheduleOpportunityQueueItem(opportunityId) {
    const eventId = String(opportunityId || "").trim();
    if (!eventId) return null;
    const sections = opportunitiesQueueSections || {};
    return [
      ...(sections.needsAttention || []),
      ...(sections.upcoming || []),
      ...(sections.active || []),
      ...(sections.drafts || []),
      ...(sections.completed || []),
      ...(sections.cancelled || []),
    ].find((item) => String(item?.opportunityId || "") === eventId) || null;
  }

  function buildScheduleOpportunityQueueItem(opportunity) {
    const eventId = String(opportunity?.id || "").trim();
    const existingItem = findScheduleOpportunityQueueItem(eventId);
    if (existingItem) return existingItem;

    const pendingJoinCount = safeNumber(opportunity?.pendingCount, 0);
    const pendingVerifyCount = safeNumber(opportunity?.pendingVerificationCount, 0);
    const status = String(opportunity?.status || "").toLowerCase();
    const type =
      status === "cancelled"
        ? "opp-cancelled"
        : status === "completed"
          ? "opp-completed"
          : status === "draft"
            ? "opp-draft"
            : pendingJoinCount > 0
              ? "opp-approval"
              : status === "active"
                ? "opp-active"
                : "opp-upcoming";
    const icon =
      type === "opp-approval"
        ? "fa-user-check"
        : type === "opp-active"
          ? "fa-circle"
          : type === "opp-draft"
            ? "fa-file"
            : type === "opp-cancelled"
              ? "fa-ban"
              : type === "opp-completed"
                ? "fa-check-circle"
                : "fa-calendar";

    return {
      id: `schedule-opportunity-${eventId}`,
      tab: "opportunities",
      type,
      opportunityId: eventId,
      opportunityName: opportunity?.title || "Untitled opportunity",
      label: opportunity?.title || "Untitled opportunity",
      icon,
      startTime: opportunity?.startAt || null,
      endTime: opportunity?.endAt || null,
      timeZone: opportunity?.tz || "America/Vancouver",
      pendingCount: pendingJoinCount,
      pendingJoinCount,
      pendingVerifyCount,
      pendingActionsCount: pendingJoinCount + pendingVerifyCount,
      approvedCount: safeNumber(opportunity?.acceptedCount, 0),
      checkedInCount: safeNumber(opportunity?.checkedInCount, 0),
      capacity: opportunity?.capacity == null ? null : safeNumber(opportunity.capacity, null),
    };
  }

  function resolveScheduleCheckinQueueGroup(opportunity) {
    const status = String(opportunity?.status || "").toLowerCase();
    if (status === "cancelled") return null;

    const now = new Date();
    const soonLimit = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const startAt = opportunity?.startAt ? new Date(opportunity.startAt) : null;
    const endAt = opportunity?.endAt ? new Date(opportunity.endAt) : null;
    const validStart = startAt && !Number.isNaN(startAt.getTime()) ? startAt : null;
    const validEnd = endAt && !Number.isNaN(endAt.getTime()) ? endAt : null;
    const fallbackEnd =
      validStart && !validEnd ? new Date(validStart.getTime() + 3 * 60 * 60 * 1000) : null;
    const effectiveEnd = validEnd || fallbackEnd;
    const pendingVerifyCount = safeNumber(opportunity?.pendingVerificationCount, 0);

    if (validStart && effectiveEnd && validStart <= now && effectiveEnd >= now) return "activeNow";
    if (validStart && validStart > now && validStart <= soonLimit) return "startingSoon";
    if (validStart && validStart > now && isSameCalendarDay(validStart, now)) return "laterToday";
    if (effectiveEnd && effectiveEnd < now && pendingVerifyCount > 0) return "checkoutPending";
    if (!validStart) return "startingSoon";
    return null;
  }

  function buildScheduleCheckinQueueItem(opportunity) {
    const eventId = String(opportunity?.id || "").trim();
    const existingItem = checkinQueueItems.find((item) => String(item?.opportunityId || "") === eventId);
    if (existingItem) return existingItem;

    const checkedInCount = safeNumber(opportunity?.checkedInCount, 0);
    const pendingVerifyCount = safeNumber(opportunity?.pendingVerificationCount, 0);
    const noShowCount = safeNumber(opportunity?.noShowCount, 0);
    const expectedCount = Math.max(safeNumber(opportunity?.acceptedCount, 0) + checkedInCount, checkedInCount);
    const startLabel = opportunity?.startAt
      ? formatTimeInZone(opportunity.startAt, opportunity?.tz || "America/Vancouver")
      : "Time TBD";
    const dateLabel = opportunity?.date ? formatScheduleDateLabel(opportunity.date) : "Date TBD";
    const endLabel = opportunity?.endAt
      ? formatTimeInZone(opportunity.endAt, opportunity?.tz || "America/Vancouver")
      : "Time TBD";
    const queueGroup = resolveScheduleCheckinQueueGroup(opportunity);

    return {
      id: `schedule-checkin-${eventId}`,
      tab: "checkin",
      opportunityId: eventId,
      icon: "fa-clipboard-check",
      iconTone: pendingVerifyCount > 0 || noShowCount > 0 ? "warning" : "",
      queueGroup: queueGroup || "scheduleRoster",
      openedFromSchedule: true,
      outsideCheckinWindow: !queueGroup,
      label: `${opportunity?.title || "Untitled opportunity"} · ${checkedInCount} checked / ${expectedCount} expected`,
      detailName: opportunity?.title || "Untitled opportunity",
      detailDateTime: `${dateLabel} · ${startLabel} - ${endLabel}`,
      summaryChecked: checkedInCount,
      summaryExpected: expectedCount,
      startTime: opportunity?.startAt || null,
      endTime: opportunity?.endAt || null,
      timeZone: opportunity?.tz || "America/Vancouver",
    };
  }

  function navigateFromSchedule(activeTabKey, selectedItem, options = {}) {
    if (!selectedItem?.opportunityId) return;
    if (activeTab === activeTabKey) {
      setSelectedQueueItem(selectedItem);
      if (options.scrollToDetail) setPendingDetailScroll("tabs");
      return;
    }

    pendingScheduleNavigationRef.current = {
      activeTab: activeTabKey,
      selectedQueueItem: selectedItem,
      scrollToDetail: Boolean(options.scrollToDetail),
    };
    setActiveTab(activeTabKey);
  }

  function navigateScheduleToOpportunity(opportunity) {
    navigateFromSchedule("opportunities", buildScheduleOpportunityQueueItem(opportunity), {
      scrollToDetail: true,
    });
  }

  function navigateScheduleToCheckin(opportunity) {
    navigateFromSchedule("checkin", buildScheduleCheckinQueueItem(opportunity));
  }

  function renderScheduleOpportunityCard(opportunity) {
    const statusLabel = opportunity?.status || "Status not set";
    const reasons = Array.isArray(opportunity?.problemReasons) ? opportunity.problemReasons : [];
    const pendingApprovalCount = safeNumber(opportunity?.pendingCount, 0);
    const pendingVerificationCount = safeNumber(opportunity?.pendingVerificationCount, 0);
    const noShowCount = safeNumber(opportunity?.noShowCount, 0);
    const showRosterNavigation = pendingVerificationCount > 0 || noShowCount > 0;

    return (
      <div key={`schedule-opportunity-${opportunity.id}`} className="orgp-schedule-card">
        <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
          <div className="orgp-truncate-wrap">
            <h4 className="orgp-schedule-card-title">{opportunity.title || "Untitled opportunity"}</h4>
            <div className="small text-muted">
              {formatScheduleTimeRange(opportunity.startAt, opportunity.endAt, opportunity.tz)}
              {opportunity.tz ? ` (${opportunity.tz})` : ""}
            </div>
          </div>
          <span className="badge text-bg-light border text-capitalize">{statusLabel}</span>
        </div>

        <div className="small text-muted mt-2">
          <i className="fas fa-location-dot me-1" aria-hidden="true"></i>
          {opportunity.locationText || "Location not set"}
        </div>

        <div className="orgp-schedule-metric-grid mt-2">
          {renderScheduleMetric("Capacity", formatScheduleCapacity(opportunity.capacity))}
          {renderScheduleMetric("Accepted", formatScheduleCount(opportunity.acceptedCount))}
          {renderScheduleMetric("Pending", formatScheduleCount(opportunity.pendingCount))}
          {renderScheduleMetric("Checked-in", formatScheduleCount(opportunity.checkedInCount))}
          {renderScheduleMetric("Verified", formatScheduleCount(opportunity.verifiedCount))}
          {renderScheduleMetric("No-show", formatScheduleCount(opportunity.noShowCount))}
          {renderScheduleMetric("Open spots", formatScheduleOpenSpots(opportunity.openSpots))}
        </div>

        {reasons.length ? (
          <div className="d-flex flex-wrap gap-1 mt-2">
            {reasons.map((reason) => (
              <span key={`${opportunity.id}-${reason}`} className="badge text-bg-warning">
                {SCHEDULE_PROBLEM_LABELS[reason] || reason}
              </span>
            ))}
          </div>
        ) : null}

        <div className="d-flex flex-wrap gap-2 mt-3">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => navigateScheduleToOpportunity(opportunity)}
          >
            <i className="fas fa-arrow-up-right-from-square me-1" aria-hidden="true"></i>
            {pendingApprovalCount > 0 ? "Review approvals" : "Open details"}
          </button>
          {showRosterNavigation ? (
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => navigateScheduleToCheckin(opportunity)}
            >
              <i className="fas fa-clipboard-check me-1" aria-hidden="true"></i>
              Open roster
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderScheduleDashboard() {
    const activeRange = scheduleRangeOverride || scheduleData?.range || null;
    const scheduleHeader = (
      <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-3">
        <div>
          <h3 className="orgp-opp-title mb-1">Schedule</h3>
          <p className="text-muted mb-0">
            Upcoming volunteer coverage by location, date, and opportunity.
          </p>
        </div>
        {renderScheduleDateControls(activeRange)}
      </div>
    );

    if (scheduleLoading) {
      return (
        <div>
          {scheduleHeader}
          <div className="d-flex justify-content-center py-4">
            <div className="spinner-border" role="status" aria-label="Loading schedule"></div>
          </div>
        </div>
      );
    }

    if (scheduleError) {
      return (
        <div>
          {scheduleHeader}
          <div className="alert alert-warning py-2" role="alert">
            {scheduleError}
            <button type="button" className="btn btn-link btn-sm p-0 ms-2 orgp-link-btn" onClick={fetchSchedule}>
              Retry
            </button>
          </div>
        </div>
      );
    }

    const locations = Array.isArray(scheduleData?.locations) ? scheduleData.locations : [];
    const totals = scheduleData?.totals || {};

    if (!scheduleData || !locations.length) {
      return (
        <div>
          {scheduleHeader}
          <div className="orgp-empty-detail orgp-empty-detail-lg">
            <i className="fas fa-calendar-days" aria-hidden="true"></i>
            <h3 className="orgp-detail-heading mb-1">No scheduled opportunities</h3>
            <p className="text-muted mb-0 text-center">No opportunities were found in the selected range.</p>
          </div>
        </div>
      );
    }

    return (
      <div>
        {scheduleHeader}
        <div className="d-flex justify-content-end mb-3">
          <span className="badge rounded-pill orgp-ink-pill">
            {formatScheduleCount(totals.problemLocations)} problem locations
          </span>
        </div>

        <div className="orgp-schedule-summary-grid mb-3">
          {renderScheduleMetric("Opportunities", formatScheduleCount(totals.opportunities))}
          {renderScheduleMetric("Accepted", formatScheduleCount(totals.accepted))}
          {renderScheduleMetric("Pending", formatScheduleCount(totals.pending))}
          {renderScheduleMetric("Checked-in", formatScheduleCount(totals.checkedIn))}
          {renderScheduleMetric("Verified", formatScheduleCount(totals.verified))}
          {renderScheduleMetric("No-show", formatScheduleCount(totals.noShow))}
          {renderScheduleMetric("Open spots", formatScheduleCount(totals.openSpots))}
        </div>

        <div className="orgp-schedule-accordion">
          {locations.map((location) => {
            const reasons = Array.isArray(location?.problemReasons) ? location.problemReasons : [];
            const dates = Array.isArray(location?.dates) ? location.dates : [];
            return (
              <details
                key={`schedule-location-${location.locationText}`}
                className={`orgp-schedule-location ${location.hasProblems ? "has-problems" : ""}`}
                open={Boolean(location.hasProblems)}
              >
                <summary className="orgp-summary orgp-schedule-summary">
                  <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
                    <div>
                      <div className="fw-semibold">{location.locationText || "Location not set"}</div>
                      <div className="small text-muted">
                        {formatScheduleCount(location?.totals?.opportunities)} opportunities · {formatScheduleCount(location?.totals?.openSpots)} open spots
                      </div>
                    </div>
                    <div className="d-flex gap-1 flex-wrap justify-content-end">
                      {reasons.length ? (
                        reasons.map((reason) => (
                          <span key={`${location.locationText}-${reason}`} className="badge text-bg-warning">
                            {SCHEDULE_PROBLEM_LABELS[reason] || reason}
                          </span>
                        ))
                      ) : (
                        <span className="badge text-bg-success">Healthy</span>
                      )}
                    </div>
                  </div>
                </summary>

                <div className="orgp-schedule-location-body">
                  {dates.map((dateGroup) => (
                    <div key={`${location.locationText}-${dateGroup.date || "date-not-set"}`} className="orgp-schedule-date-group">
                      <div className="orgp-section-label mb-2">
                        {formatScheduleDateLabel(dateGroup.date)}
                      </div>
                      <div className="d-grid gap-2">
                        {(Array.isArray(dateGroup.opportunities) ? dateGroup.opportunities : []).map((opportunity) =>
                          renderScheduleOpportunityCard(opportunity)
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </div>
    );
  }

  const checkoutPendingRows = useMemo(() => {
    const endTs = selectedCheckinEndTime ? new Date(selectedCheckinEndTime).getTime() : NaN;
    const now = Date.now();
    if (Number.isNaN(endTs) || now < endTs) return [];

    return roster
      .filter((row) => {
        const rsvpStatus = String(row.statusRaw || "").toLowerCase();
        const verificationStatus = String(row.verificationStatus || "").toLowerCase();
        return ["accepted", "checked_in"].includes(rsvpStatus) && row.noShow !== true && verificationStatus !== "verified";
      })
      .map((row) => ({
        id: row.id,
        label:
          row.status === "checked-in"
            ? `${row.name} — checked in since ${row.time}`
            : `${row.name} — awaiting verification`,
      }));
  }, [roster, selectedCheckinEndTime]);

  function renderCheckinQueue() {
    if (checkinQueueLoading) {
      return (
        <div className="d-flex justify-content-center py-4">
          <div className="spinner-border" role="status" aria-label="Loading check-in queue"></div>
        </div>
      );
    }

    if (checkinQueueError) {
      return <div className="text-muted text-center py-4">Could not load shifts right now.</div>;
    }

    const noShiftsToday =
      !checkinQueueSections.activeNow.length &&
      !checkinQueueSections.startingSoon.length &&
      !checkinQueueSections.laterToday.length &&
      !checkinQueueSections.checkoutPending.length;
    const selectedEndTs = selectedCheckinEndTime ? new Date(selectedCheckinEndTime).getTime() : NaN;
    const isCheckoutPhase = !Number.isNaN(selectedEndTs) && Date.now() >= selectedEndTs;

    if (noShiftsToday) {
      return <div className="text-muted text-center py-4">No shifts scheduled today</div>;
    }

    return (
      <>
        {checkinQueueSections.activeNow.length ? (
          <div className="mb-3">
            <div className="orgp-group-label">
              <span className="orgp-dot orgp-dot-urgent" aria-hidden="true"></span>
              ACTIVE NOW
            </div>
            <div className="list-group orgp-queue-list">
              {checkinQueueSections.activeNow.map((item) => renderQueueItem(item))}
            </div>
          </div>
        ) : null}

        {checkinQueueSections.startingSoon.length ? (
          <div className="mb-3">
            <div className="orgp-group-label">
              <span className="orgp-dot orgp-dot-today" aria-hidden="true"></span>
              STARTING SOON
            </div>
            <div className="list-group orgp-queue-list">
              {checkinQueueSections.startingSoon.map((item) => renderQueueItem(item))}
            </div>
          </div>
        ) : null}

        {checkinQueueSections.laterToday.length ? (
          <div className="mb-3">
            <div className="orgp-group-label">
              <span className="orgp-dot orgp-dot-week" aria-hidden="true"></span>
              LATER TODAY
            </div>
            <div className="list-group orgp-queue-list">
              {checkinQueueSections.laterToday.map((item) => renderQueueItem(item))}
            </div>
          </div>
        ) : null}

        {checkinQueueSections.checkoutPending.length ? (
          <div className="mb-3">
            <div className="orgp-group-label">
              <span className="orgp-dot orgp-dot-urgent" aria-hidden="true"></span>
              CHECK-OUT PENDING
            </div>
            <div className="list-group orgp-queue-list">
              {checkinQueueSections.checkoutPending.map((item) => renderQueueItem(item))}
            </div>
          </div>
        ) : null}

        <div className="orgp-block">
          <div className="orgp-section-label mb-2">PENDING VERIFICATION ({checkoutPendingRows.length})</div>
          <ul className="list-group list-group-flush mb-2">
            {checkoutPendingRows.length ? (
              checkoutPendingRows.map((row) => (
                <li key={row.id} className="list-group-item px-0 py-1 small text-muted">
                  {row.label}
                </li>
              ))
            ) : (
              <li className="list-group-item px-0 py-1 small text-muted">No pending check-outs.</li>
            )}
          </ul>
          {isCheckoutPhase ? (
            <button
              type="button"
              className="btn orgp-btn-ink-outline btn-sm w-100"
              onClick={handleVerifyAllCheckedIn}
              disabled={verifyAllAttendanceLoading}
            >
              {verifyAllAttendanceLoading ? "Verifying..." : "Verify All Pending"}
            </button>
          ) : (
            <div className="small text-muted">Checkout verification becomes available after the shift ends.</div>
          )}
        </div>
      </>
    );
  }

  function renderCheckinDetail() {
    if (!selectedCheckinEventId) return <CheckinEmptyDetail />;

    const selectedShift = selectedQueueItem?.tab === "checkin" ? selectedQueueItem : null;
    const selectedShiftEndTs = selectedShift?.endTime ? new Date(selectedShift.endTime).getTime() : NaN;
    const isCheckoutPhase = !Number.isNaN(selectedShiftEndTs) && Date.now() >= selectedShiftEndTs;
    const checkinOrigin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://getkinder.ai";
    const checkinUrl = `${checkinOrigin}/checkin/${encodeURIComponent(selectedCheckinEventId)}`;
    const checkedCount = roster.filter((row) => row.status === "checked-in").length;
    const expectedCount = roster.length;
    const checkinDateTimeLabel = formatEventDateTime(
      selectedShift?.startTime,
      selectedShift?.endTime,
      selectedShift?.timeZone
    );

    return (
      <div>
        <h3 className="orgp-opp-title mb-1">{selectedShift?.detailName || "Opportunity"}</h3>
        <div className="text-muted small mb-3">{checkinDateTimeLabel}</div>

        {selectedShift?.openedFromSchedule && selectedShift?.outsideCheckinWindow ? (
          <div className="alert alert-info py-2 small" role="status">
            Opened from Schedule. Schedule navigation is read-only, and this event is outside the current check-in queue window; the selected roster is shown here for review.
          </div>
        ) : null}

        <div className="orgp-checkin-qr-wrap mb-3">
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(checkinUrl)}`}
            alt="Event check-in QR code"
            width="200"
            height="200"
            loading="lazy"
          />
          <div className="small text-muted mt-2">Volunteers scan to check in</div>
        </div>

        <div className="orgp-block">
          <div className="d-flex justify-content-between align-items-center mb-2 gap-2 flex-wrap">
            <div className="orgp-section-label mb-0">ROSTER</div>
            <span className="badge rounded-pill orgp-ink-pill">{checkedCount} / {expectedCount} checked in</span>
            {isCheckoutPhase ? <span className="badge text-bg-warning">Checkout phase</span> : null}
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => fetchRoster(selectedCheckinEventId, selectedCheckinStartTime)}
              aria-label="Refresh roster"
            >
              <i className={`fas fa-sync ${rosterLoading ? "fa-spin" : ""}`} aria-hidden="true"></i>
            </button>
          </div>

          {rosterLoading ? (
            <LoadingSpinner text="Loading roster..." />
          ) : rosterError ? (
            <div className="text-muted small py-2">Could not load roster. Please refresh.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-2">
                <thead>
                  <tr>
                    <th scope="col" className="orgp-roster-head">Name</th>
                    <th scope="col" className="orgp-roster-head">Status</th>
                    <th scope="col" className="orgp-roster-head">Time</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((row) => {
                    const isChecked = row.status === "checked-in";
                    const isLate = row.status === "late";
                    const isNoShow = row.status === "no-show";
                    const rowSaving = Boolean(markPresentByUser[row.id]);
                    const rowMarkingNoShow = Boolean(noShowByUser[row.id]);
                    const rowVerifying = Boolean(verifyAttendanceByUser[row.id]);
                    const ratingMeta = rateVolunteerByUser[String(row.attendeeUserId || "")] || {};
                    const rowRatingSubmitting = Boolean(ratingMeta.submitting);
                    const rowAlreadyRated = Boolean(ratingMeta.rated);
                    const isAcceptedRsvp = ["accepted", "checked_in"].includes(
                      String(row.statusRaw || "").toLowerCase()
                    );
                    const isAttendanceVerified =
                      String(row.verificationStatus || "").toLowerCase() === "verified";
                    const disableMark = isChecked || isNoShow || rowSaving || !isAcceptedRsvp || isCheckoutPhase;
                    const disableVerify = isNoShow || rowVerifying || rowMarkingNoShow || isAttendanceVerified || !isAcceptedRsvp;
                    const disableNoShow = rowMarkingNoShow || rowVerifying || isAttendanceVerified || isNoShow || !isAcceptedRsvp;
                    const disableRate = !isAcceptedRsvp || isNoShow || rowRatingSubmitting || rowAlreadyRated;
                    return (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>
                          {isChecked ? (
                            <span className="badge bg-success">✅ Checked In</span>
                          ) : isNoShow ? (
                            <span className="badge bg-dark">No-show</span>
                          ) : isLate ? (
                            <span className="badge bg-warning text-dark">⚠ Late</span>
                          ) : (
                            <span className="badge bg-secondary">⏳ Expected</span>
                          )}
                        </td>
                        <td>{row.time}</td>
                        <td>
                          {isCheckoutPhase ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => handleVerifyAttendance(row.id)}
                                disabled={disableVerify}
                                title={isAttendanceVerified ? "Already verified" : !isAcceptedRsvp ? "Volunteer must be approved first" : ""}
                              >
                                {rowVerifying
                                  ? "Verifying..."
                                  : isAttendanceVerified
                                    ? "Verified"
                                    : <><i className="fas fa-check-circle me-1" aria-hidden="true"></i>Verify</>}
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-warning ms-1"
                                onClick={() => handleMarkNoShow(row.id)}
                                disabled={disableNoShow}
                                title={isNoShow ? "Already marked no-show" : !isAcceptedRsvp ? "Volunteer must be approved first" : ""}
                              >
                                {rowMarkingNoShow
                                  ? "Saving..."
                                  : isNoShow
                                    ? "No-show"
                                    : "Mark No-Show"}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-success"
                              onClick={() => handleMarkPresent(row.id)}
                              disabled={disableMark}
                              title={isChecked ? "Already checked in" : ""}
                            >
                              {rowSaving ? "Saving..." : <><i className="fas fa-check me-1" aria-hidden="true"></i>Mark Present</>}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-dark ms-1"
                            onClick={() => handleRateVolunteer(row)}
                            disabled={disableRate}
                            title={rowAlreadyRated ? "Already rated" : ""}
                          >
                            {rowRatingSubmitting
                              ? "Saving..."
                              : rowAlreadyRated
                                ? `Rated${ratingMeta.stars ? ` (${ratingMeta.stars}★)` : ""}`
                                : "Rate Volunteer"}
                          </button>
                          {ratingMeta.error ? <div className="small text-danger mt-1">{ratingMeta.error}</div> : null}
                          {row.rowError ? <div className="small text-danger mt-1">{row.rowError}</div> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="d-flex justify-content-between gap-2 flex-wrap">
            {isCheckoutPhase ? (
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={handleVerifyAllCheckedIn}
                disabled={verifyAllAttendanceLoading}
              >
                <i className="fas fa-check-circle me-1" aria-hidden="true"></i>
                {verifyAllAttendanceLoading ? "Verifying..." : "Verify All Pending"}
              </button>
            ) : (
              <button type="button" className="btn btn-outline-success btn-sm" onClick={handleMarkAllPresent}>
                <i className="fas fa-check me-1" aria-hidden="true"></i>Mark All Present
              </button>
            )}
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => console.log("export")}>
              <i className="fas fa-file-export me-1" aria-hidden="true"></i>Export CSV
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderCreditsQueue() {
    if (creditsLoading) {
      return (
        <div className="d-flex justify-content-center py-4">
          <div className="spinner-border" role="status" aria-label="Loading credits"></div>
        </div>
      );
    }

    const pendingItems = (creditsQueue?.pendingReconcile || []).map((row) => ({
      id: `credits-pending-${row.id}`,
      tab: "credits",
      type: "credits-pending",
      opportunityId: String(row.id),
      icon: "fa-coins",
      iconTone: "warning",
      detailName: row.title || "Untitled event",
      detailDate: formatShortDate(row.start_at),
      volunteerCount: safeNumber(row.volunteer_count, 0),
      verifiedCredits: safeNumber(row.verified_credits_total, 0),
      fundedCredits: safeNumber(row.funded_credits_total, 0),
      deficitCredits: safeNumber(row.deficit_credits_total, 0),
      poolSlug: row.funding_pool_slug || "general",
      label: `${row.title || "Untitled event"} · ${formatShortDate(row.start_at)} — ${safeNumber(row.verified_credits_total, 0)} verified · ${safeNumber(row.funded_credits_total, 0)} funded · deficit ${safeNumber(row.deficit_credits_total, 0)}`,
    }));

    const reconciledItems = (creditsQueue?.reconciled || []).map((row) => ({
      id: `credits-verified-${row.id}`,
      tab: "credits",
      type: "credits-verified",
      opportunityId: String(row.id),
      icon: "fa-check-circle",
      iconTone: "success",
      detailName: row.title || "Untitled event",
      detailDate: formatShortDate(row.start_at),
      volunteerCount: safeNumber(row.volunteer_count, 0),
      verifiedCredits: safeNumber(row.verified_credits_total, 0),
      fundedCredits: safeNumber(row.funded_credits_total, 0),
      deficitCredits: safeNumber(row.deficit_credits_total, 0),
      poolSlug: row.funding_pool_slug || "general",
      label: `${row.title || "Untitled event"} · ${formatShortDate(row.start_at)} — ${safeNumber(row.verified_credits_total, 0)} verified · ${safeNumber(row.funded_credits_total, 0)} funded · deficit ${safeNumber(row.deficit_credits_total, 0)}`,
    }));

    const volunteerItems = (creditsQueue?.volunteerSummary || []).map((row) => {
      const fullName = `${row.firstname || ""} ${row.lastname || ""}`.trim() || "Volunteer";
      return {
        id: `credits-volunteer-${row.id}`,
        tab: "credits",
        type: "credits-volunteer",
        opportunityId: `volunteer-${row.id}`,
        icon: "fa-user",
        volunteerName: fullName,
        lifetimeCredits: safeNumber(row.lifetime_credits, 0),
        shiftCount: safeNumber(row.shift_count, 0),
        label: `${fullName} · ${safeNumber(row.lifetime_credits, 0)} credits lifetime`,
      };
    });

    return (
      <>
        <div className="d-flex gap-2 mb-3 orgp-credits-filter-row">
          <select className="form-select form-select-sm" defaultValue="opportunity">
            <option value="opportunity">Opportunity ▾</option>
          </select>
          <select className="form-select form-select-sm" defaultValue="date-range">
            <option value="date-range">Date Range ▾</option>
          </select>
        </div>

        <div className="mb-3">
          <div className="orgp-section-label orgp-credits-heading-pending">NEEDS FUNDING</div>
          <div className="list-group orgp-queue-list">
            {pendingItems.length
              ? pendingItems.map((item) => renderQueueItem(item))
              : <div className="text-muted small">No pending reconciliations.</div>}
          </div>
        </div>

        <div className="mb-2">
          <div className="orgp-section-label">FUNDING RECONCILED</div>
          <div className="list-group orgp-queue-list">
            {reconciledItems.length
              ? reconciledItems.map((item) => renderQueueItem(item))
              : <div className="text-muted small">No reconciled events.</div>}
          </div>
        </div>

        <div className="orgp-credits-divider">
          <div className="orgp-section-label mb-2">BY VOLUNTEER</div>
          <div className="list-group orgp-queue-list">
            {volunteerItems.length
              ? volunteerItems.map((item) => renderQueueItem(item))
              : <div className="text-muted small">No volunteer credits yet.</div>}
          </div>
        </div>
      </>
    );
  }

  function renderAttendanceStatusBadge(verificationStatus, rsvpStatus) {
    const normalizedVerification = String(verificationStatus || "").toLowerCase();
    const normalizedRsvp = String(rsvpStatus || "").toLowerCase();

    if (normalizedVerification === "verified") {
      return <span className="badge bg-success">Attendance Verified</span>;
    }
    if (normalizedRsvp === "checked_in") {
      return <span className="badge bg-warning text-dark">Checked In · Awaiting Verify</span>;
    }
    return <span className="badge bg-secondary">Approved · Awaiting Verify</span>;
  }

  function renderCreditsOpportunityDetail(item) {
    const detailRows = Array.isArray(creditDetail) ? creditDetail : [];
    const pendingRows = detailRows.filter((row) => String(row?.verification_status || "").toLowerCase() !== "verified");
    const verifyDisabled = creditsVerifyAllLoading || !pendingRows.length;

    return (
      <div>
        <h3 className="orgp-opp-title mb-1">{item.detailName || "Opportunity"}</h3>
        <div className="text-muted small mb-3">{item.detailDate || "Date TBD"}</div>

        <div className="row g-2 mb-3">
          <div className="col-12 col-md-6">
            <div className="orgp-credit-tile">
              <div className="orgp-credit-tile-label">Verified Credits</div>
              <div className="orgp-credit-tile-value">{safeNumber(item.verifiedCredits, 0)} credits</div>
              <div className="text-muted small">
                {safeNumber(item.fundedCredits, 0)} funded · deficit {safeNumber(item.deficitCredits, 0)}
              </div>
            </div>
          </div>
          <div className="col-12 col-md-6">
            <div className="orgp-credit-tile">
              <div className="orgp-credit-tile-label">Funding Pool</div>
              <div className="orgp-credit-tile-value">{item.poolSlug || "general"}</div>
              <div className="text-muted small">{safeNumber(item.volunteerCount, 0)} approved/check-in RSVPs</div>
            </div>
          </div>
        </div>

        <div className="orgp-section-label">ATTENDANCE & CREDITS</div>
        {creditDetailLoading ? (
          <LoadingSpinner text="Loading credit detail..." />
        ) : (
          <div className="table-responsive mb-3">
            <table className="table table-sm table-striped align-middle mb-0">
              <thead>
                <tr>
                  <th scope="col" className="orgp-roster-head">Name</th>
                  <th scope="col" className="orgp-roster-head">Hrs</th>
                  <th scope="col" className="orgp-roster-head">Credits</th>
                  <th scope="col" className="orgp-roster-head">Attendance</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.length ? (
                  detailRows.map((row) => {
                    const fullName = `${row.firstname || ""} ${row.lastname || ""}`.trim() || "Volunteer";
                    const awardedCredits = safeNumber(row.credits_earned, 0);
                    const pendingCredits = safeNumber(row.credits_pending, 0);
                    const creditsText =
                      pendingCredits > 0
                        ? `${pendingCredits} pending`
                        : `${awardedCredits}`;
                    return (
                      <tr key={`credit-row-${row.id}`}>
                        <td>{fullName}</td>
                        <td>{(safeNumber(row.attended_minutes, 0) / 60).toFixed(1)}</td>
                        <td>{creditsText}</td>
                        <td>{renderAttendanceStatusBadge(row.verification_status, row.rsvp_status)}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="4" className="text-muted small">No approved or checked-in volunteers yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <button
          type="button"
          className="btn orgp-btn-coral w-100"
          disabled={verifyDisabled}
          onClick={handleVerifyAllCreditsPending}
        >
          {creditsVerifyAllLoading ? "Verifying..." : "Verify Pending Attendance"}
        </button>
        {creditsActionError ? (
          <div className="small text-danger mt-2">{creditsActionError}</div>
        ) : null}
        <button
          type="button"
          className="btn btn-outline-secondary w-100 mt-2"
          onClick={() => console.log("export credits")}
        >
          📤 Export CSV
        </button>
      </div>
    );
  }

  function renderCreditsVolunteerDetail(item) {
    return (
      <div>
        <h3 className="orgp-opp-title mb-1">{item.volunteerName || "Volunteer"}</h3>
        <div className="text-muted small mb-3">Lifetime Credits Summary</div>

        <div className="orgp-credit-tile mb-3">
          <div className="orgp-credit-tile-value">
            {item.lifetimeCredits} credits · {item.shiftCount} shifts
          </div>
        </div>
      </div>
    );
  }

  function renderCreditsDetail() {
    if (!selectedCreditsItem) return <CreditsEmptyDetail />;
    if (selectedCreditsItem.type === "credits-volunteer") {
      return renderCreditsVolunteerDetail(selectedCreditsItem);
    }
    return renderCreditsOpportunityDetail(selectedCreditsItem);
  }

  function renderReportsFilters() {
    const opportunities = Array.isArray(reportData?.opportunityList) ? reportData.opportunityList : [];
    const volunteers = Array.isArray(reportData?.volunteerList) ? reportData.volunteerList : [];

    return (
      <div>
        <div className="orgp-section-label mb-2">DATE RANGE</div>
        <div className="mb-3">
          <div className="form-check">
            <input
              className="form-check-input"
              type="radio"
              name="reportsDateRange"
              id="reports-range-7"
              checked={Number(reportFilters.range) === 7}
              onChange={() => updateReportsFilter("range", 7)}
            />
            <label className="form-check-label" htmlFor="reports-range-7">
              Last 7 days
            </label>
          </div>
          <div className="form-check">
            <input
              className="form-check-input"
              type="radio"
              name="reportsDateRange"
              id="reports-range-30"
              checked={Number(reportFilters.range) === 30}
              onChange={() => updateReportsFilter("range", 30)}
            />
            <label className="form-check-label" htmlFor="reports-range-30">
              Last 30 days
            </label>
          </div>
          <div className="form-check">
            <input
              className="form-check-input"
              type="radio"
              name="reportsDateRange"
              id="reports-range-90"
              checked={Number(reportFilters.range) === 90}
              onChange={() => updateReportsFilter("range", 90)}
            />
            <label className="form-check-label" htmlFor="reports-range-90">
              Last 90 days
            </label>
          </div>
        </div>

        <div className="orgp-reports-divider pt-3 mt-2">
          <label htmlFor="reports-opportunity" className="form-label mb-1">Opportunity</label>
          <select
            id="reports-opportunity"
            className="form-select form-select-sm"
            value={reportFilters.opportunityId}
            onChange={(e) => updateReportsFilter("opportunityId", e.target.value)}
          >
            <option value="all">All opportunities</option>
            {opportunities.map((opportunity) => (
              <option key={`report-opp-${opportunity.id}`} value={String(opportunity.id)}>
                {opportunity.title || "Untitled event"}
              </option>
            ))}
          </select>
        </div>

        <div className="orgp-reports-divider pt-3 mt-3">
          <label htmlFor="reports-volunteer" className="form-label mb-1">Volunteer</label>
          <select
            id="reports-volunteer"
            className="form-select form-select-sm"
            value={reportFilters.volunteerId}
            onChange={(e) => updateReportsFilter("volunteerId", e.target.value)}
          >
            <option value="all">All volunteers</option>
            {volunteers.map((volunteer) => {
              const name = `${volunteer.firstname || ""} ${volunteer.lastname || ""}`.trim() || "Volunteer";
              return (
                <option key={`report-vol-${volunteer.id}`} value={String(volunteer.id)}>
                  {name}
                </option>
              );
            })}
          </select>
        </div>

        <div className="orgp-reports-divider pt-3 mt-3">
          <div className="orgp-section-label mb-2">QUICK VIEWS</div>
          <div className="d-grid gap-2">
            <button type="button" className="btn btn-link p-0 text-start orgp-quick-link" onClick={() => handleReportsQuickView("Top volunteers")}>
              ▸ Top volunteers
            </button>
            <button type="button" className="btn btn-link p-0 text-start orgp-quick-link" onClick={() => handleReportsQuickView("By opportunity")}>
              ▸ By opportunity
            </button>
            <button type="button" className="btn btn-link p-0 text-start orgp-quick-link" onClick={() => handleReportsQuickView("Funder impact")}>
              ▸ Funder impact
            </button>
            <button type="button" className="btn btn-link p-0 text-start orgp-quick-link" onClick={() => handleReportsQuickView("Month over month")}>
              ▸ Month over month
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderReportsDashboard() {
    const hoursByMonth = Array.isArray(reportData?.hoursByMonth) ? reportData.hoursByMonth : [];
    const fillRateByMonth = Array.isArray(reportData?.fillRateByMonth) ? reportData.fillRateByMonth : [];
    const impactByMonth = Array.isArray(reportData?.impactByMonth) ? reportData.impactByMonth : [];
    const topVolunteers = Array.isArray(reportData?.topVolunteers) ? reportData.topVolunteers : [];

    const totalHours = hoursByMonth.reduce((sum, row) => sum + safeNumber(row.hours, 0), 0);
    const latestFillRate = fillRateByMonth.length ? safeNumber(fillRateByMonth[fillRateByMonth.length - 1]?.rate, 0) : 0;
    const noShowRate = safeNumber(reportData?.noShowRate, 0);
    const totalImpact = impactByMonth.reduce((sum, row) => sum + safeNumber(row.value, 0), 0);

    const loadingOverlay = reportsLoading ? (
      <div
        className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
        style={{ background: "rgba(255,255,255,0.7)", borderRadius: "18px", zIndex: 2 }}
      >
        <div className="spinner-border spinner-border-sm" role="status" aria-label="Loading chart"></div>
      </div>
    ) : null;

    return (
      <div>
        <div className="row g-3 mb-3">
          <div className="col-12 col-md-6">
            <div className="orgp-report-card position-relative">
              {loadingOverlay}
              <div className="orgp-section-label">HOURS TREND</div>
              <div className="orgp-report-canvas-wrap">
                <canvas id="hoursChart" ref={hoursChartCanvasRef} style={{ height: "180px" }}></canvas>
              </div>
              <div className="small text-muted">{`${totalHours.toFixed(1)} total hours · last ${reportFilters.range} days`}</div>
            </div>
          </div>
          <div className="col-12 col-md-6">
            <div className="orgp-report-card position-relative">
              {loadingOverlay}
              <div className="orgp-section-label">FILL RATE</div>
              <div className="orgp-report-canvas-wrap">
                <canvas id="fillRateChart" ref={fillRateChartCanvasRef} style={{ height: "180px" }}></canvas>
              </div>
              <div className="small text-muted">{`${latestFillRate.toFixed(1)}% average · last ${reportFilters.range} days`}</div>
            </div>
          </div>
          <div className="col-12 col-md-6">
            <div className="orgp-report-card position-relative">
              {loadingOverlay}
              <div className="orgp-section-label">NO-SHOW RATE</div>
              <div className="orgp-report-canvas-wrap orgp-doughnut-wrap">
                <canvas id="noShowChart" ref={noShowChartCanvasRef} style={{ height: "180px" }}></canvas>
                <div className="orgp-doughnut-center">
                  <div className="orgp-doughnut-value">{`${noShowRate.toFixed(1)}%`}</div>
                  <div className="small text-muted">no-show rate</div>
                </div>
              </div>
              <div className="small text-muted">{`based on the last ${reportFilters.range} days`}</div>
            </div>
          </div>
          <div className="col-12 col-md-6">
            <div className="orgp-report-card position-relative">
              {loadingOverlay}
              <div className="orgp-section-label">IMPACT VALUE</div>
              <div className="orgp-report-canvas-wrap">
                <canvas id="impactChart" ref={impactChartCanvasRef} style={{ height: "180px" }}></canvas>
              </div>
              <div className="small text-muted">{`$${Math.round(totalImpact).toLocaleString()} est. value · last ${reportFilters.range} days`}</div>
            </div>
          </div>
        </div>

        <div className="orgp-section-label">TOP VOLUNTEERS</div>
        <div className="table-responsive mb-3">
          <table className="table table-hover table-sm align-middle mb-0">
            <thead>
              <tr>
                <th scope="col" className="orgp-roster-head">Rank</th>
                <th scope="col" className="orgp-roster-head">Name</th>
                <th scope="col" className="orgp-roster-head">Hrs</th>
                <th scope="col" className="orgp-roster-head">Credits</th>
                <th scope="col" className="orgp-roster-head">Shifts</th>
              </tr>
            </thead>
            <tbody>
              {topVolunteers.length ? (
                topVolunteers.map((row, idx) => {
                  const name = `${row.firstname || ""} ${row.lastname || ""}`.trim() || "Volunteer";
                  const rank = idx + 1;
                  return (
                    <tr key={`report-vol-${name}-${rank}`} className={rank === 1 ? "orgp-top-rank-row" : ""}>
                      <td className="orgp-rank-cell">{rank}</td>
                      <td>{name}</td>
                      <td>{safeNumber(row.total_hours, 0).toFixed(1)}</td>
                      <td>{safeNumber(row.total_credits, 0)}</td>
                      <td>{safeNumber(row.shift_count, 0)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="5" className="text-muted small">No volunteer data for this period</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="d-flex justify-content-end gap-2">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => console.log("export pdf")}>
            📤 Export PDF
          </button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => console.log("export csv")}>
            📤 Export CSV
          </button>
        </div>
      </div>
    );
  }

  function renderCommsQueueItem(item, { muted = false } = {}) {
    const isActive = selectedCommsItemId === item.id;
    const toneClass = item.iconTone ? `orgp-item-icon-${item.iconTone}` : "";

    return (
      <button
        key={item.id}
        type="button"
        className={`list-group-item list-group-item-action orgp-queue-item ${isActive ? "active" : ""} ${muted ? "orgp-comms-muted-item" : ""}`}
        onClick={() => handleCommsSelectItem(item)}
      >
        <div className="d-flex align-items-start gap-2">
          <i className={`fas ${item.icon} orgp-item-icon ${toneClass}`} aria-hidden="true"></i>
          <div className="text-start">
            <div>{item.title}</div>
            <div className="small text-muted">{item.subtext}</div>
          </div>
        </div>
      </button>
    );
  }

  function renderCommsQueue() {
    if (commsLoading) {
      return (
        <div className="d-flex justify-content-center py-4">
          <div className="spinner-border" role="status" aria-label="Loading comms queue"></div>
        </div>
      );
    }

    if (commsError) {
      return <div className="text-muted text-center py-4">{commsError}</div>;
    }

    return (
      <>
        <div className="mb-3">
          <div className="orgp-section-label orgp-comms-heading-now">SEND NOW</div>
          <div className="list-group orgp-queue-list">
            {commsQueueSections.sendNow.length
              ? commsQueueSections.sendNow.map((item) => renderCommsQueueItem(item))
              : <div className="text-muted small">No send-now messages.</div>}
          </div>
        </div>

        <div className="mb-3">
          <div className="orgp-section-label orgp-comms-heading-soon">DUE SOON</div>
          <div className="list-group orgp-queue-list">
            {commsQueueSections.dueSoon.length
              ? commsQueueSections.dueSoon.map((item) => renderCommsQueueItem(item))
              : <div className="text-muted small">No due-soon reminders.</div>}
          </div>
        </div>

        <div className="mb-2">
          <div className="orgp-section-label">UPCOMING</div>
          <div className="list-group orgp-queue-list">
            {commsQueueSections.upcoming.length
              ? commsQueueSections.upcoming.map((item) => renderCommsQueueItem(item))
              : <div className="text-muted small">No upcoming reminders.</div>}
          </div>
        </div>

        <div className="orgp-credits-divider">
          <div className="orgp-section-label mb-2">SENT HISTORY</div>
          <div className="list-group orgp-queue-list">
            {commsQueueSections.sentHistory.length
              ? commsQueueSections.sentHistory.map((item) => renderCommsQueueItem(item, { muted: true }))
              : <div className="text-muted small">No sent history yet.</div>}
          </div>
        </div>
      </>
    );
  }

  function renderCommsBadge(itemType) {
    if (itemType === "comms-thankyou" || itemType === "thankyou") {
      return <span className="badge rounded-pill orgp-comms-badge-thankyou">Thank-You</span>;
    }
    if (itemType === "comms-reminder" || itemType === "reminder") {
      return <span className="badge rounded-pill orgp-comms-badge-reminder">Reminder</span>;
    }
    if (itemType === "comms-feedback" || itemType === "feedback") {
      return <span className="badge rounded-pill orgp-comms-badge-feedback">Feedback</span>;
    }
    return <span className="badge rounded-pill text-bg-secondary">Sent</span>;
  }

  function renderCommsDetail() {
    if (!selectedCommsItem) {
      return (
        <div className="orgp-empty-detail orgp-empty-detail-lg">
          <i className="fas fa-envelope" aria-hidden="true"></i>
          <h3 className="orgp-detail-heading mb-1">Select a message from the queue</h3>
          <p className="text-muted mb-0">Review and send volunteer communications here.</p>
        </div>
      );
    }

    const selectedRecipientRecord = commsRecipients.find((recipient) => recipient.userId === selectedRecipient) || null;
    const recipientPreviewName = selectedRecipientRecord?.name || "Volunteer";
    const previewText = resolveCommsPreview(messageBody, selectedCommsItem, recipientPreviewName);
    const isSent = selectedCommsItem.type === "comms-sent";
    const recipientsCount = isSent
      ? Number(selectedCommsItem.recipientsCount || 0)
      : (selectedRecipientIds.length || Number(selectedCommsItem.recipientsCount || 0));
    const sentOnText = selectedCommsItem.sentOnText || "Date TBD";

    return (
      <div>
        <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
          {renderCommsBadge(selectedCommsItem.commsType || selectedCommsItem.type)}
          <div className="fw-semibold" style={{ color: "#455a7c" }}>
            {selectedCommsItem.opportunityName} · {selectedCommsItem.opportunityDate || "Date TBD"}
          </div>
        </div>

        <div className="mb-3">
          <span className="fw-semibold">TO:</span>{" "}
          <span>{`${recipientsCount} volunteers (${selectedCommsItem.opportunityName} · ${selectedCommsItem.opportunityDate || "Date TBD"})`}</span>
          <button
            type="button"
            className="btn btn-link btn-sm p-0 ms-2 orgp-link-btn"
            onClick={() => setRecipientEditorOpen((prev) => !prev)}
            disabled={isSent}
          >
            Edit recipients ▾
          </button>
          {recipientEditorOpen ? (
            <div className="orgp-comms-recipient-editor mt-2">
              {commsRecipientsLoading ? (
                <LoadingSpinner text="Loading recipients..." />
              ) : commsRecipients.length ? (
                commsRecipients.map((recipient) => (
                  <div className="form-check" key={`comms-recipient-${recipient.userId}`}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`comms-recipient-${recipient.userId}`}
                      checked={selectedRecipientIds.includes(recipient.userId)}
                      onChange={() => toggleRecipientSelection(recipient.userId)}
                      disabled={isSent || sending}
                    />
                    <label className="form-check-label" htmlFor={`comms-recipient-${recipient.userId}`}>
                      {recipient.name}
                    </label>
                  </div>
                ))
              ) : (
                <div className="small text-muted">No recipients found.</div>
              )}
            </div>
          ) : null}
        </div>

        <div className="orgp-section-label">TEMPLATE</div>
        <textarea
          className="form-control orgp-comms-template mb-3"
          rows={11}
          value={messageBody}
          onChange={(e) => handleCommsBodyChange(e.target.value)}
          disabled={isSent}
        />

        <div className="orgp-section-label">CHANNEL</div>
        <div className="d-flex align-items-center gap-3 mb-3">
          <div className="form-check">
            <input
              className="form-check-input"
              type="radio"
              name="commsChannel"
              id="comms-channel-email"
              checked={selectedChannel === "email"}
              onChange={() => setSelectedChannel("email")}
              disabled={isSent}
            />
            <label className="form-check-label" htmlFor="comms-channel-email">
              Email
            </label>
          </div>
          <div className="form-check">
            <input
              className="form-check-input"
              type="radio"
              name="commsChannel"
              id="comms-channel-inapp"
              checked={selectedChannel === "inapp"}
              onChange={() => setSelectedChannel("inapp")}
              disabled={isSent}
            />
            <label className="form-check-label" htmlFor="comms-channel-inapp">
              In-app only
            </label>
          </div>
        </div>

        <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-2">
          <div className="orgp-section-label mb-0">PREVIEW</div>
          <select
            className="form-select form-select-sm orgp-comms-recipient"
            value={selectedRecipient}
            onChange={(e) => setSelectedRecipient(e.target.value)}
            disabled={isSent || commsRecipientsLoading || !commsRecipients.length}
          >
            {!commsRecipients.length ? <option value="">No recipients</option> : null}
            {commsRecipients.map((recipient) => (
              <option key={recipient.userId} value={recipient.userId}>{recipient.name}</option>
            ))}
          </select>
        </div>
        <div className="orgp-comms-preview-box mb-3">
          {previewText.split("\n").map((line, idx) => (
            <div key={`preview-line-${idx}`}>{line || <>&nbsp;</>}</div>
          ))}
        </div>

        {!isSent ? (
          <>
            <button
              type="button"
              className="btn orgp-btn-coral w-100 btn-lg"
              onClick={() => setShowConfirmModal(true)}
              disabled={sending || !recipientsCount}
            >
              {sending ? "Sending..." : `Send to ${recipientsCount} Volunteers`}
            </button>
            <button
              type="button"
              className="btn orgp-btn-ink-outline w-100 mt-2"
              onClick={() => setScheduleOpen((prev) => !prev)}
              disabled={sending}
            >
              Schedule for later ▾
            </button>
            {scheduleOpen ? (
              <div className="row g-2 mt-1">
                <div className="col-12 col-md-6">
                  <input type="date" className="form-control form-control-sm" />
                </div>
                <div className="col-12 col-md-6">
                  <input type="time" className="form-control form-control-sm" />
                </div>
              </div>
            ) : null}
            {commsActionError ? (
              <div className="alert alert-warning py-2 mt-2 mb-0" role="alert">
                {commsActionError}
              </div>
            ) : null}
          </>
        ) : (
          <div className="small text-muted text-center py-2">
            {`Sent on ${sentOnText} · ${selectedCommsItem.recipientsCount || recipientsCount} recipients · via ${selectedCommsItem.channel === "inapp" ? "In-app only" : "Email"}`}
          </div>
        )}
      </div>
    );
  }

  function renderLeftPanel() {
    if (activeTab === "opportunities") return renderOpportunitiesQueue();
    if (activeTab === "schedule") return renderScheduleOverview();
    if (activeTab === "myevents") return renderMyEventsQueuePanel();
    if (activeTab === "programsProjects") return renderProgramsPanel();
    if (activeTab === "checkin") return renderCheckinQueue();
    if (activeTab === "credits") return renderCreditsQueue();
    if (activeTab === "reports") return renderReportsFilters();
    if (activeTab === "comms") return renderCommsQueue();
    return <Phase2Placeholder compact />;
  }

  function renderRightPanel() {
    if (activeTab === "opportunities") {
      if (selectedQueueItem) return renderEventWorkspace();
      return renderEventsListView();
    }
    if (activeTab === "schedule") return renderScheduleDashboard();
    if (activeTab === "myevents") return renderMyEventsDetail();
    if (activeTab === "programsProjects") return renderProjectsPanel();
    if (activeTab === "checkin") return renderCheckinDetail();
    if (activeTab === "credits") return renderCreditsDetail();
    if (activeTab === "reports") return renderReportsDashboard();
    if (activeTab === "comms") return renderCommsDetail();
    return <Phase2Placeholder />;
  }

  const isReportsTab = activeTab === "reports";
  const isEventsListTab = activeTab === "opportunities" && !selectedQueueItem;
  const isWorkspaceTab = activeTab === "opportunities" && Boolean(selectedQueueItem);
  const leftColumnClass = isReportsTab ? "col-12 col-md-3" : (isEventsListTab || isWorkspaceTab) ? "d-none" : "col-12 col-md-4";
  const rightColumnClass = isReportsTab ? "col-12 col-md-9" : (isEventsListTab || isWorkspaceTab) ? "col-12" : "col-12 col-md-8";
  const leftPanelTitle = isReportsTab
    ? "Filters"
    : activeTab === "schedule"
      ? "Schedule"
      : activeTab === "myevents"
        ? "Event Queue"
        : activeTab === "programsProjects"
          ? "Programs"
        : "Ops Queue";
  const rightPanelTitle = isReportsTab
    ? "Reports Dashboard"
    : activeTab === "schedule"
      ? "Coverage"
      : activeTab === "myevents"
        ? "Funding Detail"
        : activeTab === "programsProjects"
          ? "Projects"
        : "Detail Panel";
  const isDraftCancelIntent = Boolean(cancelModalTarget?.isDraft);
  const isForceCancelMode = forceCancelMode && !isDraftCancelIntent;
  const profileApplicant = applicantProfileModal.applicant;
  const profileApplicantName = profileApplicant?.displayName || "Volunteer";
  const profileApplicantEmail = profileApplicant?.email || "No email on file";
  const profilePictureUrl = profileApplicant?.avatarUrl || "/images/nerdy-KAI.png";
  const profileLocation = profileApplicant?.locationLabel || "Location not set";
  const profilePriorityTier = String(profileApplicant?.priorityTier || "Bronze").trim() || "Bronze";
  const profilePriorityTierKey = String(profilePriorityTier).toLowerCase();
  const profileTierClass = `orgp-tier-${
    ["bronze", "silver", "gold", "platinum"].includes(profilePriorityTierKey)
      ? profilePriorityTierKey
      : "bronze"
  }`;
  const profileSdgGoals = Array.isArray(profileApplicant?.sdgGoals) ? profileApplicant.sdgGoals : [];
  const profileVerifiedHours = safeNumber(profileApplicant?.verifiedHours, 0).toFixed(1);
  const profileReliability = safeNumber(profileApplicant?.reliabilityScore, 0);
  const profileRatingValue = safeNumber(profileApplicant?.ratingValue, 5).toFixed(1);
  const profileRatingCount = safeNumber(profileApplicant?.ratingCount, 0);
  const profileRatingStarsFilled = Math.max(1, Math.min(5, safeNumber(profileApplicant?.ratingStarsFilled, 5)));

  return (
    <div className="orgp-root">
      <nav className="nav nav-tabs orgp-tabs mb-3" aria-label="Org portal sections">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`nav-link ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="row g-3">
        <div className={leftColumnClass}>
          <section className="orgp-panel orgp-queue-panel">
            <div className={`d-flex align-items-center justify-content-between mb-2 ${activeTab === "programsProjects" ? "d-none" : ""}`}>
              <h2 className="orgp-panel-title mb-0">{leftPanelTitle}</h2>
              <div className="d-none" data-user-id={userId} data-csrf-token={csrfToken}></div>
            </div>
            {renderLeftPanel()}
          </section>
        </div>

        <div className={rightColumnClass}>
          <section className="orgp-panel orgp-detail-panel" ref={detailPanelRef}>
            {activeTab === "programsProjects" ? null : (
              <div className="orgp-panel-header">
                <h2 className="orgp-panel-title mb-0">{rightPanelTitle}</h2>
                {activeTab === "opportunities" ? (
                  <button
                    type="button"
                    className="btn btn-sm orgp-btn-coral orgp-panel-action"
                    onClick={openCreateOpportunityModal}
                  >
                    <i className="fas fa-plus me-1" aria-hidden="true"></i>
                    New Opportunity
                  </button>
                ) : null}
              </div>
            )}
            {renderRightPanel()}
          </section>
        </div>
      </div>

      {myEventsToast ? (
        <div className="orgp-inline-toast-wrap">
          <div
            className={`alert py-2 px-3 mb-0 ${
              myEventsToast.type === "success"
                ? "alert-success"
                : myEventsToast.type === "info"
                  ? "alert-info"
                  : "alert-warning"
            }`}
            role="status"
          >
            <div className="d-flex align-items-center justify-content-between gap-2">
              <span>{myEventsToast.message}</span>
              <button
                type="button"
                className="btn-close"
                aria-label="Dismiss"
                onClick={() => setMyEventsToast(null)}
              ></button>
            </div>
          </div>
        </div>
      ) : null}

      {programsProjectsToast ? (
        <div className="orgp-inline-toast-wrap">
          <div
            className={`alert py-2 px-3 mb-0 ${
              programsProjectsToast.type === "success"
                ? "alert-success"
                : programsProjectsToast.type === "info"
                  ? "alert-info"
                  : "alert-warning"
            }`}
            role="status"
          >
            <div className="d-flex align-items-center justify-content-between gap-2">
              <span>{programsProjectsToast.message}</span>
              <button
                type="button"
                className="btn-close"
                aria-label="Dismiss"
                onClick={() => setProgramsProjectsToast(null)}
              ></button>
            </div>
          </div>
        </div>
      ) : null}

      {programFormModal.open ? (
        <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} role="dialog" aria-modal="true">
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <form className="modal-content orgp-program-project-modal" onSubmit={submitProgramForm}>
              <div className="modal-header">
                <h5 className="modal-title">{programFormModal.mode === "edit" ? "Edit program" : "New program"}</h5>
                <button type="button" className="btn-close" aria-label="Close" onClick={closeProgramFormModal} disabled={programFormModal.saving}></button>
              </div>
              <div className="modal-body">
                <label className="form-label w-100">
                  Name
                  <input
                    type="text"
                    className="form-control"
                    value={programFormModal.values.name}
                    onChange={(event) => updateProgramFormValue("name", event.target.value)}
                    required
                    autoFocus
                  />
                </label>
                <label className="form-label w-100">
                  Description
                  <textarea
                    className="form-control"
                    rows="3"
                    value={programFormModal.values.description}
                    onChange={(event) => updateProgramFormValue("description", event.target.value)}
                  ></textarea>
                </label>
                <label className="form-label w-100">
                  Funder
                  <input
                    type="text"
                    className="form-control"
                    list="orgpProgramFunders"
                    value={programFormModal.values.funder}
                    onChange={(event) => updateProgramFormValue("funder", event.target.value)}
                  />
                </label>
                <datalist id="orgpProgramFunders">
                  {[...new Set(programs.map((program) => program.funder).filter(Boolean))].map((funder) => (
                    <option key={`funder-${funder}`} value={funder} />
                  ))}
                </datalist>
                <div className="row g-2">
                  <div className="col-12 col-md-6">
                    <label className="form-label w-100">
                      Reporting period start
                      <input
                        type="date"
                        className="form-control"
                        value={programFormModal.values.reportingPeriodStart}
                        onChange={(event) => updateProgramFormValue("reportingPeriodStart", event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="col-12 col-md-6">
                    <label className="form-label w-100">
                      Reporting period end
                      <input
                        type="date"
                        className="form-control"
                        value={programFormModal.values.reportingPeriodEnd}
                        onChange={(event) => updateProgramFormValue("reportingPeriodEnd", event.target.value)}
                      />
                    </label>
                  </div>
                </div>
                <div className="orgp-section-label mt-2">Intended equity-deserving groups</div>
                <div className="orgp-chip-grid">
                  {PROGRAM_EQUITY_GROUPS.map((group) => (
                    <label key={`equity-${group}`} className="orgp-check-chip">
                      <input
                        type="checkbox"
                        checked={(programFormModal.values.intendedEquityGroups || []).includes(group)}
                        onChange={() => toggleProgramEquityGroup(group)}
                      />
                      <span>{group}</span>
                    </label>
                  ))}
                </div>
                {programFormModal.error ? <div className="alert alert-warning py-2 mt-3 mb-0">{programFormModal.error}</div> : null}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={closeProgramFormModal} disabled={programFormModal.saving}>Cancel</button>
                <button type="submit" className="btn orgp-btn-coral" disabled={programFormModal.saving}>
                  {programFormModal.saving ? "Saving..." : "Save program"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {projectFormModal.open ? (
        <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} role="dialog" aria-modal="true">
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <form className="modal-content orgp-program-project-modal" onSubmit={submitProjectForm}>
              <div className="modal-header">
                <h5 className="modal-title">{projectFormModal.mode === "edit" ? "Edit project" : "New project"}</h5>
                <button type="button" className="btn-close" aria-label="Close" onClick={closeProjectFormModal} disabled={projectFormModal.saving}></button>
              </div>
              <div className="modal-body">
                <label className="form-label w-100">
                  Name
                  <input
                    type="text"
                    className="form-control"
                    value={projectFormModal.values.name}
                    onChange={(event) => updateProjectFormValue("name", event.target.value)}
                    required
                    autoFocus
                  />
                </label>
                <label className="form-label w-100">
                  Program
                  <select
                    className="form-select"
                    value={projectFormModal.values.programId}
                    onChange={(event) => updateProjectFormValue("programId", event.target.value)}
                  >
                    <option value="">(no program)</option>
                    {programs.map((program) => (
                      <option key={`project-program-${program.id}`} value={program.id}>
                        {program.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-label w-100">
                  Description
                  <textarea
                    className="form-control"
                    rows="3"
                    value={projectFormModal.values.description}
                    onChange={(event) => updateProjectFormValue("description", event.target.value)}
                  ></textarea>
                </label>
                <div className="row g-2">
                  <div className="col-12 col-md-6">
                    <label className="form-label w-100">
                      Start date
                      <input
                        type="date"
                        className="form-control"
                        value={projectFormModal.values.startDate}
                        onChange={(event) => updateProjectFormValue("startDate", event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="col-12 col-md-6">
                    <label className="form-label w-100">
                      End date
                      <input
                        type="date"
                        className="form-control"
                        value={projectFormModal.values.endDate}
                        onChange={(event) => updateProjectFormValue("endDate", event.target.value)}
                      />
                    </label>
                  </div>
                </div>
                <div className="orgp-section-label mt-2">Languages</div>
                <div className="orgp-chip-grid mb-3">
                  {PROJECT_LANGUAGE_OPTIONS.map((language) => (
                    <label key={`language-${language}`} className="orgp-check-chip">
                      <input
                        type="checkbox"
                        checked={(projectFormModal.values.languages || []).includes(language)}
                        onChange={() => toggleProjectLanguage(language)}
                      />
                      <span>{language}</span>
                    </label>
                  ))}
                </div>
                <label className="form-label w-100">
                  Partner organizations
                  <input
                    type="text"
                    className="form-control"
                    value={projectFormModal.values.partnerOrgNames}
                    onChange={(event) => updateProjectFormValue("partnerOrgNames", event.target.value)}
                    placeholder="Comma-separated organization names"
                  />
                </label>
                {projectFormModal.error ? <div className="alert alert-warning py-2 mt-3 mb-0">{projectFormModal.error}</div> : null}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={closeProjectFormModal} disabled={projectFormModal.saving}>Cancel</button>
                <button type="submit" className="btn orgp-btn-coral" disabled={projectFormModal.saving}>
                  {projectFormModal.saving ? "Saving..." : "Save project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {projectLifecycleModal.open && projectLifecycleModal.project ? (
        <div className="orgp-confirm-backdrop" role="presentation">
          <div className="orgp-confirm-card shadow" role="dialog" aria-modal="true" aria-labelledby="orgpLifecycleTitle">
            <h5 className="mb-2" id="orgpLifecycleTitle">Move {projectLifecycleModal.project.name || "project"} to which stage?</h5>
            <div className="d-grid gap-2 my-3">
              {PROJECT_LIFECYCLE_STAGES
                .filter((stage) => stage !== projectLifecycleModal.project.lifecycle_stage)
                .map((stage) => (
                  <button
                    key={`stage-option-${stage}`}
                    type="button"
                    className="btn btn-outline-secondary text-start"
                    onClick={() => transitionProjectLifecycle(stage)}
                    disabled={Boolean(projectLifecycleModal.savingStage)}
                  >
                    {projectLifecycleModal.savingStage === stage ? "Moving..." : PROJECT_LIFECYCLE_LABELS[stage]}
                  </button>
                ))}
            </div>
            {projectLifecycleModal.error ? <div className="alert alert-warning py-2 mb-3">{projectLifecycleModal.error}</div> : null}
            <div className="d-flex justify-content-end">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setProjectLifecycleModal({ open: false, project: null, error: "", savingStage: "" })}
                disabled={Boolean(projectLifecycleModal.savingStage)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {programsProjectsConfirm.open ? (
        <div className="orgp-confirm-backdrop" role="presentation">
          <div className="orgp-confirm-card shadow" role="dialog" aria-modal="true" aria-labelledby="orgpProgramsProjectsConfirmTitle">
            <h5 className="mb-2" id="orgpProgramsProjectsConfirmTitle">
              {programsProjectsConfirm.type === "program-delete"
                ? `Delete program ${programsProjectsConfirm.item?.name || ""}?`
                : `Delete project ${programsProjectsConfirm.item?.name || ""}?`}
            </h5>
            <p className="text-muted mb-3">This cannot be undone.</p>
            {programsProjectsConfirm.error ? <div className="alert alert-warning py-2 mb-3">{programsProjectsConfirm.error}</div> : null}
            <div className="d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setProgramsProjectsConfirm({ open: false, type: "", item: null, error: "", saving: false })}
                disabled={programsProjectsConfirm.saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={confirmProgramsProjectsDelete}
                disabled={programsProjectsConfirm.saving}
              >
                {programsProjectsConfirm.saving ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {applicantProfileModal.open && profileApplicant ? (
        <div
          className="modal fade show d-block"
          tabIndex="-1"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="orgpApplicantProfileTitle"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeApplicantProfileModal();
          }}
        >
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content orgp-applicant-modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="orgpApplicantProfileTitle">
                  Volunteer Profile
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={closeApplicantProfileModal}
                ></button>
              </div>
              <div className="modal-body">
                <div className="orgp-applicant-hero">
                  <img
                    className="orgp-applicant-hero-avatar rounded-circle"
                    src={profilePictureUrl}
                    alt={`Profile photo of ${profileApplicantName}`}
                    onError={(event) => {
                      event.currentTarget.src = "/images/nerdy-KAI.png";
                    }}
                  />
                  <div>
                    <div className="orgp-applicant-hero-kicker">Volunteer</div>
                    <h4 className="orgp-applicant-hero-name">{profileApplicantName}</h4>
                    <div className="small text-muted">{profileApplicantEmail}</div>
                    <div className="small text-muted mt-1">
                      <i className="fas fa-location-dot me-1" aria-hidden="true"></i>
                      {profileLocation}
                    </div>
                    <span className={`badge rounded-pill orgp-tier-badge mt-2 ${profileTierClass}`}>
                      Priority Tier: {profilePriorityTier}
                    </span>
                    <div className="d-flex flex-wrap gap-2 mt-2 align-items-center orgp-applicant-sdgs">
                      <span className="orgp-applicant-hero-stat-label mb-0">MY SDG GOALS:</span>
                      {profileSdgGoals.length ? (
                        profileSdgGoals.map((sdgGoal) => {
                          const goalNumber = parseSdgGoalNumber(sdgGoal);
                          if (!goalNumber) return null;
                          return (
                            <img
                              key={`${profileApplicant?.userId || "applicant"}-${goalNumber}`}
                              src={`/images/sdgs/goal_${goalNumber}.png`}
                              alt={sdgGoal}
                              title={sdgGoal}
                              width="32"
                              height="32"
                              className="orgp-applicant-sdg-icon"
                              loading="lazy"
                            />
                          );
                        })
                      ) : (
                        <span className="small text-muted">Not set</span>
                      )}
                    </div>
                    <div className="orgp-applicant-hero-stats mt-3">
                      <div className="orgp-applicant-hero-stat">
                        <div className="orgp-applicant-hero-stat-label">Reliability</div>
                        <div className="orgp-applicant-hero-stat-value">{profileReliability}</div>
                      </div>
                      <div className="orgp-applicant-hero-stat">
                        <div className="orgp-applicant-hero-stat-label">Verified Hours</div>
                        <div className="orgp-applicant-hero-stat-value">{profileVerifiedHours}</div>
                      </div>
                      <div className="orgp-applicant-hero-stat orgp-applicant-hero-stat-full">
                        <div className="orgp-applicant-hero-stat-label">Rating</div>
                        <div
                          className="orgp-applicant-hero-rating-stars"
                          role="img"
                          aria-label={`Volunteer rating ${profileRatingValue} out of 5 stars`}
                        >
                          {Array.from({ length: 5 }).map((_, starIndex) => (
                            <i
                              key={`rating-star-${starIndex + 1}`}
                              className={`fa-solid fa-star ${starIndex + 1 <= profileRatingStarsFilled ? "is-filled" : ""}`}
                              aria-hidden="true"
                            ></i>
                          ))}
                        </div>
                        <div className="small text-muted mt-1">
                          {profileRatingValue} ({profileRatingCount})
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={closeApplicantProfileModal}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showCreateModal ? (
        <div
          className="modal fade show d-block"
          tabIndex="-1"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCreateModal(false);
              setEditingOpportunityId(null);
            }
          }}
        >
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content" style={{ borderRadius: "18px" }}>
              <div className="modal-header" style={{ borderBottom: "2px solid #ff5656" }}>
                <h5 className="modal-title fw-bold" style={{ color: "#455a7c" }}>
                  {editingOpportunityId ? "Edit Opportunity" : "New Opportunity"}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingOpportunityId(null);
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <CreateEvent
                  embedded
                  initialEditId={editingOpportunityId}
                  defaultOrgName={orgName}
                  onSaved={() => {
                    setShowCreateModal(false);
                    setEditingOpportunityId(null);
                    fetchQueue();
                  }}
                  onCancel={() => {
                    setShowCreateModal(false);
                    setEditingOpportunityId(null);
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showCancelModal ? (
        <div
          className="modal fade show d-block"
          tabIndex="-1"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !cancelLoading) {
              setShowCancelModal(false);
              setCancelError("");
              setCancelModalTarget(null);
              setForceCancelMode(false);
              setForceCancelConfirmed(false);
            }
          }}
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content" style={{ borderRadius: "16px" }}>
              <div className="modal-header">
                <h5 className="modal-title">
                  {isDraftCancelIntent
                    ? "Delete draft opportunity?"
                    : isForceCancelMode
                      ? "Force cancel this event?"
                      : "Cancel opportunity?"}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() => {
                    if (cancelLoading) return;
                    setShowCancelModal(false);
                    setCancelError("");
                    setCancelModalTarget(null);
                    setForceCancelMode(false);
                    setForceCancelConfirmed(false);
                  }}
                ></button>
              </div>
              <div className="modal-body">
                {isDraftCancelIntent
                  ? "This will permanently delete this draft. It will be removed from the Draft section and cannot be undone."
                  : isForceCancelMode
                    ? (
                      <div>
                        <div className="alert alert-danger mb-3" role="alert">
                          <strong>Warning:</strong> This event has already started or occurred. Cancelling it now will affect any volunteers who signed up or attended.
                        </div>
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id="forceCancelConfirmCheck"
                            checked={forceCancelConfirmed}
                            onChange={(e) => setForceCancelConfirmed(e.target.checked)}
                            disabled={cancelLoading}
                          />
                          <label className="form-check-label" htmlFor="forceCancelConfirmCheck">
                            I understand this event has started or already occurred
                          </label>
                        </div>
                      </div>
                    )
                    : "This will cancel this opportunity and move it to the Cancelled section."}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    if (cancelLoading) return;
                    setShowCancelModal(false);
                    setCancelError("");
                    setCancelModalTarget(null);
                    setForceCancelMode(false);
                    setForceCancelConfirmed(false);
                  }}
                  disabled={cancelLoading}
                >
                  {isDraftCancelIntent ? "Keep Draft" : "Keep Event"}
                </button>
                <button
                  type="button"
                  className={isForceCancelMode ? "btn btn-outline-danger" : "btn btn-danger"}
                  onClick={isForceCancelMode ? confirmForceCancelOpportunity : confirmCancelOpportunity}
                  disabled={cancelLoading || (isForceCancelMode && !forceCancelConfirmed)}
                >
                  {cancelLoading
                    ? isDraftCancelIntent
                      ? "Deleting..."
                      : "Cancelling..."
                    : isDraftCancelIntent
                      ? "Yes, Delete Draft"
                      : isForceCancelMode
                        ? "Force Cancel Event"
                        : "Yes, Cancel Event"}
                </button>
              </div>
              {cancelError ? (
                <div className="px-3 pb-3">
                  <div className="alert alert-warning mb-0 py-2" role="alert">
                    {cancelError}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {approvedDeclineModal.open ? (
        <div
          className="orgp-confirm-backdrop"
          role="presentation"
          onClick={(e) => {
            const saving = Boolean(actionLoadingByUser[String(approvedDeclineModal?.applicant?.userId || "")]);
            if (e.target === e.currentTarget && !saving) {
              setApprovedDeclineModal({ open: false, applicant: null });
            }
          }}
        >
          <div
            className="orgp-confirm-card shadow"
            role="dialog"
            aria-modal="true"
            aria-labelledby="orgpApprovedDeclineTitle"
          >
            <h5 className="mb-2" id="orgpApprovedDeclineTitle">Decline approved volunteer?</h5>
            <p className="text-muted mb-3">
              {approvedDeclineModal?.applicant?.displayName || "This volunteer"} will be removed from Approved Volunteers and their RSVP will be marked declined.
            </p>
            {actionError ? (
              <div className="alert alert-warning py-2 mb-3" role="alert">
                {actionError}
              </div>
            ) : null}
            <div className="d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setApprovedDeclineModal({ open: false, applicant: null })}
                disabled={Boolean(actionLoadingByUser[String(approvedDeclineModal?.applicant?.userId || "")])}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={confirmApprovedVolunteerDecline}
                disabled={Boolean(actionLoadingByUser[String(approvedDeclineModal?.applicant?.userId || "")])}
              >
                {Boolean(actionLoadingByUser[String(approvedDeclineModal?.applicant?.userId || "")])
                  ? "Declining..."
                  : "Yes, Decline Volunteer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {approveAllConfirmOpen ? (
        <div
          className="orgp-confirm-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !approveAllLoading) {
              setApproveAllConfirmOpen(false);
            }
          }}
        >
          <div
            className="orgp-confirm-card shadow"
            role="dialog"
            aria-modal="true"
            aria-labelledby="orgpApproveAllTitle"
          >
            <h5 className="mb-2" id="orgpApproveAllTitle">Approve all pending volunteers?</h5>
            <p className="text-muted mb-3">
              This will approve {pendingJoinApplicants.length} pending {pendingJoinApplicants.length === 1 ? "volunteer" : "volunteers"} for this opportunity and send approval emails to each person.
            </p>
            {actionError ? (
              <div className="alert alert-warning py-2 mb-3" role="alert">
                {actionError}
              </div>
            ) : null}
            <div className="d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setApproveAllConfirmOpen(false)}
                disabled={approveAllLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn orgp-btn-coral btn-sm"
                onClick={async () => {
                  await handleApproveAll();
                  setApproveAllConfirmOpen(false);
                }}
                disabled={approveAllLoading}
              >
                {approveAllLoading
                  ? `Approving ${approveAllProgress.current} of ${approveAllProgress.total}...`
                  : "Yes, Approve All"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PoolLedgerModal
        open={activeTab === "myevents" && myEventsLedgerOpen}
        initialPoolSlug={selectedMyEvent?.funding_pool_slug || myEventsPoolFilter || "all"}
        onClose={() => setMyEventsLedgerOpen(false)}
      />

      <InviteModal
        open={activeTab === "myevents" && myEventsInviteModal.open}
        onClose={() => setMyEventsInviteModal({ open: false, event: null })}
        eventId={myEventsInviteModal.event?.id}
        eventTitle={myEventsInviteModal.event?.title}
        onSent={(data) => {
          setMyEventsInviteModal({ open: false, event: null });
          const recipientLabel = data?.invitee_name || data?.invitee_email || "volunteer";
          setMyEventsToast({ type: "success", message: `Invite sent to ${recipientLabel}.` });
        }}
      />

      {activeTab === "opportunities" && opportunityInviteModal.open ? (
        <div className="orgp-confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="orgpInviteModalTitle">
          <div className="orgp-confirm-card orgp-invite-card">
            <div className="d-flex justify-content-between align-items-start gap-3">
              <div>
                <h4 className="orgp-invite-title" id="orgpInviteModalTitle">Invite Volunteer</h4>
                <p className="orgp-invite-subtitle mb-0">
                  Send a direct invite because the coordinator thinks this person would be a great fit for{" "}
                  <strong>{selectedOpportunity?.opportunityName || "this opportunity"}</strong>.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-link btn-sm p-0 text-muted"
                onClick={closeOpportunityInviteModal}
                disabled={opportunityInviteModal.sending}
                aria-label="Close invite form"
              >
                <i className="fas fa-xmark" aria-hidden="true"></i>
              </button>
            </div>

            <form className="orgp-invite-form" onSubmit={submitOpportunityInvite}>
              <label className="orgp-invite-field">
                <span>Email</span>
                <input
                  type="email"
                  className="form-control"
                  value={opportunityInviteModal.email}
                  onChange={(event) => setOpportunityInviteModal((prev) => ({
                    ...prev,
                    email: event.target.value,
                    error: "",
                  }))}
                  placeholder="volunteer@example.com"
                  required
                  autoFocus
                />
              </label>

              <label className="orgp-invite-field">
                <span>Name</span>
                <input
                  type="text"
                  className="form-control"
                  value={opportunityInviteModal.name}
                  onChange={(event) => setOpportunityInviteModal((prev) => ({
                    ...prev,
                    name: event.target.value,
                    error: "",
                  }))}
                  placeholder="Optional"
                />
              </label>

              <div className="orgp-invite-note">
                The email includes the opportunity details, a calendar button, and language centered on the coordinator personally inviting them.
              </div>

              {opportunityInviteModal.error ? (
                <div className="alert alert-warning py-2 mb-0" role="alert">
                  {opportunityInviteModal.error}
                </div>
              ) : null}

              <div className="d-flex justify-content-end gap-2 mt-3">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={closeOpportunityInviteModal}
                  disabled={opportunityInviteModal.sending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn org-admin-request-close-btn"
                  disabled={opportunityInviteModal.sending}
                >
                  {opportunityInviteModal.sending ? "Sending..." : "Send Invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {activeTab === "opportunities" && adminSignupModal.open ? (
        <div className="orgp-confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="orgpAdminSignupModalTitle">
          <div className="orgp-confirm-card orgp-invite-card">
            <div className="d-flex justify-content-between align-items-start gap-3">
              <div>
                <h4 className="orgp-invite-title" id="orgpAdminSignupModalTitle">Sign Up Volunteer</h4>
                <p className="orgp-invite-subtitle mb-0">
                  Directly register someone for{" "}
                  <strong>{selectedOpportunity?.opportunityName || "this opportunity"}</strong>. They don't need a Get Kinder account.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-link btn-sm p-0 text-muted"
                onClick={closeAdminSignupModal}
                disabled={adminSignupModal.sending}
                aria-label="Close signup form"
              >
                <i className="fas fa-xmark" aria-hidden="true"></i>
              </button>
            </div>

            <form className="orgp-invite-form" onSubmit={submitAdminSignup}>
              <label className="orgp-invite-field">
                <span>Name</span>
                <input
                  type="text"
                  className="form-control"
                  value={adminSignupModal.name}
                  onChange={(event) => setAdminSignupModal((prev) => ({
                    ...prev,
                    name: event.target.value,
                    error: null,
                  }))}
                  placeholder="Volunteer name"
                  required
                  autoFocus
                />
              </label>

              <label className="orgp-invite-field">
                <span>Email</span>
                <input
                  type="email"
                  className="form-control"
                  value={adminSignupModal.email}
                  onChange={(event) => setAdminSignupModal((prev) => ({
                    ...prev,
                    email: event.target.value,
                    error: null,
                  }))}
                  placeholder="volunteer@example.com (optional)"
                />
              </label>

              {String(adminSignupModal.email || "").trim() ? (
                <label className="form-check mb-0">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={adminSignupModal.sendEmail}
                    onChange={(event) => setAdminSignupModal((prev) => ({
                      ...prev,
                      sendEmail: event.target.checked,
                    }))}
                  />
                  <span className="form-check-label">Send confirmation email</span>
                </label>
              ) : null}

              <div className="orgp-invite-note">
                No email? This person will appear as unverified until they claim their account.
              </div>

              {adminSignupModal.error ? (
                <div className="alert alert-warning py-2 mb-0" role="alert">
                  {adminSignupModal.error}
                </div>
              ) : null}

              <div className="d-flex justify-content-end gap-2 mt-3">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={closeAdminSignupModal}
                  disabled={adminSignupModal.sending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn org-admin-request-close-btn"
                  disabled={adminSignupModal.sending}
                >
                  {adminSignupModal.sending ? "Signing Up..." : "Sign Up"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {renderCloseoutModal()}

      <div
        className="modal fade"
        id="orgpCommsConfirmModal"
        tabIndex="-1"
        aria-labelledby="orgpCommsConfirmModalLabel"
        aria-hidden="true"
        ref={commsConfirmModalRef}
      >
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title" id="orgpCommsConfirmModalLabel">Send message?</h5>
              <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div className="modal-body">
              {`This will send to ${selectedRecipientIds.length || selectedCommsItem?.recipientsCount || 0} volunteers via ${selectedChannel === "inapp" ? "In-app only" : "Email"}. This cannot be undone.`}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" data-bs-dismiss="modal" disabled={sending}>Cancel</button>
              <button type="button" className="btn orgp-btn-coral" onClick={handleConfirmSendComms} disabled={sending}>
                {sending ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                    Sending...
                  </>
                ) : (
                  "Yes, Send"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="toast-container position-fixed bottom-0 end-0 p-3">
        <div
          ref={commsToastRef}
          className="toast align-items-center text-bg-success border-0"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <div className="d-flex">
            <div className="toast-body">
              Message sent to {selectedRecipientIds.length || selectedCommsItem?.recipientsCount || 0} volunteers ✓
            </div>
            <button type="button" className="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
          </div>
        </div>
      </div>

      <style>{`
        .orgp-panel {
          background: #fff;
          border-radius: 18px;
          box-shadow: 0 4px 14px rgba(26, 39, 68, 0.08);
          border: 1px solid #dfe8f5;
          padding: 24px;
          min-height: 500px;
        }

        .orgp-panel-title {
          color: #455a7c;
          font-size: 1.05rem;
          font-weight: 700;
          margin-bottom: 0.9rem;
        }

        .orgp-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          margin-bottom: 0.9rem;
        }

        .orgp-panel-action {
          flex: 0 0 auto;
          white-space: nowrap;
        }

        .orgp-tabs .nav-link {
          color: #455a7c;
          border: none;
          border-bottom: 3px solid transparent;
          font-weight: 600;
        }

        .orgp-tabs .nav-link.active {
          color: #455a7c;
          background: #fff;
          border-color: transparent transparent #ff5656 transparent;
        }

        .orgp-btn-coral {
          background: #ff5656;
          border-color: #ff5656;
          color: #fff;
        }

        .orgp-btn-coral:hover,
        .orgp-btn-coral:focus {
          background: #f04c4c;
          border-color: #f04c4c;
          color: #fff;
        }

        .orgp-btn-ink-outline {
          border-color: #455a7c;
          color: #455a7c;
        }

        .orgp-btn-ink-outline:hover,
        .orgp-btn-ink-outline:focus {
          border-color: #455a7c;
          background: #f2f6fc;
          color: #455a7c;
        }

        .orgp-group-label {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          font-size: 0.76rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: #6c757d;
          margin-bottom: 0.45rem;
        }

        .orgp-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .orgp-dot-urgent { background: #dc3545; }
        .orgp-dot-today { background: #ffc107; }
        .orgp-dot-week { background: #28a745; }

        .orgp-queue-item {
          border-left: 4px solid transparent;
          margin-bottom: 0.35rem;
          border-radius: 10px;
          color: #2f3f58;
        }

        .orgp-truncate-wrap {
          min-width: 0;
          overflow: hidden;
        }

        .orgp-queue-item.active {
          border-left-color: #ff5656;
          background: #fff6f6;
          color: #212529;
        }

        .orgp-item-icon {
          color: #455a7c;
          width: 18px;
          text-align: center;
        }

        .orgp-item-icon-coral {
          color: #ff5656;
        }

        .orgp-item-icon-warning {
          color: #f0ad4e;
        }

        .orgp-item-icon-success {
          color: #198754;
        }

        .orgp-item-icon-muted {
          color: #6c757d;
        }

        .orgp-collapse-toggle {
          color: #455a7c;
          text-decoration: none;
          font-weight: 700;
          font-size: 0.8rem;
          letter-spacing: 0.04em;
        }

        .orgp-collapse-toggle:hover,
        .orgp-collapse-toggle:focus {
          color: #455a7c;
          text-decoration: underline;
        }

        .orgp-detail-heading {
          color: #455a7c;
          font-size: 1.2rem;
          font-weight: 700;
        }

        .orgp-opp-title {
          color: #455a7c;
          margin: 0;
          font-size: 1.35rem;
          font-weight: 700;
        }

        .orgp-link-btn {
          color: #455a7c;
          text-decoration: none;
        }

        .orgp-link-btn:hover,
        .orgp-link-btn:focus {
          color: #455a7c;
          text-decoration: underline;
        }

        .orgp-section-label {
          font-size: 0.72rem;
          letter-spacing: 0.09em;
          color: #6c757d;
          font-weight: 700;
          text-transform: uppercase;
          margin-bottom: 0.45rem;
        }

        .orgp-summary {
          cursor: pointer;
          list-style: none;
        }

        .orgp-summary::-webkit-details-marker {
          display: none;
        }

        .orgp-block {
          border: 1px solid #e8eef8;
          border-radius: 12px;
          padding: 12px;
          background: #fff;
        }

        .orgp-schedule-summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 8px;
        }

        .orgp-schedule-metric {
          min-width: 0;
        }

        .orgp-schedule-summary-grid .orgp-schedule-metric {
          border: 1px solid #e8eef8;
          border-radius: 10px;
          background: #f9fbff;
          padding: 10px;
        }

        .orgp-schedule-metric-label {
          color: #6c757d;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          line-height: 1.2;
          text-transform: uppercase;
        }

        .orgp-schedule-metric-value {
          color: #455a7c;
          font-size: 1rem;
          font-weight: 700;
          line-height: 1.25;
          margin-top: 2px;
        }

        .orgp-schedule-accordion {
          display: grid;
          gap: 10px;
        }

        .orgp-schedule-location {
          border: 1px solid #e8eef8;
          border-radius: 12px;
          background: #fff;
          overflow: hidden;
        }

        .orgp-schedule-location.has-problems {
          border-left: 4px solid #ffc107;
        }

        .orgp-schedule-summary {
          padding: 12px;
          color: #2f3f58;
        }

        .orgp-schedule-location-body {
          border-top: 1px solid #e8eef8;
          padding: 12px;
        }

        .orgp-schedule-date-group + .orgp-schedule-date-group {
          margin-top: 14px;
        }

        .orgp-schedule-card {
          border: 1px solid #e8eef8;
          border-radius: 10px;
          background: #fff;
          padding: 12px;
        }

        .orgp-schedule-card-title {
          color: #455a7c;
          font-size: 1rem;
          font-weight: 700;
          line-height: 1.25;
          margin: 0;
        }

        .orgp-schedule-metric-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
          gap: 8px 12px;
          border-top: 1px solid #eef3fb;
          padding-top: 10px;
        }

        .orgp-my-strip {
          border: 1px solid #e8eef8;
          border-radius: 12px;
          background: #f9fbff;
          padding: 12px;
        }

        .orgp-my-tile-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .orgp-my-tile-grid-compact .orgp-my-tile {
          padding: 10px;
        }

        .orgp-my-tile {
          background: #fff;
          border-radius: 12px;
          border: 1px solid #e8eef8;
          box-shadow: 0 3px 10px rgba(26, 39, 68, 0.06);
          padding: 12px;
        }

        .orgp-my-tile-warning {
          border-top: 3px solid #ff5656;
        }

        .orgp-my-tile-label {
          font-size: 0.68rem;
          letter-spacing: 0.08em;
          color: #6c757d;
          text-transform: uppercase;
          font-weight: 700;
          margin-bottom: 0.2rem;
        }

        .orgp-my-tile-value {
          font-size: 1.25rem;
          line-height: 1.1;
          color: #455a7c;
          font-weight: 700;
        }

        .orgp-my-pool-select {
          min-width: 125px;
          max-width: 180px;
        }

        .orgp-my-subtab {
          border-radius: 999px;
          border: 1px solid #455a7c;
          color: #455a7c;
          background: #fff;
          font-weight: 600;
          padding-inline: 12px;
        }

        .orgp-my-subtab:hover,
        .orgp-my-subtab:focus {
          border-color: #455a7c;
          color: #455a7c;
          background: #f2f6fc;
        }

        .orgp-my-subtab.active {
          border-color: #ff5656;
          background: #ff5656;
          color: #fff;
        }

        .orgp-my-event-item {
          border-left: 4px solid transparent;
        }

        .orgp-my-funding-warn {
          color: #c58a00;
          font-size: 0.85rem;
          font-weight: 700;
          white-space: nowrap;
        }

        .orgp-my-funding-good {
          color: #198754;
          font-size: 0.85rem;
          font-weight: 700;
          white-space: nowrap;
        }

        .orgp-my-stat-card {
          border: 1px solid #e8eef8;
          border-radius: 12px;
          background: #fff;
          padding: 12px;
        }

        .orgp-my-stat-label {
          font-size: 0.68rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #6c757d;
          font-weight: 700;
          margin-bottom: 0.2rem;
        }

        .orgp-my-stat-value {
          font-size: 1.15rem;
          font-weight: 700;
          color: #455a7c;
          line-height: 1.2;
        }

        .orgp-my-deficit {
          color: #ff5656;
        }

        .orgp-my-ledger-row {
          border: 1px solid #e8eef8;
          border-radius: 10px;
          background: #fff;
          padding: 8px 10px;
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }

        .orgp-my-ledger-amount {
          font-weight: 700;
          min-width: 44px;
        }

        .orgp-my-ledger-amount.credit {
          color: #198754;
        }

        .orgp-my-ledger-amount.debit {
          color: #ff5656;
        }

        .orgp-chip-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .orgp-check-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid #dfe8f5;
          border-radius: 999px;
          background: #fff;
          color: #455a7c;
          font-size: 0.9rem;
          font-weight: 600;
          padding: 7px 10px;
        }

        .orgp-check-chip input {
          accent-color: #ff5656;
        }

        .orgp-inline-toast-wrap {
          position: fixed;
          right: 1rem;
          bottom: 1rem;
          z-index: 1080;
          min-width: 260px;
          max-width: 420px;
        }

        .orgp-progress-ink {
          background: #455a7c;
        }

        .orgp-applicant-row {
          border: 1px solid #e8eef8;
          border-radius: 12px;
          padding: 0.7rem 0.75rem;
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          margin-bottom: 0.55rem;
          background: #fff;
        }

        .orgp-applicant-modal-content {
          border-radius: 16px;
          border: 1px solid #dfe8f5;
          overflow: hidden;
        }

        .orgp-applicant-hero {
          border: 1px solid #e8eef8;
          border-radius: 14px;
          background: linear-gradient(180deg, #f7faff 0%, #ffffff 100%);
          padding: 14px;
          display: grid;
          grid-template-columns: 112px minmax(0, 1fr);
          gap: 14px;
          align-items: center;
        }

        .orgp-applicant-hero-avatar {
          width: 112px;
          height: 112px;
          object-fit: cover;
          border: 3px solid #455a7c;
          background: #fff;
        }

        .orgp-applicant-hero-kicker {
          font-size: 0.73rem;
          letter-spacing: 0.09em;
          color: #6c757d;
          font-weight: 700;
          text-transform: uppercase;
        }

        .orgp-applicant-hero-name {
          margin: 0.1rem 0 0;
          color: #455a7c;
          font-weight: 700;
          font-size: 1.35rem;
        }

        .orgp-tier-badge {
          font-weight: 600;
          border: 1px solid transparent;
        }

        .orgp-tier-bronze {
          color: #6b4f2a;
          background: #f6eadf;
          border-color: #e8d3bd;
        }

        .orgp-tier-silver {
          color: #495464;
          background: #edf2f8;
          border-color: #d6e0eb;
        }

        .orgp-tier-gold {
          color: #72520f;
          background: #fff3d6;
          border-color: #f1dfad;
        }

        .orgp-tier-platinum {
          color: #2f3f58;
          background: #eef0ff;
          border-color: #d9defa;
        }

        .orgp-applicant-sdgs {
          min-height: 34px;
        }

        .orgp-applicant-sdg-icon {
          border-radius: 6px;
        }

        .orgp-applicant-hero-stats {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .orgp-applicant-hero-stat {
          border: 1px solid #e8eef8;
          border-radius: 12px;
          background: #fff;
          padding: 9px 10px;
        }

        .orgp-applicant-hero-stat-label {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: #6c757d;
          font-weight: 700;
          margin-bottom: 0.1rem;
        }

        .orgp-applicant-hero-stat-value {
          color: #455a7c;
          font-weight: 700;
          font-size: 1.12rem;
          line-height: 1.1;
        }

        .orgp-applicant-hero-stat-full {
          grid-column: 1 / -1;
        }

        .orgp-applicant-hero-rating-stars {
          color: #d2d9e6;
          letter-spacing: 0.08em;
        }

        .orgp-applicant-hero-rating-stars .is-filled {
          color: #ff5656;
        }

        .orgp-checkin-qr-wrap {
          border: 1px solid #e8eef8;
          border-radius: 12px;
          padding: 12px;
          text-align: center;
          background: #fafcff;
        }

        .orgp-checkin-qr-wrap img {
          border-radius: 8px;
          border: 1px solid #dfe8f5;
          background: #fff;
        }

        .orgp-ink-pill {
          background: #455a7c;
          color: #fff;
          font-weight: 600;
        }

        .orgp-roster-head {
          font-size: 0.72rem;
          letter-spacing: 0.09em;
          color: #6c757d;
          font-weight: 400;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .orgp-credits-filter-row .form-select {
          min-width: 0;
        }

        .orgp-credits-heading-pending {
          color: #c58a00;
        }

        .orgp-credits-divider {
          border-top: 1px solid #e8eef8;
          margin-top: 0.9rem;
          padding-top: 0.75rem;
        }

        .orgp-credit-tile {
          background: #fff;
          border: 1px solid #e8eef8;
          border-radius: 12px;
          box-shadow: 0 3px 10px rgba(26, 39, 68, 0.06);
          padding: 16px;
        }

        .orgp-credit-tile-label {
          font-size: 0.72rem;
          letter-spacing: 0.09em;
          color: #6c757d;
          font-weight: 700;
          text-transform: uppercase;
          margin-bottom: 0.2rem;
        }

        .orgp-credit-tile-value {
          color: #455a7c;
          font-weight: 700;
          font-size: 1.3rem;
          line-height: 1.2;
          margin-bottom: 0.2rem;
        }

        .orgp-comms-heading-now {
          color: #ff5656;
        }

        .orgp-comms-heading-soon {
          color: #c58a00;
        }

        .orgp-comms-muted-item {
          opacity: 0.72;
        }

        .orgp-comms-badge-thankyou {
          background: #ff5656;
          color: #fff;
        }

        .orgp-comms-badge-reminder {
          background: #ffc107;
          color: #212529;
        }

        .orgp-comms-badge-feedback {
          background: #455a7c;
          color: #fff;
        }

        .orgp-comms-template {
          background: #f8f9fa;
          border-radius: 10px;
        }

        .orgp-comms-recipient {
          max-width: 220px;
        }

        .orgp-comms-preview-box {
          background: #f8f9fa;
          border: 1px solid #e8eef8;
          border-radius: 10px;
          padding: 12px;
          font-size: 0.92rem;
          color: #2f3f58;
          white-space: pre-wrap;
        }

        .orgp-comms-recipient-editor {
          border: 1px solid #e8eef8;
          background: #f8f9fa;
          border-radius: 10px;
          padding: 10px;
          max-height: 180px;
          overflow-y: auto;
        }

        .orgp-reports-divider {
          border-top: 1px solid #e8eef8;
        }

        .orgp-quick-link {
          color: #455a7c;
          text-decoration: none;
          font-size: 0.92rem;
        }

        .orgp-quick-link:hover,
        .orgp-quick-link:focus {
          color: #455a7c;
          text-decoration: none;
        }

        .orgp-report-card {
          background: #fff;
          border-radius: 18px;
          box-shadow: 0 4px 14px rgba(26, 39, 68, 0.08);
          border: 1px solid #dfe8f5;
          padding: 20px;
          height: 100%;
        }

        .orgp-report-canvas-wrap {
          position: relative;
          height: 180px;
          margin-bottom: 0.6rem;
        }

        .orgp-report-canvas-wrap canvas {
          width: 100% !important;
          height: 180px !important;
        }

        .orgp-doughnut-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .orgp-doughnut-center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          pointer-events: none;
        }

        .orgp-doughnut-value {
          font-size: 1.45rem;
          font-weight: 700;
          color: #455a7c;
          line-height: 1;
        }

        .orgp-rank-cell {
          font-weight: 700;
          color: #455a7c;
        }

        .orgp-top-rank-row td:first-child {
          border-left: 3px solid #ffc107;
          padding-left: 0.65rem;
        }

        .orgp-empty-panel,
        .orgp-empty-detail,
        .orgp-phase2 {
          min-height: 360px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.55rem;
          text-align: center;
          color: #6c757d;
        }

        .orgp-empty-panel i,
        .orgp-empty-detail i,
        .orgp-phase2 i {
          font-size: 1.8rem;
          color: #455a7c;
        }

        .orgp-empty-title {
          font-weight: 700;
          color: #455a7c;
        }

        .orgp-empty-sub {
          font-size: 0.9rem;
          max-width: 320px;
        }

        .orgp-empty-detail-lg {
          gap: 0.8rem;
        }

        .orgp-phase2-compact {
          min-height: 260px;
        }

        .orgp-root button:focus-visible,
        .orgp-root a:focus-visible,
        .orgp-root [role="button"]:focus-visible,
        .orgp-root summary:focus-visible {
          outline: 2px solid #455a7c;
          outline-offset: 2px;
        }

        @media (max-width: 767.98px) {
          .orgp-panel {
            min-height: auto;
          }

          .orgp-empty-panel,
          .orgp-empty-detail,
          .orgp-phase2 {
            min-height: 240px;
          }

          .orgp-applicant-row {
            flex-direction: column;
          }

          .orgp-applicant-hero {
            grid-template-columns: 1fr;
            justify-items: center;
            text-align: center;
          }

          .orgp-applicant-hero-stats {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

export function renderOrgPortal(selector = "#org-portal-root", props = {}) {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;

  let root = ROOTS.get(el);
  if (!root) {
    root = ReactDOM.createRoot(el);
    ROOTS.set(el, root);
  }

  root.render(
    <React.StrictMode>
      <OrgPortal {...props} />
    </React.StrictMode>
  );
}

export function renderKpiStrip(selector = "#org-portal-kpis", props = {}) {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;

  let root = ROOTS.get(el);
  if (!root) {
    root = ReactDOM.createRoot(el);
    ROOTS.set(el, root);
  }

  root.render(
    <React.StrictMode>
      <OrgPortalKpiStrip {...props} />
    </React.StrictMode>
  );
}

export default OrgPortal;
