import React, { useEffect, useMemo, useState } from "react";

const BRAND_VARS = `
  :root { --ink:#455a7c; --coral:#ff5656; --mist:#b5bdcb; --canvas:#f4f4f4; }
`;

const SKILL_MAP = {
  cleanup: ["Stewardship", "Safety"],
  food: ["Food Service", "Teamwork"],
  outreach: ["Guest Support", "De-escalation"],
  support: ["Community Support", "Reliability"],
  default: ["Community Service"],
};

const STATUS_TONES = {
  approved: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  awaiting: "bg-amber-50 text-amber-700 border border-amber-200",
  finished: "bg-slate-100 text-slate-600 border border-slate-200",
  neutral: "bg-slate-50 text-slate-600 border border-slate-200",
};

function formatDateRange(startAt, endAt, tz) {
  if (!startAt) return "Date TBA";
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return "Date TBA";
  const end = endAt ? new Date(endAt) : null;
  const opts = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  const startStr = start.toLocaleString(undefined, { ...opts, timeZone: tz || undefined });
  if (!end || Number.isNaN(end.getTime())) return startStr;
  const sameDay = start.toDateString() === end.toDateString();
  const endOpts = sameDay ? { hour: "numeric", minute: "2-digit" } : opts;
  const endStr = end.toLocaleString(undefined, { ...endOpts, timeZone: tz || undefined });
  return sameDay ? `${startStr} – ${endStr}` : `${startStr} → ${endStr}`;
}

