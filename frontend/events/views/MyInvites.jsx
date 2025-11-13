import React, { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 20;
const STATUS_FILTERS = ["all", "pending", "accepted", "declined", "expired"];
const DATE_FILTERS = ["any", "upcoming", "past"];

const STATUS_LABEL = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

const STATUS_CLASS = {
  pending: "pending",
  accepted: "accepted",
  declined: "declined",
  expired: "expired",
};

const initialState = {
  loading: true,
  error: null,
  items: [],
  offset: 0,
  hasMore: true,
};

export function MyInvites() {
  const [listState, setListState] = useState(initialState);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("any");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);

  useEffect(() => {
    loadInvites(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const filteredInvites = useMemo(() => {
    const now = Date.now();
    return listState.items.filter((invite) => {
      if (statusFilter !== "all" && invite.status !== statusFilter) {
        return false;
      }
      if (dateFilter !== "any" && invite.event_starts_at) {
        const start = new Date(invite.event_starts_at).getTime();
        if (Number.isFinite(start)) {
          if (dateFilter === "upcoming" && start < now) return false;
          if (dateFilter === "past" && start >= now) return false;
        }
      }
      if (search.trim()) {
        const term = search.trim().toLowerCase();
        const fields = [
          invite.invitee_name,
          invite.invitee_email,
          invite.event_title,
        ]
          .filter(Boolean)
          .map((value) => value.toLowerCase());
        if (!fields.some((value) => value.includes(term))) {
          return false;
        }
      }
      return true;
    });
  }, [listState.items, statusFilter, dateFilter, search]);

  async function loadInvites(append) {
    setListState((prev) => ({ ...prev, loading: true, error: null }));
    const offset = append ? listState.offset : 0;
    try {
      const res = await fetch(`/api/invites?type=outgoing&limit=${PAGE_SIZE}&offset=${offset}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load invites");
      setListState((prev) => ({
        loading: false,
        error: null,
        items: append ? [...prev.items, ...(json?.data || [])] : json?.data || [],
        offset: offset + (json?.paging?.count || 0),
        hasMore: (json?.paging?.count || 0) === PAGE_SIZE,
      }));
    } catch (error) {
      console.error("Load my invites failed:", error);
      setListState((prev) => ({ ...prev, loading: false, error: error.message || "Unable to load invites." }));
    }
  }

  async function cancelInvite(id) {
    const target = listState.items.find((item) => item.id === id);
    if (!target) return;
    setListState((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== id),
    }));
    try {
      const res = await fetch(`/api/invites/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Unable to cancel invite");
      }
      setToast({ type: "success", message: "Invite cancelled." });
    } catch (error) {
      console.error("Cancel invite failed:", error);
      setToast({ type: "error", message: error.message || "Unable to cancel invite." });
      setListState((prev) => ({
        ...prev,
        items: [target, ...prev.items],
      }));
    }
  }

  async function copyLink(eventId) {
    try {
      const base = window.location.origin;
      const url = `${base}/events#/events/${eventId}`;
      await navigator?.clipboard?.writeText(url);
      setToast({ type: "success", message: "Invite link copied." });
    } catch {
      setToast({ type: "error", message: "Clipboard unavailable. Copy manually." });
    }
  }

  return (
    <section className="my-invites-page">
      {toast && (
        <div className={`toast ${toast.type}`} role="status" aria-live="polite">
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <header className="page-head">
        <div>
          <p className="eyebrow">Host tools</p>
          <h1>My Invites</h1>
        </div>
      </header>

      <div className="filters">
        <div className="pill-row">
          <span className="filter-label">Status</span>
          {STATUS_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              className={`pill${statusFilter === value ? " active" : ""}`}
              onClick={() => setStatusFilter(value)}
            >
              {value === "all" ? "All" : STATUS_LABEL[value]}
            </button>
          ))}
        </div>
        <div className="pill-row">
          <span className="filter-label">Date</span>
          {DATE_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              className={`pill${dateFilter === value ? " active" : ""}`}
              onClick={() => setDateFilter(value)}
            >
              {value === "any" ? "Any" : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <div className="search-row">
          <input
            type="search"
            placeholder="Search invitees or events"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        {listState.loading && !listState.items.length ? (
          <div className="empty muted">Loading invites…</div>
        ) : listState.error && !listState.items.length ? (
          <div className="empty">
            <p className="muted">{listState.error}</p>
            <button type="button" className="btn secondary" onClick={() => loadInvites(false)}>
              Retry
            </button>
          </div>
        ) : filteredInvites.length === 0 ? (
          <div className="empty">
            <p className="muted">You haven’t sent any invites yet.</p>
          </div>
        ) : (
          <>
            <div className="list">
              {filteredInvites.map((invite) => (
                <div className="item" key={invite.id}>
                  <div className="meta">
                    <p className="title">
                      {invite.invitee_name || "Invitee"} — {invite.event_title}
                    </p>
                    <p className="sub">
                      {invite.event_time_label || formatTimeLabel(invite.event_starts_at) || "Date TBA"}
                    </p>
                  </div>
                  <div className="actions">
                    {invite.status === "pending" && (
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => cancelInvite(invite.id)}
                      >
                        Cancel
                      </button>
                    )}
                    <button type="button" className="btn secondary" onClick={() => copyLink(invite.event_id)}>
                      Copy Link
                    </button>
                    <span className={`badge ${STATUS_CLASS[invite.status] || "pending"}`}>
                      {STATUS_LABEL[invite.status] || invite.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {listState.hasMore && (
              <button
                type="button"
                className="btn secondary block"
                disabled={listState.loading}
                onClick={() => loadInvites(true)}
              >
                {listState.loading ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </div>

      <style>{styles}</style>
    </section>
  );
}

function formatTimeLabel(isoString) {
  if (!isoString) return null;
  try {
    const date = new Date(isoString);
    return date.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

const styles = `
  .my-invites-page {
    background:#fff;
    border:1px solid #e5e7eb;
    border-radius:20px;
    padding:24px;
    box-shadow:0 20px 40px rgba(15,23,42,0.08);
  }
  .page-head {
    margin-bottom:20px;
  }
  .eyebrow {
    font-size:0.85rem;
    text-transform:uppercase;
    letter-spacing:0.08em;
    color:#94a3b8;
    margin:0 0 4px;
  }
  .page-head h1 {
    margin:0;
    color:#0f172a;
  }
  .toast {
    display:flex;
    justify-content:space-between;
    align-items:center;
    border-radius:12px;
    padding:12px 16px;
    color:#fff;
    margin-bottom:16px;
  }
  .toast.success { background:#16a34a; }
  .toast.error { background:#ef4444; }
  .toast button {
    background:transparent;
    border:none;
    color:inherit;
    font-size:1.2rem;
    cursor:pointer;
  }
  .filters {
    display:flex;
    flex-direction:column;
    gap:12px;
    margin-bottom:16px;
  }
  .pill-row {
    display:flex;
    flex-wrap:wrap;
    gap:10px;
    align-items:center;
  }
  .filter-label {
    font-weight:600;
    color:#111827;
  }
  .pill {
    border:1px solid #d1d5db;
    border-radius:999px;
    padding:6px 14px;
    font-weight:600;
    background:#fff;
    cursor:pointer;
  }
  .pill.active {
    background:#ff5656;
    border-color:#ff5656;
    color:#fff;
  }
  .search-row input {
    width:100%;
    border:1px solid #d1d5db;
    border-radius:12px;
    padding:10px 14px;
    font-size:1rem;
  }
  .card {
    border:1px solid #e2e8f0;
    border-radius:16px;
    padding:16px;
    background:#fff;
  }
  .list {
    display:flex;
    flex-direction:column;
    gap:12px;
  }
  .item {
    border:1px solid #e5e7eb;
    border-radius:14px;
    padding:12px 16px;
    display:flex;
    justify-content:space-between;
    align-items:center;
    gap:16px;
  }
  .meta {
    flex:1;
  }
  .title {
    margin:0 0 4px;
    font-weight:600;
    color:#111827;
  }
  .sub {
    margin:0;
    color:#6b7280;
    font-size:0.95rem;
  }
  .actions {
    display:flex;
    gap:8px;
    align-items:center;
  }
  .btn {
    border:1px solid #d1d5db;
    border-radius:999px;
    padding:8px 16px;
    font-weight:600;
    cursor:pointer;
  }
  .btn.secondary { background:#fff; }
  .btn.block { width:100%; margin-top:12px; }
  .badge {
    border-radius:999px;
    padding:6px 14px;
    font-weight:600;
  }
  .badge.pending { background:#fef3c7; color:#92400e; }
  .badge.accepted { background:#dcfce7; color:#166534; }
  .badge.declined { background:#fee2e2; color:#991b1b; }
  .badge.expired { background:#e2e8f0; color:#475569; }
  .empty {
    text-align:center;
    padding:24px 12px;
    color:#6b7280;
  }
`;
