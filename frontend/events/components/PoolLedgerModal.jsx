import React, { useEffect, useState } from "react";

const PAGE_SIZE = 25;
const ALL_POOLS_FILTER = "all";
const ALL_REASONS_FILTER = "all";

export function PoolLedgerModal({ open, initialPoolSlug = ALL_POOLS_FILTER, onClose }) {
  const [poolSlug, setPoolSlug] = useState(ALL_POOLS_FILTER);
  const [reasonFilter, setReasonFilter] = useState(ALL_REASONS_FILTER);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [poolOptions, setPoolOptions] = useState([ALL_POOLS_FILTER, "general"]);
  const [reasonOptions, setReasonOptions] = useState([{ value: ALL_REASONS_FILTER, label: "All Reasons" }]);

  useEffect(() => {
    if (!open) return;
    const nextPool =
      typeof initialPoolSlug === "string" && initialPoolSlug.trim()
        ? initialPoolSlug.trim().toLowerCase()
        : ALL_POOLS_FILTER;
    setPoolSlug(nextPool);
    setReasonFilter(ALL_REASONS_FILTER);
    setItems([]);
    setOffset(0);
    setHasMore(false);
    setError(null);
  }, [open, initialPoolSlug]);

  useEffect(() => {
    if (!open) return;
    loadTransactions(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, poolSlug, reasonFilter]);

  if (!open) return null;

  async function loadTransactions(append) {
    setLoading(true);
    if (!append) setError(null);
    const nextOffset = append ? offset : 0;
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(nextOffset),
      });
      if (poolSlug && poolSlug !== ALL_POOLS_FILTER) {
        params.set("pool_slug", poolSlug);
      }
      if (reasonFilter && reasonFilter !== ALL_REASONS_FILTER) {
        params.set("reason", reasonFilter);
      }

      const res = await fetch(`/api/me/events/pools/transactions?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Unable to load pool ledger");
      }

      const nextItems = Array.isArray(json?.data?.items) ? json.data.items : [];
      const options = Array.isArray(json?.data?.pool_options) ? json.data.pool_options : [];
      const reasonChoices = Array.isArray(json?.data?.reason_options) ? json.data.reason_options : [];

      const mergedPoolOptions = Array.from(
        new Set([ALL_POOLS_FILTER, "general", ...options.map((item) => String(item || "").trim()).filter(Boolean)])
      );
      if (poolSlug !== ALL_POOLS_FILTER && !mergedPoolOptions.includes(poolSlug)) {
        mergedPoolOptions.push(poolSlug);
      }
      setPoolOptions(mergedPoolOptions);
      setReasonOptions(
        reasonChoices.length
          ? reasonChoices
          : [{ value: ALL_REASONS_FILTER, label: "All Reasons" }]
      );

      setItems((prev) => (append ? [...prev, ...nextItems] : nextItems));
      setOffset(Number(json?.paging?.next_offset) || nextOffset + nextItems.length);
      setHasMore(Boolean(json?.paging?.has_more));
    } catch (err) {
      console.error("load pool transactions failed:", err);
      setError(err.message || "Unable to load pool ledger");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ledger-modal" role="dialog" aria-modal="true" aria-label="Pool Ledger">
      <button type="button" className="ledger-backdrop" onClick={onClose} aria-label="Close ledger" />
      <div className="ledger-panel">
        <header className="ledger-header">
          <div>
            <h3>Pool Ledger</h3>
            <p className="muted">Track exactly why pool balances changed.</p>
          </div>
          <button type="button" className="btn secondary" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="ledger-filters">
          <label>
            <span>Funding Pool</span>
            <select value={poolSlug} onChange={(e) => setPoolSlug(e.target.value || ALL_POOLS_FILTER)}>
              {poolOptions.map((value) => (
                <option key={value} value={value}>
                  {value === ALL_POOLS_FILTER ? "All pools" : value}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Reason</span>
            <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value || ALL_REASONS_FILTER)}>
              {reasonOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <div className="ledger-error">{error}</div>
        )}

        {!loading && !items.length ? (
          <div className="ledger-empty muted">No pool transactions found for this filter.</div>
        ) : (
          <div className="ledger-list">
            {items.map((tx) => {
              const amount = Number(tx.amount_credits) || 0;
              const isCredit = tx.direction === "credit";
              const signed = `${isCredit ? "+" : "-"}${amount}`;
              return (
                <div className="ledger-item" key={tx.id || `${tx.created_at}-${tx.wallet_tx_id || tx.event_id || amount}`}>
                  <div className="ledger-top">
                    <span className={`amount ${isCredit ? "credit" : "debit"}`}>{signed}</span>
                    <span className="reason">{tx.reason_label || tx.reason}</span>
                    <span className="time">{formatDateTime(tx.created_at)}</span>
                  </div>
                  <div className="ledger-meta">
                    <span>Pool: <strong>{tx.funding_pool_slug || "general"}</strong></span>
                    {tx.event_title && <span>Event: <strong>{tx.event_title}</strong></span>}
                    {tx.donation_id && (
                      <span>
                        Donation #{tx.donation_id}
                        {tx.donation_amount_cents != null
                          ? ` (${formatMoney(tx.donation_amount_cents, tx.donation_currency)})`
                          : ""}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="ledger-actions">
          <button type="button" className="btn secondary" onClick={() => loadTransactions(false)} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          {hasMore && (
            <button type="button" className="btn secondary" onClick={() => loadTransactions(true)} disabled={loading}>
              {loading ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      </div>

      <style>{`
        .ledger-modal {
          position: fixed;
          inset: 0;
          z-index: 1150;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .ledger-backdrop {
          position: absolute;
          inset: 0;
          border: 0;
          background: rgba(15, 23, 42, 0.5);
          cursor: pointer;
        }
        .ledger-panel {
          position: relative;
          width: min(760px, 100%);
          max-height: min(86vh, 900px);
          overflow: auto;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 18px;
          box-shadow: 0 24px 56px rgba(15, 23, 42, 0.24);
        }
        .ledger-header {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          margin-bottom: 14px;
          flex-wrap: wrap;
        }
        .ledger-header h3 {
          margin: 0;
          color: #0f172a;
        }
        .ledger-header .muted {
          margin: 2px 0 0;
          color: #64748b;
        }
        .ledger-filters {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 10px;
          margin-bottom: 12px;
        }
        .ledger-filters label {
          display: grid;
          gap: 6px;
        }
        .ledger-filters span {
          font-size: 0.85rem;
          font-weight: 600;
          color: #334155;
        }
        .ledger-filters select {
          border: 1px solid #d1d5db;
          border-radius: 10px;
          padding: 8px 10px;
          background: #fff;
        }
        .ledger-error {
          border: 1px solid #fecaca;
          background: #fef2f2;
          color: #991b1b;
          border-radius: 10px;
          padding: 8px 10px;
          margin-bottom: 10px;
        }
        .ledger-empty {
          border: 1px dashed #cbd5e1;
          border-radius: 12px;
          padding: 18px;
          text-align: center;
        }
        .ledger-list {
          display: grid;
          gap: 10px;
        }
        .ledger-item {
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 10px 12px;
          background: #f8fafc;
        }
        .ledger-top {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .amount {
          font-weight: 700;
          font-size: 1rem;
        }
        .amount.credit {
          color: #166534;
        }
        .amount.debit {
          color: #b91c1c;
        }
        .reason {
          font-weight: 600;
          color: #0f172a;
        }
        .time {
          margin-left: auto;
          color: #64748b;
          font-size: 0.85rem;
        }
        .ledger-meta {
          margin-top: 6px;
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          color: #475569;
          font-size: 0.9rem;
        }
        .ledger-actions {
          margin-top: 12px;
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
      `}</style>
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return "Unknown time";
  try {
    const date = new Date(value);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "Unknown time";
  }
}

function formatMoney(amountCents, currency = "CAD") {
  const cents = Number(amountCents);
  if (!Number.isFinite(cents)) return `${currency} 0.00`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "CAD",
  }).format(cents / 100);
}

