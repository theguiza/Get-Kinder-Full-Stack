import React, { useEffect, useMemo, useState } from "react";

const TONES = [
  { value: "friendly", label: "Friendly" },
  { value: "hype", label: "High-energy" },
  { value: "thoughtful", label: "Thoughtful" },
];

function buildDefaultSubject(eventTitle) {
  return eventTitle ? `Come to ${eventTitle}` : "Join me for this event";
}

function buildDefaultMessage(eventTitle) {
  return eventTitle
    ? `I’d love for you to join me for ${eventTitle}.` + "\n\nLet me know if you can make it!"
    : "I’d love for you to join. Let me know if you can make it!";
}

export function InviteModal({ open, onClose, eventId, eventTitle, onSent }) {
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [inviteeName, setInviteeName] = useState("");
  const [tone, setTone] = useState("friendly");
  const [subject, setSubject] = useState(buildDefaultSubject(eventTitle));
  const [message, setMessage] = useState(buildDefaultMessage(eventTitle));
  const [submitting, setSubmitting] = useState(false);
  const [kaiSending, setKaiSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [loadedContacts, setLoadedContacts] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail.trim());
  const suggestionMatches = useMemo(() => {
    if (!inviteeEmail) return contacts.slice(0, 5);
    const term = inviteeEmail.trim().toLowerCase();
    return contacts
      .filter((c) => c.email.toLowerCase().includes(term) || c.name.toLowerCase().includes(term))
      .slice(0, 5);
  }, [contacts, inviteeEmail]);

  useEffect(() => {
    if (!open || loadedContacts) return;
    let cancelled = false;
    fetch("/api/me/contacts")
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json?.ok && Array.isArray(json.data)) {
          setContacts(json.data);
          setLoadedContacts(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, loadedContacts]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTone("friendly");
    setSubject(buildDefaultSubject(eventTitle));
    setMessage(buildDefaultMessage(eventTitle));
  }, [open, eventTitle]);

  if (!open) return null;

  function buildPayload(sendByKai = false) {
    return {
      invitee_email: inviteeEmail.trim(),
      invitee_name: inviteeName.trim(),
      tone,
      subject: sendByKai ? undefined : subject,
      message: sendByKai ? undefined : message,
      send_by_kai: sendByKai,
    };
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    if (!emailValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(false)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Unable to send invite");
      }
      resetFields();
      window.dispatchEvent(new CustomEvent("gk:invite-sent", { detail: json.data }));
      onSent?.(json.data);
    } catch (err) {
      setError(err.message || "Unable to send invite");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleKaiSend() {
    if (!emailValid || kaiSending) return;
    setKaiSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(true)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Unable to send invite");
      }
      resetFields();
      window.dispatchEvent(new CustomEvent("gk:invite-sent", { detail: json.data }));
      onSent?.(json.data);
    } catch (err) {
      setError(err.message || "Unable to send invite");
    } finally {
      setKaiSending(false);
    }
  }

  async function handleKaiDraft() {
    if (drafting) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/invite-copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tone }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Unable to draft copy");
      }
      setSubject(json.data?.subject || buildDefaultSubject(eventTitle));
      setMessage((json.data?.body || buildDefaultMessage(eventTitle)).trim());
    } catch (err) {
      setError(err.message || "Unable to draft copy");
    } finally {
      setDrafting(false);
    }
  }

  function resetFields() {
    setInviteeEmail("");
    setInviteeName("");
    setSubject(buildDefaultSubject(eventTitle));
    setMessage(buildDefaultMessage(eventTitle));
  }

  return (
    <div className="invite-modal" role="dialog" aria-modal="true">
      <div className="invite-backdrop" onClick={onClose} />
      <div className="invite-panel">
        <h3>Invite someone</h3>
        <p className="muted">{eventTitle || "This event"}</p>
        <form onSubmit={handleSubmit} className="invite-form">
          <label>
            <span>Email *</span>
            <input
              type="email"
              value={inviteeEmail}
              onChange={(e) => setInviteeEmail(e.target.value)}
              placeholder="friend@example.com"
              required
            />
            {!!suggestionMatches.length && (
              <div className="suggestions" role="listbox">
                {suggestionMatches.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => {
                      setInviteeEmail(contact.email);
                      setInviteeName(contact.name);
                    }}
                  >
                    <span>{contact.name}</span>
                    <small>{contact.email}</small>
                  </button>
                ))}
              </div>
            )}
          </label>
          <label>
            <span>Name (optional)</span>
            <input
              type="text"
              value={inviteeName}
              onChange={(e) => setInviteeName(e.target.value)}
              placeholder="Friend's name"
            />
          </label>
          <div className="tone-row">
            <span>Tone</span>
            <div className="tone-pills">
              {TONES.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={`pill${tone === option.value ? " active" : ""}`}
                  onClick={() => setTone(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="draft-row">
            <button type="button" className="btn ghost" onClick={handleKaiDraft} disabled={drafting}>
              {drafting ? "Drafting…" : "Draft with KAI"}
            </button>
            <small className="muted">KAI will pre-fill the message</small>
          </div>
          <label>
            <span>Subject</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={buildDefaultSubject(eventTitle)}
            />
          </label>
          <label>
            <span>Message</span>
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a quick personal note"
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="invite-actions">
            <button type="button" className="btn secondary" onClick={onClose} disabled={submitting || kaiSending}>
              Close
            </button>
            <button type="submit" className="btn primary" disabled={!emailValid || submitting}>
              {submitting ? "Sending…" : "Send"}
            </button>
          </div>
          <button
            type="button"
            className="btn full kai"
            disabled={!emailValid || kaiSending}
            onClick={handleKaiSend}
          >
            {kaiSending ? "KAI is sending…" : "KAI Sends Email"}
          </button>
        </form>
      </div>
      <style>{`
        .invite-modal {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1100;
        }
        .invite-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(15, 23, 42, 0.55);
        }
        .invite-panel {
          position: relative;
          background: #fff;
          border-radius: 16px;
          padding: 24px;
          max-width: 460px;
          width: 90%;
          box-shadow: 0 30px 80px rgba(15, 23, 42, 0.25);
        }
        .invite-panel h3 {
          margin: 0 0 4px;
          color: #111827;
        }
        .invite-panel .muted {
          margin: 0 0 16px;
        }
        .invite-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-weight: 600;
          color: #111827;
        }
        label input,
        label textarea {
          border: 1px solid #d1d5db;
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 1rem;
        }
        label textarea {
          resize: vertical;
        }
        .tone-row {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .tone-pills {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .pill {
          border: 1px solid #d1d5db;
          border-radius: 999px;
          padding: 4px 14px;
          background: #fff;
          font-weight: 600;
          cursor: pointer;
          color: #111827;
        }
    NEW
        .pill.active {
          background: #ffebeb;
          border-color: #ff5656;
          color: #c01f1f;
        }
        .draft-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .error-text {
          color: #b91c1c;
          font-size: 0.9rem;
          margin: 0;
        }
        .invite-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 8px;
        }
        .btn {
          border: 1px solid #d1d5db;
          border-radius: 999px;
          padding: 8px 18px;
          font-weight: 600;
          cursor: pointer;
        }
        .btn.primary {
          background: #ff5656;
          border-color: #ff5656;
          color: #fff;
        }
        .btn.secondary {
          background: #fff;
        }
        .btn.ghost {
          border-color: #cbd5f5;
          color: #455a7c;
          background: #f8fafc;
        }
        .btn.full {
          width: 100%;
          justify-content: center;
          margin-top: 4px;
        }
        .btn.kai {
          background: #111827;
          border-color: #111827;
          color: #fff;
        }
        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .suggestions {
          display: flex;
          flex-direction: column;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          margin-top: 6px;
          padding: 6px;
          background: #f9fafb;
          gap: 4px;
        }
        .suggestions button {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border: none;
          background: transparent;
          font-size: 0.95rem;
          cursor: pointer;
          padding: 4px 0;
        }
        .suggestions button small { color:#6b7280; margin-left:12px; }
      `}</style>
    </div>
  );
}
