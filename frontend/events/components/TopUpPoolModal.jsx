import React, { useEffect, useMemo, useState } from "react";

const MAX_TOPUP_CREDITS = 1_000_000;

const SOURCE_OPTIONS = [
  { value: "org_allocation", label: "Org allocation" },
  { value: "subscription", label: "Subscription" },
];

export function TopUpPoolModal({ open, poolSlug, onClose, onSubmit }) {
  const [amountInput, setAmountInput] = useState("100");
  const [source, setSource] = useState("org_allocation");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const normalizedPool = useMemo(
    () => (typeof poolSlug === "string" && poolSlug.trim() ? poolSlug.trim() : "general"),
    [poolSlug]
  );

  useEffect(() => {
    if (!open) return;
    setAmountInput("100");
    setSource("org_allocation");
    setError(null);
    setSubmitting(false);
  }, [open, normalizedPool]);

  if (!open) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const amount = Number(amountInput);
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_TOPUP_CREDITS) {
      setError(`Amount must be a whole number between 1 and ${MAX_TOPUP_CREDITS}.`);
      return;
    }

    if (!SOURCE_OPTIONS.some((item) => item.value === source)) {
      setError("Top-up source must be org allocation or subscription.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit?.({ amountCredits: amount, source });
      onClose?.();
    } catch (submitErr) {
      setError(submitErr?.message || "Unable to add pool credits.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="topup-modal" role="dialog" aria-modal="true" aria-label="Add pool credits">
      <button type="button" className="topup-backdrop" onClick={onClose} aria-label="Close dialog" />
      <div className="topup-panel">
        <h3>Add Credits</h3>
        <p className="muted">
          Funding Pool: <strong>{normalizedPool}</strong>
        </p>
        <form className="topup-form" onSubmit={handleSubmit}>
          <label>
            <span>Amount (credits)</span>
            <input
              type="number"
              min={1}
              max={MAX_TOPUP_CREDITS}
              step={1}
              inputMode="numeric"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              required
            />
          </label>
          <label>
            <span>Top-up Source</span>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          {error && <p className="error-text">{error}</p>}

          <div className="topup-actions">
            <button type="button" className="btn secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={submitting}>
              {submitting ? "Adding..." : "Add Credits"}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .topup-modal {
          position: fixed;
          inset: 0;
          z-index: 1200;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .topup-backdrop {
          position: absolute;
          inset: 0;
          border: 0;
          background: rgba(15, 23, 42, 0.46);
          cursor: pointer;
        }
        .topup-panel {
          position: relative;
          width: min(440px, 100%);
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 18px;
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.2);
        }
        .topup-panel h3 {
          margin: 0 0 6px;
          color: #0f172a;
        }
        .topup-panel .muted {
          margin: 0 0 14px;
          color: #64748b;
        }
        .topup-form {
          display: grid;
          gap: 12px;
        }
        .topup-form label {
          display: grid;
          gap: 6px;
        }
        .topup-form span {
          font-size: 0.9rem;
          color: #334155;
          font-weight: 600;
        }
        .topup-form input,
        .topup-form select {
          border: 1px solid #d1d5db;
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 0.95rem;
          background: #fff;
        }
        .error-text {
          margin: 0;
          color: #b91c1c;
          font-size: 0.9rem;
        }
        .topup-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 4px;
        }
      `}</style>
    </div>
  );
}

