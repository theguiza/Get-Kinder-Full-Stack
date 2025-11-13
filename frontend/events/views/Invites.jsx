import React, { useEffect, useState } from "react";

const PAGE_SIZE = 20;

const STATUS_CLASS = {
  pending: "pending",
  accepted: "accepted",
  declined: "declined",
  expired: "expired",
};

const STATUS_LABEL = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

const initialListState = { items: [], loading: true, error: null, offset: 0, hasMore: true };

export function Invites() {
  const [incoming, setIncoming] = useState(initialListState);
  const [outgoing, setOutgoing] = useState(initialListState);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    loadInvites("incoming");
    loadInvites("outgoing");
  }, []);

  useEffect(() => {
    function handleInviteSent(event) {
      const invite = event.detail;
      if (!invite) return;
      setOutgoing((prev) => ({
        ...prev,
        items: [
          {
            id: invite.id,
            event_id: invite.event_id,
            event_title: invite.event_title || "Your event",
            event_starts_at: invite.event_starts_at || null,
            event_time_label: invite.event_starts_at ? formatLabel(invite.event_starts_at) : null,
            invitee_name: invite.invitee_name || invite.invitee_email,
            status: invite.status || "pending",
          },
          ...prev.items,
        ],
      }));
    }
    window.addEventListener("gk:invite-sent", handleInviteSent);
    return () => window.removeEventListener("gk:invite-sent", handleInviteSent);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const loadInvites = async (type, append = false) => {
    const setter = type === "incoming" ? setIncoming : setOutgoing;
    setter((prev) => ({ ...prev, loading: true, error: null }));
    const state = type === "incoming" ? incoming : outgoing;
    const offset = append ? state.offset : 0;
    try {
      const res = await fetch(`/api/invites?type=${type}&limit=${PAGE_SIZE}&offset=${offset}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load invites");
      const items = append ? [...state.items, ...(json?.data || [])] : json?.data || [];
      setter({
        items,
        loading: false,
        error: null,
        offset: offset + (json?.paging?.count || 0),
        hasMore: (json?.paging?.count || 0) === PAGE_SIZE,
      });
    } catch (error) {
      console.error(`Load ${type} invites failed:`, error);
      setter((prev) => ({ ...prev, loading: false, error: error.message || "Failed to load." }));
    }
  };

  const handleAction = async (inviteId, action) => {
    const optimisticIndex = incoming.items.findIndex((invite) => invite.id === inviteId);
    if (optimisticIndex === -1) return;
    const removed = incoming.items[optimisticIndex];
    setIncoming((prev) => ({
      ...prev,
      items: prev.items.filter((invite) => invite.id !== inviteId),
    }));
    try {
      const res = await fetch(`/api/invites/${inviteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to update invite");
      setToast({ type: "success", message: `Invite ${action === "accept" ? "accepted" : "declined"}.` });
    } catch (error) {
      console.error("Invite action failed:", error);
      setIncoming((prev) => ({
        ...prev,
        items: [removed, ...prev.items],
      }));
      setToast({ type: "error", message: error.message || "Unable to update invite." });
    }
  };

  return (
    <section className="invites-page">
      {toast && (
        <div className={`toast ${toast.type}`}>
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <header className="page-head">
        <div>
          <p className="eyebrow">Your connections</p>
          <h1>Invites</h1>
        </div>
        <a className="ghost-link" href="#/my-invites">
          View only my sent invites →
        </a>
      </header>

      <div className="invites-grid">
        <section className="card">
          <div className="section-head">
            <h2>Incoming</h2>
          </div>
          <InviteList
            type="incoming"
            data={incoming}
            onLoadMore={() => loadInvites("incoming", true)}
            onAccept={(id) => handleAction(id, "accept")}
            onDecline={(id) => handleAction(id, "decline")}
          />
        </section>

        <section className="card">
          <div className="section-head">
            <h2>Outgoing</h2>
          </div>
          <InviteList
            type="outgoing"
            data={outgoing}
            onLoadMore={() => loadInvites("outgoing", true)}
          />
        </section>
      </div>

      <style>{styles}</style>
    </section>
  );
}

function InviteList({ type, data, onLoadMore, onAccept, onDecline }) {
  const { items, loading, error, hasMore } = data;
  const isIncoming = type === "incoming";

  if (loading && !items.length) {
    return (
      <div className="list">
        {[...Array(3)].map((_, idx) => (
          <div className="item skeleton" key={idx}>
            <div className="meta">
              <div className="line short" />
              <div className="line" />
            </div>
            <div className="actions" />
          </div>
        ))}
      </div>
    );
  }

  if (error && !items.length) {
    return (
      <div className="empty">
        <p className="muted">{error}</p>
        <button type="button" className="btn secondary" onClick={onLoadMore}>
          Retry
        </button>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="empty">
        <p className="muted">
          {isIncoming ? "No invites right now." : "You haven’t invited anyone yet."}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="list">
        {items.map((invite) => (
          <div className="item" key={invite.id}>
            <div className="meta">
              <p className="title">
                {invite.event_title}
              </p>
              <p className="sub">
                {isIncoming
                  ? `From: ${invite.host_name || "Someone"}`
                  : `To: ${invite.invitee_name || "Guest"}`}
                {invite.event_time_label && (
                  <>
                    {" "}
                    <span className="dot">•</span> {invite.event_time_label}
                  </>
                )}
              </p>
            </div>
            <div className="actions">
              {isIncoming ? (
                <>
                  <button type="button" className="btn secondary" onClick={() => onDecline(invite.id)}>
                    Decline
                  </button>
                  <button type="button" className="btn primary" onClick={() => onAccept(invite.id)}>
                    Accept
                  </button>
                </>
              ) : (
                <span className={`badge ${STATUS_CLASS[invite.status] || "pending"}`}>
                  {STATUS_LABEL[invite.status] || invite.status}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {hasMore && (
        <button type="button" className="btn secondary block" onClick={onLoadMore} disabled={loading}>
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
}

function formatLabel(iso) {
  try {
    const dt = new Date(iso);
    return dt.toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

const styles = `
  .invites-page {
    background:#fff;
    border:1px solid #e5e7eb;
    border-radius:20px;
    padding:24px;
    box-shadow:0 20px 40px rgba(15,23,42,0.08);
  }
  .page-head {
    display:flex;
    justify-content:space-between;
    align-items:flex-end;
    gap:12px;
    margin-bottom:16px;
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
  .ghost-link {
    color:#455a7c;
    text-decoration:none;
    font-weight:600;
  }
  .ghost-link:hover {
    text-decoration:underline;
  }
  .invites-grid {
    display:grid;
    gap:24px;
  }
  @media (min-width: 992px) {
    .invites-grid {
      grid-template-columns:repeat(2,minmax(0,1fr));
    }
  }
  .card {
    border:1px solid #e2e8f0;
    border-radius:16px;
    padding:16px;
    background:#fff;
  }
  .section-head {
    display:flex;
    justify-content:space-between;
    align-items:center;
    margin-bottom:12px;
  }
  .section-head h2 {
    margin:0;
    font-size:1.1rem;
    color:#111827;
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
    gap:16px;
    align-items:center;
    background:#fff;
  }
  .item.skeleton {
    animation:pulse 1.5s ease-in-out infinite;
  }
  .meta {
    flex:1;
  }
  .title {
    font-weight:600;
    margin:0 0 4px;
    color:#111827;
  }
  .sub {
    margin:0;
    color:#6b7280;
    font-size:0.9rem;
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
  .btn.primary {
    color:#fff;
    background:#ff5656;
    border-color:#ff5656;
  }
  .btn.secondary {
    background:#fff;
    color:#111827;
  }
  .btn.block {
    width:100%;
    margin-top:12px;
  }
  .badge {
    border-radius:999px;
    padding:6px 14px;
    font-weight:600;
    text-transform:capitalize;
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
  .toast {
    display:flex;
    justify-content:space-between;
    align-items:center;
    margin-bottom:16px;
    border-radius:12px;
    padding:12px 16px;
    color:#fff;
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
  @keyframes pulse {
    0% { opacity: 0.6; }
    50% { opacity: 1; }
    100% { opacity: 0.6; }
  }
  .line {
    height:10px;
    border-radius:6px;
    background:#e5e7eb;
    margin-bottom:6px;
  }
  .line.short { width:80px; }
  .dot {
    color:#9ca3af;
  }
`;
