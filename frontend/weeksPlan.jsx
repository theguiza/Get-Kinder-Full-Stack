import React, { useEffect, useMemo, useState } from "react";

const BRAND_VARS = `
  :root { --ink:#455a7c; --coral:#ff5656; --mist:#b5bdcb; --canvas:#f4f4f4; }
`;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const APPROVED_RSVP_STATUSES = new Set(["accepted", "checked_in"]);

const SKILL_MAP = {
  cleanup: ["Stewardship", "Safety"],
  food: ["Food Service", "Teamwork"],
  outreach: ["Guest Support", "De-escalation"],
  support: ["Community Support", "Reliability"],
  default: ["Community Service"],
};

function mapSkills(category) {
  if (!category) return SKILL_MAP.default;
  const key = String(category).toLowerCase();
  if (key.includes("clean")) return SKILL_MAP.cleanup;
  if (key.includes("food")) return SKILL_MAP.food;
  if (key.includes("outreach")) return SKILL_MAP.outreach;
  if (key.includes("support")) return SKILL_MAP.support;
  return SKILL_MAP.default;
}

function formatTimeRange(startAt, endAt, tz) {
  if (!startAt) return "Time TBA";
  const start = new Date(startAt);
  const end = endAt ? new Date(endAt) : null;
  if (Number.isNaN(start.getTime())) return "Time TBA";
  const opts = { hour: "numeric", minute: "2-digit", timeZone: tz || undefined };
  const startStr = start.toLocaleTimeString([], opts).replace(":00", "");
  if (!end || Number.isNaN(end.getTime())) return startStr;
  const endStr = end.toLocaleTimeString([], opts).replace(":00", "");
  return `${startStr}–${endStr}`;
}

function formatDay(startAt, tz) {
  if (!startAt) return "TBD";
  const d = new Date(startAt);
  const opts = { weekday: "short", timeZone: tz || undefined };
  return d.toLocaleDateString([], opts);
}

function withinNext7Days(startAt) {
  if (!startAt) return false;
  const start = new Date(startAt).getTime();
  if (Number.isNaN(start)) return false;
  const now = Date.now();
  const seven = now + 7 * 24 * 60 * 60 * 1000;
  return start >= now && start <= seven;
}

function getEventImpactCredits(evt = {}) {
  const base = Number(evt.impact_credits_base);
  return Number.isFinite(base) && base > 0 ? Math.trunc(base) : 0;
}

function buildHostLabel(evt) {
  const orgName = typeof evt?.org_name === "string" ? evt.org_name.trim() : "";
  if (orgName) {
    return /get\s*kinder|get\s*kindr/i.test(orgName) ? "Get Kinder" : orgName;
  }
  return "Independent organizer";
}

function statusTone(status) {
  if (status === "accepted" || status === "checked_in") return "text-emerald-700 bg-emerald-50 border border-emerald-200";
  if (status === "pending" || status === "interested") return "text-amber-700 bg-amber-50 border border-amber-200";
  if (status === "waitlisted") return "text-orange-700 bg-orange-50 border border-orange-200";
  if (status === "declined") return "text-rose-700 bg-rose-50 border border-rose-200";
  return "text-slate-600 bg-slate-100 border border-slate-200";
}

function statusLabel(status) {
  if (status === "accepted" || status === "checked_in") return "Approved";
  if (status === "pending" || status === "interested") return "Pending approval";
  if (status === "waitlisted") return "Waitlisted";
  if (status === "declined") return "Declined";
  return "Not requested";
}

