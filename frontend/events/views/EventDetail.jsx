import React, { useEffect, useRef, useState } from "react";
import { InviteModal } from "../components/InviteModal.jsx";
import { fetchRoster, verifyRsvp } from "../api.js";

export function EventDetail({ eventId }) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteToast, setInviteToast] = useState(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [rsvpAction, setRsvpAction] = useState(null);
  const [checkInAction, setCheckInAction] = useState(null);
  const [rosterState, setRosterState] = useState({ loading: false, data: [], error: null, hidden: true });
  const [verifyAction, setVerifyAction] = useState(null);
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

  useEffect(() => {
    if (!eventId) {
      setRosterState({ loading: false, data: [], error: null, hidden: true });
      return;
    }
    let alive = true;
    const controller = new AbortController();
    setRosterState({ loading: true, data: [], error: null, hidden: false });
    fetchRoster(eventId, { signal: controller.signal })
      .then((data) => {
        if (!alive) return;
        setRosterState({ loading: false, data, error: null, hidden: false });
      })
      .catch((err) => {
        if (err?.name === "AbortError" || !alive) return;
        const message = err?.message || "Unable to load roster";
        if (message === "Forbidden") {
          setRosterState({ loading: false, data: [], error: null, hidden: true });
          return;
        }
        setRosterState({ loading: false, data: [], error: message, hidden: false });
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [eventId]);

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

  async function handleVerify(attendee, decision) {
    const attendeeId = attendee?.attendee_user_id || attendee?.id || attendee;
    if (!attendeeId || verifyAction) return;
    setVerifyAction(`${attendeeId}:${decision}`);
    try {
      const payload = {
        attendee_user_id: attendeeId,
        decision,
      };
      if (decision === "verified") {
        payload.attended_minutes = attendee?.attended_minutes || 90;
      }
      const json = await verifyRsvp(eventId, payload);
      setRosterState((prev) => ({
        ...prev,
        data: (prev.data || []).map((row) =>
          row.attendee_user_id === attendeeId
            ? {
                ...row,
                verification_status: json.verification_status || decision,
                attended_minutes: json.attended_minutes ?? row.attended_minutes,
              }
            : row
        ),
      }));
      const credits = json?.impact_credits_awarded || 0;
      const message =
        decision === "rejected"
          ? "Marked as rejected."
          : json?.already_verified
          ? `Already verified. Credits: ${credits}`
          : `Verified. Credits awarded: ${credits}`;
      showToast({ message, type: "success" });
    } catch (err) {
      showToast({ message: err.message || "Unable to verify attendee.", type: "error" });
    } finally {
      setVerifyAction(null);
    }
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

      <div className="card info-card">
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
          <strong>Enter 6-digit code</strong>
          <p className="muted mb-0">Hosts can share a quick check-in code.</p>
        </div>
        <div className="box">
          <strong>Paste public social URL</strong>
          <p className="muted mb-0">Drop proof from Instagram, TikTok, etc.</p>
        </div>
      </div>

      {!rosterState.hidden && (
        <div className="card roster-card">
          <div className="roster-head">
            <strong>Organizer roster</strong>
            <span className="muted">{rosterState.data?.length || 0} RSVPs</span>
          </div>
          {rosterState.loading && <div className="muted">Loading roster…</div>}
          {rosterState.error && <div className="text-danger">{rosterState.error}</div>}
          {!rosterState.loading && !rosterState.error && rosterState.data.length === 0 && (
            <div className="muted">No RSVPs yet.</div>
          )}
          {!rosterState.loading && !rosterState.error && rosterState.data.length > 0 && (
            <div className="roster-list">
              {rosterState.data.map((row) => {
                const displayName =
                  [row.firstname, row.lastname].filter(Boolean).join(" ") ||
                  row.email ||
                  row.attendee_user_id;
                const isVerified = row.verification_status === "verified";
                const isRejected = row.verification_status === "rejected";
                const actionKey = `${row.attendee_user_id}:${isRejected ? "rejected" : "verified"}`;
                return (
                  <div className="roster-row" key={row.attendee_user_id}>
                    <div>
                      <div className="roster-name">{displayName}</div>
                      <div className="muted small">
                        Status: {row.status || "unknown"} • Verification: {row.verification_status || "pending"}
                        {Number.isFinite(Number(row.attended_minutes))
                          ? ` • ${row.attended_minutes} mins`
                          : ""}
                      </div>
                    </div>
                    <div className="roster-actions">
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => handleVerify(row, "verified")}
                        disabled={isVerified || verifyAction === `${row.attendee_user_id}:verified`}
                      >
                        {isVerified ? "Verified" : verifyAction === `${row.attendee_user_id}:verified` ? "Verifying…" : "Verify"}
                      </button>
                      <button
                        type="button"
                        className="btn tertiary"
                        onClick={() => handleVerify(row, "rejected")}
                        disabled={isRejected || verifyAction === `${row.attendee_user_id}:rejected`}
                      >
                        {isRejected ? "Rejected" : verifyAction === `${row.attendee_user_id}:rejected` ? "Rejecting…" : "Reject"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
  .info-card{display:flex;flex-direction:column;gap:12px}
  .info-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
  .info-tags .tag-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
  .tag{background:#f3f4f6;border:1px solid #e5e7eb;border-radius:999px;padding:4px 10px;font-size:0.85rem}
  .info-reqs .value{margin-top:4px}
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
  .roster-card{display:flex;flex-direction:column;gap:12px}
  .roster-head{display:flex;justify-content:space-between;align-items:center}
  .roster-list{display:flex;flex-direction:column;gap:10px}
  .roster-row{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
  .roster-name{font-weight:600;color:#1f2937}
  .roster-actions{display:flex;gap:8px;flex-wrap:wrap}
  .small{font-size:0.85rem}
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
