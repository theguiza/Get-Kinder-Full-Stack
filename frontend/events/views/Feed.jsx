import React, { useEffect, useState } from "react";
import { fetchEventsList } from "../api.js";

export function Feed({ feed = [], setFeed, pagination }) {
  const [communityTag, setCommunityTag] = useState("");
  const [causeTag, setCauseTag] = useState("");

  useEffect(() => {
    if (typeof fetch !== "function") return undefined;
    let alive = true;
    const controller = new AbortController();
    const limit = pagination?.limit || 20;
    const timer = setTimeout(() => {
      fetchEventsList({
        limit,
        communityTag,
        causeTag,
        signal: controller.signal,
      })
        .then((data) => {
          if (!alive || !setFeed) return;
          setFeed(data);
        })
        .catch((err) => {
          if (err?.name === "AbortError") return;
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [communityTag, causeTag, pagination?.limit, setFeed]);

  const hasEvents = Array.isArray(feed) && feed.length > 0;

  return (
    <section className="events-feed">
      <header className="feed-head">
        <input className="search" placeholder="Search events, people, places…" />
        <div className="pills">
          <label className="pill-input">
            Community tag
            <input
              type="text"
              value={communityTag}
              onChange={(e) => setCommunityTag(e.target.value)}
              placeholder="e.g., vancouver"
            />
          </label>
          <label className="pill-input">
            Cause tag
            <input
              type="text"
              value={causeTag}
              onChange={(e) => setCauseTag(e.target.value)}
              placeholder="e.g., Environment"
            />
          </label>
          <button
            type="button"
            className="pill clear"
            onClick={() => {
              setCommunityTag("");
              setCauseTag("");
            }}
            disabled={!communityTag && !causeTag}
          >
            Clear filters
          </button>
          <span className="muted" style={{ marginLeft: "auto" }}>
            Sort: {pagination?.sort || "relevance"} ▾
          </span>
        </div>
        <div className="helper-text">
          Filters apply within your current community. Clear to see all.
        </div>
      </header>

      <div className="cards">
        {hasEvents &&
          feed.map((evt) => {
            const hasCover = Boolean(evt.cover_url);
            const orgName = evt.org_name || "Independent organizer";
            const communityTagLabel = evt.community_tag || "";
            const causeTags = Array.isArray(evt.cause_tags) ? evt.cause_tags.filter(Boolean) : [];
            const causePreview = causeTags.slice(0, 3);
            const extraTagCount = causeTags.length - causePreview.length;
            const requirements = typeof evt.requirements === "string" ? evt.requirements.trim() : "";
            const requirementsPreview =
              requirements.length > 90 ? `${requirements.slice(0, 90)}…` : requirements;
            const verificationLabel = formatVerificationLabel(evt.verification_method);
            const credits = Number.isFinite(Number(evt.impact_credits_base))
              ? Number(evt.impact_credits_base)
              : 25;
            const hasCapacity = evt.capacity !== null && evt.capacity !== undefined;
            const capacityValue = hasCapacity ? evt.capacity : "∞";
            const capacityLabel = `Capacity: ${capacityValue}`;
            const filledCount =
              typeof evt?.rsvp_counts?.accepted === "number"
                ? evt.rsvp_counts.accepted
                : null;
            const filledLabel =
              filledCount !== null && Number.isFinite(Number(evt.capacity)) && Number(evt.capacity) > 0
                ? `Filled: ${filledCount}/${evt.capacity}`
                : "";
            const rsvpStatus = typeof evt.viewer_rsvp_status === "string" ? evt.viewer_rsvp_status : "";
            const ctaLabel = rsvpStatus === "accepted" || rsvpStatus === "interested"
              ? "View"
              : rsvpStatus === "declined"
                ? "Reconsider"
                : "View & Sign Up";
            return (
              <article className="card" key={evt.id}>
                <div
                  className={`cover${hasCover ? " has-image" : ""}`}
                  aria-hidden
                  style={hasCover ? { backgroundImage: `url(${evt.cover_url})` } : undefined}
                />
              <div className="meta">
                <div className="title">{evt.title || "Untitled Event"}</div>
                <div className="org-row">
                  <span className="org-name">{orgName}</span>
                  {communityTagLabel && <span className="community-pill">{communityTagLabel}</span>}
                </div>
                <div className="sub">
                  {fmt(evt.start_at, evt.end_at, evt.tz)} • {evt.location_text || "Location TBD"}
                </div>
                {(capacityLabel || filledLabel) && (
                  <div className="capacity-row">
                    {capacityLabel && <span>{capacityLabel}</span>}
                    {filledLabel && <span>{filledLabel}</span>}
                  </div>
                )}
                {causePreview.length > 0 && (
                  <div className="tag-row">
                    {causePreview.map((tag) => (
                      <span className="tag" key={tag}>{tag}</span>
                    ))}
                    {extraTagCount > 0 && <span className="tag">+{extraTagCount}</span>}
                  </div>
                )}
                {requirementsPreview && (
                  <div className="requirements">{requirementsPreview}</div>
                )}
                <div className="meta-row">
                  <span className="meta-pill">{verificationLabel}</span>
                  <span className="meta-pill">Earn: {credits} Impact Credits</span>
                </div>
              </div>
                <div className="actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => (window.location.hash = `#/events/${evt.id}`)}
                  >
                    {ctaLabel}
                  </button>
                  <button className="btn secondary" type="button">
                    Save
                  </button>
                </div>
              </article>
            );
          })}
        {!hasEvents && <div className="muted">No events yet.</div>}
      </div>

      <style>{styles}</style>
    </section>
  );
}

function fmt(start, end, tz) {
  if (!start) return "When • ?";
  try {
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : null;
    const base = startDate.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz || "UTC",
    });
    if (endDate && !Number.isNaN(endDate.getTime())) {
      const endLabel = endDate.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz || "UTC",
      });
      return `When • ${base}–${endLabel}`;
    }
    return `When • ${base}`;
  } catch {
    return `When • ${start}`;
  }
}

function formatVerificationLabel(method) {
  switch (method) {
    case "host_attest":
      return "Host attestation";
    case "qr_stub":
      return "QR check-in (stub)";
    case "social_proof":
      return "Social proof";
    default:
      return "Host attestation";
  }
}

const styles = `
  .feed-head{margin-bottom:12px}
  .search{width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:12px}
  .pills{display:flex;gap:12px;align-items:center;margin:12px 0;flex-wrap:wrap}
  .pill{background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:16px;font-size:12px}
  .pill.clear{background:#fff}
  .pill-input{display:flex;align-items:center;gap:8px;background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:16px;font-size:12px}
  .pill-input input{border:none;background:transparent;min-width:120px;outline:none}
  .helper-text{font-size:12px;color:#6b7280;margin-top:-4px}
  .muted{color:#6b7280;font-size:12px}
  .cards{display:flex;flex-direction:column;gap:16px}
  .card{display:grid;grid-template-columns:180px 1fr 220px;gap:16px;align-items:center;border:1px solid #e5e7eb;border-radius:16px;padding:16px;background:#fff}
  @media (max-width: 991px){.card{grid-template-columns:1fr}}
  .cover{height:120px;background:#e5e7eb;border:1px solid #e5e7eb;border-radius:12px}
  .cover.has-image{background-size:cover;background-position:center;border:none}
  .title{font-weight:700;font-size:18px}
  .sub{color:#6b7280;font-size:13px}
  .org-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px}
  .org-name{font-weight:600;color:#1f2937}
  .community-pill{background:#fff;border:1px solid #e5e7eb;border-radius:999px;padding:3px 10px;font-size:11px;color:#1f2937}
  .tag-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
  .tag{background:#f3f4f6;border:1px solid #e5e7eb;border-radius:999px;padding:3px 10px;font-size:11px;color:#374151}
  .requirements{color:#4b5563;font-size:12px;margin-top:6px}
  .meta-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
  .meta-pill{background:#fff;border:1px dashed #d1d5db;border-radius:999px;padding:3px 10px;font-size:11px;color:#4b5563}
  .capacity-row{display:flex;gap:10px;font-size:12px;color:#6b7280;margin-top:4px}
  .actions{display:flex;gap:8px;justify-content:flex-end}
  .btn{background:#ff5656;border:none;color:#fff;padding:10px 16px;border-radius:10px;font-weight:700;cursor:pointer}
  .btn.secondary{background:#fff;border:1px solid #e5e7eb;color:#1f2937}
`;
