import React, { useEffect, useState } from "react";
import { postJson } from "./kaiWebIntakeLogic.js";

const IMPACT_LIBRARY_KAI_PATH = "/api/kai/impact-library/message";

// Governed, single-turn Impact Evidence Library KAI surface. Each send is an
// independently authorized request scoped to the current organization and
// engagement selected on the page above - no conversationId is ever sent or
// stored, and no prior-turn history is reused: the server does not persist
// or resume these requests (see Backend/services/kai.js persistConversation).
export default function ImpactLibraryKai({ organizationId, engagementId }) {
  const [turns, setTurns] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Changing organization or engagement discards the displayed KAI
  // interaction state: no prior-context turn is ever shown against a
  // different organization/engagement.
  useEffect(() => {
    setTurns([]);
    setError("");
    setInput("");
  }, [organizationId, engagementId]);

  const ready = Boolean(organizationId) && Boolean(engagementId);

  const send = async () => {
    const message = input.trim();
    if (!message || !ready || sending) return;
    setSending(true);
    setError("");
    setInput("");
    setTurns((current) => [...current, { role: "user", text: message }]);
    const result = await postJson(IMPACT_LIBRARY_KAI_PATH, {
      message,
      organizationId,
      engagementId,
    });
    setSending(false);
    if (result.statusCode !== 200 || !result.body?.success) {
      setError(result.body?.error?.message || result.body?.error || "KAI is having trouble right now. Please try again.");
      return;
    }
    setTurns((current) => [...current, { role: "assistant", text: result.body.message }]);
  };

  return (
    <div className="admin-card mb-3">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h5 className="mb-0">Ask KAI about this Impact Evidence Library</h5>
      </div>
      {!ready ? (
        <div className="small text-muted">Select an organization and engagement above to use KAI here.</div>
      ) : (
        <>
          <div className="mb-2" style={{ maxHeight: "16rem", overflowY: "auto" }}>
            {turns.length === 0 ? (
              <div className="small text-muted">Ask about a claim, its traceability, or its audience eligibility.</div>
            ) : (
              turns.map((turn, index) => (
                <div key={index} className={`small mb-2 ${turn.role === "user" ? "text-end" : ""}`}>
                  <span className="text-muted">{turn.role === "user" ? "You" : "KAI"}: </span>
                  <span className="text-break">{turn.text}</span>
                </div>
              ))
            )}
          </div>
          {error ? <div className="alert alert-warning py-2 small">{error}</div> : null}
          <div className="d-flex gap-2">
            <input
              className="form-control form-control-sm"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Ask KAI about this organization's governed claims..."
              disabled={sending}
            />
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={send}
              disabled={sending || !input.trim()}
            >
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
