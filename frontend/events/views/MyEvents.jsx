import React, { useEffect, useMemo, useState } from "react";
import { InviteModal } from "../components/InviteModal.jsx";
import { PoolLedgerModal } from "../components/PoolLedgerModal.jsx";
import { TopUpPoolModal } from "../components/TopUpPoolModal.jsx";

const PAGE_SIZE = 20;
const ALL_POOLS_FILTER = "all";
const DEFAULT_POOL_SLUG = "general";
const ANY_FUNDING_FILTER = "any";
const FUNDING_FILTER_LABELS = {
  any: "All events",
  funded: "Funded events",
  deficit: "Pending deficit events",
  unfunded: "Unfunded events",
};
const ZERO_SUMMARY = {
  events_count: 0,
  published_events_count: 0,
  reward_pool_kind_total: 0,
  verified_credits_total: 0,
  funded_credits_total: 0,
  deficit_credits_total: 0,
  pool_credits_in_total: 0,
  pool_credits_out_total: 0,
  pool_credits_remaining: 0,
};
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
  const [poolFilter, setPoolFilter] = useState(ALL_POOLS_FILTER);
  const [fundingFilter, setFundingFilter] = useState(ANY_FUNDING_FILTER);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [poolSummary, setPoolSummary] = useState({
    loading: true,
    error: null,
    pools: [],
    totals: { ...ZERO_SUMMARY },
  });
  const [toast, setToast] = useState(null);
  const [ledgerModalOpen, setLedgerModalOpen] = useState(false);
  const [topUpModal, setTopUpModal] = useState({ open: false, poolSlug: DEFAULT_POOL_SLUG });
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
  }, [tab, poolFilter, fundingFilter]);

  useEffect(() => {
    fetchPoolSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const poolOptions = useMemo(() => {
    const slugs = Array.isArray(poolSummary.pools)
      ? poolSummary.pools
          .map((item) => item?.funding_pool_slug)
          .filter((value) => typeof value === "string" && value.trim())
      : [];
    const unique = Array.from(new Set([DEFAULT_POOL_SLUG, ...slugs])).sort();
    if (poolFilter !== ALL_POOLS_FILTER && !unique.includes(poolFilter)) {
      unique.unshift(poolFilter);
    }
    return [ALL_POOLS_FILTER, ...unique];
  }, [poolSummary.pools, poolFilter]);

  const selectedPoolSummary = useMemo(() => {
    if (poolFilter === ALL_POOLS_FILTER) {
      return {
        funding_pool_slug: ALL_POOLS_FILTER,
        ...(poolSummary.totals || ZERO_SUMMARY),
      };
    }
    const found = (poolSummary.pools || []).find((item) => item.funding_pool_slug === poolFilter);
    if (found) return found;
    return {
      funding_pool_slug: poolFilter,
      ...ZERO_SUMMARY,
    };
  }, [poolFilter, poolSummary.pools, poolSummary.totals]);

  async function fetchPoolSummary({ includeSlug = null } = {}) {
    setPoolSummary((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const params = new URLSearchParams();
      if (includeSlug && includeSlug !== ALL_POOLS_FILTER) {
        params.set("include_pool_slug", includeSlug);
      }
      const query = params.toString();
      const res = await fetch(`/api/me/events/pools/summary${query ? `?${query}` : ""}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Unable to load pool summary");
      }
      const payload = json?.data || {};
      setPoolSummary({
        loading: false,
        error: null,
        pools: Array.isArray(payload.pools) ? payload.pools : [],
        totals: payload.totals || { ...ZERO_SUMMARY },
      });
    } catch (err) {
      console.error("load pool summary failed:", err);
      setPoolSummary((prev) => ({
        ...prev,
        loading: false,
        error: err.message || "Unable to load pool summary",
      }));
    }
  }

  async function fetchEvents(append) {
    setLoading(true);
    setError(null);
    const nextOffset = append ? offset : 0;
    try {
      const params = new URLSearchParams({
        tab,
        limit: String(PAGE_SIZE),
        offset: String(nextOffset),
      });
      if (poolFilter !== ALL_POOLS_FILTER) {
        params.set("funding_pool_slug", poolFilter);
      }
      if (fundingFilter !== ANY_FUNDING_FILTER) {
        params.set("funding_state", fundingFilter);
      }
      const res = await fetch(`/api/me/events?${params.toString()}`);
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

  function applyFundingFilter(nextFilter, { targetTab = null } = {}) {
    const normalized = nextFilter || ANY_FUNDING_FILTER;
    if (targetTab) setTab(targetTab);
    setFundingFilter(normalized);
    setOffset(0);
  }

  function openTopUpModal() {
    if (poolFilter === ALL_POOLS_FILTER) {
      setToast({ type: "error", message: "Choose a specific funding pool first." });
      return;
    }
    setTopUpModal({ open: true, poolSlug: poolFilter || DEFAULT_POOL_SLUG });
  }

  async function submitPoolTopUp({ amountCredits, source }) {
    const targetSlug = topUpModal.poolSlug || poolFilter || DEFAULT_POOL_SLUG;
    const res = await fetch("/api/me/events/pools/topups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        funding_pool_slug: targetSlug,
        amount_credits: amountCredits,
        source,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || "Unable to add pool credits");
    }
    const remaining = Number(json?.data?.pool_credits_remaining) || 0;
    setToast({
      type: "success",
      message: `Added ${amountCredits} credits to "${targetSlug}". Balance: ${remaining}.`,
    });
    await Promise.all([
      fetchPoolSummary({ includeSlug: targetSlug }),
      fetchEvents(false),
    ]);
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
      fetchPoolSummary();
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
      fetchPoolSummary();
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
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                window.location.hash = `#/events/${event.id}`;
              }}
            >
              Open Roster
            </button>
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

      <div className="pool-toolbar">
        <label className="pool-filter">
          <span>Funding Pool</span>
          <select
            value={poolFilter}
            onChange={(e) => {
              setPoolFilter(e.target.value || ALL_POOLS_FILTER);
              setOffset(0);
            }}
          >
            {poolOptions.map((slug) => (
              <option key={slug} value={slug}>
                {slug === ALL_POOLS_FILTER ? "All pools" : slug}
              </option>
            ))}
          </select>
        </label>
        <div className="pool-actions">
          <button
            type="button"
            className="btn secondary"
            onClick={() => fetchPoolSummary({ includeSlug: poolFilter })}
            disabled={poolSummary.loading}
          >
            {poolSummary.loading ? "Refreshing…" : "Refresh Pool Stats"}
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => setLedgerModalOpen(true)}
          >
            View Pool Ledger
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={openTopUpModal}
            disabled={poolFilter === ALL_POOLS_FILTER}
            title={poolFilter === ALL_POOLS_FILTER ? "Select a pool to top up" : "Add pool credits"}
          >
            Add Credits
          </button>
        </div>
      </div>

      <div className="filter-chip-row">
        <span className="filter-chip active">
          {FUNDING_FILTER_LABELS[fundingFilter] || FUNDING_FILTER_LABELS.any}
        </span>
        {fundingFilter !== ANY_FUNDING_FILTER && (
          <button
            type="button"
            className="filter-chip clear"
            onClick={() => applyFundingFilter(ANY_FUNDING_FILTER)}
          >
            Clear Filter
          </button>
        )}
      </div>

      {poolSummary.error && (
        <div className="pool-error">{poolSummary.error}</div>
      )}

      <div className="pool-summary-grid">
        <button
          type="button"
          className={`pool-card${fundingFilter === ANY_FUNDING_FILTER ? " active" : ""}`}
          onClick={() => applyFundingFilter(ANY_FUNDING_FILTER)}
        >
          <div className="pool-label">Pool Balance</div>
          <div className="pool-value">{selectedPoolSummary.pool_credits_remaining || 0}</div>
        </button>
        <button
          type="button"
          className={`pool-card${fundingFilter === "funded" ? " active" : ""}`}
          onClick={() => applyFundingFilter("funded", { targetTab: "past" })}
        >
          <div className="pool-label">Funded Credits</div>
          <div className="pool-value">{selectedPoolSummary.funded_credits_total || 0}</div>
        </button>
        <button
          type="button"
          className={`pool-card${fundingFilter === "deficit" ? " active" : ""}`}
          onClick={() => applyFundingFilter("deficit", { targetTab: "past" })}
        >
          <div className="pool-label">Pending Deficit</div>
          <div className="pool-value">{selectedPoolSummary.deficit_credits_total || 0}</div>
        </button>
        <button
          type="button"
          className={`pool-card${fundingFilter === ANY_FUNDING_FILTER ? " active" : ""}`}
          onClick={() => applyFundingFilter(ANY_FUNDING_FILTER)}
        >
          <div className="pool-label">Events in Pool</div>
          <div className="pool-value">{selectedPoolSummary.events_count || 0}</div>
        </button>
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
              {fundingFilter !== ANY_FUNDING_FILTER
                ? "No events match the active funding filter."
                : tab === "drafts"
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
                    <p className="meta-line">
                      Pool: <strong>{event.funding_pool_slug || "general"}</strong> · Reward budget: {Number(event.reward_pool_kind) || 0}
                    </p>
                    {(Number(event.verified_credits_total) || 0) > 0 && (
                      <p className="meta-line">
                        Funding: {Number(event.funded_credits_total) || 0} funded / {Number(event.verified_credits_total) || 0} verified · deficit {Number(event.deficit_credits_total) || 0}
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
      <TopUpPoolModal
        open={topUpModal.open}
        poolSlug={topUpModal.poolSlug}
        onClose={() => setTopUpModal((prev) => ({ ...prev, open: false }))}
        onSubmit={submitPoolTopUp}
      />
      <PoolLedgerModal
        open={ledgerModalOpen}
        initialPoolSlug={poolFilter}
        onClose={() => setLedgerModalOpen(false)}
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
  .pool-toolbar {
    display:flex;
    justify-content:space-between;
    align-items:flex-end;
    gap:10px;
    margin-bottom:12px;
    flex-wrap:wrap;
  }
  .pool-actions {
    display:flex;
    gap:8px;
    align-items:center;
    flex-wrap:wrap;
  }
  .pool-filter {
    display:flex;
    flex-direction:column;
    gap:6px;
    color:#334155;
    font-size:0.9rem;
    font-weight:600;
  }
  .pool-filter select {
    border:1px solid #d1d5db;
    border-radius:10px;
    padding:8px 10px;
    min-width:180px;
    background:#fff;
  }
  .pool-summary-grid {
    display:grid;
    grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));
    gap:10px;
    margin-bottom:14px;
  }
  .pool-card {
    border:1px solid #e2e8f0;
    border-radius:12px;
    padding:10px 12px;
    background:#f8fafc;
    text-align:left;
    cursor:pointer;
    transition:border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .pool-card:hover {
    border-color:#94a3b8;
  }
  .pool-card.active {
    border-color:#ff5656;
    box-shadow:0 0 0 2px rgba(255,86,86,0.12) inset;
  }
  .pool-label {
    font-size:0.78rem;
    text-transform:uppercase;
    letter-spacing:0.05em;
    color:#64748b;
  }
  .pool-value {
    margin-top:4px;
    font-size:1.25rem;
    font-weight:700;
    color:#0f172a;
  }
  .pool-error {
    border:1px solid #fecaca;
    background:#fef2f2;
    color:#991b1b;
    border-radius:10px;
    padding:8px 10px;
    margin-bottom:10px;
    font-size:0.9rem;
  }
  .filter-chip-row {
    display:flex;
    gap:8px;
    align-items:center;
    margin-bottom:10px;
    flex-wrap:wrap;
  }
  .filter-chip {
    border:1px solid #cbd5e1;
    border-radius:999px;
    padding:4px 10px;
    font-size:0.8rem;
    color:#334155;
    background:#f8fafc;
    font-weight:600;
  }
  .filter-chip.active {
    border-color:#ff5656;
    color:#9f1239;
    background:#fff1f2;
  }
  .filter-chip.clear {
    background:#fff;
    cursor:pointer;
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
