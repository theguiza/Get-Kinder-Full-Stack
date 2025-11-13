import React, { useEffect, useRef, useState } from "react";
import { InviteModal } from "../components/InviteModal.jsx";

export function EventDetail({ eventId }) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteToast, setInviteToast] = useState(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [rsvpAction, setRsvpAction] = useState(null);
  const [checkInAction, setCheckInAction] = useState(null);
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

  async function handleRsvp(action) {
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
      showToast({
        message: action === "accept" ? "You're marked as going." : "Invite declined.",
        type: "success",
      });
    } catch (err) {
      showToast({ message: err.message || "Unable to update RSVP.", type: "error" });
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
      <h2 style={{ marginTop: 0 }}>{evt.title || "Event Detail"}</h2>
      <div className="muted">{evt.location_text || "Location TBD"}</div>
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
      <div className="row" style={{ gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        <button
          className="btn secondary"
          type="button"
          onClick={handleAddToCalendar}
          disabled={calendarLoading}
        >
          {calendarLoading ? "Preparing…" : "Add to Calendar"}
        </button>
        <button className="btn secondary" type="button" onClick={() => setInviteOpen(true)}>
          Invite
        </button>
      </div>

      {!evt.viewer_is_host && evt.status === "published" && (
        <div className="card rsvp-card">
          <div>
            <strong>{evt.viewer_rsvp_status === "accepted" ? "You're going" : evt.viewer_rsvp_status === "checked_in" ? "Checked in" : "RSVP"}</strong>
            <p className="muted mb-0">Let the host know if you're attending.</p>
          </div>
          <div className="rsvp-actions">
            <button
              type="button"
              className={`btn ${evt.viewer_rsvp_status === "accepted" || evt.viewer_rsvp_status === "checked_in" ? "primary" : "secondary"}`}
              onClick={() => handleRsvp("accept")}
              disabled={rsvpAction === "accept" || evt.viewer_rsvp_status === "checked_in"}
            >
              {rsvpAction === "accept" ? "Saving…" : evt.viewer_rsvp_status === "accepted" || evt.viewer_rsvp_status === "checked_in" ? "Going" : "Accept"}
            </button>
            <button
              type="button"
              className="btn tertiary"
              onClick={() => handleRsvp("decline")}
              disabled={rsvpAction === "decline"}
            >
              {rsvpAction === "decline" ? "Saving…" : "Decline"}
            </button>
          </div>
        </div>
      )}

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

      <h3>After the event</h3>
      <div className="grid">
        <div className="box">
          <strong>Enter 6-digit code</strong>
          <p className="muted mb-0">Hosts can share a quick check-in code.</p>
        </div>
        <div className="box">
          <strong>Paste public social URL</strong>
          <p className="muted mb-0">Drop proof from Instagram, TikTok, etc.</p>
        </div>
      </div>

      <div className="card row" style={{ justifyContent: "space-between", gap: 12 }}>
        <strong>Host tools</strong>
        <button className="btn" type="button">
          Show QR / Code
        </button>
      </div>
      <button className="btn secondary w-100" type="button">
        Mark Completed
      </button>
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
  .row{display:flex;align-items:center}
  .card{border:1px solid #e5e7eb;border-radius:16px;padding:16px;background:#fff;margin:12px 0}
  .rsvp-card{display:flex;flex-direction:column;gap:12px}
  .rsvp-actions{display:flex;gap:12px;flex-wrap:wrap}
  .checkin-card{display:flex;flex-direction:column;gap:12px}
  .checkin-buttons{display:flex;flex-wrap:wrap;gap:10px}
  .rsvp-stats{margin-top:8px;color:#6b7280;font-size:0.9rem}
  .when-card__body{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px}
  .when-card__col{flex:1 1 100%;min-width:0}
  .when-card__col.meta{flex:0 0 auto;min-width:140px}
  .when-card__col .label{display:block;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:4px}
  .when-card__col .value{margin:0 0 12px;font-weight:600;color:#1f2937;word-break:break-word}
  .when-card__col.meta .value{font-size:1.1rem}
  .card p{margin:6px 0 0}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
  .box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px}
  .detail-cover{margin:12px 0}
  .detail-cover img{width:100%;max-height:240px;object-fit:cover;border-radius:16px;border:1px solid #e5e7eb}
  .btn{background:#ff5656;border:none;color:#fff;padding:10px 16px;border-radius:10px;font-weight:700;cursor:pointer}
  .btn.secondary{background:#fff;border:1px solid #e5e7eb;color:#1f2937}
  .btn.tertiary{background:transparent;border:1px dashed #d1d5db;color:#4b5563}
  .mt-2{margin-top:0.5rem}
  .invite-toast{margin:0 0 8px;font-size:0.95rem;display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:12px}
  .invite-toast.success{background:#ecfdf5;color:#065f46}
  .invite-toast.error{background:#fef2f2;color:#b91c1c}
  .invite-toast button{border:none;background:#fff;color:#455a7c;font-weight:600;border-radius:999px;padding:4px 10px;cursor:pointer}
  .muted{color:#6b7280}
  .w-100{width:100%}
  h3{margin-top:24px}
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
