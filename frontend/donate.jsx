import React, { useState } from "react";

const DEFAULT_AMOUNTS = [2000, 5000, 10000];

const formatCurrency = (cents) => `$${((Number(cents) || 0) / 100).toFixed(2)}`;

export default function DonatePage() {
  const [paymentId, setPaymentId] = useState("");
  const [poolSlug, setPoolSlug] = useState("general");
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [selectedAmount, setSelectedAmount] = useState(DEFAULT_AMOUNTS[0]);

  const handleConfirm = async () => {
    if (!paymentId.trim()) {
      setStatus({ state: "error", message: "Enter the Square payment ID after completing checkout." });
      return;
    }
    setStatus({ state: "loading", message: "Confirming payment…" });
    try {
      const res = await fetch("/api/donations/square/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          square_payment_id: paymentId.trim(),
          pool_slug: poolSlug || "general",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Unable to confirm payment.");
      const credits = json?.data?.credits_added ?? "?";
      setStatus({ state: "success", message: `Thanks! Credited ${credits} Impact Credits.` });
    } catch (err) {
      setStatus({ state: "error", message: err?.message || "Unable to confirm payment." });
    }
  };

  return (
    <div className="donate-page">
      <h1 className="title">Donate to fuel Impact Credits</h1>
      <p className="sub">Complete your Square checkout, then paste the payment ID here to credit your account.</p>

      <div className="card">
        <div className="label">1) Choose an amount on Square</div>
        <div className="pill-row">
          {DEFAULT_AMOUNTS.map((amt) => (
            <button
              key={amt}
              type="button"
              className={`pill ${selectedAmount === amt ? "active" : ""}`}
              onClick={() => setSelectedAmount(amt)}
            >
              {formatCurrency(amt)}
            </button>
          ))}
        </div>
        <p className="muted">Use the Donate button to open Square checkout (opens in new tab).</p>
        <a
          className="btn primary"
          href="https://square.link/u/GjQpbcoi"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Square Checkout
        </a>
      </div>

      <div className="card">
        <div className="label">2) Paste Square payment ID</div>
        <input
          type="text"
          className="input"
          placeholder="Payment ID (e.g., VZY9E... )"
          value={paymentId}
          onChange={(e) => setPaymentId(e.target.value)}
        />
        <div className="label">Pool</div>
        <input
          type="text"
          className="input"
          value={poolSlug}
          onChange={(e) => setPoolSlug(e.target.value || "general")}
        />
        <button type="button" className="btn primary" onClick={handleConfirm} disabled={status.state === "loading"}>
          {status.state === "loading" ? "Confirming…" : "Confirm Donation"}
        </button>
        {status.message && (
          <div className={`status ${status.state}`}>
            {status.message}
          </div>
        )}
      </div>

      <p className="muted">Tip: After confirmation, visit your Donor Dashboard to see updated totals.</p>

      <style>{`
        .donate-page { --kinder-coral: #ff5656; }
        .donate-page { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; color: #233048; }
        .title { margin: 0 0 6px; color: #455a7c; }
        .sub { margin: 0 0 18px; color: #556; }
        .card { background: #fff; border: 1px solid #e6e9f2; border-radius: 12px; padding: 14px; margin-bottom: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
        .label { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #6c7a93; margin-bottom: 6px; }
        .pill-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
        .pill { border: 1px solid #c7d0e4; background: #fff; color: #233048; border-radius: 999px; padding: 8px 12px; cursor: pointer; font-weight: 600; }
        .pill.active { background: var(--kinder-coral); color: #fff; border-color: var(--kinder-coral); }
        .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: none; border-radius: 10px; padding: 10px 14px; font-weight: 700; cursor: pointer; text-decoration: none; }
        .btn.primary { background: var(--kinder-coral); color: #fff; }
        .btn.primary:hover { filter: brightness(0.96); }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .input { width: 100%; border: 1px solid #d6ddea; border-radius: 10px; padding: 10px; margin: 6px 0 10px; }
        .muted { color: #6c7a93; font-size: 13px; }
        .status { margin-top: 8px; padding: 8px 10px; border-radius: 10px; }
        .status.success { background: #e7f6ec; color: #1d6b3a; border: 1px solid #c4e3ce; }
        .status.error { background: #fff5f5; color: #7a1f1f; border: 1px solid #f2c6c6; }
        .status.loading { background: #f6f8fb; color: #455a7c; border: 1px solid #d6ddea; }
      `}</style>
    </div>
  );
}
