import React, { useEffect, useRef, useState } from "react";
import { InviteModal } from "../components/InviteModal.jsx";

export function EventDetail({ eventId }) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteToast, setInviteToast] = useState(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [rsvpAction, setRsvpAction] = useState(null);
  const [checkInAction, setCheckInAction] = useState(null);
  const [cancelRequestDialogOpen, setCancelRequestDialogOpen] = useState(false);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    if (!eventId) {
      setState({ loading: false, data: null, error: null });
      return;
    }
    let alive = true;
    const controller = new AbortController();
    setState({ loading: true, data: null, error: null });
    fetch(`/api/events/${encodeURIComponent(eventId)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load event"))))
      .then((json) => {
        if (!alive) return;
        setState({ loading: false, data: json?.data || null, error: null });
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        if (!alive) return;
        setState({ loading: false, data: null, error: "Unable to load event" });
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [eventId]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  if (!eventId) {
    return <p className="muted">Select an event to see details.</p>;
  }

  if (state.loading) {
    return <p className="muted">Loading…</p>;
  }

  if (state.error) {
    return <p className="text-danger">{state.error}</p>;
  }

  function showToast(payload, timeout = 4000) {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setInviteToast(payload);
    if (timeout) {
      toastTimerRef.current = setTimeout(() => setInviteToast(null), timeout);
    }
  }

  const evt = state.data;
  if (!evt) {
    return <p className="muted">Event not found.</p>;
  }

  async function handleAddToCalendar() {
    if (calendarLoading) return;
    setCalendarLoading(true);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/calendar.ics`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Unable to generate calendar invite");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const filename = `${(evt.title || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "event"}.ics`;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      showToast({ message: "Calendar invite downloaded.", type: "success" });
    } catch (err) {
      showToast({ message: err.message || "Unable to download calendar.", type: "error" });
    } finally {
      setCalendarLoading(false);
    }
  }

  function patchEvent(patch) {
    setState((prev) => {
      if (!prev?.data) return prev;
      return { ...prev, data: { ...prev.data, ...patch } };
    });
  }

  async function handleRsvp(action, options = {}) {
    if (rsvpAction) return;
    setRsvpAction(action);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Unable to update RSVP");
      }
      patchEvent({
        viewer_rsvp_status: json.data?.status || action,
        rsvp_counts: json.data?.rsvp_counts || state.data?.rsvp_counts,
        viewer_check_in_method: null,
        viewer_checked_in_at: null,
      });
      const successMessage = typeof options.successMessage === "string" && options.successMessage.trim()
        ? options.successMessage
        : action === "accept"
          ? "You're marked as going."
          : "Invite declined.";
      showToast({
        message: successMessage,
        type: "success",
      });
      return true;
    } catch (err) {
      showToast({ message: err.message || "Unable to update RSVP.", type: "error" });
      return false;
    } finally {
      setRsvpAction(null);
    }
  }

  async function handleCheckIn(method) {
    if (checkInAction) return;
    if (method === "host_code") {
      const code = window.prompt("Enter the 6-digit host code");
      if (!code) return;
    }
    setCheckInAction(method);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/checkins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Unable to check in");
      }
      patchEvent({
        viewer_rsvp_status: json.data?.status || "checked_in",
        viewer_check_in_method: json.data?.check_in_method || method,
        viewer_checked_in_at: json.data?.checked_in_at || new Date().toISOString(),
        rsvp_counts: json.data?.rsvp_counts || state.data?.rsvp_counts,
      });
      showToast({ message: "You're checked in!", type: "success" });
    } catch (err) {
      showToast({ message: err.message || "Unable to check in.", type: "error" });
    } finally {
      setCheckInAction(null);
    }
  }

  return (
    <div>
      <h2 className="event-detail-title">{evt.title || "Event Detail"}</h2>
      <div className="event-detail-subheader">{evt.location_text || "Location TBD"}</div>
      {evt.cover_url && (
        <div className="detail-cover">
          <img src={evt.cover_url} alt="Event cover" />
        </div>
      )}

      <div className="rsvp-stats">
        <span>
          RSVP'd: {evt?.rsvp_counts?.accepted ?? 0}
          {evt.capacity ? ` / ${evt.capacity}` : ""}
        </span>
      </div>

      {inviteToast && (
        <div className={`invite-toast ${inviteToast.type || "success"}`}>
          <span>{inviteToast.message}</span>
          {inviteToast.actionLabel && (
            <button
              type="button"
              onClick={() => {
                inviteToast.onAction?.();
                setInviteToast(null);
              }}
            >
              {inviteToast.actionLabel}
            </button>
          )}
        </div>
      )}
      {!evt.viewer_is_host && (
        <div className="card rsvp-card">
          <div>
            <strong className="rsvp-card__title">Request Attendance</strong>
            <p className="muted mb-0">Send a request to join this event, and you will hear back on your approval shortly</p>
          </div>
          <div className="rsvp-actions">
            {evt.viewer_rsvp_status === "accepted" ? (
              <button
                type="button"
                className="btn secondary"
                onClick={() => setCancelRequestDialogOpen(true)}
                disabled={Boolean(rsvpAction)}
              >
                {rsvpAction === "decline" ? "Canceling…" : "Cancel request"}
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={() => handleRsvp("accept")}
                disabled={rsvpAction === "accept" || evt.viewer_rsvp_status === "checked_in"}
              >
                {rsvpAction === "accept" ? "Saving…" : "Request"}
              </button>
            )}
          </div>
        </div>
      )}
      {cancelRequestDialogOpen && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="cancel-request-title">
            <h4 id="cancel-request-title" className="dialog-title">Are you sure you want to cancel your request?</h4>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => setCancelRequestDialogOpen(false)}
                disabled={Boolean(rsvpAction)}
              >
                Return
              </button>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const ok = await handleRsvp("decline", { successMessage: "Request cancelled." });
                  if (ok) setCancelRequestDialogOpen(false);
                }}
                disabled={Boolean(rsvpAction)}
              >
                {rsvpAction === "decline" ? "Canceling…" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        <button
          className="btn secondary event-action-btn"
          type="button"
          onClick={handleAddToCalendar}
          disabled={calendarLoading}
        >
          {calendarLoading ? "Preparing…" : "Add to Calendar"}
        </button>
        <button className="btn secondary event-action-btn" type="button" onClick={() => setInviteOpen(true)}>
          Invite a Friend to Join
        </button>
      </div>

      {!evt.viewer_is_host && evt.viewer_rsvp_status === "accepted" && Array.isArray(evt.attendance_methods) && evt.attendance_methods.length > 0 && (
        <div className="card checkin-card">
          <strong>Check in</strong>
          <p className="muted mb-0">Choose one of the host's preferred methods when you arrive.</p>
          <div className="checkin-buttons">
            {evt.attendance_methods.map((method) => (
              <button
                key={method}
                type="button"
                className={`btn secondary`}
                onClick={() => handleCheckIn(method)}
                disabled={Boolean(checkInAction)}
              >
                {checkInAction === method ? "Submitting…" : formatMethodLabel(method)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card when-card">
        <div className="when-card__header">
          <strong>When / Where</strong>
        </div>
        <div className="when-card__body">
          <div className="when-card__col">
            <span className="label">Date & Time</span>
            <p className="value">{formatEventDate(evt.start_at, evt.tz)}</p>
            <span className="label">Location</span>
            <p className="value" style={{ whiteSpace: "pre-wrap" }}>
              {evt.location_text || "Location TBD"}
            </p>
          </div>
          <div className="when-card__col meta">
            <div>
              <span className="label">Capacity</span>
              <p className="value">{evt.capacity || "Unlimited"}</p>
            </div>
            <div>
              <span className="label">RSVPs</span>
              <p className="value">{evt?.rsvp_counts?.accepted || 0}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card info-card">
        <div className="info-card__header">
          <strong>Event Details</strong>
        </div>
        <div className="info-grid">
          <div>
            <span className="label">Organization</span>
            <p className="value">{evt.org_name || "Independent organizer"}</p>
          </div>
          <div>
            <span className="label">Community tag</span>
            <p className="value">{evt.community_tag || "General"}</p>
          </div>
          <div>
            <span className="label">Verification</span>
            <p className="value">{formatVerificationLabel(evt.verification_method)}</p>
          </div>
          <div>
            <span className="label">Impact Credits on verification</span>
            <p className="value">{Number.isFinite(Number(evt.impact_credits_base)) ? Number(evt.impact_credits_base) : 25}</p>
          </div>
        </div>
        <div className="info-tags">
          <span className="label">Cause tags</span>
          {Array.isArray(evt.cause_tags) && evt.cause_tags.length > 0 ? (
            <div className="tag-row">
              {evt.cause_tags.map((tag) => (
                <span className="tag" key={tag}>{tag}</span>
              ))}
            </div>
          ) : (
            <p className="muted small">No cause tags yet.</p>
          )}
        </div>
        {evt.requirements && (
          <div className="info-reqs">
            <span className="label">Requirements</span>
            <p className="value" style={{ whiteSpace: "pre-wrap" }}>{evt.requirements}</p>
          </div>
        )}
      </div>

      <h3>After the event</h3>
      <div className="grid">
        <div className="box">
          <strong>Paste public social URL</strong>
          <p className="muted mb-0">Drop proof from Instagram, TikTok, etc.</p>
        </div>
      </div>
      <button
        className="btn tertiary w-100 mt-2"
        type="button"
        onClick={() => {
          if (typeof window !== "undefined") {
            window.location.hash = "#/events";
          }
        }}
      >
        Back to Events
      </button>

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        eventId={eventId}
        eventTitle={evt.title}
        onSent={() => {
          setInviteOpen(false);
          showToast({
            message: "Invite sent!",
            actionLabel: "View in My Invites",
            onAction: () => {
              window.location.hash = "#/my-invites";
            },
            type: "success",
          });
        }}
      />

      <style>{detailStyles}</style>
    </div>
  );
}

const detailStyles = `
  .event-detail-title{
    margin:0;
    color:#ff5656;
    font-size:clamp(1.75rem,4.4vw,2.15rem);
    line-height:1.15;
    font-weight:800
  }
  .event-detail-subheader{
    margin-top:4px;
    color:#455a7c;
    font-size:clamp(1.1rem,3.2vw,1.35rem);
    line-height:1.3;
    font-weight:600
  }
  .row{display:flex;align-items:center}
  .card{border:none;border-radius:18px;padding:20px;background:#fff;margin:12px 0;box-shadow:0 2px 12px rgba(69, 90, 124, 0.08)}
  .rsvp-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px}
  .rsvp-card > div:first-child{text-align:center}
  .rsvp-card__title{display:block;font-size:1.2rem;line-height:1.2;color:#ff5656;font-weight:700}
  .rsvp-actions{display:flex;gap:12px;flex-wrap:wrap}
  .dialog-backdrop{
    position:fixed;
    inset:0;
    background:rgba(17,24,39,0.45);
    display:flex;
    align-items:center;
    justify-content:center;
    padding:16px;
    z-index:2000
  }
  .dialog-card{
    width:min(460px,100%);
    background:#fff;
    border-radius:14px;
    box-shadow:0 16px 40px rgba(17,24,39,0.22);
    padding:18px
  }
  .dialog-title{
    margin:0 0 14px;
    color:#1f2937;
    font-size:1.05rem;
    line-height:1.4;
    font-weight:700
  }
  .dialog-actions{
    display:flex;
    justify-content:flex-end;
    gap:10px;
    flex-wrap:wrap
  }
  .checkin-card{display:flex;flex-direction:column;gap:12px}
  .checkin-buttons{display:flex;flex-wrap:wrap;gap:10px}
  .rsvp-stats{margin-top:8px;color:#6b7280;font-size:0.9rem}
  .when-card{display:grid;grid-template-columns:1fr 2fr;column-gap:20px;align-items:start}
  .when-card__header{margin:0;padding:0 16px 0 0;border-bottom:none;border-right:2px solid #ff5656;min-height:100%}
  .when-card__header strong{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;color:#455a7c;font-weight:700}
  .when-card__body{display:flex;gap:16px;flex-wrap:wrap;margin-top:0}
  .when-card__col{flex:1 1 100%;min-width:0}
  .when-card__col.meta{flex:0 0 auto;min-width:140px}
  .when-card__col .label{display:block;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.09em;color:#6c757d;margin-bottom:2px;font-weight:600}
  .when-card__col:not(.meta) .value{margin:0 0 8px;font-weight:600;color:#455a7c;word-break:break-word}
  .when-card__col:not(.meta) .value:last-of-type{margin-bottom:0}
  .when-card__col.meta{display:flex;flex-direction:column;gap:8px}
  .when-card__col.meta .value{margin:0;font-size:1.1rem;font-weight:600;color:#455a7c;word-break:break-word}
  .info-card{display:grid;grid-template-columns:1fr 2fr;column-gap:20px;align-items:start}
  .info-card__header{margin:0;padding:0 16px 0 0;border-bottom:none;border-right:2px solid #ff5656;min-height:100%;grid-column:1;grid-row:1 / span 3}
  .info-card__header strong{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;color:#455a7c;font-weight:700}
  .info-card .label{display:block;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.09em;color:#6c757d;margin-bottom:4px;font-weight:600}
  .info-card .value{margin:0 0 4px;font-weight:600;color:#455a7c;word-break:break-word}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;grid-column:2}
  .info-tags{grid-column:2}
  .info-reqs{grid-column:2}
  .info-tags .tag-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
  .tag{display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;border:1.5px solid #455a7c;background:#ffffff;color:#455a7c;font-size:0.78rem;font-weight:500;margin:2px 4px 2px 0;transition:all 0.15s ease}
  .tag:hover{background:#ff5656;border-color:#ff5656;color:#ffffff}
  .info-reqs .value{margin-top:4px}
  .card p{margin:6px 0 0}
  .grid{display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:16px}
  .box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px}
  .detail-cover{margin:12px 0}
  .detail-cover img{width:100%;max-height:240px;object-fit:cover;border-radius:16px;border:1px solid #e5e7eb}
  .btn{background:#ff5656;border:none;color:#fff;padding:10px 16px;border-radius:10px;font-weight:700;cursor:pointer}
  .btn.secondary{background:#fff;border:1px solid #e5e7eb;color:#1f2937}
  .btn.secondary.event-action-btn{color:#455a7c}
  .btn.tertiary{background:transparent;border:1px dashed #d1d5db;color:#4b5563}
  .mt-2{margin-top:0.5rem}
  .invite-toast{margin:0 0 8px;font-size:0.95rem;display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:12px}
  .invite-toast.success{background:#ecfdf5;color:#065f46}
  .invite-toast.error{background:#fef2f2;color:#b91c1c}
  .invite-toast button{border:none;background:#fff;color:#455a7c;font-weight:600;border-radius:999px;padding:4px 10px;cursor:pointer}
  .muted{color:#6b7280}
  .muted.small{color:#6c757d;font-size:0.82rem;margin:0}
  .roster-card{display:flex;flex-direction:column;gap:12px}
  .roster-head{display:flex;justify-content:space-between;align-items:center}
  .roster-list{display:flex;flex-direction:column;gap:10px}
  .roster-row{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
  .roster-name{font-weight:600;color:#1f2937}
  .roster-actions{display:flex;gap:8px;flex-wrap:wrap}
  .small{font-size:0.85rem}
  .w-100{width:100%}
  h3{margin-top:24px}
  @media (max-width: 768px){
    .when-card{grid-template-columns:1fr}
    .when-card__header{padding:0 0 12px;border-right:none;border-bottom:2px solid #ff5656;margin-bottom:12px}
    .info-card{grid-template-columns:1fr}
    .info-card__header{padding:0 0 12px;border-right:none;border-bottom:2px solid #ff5656;margin-bottom:12px;grid-column:1;grid-row:auto}
    .info-grid,.info-tags,.info-reqs{grid-column:1}
  }
  @media (max-width: 480px){
    .info-grid{grid-template-columns:1fr}
  }
`;

function formatEventDate(iso, tz) {
  if (!iso) return "Date TBD";
  try {
    return new Date(iso).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz || "UTC",
    });
  } catch {
    return iso;
  }
}

function formatMethodLabel(method) {
  switch (method) {
    case "host_code":
      return "Host Code";
    case "social_proof":
      return "Social Proof";
    case "geo":
      return "Geo Check-in";
    default:
      return method;
  }
}

function formatVerificationLabel(method) {
  switch (method) {
    case "host_attest":
      return "Host attestation";
    case "qr_stub":
      return "QR check-in (stub)";
    case "social_proof":
      return "Social proof";
    default:
      return "Host attestation";
  }
}
