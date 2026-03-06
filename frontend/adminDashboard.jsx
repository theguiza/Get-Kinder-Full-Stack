import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const NAV_ITEMS = [
  { key: "overview", label: "Overview", icon: "fa-gauge-high" },
  { key: "reporting", label: "Reporting", icon: "fa-chart-line" },
  { key: "impactCredits", label: "Impact Credits", icon: "fa-coins" },
  { key: "organizations", label: "Organizations", icon: "fa-building" },
  { key: "events", label: "Events", icon: "fa-calendar-check" },
  { key: "volunteers", label: "Volunteers", icon: "fa-users" },
  { key: "donors", label: "Donors", icon: "fa-hand-holding-heart" },
];

const CREDIT_REASON_OPTIONS = ["adjustment", "earn", "earn_shift", "donate", "redeem"];
const ADMIN_TABLE_LIMIT = 50;

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatCompact(value) {
  const num = safeNumber(value, 0);
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(num);
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US").format(safeNumber(value, 0));
}

function formatCurrencyFromCents(cents = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    safeNumber(cents, 0) / 100
  );
}

function formatDateTime(value) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString();
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function statusClass(status) {
  const normalized = normalizeStatus(status);
  if (["approved", "active", "published", "completed", "verified", "accepted"].includes(normalized)) {
    return "admin-badge admin-badge-green";
  }
  if (["pending", "draft"].includes(normalized)) return "admin-badge admin-badge-amber";
  if (["suspended", "rejected", "cancelled"].includes(normalized)) return "admin-badge admin-badge-red";
  return "admin-badge admin-badge-slate";
}

