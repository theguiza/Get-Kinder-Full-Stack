import React, { useEffect, useState } from "react";

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatCurrency = (cents = 0) => {
  const value = Number(cents) || 0;
  return `$${(value / 100).toFixed(0)}`;
};

const formatHours = (minutes = 0) => {
  const mins = Number(minutes);
  if (!Number.isFinite(mins)) return "0";
  return (Math.round((mins / 60) * 10) / 10).toFixed(1);
};

const formatDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
};

const formatMemberSince = (iso) => {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short" });
};

const TIER_LABELS = { casual: "Casual donor", impact: "Impact Donor", champion: "Champion Donor" };
const TIER_COLORS = { casual: "#6b7f9e", impact: "#455a7c", champion: "#ff5656" };
const DONATE_URL = "https://checkout.square.site/merchant/ML7WXHMB2XEJD/checkout/WBQKBZNKKR4Z5GRIZ42LCYFQ";

// ── Subcomponents ─────────────────────────────────────────────────────────────

function StatCard({ value, label, sublabel, color = "#ff5656" }) {
  return (
    <div style={styles.statCard}>
      <div style={{ ...styles.statValue, color }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
      {sublabel && <div style={styles.statSublabel}>{sublabel}</div>}
    </div>
  );
}

function MilestoneBar({ progressHours, targetHours }) {
  const pct = Math.min(100, Math.round((progressHours / targetHours) * 100));
  const remaining = Math.max(0, targetHours - progressHours);
  return (
    <div style={styles.milestoneBar}>
      <div style={styles.milestoneLeft}>
        <span style={styles.milestoneLead}>
          You've funded <strong>{progressHours}</strong> of <strong>{targetHours}</strong> verified hours
        </span>
        <div style={styles.progressTrack}>
          <div style={{ ...styles.progressFill, width: `${pct}%` }} />
        </div>
      </div>
      <div style={styles.milestoneRight}>
        {remaining > 0
          ? <><strong>{remaining} hours</strong> to go!</>
          : <strong>🎉 Milestone reached!</strong>
        }
      </div>
    </div>
  );
}

function TimelineCard({ item }) {
  const isFunded = item.status === "funded";
  const hours = item.minutes_verified != null ? formatHours(item.minutes_verified) : null;
  const donationDate = formatDate(item.donation_date || item.created_at);
  const amountLabel = item.amount_cents ? formatCurrency(item.amount_cents) : null;
  const eventLabel = item.event_title || `Donation #${item.donation_id}`;

  return (
    <div style={{ ...styles.timelineCard, borderLeftColor: isFunded ? "#2db36f" : "#f5a623" }}>
      <div style={styles.timelineTop}>
        <div style={styles.timelineTitle}>{eventLabel}</div>
        <span style={{ ...styles.statusBadge, background: isFunded ? "#eafaf2" : "#fff7ec", color: isFunded ? "#1a7f4b" : "#8c5a00", border: `1px solid ${isFunded ? "#b7e0c1" : "#ffd9a8"}` }}>
          {isFunded ? "Funded ✓" : "Pending"}
        </span>
      </div>
      <div style={styles.timelineMeta}>
        {donationDate} {amountLabel && <>· <strong>{amountLabel}</strong> donated</>}
      </div>
      <div style={styles.timelineStats}>
        {isFunded ? (
          <>
            <span>{hours} hrs verified</span>
            <span>·</span>
            <span>{item.credits_funded} IC funded</span>
            <span>·</span>
            <span style={{ color: "#2db36f", fontWeight: 700 }}>+{item.ic_earned} IC earned</span>
          </>
        ) : (
          <span style={{ color: "#8c5a00" }}>
            {hours != null ? `${hours} hrs estimated` : "Hours pending"} · Awaiting verification
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={styles.emptyWrap}>
      <div style={styles.emptyIcon}>
        <i className="fas fa-heart" style={{ color: "#fff", fontSize: 28 }} />
      </div>
      <h2 style={styles.emptyHeading}>Make your first donation</h2>
      <p style={styles.emptyText}>
        Your giving funds verified volunteer work in your community. You'll earn Impact Credits and see exactly where every dollar goes.
      </p>
      <div style={styles.previewRow}>
        <div style={styles.previewCard}>
          <div style={styles.previewValue}>5 hrs</div>
          <div style={styles.previewLabel}>verified volunteer hours</div>
        </div>
        <div style={styles.previewCard}>
          <div style={styles.previewValue}>250 IC</div>
          <div style={styles.previewLabel}>Impact Credits earned</div>
        </div>
        <div style={styles.previewCard}>
          <div style={styles.previewValue}>25 $K</div>
          <div style={styles.previewLabel}>$KINDER tokens (coming soon)</div>
        </div>
      </div>
      <p style={styles.previewNote}>Based on a $50 donation at 5 IC / $1</p>
      <a href={DONATE_URL} target="_blank" rel="noopener noreferrer" style={styles.ctaBtn}>
        Make an impact donation →
      </a>
      <div style={styles.emptyLinks}>
        <a href="/events" style={styles.emptyLink}>Browse events</a>
        <a href="/how-it-works" style={styles.emptyLink}>How it works</a>
        <span
          style={{ ...styles.emptyLink, cursor: "pointer" }}
          onClick={() => document.getElementById("gk-claim-section")?.scrollIntoView({ behavior: "smooth" })}
        >
          Claim a donation
        </span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DonorDashboard({ donorProfile = {} }) {
  const [summary, setSummary] = useState({ loading: true, error: null, data: null });
  const [receipts, setReceipts] = useState({ loading: true, error: null, items: [], hasMore: false, nextOffset: 0, limit: 25 });
  const [claimForm, setClaimForm] = useState({ donationId: "", paymentId: "", status: null, error: null, submitting: false });
  const [claimOpen, setClaimOpen] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);

  const loadSummary = async () => {
    setSummary((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch("/api/donor/summary", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.message || "Unable to load summary");
      setSummary({ loading: false, error: null, data: json.data || null });
    } catch (err) {
      setSummary({ loading: false, error: err?.message || "Unable to load summary", data: null });
    }
  };

  const loadReceipts = async ({ append = false, offsetOverride = null } = {}) => {
    setReceipts((r) => ({ ...r, loading: true, error: null }));
    const offset = offsetOverride != null ? offsetOverride : receipts.nextOffset || 0;
    const limit = 25;
    try {
      const res = await fetch(`/api/donor/receipts?limit=${limit}&offset=${offset}`, { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.message || "Unable to load receipts");
      const payload = json.data || {};
      const list = Array.isArray(payload.receipts) ? payload.receipts : [];
      setReceipts((r) => ({
        ...r,
        loading: false,
        error: null,
        items: append ? [...r.items, ...list] : list,
        hasMore: Boolean(payload.has_more),
        nextOffset: Number(payload.next_offset) || offset + limit,
        limit,
      }));
    } catch (err) {
      setReceipts((r) => ({ ...r, loading: false, error: err?.message || "Unable to load receipts" }));
    }
  };

  useEffect(() => {
    loadSummary();
    loadReceipts({ append: false, offsetOverride: 0 });
  }, []);

  const submitClaim = async () => {
    const body = {};
    if (claimForm.donationId.trim()) body.donation_id = Number(claimForm.donationId.trim());
    if (claimForm.paymentId.trim()) body.square_payment_id = claimForm.paymentId.trim();
    if (!body.donation_id && !body.square_payment_id) {
      setClaimForm((f) => ({ ...f, error: "Enter a donation ID or Square payment ID.", status: null }));
      return;
    }
    setClaimForm((f) => ({ ...f, submitting: true, error: null, status: null }));
    try {
      const res = await fetch("/api/donations/claim", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "claim_failed");
      setClaimForm({ donationId: "", paymentId: "", submitting: false, error: null, status: "Donation claimed successfully!" });
      loadSummary();
      loadReceipts({ append: false, offsetOverride: 0 });
    } catch (err) {
      setClaimForm((f) => ({ ...f, submitting: false, error: err.message || "Unable to claim", status: null }));
    }
  };

  // ── Derived values ──────────────────────────────────────────────────────────
  const d = summary.data || {};
  const hasHistory = !summary.loading && (Number(d.donation_count) || 0) > 0;
  const isEmpty = !summary.loading && !summary.error && (Number(d.donation_count) || 0) === 0;

  const donorFirstName = donorProfile.firstname || donorProfile.firstName || donorProfile.first_name || "";
  const donorLastName = donorProfile.lastname || donorProfile.lastName || donorProfile.last_name || "";
  const donorName = [donorFirstName, donorLastName].filter(Boolean).join(" ").trim() || donorProfile.name || "Donor";
  const donorEmail = donorProfile.email || "";
  const donorPicture = donorProfile.picture || donorProfile.avatar || null;
  const donorTier = d.donor_tier || donorProfile.donor_tier || "casual";
  const memberSince = d.member_since || donorProfile.member_since || null;
  const tierLabel = TIER_LABELS[donorTier] || "Casual donor";
  const tierColor = TIER_COLORS[donorTier] || "#6b7f9e";
  const initials = [donorFirstName[0], donorLastName[0]].filter(Boolean).join("").toUpperCase() || "?";

  const icRate = Number(d.ic_rate) || 5;
  const icBalance = Number(d.ic_balance) || 0;
  const kinderBalance = d.kinder_balance;
  const milestoneTarget = Number(d.milestone_target_hours) || 50;
  const milestoneProgress = Number(d.milestone_progress_hours) || 0;
  const donatedCents = Number(d.donated_cents_total) || 0;
  const hoursFunded = Number(d.milestone_progress_hours) || 0;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={styles.page}>

      {/* ── Profile Row ── */}
      <div style={styles.profileRow}>
        <div style={styles.avatarWrap}>
          {donorPicture
            ? <img src={donorPicture} alt={donorName} style={styles.avatarImg} />
            : <div style={styles.avatarInitials}>{initials}</div>
          }
        </div>
        <div style={styles.profileInfo}>
          <div style={styles.profileName}>{donorName}</div>
          <div style={styles.profileMeta}>
            <span style={{ color: tierColor, fontWeight: 600 }}>{tierLabel}</span>
            {memberSince && <span style={{ color: "#6b7f9e" }}> · Member since {formatMemberSince(memberSince)}</span>}
            {!memberSince && isEmpty && <span style={{ color: "#6b7f9e" }}> · Your impact journey starts here</span>}
          </div>
        </div>
        {donorTier === "casual" && (
          <>
            {/* GET /donor-subscribe intentionally disabled until subscription tiers launch. */}
            <button type="button" style={styles.upgradeChip} onClick={() => setUpgradeModalOpen(true)}>
              Upgrade to Impact Donor →
            </button>
          </>
        )}
      </div>

      {/* ── Empty State ── */}
      {isEmpty && <EmptyState />}

      {/* ── Populated State ── */}
      {hasHistory && (
        <>
          {/* Stat cards */}
          <div style={styles.statsRow}>
            <StatCard
              value={summary.loading ? "…" : formatCurrency(donatedCents)}
              label="Total donated"
              sublabel="Lifetime"
              color="#ff5656"
            />
            <StatCard
              value={summary.loading ? "…" : hoursFunded.toFixed(1)}
              label="Hours funded"
              sublabel="Verified volunteer hours"
              color="#455a7c"
            />
            <StatCard
              value={summary.loading ? "…" : icBalance.toLocaleString()}
              label="Your IC balance"
              sublabel={`Earning ${icRate} IC / $1`}
              color="#2db36f"
            />
            <StatCard
              value={kinderBalance != null ? kinderBalance.toLocaleString() : "—"}
              label="$KINDER tokens"
              sublabel="Coming soon"
              color="#f5a623"
            />
          </div>

          {/* Milestone bar */}
          <MilestoneBar progressHours={milestoneProgress} targetHours={milestoneTarget} />

          {/* Action buttons */}
          <div style={styles.actionsRow}>
            <a href={DONATE_URL} target="_blank" rel="noopener noreferrer" style={styles.btnPrimary}>
              Donate again
            </a>
            <button style={styles.btnOutline} disabled>
              Donate forward IC <span style={styles.comingSoon}>soon</span>
            </button>
            <button style={styles.btnOutline} disabled>
              Redeem $KINDER <span style={styles.comingSoon}>soon</span>
            </button>
          </div>

          {/* Impact timeline */}
          <div style={styles.timelineSection}>
            <div style={styles.sectionHead}>
              <div>
                <div style={styles.sectionLabel}>Impact Timeline</div>
                <div style={styles.sectionSub}>Your donation → event → verified volunteer hours. Volunteers remain anonymous.</div>
              </div>
              <button style={styles.btnSecondary} onClick={() => loadReceipts({ append: false, offsetOverride: 0 })} disabled={receipts.loading}>
                Refresh
              </button>
            </div>
            {receipts.loading && receipts.items.length === 0 && <div style={styles.muted}>Loading…</div>}
            {receipts.error && <div style={styles.alertBox}>{receipts.error}</div>}
            {!receipts.loading && !receipts.error && receipts.items.length === 0 && (
              <div style={styles.muted}>No receipts yet — receipts appear once your donation is attributed to a volunteer shift.</div>
            )}
            <div style={styles.timelineList}>
              {receipts.items.map((item) => (
                <TimelineCard key={item.id || item.donation_id} item={item} />
              ))}
            </div>
            {receipts.hasMore && !receipts.loading && (
              <button style={styles.btnSecondary} onClick={() => loadReceipts({ append: true, offsetOverride: receipts.nextOffset })}>
                Load more
              </button>
            )}
          </div>
        </>
      )}

      {/* ── Claim section (demoted, always visible) ── */}
      <div id="gk-claim-section" style={styles.claimRow}>
        <span
          style={styles.claimToggle}
          onClick={() => setClaimOpen((o) => !o)}
        >
          {claimOpen ? "▲" : "▼"} Claim a past donation? Enter donation ID →
        </span>
        <span style={styles.poweredBy}>Powered by Square</span>
      </div>

      {claimOpen && (
        <div style={styles.claimCard}>
          <div style={styles.claimForm}>
            <input
              style={styles.claimInput}
              type="text"
              placeholder="Donation ID"
              value={claimForm.donationId}
              onChange={(e) => setClaimForm((f) => ({ ...f, donationId: e.target.value }))}
            />
            <span style={{ color: "#6b7f9e" }}>or</span>
            <input
              style={styles.claimInput}
              type="text"
              placeholder="Square payment ID"
              value={claimForm.paymentId}
              onChange={(e) => setClaimForm((f) => ({ ...f, paymentId: e.target.value }))}
            />
            <button style={styles.btnPrimary} disabled={claimForm.submitting} onClick={submitClaim}>
              {claimForm.submitting ? "Claiming…" : "Claim"}
            </button>
          </div>
          {claimForm.error && <div style={styles.alertBox}>{claimForm.error}</div>}
          {claimForm.status && <div style={styles.successBox}>{claimForm.status}</div>}
        </div>
      )}

      {upgradeModalOpen && (
        <>
          <div
            className="modal fade show"
            style={styles.bootstrapModal}
            tabIndex="-1"
            aria-labelledby="donor-upgrade-title"
            aria-modal="true"
            role="dialog"
            onClick={(event) => {
              if (event.target === event.currentTarget) setUpgradeModalOpen(false);
            }}
          >
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content" style={styles.comingSoonModalContent}>
                <div className="modal-header" style={styles.comingSoonModalHeader}>
                  <div style={styles.comingSoonTitleWrap}>
                    <img src="/images/favicon.png" alt="Get Kinder logo" style={styles.comingSoonLogo} loading="lazy" />
                    <h5 className="modal-title" id="donor-upgrade-title" style={styles.comingSoonModalTitle}>Coming soon</h5>
                  </div>
                  <button type="button" className="btn-close" aria-label="Close" onClick={() => setUpgradeModalOpen(false)} />
                </div>
                <div className="modal-body" style={styles.comingSoonModalBody}>
                  Donation Subscription options will be available soon
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn" style={styles.comingSoonCloseButton} onClick={() => setUpgradeModalOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" />
        </>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  page: { maxWidth: 960, margin: "0 auto", padding: "24px 16px 64px", fontFamily: "inherit" },
  // Profile
  profileRow: { display: "flex", alignItems: "center", gap: 16, background: "#fff", border: "1px solid #e2dcd4", borderRadius: 16, padding: "20px 24px", marginBottom: 20 },
  avatarWrap: { flexShrink: 0 },
  avatarImg: { width: 64, height: 64, borderRadius: "50%", objectFit: "cover", border: "3px solid #455a7c" },
  avatarInitials: { width: 64, height: 64, borderRadius: "50%", background: "#455a7c", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, border: "3px solid #455a7c" },
  profileInfo: { flex: 1, minWidth: 0 },
  profileName: { fontSize: "1.4rem", fontWeight: 700, color: "#2a2a2a", marginBottom: 4 },
  profileMeta: { fontSize: "0.9rem" },
  upgradeChip: { flexShrink: 0, background: "#fff0f0", color: "#ff5656", border: "1px solid #ffb3b3", borderRadius: 999, padding: "6px 14px", fontSize: "0.85rem", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap", cursor: "pointer" },
  // Stats
  statsRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 },
  statCard: { background: "#fff", border: "1px solid #e2dcd4", borderRadius: 14, padding: "20px 16px", textAlign: "center" },
  statValue: { fontSize: "2rem", fontWeight: 700, lineHeight: 1.1, marginBottom: 4 },
  statLabel: { fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "#6b7f9e", marginBottom: 2 },
  statSublabel: { fontSize: "0.75rem", color: "#6b7f9e" },
  // Milestone
  milestoneBar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, background: "#eafaf2", border: "1px solid #b7e0c1", borderRadius: 12, padding: "14px 20px", marginBottom: 16 },
  milestoneLeft: { flex: 1 },
  milestoneLead: { fontSize: "0.9rem", color: "#1a7f4b", display: "block", marginBottom: 8 },
  progressTrack: { height: 8, background: "#c8f0d8", borderRadius: 999, overflow: "hidden" },
  progressFill: { height: "100%", background: "#2db36f", borderRadius: 999, transition: "width 0.6s ease" },
  milestoneRight: { fontSize: "0.9rem", color: "#1a7f4b", whiteSpace: "nowrap" },
  // Actions
  actionsRow: { display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" },
  btnPrimary: { background: "#ff5656", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, cursor: "pointer", textDecoration: "none", fontSize: "0.9rem" },
  btnOutline: { background: "#fff", color: "#455a7c", border: "1px solid #c7d0e4", borderRadius: 10, padding: "10px 20px", fontWeight: 600, cursor: "pointer", fontSize: "0.9rem", opacity: 0.7 },
  btnSecondary: { background: "#fff", color: "#455a7c", border: "1px solid #c7d0e4", borderRadius: 8, padding: "7px 14px", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" },
  comingSoon: { background: "#f0f4ff", color: "#455a7c", borderRadius: 999, padding: "1px 7px", fontSize: "0.72rem", fontWeight: 700, marginLeft: 6 },
  // Timeline
  timelineSection: { background: "#fff", border: "1px solid #e2dcd4", borderRadius: 14, padding: "20px", marginBottom: 20 },
  sectionHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  sectionLabel: { fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "#6b7f9e", marginBottom: 2, fontWeight: 600 },
  sectionSub: { fontSize: "0.85rem", color: "#6b7f9e" },
  timelineList: { display: "grid", gap: 10 },
  timelineCard: { borderLeft: "4px solid #2db36f", background: "#f7f3ed", borderRadius: "0 10px 10px 0", padding: "12px 16px", display: "grid", gap: 6 },
  timelineTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  timelineTitle: { fontWeight: 700, color: "#2a2a2a", fontSize: "0.95rem" },
  statusBadge: { borderRadius: 999, padding: "2px 10px", fontSize: "0.78rem", fontWeight: 700, whiteSpace: "nowrap" },
  timelineMeta: { fontSize: "0.82rem", color: "#6b7f9e" },
  timelineStats: { display: "flex", gap: 8, fontSize: "0.85rem", color: "#455a7c", flexWrap: "wrap" },
  muted: { color: "#6b7f9e", fontSize: "0.9rem", padding: "12px 0" },
  alertBox: { background: "#fff5f5", border: "1px solid #f2c6c6", color: "#7a1f1f", borderRadius: 8, padding: "10px 12px", fontSize: "0.875rem", marginTop: 8 },
  successBox: { background: "#f3fbf5", border: "1px solid #b7e0c1", color: "#2f6f3b", borderRadius: 8, padding: "10px 12px", fontSize: "0.875rem", marginTop: 8 },
  // Claim
  claimRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 4px", borderTop: "1px solid #e2dcd4", marginTop: 8 },
  claimToggle: { color: "#6b7f9e", fontSize: "0.85rem", cursor: "pointer", textDecoration: "underline" },
  poweredBy: { color: "#6b7f9e", fontSize: "0.78rem" },
  claimCard: { background: "#fff", border: "1px solid #e2dcd4", borderRadius: 12, padding: "16px", marginBottom: 16 },
  claimForm: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  claimInput: { padding: "8px 10px", border: "1px solid #c7d0e4", borderRadius: 8, minWidth: 160, fontSize: "0.875rem" },
  bootstrapModal: { display: "block" },
  comingSoonModalContent: { border: "1px solid #dfe8f5", borderRadius: 16 },
  comingSoonModalHeader: { borderBottom: "1px solid #e8eef7", alignItems: "center" },
  comingSoonTitleWrap: { display: "inline-flex", alignItems: "center", gap: "0.6rem" },
  comingSoonLogo: { width: 34, height: 34, borderRadius: 6, objectFit: "cover" },
  comingSoonModalTitle: { margin: 0, fontSize: "1.35rem", fontWeight: 700, color: "#ff5656", lineHeight: 1.2 },
  comingSoonModalBody: { color: "#455a7c", fontSize: "1rem" },
  comingSoonCloseButton: { background: "#ff5656", borderColor: "#ff5656", color: "#fff" },
  // Empty state
  emptyWrap: { background: "#fff", border: "1px solid #e2dcd4", borderRadius: 16, padding: "48px 32px", textAlign: "center", marginBottom: 24 },
  emptyIcon: { width: 64, height: 64, borderRadius: "50%", background: "#ff5656", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" },
  emptyHeading: { fontSize: "1.4rem", fontWeight: 700, color: "#2a2a2a", marginBottom: 12 },
  emptyText: { color: "#6b7f9e", maxWidth: 480, margin: "0 auto 28px", lineHeight: 1.6 },
  previewRow: { display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginBottom: 8 },
  previewCard: { background: "#f7f3ed", border: "1px solid #e2dcd4", borderRadius: 12, padding: "16px 20px", minWidth: 120 },
  previewValue: { fontSize: "1.4rem", fontWeight: 700, color: "#ff5656", marginBottom: 4 },
  previewLabel: { fontSize: "0.78rem", color: "#6b7f9e", textTransform: "uppercase", letterSpacing: "0.05em" },
  previewNote: { fontSize: "0.78rem", color: "#6b7f9e", marginBottom: 24 },
  ctaBtn: { display: "inline-block", background: "#ff5656", color: "#fff", borderRadius: 10, padding: "12px 28px", fontWeight: 700, textDecoration: "none", fontSize: "1rem", marginBottom: 24 },
  emptyLinks: { display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap" },
  emptyLink: { color: "#455a7c", fontSize: "0.875rem", textDecoration: "underline", cursor: "pointer" },
};