function useEventPlan(initialItems = []) {
  const hasInitialItems = Array.isArray(initialItems) && initialItems.length > 0;
  const [events, setEvents] = useState(() => (hasInitialItems ? initialItems : []));
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(!hasInitialItems);
  const [error, setError] = useState(null);
  const [rsvpLoading, setRsvpLoading] = useState({});

  useEffect(() => {
    if (hasInitialItems) {
      setEvents(initialItems);
      setLoading(false);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    fetch("/api/events?limit=50")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load events"))))
      .then((json) => {
        if (!alive) return;
        const data = Array.isArray(json?.data) ? json.data : [];
        setEvents(data);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err?.message || "Unable to load events");
        setEvents([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [hasInitialItems, initialItems]);

  const upcoming = useMemo(
    () => (events || []).filter((evt) => withinNext7Days(evt.start_at)).sort((a, b) => {
      const aTime = new Date(a.start_at || 0).getTime();
      const bTime = new Date(b.start_at || 0).getTime();
      return aTime - bTime;
    }),
    [events]
  );

  useEffect(() => {
    let canceled = false;
    const idsToFetch = upcoming
      .slice(0, 6)
      .map((evt) => evt.id)
      .filter((id) => id != null && !details[id]);
    if (!idsToFetch.length) return;

    Promise.all(
      idsToFetch.map((id) =>
        fetch(`/api/events/${encodeURIComponent(id)}`)
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load event detail"))))
          .then((json) => ({ id, data: json?.data || null }))
          .catch(() => ({ id, data: null }))
      )
    ).then((records) => {
      if (canceled) return;
      setDetails((prev) => {
        const next = { ...prev };
        records.forEach(({ id, data }) => {
          next[id] = data;
        });
        return next;
      });
    });

    return () => {
      canceled = true;
    };
  }, [upcoming, details]);

  const planItems = useMemo(() => {
    const enriched = upcoming.map((evt) => {
      const detail = details[evt.id] || {};
      const viewerStatus =
        detail.viewer_rsvp_status ||
        evt.viewer_rsvp_status ||
        evt.rsvp_status ||
        null;
      const capacity = evt.capacity != null ? evt.capacity : detail.capacity;
      const accepted = detail?.rsvp_counts?.accepted ?? evt?.rsvp_counts?.accepted ?? evt?.accepted_count ?? 0;
      const hasCapacity = capacity == null ? true : accepted < capacity;
      const impactCredits = getEventImpactCredits(evt);
      return {
        ...evt,
        org_name: detail.org_name || evt.org_name || null,
        viewerStatus,
        capacity,
        accepted,
        hasCapacity,
        impactCredits,
      };
    });

    return enriched
      .filter((evt) => APPROVED_RSVP_STATUSES.has(String(evt.viewerStatus || "").trim().toLowerCase()))
      .slice(0, 3);
  }, [upcoming, details]);

  const totals = useMemo(() => {
    const planned = planItems.length;
    const earnable = planItems.reduce((sum, evt) => sum + (Number(evt.impactCredits) || 0), 0);
    const skillSet = new Set();
    planItems.forEach((evt) => mapSkills(evt.category).forEach((s) => skillSet.add(s)));
    return { planned, earnable, skills: skillSet.size || 0 };
  }, [planItems]);

  const handleRsvp = async (eventId, action = "accept") => {
    if (!eventId) return;
    setRsvpLoading((prev) => ({ ...prev, [eventId]: true }));
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
      setDetails((prev) => ({
        ...prev,
        [eventId]: {
          ...(prev[eventId] || {}),
          viewer_rsvp_status: json.data?.status || action,
          rsvp_counts: json.data?.rsvp_counts || prev[eventId]?.rsvp_counts,
        },
      }));
    } catch (err) {
      // Surface minimal error; avoid alert spam
      console.error(err);
    } finally {
      setRsvpLoading((prev) => ({ ...prev, [eventId]: false }));
    }
  };

  return { loading, error, planItems, totals, setError, setLoading, refetch: () => {}, handleRsvp, rsvpLoading };
}

export default function WeeksPlan(props = {}) {
  const { initialItems = [] } = props;
  const { loading, error, planItems, totals, handleRsvp, rsvpLoading } = useEventPlan(initialItems);
  const todayIdx = useMemo(() => {
    const isoDay = new Date().getDay(); // 0-6, Sun=0
    return isoDay === 0 ? 6 : isoDay - 1;
  }, []);

  const empty = !loading && !planItems.length;

  return (
    <div className="mb-4" data-testid="weeks-plan">
      <style>{BRAND_VARS}</style>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="dash-ink-title dash-impact-title">This Week&apos;s Plan</h2>
          <p className="text-sm text-slate-600">Your plan: help to earn and build verified skills.</p>
        </div>

        <style>{`.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}`}</style>
        <div className="flex items-center gap-1 sm:gap-2" data-testid="weeks-plan-calendar">
          <div className="flex gap-1 sm:gap-2 overflow-x-auto no-scrollbar">
            {DAYS.map((day, idx) => (
              <div
                key={day}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-sm font-semibold shrink-0 ${
                  idx === todayIdx ? "bg-[var(--coral)] text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {day}
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3">
          {loading ? (
            <SkeletonRows />
          ) : error ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 text-sm flex items-center justify-between">
              <span>{error}</span>
              <button
                type="button"
                className="text-[var(--ink)] font-semibold text-xs underline"
                onClick={() => {
                  window.location.reload();
                }}
              >
                Retry
              </button>
            </div>
          ) : empty ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-3">
              <p className="text-sm text-slate-700">No approved opportunities are scheduled for this week.</p>
              <a
                href="/events"
                className="inline-flex items-center mt-2 px-3 py-2 rounded-lg bg-[var(--ink)] text-white text-sm font-semibold hover:opacity-90"
              >
                Find opportunities
              </a>
            </div>
          ) : (
            planItems.map((evt) => {
              const dayLabel = formatDay(evt.start_at, evt.tz);
              const timeLabel = formatTimeRange(evt.start_at, evt.end_at, evt.tz);
              const skills = mapSkills(evt.category);
              const statusClass = statusTone(evt.viewerStatus);
              const status = statusLabel(evt.viewerStatus);
              const isApproved = evt.viewerStatus === "accepted" || evt.viewerStatus === "checked_in";
              return (
                <div
                  key={evt.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                  data-testid="weeks-plan-row"
                >
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="text-sm font-semibold text-[var(--ink)]">
                        {dayLabel} <span className="text-slate-500">{timeLabel}</span>
                      </div>
                      <span className={`text-xs px-3 py-1 rounded-full ${statusClass}`}>{status}</span>
                    </div>
                    <div className="text-sm text-slate-600">After: you&apos;ll rate the opportunity + we&apos;ll rate attendance</div>
                  </div>

                  <div className="mt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-[var(--ink)]">{evt.title || "Opportunity"}</h3>
                      <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">{buildHostLabel(evt)}</span>
                    </div>
                    <div className="mt-1 text-sm text-slate-600">{evt.location_text || "Location TBA"}</div>
                  </div>

                  <div className="mt-3 grid gap-1 text-sm text-slate-600">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[var(--ink)]">+{evt.impactCredits || 0} IC</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          Capacity: {evt.accepted || 0}/{evt.capacity || "∞"}
                        </span>
                      </div>
                      {isApproved ? (
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-[var(--ink)] text-xs font-semibold bg-white hover:bg-slate-50"
                          onClick={() => { window.location = `/events/${encodeURIComponent(evt.id)}`; }}
                        >
                          Add to calendar
                        </button>
                      ) : null}
                    </div>
                    <div>Skills: {skills.join(", ")}</div>
                  </div>

                  {!isApproved ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {evt.viewerStatus === "pending" || evt.viewerStatus === "interested" ? (
                      <>
                        <button
                          type="button"
                          disabled
                          className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 text-xs font-semibold cursor-default"
                        >
                          Pending approval
                        </button>
                        <a
                          href={`/events/${encodeURIComponent(evt.id)}`}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-[var(--ink)] text-xs font-semibold bg-white hover:bg-slate-50"
                        >
                          Details
                        </a>
                      </>
                      ) : evt.viewerStatus === "waitlisted" ? (
                      <>
                        <button
                          type="button"
                          disabled
                          className="px-3 py-1.5 rounded-lg bg-orange-100 text-orange-800 text-xs font-semibold cursor-default"
                        >
                          Waitlisted
                        </button>
                        <a
                          href={`/events/${encodeURIComponent(evt.id)}`}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-[var(--ink)] text-xs font-semibold bg-white hover:bg-slate-50"
                        >
                          Details
                        </a>
                      </>
                      ) : (
                      <>
                        <button
                          type="button"
                          disabled={rsvpLoading[evt.id]}
                          className="px-3 py-1.5 rounded-lg bg-[var(--ink)] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-60"
                          onClick={() => handleRsvp(evt.id, "accept")}
                        >
                          {rsvpLoading[evt.id] ? "Joining…" : "Join"}
                        </button>
                        <a
                          href={`/events/${encodeURIComponent(evt.id)}`}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-[var(--ink)] text-xs font-semibold bg-white hover:bg-slate-50"
                        >
                          Details
                        </a>
                      </>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div
          className="mt-2 rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap gap-4 text-sm text-slate-700"
          data-testid="weeks-plan-totals"
        >
          <div><span className="font-semibold text-[var(--ink)]">{totals.planned}</span> planned</div>
          <div><span className="font-semibold text-[var(--ink)]">+{totals.earnable}</span> IC earnable</div>
          <div><span className="font-semibold text-[var(--ink)]">{totals.skills}</span> skills</div>
          <div><span className="font-semibold text-[var(--ink)]">—</span> rating trend</div>
        </div>
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }).map((_, idx) => (
        <div key={idx} className="animate-pulse rounded-lg border border-slate-200 bg-white p-4">
          <div className="h-4 bg-slate-200 rounded w-1/3" />
          <div className="mt-2 h-4 bg-slate-200 rounded w-1/2" />
          <div className="mt-3 space-y-2">
            <div className="h-3 bg-slate-200 rounded w-full" />
            <div className="h-3 bg-slate-200 rounded w-5/6" />
            <div className="h-3 bg-slate-200 rounded w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