function computeTrend(currentValue, previousValue) {
  const curr = safeNumber(currentValue, 0);
  const prev = safeNumber(previousValue, 0);
  if (prev === 0 && curr === 0) return { delta: 0, pct: 0, direction: "flat" };
  if (prev === 0) return { delta: curr, pct: 100, direction: "up" };
  const delta = curr - prev;
  const pct = (delta / prev) * 100;
  return { delta, pct, direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat" };
}

function useToastQueue() {
  const [toasts, setToasts] = useState([]);

  const pushToast = useCallback((message, type = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((curr) => [...curr, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((curr) => curr.filter((toast) => toast.id !== id));
    }, 3200);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((curr) => curr.filter((toast) => toast.id !== id));
  }, []);

  return { toasts, pushToast, dismissToast };
}

function SparklineArea({ points = [], stroke = "#455a7c", fill = "rgba(69,90,124,0.18)", height = 170 }) {
  const width = 520;
  const normalized = Array.isArray(points) ? points.map((point) => safeNumber(point, 0)) : [];
  if (normalized.length < 2) {
    return <div className="small text-muted">Not enough data.</div>;
  }
  const max = Math.max(...normalized, 1);
  const min = Math.min(...normalized, 0);
  const span = Math.max(1, max - min);
  const stepX = width / Math.max(1, normalized.length - 1);
  const coords = normalized.map((value, idx) => {
    const x = idx * stepX;
    const y = height - ((value - min) / span) * (height - 18) - 9;
    return [x, y];
  });
  const linePoints = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const areaPoints = `0,${height} ${linePoints} ${width},${height}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="admin-chart-svg" role="img" aria-label="Area chart">
      <polygon points={areaPoints} fill={fill} />
      <polyline points={linePoints} fill="none" stroke={stroke} strokeWidth="3" strokeLinejoin="round" />
      {coords.map(([x, y], idx) => (
        <circle key={`pt-${idx}`} cx={x} cy={y} r="2.5" fill={stroke} />
      ))}
    </svg>
  );
}

function SimpleBarChart({ points = [], color = "#ff5656", height = 170 }) {
  const width = 520;
  const normalized = Array.isArray(points) ? points.map((point) => safeNumber(point, 0)) : [];
  if (!normalized.length) {
    return <div className="small text-muted">Not enough data.</div>;
  }
  const max = Math.max(...normalized, 1);
  const gap = 12;
  const barWidth = Math.max(8, (width - gap * (normalized.length + 1)) / normalized.length);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="admin-chart-svg" role="img" aria-label="Bar chart">
      {normalized.map((value, idx) => {
        const h = (value / max) * (height - 20);
        const x = gap + idx * (barWidth + gap);
        const y = height - h;
        return <rect key={`bar-${idx}`} x={x} y={y} width={barWidth} height={h} rx="4" fill={color} opacity="0.9" />;
      })}
    </svg>
  );
}

function DonutChart({ value = 0, total = 100, size = 180, label = "Rate" }) {
  const pct = Math.max(0, Math.min(100, total > 0 ? (safeNumber(value, 0) / total) * 100 : 0));
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);
  return (
    <div className="admin-donut-wrap">
      <svg width={size} height={size} viewBox="0 0 180 180" role="img" aria-label={`${label} chart`}>
        <circle cx="90" cy="90" r={radius} fill="none" stroke="#e6eaf0" strokeWidth="16" />
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke="#ff5656"
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 90 90)"
        />
        <text x="90" y="86" textAnchor="middle" className="admin-donut-value">
          {Math.round(pct)}%
        </text>
        <text x="90" y="106" textAnchor="middle" className="admin-donut-label">
          {label}
        </text>
      </svg>
    </div>
  );
}

function ConfirmDialog({ open, title, body, confirmLabel, onCancel, onConfirm, variant = "danger" }) {
  if (!open) return null;
  return (
    <div className="admin-confirm-backdrop">
      <div className="admin-confirm-card shadow">
        <h5 className="mb-2">{title}</h5>
        <p className="text-muted mb-3">{body}</p>
        <div className="d-flex justify-content-end gap-2">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn btn-sm ${variant === "danger" ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function buildPageItems(page, totalPages) {
  const safePage = Math.max(1, safeNumber(page, 1));
  const safeTotalPages = Math.max(0, safeNumber(totalPages, 0));
  if (safeTotalPages <= 7) {
    return Array.from({ length: safeTotalPages }, (_, idx) => idx + 1);
  }

  const pages = new Set([1, safeTotalPages, safePage - 1, safePage, safePage + 1]);
  const sorted = [...pages]
    .filter((n) => n >= 1 && n <= safeTotalPages)
    .sort((a, b) => a - b);
  const items = [];
  for (let idx = 0; idx < sorted.length; idx += 1) {
    const num = sorted[idx];
    const prev = sorted[idx - 1];
    if (idx > 0 && num - prev > 1) items.push(`ellipsis-${prev}-${num}`);
    items.push(num);
  }
  return items;
}

function Pagination({ page, totalPages, totalRows, limit, onPageChange, disabled = false }) {
  if (!totalPages || totalPages <= 1) return null;

  const safePage = Math.max(1, safeNumber(page, 1));
  const safeLimit = Math.max(1, safeNumber(limit, ADMIN_TABLE_LIMIT));
  const safeTotalRows = Math.max(0, safeNumber(totalRows, 0));
  const start = safeTotalRows > 0 ? (safePage - 1) * safeLimit + 1 : 0;
  const end = safeTotalRows > 0 ? Math.min(safePage * safeLimit, safeTotalRows) : 0;
  const pageItems = buildPageItems(safePage, totalPages);
  const onFirstPage = safePage <= 1;
  const onLastPage = safePage >= totalPages;

  const trigger = (nextPage) => {
    if (disabled || nextPage === safePage || nextPage < 1 || nextPage > totalPages) return;
    onPageChange(nextPage);
  };

  return (
    <div className="admin-pagination-wrap">
      <div className="admin-pagination-summary">
        Showing {formatInteger(start)}-{formatInteger(end)} of {formatInteger(safeTotalRows)} results
      </div>
      <div className="admin-pagination-controls">
        <button
          type="button"
          className="admin-page-btn"
          disabled={disabled || onFirstPage}
          onClick={() => trigger(1)}
        >
          «
        </button>
        <button
          type="button"
          className="admin-page-btn"
          disabled={disabled || onFirstPage}
          onClick={() => trigger(safePage - 1)}
        >
          ‹
        </button>
        {pageItems.map((item) => {
          if (typeof item === "string") {
            return (
              <span key={item} className="admin-page-ellipsis">
                ...
              </span>
            );
          }
          const isActive = item === safePage;
          return (
            <button
              type="button"
              key={`page-${item}`}
              className={`admin-page-btn ${isActive ? "is-active" : ""}`}
              disabled={disabled}
              onClick={() => trigger(item)}
            >
              {item}
            </button>
          );
        })}
        <button
          type="button"
          className="admin-page-btn"
          disabled={disabled || onLastPage}
          onClick={() => trigger(safePage + 1)}
        >
          ›
        </button>
        <button
          type="button"
          className="admin-page-btn"
          disabled={disabled || onLastPage}
          onClick={() => trigger(totalPages)}
        >
          »
        </button>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const csrfToken =
    (typeof document !== "undefined" &&
      document.querySelector('meta[name="csrf-token"]')?.getAttribute("content")) ||
    "";

  const [activeSection, setActiveSection] = useState("overview");
  const [rangeFilter, setRangeFilter] = useState("90d");
  const [orgFilter, setOrgFilter] = useState("all");

  const [statsState, setStatsState] = useState({ loading: false, error: "", data: null });
  const [monthlyState, setMonthlyState] = useState({ loading: false, error: "", items: [] });
  const [orgState, setOrgState] = useState({ loading: false, error: "", items: [] });
  const [eventState, setEventState] = useState({ loading: false, error: "", items: [] });
  const [volunteerState, setVolunteerState] = useState({ loading: false, error: "", items: [] });
  const [donorState, setDonorState] = useState({ loading: false, error: "", items: [] });
  const [transactionState, setTransactionState] = useState({ loading: false, error: "", items: [] });
  const [creditState, setCreditState] = useState({ loading: false, error: "", items: [] });
  const [creditLogState, setCreditLogState] = useState({ loading: false, error: "", items: [] });
  const [volunteerDetailState, setVolunteerDetailState] = useState({ loading: false, error: "", data: null, open: false });

  const [orgSearch, setOrgSearch] = useState("");
  const [eventSearch, setEventSearch] = useState("");
  const [volunteerSearch, setVolunteerSearch] = useState("");
  const [volunteerStatusFilter, setVolunteerStatusFilter] = useState("all");
  const [donorSearch, setDonorSearch] = useState("");

  const [orgPage, setOrgPage] = useState(1);
  const [orgTotalRows, setOrgTotalRows] = useState(0);
  const [orgTotalPages, setOrgTotalPages] = useState(0);
  const [eventPage, setEventPage] = useState(1);
  const [eventTotalRows, setEventTotalRows] = useState(0);
  const [eventTotalPages, setEventTotalPages] = useState(0);
  const [volunteerPage, setVolunteerPage] = useState(1);
  const [volunteerTotalRows, setVolunteerTotalRows] = useState(0);
  const [volunteerTotalPages, setVolunteerTotalPages] = useState(0);
  const [donorPage, setDonorPage] = useState(1);
  const [donorTotalRows, setDonorTotalRows] = useState(0);
  const [donorTotalPages, setDonorTotalPages] = useState(0);
  const [transactionPage, setTransactionPage] = useState(1);
  const [transactionTotalRows, setTransactionTotalRows] = useState(0);
  const [transactionTotalPages, setTransactionTotalPages] = useState(0);
  const [creditLogPage, setCreditLogPage] = useState(1);
  const [creditLogTotalRows, setCreditLogTotalRows] = useState(0);
  const [creditLogTotalPages, setCreditLogTotalPages] = useState(0);
  const [pendingCreditsPage, setPendingCreditsPage] = useState(1);
  const [pendingCreditsTotalRows, setPendingCreditsTotalRows] = useState(0);
  const [pendingCreditsTotalPages, setPendingCreditsTotalPages] = useState(0);

  const [eventEdit, setEventEdit] = useState(null);
  const [volunteerEdit, setVolunteerEdit] = useState(null);
  const [selectedCreditRequests, setSelectedCreditRequests] = useState({});
  const [creditForm, setCreditForm] = useState({
    org_id: "all",
    user_id: "",
    amount: "",
    reason: "adjustment",
    event_id: "",
    submitting: false,
  });

  const [confirmState, setConfirmState] = useState({
    open: false,
    title: "",
    body: "",
    confirmLabel: "Confirm",
    variant: "danger",
  });
  const confirmActionRef = useRef(null);

  const { toasts, pushToast, dismissToast } = useToastQueue();

  const requestJson = useCallback(async (url, options = {}) => {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const errorMessage =
        payload?.error || payload?.message || `Request failed (${response.status})`;
      throw new Error(errorMessage);
    }
    return payload;
  }, []);

  const mutateJson = useCallback(
    (url, method, body) =>
      requestJson(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken || "",
        },
        body: JSON.stringify(body || {}),
      }),
    [requestJson, csrfToken]
  );

  const unpackPagedResponse = useCallback((payload) => {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const pagination = payload?.pagination || {};
    return {
      data: rows,
      pagination: {
        page: safeNumber(pagination.page, 1),
        limit: safeNumber(pagination.limit, ADMIN_TABLE_LIMIT),
        totalRows: safeNumber(pagination.totalRows, 0),
        totalPages: safeNumber(pagination.totalPages, 0),
      },
    };
  }, []);

  const loadOverview = useCallback(async () => {
    setStatsState((curr) => ({ ...curr, loading: true, error: "" }));
    setCreditLogState((curr) => ({ ...curr, loading: true, error: "" }));
    try {
      const creditLogQs = new URLSearchParams({
        page: String(creditLogPage),
        limit: String(ADMIN_TABLE_LIMIT),
      });
      const [statsPayload, creditPayload] = await Promise.all([
        requestJson("/api/admin/stats"),
        requestJson(`/api/admin/credits/log?${creditLogQs.toString()}`),
      ]);
      const pagedCredits = unpackPagedResponse(creditPayload);
      setStatsState({ loading: false, error: "", data: statsPayload || null });
      setCreditLogState({
        loading: false,
        error: "",
        items: pagedCredits.data,
      });
      setCreditLogPage(pagedCredits.pagination.page);
      setCreditLogTotalRows(pagedCredits.pagination.totalRows);
      setCreditLogTotalPages(pagedCredits.pagination.totalPages);
    } catch (err) {
      setStatsState((curr) => ({ ...curr, loading: false, error: err?.message || "Unable to load overview" }));
      setCreditLogState((curr) => ({ ...curr, loading: false, error: err?.message || "Unable to load credit activity" }));
    }
  }, [creditLogPage, requestJson, unpackPagedResponse]);

  const loadReporting = useCallback(async () => {
    setMonthlyState((curr) => ({ ...curr, loading: true, error: "" }));
    try {
      const [monthlyPayload, volunteersPayload, organizationsPayload] = await Promise.all([
        requestJson("/api/admin/stats/monthly"),
        requestJson("/api/admin/volunteers?page=1&limit=100"),
        requestJson("/api/admin/organizations?page=1&limit=100"),
      ]);
      const volunteersPaged = unpackPagedResponse(volunteersPayload);
      const organizationsPaged = unpackPagedResponse(organizationsPayload);
      setMonthlyState({ loading: false, error: "", items: Array.isArray(monthlyPayload) ? monthlyPayload : [] });
      setVolunteerState({ loading: false, error: "", items: volunteersPaged.data });
      setOrgState({ loading: false, error: "", items: organizationsPaged.data });
    } catch (err) {
      setMonthlyState((curr) => ({ ...curr, loading: false, error: err?.message || "Unable to load reporting data" }));
    }
  }, [requestJson, unpackPagedResponse]);

  const loadOrganizations = useCallback(async () => {
    setOrgState((curr) => ({ ...curr, loading: true, error: "" }));
    try {
      const qs = new URLSearchParams({
        page: String(orgPage),
        limit: String(ADMIN_TABLE_LIMIT),
      });
      if (orgSearch.trim()) qs.set("search", orgSearch.trim());
      const payload = await requestJson(`/api/admin/organizations?${qs.toString()}`);
      const paged = unpackPagedResponse(payload);
      setOrgState({ loading: false, error: "", items: paged.data });
      setOrgPage(paged.pagination.page);
      setOrgTotalRows(paged.pagination.totalRows);
      setOrgTotalPages(paged.pagination.totalPages);
    } catch (err) {
      setOrgState((curr) => ({ ...curr, loading: false, error: err?.message || "Unable to load organizations" }));
    }
  }, [orgPage, orgSearch, requestJson, unpackPagedResponse]);

  const loadEvents = useCallback(async () => {
    setEventState((curr) => ({ ...curr, loading: true, error: "" }));
    try {
      const qs = new URLSearchParams({
        page: String(eventPage),
        limit: String(ADMIN_TABLE_LIMIT),
      });
      if (eventSearch.trim()) qs.set("search", eventSearch.trim());
      const payload = await requestJson(`/api/admin/events?${qs.toString()}`);
      const paged = unpackPagedResponse(payload);
      setEventState({ loading: false, error: "", items: paged.data });
      setEventPage(paged.pagination.page);
      setEventTotalRows(paged.pagination.totalRows);
      setEventTotalPages(paged.pagination.totalPages);
    } catch (err) {
      setEventState((curr) => ({ ...curr, loading: false, error: err?.message || "Unable to load events" }));
    }
  }, [eventPage, eventSearch, requestJson, unpackPagedResponse]);

  const loadVolunteers = useCallback(async () => {
    setVolunteerState((curr) => ({ ...curr, loading: true, error: "" }));
    try {
      const qs = new URLSearchParams({
        page: String(volunteerPage),
        limit: String(ADMIN_TABLE_LIMIT),
      });
      if (volunteerSearch.trim()) qs.set("search", volunteerSearch.trim());
      if (volunteerStatusFilter === "active") qs.set("suspended", "false");
      if (volunteerStatusFilter === "suspended") qs.set("suspended", "true");
      const payload = await requestJson(`/api/admin/volunteers?${qs.toString()}`);
      const paged = unpackPagedResponse(payload);
      setVolunteerState({ loading: false, error: "", items: paged.data });
      setVolunteerPage(paged.pagination.page);
      setVolunteerTotalRows(paged.pagination.totalRows);
      setVolunteerTotalPages(paged.pagination.totalPages);
    } catch (err) {
      setVolunteerState((curr) => ({ ...curr, loading: false, error: err?.message || "Unable to load volunteers" }));
    }
  }, [volunteerPage, volunteerSearch, volunteerStatusFilter, requestJson, unpackPagedResponse]);

  const loadDonors = useCallback(async () => {
    setDonorState((curr) => ({ ...curr, loading: true, error: "" }));
    try {
      const qs = new URLSearchParams({
        page: String(donorPage),
        limit: String(ADMIN_TABLE_LIMIT),
      });
      if (donorSearch.trim()) qs.set("search", donorSearch.trim());
      const donorPayload = await requestJson(`/api/admin/donors?${qs.toString()}`);
      const paged = unpackPagedResponse(donorPayload);
      setDonorState({ loading: false, error: "", items: paged.data });
      setDonorPage(paged.pagination.page);
      setDonorTotalRows(paged.pagination.totalRows);
      setDonorTotalPages(paged.pagination.totalPages);
    } catch (err) {
      setDonorState((curr) => ({ ...curr, loading: false, error: err?.message || "Unable to load donors" }));
    }
  }, [donorPage, donorSearch, requestJson, unpackPagedResponse]);

  const loadTransactions = useCallback(async () => {
    setTransactionState((curr) => ({ ...curr, loading: true, error: "" }));
    try {
      const qs = new URLSearchParams({
        page: String(transactionPage),
        limit: String(ADMIN_TABLE_LIMIT),
      });
      const txPayload = await requestJson(`/api/admin/transactions?${qs.toString()}`);
      const paged = unpackPagedResponse(txPayload);
      setTransactionState({ loading: false, error: "", items: paged.data });
      setTransactionPage(paged.pagination.page);
      setTransactionTotalRows(paged.pagination.totalRows);
      setTransactionTotalPages(paged.pagination.totalPages);
    } catch (err) {
      setTransactionState((curr) => ({ ...curr, loading: false, error: err?.message || "Unable to load transactions" }));
    }
  }, [transactionPage, requestJson, unpackPagedResponse]);

  const loadCredits = useCallback(async () => {
    setCreditState((curr) => ({ ...curr, loading: true, error: "" }));
    try {
      const pendingQs = new URLSearchParams({
        page: String(pendingCreditsPage),
        limit: String(ADMIN_TABLE_LIMIT),
      });
      const [creditsPayload, volunteersPayload, organizationsPayload] = await Promise.all([
        requestJson(`/api/admin/credits/pending?${pendingQs.toString()}`),
        requestJson("/api/admin/volunteers?page=1&limit=100"),
        requestJson("/api/admin/organizations?page=1&limit=100"),
      ]);
      const creditsPaged = unpackPagedResponse(creditsPayload);
      const volunteersPaged = unpackPagedResponse(volunteersPayload);
      const organizationsPaged = unpackPagedResponse(organizationsPayload);
      setCreditState({ loading: false, error: "", items: creditsPaged.data });
      setPendingCreditsPage(creditsPaged.pagination.page);
      setPendingCreditsTotalRows(creditsPaged.pagination.totalRows);
      setPendingCreditsTotalPages(creditsPaged.pagination.totalPages);
      setVolunteerState({ loading: false, error: "", items: volunteersPaged.data });
      setOrgState({ loading: false, error: "", items: organizationsPaged.data });
    } catch (err) {
      setCreditState((curr) => ({ ...curr, loading: false, error: err?.message || "Unable to load credits" }));
    }
  }, [pendingCreditsPage, requestJson, unpackPagedResponse]);

  useEffect(() => {
    const validIds = new Set(creditState.items.map((row) => Number(row.id)));
    setSelectedCreditRequests((curr) => {
      const next = {};
      let changed = false;
      Object.keys(curr).forEach((rawId) => {
        const id = Number(rawId);
        if (validIds.has(id) && curr[rawId]) {
          next[rawId] = true;
        } else if (curr[rawId]) {
          changed = true;
        }
      });
      return changed ? next : curr;
    });
  }, [creditState.items]);

  useEffect(() => {
    if (activeSection === "overview") loadOverview();
  }, [activeSection, loadOverview]);

  useEffect(() => {
    if (activeSection === "reporting") loadReporting();
  }, [activeSection, loadReporting]);

  useEffect(() => {
    if (activeSection === "impactCredits") loadCredits();
  }, [activeSection, loadCredits]);

  useEffect(() => {
    if (activeSection === "organizations") loadOrganizations();
  }, [activeSection, loadOrganizations]);

  useEffect(() => {
    if (activeSection === "events") loadEvents();
  }, [activeSection, loadEvents]);

  useEffect(() => {
    if (activeSection === "volunteers") loadVolunteers();
  }, [activeSection, loadVolunteers]);

  useEffect(() => {
    if (activeSection === "donors") {
      loadDonors();
      loadTransactions();
    }
  }, [activeSection, loadDonors, loadTransactions]);

  const handleSectionChange = useCallback((sectionKey) => {
    setActiveSection(sectionKey);
    setOrgPage(1);
    setEventPage(1);
    setVolunteerPage(1);
    setDonorPage(1);
    setTransactionPage(1);
    setCreditLogPage(1);
    setPendingCreditsPage(1);
  }, []);

  const openConfirm = useCallback((config, action) => {
    confirmActionRef.current = action;
    setConfirmState({
      open: true,
      title: config.title || "Confirm action",
      body: config.body || "Are you sure?",
      confirmLabel: config.confirmLabel || "Confirm",
      variant: config.variant || "danger",
    });
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirmState((curr) => ({ ...curr, open: false }));
    confirmActionRef.current = null;
  }, []);

  const runConfirm = useCallback(async () => {
    const action = confirmActionRef.current;
    closeConfirm();
    if (!action) return;
    try {
      await action();
    } catch (err) {
      pushToast(err?.message || "Action failed", "error");
    }
  }, [closeConfirm, pushToast]);

  const monthlyPoints = useMemo(() => {
    if (!Array.isArray(monthlyState.items)) return [];
    const all = monthlyState.items;
    if (rangeFilter === "30d") return all.slice(-2);
    if (rangeFilter === "90d") return all.slice(-4);
    return all;
  }, [monthlyState.items, rangeFilter]);

  const reportingSeries = useMemo(() => {
    const points = monthlyPoints.map((row) => ({
      month: row.month,
      events: safeNumber(row.events, 0),
      volunteers: safeNumber(row.volunteers, 0),
      donations: safeNumber(row.donations, 0),
      credits: safeNumber(row.credits, 0),
    }));
    const hoursTrend = points.map((point) => point.volunteers * 2);
    const fillRateTrend = points.map((point) => {
      if (point.events <= 0) return 0;
      const estimateCapacity = point.events * 12;
      return Math.round((point.volunteers / estimateCapacity) * 100);
    });
    const noShowRate = Math.max(0, Math.min(40, 100 - Math.round((fillRateTrend.at(-1) || 0) * 0.8)));
    return {
      points,
      hoursTrend,
      fillRateTrend,
      noShowRate,
      creditsTrend: points.map((point) => point.credits),
      volunteerTrend: points.map((point) => point.volunteers),
      donationTrend: points.map((point) => point.donations),
    };
  }, [monthlyPoints]);

  const heroTrends = useMemo(() => {
    const p = reportingSeries.points;
    const last = p[p.length - 1] || { volunteers: 0, donations: 0, credits: 0 };
    const prev = p[p.length - 2] || { volunteers: 0, donations: 0, credits: 0 };
    return {
      volunteers: computeTrend(last.volunteers, prev.volunteers),
      donations: computeTrend(last.donations, prev.donations),
      credits: computeTrend(last.credits, prev.credits),
      hours: computeTrend((last.volunteers || 0) * 2, (prev.volunteers || 0) * 2),
    };
  }, [reportingSeries.points]);

  const topVolunteers = useMemo(
    () =>
      [...volunteerState.items]
        .sort((a, b) => safeNumber(b.total_credits, 0) - safeNumber(a.total_credits, 0))
        .slice(0, 5),
    [volunteerState.items]
  );

  const runOrgApprove = useCallback(
    async (orgId) => {
      await mutateJson(`/api/admin/organizations/${orgId}/status`, "PATCH", { status: "approved" });
      pushToast("Organization approved.", "success");
      loadOrganizations();
    },
    [loadOrganizations, mutateJson, pushToast]
  );

  const runOrgRemove = useCallback(
    (org) =>
      openConfirm(
        {
          title: `Remove ${org.name}?`,
          body: "This removes the organization record and unlinks its representative.",
          confirmLabel: "Remove organization",
        },
        async () => {
          await mutateJson(`/api/admin/organizations/${org.id}`, "DELETE");
          pushToast("Organization removed.", "success");
          loadOrganizations();
        }
      ),
    [loadOrganizations, mutateJson, openConfirm, pushToast]
  );

  const runEventRemove = useCallback(
    (event) =>
      openConfirm(
        {
          title: `Remove event "${event.title}"?`,
          body: "This permanently deletes the event and all RSVP records.",
          confirmLabel: "Remove event",
        },
        async () => {
          await mutateJson(`/api/admin/events/${event.id}`, "DELETE");
          pushToast("Event removed.", "success");
          loadEvents();
        }
      ),
    [loadEvents, mutateJson, openConfirm, pushToast]
  );

  const runVolunteerSuspendToggle = useCallback(
    (volunteer, suspended) =>
      openConfirm(
        {
          title: `${suspended ? "Suspend" : "Reactivate"} ${volunteer.firstname || "volunteer"}?`,
          body: suspended
            ? `Suspend ${volunteer.firstname || "this volunteer"}? They will be logged out immediately and blocked from accessing the platform until reactivated.`
            : "Reactivate this volunteer account?",
          confirmLabel: suspended ? "Suspend user" : "Reactivate user",
        },
        async () => {
          await mutateJson(`/api/admin/volunteers/${volunteer.id}/suspend`, "PATCH", { suspended });
          pushToast(suspended ? "Volunteer suspended." : "Volunteer reactivated.", "success");
          loadVolunteers();
        }
      ),
    [loadVolunteers, mutateJson, openConfirm, pushToast]
  );

  const openVolunteerProfile = useCallback(
    async (volunteerId) => {
      setVolunteerDetailState({ loading: true, error: "", data: null, open: true });
      try {
        const payload = await requestJson(`/api/admin/volunteers/${volunteerId}`);
        setVolunteerDetailState({ loading: false, error: "", data: payload, open: true });
      } catch (err) {
        setVolunteerDetailState({ loading: false, error: err?.message || "Unable to load profile", data: null, open: true });
      }
    },
    [requestJson]
  );

  const saveEventEdits = useCallback(async () => {
    if (!eventEdit?.id) return;
    const payload = {
      title: eventEdit.title,
      description: eventEdit.description,
      start_at: eventEdit.start_at,
      end_at: eventEdit.end_at,
      capacity: safeNumber(eventEdit.capacity, 0),
      status: eventEdit.status,
      visibility: eventEdit.visibility,
    };
    await mutateJson(`/api/admin/events/${eventEdit.id}`, "PATCH", payload);
    pushToast("Event updated.", "success");
    setEventEdit(null);
    loadEvents();
  }, [eventEdit, loadEvents, mutateJson, pushToast]);

  const saveVolunteerEdits = useCallback(async () => {
    if (!volunteerEdit?.id) return;
    await mutateJson(`/api/admin/volunteers/${volunteerEdit.id}`, "PATCH", {
      firstname: volunteerEdit.firstname,
      lastname: volunteerEdit.lastname,
      email: volunteerEdit.email,
      phone: volunteerEdit.phone,
      city: volunteerEdit.city,
    });
    pushToast("Volunteer profile updated.", "success");
    setVolunteerEdit(null);
    loadVolunteers();
  }, [loadVolunteers, mutateJson, pushToast, volunteerEdit]);

  const submitManualCredit = useCallback(async () => {
    if (!creditForm.user_id || !creditForm.amount || creditForm.submitting) {
      pushToast("Select a user and enter an amount.", "error");
      return;
    }
    const payload = {
      user_id: Number(creditForm.user_id),
      amount: Number(creditForm.amount),
      reason: creditForm.reason,
      ...(creditForm.event_id ? { event_id: creditForm.event_id } : {}),
    };
    setCreditForm((curr) => ({ ...curr, submitting: true }));
    try {
      await mutateJson("/api/admin/credits/allocate", "POST", payload);
      pushToast("Credits allocated successfully.", "success");
      setCreditForm((curr) => ({ ...curr, amount: "", event_id: "", submitting: false }));
      loadCredits();
    } catch (err) {
      pushToast(err?.message || "Credit allocation failed.", "error");
      setCreditForm((curr) => ({ ...curr, submitting: false }));
    }
  }, [creditForm, loadCredits, mutateJson, pushToast]);

  const selectedPendingRequestIds = useMemo(
    () => Object.keys(selectedCreditRequests).filter((id) => selectedCreditRequests[id]).map((id) => Number(id)),
    [selectedCreditRequests]
  );

  const togglePendingRequestSelection = useCallback((requestId, checked) => {
    setSelectedCreditRequests((curr) => {
      const next = { ...curr };
      if (checked) {
        next[String(requestId)] = true;
      } else {
        delete next[String(requestId)];
      }
      return next;
    });
  }, []);

  const runApprovePendingCredit = useCallback(
    async (requestId) => {
      await mutateJson("/api/admin/credits/approve", "POST", { request_id: requestId });
      pushToast("Pending credit approved.", "success");
      setSelectedCreditRequests((curr) => {
        const next = { ...curr };
        delete next[String(requestId)];
        return next;
      });
      loadCredits();
      loadOverview();
    },
    [loadCredits, loadOverview, mutateJson, pushToast]
  );

  const runRejectPendingCredit = useCallback(
    (row) =>
      openConfirm(
        {
          title: `Reject credit request #${row.id}?`,
          body: "This request will be marked rejected and no credits will be awarded.",
          confirmLabel: "Reject request",
        },
        async () => {
          await mutateJson("/api/admin/credits/reject", "POST", { request_id: row.id });
          pushToast("Pending credit rejected.", "info");
          setSelectedCreditRequests((curr) => {
            const next = { ...curr };
            delete next[String(row.id)];
            return next;
          });
          loadCredits();
        }
      ),
    [loadCredits, mutateJson, openConfirm, pushToast]
  );

  const runBulkApprovePendingCredits = useCallback(() => {
    if (!selectedPendingRequestIds.length) {
      pushToast("Select at least one pending request.", "error");
      return;
    }
    openConfirm(
      {
        title: `Approve ${selectedPendingRequestIds.length} credit requests?`,
        body: "This will award impact credits for all selected pending requests.",
        confirmLabel: "Approve selected",
        variant: "primary",
      },
      async () => {
        const payload = await mutateJson("/api/admin/credits/approve-bulk", "POST", {
          request_ids: selectedPendingRequestIds,
        });
        const approvedCount = Number(payload?.approved_count) || 0;
        const failedCount = Number(payload?.failed_count) || 0;
        if (failedCount > 0) {
          pushToast(`Approved ${approvedCount}, failed ${failedCount}.`, "info");
        } else {
          pushToast(`Approved ${approvedCount} pending requests.`, "success");
        }
        setSelectedCreditRequests({});
        loadCredits();
        loadOverview();
      }
    );
  }, [loadCredits, loadOverview, mutateJson, openConfirm, pushToast, selectedPendingRequestIds]);

  const selectedOrgUsers = useMemo(() => {
    const selectedOrgId = parseInt(creditForm.org_id, 10);
    if (!Number.isInteger(selectedOrgId)) return volunteerState.items;
    const hasOrgKey = volunteerState.items.some((user) => user && Object.prototype.hasOwnProperty.call(user, "org_id"));
    if (!hasOrgKey) return volunteerState.items;
    return volunteerState.items.filter((user) => safeNumber(user.org_id, -1) === selectedOrgId);
  }, [creditForm.org_id, volunteerState.items]);

  const stats = statsState.data || {};

  return (
    <div className="admin-dashboard-shell container-fluid px-0">
      <div className="row g-0 min-vh-100">
        <aside className="col-12 col-lg-2 admin-sidebar p-3 p-lg-4">
          <h2 className="admin-sidebar-brand mb-3">Admin</h2>
          <ul className="nav flex-column">
            {NAV_ITEMS.map((item) => (
              <li key={item.key} className="nav-item mb-1">
                <button
                  type="button"
                  className={`admin-nav-btn ${activeSection === item.key ? "is-active" : ""}`}
                  onClick={() => handleSectionChange(item.key)}
                >
                  <i className={`fa-solid ${item.icon}`} /> <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="col-12 col-lg-10 admin-main p-3 p-lg-4">
          {activeSection === "overview" && (
            <section>
              <h1 className="admin-title mb-3">Platform Overview</h1>
              <div className="row g-3 mb-3">
                {[
                  { label: "Total Orgs", value: stats.total_organizations, accent: "#455a7c" },
                  { label: "Active Volunteers", value: stats.active_volunteers, accent: "#ff5656" },
                  { label: "Events This Month", value: stats.total_events, accent: "#3f8f63" },
                  { label: "Pending Credits", value: stats.total_wallet_credits, accent: "#d89a2b" },
                  { label: "Suspended Users", value: stats.suspended_users, accent: "#cc2f2f" },
                ].map((card) => (
                  <div key={card.label} className="col-12 col-md-6 col-xl-4">
                    <div className="admin-card admin-stat-card" style={{ borderLeftColor: card.accent }}>
                      <div className="text-muted small">{card.label}</div>
                      <div className="admin-stat-value">{statsState.loading ? "…" : formatInteger(card.value)}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="admin-card mb-3">
                <h5 className="mb-2">Action Alerts</h5>
                <div className="d-flex flex-wrap gap-2">
                  <span className="admin-chip admin-chip-amber">
                    Pending org applications: {statsState.loading ? "…" : formatInteger(stats.pending_org_applications)}
                  </span>
                  <span className="admin-chip admin-chip-red">
                    Flagged items: {statsState.loading ? "…" : formatInteger(stats.suspended_users)}
                  </span>
                </div>
              </div>

              <div className="admin-card">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <h5 className="mb-0">Recent Credit Activity</h5>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={loadOverview}>
                    Refresh
                  </button>
                </div>
                {creditLogState.loading ? <div className="text-muted">Loading…</div> : null}
                {creditLogState.error ? <div className="text-danger small">{creditLogState.error}</div> : null}
                <div
                  className="table-responsive"
                  style={{ opacity: creditLogState.loading ? 0.5 : 1, transition: "opacity 140ms ease" }}
                >
                  <table className="table table-hover admin-table mb-0">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Direction</th>
                        <th>Amount</th>
                        <th>Reason</th>
                        <th>Event</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditLogState.items.map((row) => (
                        <tr key={row.id}>
                          <td>{`${row.firstname || ""} ${row.lastname || ""}`.trim() || row.email || "—"}</td>
                          <td><span className={statusClass(row.direction === "credit" ? "active" : "suspended")}>{row.direction}</span></td>
                          <td>{formatInteger(row.kind_amount)}</td>
                          <td>{row.reason || "—"}</td>
                          <td>{row.event_title || row.event_id || "—"}</td>
                          <td>{formatDateTime(row.created_at)}</td>
                        </tr>
                      ))}
                      {!creditLogState.loading && !creditLogState.items.length ? (
                        <tr><td colSpan="6" className="text-muted">No credit activity yet.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={creditLogPage}
                  totalPages={creditLogTotalPages}
                  totalRows={creditLogTotalRows}
                  limit={ADMIN_TABLE_LIMIT}
                  onPageChange={setCreditLogPage}
                  disabled={creditLogState.loading}
                />
              </div>
            </section>
          )}

          {activeSection === "reporting" && (
            <section>
              <h1 className="admin-title mb-3">Reporting</h1>
              {monthlyState.loading ? <div className="text-muted mb-2">Loading reporting data…</div> : null}
              {monthlyState.error ? <div className="text-danger small mb-2">{monthlyState.error}</div> : null}

              <div className="row g-3 mb-3">
                <div className="col-12 col-md-4 col-xl-2">
                  <select className="form-select form-select-sm" value={rangeFilter} onChange={(e) => setRangeFilter(e.target.value)}>
                    <option value="30d">Last 30 days</option>
                    <option value="90d">Last 90 days</option>
                    <option value="all">All time</option>
                  </select>
                </div>
                <div className="col-12 col-md-4 col-xl-3">
                  <select className="form-select form-select-sm" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
                    <option value="all">All organizations</option>
                    {orgState.items.map((org) => (
                      <option key={org.id} value={String(org.id)}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="row g-3 mb-3">
                {[
                  { label: "Volunteer Hours", value: stats.total_hours_volunteered, trend: heroTrends.hours, format: formatCompact },
                  { label: "Impact Credits Awarded", value: stats.total_wallet_credits, trend: heroTrends.credits, format: formatCompact },
                  { label: "Active Volunteers", value: stats.active_volunteers, trend: heroTrends.volunteers, format: formatCompact },
                  { label: "Total Donations", value: stats.total_donations_cents, trend: heroTrends.donations, format: formatCurrencyFromCents },
                ].map((hero) => (
                  <div key={hero.label} className="col-12 col-md-6 col-xl-3">
                    <div className="admin-card admin-hero-card">
                      <div className="small text-muted">{hero.label}</div>
                      <div className="admin-hero-value">{hero.format(hero.value)}</div>
                      <div className={`admin-trend ${hero.trend.direction}`}>
                        {hero.trend.direction === "up" ? "▲" : hero.trend.direction === "down" ? "▼" : "•"}{" "}
                        {Math.abs(hero.trend.pct).toFixed(1)}% MoM
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="row g-3 mb-3">
                <div className="col-12 col-xl-6">
                  <div className="admin-card"><h6>Hours Trend</h6><SparklineArea points={reportingSeries.hoursTrend} stroke="#455a7c" fill="rgba(69,90,124,0.17)" /></div>
                </div>
                <div className="col-12 col-xl-6">
                  <div className="admin-card"><h6>Fill Rate</h6><SparklineArea points={reportingSeries.fillRateTrend} stroke="#ff5656" fill="rgba(255,86,86,0.16)" /></div>
                </div>
                <div className="col-12 col-md-6 col-xl-4">
                  <div className="admin-card"><h6>No-show Rate</h6><DonutChart value={reportingSeries.noShowRate} total={100} label="No-show" /></div>
                </div>
                <div className="col-12 col-md-6 col-xl-4">
                  <div className="admin-card"><h6>Credits Awarded</h6><SimpleBarChart points={reportingSeries.creditsTrend} color="#3f8f63" /></div>
                </div>
                <div className="col-12 col-md-6 col-xl-4">
                  <div className="admin-card"><h6>Volunteer Growth</h6><SparklineArea points={reportingSeries.volunteerTrend} stroke="#3f8f63" fill="rgba(63,143,99,0.15)" /></div>
                </div>
                <div className="col-12">
                  <div className="admin-card"><h6>Donation Trend</h6><SimpleBarChart points={reportingSeries.donationTrend} color="#455a7c" /></div>
                </div>
              </div>

              <div className="row g-3">
                <div className="col-12 col-xl-4">
                  <div className="admin-card h-100">
                    <h6>Top Volunteers Leaderboard</h6>
                    <ol className="mb-0 ps-3">
                      {topVolunteers.map((volunteer) => (
                        <li key={volunteer.id} className="mb-2">
                          <div className="fw-semibold">{`${volunteer.firstname || ""} ${volunteer.lastname || ""}`.trim() || volunteer.email}</div>
                          <div className="small text-muted">{formatInteger(volunteer.total_credits)} credits · {formatInteger(volunteer.event_count)} events</div>
                        </li>
                      ))}
                      {!topVolunteers.length ? <li className="text-muted">No data</li> : null}
                    </ol>
                  </div>
                </div>
                <div className="col-12 col-xl-8">
                  <div className="admin-card h-100">
                    <h6>Organization Breakdown</h6>
                    <div
                      className="table-responsive"
                      style={{ opacity: creditState.loading ? 0.5 : 1, transition: "opacity 140ms ease" }}
                    >
                      <table className="table admin-table mb-0">
                        <thead>
                          <tr>
                            <th>Organization</th>
                            <th>Status</th>
                            <th>Volunteers</th>
                            <th>Fill Rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orgState.items.map((org, idx) => {
                            const volunteerCount = topVolunteers[idx] ? safeNumber(topVolunteers[idx].event_count, 0) : 0;
                            const fillPct = Math.max(8, Math.min(98, 30 + idx * 12));
                            return (
                              <tr key={org.id}>
                                <td>{org.name}</td>
                                <td><span className={statusClass(org.status)}>{org.status}</span></td>
                                <td>{volunteerCount}</td>
                                <td>
                                  <div className="admin-fill-track">
                                    <div className="admin-fill-bar" style={{ width: `${fillPct}%` }} />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                          {!orgState.items.length ? <tr><td colSpan="4" className="text-muted">No organizations.</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeSection === "impactCredits" && (
            <section>
              <h1 className="admin-title mb-3">Impact Credits</h1>
              {creditState.loading ? <div className="text-muted mb-2">Loading credits…</div> : null}
              {creditState.error ? <div className="text-danger small mb-2">{creditState.error}</div> : null}
              <div className="row g-3 mb-3">
                <div className="col-12 col-xl-7">
                  <div className="admin-card">
                    <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                      <h6 className="mb-0">Pending Credit Approval Queue</h6>
                      <div className="d-flex gap-2">
                        <button type="button" className="btn btn-sm btn-outline-success" onClick={runBulkApprovePendingCredits}>
                          Approve Selected ({selectedPendingRequestIds.length})
                        </button>
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={loadCredits}>Refresh</button>
                      </div>
                    </div>
                    <div className="table-responsive">
                      <table className="table table-hover admin-table mb-0">
                        <thead>
                          <tr>
                            <th>
                              <input
                                type="checkbox"
                                checked={creditState.items.length > 0 && selectedPendingRequestIds.length === creditState.items.length}
                                onChange={(e) => {
                                  if (!e.target.checked) {
                                    setSelectedCreditRequests({});
                                    return;
                                  }
                                  const allSelected = {};
                                  creditState.items.forEach((row) => {
                                    allSelected[String(row.id)] = true;
                                  });
                                  setSelectedCreditRequests(allSelected);
                                }}
                              />
                            </th>
                            <th>Volunteer</th>
                            <th>Event</th>
                            <th>Organization</th>
                            <th>Amount</th>
                            <th>Requested</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {creditState.items.map((row) => (
                            <tr key={row.id}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={Boolean(selectedCreditRequests[String(row.id)])}
                                  onChange={(e) => togglePendingRequestSelection(row.id, e.target.checked)}
                                />
                              </td>
                              <td>{row.volunteer_name || row.volunteer_email || "—"}</td>
                              <td>{row.event_title || row.event_id || "—"}</td>
                              <td>{row.org_name || "—"}</td>
                              <td>{formatInteger(row.amount)}</td>
                              <td>{formatDateTime(row.created_at)}</td>
                              <td>
                                <div className="btn-group btn-group-sm">
                                  <button
                                    type="button"
                                    className="btn btn-outline-success"
                                    onClick={() => runApprovePendingCredit(row.id)}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-outline-danger"
                                    onClick={() => runRejectPendingCredit(row)}
                                  >
                                    Reject
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                          {!creditState.items.length ? <tr><td colSpan="7" className="text-muted">No pending credit requests.</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                    <Pagination
                      page={pendingCreditsPage}
                      totalPages={pendingCreditsTotalPages}
                      totalRows={pendingCreditsTotalRows}
                      limit={ADMIN_TABLE_LIMIT}
                      onPageChange={setPendingCreditsPage}
                      disabled={creditState.loading}
                    />
                  </div>
                </div>
                <div className="col-12 col-xl-5">
                  <div className="admin-card">
                    <h6>Manual Credit Allocation</h6>
                    <div className="row g-2">
                      <div className="col-12">
                        <label className="form-label small">Organization</label>
                        <select
                          className="form-select form-select-sm"
                          value={creditForm.org_id}
                          onChange={(e) => setCreditForm((curr) => ({ ...curr, org_id: e.target.value, user_id: "" }))}
                        >
                          <option value="all">All organizations</option>
                          {orgState.items.map((org) => (
                            <option key={org.id} value={String(org.id)}>{org.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-12">
                        <label className="form-label small">User</label>
                        <select
                          className="form-select form-select-sm"
                          value={creditForm.user_id}
                          onChange={(e) => setCreditForm((curr) => ({ ...curr, user_id: e.target.value }))}
                        >
                          <option value="">Select user</option>
                          {selectedOrgUsers.map((user) => (
                            <option key={user.id} value={String(user.id)}>
                              {`${user.firstname || ""} ${user.lastname || ""}`.trim() || user.email}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-6">
                        <label className="form-label small">Amount</label>
                        <input
                          type="number"
                          min="1"
                          className="form-control form-control-sm"
                          value={creditForm.amount}
                          onChange={(e) => setCreditForm((curr) => ({ ...curr, amount: e.target.value }))}
                        />
                      </div>
                      <div className="col-6">
                        <label className="form-label small">Reason</label>
                        <select
                          className="form-select form-select-sm"
                          value={creditForm.reason}
                          onChange={(e) => setCreditForm((curr) => ({ ...curr, reason: e.target.value }))}
                        >
                          {CREDIT_REASON_OPTIONS.map((reason) => (
                            <option key={reason} value={reason}>{reason}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-12">
                        <label className="form-label small">Event ID (optional)</label>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={creditForm.event_id}
                          onChange={(e) => setCreditForm((curr) => ({ ...curr, event_id: e.target.value }))}
                        />
                      </div>
                      <div className="col-12">
                        <button
                          type="button"
                          className="btn btn-sm admin-btn-coral w-100"
                          disabled={creditForm.submitting}
                          onClick={submitManualCredit}
                        >
                          {creditForm.submitting ? "Allocating…" : "Allocate Credits"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeSection === "organizations" && (
            <section>
              <h1 className="admin-title mb-3">Organizations</h1>
              {orgState.loading ? <div className="text-muted mb-2">Loading organizations…</div> : null}
              {orgState.error ? <div className="text-danger small mb-2">{orgState.error}</div> : null}
              <div className="admin-card">
                <div className="d-flex flex-column flex-md-row justify-content-between gap-2 mb-2">
                  <input
                    type="search"
                    className="form-control form-control-sm admin-search"
                    placeholder="Search organizations…"
                    value={orgSearch}
                    onChange={(e) => {
                      setOrgSearch(e.target.value);
                      setOrgPage(1);
                    }}
                  />
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={loadOrganizations}>Refresh</button>
                </div>
                <div
                  className="table-responsive"
                  style={{ opacity: orgState.loading ? 0.5 : 1, transition: "opacity 140ms ease" }}
                >
                  <table className="table table-hover admin-table mb-0">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Credits</th>
                        <th>Events</th>
                        <th>Volunteers</th>
                        <th>Joined</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orgState.items.map((org) => (
                        <tr key={org.id} className={normalizeStatus(org.status) === "suspended" ? "table-danger" : ""}>
                          <td>
                            <div className="fw-semibold">{org.name}</div>
                            <div className="small text-muted">{org.rep_name || org.rep_email || "No rep"}</div>
                          </td>
                          <td><span className={statusClass(org.status)}>{org.status}</span></td>
                          <td>{formatInteger(org.credits_total || 0)}</td>
                          <td>{formatInteger(org.events_count || 0)}</td>
                          <td>{formatInteger(org.volunteers_count || 0)}</td>
                          <td>{formatDateTime(org.applied_at || org.created_at)}</td>
                          <td>
                            <div className="btn-group btn-group-sm">
                              <button type="button" className="btn btn-outline-secondary" onClick={() => pushToast(`Viewing ${org.name}`, "info")}>View</button>
                              <button
                                type="button"
                                className="btn btn-outline-primary"
                                onClick={() => {
                                  handleSectionChange("impactCredits");
                                  setCreditForm((curr) => ({ ...curr, org_id: String(org.id) }));
                                }}
                              >
                                Allocate
                              </button>
                              {normalizeStatus(org.status) !== "approved" ? (
                                <button type="button" className="btn btn-outline-success" onClick={() => runOrgApprove(org.id)}>Approve</button>
                              ) : null}
                              <button type="button" className="btn btn-outline-danger" onClick={() => runOrgRemove(org)}>Remove</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!orgState.items.length ? <tr><td colSpan="7" className="text-muted">No organizations found.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={orgPage}
                  totalPages={orgTotalPages}
                  totalRows={orgTotalRows}
                  limit={ADMIN_TABLE_LIMIT}
                  onPageChange={setOrgPage}
                  disabled={orgState.loading}
                />
              </div>
            </section>
          )}

          {activeSection === "events" && (
            <section>
              <h1 className="admin-title mb-3">Events</h1>
              {eventState.loading ? <div className="text-muted mb-2">Loading events…</div> : null}
              {eventState.error ? <div className="text-danger small mb-2">{eventState.error}</div> : null}
              <div className="admin-card">
                <div className="d-flex flex-column flex-md-row justify-content-between gap-2 mb-2">
                  <input
                    type="search"
                    className="form-control form-control-sm admin-search"
                    placeholder="Search events…"
                    value={eventSearch}
                    onChange={(e) => {
                      setEventSearch(e.target.value);
                      setEventPage(1);
                    }}
                  />
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={loadEvents}>Refresh</button>
                </div>
                <div
                  className="table-responsive"
                  style={{ opacity: eventState.loading ? 0.5 : 1, transition: "opacity 140ms ease" }}
                >
                  <table className="table table-hover admin-table mb-0">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Org/Host</th>
                        <th>Date</th>
                        <th>Volunteers</th>
                        <th>Credits</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eventState.items.map((event) => (
                        <tr key={event.id}>
                          <td>{event.title}</td>
                          <td>{event.org_name || event.host_name || "—"}</td>
                          <td>{formatDateTime(event.start_at)}</td>
                          <td>{formatInteger(event.volunteer_count)} / {formatInteger(event.capacity)}</td>
                          <td>{formatInteger(event.credits_total || 0)}</td>
                          <td><span className={statusClass(event.status)}>{event.status}</span></td>
                          <td>
                            <div className="btn-group btn-group-sm">
                              <button type="button" className="btn btn-outline-secondary" onClick={() => pushToast(`Viewing event ${event.title}`, "info")}>View</button>
                              <button
                                type="button"
                                className="btn btn-outline-primary"
                                onClick={() => setEventEdit({
                                  id: event.id,
                                  title: event.title || "",
                                  description: event.description || "",
                                  start_at: event.start_at || "",
                                  end_at: event.end_at || "",
                                  capacity: event.capacity || "",
                                  status: event.status || "draft",
                                  visibility: event.visibility || "public",
                                })}
                              >
                                Edit
                              </button>
                              <button type="button" className="btn btn-outline-danger" onClick={() => runEventRemove(event)}>Remove</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!eventState.items.length ? <tr><td colSpan="7" className="text-muted">No events found.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={eventPage}
                  totalPages={eventTotalPages}
                  totalRows={eventTotalRows}
                  limit={ADMIN_TABLE_LIMIT}
                  onPageChange={setEventPage}
                  disabled={eventState.loading}
                />
              </div>
            </section>
          )}

          {activeSection === "volunteers" && (
            <section>
              <h1 className="admin-title mb-3">Volunteers</h1>
              {volunteerState.loading ? <div className="text-muted mb-2">Loading volunteers…</div> : null}
              {volunteerState.error ? <div className="text-danger small mb-2">{volunteerState.error}</div> : null}
              <div className="admin-card">
                <div className="row g-2 mb-2">
                  <div className="col-12 col-md-7">
                    <input
                      type="search"
                      className="form-control form-control-sm admin-search"
                      placeholder="Search volunteers…"
                      value={volunteerSearch}
                      onChange={(e) => {
                        setVolunteerSearch(e.target.value);
                        setVolunteerPage(1);
                      }}
                    />
                  </div>
                  <div className="col-8 col-md-3">
                    <select
                      className="form-select form-select-sm"
                      value={volunteerStatusFilter}
                      onChange={(e) => {
                        setVolunteerStatusFilter(e.target.value);
                        setVolunteerPage(1);
                      }}
                    >
                      <option value="all">All</option>
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                  <div className="col-4 col-md-2">
                    <button type="button" className="btn btn-sm btn-outline-secondary w-100" onClick={loadVolunteers}>Refresh</button>
                  </div>
                </div>

                <div
                  className="table-responsive"
                  style={{ opacity: volunteerState.loading ? 0.5 : 1, transition: "opacity 140ms ease" }}
                >
                  <table className="table table-hover admin-table mb-0">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Credits</th>
                        <th>Events</th>
                        <th>Hours</th>
                        <th>Joined</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {volunteerState.items.map((volunteer) => (
                        <tr key={volunteer.id} className={volunteer.is_suspended ? "table-danger" : ""}>
                          <td>{`${volunteer.firstname || ""} ${volunteer.lastname || ""}`.trim() || "Unnamed"}</td>
                          <td>{volunteer.email || "—"}</td>
                          <td><span className={statusClass(volunteer.is_suspended ? "suspended" : "active")}>{volunteer.is_suspended ? "Suspended" : "Active"}</span></td>
                          <td>{formatInteger(volunteer.total_credits)}</td>
                          <td>{formatInteger(volunteer.event_count)}</td>
                          <td>{safeNumber(volunteer.total_hours, safeNumber(volunteer.event_count, 0) * 2).toFixed(1)}</td>
                          <td>{formatDateTime(volunteer.created_at)}</td>
                          <td>
                            <div className="btn-group btn-group-sm">
                              <button type="button" className="btn btn-outline-secondary" onClick={() => openVolunteerProfile(volunteer.id)}>View</button>
                              <button
                                type="button"
                                className="btn btn-outline-primary"
                                onClick={() => setVolunteerEdit({
                                  id: volunteer.id,
                                  firstname: volunteer.firstname || "",
                                  lastname: volunteer.lastname || "",
                                  email: volunteer.email || "",
                                  phone: volunteer.phone || "",
                                  city: volunteer.city || "",
                                })}
                              >
                                Edit
                              </button>
                              {volunteer.is_suspended ? (
                                <button type="button" className="btn btn-outline-success" onClick={() => runVolunteerSuspendToggle(volunteer, false)}>Reactivate</button>
                              ) : (
                                <button type="button" className="btn btn-outline-danger" onClick={() => runVolunteerSuspendToggle(volunteer, true)}>Suspend</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!volunteerState.items.length ? <tr><td colSpan="8" className="text-muted">No volunteers found.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={volunteerPage}
                  totalPages={volunteerTotalPages}
                  totalRows={volunteerTotalRows}
                  limit={ADMIN_TABLE_LIMIT}
                  onPageChange={setVolunteerPage}
                  disabled={volunteerState.loading}
                />
              </div>
            </section>
          )}

          {activeSection === "donors" && (
            <section>
              <h1 className="admin-title mb-3">Donors</h1>
              {donorState.loading || transactionState.loading ? (
                <div className="text-muted mb-2">Loading donor and transaction data…</div>
              ) : null}
              {donorState.error ? <div className="text-danger small mb-2">{donorState.error}</div> : null}
              {transactionState.error ? <div className="text-danger small mb-2">{transactionState.error}</div> : null}
              <div className="admin-card mb-3">
                <div className="d-flex flex-column flex-md-row justify-content-between gap-2 mb-2">
                  <input
                    type="search"
                    className="form-control form-control-sm admin-search"
                    placeholder="Search donors…"
                    value={donorSearch}
                    onChange={(e) => {
                      setDonorSearch(e.target.value);
                      setDonorPage(1);
                    }}
                  />
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={loadDonors}>Refresh</button>
                </div>
                <div
                  className="table-responsive"
                  style={{ opacity: donorState.loading ? 0.5 : 1, transition: "opacity 140ms ease" }}
                >
                  <table className="table table-hover admin-table mb-0">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Transactions</th>
                        <th>Total Donated</th>
                        <th>Last Donation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {donorState.items.map((donor) => (
                        <tr key={donor.user_id}>
                          <td>{`${donor.firstname || ""} ${donor.lastname || ""}`.trim() || "Unnamed"}</td>
                          <td>{donor.email}</td>
                          <td>{formatInteger(donor.transaction_count)}</td>
                          <td>{formatCurrencyFromCents(donor.total_donated_cents)}</td>
                          <td>{formatDateTime(donor.last_donation)}</td>
                        </tr>
                      ))}
                      {!donorState.items.length ? <tr><td colSpan="5" className="text-muted">No donors found.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={donorPage}
                  totalPages={donorTotalPages}
                  totalRows={donorTotalRows}
                  limit={ADMIN_TABLE_LIMIT}
                  onPageChange={setDonorPage}
                  disabled={donorState.loading}
                />
              </div>

              <div className="admin-card">
                <h6>Transaction History</h6>
                <div
                  className="table-responsive"
                  style={{ opacity: transactionState.loading ? 0.5 : 1, transition: "opacity 140ms ease" }}
                >
                  <table className="table table-hover admin-table mb-0">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Donor</th>
                        <th>Amount</th>
                        <th>Currency</th>
                        <th>Status</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactionState.items.map((tx) => (
                        <tr key={tx.id}>
                          <td>{String(tx.id).slice(0, 10)}</td>
                          <td>{`${tx.firstname || ""} ${tx.lastname || ""}`.trim() || tx.email || "—"}</td>
                          <td>{formatCurrencyFromCents(tx.amount_cents)}</td>
                          <td>{tx.currency || "—"}</td>
                          <td><span className={statusClass(tx.status)}>{tx.status || "unknown"}</span></td>
                          <td>{formatDateTime(tx.created_at)}</td>
                        </tr>
                      ))}
                      {!transactionState.items.length ? <tr><td colSpan="6" className="text-muted">No transactions found.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={transactionPage}
                  totalPages={transactionTotalPages}
                  totalRows={transactionTotalRows}
                  limit={ADMIN_TABLE_LIMIT}
                  onPageChange={setTransactionPage}
                  disabled={transactionState.loading}
                />
              </div>
            </section>
          )}
        </main>
      </div>

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        body={confirmState.body}
        confirmLabel={confirmState.confirmLabel}
        variant={confirmState.variant}
        onCancel={closeConfirm}
        onConfirm={runConfirm}
      />

      {eventEdit ? (
        <div className="admin-edit-backdrop">
          <div className="admin-edit-card">
            <h5>Edit Event</h5>
            <div className="row g-2">
              <div className="col-12"><input className="form-control form-control-sm" placeholder="Title" value={eventEdit.title} onChange={(e) => setEventEdit((curr) => ({ ...curr, title: e.target.value }))} /></div>
              <div className="col-12"><textarea className="form-control form-control-sm" rows="2" placeholder="Description" value={eventEdit.description} onChange={(e) => setEventEdit((curr) => ({ ...curr, description: e.target.value }))} /></div>
              <div className="col-md-6"><input className="form-control form-control-sm" type="datetime-local" value={eventEdit.start_at ? eventEdit.start_at.slice(0, 16) : ""} onChange={(e) => setEventEdit((curr) => ({ ...curr, start_at: e.target.value }))} /></div>
              <div className="col-md-6"><input className="form-control form-control-sm" type="datetime-local" value={eventEdit.end_at ? eventEdit.end_at.slice(0, 16) : ""} onChange={(e) => setEventEdit((curr) => ({ ...curr, end_at: e.target.value }))} /></div>
              <div className="col-md-4"><input className="form-control form-control-sm" type="number" min="1" value={eventEdit.capacity} onChange={(e) => setEventEdit((curr) => ({ ...curr, capacity: e.target.value }))} placeholder="Capacity" /></div>
              <div className="col-md-4">
                <select className="form-select form-select-sm" value={eventEdit.status} onChange={(e) => setEventEdit((curr) => ({ ...curr, status: e.target.value }))}>
                  <option value="draft">draft</option>
                  <option value="published">published</option>
                  <option value="cancelled">cancelled</option>
                  <option value="completed">completed</option>
                </select>
              </div>
              <div className="col-md-4">
                <select className="form-select form-select-sm" value={eventEdit.visibility} onChange={(e) => setEventEdit((curr) => ({ ...curr, visibility: e.target.value }))}>
                  <option value="public">public</option>
                  <option value="fof">fof</option>
                  <option value="private">private</option>
                </select>
              </div>
            </div>
            <div className="d-flex justify-content-end gap-2 mt-3">
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setEventEdit(null)}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={saveEventEdits}>Save changes</button>
            </div>
          </div>
        </div>
      ) : null}

      {volunteerEdit ? (
        <div className="admin-edit-backdrop">
          <div className="admin-edit-card">
            <h5>Edit Volunteer</h5>
            <div className="row g-2">
              <div className="col-md-6"><input className="form-control form-control-sm" value={volunteerEdit.firstname} onChange={(e) => setVolunteerEdit((curr) => ({ ...curr, firstname: e.target.value }))} placeholder="First name" /></div>
              <div className="col-md-6"><input className="form-control form-control-sm" value={volunteerEdit.lastname} onChange={(e) => setVolunteerEdit((curr) => ({ ...curr, lastname: e.target.value }))} placeholder="Last name" /></div>
              <div className="col-12"><input className="form-control form-control-sm" value={volunteerEdit.email} onChange={(e) => setVolunteerEdit((curr) => ({ ...curr, email: e.target.value }))} placeholder="Email" /></div>
              <div className="col-md-6"><input className="form-control form-control-sm" value={volunteerEdit.phone || ""} onChange={(e) => setVolunteerEdit((curr) => ({ ...curr, phone: e.target.value }))} placeholder="Phone" /></div>
              <div className="col-md-6"><input className="form-control form-control-sm" value={volunteerEdit.city || ""} onChange={(e) => setVolunteerEdit((curr) => ({ ...curr, city: e.target.value }))} placeholder="City" /></div>
            </div>
            <div className="d-flex justify-content-end gap-2 mt-3">
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setVolunteerEdit(null)}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={saveVolunteerEdits}>Save changes</button>
            </div>
          </div>
        </div>
      ) : null}

      {volunteerDetailState.open ? (
        <div className="admin-edit-backdrop">
          <div className="admin-edit-card admin-edit-card-wide">
            <div className="d-flex justify-content-between align-items-start mb-2">
              <h5 className="mb-0">Volunteer Profile</h5>
              <button type="button" className="btn-close" onClick={() => setVolunteerDetailState({ loading: false, error: "", data: null, open: false })} />
            </div>
            {volunteerDetailState.loading ? <div className="text-muted">Loading profile…</div> : null}
            {volunteerDetailState.error ? <div className="text-danger">{volunteerDetailState.error}</div> : null}
            {!volunteerDetailState.loading && volunteerDetailState.data ? (
              <>
                <div className="small mb-2">
                  <strong>User:</strong>{" "}
                  {`${volunteerDetailState.data.user?.firstname || ""} ${volunteerDetailState.data.user?.lastname || ""}`.trim()} · {volunteerDetailState.data.user?.email}
                </div>
                <div className="row g-2">
                  <div className="col-12 col-lg-6">
                    <h6>Event History</h6>
                    <div className="admin-scroll-table">
                      <table className="table table-sm admin-table mb-0">
                        <thead><tr><th>Event</th><th>Status</th><th>Minutes</th></tr></thead>
                        <tbody>
                          {(volunteerDetailState.data.event_history || []).slice(0, 20).map((row) => (
                            <tr key={row.id}>
                              <td>{row.event_title || row.event_id}</td>
                              <td>{row.status}</td>
                              <td>{safeNumber(row.attended_minutes, 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="col-12 col-lg-6">
                    <h6>Wallet Transactions</h6>
                    <div className="admin-scroll-table">
                      <table className="table table-sm admin-table mb-0">
                        <thead><tr><th>Reason</th><th>Direction</th><th>Amount</th></tr></thead>
                        <tbody>
                          {(volunteerDetailState.data.wallet_transactions || []).slice(0, 20).map((row) => (
                            <tr key={row.id}>
                              <td>{row.reason}</td>
                              <td>{row.direction}</td>
                              <td>{formatInteger(row.kind_amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="admin-toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`admin-toast admin-toast-${toast.type}`}>
            <span>{toast.message}</span>
            <button type="button" className="btn-close btn-close-white btn-sm" onClick={() => dismissToast(toast.id)} />
          </div>
        ))}
      </div>

      <style>{`
        .admin-dashboard-shell {
          --admin-coral: #ff5656;
          --admin-slate: #455a7c;
          --admin-bg: #f7f3ed;
          background: var(--admin-bg);
          color: #2f3d52;
          font-family: "DM Sans", "Inter", "Segoe UI", sans-serif;
        }
        .admin-sidebar {
          background: linear-gradient(180deg, #455a7c 0%, #31435f 100%);
          color: #fff;
        }
        .admin-sidebar-brand {
          font-size: 1.5rem;
          letter-spacing: 0.02em;
          margin: 0;
          color: #fff;
        }
        .admin-nav-btn {
          width: 100%;
          border: 0;
          background: transparent;
          color: rgba(255, 255, 255, 0.86);
          text-align: left;
          border-radius: 10px;
          padding: 0.62rem 0.75rem;
          font-size: 0.95rem;
          display: flex;
          align-items: center;
          gap: 0.55rem;
          transition: background 140ms ease, color 140ms ease;
        }
        .admin-nav-btn:hover { background: rgba(255,255,255,0.13); color: #fff; }
        .admin-nav-btn.is-active {
          background: rgba(255,255,255,0.22);
          color: #fff;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.28);
        }
        .admin-main { background: var(--admin-bg); }
        .admin-title {
          color: var(--admin-coral);
          font-weight: 700;
          margin: 0;
        }
        .admin-card {
          background: #fff;
          border-radius: 14px;
          box-shadow: 0 6px 22px rgba(56, 72, 95, 0.08);
          border: 1px solid rgba(69, 90, 124, 0.1);
          padding: 0.95rem 1rem;
        }
        .admin-stat-card {
          border-left: 5px solid var(--admin-slate);
          min-height: 95px;
        }
        .admin-stat-value {
          font-size: 1.95rem;
          color: var(--admin-slate);
          font-weight: 700;
          line-height: 1.1;
          margin-top: 0.25rem;
        }
        .admin-hero-card .admin-hero-value {
          font-size: 1.75rem;
          font-weight: 700;
          color: var(--admin-slate);
        }
        .admin-trend {
          font-size: 0.82rem;
          margin-top: 0.22rem;
          font-weight: 600;
        }
        .admin-trend.up { color: #2f9155; }
        .admin-trend.down { color: #c24141; }
        .admin-trend.flat { color: #61728d; }
        .admin-table > :not(caption) > * > * {
          border-bottom-color: #ecedf1;
          vertical-align: middle;
          font-size: 0.89rem;
        }
        .admin-table tbody tr:hover { background: rgba(69, 90, 124, 0.04); }
        .admin-chart-svg { width: 100%; height: 170px; display: block; }
        .admin-badge {
          display: inline-flex;
          align-items: center;
          padding: 0.2rem 0.52rem;
          border-radius: 999px;
          font-size: 0.73rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .admin-badge-green { background: #e8f7ee; color: #2f9155; }
        .admin-badge-amber { background: #fff4de; color: #b97710; }
        .admin-badge-red { background: #fde9e9; color: #c24141; }
        .admin-badge-slate { background: #edf1f6; color: #4b5f7f; }
        .admin-chip {
          border-radius: 999px;
          padding: 0.35rem 0.65rem;
          font-size: 0.8rem;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
        }
        .admin-chip-amber { background: #fff4de; color: #9f6709; }
        .admin-chip-red { background: #fde8e8; color: #b33636; }
        .admin-fill-track {
          width: 100%;
          height: 8px;
          border-radius: 999px;
          background: #e9ecf2;
          overflow: hidden;
        }
        .admin-fill-bar {
          height: 100%;
          background: linear-gradient(90deg, #ff5656, #ff8a63);
        }
        .admin-search { max-width: 360px; }
        .admin-pagination-wrap {
          margin-top: 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .admin-pagination-summary {
          font-size: 13px;
          color: #8892a4;
        }
        .admin-pagination-controls {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          flex-wrap: wrap;
        }
        .admin-page-btn {
          min-width: 36px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #2f3d52;
          cursor: pointer;
          transition: background 130ms ease, border-color 130ms ease, color 130ms ease;
        }
        .admin-page-btn:hover:not(:disabled):not(.is-active) {
          background: #edf2f7;
        }
        .admin-page-btn.is-active {
          background: #455a7c;
          color: #fff;
          border-color: #455a7c;
        }
        .admin-page-btn:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .admin-page-ellipsis {
          min-width: 20px;
          text-align: center;
          color: #8892a4;
          font-size: 0.9rem;
          user-select: none;
        }
        .admin-confirm-backdrop,
        .admin-edit-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(14, 22, 34, 0.54);
          z-index: 1070;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
        .admin-confirm-card,
        .admin-edit-card {
          width: min(560px, 100%);
          background: #fff;
          border-radius: 14px;
          padding: 1rem;
          border: 1px solid #e3e8f2;
        }
        .admin-edit-card-wide { width: min(980px, 100%); }
        .admin-scroll-table { max-height: 300px; overflow: auto; border: 1px solid #edf0f5; border-radius: 8px; }
        .admin-toast-stack {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 1080;
          display: grid;
          gap: 0.5rem;
        }
        .admin-toast {
          min-width: 260px;
          max-width: 360px;
          color: #fff;
          border-radius: 10px;
          padding: 0.55rem 0.7rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.6rem;
          box-shadow: 0 6px 16px rgba(24, 37, 56, 0.28);
        }
        .admin-toast-success { background: #2f9155; }
        .admin-toast-error { background: #cc3f3f; }
        .admin-toast-info { background: #455a7c; }
        .admin-btn-coral {
          background: var(--admin-coral);
          border-color: var(--admin-coral);
          color: #fff;
        }
        .admin-btn-coral:hover,
        .admin-btn-coral:focus {
          background: #f24a4a;
          border-color: #f24a4a;
          color: #fff;
        }
        .admin-donut-value {
          font-size: 1.22rem;
          fill: #455a7c;
          font-weight: 700;
        }
        .admin-donut-label {
          font-size: 0.76rem;
          fill: #60758f;
          font-weight: 600;
        }
        @media (max-width: 991.98px) {
          .admin-sidebar { min-height: auto; }
          .admin-nav-btn { padding: 0.5rem 0.62rem; font-size: 0.9rem; }
          .admin-stat-value { font-size: 1.55rem; }
          .admin-main { padding-bottom: 5rem !important; }
        }
      `}</style>
    </div>
  );
}
