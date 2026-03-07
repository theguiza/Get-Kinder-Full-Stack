import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { CreateEvent } from "./events/views/CreateEvent.jsx";
import { InviteModal } from "./events/components/InviteModal.jsx";
import { PoolLedgerModal } from "./events/components/PoolLedgerModal.jsx";

const ROOTS = new WeakMap();
const KPI_REFRESH_EVENT = "orgportal:kpis:refresh";

const TABS = [
  { key: "opportunities", label: "Opportunities" },
  { key: "checkin", label: "Check-in & Check-Out" },
  { key: "credits", label: "Reconcile" },
  { key: "comms", label: "Comms" },
  { key: "myevents", label: "Funding & Events" },
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

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
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

function fillPercent(approvedCount, capacity) {
  const approved = safeNumber(approvedCount, 0);
  const cap = safeNumber(capacity, 0);
  if (!cap || cap <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((approved / cap) * 100)));
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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingOpportunityId, setEditingOpportunityId] = useState(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [cancelModalTarget, setCancelModalTarget] = useState(null);

  const [applicants, setApplicants] = useState(null);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [actionLoadingByUser, setActionLoadingByUser] = useState({});
  const [approveAllLoading, setApproveAllLoading] = useState(false);
  const [approveAllProgress, setApproveAllProgress] = useState({ current: 0, total: 0 });
  const [actionError, setActionError] = useState("");
  const [applicantCounts, setApplicantCounts] = useState(ZERO_PENDING_ACTION_COUNTS);

  const [checkinQueueItems, setCheckinQueueItems] = useState([]);
  const [checkinQueueLoading, setCheckinQueueLoading] = useState(false);
  const [checkinQueueError, setCheckinQueueError] = useState(false);
  const [roster, setRoster] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState(false);
  const [markPresentByUser, setMarkPresentByUser] = useState({});
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
    setCompletedExpanded(false);
    setCancelledExpanded(false);
    setApplicants(null);
    setApplicantCounts(ZERO_PENDING_ACTION_COUNTS);
    setDetailError("");
    setActionError("");
    setActionLoadingByUser({});
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
          row?.pendingCount ?? row?.pendingActionsCount ?? row?.pending_actions_count,
          0
        ),
        approvedCount: safeNumber(row?.approvedCount, 0),
        capacity: row?.capacity == null ? null : safeNumber(row?.capacity, null),
      }));

    return {
      needsAttention: mapRows(queue?.needsAttention || [], "needsAttention"),
      upcoming: mapRows(queue?.upcoming || [], "upcoming"),
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
      setActionLoadingByUser({});
      setApproveAllLoading(false);
      setApproveAllProgress({ current: 0, total: 0 });
    }
  }, [activeTab, selectedOpportunityId, fetchApplicantsForOpportunity]);

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
          const fallbackExpected = Math.max(
            checkedInCount,
            safeNumber(row?.approved, 0),
            safeNumber(row?.total, 0)
          );
          const expectedCount =
            row?.capacity == null ? fallbackExpected : Math.max(fallbackExpected, safeNumber(row.capacity, 0));
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
                : `${row?.title || "Untitled event"} · ${startLabel} — ${checkedInCount} checked / ${expectedCount} expected`,
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
    const monthLabels = (hoursByMonth.length ? hoursByMonth : fillRateByMonth.length ? fillRateByMonth : impactByMonth)
      .map((row) => row.month);

    if (hoursChartCanvasRef.current) {
      hoursChartRef.current = new Chart(hoursChartCanvasRef.current, {
        type: "bar",
        data: {
          labels: monthLabels.length ? monthLabels : ["Jan", "Feb", "Mar"],
          datasets: [
            {
              data: (hoursByMonth.length ? hoursByMonth.map((row) => safeNumber(row.hours, 0)) : [0, 0, 0]),
              backgroundColor: "#455a7c",
              borderRadius: 6,
            },
          ],
        },
        options: {
          ...baseOptions,
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { precision: 0 } },
          },
        },
      });
    }

    if (fillRateChartCanvasRef.current) {
      fillRateChartRef.current = new Chart(fillRateChartCanvasRef.current, {
        type: "line",
        data: {
          labels: monthLabels.length ? monthLabels : ["Jan", "Feb", "Mar"],
          datasets: [
            {
              data: (fillRateByMonth.length ? fillRateByMonth.map((row) => safeNumber(row.rate, 0)) : [0, 0, 0]),
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
            x: { grid: { display: false } },
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
          labels: monthLabels.length ? monthLabels : ["Jan", "Feb", "Mar"],
          datasets: [
            {
              data: (impactByMonth.length ? impactByMonth.map((row) => safeNumber(row.value, 0)) : [0, 0, 0]),
              backgroundColor: "#28a745",
              borderRadius: 6,
            },
          ],
        },
        options: {
          ...baseOptions,
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { precision: 0 } },
          },
        },
      });
    }

    return () => {
      destroyReportsCharts();
    };
  }, [activeTab, reportData]);

  async function handleMarkPresent(rowId) {
    const target = roster.find((entry) => entry.id === rowId);
    if (!selectedCheckinEventId || !target?.attendeeUserId) return;

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

      const now = new Date();
      const nowIso = now.toISOString();
      const nowLabel = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

      setRoster((prev) =>
        prev.map((entry) =>
          entry.id === rowId
            ? {
                ...entry,
                status: "checked-in",
                time: nowLabel,
                checkedInAt: nowIso,
                rowError: "",
              }
            : entry
        )
      );
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
    } finally {
      setMarkPresentByUser((prev) => {
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
      const body = {
        attendee_user_id: target.attendeeUserId,
        decision: "verified",
      };
      if (Number.isFinite(attendedMinutes)) {
        body.attended_minutes = attendedMinutes;
      }

      const response = await fetch(`/api/events/${encodeURIComponent(selectedCheckinEventId)}/verify`, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-CSRF-Token": csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
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

  function handleMarkAllPresent() {
    const nowDate = new Date();
    const now = nowDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const nowIso = nowDate.toISOString();
    setRoster((prev) =>
      prev.map((entry) =>
        entry.status === "expected" || entry.status === "late"
          ? { ...entry, status: "checked-in", time: now, checkedInAt: nowIso }
          : entry
      )
    );
  }

  async function handleVerifyAllCreditsPending() {
    if (creditsVerifyAllLoading || !selectedCreditsItem || selectedCreditsItem.type !== "credits-pending") return;
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

      setCreditDetail((prev) =>
        (Array.isArray(prev) ? prev : []).map((row) => ({
          ...row,
          verification_status: "verified",
        }))
      );
      await fetchCreditsQueue();
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
        return {
          ...applicant,
          userId,
          rsvpStatus,
          status: rsvpStatus,
          verificationStatus,
          displayName: fullName || applicant?.name || applicant?.email || "Volunteer",
          pastCredits: safeNumber(applicant?.pastCredits ?? applicant?.past_credits, 0),
        };
      }),
    [applicants]
  );

  const pendingJoinApplicants = useMemo(
    () => normalizedApplicants.filter((applicant) => applicant.rsvpStatus === "pending"),
    [normalizedApplicants]
  );

  const pendingVerifyApplicants = useMemo(
    () =>
      normalizedApplicants.filter(
        (applicant) =>
          ["accepted", "checked_in"].includes(applicant.rsvpStatus)
          && applicant.verificationStatus === "pending"
      ),
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
    ]);
  }

  function openCreateOpportunityModal() {
    setEditingOpportunityId(null);
    setShowCreateModal(true);
  }

  function openEditOpportunityModal(opportunityId) {
    if (!opportunityId) return;
    setEditingOpportunityId(String(opportunityId));
    setShowCreateModal(true);
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
      setCancelError(error?.message || (isDraftOpportunity ? "Unable to delete draft." : "Unable to cancel event."));
    } finally {
      setCancelLoading(false);
    }
  }

  async function handleApplicantAction(userId, action) {
    if (!selectedOpportunityId || !userId) return;

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
      await response.json().catch(() => ({}));

      await refreshOpportunityQueueAndDetail(selectedOpportunityId);
    } catch (_) {
      setActionError("Failed. Try again.");
    } finally {
      setActionLoadingByUser((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
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
      const url = `${window.location.origin}/events#/events/${eventRow.id}`;
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
    const pendingActionsCount = safeNumber(item?.pendingActionsCount ?? item?.pendingCount, 0);
    const queueLabel = item.tab === "opportunities"
      ? (item.opportunityName || item.label || "Opportunity")
      : item.label;

    return (
      <button
        key={`${item.tab}-${item.id}`}
        type="button"
        className={`list-group-item list-group-item-action orgp-queue-item ${isActive ? "active" : ""}`}
        onClick={() => setSelectedQueueItem(item)}
      >
        <div className="d-flex align-items-center gap-2">
          <i className={`${iconClass} orgp-item-icon ${iconColorClass} ${iconToneClass}`} aria-hidden="true"></i>
          <span className="flex-grow-1">{queueLabel}</span>
          {item.tab === "opportunities" && pendingActionsCount > 0 ? (
            <span className="badge text-bg-warning">{pendingActionsCount}</span>
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
    const pendingVerifyCount = safeNumber(
      applicantCounts?.pendingVerifyCount,
      pendingVerifyApplicants.length
    );
    const pendingActionsCount = safeNumber(
      applicantCounts?.pendingActionsCount,
      pendingJoinCount + pendingVerifyCount
    );
    const capacity =
      selectedOpportunity.capacity == null ? null : safeNumber(selectedOpportunity.capacity, null);
    const fillPct = capacity == null ? 0 : fillPercent(approvedCount, capacity);
    const isCancelledOpportunity = String(selectedOpportunity.type || "") === "opp-cancelled";
    const isDraftOpportunity = String(selectedOpportunity.type || "") === "opp-draft";
    const eventDateTimeLabel = formatEventDateTime(
      selectedOpportunity.startTime,
      selectedOpportunity.endTime,
      selectedOpportunity.timeZone
    );

    return (
      <div>
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
          <button type="button" className="btn btn-outline-secondary btn-sm">+ Invite Volunteers</button>
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
                      <button type="button" className="btn btn-link btn-sm p-0 orgp-link-btn">Profile</button>
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
                onClick={handleApproveAll}
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

        <div className="orgp-section-label">PENDING VERIFICATION ({pendingVerifyCount})</div>
        <div className="orgp-block mb-3">
          {applicantsLoading ? (
            <LoadingSpinner text="Loading applicants..." />
          ) : pendingVerifyApplicants.length ? (
            <ul className="list-group list-group-flush">
              {pendingVerifyApplicants.map((applicant) => (
                <li
                  key={`verify-${applicant.userId}`}
                  className="list-group-item px-0 d-flex justify-content-between align-items-center"
                >
                  <span>{applicant.displayName}</span>
                  <span className="small text-muted">
                    <span className="badge text-bg-warning me-2">Pending verification</span>
                    {safeNumber(applicant.pastCredits, 0)} credits prev
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-muted small">No pending verification.</div>
          )}
        </div>

        <div className="orgp-section-label">APPROVED VOLUNTEERS ({approvedApplicants.length})</div>
        <div className="orgp-block mb-3">
          {applicantsLoading ? (
            <LoadingSpinner text="Loading applicants..." />
          ) : approvedApplicants.length ? (
            <ul className="list-group list-group-flush">
              {approvedApplicants.map((applicant) => (
                <li
                  key={`approved-${applicant.userId}`}
                  className="list-group-item px-0 d-flex justify-content-between align-items-center"
                >
                  <span>{applicant.displayName}</span>
                  <span className="small text-muted">
                    <span className="badge text-bg-success me-2">
                      {applicant.verificationStatus === "verified" ? "Verified" : "Approved"}
                    </span>
                    {safeNumber(applicant.pastCredits, 0)} credits prev
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-muted small">No approved volunteers yet.</div>
          )}
        </div>

        <details className="orgp-block">
          <summary className="orgp-section-label orgp-summary">OPPORTUNITY DETAILS</summary>
          <div className="small text-muted mt-2">Pending approvals: {pendingJoinCount}</div>
          <div className="small text-muted">Pending verification: {pendingVerifyCount}</div>
          <div className="small text-muted">Pending actions: {pendingActionsCount}</div>
          <div className="small text-muted">Approved volunteers: {approvedCount}</div>
          <div className="small text-muted">Capacity: {capacity == null ? "No cap set" : capacity}</div>
        </details>
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
        return ["accepted", "checked_in"].includes(rsvpStatus) && verificationStatus !== "verified";
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
          <button
            type="button"
            className="btn orgp-btn-ink-outline btn-sm w-100"
            onClick={isCheckoutPhase ? handleVerifyAllCheckedIn : () => console.log("checkout all")}
            disabled={isCheckoutPhase && verifyAllAttendanceLoading}
          >
            {isCheckoutPhase
              ? verifyAllAttendanceLoading
                ? "Verifying..."
                : "Verify All Pending"
              : "Check Out All"}
          </button>
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
                    const disableVerify = isNoShow || rowVerifying || isAttendanceVerified || !isAcceptedRsvp;
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
      label: `${row.title || "Untitled event"} · ${formatShortDate(row.start_at)} — ${safeNumber(row.funded_credits_total, 0)} funded · deficit ${safeNumber(row.deficit_credits_total, 0)}`,
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
          <div className="orgp-section-label orgp-credits-heading-pending">PENDING RECONCILE</div>
          <div className="list-group orgp-queue-list">
            {pendingItems.length
              ? pendingItems.map((item) => renderQueueItem(item))
              : <div className="text-muted small">No pending reconciliations.</div>}
          </div>
        </div>

        <div className="mb-2">
          <div className="orgp-section-label">RECONCILED</div>
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

  function renderCreditsStatusBadge(status) {
    if (String(status || "").toLowerCase() === "verified") {
      return <span className="badge bg-success">✅ Verified</span>;
    }
    return <span className="badge bg-secondary">⏳ Pending</span>;
  }

  function renderCreditsOpportunityDetail(item) {
    const detailRows = Array.isArray(creditDetail) ? creditDetail : [];
    const pendingRows = detailRows.filter((row) => String(row?.verification_status || "").toLowerCase() !== "verified");
    const verifyDisabled =
      creditsVerifyAllLoading || !pendingRows.length || item.type !== "credits-pending";

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
              <div className="text-muted small">{safeNumber(item.volunteerCount, 0)} accepted RSVPs</div>
            </div>
          </div>
        </div>

        <div className="orgp-section-label">VOLUNTEER BREAKDOWN</div>
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
                  <th scope="col" className="orgp-roster-head">Status</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.length ? (
                  detailRows.map((row) => {
                    const fullName = `${row.firstname || ""} ${row.lastname || ""}`.trim() || "Volunteer";
                    return (
                      <tr key={`credit-row-${row.id}`}>
                        <td>{fullName}</td>
                        <td>{(safeNumber(row.attended_minutes, 0) / 60).toFixed(1)}</td>
                        <td>{safeNumber(row.credits_earned, 0)}</td>
                        <td>{renderCreditsStatusBadge(row.verification_status)}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="4" className="text-muted small">No accepted volunteers yet.</td>
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
          {creditsVerifyAllLoading ? "Verifying..." : "✓ Verify All Pending"}
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
              <div className="small text-muted">↓ improving vs last period</div>
            </div>
          </div>
          <div className="col-12 col-md-6">
            <div className="orgp-report-card position-relative">
              {loadingOverlay}
              <div className="orgp-section-label">IMPACT VALUE</div>
              <div className="orgp-report-canvas-wrap">
                <canvas id="impactChart" ref={impactChartCanvasRef} style={{ height: "180px" }}></canvas>
              </div>
              <div className="small text-muted">{`$${Math.round(totalImpact).toLocaleString()} est. value`}</div>
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
    if (activeTab === "myevents") return renderMyEventsQueuePanel();
    if (activeTab === "checkin") return renderCheckinQueue();
    if (activeTab === "credits") return renderCreditsQueue();
    if (activeTab === "reports") return renderReportsFilters();
    if (activeTab === "comms") return renderCommsQueue();
    return <Phase2Placeholder compact />;
  }

  function renderRightPanel() {
    if (activeTab === "opportunities") return renderOpportunityDetail();
    if (activeTab === "myevents") return renderMyEventsDetail();
    if (activeTab === "checkin") return renderCheckinDetail();
    if (activeTab === "credits") return renderCreditsDetail();
    if (activeTab === "reports") return renderReportsDashboard();
    if (activeTab === "comms") return renderCommsDetail();
    return <Phase2Placeholder />;
  }

  const isReportsTab = activeTab === "reports";
  const leftColumnClass = isReportsTab ? "col-12 col-md-3" : "col-12 col-md-4";
  const rightColumnClass = isReportsTab ? "col-12 col-md-9" : "col-12 col-md-8";
  const leftPanelTitle = isReportsTab ? "Filters" : activeTab === "myevents" ? "Event Queue" : "Ops Queue";
  const rightPanelTitle = isReportsTab ? "Reports Dashboard" : activeTab === "myevents" ? "Funding Detail" : "Detail Panel";
  const isDraftCancelIntent = Boolean(cancelModalTarget?.isDraft);

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
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h2 className="orgp-panel-title mb-0">{leftPanelTitle}</h2>
              <div className="d-none" data-user-id={userId} data-csrf-token={csrfToken}></div>
            </div>
            {renderLeftPanel()}
          </section>
        </div>

        <div className={rightColumnClass}>
          <section className="orgp-panel orgp-detail-panel">
            <h2 className="orgp-panel-title">{rightPanelTitle}</h2>
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
            }
          }}
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content" style={{ borderRadius: "16px" }}>
              <div className="modal-header">
                <h5 className="modal-title">
                  {isDraftCancelIntent ? "Delete draft opportunity?" : "Cancel opportunity?"}
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
                  }}
                ></button>
              </div>
              <div className="modal-body">
                {isDraftCancelIntent
                  ? "This will permanently delete this draft. It will be removed from the Draft section and cannot be undone."
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
                  }}
                  disabled={cancelLoading}
                >
                  {isDraftCancelIntent ? "Keep Draft" : "Keep Event"}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={confirmCancelOpportunity}
                  disabled={cancelLoading}
                >
                  {cancelLoading
                    ? isDraftCancelIntent
                      ? "Deleting..."
                      : "Cancelling..."
                    : isDraftCancelIntent
                      ? "Yes, Delete Draft"
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
