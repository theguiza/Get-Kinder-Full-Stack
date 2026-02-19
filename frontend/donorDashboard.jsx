import React, { useEffect, useState } from "react";

const formatCurrency = (cents = 0) => {
  const value = Number(cents) || 0;
  return `$${(value / 100).toFixed(2)}`;
};

const formatHours = (minutes = 0) => {
  const mins = Number(minutes);
  if (!Number.isFinite(mins)) return "—";
  return (Math.round((mins / 60) * 10) / 10).toFixed(1);
};

const shortId = (value) => {
  if (!value || typeof value !== "string") return "";
  return value.slice(0, 8);
};

const ReceiptRow = ({ row }) => {
  const dateLabel = row?.created_at ? new Date(row.created_at).toLocaleString() : "—";
  const eventLabel = row?.event_title || shortId(row?.event_id) || "Event";
  const hoursLabel = formatHours(row?.minutes_verified);
  const creditsLabel = Number(row?.credits_funded) || 0;
  const deficitLabel = Math.max(0, Number(row?.credits_deficit) || 0);

  return (
    <div className="receipt-row">
      <div className="receipt-main">
        <div className="receipt-title">{eventLabel}</div>
        <div className="receipt-sub">{dateLabel}</div>
      </div>
      <div className="receipt-meta">
        <div className="receipt-pill">
          <span className="pill-label">Hours</span>
          <span className="pill-value">{hoursLabel}</span>
        </div>
        <div className="receipt-pill">
          <span className="pill-label">Credits</span>
          <span className="pill-value">{creditsLabel}</span>
        </div>
        {deficitLabel > 0 && (
          <div className="receipt-pill warning">
            <span className="pill-label">Pending</span>
            <span className="pill-value">{deficitLabel}</span>
          </div>
        )}
      </div>
      <div className="receipt-ids">
        <div className="id-item">wallet_tx: {shortId(row?.wallet_tx_id) || "—"}</div>
        <div className="id-item">donation: {row?.donation_id ?? "—"}</div>
      </div>
      {deficitLabel > 0 && (
        <div className="receipt-deficit">
          Funded: {creditsLabel} credits · Pending: {deficitLabel} credits (auto-attributed when donations arrive)
        </div>
      )}
    </div>
  );
};

