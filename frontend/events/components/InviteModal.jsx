import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const TONES = [
  { value: "friendly", label: "Friendly" },
  { value: "hype", label: "High-energy" },
  { value: "thoughtful", label: "Thoughtful" },
];

const APPROVAL_REQUIRED_MESSAGE = "You can send this message after you have been approved";

export function InviteModal({ open, onClose, eventId, eventTitle, onSent }) {
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [inviteeName, setInviteeName] = useState("");
  const [tone, setTone] = useState("friendly");
  const [subjectPreview, setSubjectPreview] = useState("");
  const [messagePreview, setMessagePreview] = useState("");
  const [senderLabel, setSenderLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [kaiSending, setKaiSending] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
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
    setSubjectPreview("");
    setMessagePreview("");
    setSenderLabel("");
  }, [open, eventTitle]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPreviewLoading(true);
    setError(null);

    fetch(`/api/events/${eventId}/invite-copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tone }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) {
          const err = new Error(json?.error || "Unable to draft copy");
          err.code = json?.code;
          throw err;
        }
        if (!alive) return;
        setSubjectPreview(json.data?.subject || "");
        setMessagePreview((json.data?.body || "").trim());
        const senderName = typeof json.data?.sender_name === "string" ? json.data.sender_name.trim() : "";
        const senderEmail = typeof json.data?.sender_email === "string" ? json.data.sender_email.trim() : "";
        const label = senderEmail ? `${senderName || "A friend"} (${senderEmail})` : senderName;
        setSenderLabel(label);
      })
      .catch((err) => {
        if (!alive) return;
        if (err?.code === "INVITE_APPROVAL_REQUIRED") {
          window.alert(APPROVAL_REQUIRED_MESSAGE);
        }
        setError(err.message || "Unable to draft copy");
      })
      .finally(() => {
        if (alive) setPreviewLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [open, tone, eventId]);

  if (!open) return null;

  function buildPayload(sendByKai = false) {
    return {
      invitee_email: inviteeEmail.trim(),
      invitee_name: inviteeName.trim(),
      tone,
      send_by_kai: sendByKai,
    };
  }

  async function handleInvite(sendByKai = false) {
    if (!emailValid || submitting || kaiSending) return;
    setError(null);
    if (sendByKai) {
      setKaiSending(true);
    } else {
      setSubmitting(true);
    }
    try {
      const res = await fetch(`/api/events/${eventId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(sendByKai)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const err = new Error(json?.error || "Unable to send invite");
        err.code = json?.code;
        throw err;
      }
      resetFields();
      window.dispatchEvent(new CustomEvent("gk:invite-sent", { detail: json.data }));
      onSent?.(json.data);
    } catch (err) {
      if (err?.code === "INVITE_APPROVAL_REQUIRED") {
        window.alert(APPROVAL_REQUIRED_MESSAGE);
      }
      setError(err.message || "Unable to send invite");
    } finally {
      if (sendByKai) {
        setKaiSending(false);
      } else {
        setSubmitting(false);
      }
    }
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    await handleInvite(false);
  }

  function resetFields() {
    setInviteeEmail("");
    setInviteeName("");
  }

  const modalMarkup = (
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

          <div className="locked-note">
            Message content is fixed by tone for safety and moderation.
          </div>

          <div className="preview-group" aria-live="polite">
            <div className="preview-field">
              <span>Subject</span>
              <div className="preview-box">{previewLoading ? "Generating…" : subjectPreview || "-"}</div>
            </div>
            <div className="preview-field">
              <span>Message</span>
              <div className="preview-box multiline">{previewLoading ? "Generating…" : messagePreview || "-"}</div>
            </div>
            {!!senderLabel && (
              <p className="preview-sender">Sender: {senderLabel}</p>
            )}
          </div>

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
            onClick={() => handleInvite(true)}
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
          z-index: 2000;
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
          max-width: 520px;
          width: 92%;
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
        label input {
          border: 1px solid #d1d5db;
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 1rem;
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
        .pill.active {
          background: #ffebeb;
          border-color: #ff5656;
          color: #c01f1f;
        }
        .locked-note {
          font-size: 0.85rem;
          color: #4b5563;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 8px 10px;
          background: #f8fafc;
        }
        .preview-group {
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          background: #fff;
        }
        .preview-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .preview-field > span {
          font-weight: 600;
          color: #111827;
        }
        .preview-box {
          border: 1px solid #d1d5db;
          border-radius: 10px;
          padding: 10px 12px;
          background: #f9fafb;
          color: #111827;
          min-height: 44px;
        }
        .preview-box.multiline {
          white-space: pre-wrap;
          min-height: 96px;
        }
        .preview-sender {
          margin: 0;
          font-size: 0.85rem;
          color: #475569;
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

  if (typeof document === "undefined" || !document.body) {
    return modalMarkup;
  }
  return createPortal(modalMarkup, document.body);
}
