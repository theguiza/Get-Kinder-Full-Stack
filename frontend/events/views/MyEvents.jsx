import React, { useEffect, useMemo, useState } from "react";
import { InviteModal } from "../components/InviteModal.jsx";

const PAGE_SIZE = 20;
const TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "drafts", label: "Drafts" },
];

const STATUS_BADGE = {
  draft: "Draft",
  published: "Published",
  cancelled: "Cancelled",
  completed: "Completed",
};

export function MyEvents() {
  const [tab, setTab] = useState("upcoming");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [toast, setToast] = useState(null);
  const [inviteModal, setInviteModal] = useState({ open: false, event: null });
  const [highlightDraft, setHighlightDraft] = useState(() => {
    const id = sessionStorage.getItem("gkLastDraftId");
    const title = sessionStorage.getItem("gkLastDraftTitle");
    if (id) {
      sessionStorage.removeItem("gkLastDraftId");
      sessionStorage.removeItem("gkLastDraftTitle");
      return { id, title };
    }
    return null;
  });

  useEffect(() => {
    if (highlightDraft) {
      setTab("drafts");
    }
  }, [highlightDraft]);

  useEffect(() => {
    fetchEvents(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const sortedItems = useMemo(() => {
    if (!highlightDraft) return items;
    if (tab !== "drafts") return items;
    const draftIndex = items.findIndex((item) => item.id === highlightDraft.id);
    if (draftIndex === -1) return items;
    const copy = [...items];
    const [draft] = copy.splice(draftIndex, 1);
    return [draft, ...copy];
  }, [items, highlightDraft, tab]);

  async function fetchEvents(append) {
    setLoading(true);
    setError(null);
    const nextOffset = append ? offset : 0;
    try {
      const res = await fetch(`/api/me/events?tab=${tab}&limit=${PAGE_SIZE}&offset=${nextOffset}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to load events");
      }
      setItems((prev) => (append ? [...prev, ...(json.data || [])] : json.data || []));
      setOffset(nextOffset + (json?.paging?.count || 0));
      setHasMore((json?.paging?.count || 0) === PAGE_SIZE);
    } catch (err) {
      console.error("load my events failed:", err);
      setError(err.message || "Unable to load events");
    } finally {
      setLoading(false);
    }
  }

  async function cancelEvent(id) {
    const match = items.find((item) => item.id === id);
    if (!match) return;
    setItems((prev) => prev.filter((item) => item.id !== id));
    try {
      const res = await fetch(`/api/events/${id}/cancel`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Unable to cancel event");
      }
      setToast({ type: "success", message: "Event cancelled." });
    } catch (err) {
      console.error("cancel event failed:", err);
      setToast({ type: "error", message: err.message || "Unable to cancel event." });
      setItems((prev) => [match, ...prev]);
    }
  }

  async function completeEvent(id) {
    try {
      const res = await fetch(`/api/events/${id}/complete`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Unable to complete event");
      }
      setItems((prev) => {
        if (tab === "past") {
          return prev.map((item) => (item.id === id ? { ...item, status: "completed" } : item));
        }
        return prev.filter((item) => item.id !== id);
      });
      setToast({ type: "success", message: "Event marked completed." });
    } catch (err) {
      console.error("complete event failed:", err);
      setToast({ type: "error", message: err.message || "Unable to complete event." });
    }
  }

  async function copyLink(id) {
    try {
      const url = `${window.location.origin}/events#/events/${id}`;
      await navigator?.clipboard?.writeText(url);
      setToast({ type: "success", message: "Event link copied." });
    } catch {
      setToast({ type: "error", message: "Clipboard unavailable. Copy manually." });
    }
  }

  function renderActions(event) {
    const isDraft = event.status === "draft";
    const isCancelled = event.status === "cancelled";
    const isCompleted = event.status === "completed";
    const inFuture = event.start_at ? new Date(event.start_at) > new Date() : false;
    const ended = event.end_at ? new Date(event.end_at) <= new Date() : false;

    return (
      <div className="action-row">
        {!isDraft && !isCancelled && (
          <>
            <button type="button" className="btn secondary" onClick={() => copyLink(event.id)}>
              Copy Link
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setToast({ type: "info", message: "QR tools coming soon." })}
            >
              Show QR / Code
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setInviteModal({ open: true, event })}
            >
              Invite
            </button>
          </>
        )}
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            window.location.hash = `#/create?edit=${event.id}`;
          }}
        >
          Edit
        </button>
        {!isDraft && !isCancelled && inFuture && (
          <button type="button" className="btn tertiary" onClick={() => cancelEvent(event.id)}>
            Cancel Event
          </button>
        )}
        {!isDraft && !isCancelled && !isCompleted && ended && (
          <button type="button" className="btn primary" onClick={() => completeEvent(event.id)}>
            Mark Completed
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="my-events-page">
      {toast && (
        <div className={`toast ${toast.type}`}>
          <span>{toast.message}</span>
          {toast.actionLabel && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.onAction?.();
                setToast(null);
              }}
            >
              {toast.actionLabel}
            </button>
          )}
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <header className="page-head">
        <div>
          <p className="eyebrow">Host view</p>
          <h1>My Events</h1>
        </div>
      </header>

      <div className="tab-row" role="tablist">
        {TABS.map((chip) => (
          <button
            key={chip.key}
            role="tab"
            aria-selected={tab === chip.key}
            className={`chip${tab === chip.key ? " active" : ""}`}
            onClick={() => {
              setTab(chip.key);
              setOffset(0);
            }}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {highlightDraft && tab === "drafts" && (
      <div className="banner">
        <div>
          Draft <strong>{highlightDraft.title || "Untitled"}</strong> saved.
        </div>
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            setHighlightDraft(null);
            window.location.hash = "#/create";
          }}
        >
          Continue Editing
        </button>
      </div>
      )}

      <div className="card">
        {loading && !items.length ? (
          <div className="empty muted">Loading your events…</div>
        ) : error && !items.length ? (
          <div className="empty">
            <p className="muted">{error}</p>
            <button type="button" className="btn secondary" onClick={() => fetchEvents(false)}>
              Retry
            </button>
          </div>
        ) : !sortedItems.length ? (
          <div className="empty">
            <p className="muted">
              {tab === "drafts"
                ? "No drafts yet — save from Create to pick up later."
                : tab === "past"
                ? "No past hosted events yet."
                : "You haven’t published any upcoming events yet."}
            </p>
          </div>
        ) : (
          <>
            <div className="list">
              {sortedItems.map((event) => (
                <div className="item" key={event.id}>
                  <div className="meta">
                    <div className="title-row">
                      <p className="title">{event.title}</p>
                      <span className={`badge ${event.status}`}>{STATUS_BADGE[event.status] || event.status}</span>
                      <span className={`badge subtle ${event.visibility}`}>{event.visibility}</span>
                    </div>
                    <p className="sub">
                      {formatDate(event.start_at, event.tz)} • {event.location_text || "Location TBD"}
                    </p>
                    {event.capacity && (
                      <p className="meta-line">
                        RSVP: {event?.rsvp_counts?.accepted || 0}/{event.capacity}
                      </p>
                    )}
                  </div>
                  {renderActions(event)}
                </div>
              ))}
            </div>
            {hasMore && (
              <button
                type="button"
                className="btn secondary block"
                disabled={loading}
                onClick={() => fetchEvents(true)}
              >
                {loading ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </div>

      <style>{styles}</style>

      <InviteModal
        open={inviteModal.open}
        onClose={() => setInviteModal({ open: false, event: null })}
        eventId={inviteModal.event?.id}
        eventTitle={inviteModal.event?.title}
        onSent={(data) => {
          setInviteModal({ open: false, event: null });
          setToast({
            type: "success",
            message: `Invite sent to ${data?.invitee_name || data?.invitee_email}.`,
            actionLabel: "View in My Invites",
            onAction: () => {
              window.location.hash = "#/my-invites";
            },
          });
        }}
      />
    </section>
  );
}

function formatDate(iso, tz) {
  if (!iso) return "TBD";
  try {
    const date = new Date(iso);
    return date.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz || "UTC",
    });
  } catch {
    return "Date TBD";
  }
}

const styles = `
  .my-events-page {
    background:#fff;
    border:1px solid #e5e7eb;
    border-radius:20px;
    padding:24px;
    box-shadow:0 20px 40px rgba(15,23,42,0.08);
  }
  .page-head {
    margin-bottom:16px;
  }
  .eyebrow {
    font-size:0.85rem;
    letter-spacing:0.08em;
    color:#94a3b8;
    text-transform:uppercase;
    margin:0 0 4px;
  }
  .page-head h1 { margin:0; color:#0f172a; }
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
  .toast.info { background:#3b82f6; }
  .toast-action {
    border:1px solid rgba(255,255,255,0.5);
    border-radius:999px;
    background:transparent;
    color:inherit;
    padding:6px 14px;
    font-size:0.85rem;
    cursor:pointer;
  }
  .toast button {
    background:transparent;
    border:none;
    color:inherit;
    font-size:1.2rem;
    cursor:pointer;
  }
  .tab-row {
    display:flex;
    flex-wrap:wrap;
    gap:8px;
    margin-bottom:16px;
  }
  .chip {
    border:1px solid #d1d5db;
    border-radius:999px;
    padding:8px 18px;
    font-weight:600;
    cursor:pointer;
    background:#fff;
  }
  .chip.active {
    background:#ff5656;
    border-color:#ff5656;
    color:#fff;
  }
  .banner {
    border:1px solid #fde68a;
    background:#fffbeb;
    color:#92400e;
    padding:12px 16px;
    border-radius:12px;
    margin-bottom:16px;
    display:flex;
    justify-content:space-between;
    align-items:center;
    gap:12px;
    flex-wrap:wrap;
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
    gap:16px;
  }
  .item {
    border:1px solid #e5e7eb;
    border-radius:14px;
    padding:16px;
    background:#fff;
    display:flex;
    flex-direction:column;
    gap:12px;
  }
  .title-row {
    display:flex;
    gap:8px;
    align-items:center;
    flex-wrap:wrap;
  }
  .title { margin:0; font-weight:700; color:#111827; }
  .badge {
    border-radius:999px;
    padding:4px 10px;
    font-size:0.85rem;
    font-weight:600;
    text-transform:capitalize;
    background:#e5e7eb;
    color:#1f2937;
  }
  .badge.draft { background:#fef3c7; color:#92400e; }
  .badge.published { background:#dcfce7; color:#166534; }
  .badge.cancelled { background:#fee2e2; color:#991b1b; }
  .badge.completed { background:#dbeafe; color:#1e3a8a; }
  .badge.subtle {
    border:1px solid #d1d5db;
    background:#fff;
    color:#4b5563;
  }
  .sub {
    margin:0;
    color:#6b7280;
  }
  .meta-line {
    margin:4px 0 0;
    color:#4b5563;
    font-size:0.95rem;
  }
  .action-row {
    display:flex;
    flex-wrap:wrap;
    gap:8px;
  }
  .btn {
    border:1px solid #d1d5db;
    border-radius:999px;
    padding:8px 16px;
    font-weight:600;
    cursor:pointer;
  }
  .btn.primary {
    background:#ff5656;
    border-color:#ff5656;
    color:#fff;
  }
  .btn.secondary { background:#fff; }
  .btn.tertiary {
    background:transparent;
    border:1px dashed #d1d5db;
    color:#6b7280;
  }
  .btn.block { width:100%; margin-top:12px; }
  .empty {
    text-align:center;
    padding:24px 12px;
    color:#6b7280;
  }
`;