export default function DonorDashboard({ donorProfile = {} }) {
  const [summary, setSummary] = useState({ loading: true, error: null, data: null });
  const [receipts, setReceipts] = useState({
    loading: true,
    error: null,
    items: [],
    limit: 25,
    offset: 0,
    hasMore: false,
    nextOffset: 0,
  });
  const [claimForm, setClaimForm] = useState({ donationId: "", paymentId: "", status: null, error: null, submitting: false });

  const loadSummary = async () => {
    setSummary((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch("/api/donor/summary", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Unable to load summary");
      setSummary({ loading: false, error: null, data: json.data || null });
    } catch (err) {
      setSummary({ loading: false, error: err?.message || "Unable to load summary", data: null });
    }
  };

  const loadReceipts = async ({ append = false, offsetOverride = null } = {}) => {
    setReceipts((r) => ({ ...r, loading: true, error: null }));
    const offset = offsetOverride != null ? offsetOverride : receipts.nextOffset || 0;
    const limit = receipts.limit || 25;
    try {
      const res = await fetch(`/api/donor/receipts?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`, {
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Unable to load receipts");
      const payload = json.data || {};
      const list = Array.isArray(payload.receipts) ? payload.receipts : Array.isArray(payload.items) ? payload.items : [];
      const nextOffset = Number(payload.next_offset) || offset + limit;
      const hasMore = Boolean(payload.has_more);
      setReceipts((r) => ({
        ...r,
        loading: false,
        error: null,
        items: append ? [...(r.items || []), ...list] : list,
        offset,
        nextOffset,
        hasMore,
        limit,
      }));
    } catch (err) {
      setReceipts((r) => ({ ...r, loading: false, error: err?.message || "Unable to load receipts" }));
    }
  };

  const retryAll = () => {
    loadSummary();
    loadReceipts({ append: false, offsetOverride: 0 });
  };

  useEffect(() => {
    loadSummary();
    loadReceipts({ append: false, offsetOverride: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitClaim = async () => {
    const body = {};
    if (claimForm.donationId.trim()) {
      body.donation_id = Number(claimForm.donationId.trim());
    }
    if (claimForm.paymentId.trim()) {
      body.square_payment_id = claimForm.paymentId.trim();
    }
    if (!body.donation_id && !body.square_payment_id) {
      setClaimForm((f) => ({ ...f, error: "Enter a donation id or Square payment id.", status: null }));
      return;
    }
    setClaimForm((f) => ({ ...f, submitting: true, error: null, status: null }));
    try {
      const res = await fetch("/api/donations/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const code = json?.error || res.statusText || "claim_failed";
        throw new Error(code);
      }
      setClaimForm({ donationId: "", paymentId: "", submitting: false, error: null, status: "Claimed!" });
      loadSummary();
      loadReceipts({ append: false, offsetOverride: 0 });
    } catch (err) {
      setClaimForm((f) => ({ ...f, submitting: false, error: err.message || "Unable to claim", status: null }));
    }
  };

  const summaryData = summary.data || {};
  const pendingDeficit = Number(summaryData.pending_deficit_credits_total) || 0;
  const donorFirstName = donorProfile.firstname || donorProfile.firstName || donorProfile.first_name || "";
  const donorLastName = donorProfile.lastname || donorProfile.lastName || donorProfile.last_name || "";
  const donorDisplayName =
    [donorFirstName, donorLastName].filter(Boolean).join(" ").trim() ||
    donorProfile.name ||
    donorProfile.displayName ||
    "Donor";
  const donorEmail = donorProfile.email || "";
  const donorPicture = donorProfile.picture || donorProfile.avatar || donorProfile.photo || "/images/nerdy-KAI.png";

  return (
    <div className="donor-page">
      <div className="donor-hero">
        <div className="donor-hero-intro">
          <h1 className="page-title">Donor Dashboard</h1>
          <p className="page-sub">Track your giving and how it fuels volunteer impact. Volunteers stay anonymous.</p>
        </div>
        <div className="donor-hero-grid">
          <div className="hero-avatar-col">
            <img
              src={donorPicture}
              alt={`Profile photo of ${donorDisplayName}`}
              className="donor-avatar-ring rounded-circle"
              width={140}
              height={140}
            />
          </div>
          <div className="hero-profile-col">
            <h2 className="donor-name">{donorDisplayName}</h2>
            {donorEmail && <div className="donor-email">{donorEmail}</div>}
            <div className="donor-note">
              <i className="fas fa-heart" aria-hidden="true" /> Your giving powers verified impact.
            </div>
          </div>
          <div className="hero-stats-col">
            <div className="hero-stats-grid">
              <div className="hero-stat-item">
                <div className="hero-stat-value">
                  {summary.loading ? "Loading…" : summary.error ? "—" : formatCurrency(summaryData.donated_cents_total ?? summaryData.donated_lifetime_cents)}
                </div>
                <div className="hero-stat-label">Donated (lifetime)</div>
              </div>
              <div className="hero-stat-item">
                <div className="hero-stat-value">
                  {summary.loading ? "Loading…" : summary.error ? "—" : Number(summaryData.credits_funded_total ?? summaryData.credits_funded_lifetime) || 0}
                </div>
                <div className="hero-stat-label">Funded credits</div>
              </div>
              <div className="hero-stat-item">
                <div className="hero-stat-value">
                  {summary.loading
                    ? "Loading…"
                    : summary.error
                    ? "—"
                    : formatHours(summaryData.minutes_verified_total ?? summaryData.minutes_funded_lifetime)}
                </div>
                <div className="hero-stat-label">Funded hours</div>
              </div>
              <div className="hero-stat-item">
                <div className="hero-stat-value">
                  {summary.loading ? "Loading…" : summary.error ? "—" : Number(summaryData.remaining_pool_credits ?? summaryData.credits_unused_balance) || 0}
                </div>
                <div className="hero-stat-label">Remaining pool credits</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {pendingDeficit > 0 && (
        <div className="info-banner">
          <div className="info-dot" />
          <div>
            Some verified shifts are pending funding. New donations will be attributed automatically.
          </div>
          <div className="pill pending">
            Pending credits: {pendingDeficit}
          </div>
        </div>
      )}

      <div className="claim-card">
        <div>
          <div className="label">Claim existing donation</div>
          <div className="subtext">Attach a past donation to your account so it appears here.</div>
        </div>
        <div className="claim-form">
          <input
            type="text"
            placeholder="Donation ID"
            value={claimForm.donationId}
            onChange={(e) => setClaimForm((f) => ({ ...f, donationId: e.target.value }))}
          />
          <span className="muted">or</span>
          <input
            type="text"
            placeholder="Square payment ID"
            value={claimForm.paymentId}
            onChange={(e) => setClaimForm((f) => ({ ...f, paymentId: e.target.value }))}
          />
          <button className="btn" type="button" disabled={claimForm.submitting} onClick={submitClaim}>
            {claimForm.submitting ? "Claiming…" : "Claim"}
          </button>
        </div>
        {claimForm.error && <div className="alert compact">{claimForm.error}</div>}
        {claimForm.status && <div className="success compact">{claimForm.status}</div>}
      </div>

      {summary.error && (
        <div className="alert">
          <span>{summary.error}</span>
          <button type="button" className="btn" onClick={retryAll}>
            Retry
          </button>
        </div>
      )}

      <div className="receipts-section">
        <div className="section-head">
          <div>
            <div className="label">Receipts</div>
            <div className="subtext">Donation → event → funded hours (volunteers remain anonymous).</div>
          </div>
          <button type="button" className="btn secondary" onClick={() => loadReceipts({ append: false, offsetOverride: 0 })} disabled={receipts.loading}>
            Refresh
          </button>
        </div>

        {receipts.loading && receipts.items.length === 0 ? (
          <div className="muted">Loading receipts…</div>
        ) : receipts.error ? (
          <div className="alert">
            <span>{receipts.error}</span>
            <button type="button" className="btn" onClick={() => loadReceipts({ append: false, offsetOverride: 0 })}>
              Retry
            </button>
          </div>
        ) : receipts.items.length === 0 ? (
          <div className="muted">No receipts yet.</div>
        ) : (
          <div className="receipt-list">
            {receipts.items.map((row) => (
              <ReceiptRow key={`${row.id || row.wallet_tx_id || row.created_at}`} row={row} />
            ))}
          </div>
        )}

        {receipts.hasMore && !receipts.loading && (
          <button
            type="button"
            className="btn"
            onClick={() => loadReceipts({ append: true, offsetOverride: receipts.nextOffset })}
            disabled={receipts.loading}
          >
            Load more
          </button>
        )}
      </div>

      <style>{`
        .donor-page { max-width: 960px; margin: 0 auto; padding: 24px 16px 48px; }
        .page-title { margin: 0 0 4px; color: #455a7c; }
        .page-sub { margin: 0; color: #556; }
        .donor-hero { background: #fff; border: 1px solid #dfe8f5; border-radius: 18px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); padding: 20px; margin-bottom: 16px; }
        .donor-hero-intro { margin-bottom: 16px; }
        .donor-hero-grid { display: grid; gap: 20px; align-items: center; grid-template-columns: minmax(140px, 170px) minmax(200px, 1fr) minmax(280px, 360px); }
        .hero-avatar-col { text-align: center; }
        .donor-avatar-ring { border: 3px solid #455a7c; padding: 3px; object-fit: cover; background: #fff; }
        .donor-name { margin: 0 0 6px; color: #455a7c; font-size: 2rem; line-height: 1.1; font-weight: 700; }
        .donor-email { color: #556; margin-bottom: 8px; }
        .donor-note { color: #556; font-size: 0.95rem; display: flex; align-items: center; gap: 6px; }
        .donor-note i { color: #ff5656; }
        .hero-stats-grid { display: grid; grid-template-columns: repeat(2, minmax(120px, 1fr)); gap: 14px 22px; }
        .hero-stat-item { text-align: center; }
        .hero-stat-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #6c7a93; }
        .hero-stat-value { font-size: 2rem; font-weight: 700; color: #ff5656; line-height: 1.05; margin-bottom: 2px; }
        .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: #6c7a93; }
        .value { font-size: 22px; font-weight: 700; color: #233048; margin-top: 4px; }
        .alert { margin: 12px 0; padding: 10px 12px; border-radius: 10px; border: 1px solid #f2c6c6; background: #fff5f5; color: #7a1f1f; display: flex; align-items: center; gap: 10px; justify-content: space-between; }
        .btn { background: #455a7c; color: #fff; border: none; border-radius: 8px; padding: 8px 12px; font-weight: 600; cursor: pointer; }
        .btn.secondary { background: #fff; color: #455a7c; border: 1px solid #c7d0e4; }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .receipts-section { margin-top: 20px; background: #fff; border: 1px solid #e6e9f2; border-radius: 12px; padding: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
        .section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
        .subtext { color: #6c7a93; font-size: 13px; }
        .muted { color: #6c7a93; font-size: 14px; }
        .receipt-list { display: grid; gap: 10px; }
        .receipt-row { border: 1px solid #e6e9f2; border-radius: 10px; padding: 10px 12px; background: #f8fafc; display: grid; gap: 6px; }
        .receipt-title { font-weight: 700; color: #233048; }
        .receipt-sub { color: #6c7a93; font-size: 13px; }
        .receipt-meta { display: flex; gap: 8px; flex-wrap: wrap; }
        .receipt-pill { background: #fff; border: 1px solid #dde3f0; border-radius: 8px; padding: 6px 8px; display: inline-flex; gap: 6px; align-items: center; }
        .receipt-pill.warning { background: #fff7ec; border-color: #ffd9a8; color: #8c5a00; }
        .pill-label { color: #6c7a93; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
        .pill-value { font-weight: 700; color: #233048; }
        .receipt-ids { color: #6c7a93; font-size: 12px; display: flex; gap: 10px; flex-wrap: wrap; }
        .receipt-deficit { color: #8c5a00; font-size: 13px; background: #fff7ec; border: 1px dashed #ffd9a8; border-radius: 8px; padding: 6px 8px; }
        .info-banner { display: flex; align-items: center; gap: 10px; background: #f0f4ff; border: 1px solid #c7d0e4; color: #233048; padding: 10px 12px; border-radius: 10px; margin-bottom: 12px; flex-wrap: wrap; }
        .info-dot { width: 10px; height: 10px; border-radius: 50%; background: #5b7cff; box-shadow: 0 0 0 4px rgba(91,124,255,0.12); }
        .pill.pending { background: #fff; color: #233048; border: 1px solid #c7d0e4; border-radius: 999px; padding: 4px 10px; font-size: 13px; }
        .claim-card { margin: 14px 0; padding: 12px; border: 1px solid #e6e9f2; border-radius: 12px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.04); display: grid; gap: 8px; }
        .claim-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .claim-form input { padding: 8px 10px; border: 1px solid #c7d0e4; border-radius: 8px; min-width: 160px; }
        .alert.compact, .success.compact { padding: 8px 10px; border-radius: 8px; font-size: 13px; }
        .success { border: 1px solid #b7e0c1; background: #f3fbf5; color: #2f6f3b; }
        @media (max-width: 991.98px) {
          .donor-hero-grid { grid-template-columns: 1fr; text-align: center; }
          .donor-note { justify-content: center; }
          .hero-stats-grid { max-width: 460px; margin: 0 auto; }
        }
        @media (max-width: 575.98px) {
          .donor-hero { padding: 16px; }
          .donor-name { font-size: 1.6rem; }
          .hero-stats-grid { gap: 12px; }
          .hero-stat-value { font-size: 1.6rem; }
        }
      `}</style>
    </div>
  );
}