function buildBullets(evt) {
  const bullets = [];
  const start = evt?.start_at ? new Date(evt.start_at) : null;
  if (start && !Number.isNaN(start.getTime())) {
    const diffDays = (start.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    bullets.push(diffDays <= 7 ? "Happening soon" : "Upcoming");
  } else {
    bullets.push("Upcoming");
  }
  if (evt?.category) {
    bullets.push(`Matches your interests: ${evt.category}`);
  } else {
    bullets.push("Community service");
  }
  bullets.push(evt?.capacity ? "Spots available" : "Open sign-ups");
  return bullets;
}

function mapSkills(category) {
  if (!category) return SKILL_MAP.default;
  const key = category.toLowerCase();
  if (key.includes("clean")) return SKILL_MAP.cleanup;
  if (key.includes("food")) return SKILL_MAP.food;
  if (key.includes("outreach")) return SKILL_MAP.outreach;
  if (key.includes("support")) return SKILL_MAP.support;
  return SKILL_MAP.default;
}

function pickNextBest(events, dismissedIds = new Set()) {
  const now = Date.now();
  const eligible = (events || [])
    .filter((evt) => {
      if (!evt || dismissedIds.has(String(evt.id))) return false;
      if (evt.status !== "published") return false;
      const start = evt.start_at ? new Date(evt.start_at).getTime() : null;
      if (!start || Number.isNaN(start) || start <= now) return false;
      const accepted = Number(evt?.rsvp_counts?.accepted) || 0;
      const cap = evt?.capacity != null ? Number(evt.capacity) : null;
      return cap == null || accepted < cap;
    })
    .sort((a, b) => {
      const aStart = a.start_at ? new Date(a.start_at).getTime() : Infinity;
      const bStart = b.start_at ? new Date(b.start_at).getTime() : Infinity;
      return aStart - bStart;
    });
  return eligible[0] || null;
}

function statusPill(eventDetail, baseEvent) {
  if (!baseEvent) return { label: "Not requested", tone: "neutral" };
  if (baseEvent.status === "completed") return { label: "Finished", tone: "finished" };
  const viewerStatus = eventDetail?.viewer_rsvp_status;
  if (viewerStatus === "accepted" || viewerStatus === "checked_in") {
    return { label: "Pending Approval", tone: "approved" };
  }
  if (viewerStatus === "interested" || viewerStatus === "waitlisted") {
    return { label: "Awaiting approval", tone: "awaiting" };
  }
  return { label: "Not requested", tone: "neutral" };
}

function estimateKind(detail) {
  const rewardPool = Number(detail?.reward_pool_kind) || 0;
  const accepted = Number(detail?.rsvp_counts?.accepted) || 0;
  const capacity = detail?.capacity != null ? Number(detail.capacity) : null;
  const denom = Math.max(1, capacity || accepted || 1);
  return Math.floor(rewardPool / denom);
}

export default function ImpactHero(props = {}) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [portfolioDetails, setPortfolioDetails] = useState({});
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dismissedIds, setDismissedIds] = useState(() => new Set());
  const [joinLoading, setJoinLoading] = useState(false);
  const [walletSummary, setWalletSummary] = useState(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState(null);
  const [donationAmount, setDonationAmount] = useState(25);
  const [donationStatus, setDonationStatus] = useState("idle");
  const [donationMessage, setDonationMessage] = useState("");
  const [donationNeedsMore, setDonationNeedsMore] = useState(false);
  const [redeemStatus, setRedeemStatus] = useState({ state: "idle", message: "", slug: null });
  const [offers, setOffers] = useState([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [offersError, setOffersError] = useState(null);
  const [redemptionHistory, setRedemptionHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const [ratingsSummary, setRatingsSummary] = useState(null);
  const [ratingsLoading, setRatingsLoading] = useState(true);
  const [ratingsError, setRatingsError] = useState(null);

  const userName = props.userName || null;

  const loadWalletSummary = ({ allowUpdate = () => true } = {}) => {
    setWalletLoading(true);
    setWalletError(null);
    fetch("/api/wallet/summary", { credentials: "include" })
      .then((res) => res.json().catch(() => ({})).then((json) => ({ ok: res.ok, json })))
      .then((payload) => {
        if (!allowUpdate()) return;
        if (!payload?.ok || !payload?.json?.ok) {
          throw new Error(payload?.json?.error || "Unable to load wallet summary");
        }
        setWalletSummary(payload?.json?.data || null);
      })
      .catch((err) => {
        if (!allowUpdate()) return;
        setWalletError(err?.message || "Unable to load wallet summary");
        setWalletSummary(null);
      })
      .finally(() => {
        if (allowUpdate()) setWalletLoading(false);
      });
  };

  const loadRatingsSummary = ({ allowUpdate = () => true } = {}) => {
    setRatingsLoading(true);
    setRatingsError(null);
    fetch("/api/ratings/summary", { credentials: "include" })
      .then((res) => res.json().catch(() => ({})).then((json) => ({ ok: res.ok, json })))
      .then((payload) => {
        if (!allowUpdate()) return;
        if (!payload?.ok || !payload?.json?.ok) {
          throw new Error(payload?.json?.message || payload?.json?.error || "Unable to load ratings summary");
        }
        setRatingsSummary(payload?.json?.data || null);
      })
      .catch((err) => {
        if (!allowUpdate()) return;
        setRatingsError(err?.message || "Unable to load ratings summary");
        setRatingsSummary(null);
      })
      .finally(() => {
        if (allowUpdate()) setRatingsLoading(false);
      });
  };

  const loadOffers = ({ allowUpdate = () => true } = {}) => {
    setOffersLoading(true);
    setOffersError(null);
    fetch("/api/redemptions/offers", { credentials: "include" })
      .then((res) => res.json().catch(() => ({})).then((json) => ({ ok: res.ok, json })))
      .then((payload) => {
        if (!allowUpdate()) return;
        if (!payload?.ok || !payload?.json?.ok) {
          throw new Error(payload?.json?.message || "Unable to load offers");
        }
        setOffers(Array.isArray(payload?.json?.data?.offers) ? payload.json.data.offers : []);
      })
      .catch((err) => {
        if (!allowUpdate()) return;
        setOffersError(err?.message || "Unable to load offers");
        setOffers([]);
      })
      .finally(() => {
        if (allowUpdate()) setOffersLoading(false);
      });
  };

  const loadRedemptionHistory = ({ allowUpdate = () => true, limit = 5 } = {}) => {
    setHistoryLoading(true);
    setHistoryError(null);
    fetch(`/api/redemptions/history?limit=${encodeURIComponent(limit)}`, { credentials: "include" })
      .then((res) => res.json().catch(() => ({})).then((json) => ({ ok: res.ok, json })))
      .then((payload) => {
        if (!allowUpdate()) return;
        if (!payload?.ok || !payload?.json?.ok) {
          throw new Error(payload?.json?.message || "Unable to load redemption history");
        }
        setRedemptionHistory(Array.isArray(payload?.json?.data?.items) ? payload.json.data.items : []);
      })
      .catch((err) => {
        if (!allowUpdate()) return;
        setHistoryError(err?.message || "Unable to load redemption history");
        setRedemptionHistory([]);
      })
      .finally(() => {
        if (allowUpdate()) setHistoryLoading(false);
      });
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch("/api/events?limit=50")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load events"))))
      .then((json) => {
        if (!alive) return;
        setEvents(Array.isArray(json?.data) ? json.data : []);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err?.message || "Unable to load events");
      })
      .finally(() => {
        if (alive) setLoading(false);
        if (alive) setPortfolioLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    loadWalletSummary({ allowUpdate: () => alive });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    loadOffers({ allowUpdate: () => alive });
    loadRedemptionHistory({ allowUpdate: () => alive, limit: 5 });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    loadRatingsSummary({ allowUpdate: () => alive });
    return () => {
      alive = false;
    };
  }, []);

  const nextEvent = useMemo(() => pickNextBest(events, dismissedIds), [events, dismissedIds]);
  const portfolioCandidates = useMemo(() => {
    const now = Date.now();
    return (events || [])
      .filter((evt) => {
        if (!evt) return false;
        const start = evt.start_at ? new Date(evt.start_at).getTime() : null;
        if (!start || Number.isNaN(start) || start > now) return false;
        const isCompleted = evt.status === "completed";
        const ended = evt.end_at ? new Date(evt.end_at).getTime() < now : true;
        return isCompleted || ended;
      })
      .sort((a, b) => {
        const aStart = new Date(a.start_at || 0).getTime();
        const bStart = new Date(b.start_at || 0).getTime();
        return bStart - aStart;
      })
      .slice(0, 3);
  }, [events]);

  useEffect(() => {
    let canceled = false;
    const ids = portfolioCandidates.map((e) => e.id).filter(Boolean);
    const missing = ids.filter((id) => !portfolioDetails[id]);
    if (!missing.length) {
      setPortfolioLoading(false);
      return;
    }
    setPortfolioLoading(true);
    Promise.all(
      missing.map((id) =>
        fetch(`/api/events/${encodeURIComponent(id)}`)
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load event detail"))))
          .then((json) => ({ id, data: json?.data || null }))
          .catch(() => ({ id, data: null }))
      )
    ).then((records) => {
      if (canceled) return;
      setPortfolioDetails((prev) => {
        const next = { ...prev };
        records.forEach(({ id, data }) => {
          next[id] = data;
        });
        return next;
      });
      setPortfolioLoading(false);
    });
    return () => {
      canceled = true;
    };
  }, [portfolioCandidates, portfolioDetails]);

  useEffect(() => {
    if (!nextEvent) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    fetch(`/api/events/${encodeURIComponent(nextEvent.id)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load event detail"))))
      .then((json) => {
        if (!alive) return;
        setDetail(json?.data || null);
      })
      .catch(() => {
        if (!alive) return;
        setDetail(null);
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [nextEvent?.id]);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    fetch("/api/events?limit=50")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load events"))))
      .then((json) => setEvents(Array.isArray(json?.data) ? json.data : []))
      .catch((err) => setError(err?.message || "Unable to load events"))
      .finally(() => setLoading(false));
  };

  const handleWalletRetry = () => {
    loadWalletSummary();
  };

  const handleDonateKind = async (amount, target = "cleanup_supplies") => {
    const safeAmount = Number(amount);
    if (!Number.isInteger(safeAmount) || safeAmount <= 0) return;
    setDonationAmount(safeAmount);
    setDonationStatus("loading");
    setDonationMessage("");
    setDonationNeedsMore(false);
    try {
      const res = await fetch("/api/wallet/donate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_kind: safeAmount, target }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const errorCode = json?.error;
        const message = json?.message || "Unable to donate $KIND.";
        setDonationMessage(message);
        setDonationNeedsMore(errorCode === "INSUFFICIENT_BALANCE");
        setDonationStatus("error");
        return;
      }
      setDonationStatus("success");
      setDonationMessage(`Donated ${safeAmount} $KIND.`);
      loadWalletSummary();
    } catch (err) {
      setDonationStatus("error");
      setDonationMessage(err?.message || "Unable to donate $KIND.");
    }
  };

  const handleRedeemOffer = async (slug) => {
    const offerSlug = (slug || "").trim();
    if (!offerSlug) return;
    setRedeemStatus({ state: "loading", message: "", slug: offerSlug });
    try {
      const res = await fetch("/api/redemptions/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ offer_slug: offerSlug }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const message = json?.message || "Unable to redeem offer.";
        setRedeemStatus({ state: "error", message, slug: offerSlug });
        return;
      }
      const newBalance = Number(json?.data?.new_balance);
      setRedeemStatus({ state: "success", message: "Redeemed successfully.", slug: offerSlug });
      if (Number.isFinite(newBalance)) {
        setWalletSummary((prev) => (prev ? { ...prev, balance: newBalance } : prev));
      }
      loadWalletSummary();
      loadRedemptionHistory();
    } catch (err) {
      setRedeemStatus({ state: "error", message: err?.message || "Unable to redeem offer.", slug: offerSlug });
    }
  };

  const handleJoin = async () => {
    if (!nextEvent) return;
    setJoinLoading(true);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(nextEvent.id)}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Unable to join this serve");
      }
      // refresh detail
      const detailRes = await fetch(`/api/events/${encodeURIComponent(nextEvent.id)}`);
      const detailJson = await detailRes.json().catch(() => ({}));
      if (detailRes.ok) setDetail(detailJson?.data || null);
    } catch (err) {
      setError(err?.message || "Unable to join this serve");
    } finally {
      setJoinLoading(false);
    }
  };

  const handleDismiss = () => {
    if (!nextEvent) return;
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(String(nextEvent.id));
      return next;
    });
  };

  const handleDetails = () => {
    if (!nextEvent) return;
    window.location = `/events#/events/${nextEvent.id}`;
  };

  const pill = statusPill(detail, nextEvent);
  const kindEstimate = estimateKind(detail || nextEvent || {});
  const bullets = buildBullets(nextEvent || {});
  const skills = mapSkills(nextEvent?.category);
  const whenLabel = formatDateRange(nextEvent?.start_at, nextEvent?.end_at, nextEvent?.tz);
  const balanceValue = walletSummary ? `${Number(walletSummary.balance) || 0} $KIND` : "—";
  const earnedValue = walletSummary ? `${Number(walletSummary.earned_lifetime) || 0} $KIND` : "—";
  const donatedValue = walletSummary ? `${Number(walletSummary.donated_lifetime) || 0} $KIND` : "—";
  const earnableValue = walletSummary
    ? `+${Math.max(0, Number(walletSummary.earnable_this_week) || 0)} $KIND`
    : "—";
  const ratingsSampleSize = Number(ratingsSummary?.rating_count) || 0;
  const ratingsValue = ratingsSampleSize ? `${ratingsSummary?.kindness_rating}★` : "—";
  const ratingsMeta = ratingsLoading
    ? "Loading rating…"
    : ratingsSampleSize
      ? `${ratingsSampleSize} serves`
      : (ratingsError ? "Couldn't load rating" : "No ratings yet");
  const portfolioItems = useMemo(() => {
    const enrich = (evt) => {
      const detailFor = portfolioDetails[evt.id] || {};
      const viewerStatus = detailFor.viewer_rsvp_status || evt.viewer_rsvp_status || null;
      const checkedIn = detailFor.viewer_checked_in_at || viewerStatus === "checked_in";
      const statusPill = checkedIn ? "Verified \u2713" : evt.status === "completed" ? "Finished \u23f3" : "Finished \u23f3";
      const durationLabel = (() => {
        const start = evt.start_at ? new Date(evt.start_at) : null;
        const end = evt.end_at ? new Date(evt.end_at) : null;
        if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) return "Duration n/a";
        const diff = Math.max(0, end.getTime() - start.getTime());
        const hours = Math.round(diff / (1000 * 60 * 60));
        if (hours <= 0) return "Under 1 hr";
        if (hours === 1) return "1 hr";
        return `${hours} hrs`;
      })();
      const perUser = estimateKind({
        reward_pool_kind: evt.reward_pool_kind ?? detailFor.reward_pool_kind,
        capacity: evt.capacity ?? detailFor.capacity,
        rsvp_counts: detailFor.rsvp_counts || evt.rsvp_counts,
      });
      const skills = mapSkills(evt.category);
      return {
        id: evt.id,
        title: evt.title || "Serve",
        statusPill,
        checkedIn,
        viewerStatus,
        location: evt.location_text || detailFor.location_text || "Location TBA",
        start_at: evt.start_at,
        end_at: evt.end_at,
        durationLabel,
        perUser,
        skills,
      };
    };
    return portfolioCandidates.map(enrich);
  }, [portfolioCandidates, portfolioDetails]);

  const emptyState = !loading && !nextEvent;
  const portfolioEmpty = !portfolioLoading && portfolioItems.length === 0;

  return (
    <div className="min-h-[60vh] pb-6 bg-[var(--canvas)] text-slate-800">
      <style>{BRAND_VARS}</style>
      <div className="grid md:grid-cols-12 gap-4 items-start">
        <div className="col-span-12 md:col-span-8 flex flex-col gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Impact Journey</p>
                <h2 className="text-2xl md:text-3xl font-semibold text-[var(--ink)]">
                  Next Best Serve{userName ? `, ${userName}` : ""}
                </h2>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${STATUS_TONES[pill.tone] || STATUS_TONES.neutral}`}>
                {pill.label}
              </span>
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 text-sm flex items-center justify-between">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="text-[var(--ink)] font-semibold text-xs underline"
                >
                  Retry
                </button>
              </div>
            )}

            {loading ? (
              <div className="mt-6 text-sm text-slate-500">Loading serves…</div>
            ) : emptyState ? (
              <div className="mt-6">
                <p className="text-slate-600 text-base">No upcoming serves found.</p>
                <button
                  type="button"
                  className="mt-3 inline-flex items-center px-4 py-2 rounded-lg bg-[var(--ink)] text-white text-sm hover:opacity-90"
                  onClick={() => { window.location = "/events"; }}
                >
                  Browse opportunities
                </button>
              </div>
            ) : (
              <div className="mt-5 grid gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-xl font-semibold text-[var(--ink)]">
                    {nextEvent?.title || "Serve opportunity"}
                  </h3>
                  <span className="text-xs text-slate-500">{whenLabel}</span>
                </div>
                <div className="text-sm text-slate-600">
                  <div>{nextEvent?.location_text || "Location TBA"}</div>
                  <div className="text-[11px] text-slate-500">
                    {/* TODO(geo): add distance when event lat/lng + user location exist */}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--coral)]/10 text-[var(--coral)] border border-[var(--coral)]/20">
                    +{kindEstimate} $KIND
                  </span>
                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--ink)]/10 text-[var(--ink)] border border-[var(--ink)]/20">
                    Builds skills: {skills.join(", ")}
                  </span>
                </div>

                <div className="grid gap-1">
                  <p className="text-sm font-semibold text-[var(--ink)]">Why this fits you</p>
                  <ul className="list-disc list-inside text-sm text-slate-700">
                    {bullets.map((b, idx) => (
                      <li key={idx}>{b}</li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleJoin}
                    disabled={joinLoading || pill.label === "Finished"}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-[var(--ink)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60"
                  >
                    {joinLoading ? "Joining…" : "Join this Serve"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDetails}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-white text-[var(--ink)] border border-slate-200 text-sm hover:bg-slate-50"
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={handleDismiss}
                    className="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-white text-slate-600 border border-slate-200 text-sm hover:bg-slate-50"
                  >
                    Not for me
                  </button>
                </div>
              </div>
            )}
          </div>

          <ImpactPortfolioCard
            items={portfolioItems}
            loading={portfolioLoading}
            empty={portfolioEmpty}
          />
        </div>

        <div className="col-span-12 md:col-span-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 md:p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">$KIND + Kindness</p>
                <h3 className="text-xl font-semibold text-[var(--ink)]">Summary</h3>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <SummaryTile label="Balance" value={balanceValue} />
              <SummaryTile label="Earnable this week" value={earnableValue} />
              <SummaryTile label="Earned (lifetime)" value={earnedValue} />
              <SummaryTile label="Donated (lifetime)" value={donatedValue} />
            </div>
            {walletError && !walletLoading ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 text-xs flex items-center justify-between">
                <span>Couldn&apos;t load wallet summary.</span>
                <button
                  type="button"
                  onClick={handleWalletRetry}
                  className="text-[var(--ink)] font-semibold text-xs underline"
                >
                  Retry
                </button>
              </div>
            ) : null}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between text-sm text-slate-700">
                <span>Kindness rating</span>
                <span className="font-semibold">{ratingsValue}</span>
              </div>
              <p className="text-[12px] text-slate-500 mt-1">{ratingsMeta}</p>
              <div className="flex items-center justify-between text-sm text-slate-700 mt-3">
                <span>Reliability</span>
                <span className="font-semibold">—</span>
              </div>
              <p className="text-[12px] text-slate-500 mt-1">Coming soon</p>
            </div>
            <div className="mt-4 grid gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="text-slate-500">Quick donate</span>
                {[10, 25, 50].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => handleDonateKind(amount)}
                    disabled={donationStatus === "loading"}
                    className={`inline-flex items-center justify-center px-3 py-1 rounded-full border text-xs ${
                      donationAmount === amount
                        ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                        : "bg-white text-[var(--ink)] border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {amount} $KIND
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-white text-[var(--ink)] border border-slate-200 text-sm hover:bg-slate-50"
                onClick={() => console.log("rating_details")}
              >
                See rating details
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-white text-[var(--ink)] border border-slate-200 text-sm hover:bg-slate-50"
                onClick={() => console.log("rewards_details")}
              >
                View rewards details
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-[var(--coral)] text-white text-sm hover:opacity-90"
                onClick={() => handleDonateKind(25)}
                disabled={donationStatus === "loading"}
              >
                {donationStatus === "loading" ? "Donating…" : "Donate $KIND"}
              </button>
              {donationMessage ? (
                <div
                  className={`text-xs ${donationStatus === "success" ? "text-emerald-700" : "text-amber-700"}`}
                >
                  {donationMessage}
                </div>
              ) : null}
              {donationNeedsMore ? (
                <button
                  type="button"
                  onClick={() => { window.location = "/events"; }}
                  className="text-xs text-[var(--ink)] underline text-left"
                >
                  Earn more $KIND
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Redeem</p>
                <h3 className="text-xl font-semibold text-[var(--ink)]">Impact rewards</h3>
              </div>
              <span className="text-xs text-slate-600 bg-slate-100 rounded-full px-3 py-1">
                Balance: {Number(walletSummary?.balance) || 0} $KIND
              </span>
            </div>

            <div className="mt-4 grid gap-2">
              {offersLoading ? (
                Array.from({ length: 3 }).map((_, idx) => (
                  <div key={idx} className="animate-pulse rounded-lg border border-slate-200 bg-slate-50 p-3 h-10" />
                ))
              ) : offersError ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 text-sm">
                  {offersError}
                </div>
              ) : offers.length ? (
                offers.map((offer) => {
                  const cost = Number(offer?.cost_credits) || 0;
                  const disabled = walletLoading || offersLoading || historyLoading || (Number(walletSummary?.balance) || 0) < cost || redeemStatus.state === "loading";
                  return (
                    <button
                      key={offer.slug || offer.id}
                      type="button"
                      onClick={() => handleRedeemOffer(offer.slug)}
                      disabled={disabled}
                      className={`flex items-center justify-between w-full px-4 py-2 rounded-lg border text-sm font-semibold ${
                        disabled
                          ? "bg-slate-100 text-slate-500 border-slate-200 cursor-not-allowed"
                          : "bg-white text-[var(--ink)] border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <span>{offer.title || offer.slug}</span>
                      <span className="text-xs text-slate-600">Redeem {cost} $KIND</span>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 text-slate-600 px-3 py-2 text-sm">
                  No offers available.
                </div>
              )}
            </div>

            {redeemStatus?.message ? (
              <div
                className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                  redeemStatus.state === "success"
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {redeemStatus.message}
              </div>
            ) : null}

            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-700 font-semibold">Recent redemptions</p>
                <button
                  type="button"
                  className="text-xs text-[var(--ink)] underline"
                  onClick={() => loadRedemptionHistory({ limit: 5 })}
                  disabled={historyLoading}
                >
                  Refresh
                </button>
              </div>
              {historyLoading ? (
                <div className="mt-2 grid gap-2">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <div key={idx} className="animate-pulse h-8 rounded-lg border border-slate-200 bg-slate-50" />
                  ))}
                </div>
              ) : historyError ? (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 text-xs">
                  {historyError}
                </div>
              ) : (redemptionHistory || []).length ? (
                <div className="mt-2 grid gap-2">
                  {(redemptionHistory || []).slice(0, 5).map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      <div className="text-slate-700">
                        <div className="font-semibold">{item.title || item.slug}</div>
                        <div className="text-slate-500">{item.status}</div>
                      </div>
                      <div className="text-slate-600 font-semibold">-{Number(item?.cost_credits) || 0} $KIND</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">No redemptions yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, note }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-[var(--ink)] leading-tight">{value}</div>
      {note ? <p className="text-[11px] text-slate-500 mt-1">{note}</p> : null}
    </div>
  );
}

function ImpactPortfolioCard({ items = [], loading, empty }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Your Impact Portfolio</p>
          <h3 className="text-xl font-semibold text-[var(--ink)]">Recent</h3>
          <p className="text-sm text-slate-600">Recent serves • verification • skills • mutual ratings</p>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 grid gap-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="animate-pulse rounded-lg border border-slate-200 bg-white p-3 space-y-2">
              <div className="h-4 bg-slate-200 rounded w-1/3" />
              <div className="h-3 bg-slate-200 rounded w-1/2" />
              <div className="h-3 bg-slate-200 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : empty ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-700">No completed serves yet. Join your first serve to start your portfolio.</p>
          <a
            href="/events"
            className="inline-flex items-center mt-2 px-3 py-2 rounded-lg bg-[var(--ink)] text-white text-sm font-semibold hover:opacity-90"
          >
            Browse opportunities
          </a>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {items.map((evt) => (
            <div key={evt.id || evt.title} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${evt.checkedIn ? STATUS_TONES.approved : STATUS_TONES.finished}`}>
                    {evt.statusPill}
                  </span>
                  <span className="text-xs text-slate-500">{evt.durationLabel}</span>
                </div>
                <div className="text-xs text-slate-600">{evt.location}</div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-[var(--ink)]">{evt.title}</h4>
                <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">+{evt.perUser || 0} $KIND est.</span>
              </div>
              <div className="mt-1 text-xs text-slate-600">Skills: {evt.skills.join(", ")}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg bg-[var(--coral)] text-white text-xs font-semibold hover:opacity-90"
                  onClick={() => { window.location = `/events#/events/${evt.id}`; }}
                >
                  Rate now
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-[var(--ink)] text-xs font-semibold bg-white hover:bg-slate-50"
                  onClick={() => console.log("Add note for", evt.id)}
                >
                  Add note
                </button>
                <span className="text-xs text-slate-500 self-center">Org rating pending</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
