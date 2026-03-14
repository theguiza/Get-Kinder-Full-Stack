import React, { useEffect, useMemo, useRef, useState } from "react";
import { fetchEventsList } from "../api.js";

function clampLimit(value, fallback = 20) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.trunc(num), 1), 50);
}

function normalizeView(value) {
  return value === "archive" ? "archive" : "upcoming";
}

function normalizeFilterToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function matchesCauseSelection(evt, selectedToken) {
  if (!selectedToken) return true;
  const tagTokens = Array.isArray(evt?.cause_tags)
    ? evt.cause_tags.map((tag) => normalizeFilterToken(tag)).filter(Boolean)
    : [];
  const categoryToken = normalizeFilterToken(evt?.category);
  const tokens = [...tagTokens, categoryToken].filter(Boolean);
  if (!tokens.length) return false;
  return tokens.some(
    (token) =>
      token === selectedToken ||
      token.startsWith(selectedToken) ||
      selectedToken.startsWith(token)
  );
}

function parsePageFiltersFromDom() {
  if (typeof document === "undefined") return null;
  const node = document.getElementById("events-page-filters");
  if (!node) return null;
  try {
    const parsed = JSON.parse(node.textContent || "{}");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function readInitialFilterState(pagination = {}) {
  const dom = parsePageFiltersFromDom() || {};
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;

  const view = normalizeView(
    (params && params.get("view")) || dom.view || pagination?.view
  );
  const causeTag = String(
    (params && params.get("cause_tag")) ?? dom.cause_tag ?? pagination?.cause_tag ?? ""
  ).trim();
  const communityTag = String(
    (params && params.get("community_tag")) ?? dom.community_tag ?? pagination?.community_tag ?? ""
  ).trim();
  const limit = clampLimit(
    (params && params.get("limit")) ?? dom.limit ?? pagination?.limit ?? 20,
    20
  );

  const cursorFromUrl = view === "archive"
    ? {
        before_start_at: (params && params.get("before_start_at")) || null,
        before_id: (params && params.get("before_id")) || null,
      }
    : {
        after_start_at: (params && params.get("after_start_at")) || null,
        after_id: (params && params.get("after_id")) || null,
      };
  const hasCursorInUrl = view === "archive"
    ? Boolean(cursorFromUrl.before_id)
    : Boolean(cursorFromUrl.after_id);
  const cursorFromSsr = (dom.cursor && typeof dom.cursor === "object")
    ? dom.cursor
    : (pagination?.cursor && typeof pagination.cursor === "object" ? pagination.cursor : null);

  return {
    view,
    causeTag,
    communityTag,
    limit,
    cursor: hasCursorInUrl ? cursorFromUrl : cursorFromSsr,
  };
}

export function Feed({ feed = [], setFeed, pagination }) {
  const initialFiltersRef = useRef(null);
  if (!initialFiltersRef.current) {
    initialFiltersRef.current = readInitialFilterState(pagination);
  }
  const initialFilters = initialFiltersRef.current;
  const [communityTag, setCommunityTag] = useState(initialFilters.communityTag);
  const [causeTag, setCauseTag] = useState(initialFilters.causeTag);
  const [view] = useState(initialFilters.view);
  const [limit] = useState(initialFilters.limit);
  const [cursor] = useState(initialFilters.cursor);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const hasHydratedRef = useRef(false);
  const listRef = useRef(null);

  useEffect(() => {
    function handleChipFilter(e) {
      setCauseTag(e?.detail?.causeTag || "");
    }
    if (typeof window !== "undefined") {
      window.addEventListener("getkinder:causeFilter", handleChipFilter);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("getkinder:causeFilter", handleChipFilter);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof fetch !== "function") return undefined;
    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      return undefined;
    }
    let alive = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const hasActiveFilters = Boolean(
        String(communityTag || "").trim() || String(causeTag || "").trim()
      );
      const nextCursor = !hasActiveFilters && cursor && typeof cursor === "object"
        ? cursor
        : undefined;
      fetchEventsList({
        limit,
        view,
        cursor: nextCursor,
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
  }, [
    communityTag,
    causeTag,
    limit,
    view,
    cursor?.after_start_at,
    cursor?.after_id,
    cursor?.before_start_at,
    cursor?.before_id,
    setFeed,
  ]);

  const sortedFeed = useMemo(() => {
    if (!Array.isArray(feed)) return [];
    const now = Date.now();
    return [...feed].sort((a, b) => {
      const aStart = Date.parse(a?.start_at || "");
      const bStart = Date.parse(b?.start_at || "");
      const aValid = Number.isFinite(aStart);
      const bValid = Number.isFinite(bStart);

      if (!aValid && !bValid) return 0;
      if (!aValid) return 1;
      if (!bValid) return -1;

      const aFuture = aStart >= now;
      const bFuture = bStart >= now;

      // Upcoming events first, nearest start time at the top.
      if (aFuture && bFuture) return aStart - bStart;
      if (aFuture !== bFuture) return aFuture ? -1 : 1;

      // Past events follow, newest past first.
      return bStart - aStart;
    });
  }, [feed]);

  const visibleFeed = useMemo(() => {
    const selectedCause = normalizeFilterToken(causeTag);
    const term = String(searchTerm || "").trim().toLowerCase();
    return sortedFeed.filter((evt) => {
      if (!matchesCauseSelection(evt, selectedCause)) return false;
      if (!term) return true;
      const searchable = [
        evt?.title,
        evt?.org_name,
        evt?.location_text,
        evt?.community_tag,
        evt?.requirements,
        evt?.category,
        ...(Array.isArray(evt?.cause_tags) ? evt.cause_tags : []),
      ]
        .filter((value) => typeof value === "string" && value.trim())
        .join(" ")
        .toLowerCase();
      return searchable.includes(term);
    });
  }, [sortedFeed, causeTag, searchTerm]);

  const hasEvents = visibleFeed.length > 0;

  function handleSearchSubmit(event) {
    event.preventDefault();
    const nextTerm = String(searchInput || "").trim();
    setSearchTerm(nextTerm);
    if (typeof window !== "undefined" && listRef.current) {
      window.requestAnimationFrame(() => {
        const rootStyles = window.getComputedStyle(document.documentElement);
        const navHeight = Number.parseFloat(rootStyles.getPropertyValue("--navbar-height")) || 86;
        const top =
          listRef.current.getBoundingClientRect().top +
          window.scrollY -
          navHeight -
          16;
        window.scrollTo({
          top: Math.max(0, top),
          behavior: "smooth",
        });
      });
    }
  }

  return (
    <section className="events-feed">
      <header className="feed-head">
        <form className="search-row" onSubmit={handleSearchSubmit}>
          <input
            type="search"
            className="search"
            placeholder="Search events, people, places…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="btn secondary search-submit">
            Search
          </button>
        </form>
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
          <span className="muted" style={{ marginLeft: "auto" }}>
            Sort: {pagination?.sort || "relevance"} ▾
          </span>
        </div>
      </header>

      <div className="cards" ref={listRef}>
        {hasEvents &&
          visibleFeed.map((evt) => {
            const hasCover = Boolean(evt.cover_url);
            const orgName = evt.org_name || "Independent organizer";
            const communityTagLabel = evt.community_tag || "";
            const orgRatingValue = Number.isFinite(Number(evt.org_rating_value))
              ? Number(evt.org_rating_value)
              : null;
            const orgRatingCount = Number(evt.org_rating_count) || 0;
            const causeTags = Array.isArray(evt.cause_tags) ? evt.cause_tags.filter(Boolean) : [];
            const primaryCauseTag = causeTags[0] || "";
            const causePreview = causeTags.slice(1, 4);
            const extraTagCount = causeTags.length - causePreview.length;
            const description = typeof evt.description === "string" ? evt.description.trim() : "";
            const descriptionPreview =
              description.length > 90 ? `${description.slice(0, 90)}…` : description;
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
                    {orgRatingValue !== null && (
                      <OrgRatingInline value={orgRatingValue} count={orgRatingCount} />
                    )}
                    {communityTagLabel && <span className="community-pill">{communityTagLabel}</span>}
                    {primaryCauseTag && <span className="tag cause-pill">{primaryCauseTag}</span>}
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
                  {descriptionPreview && (
                    <div className="requirements">{descriptionPreview}</div>
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
                </div>
              </article>
            );
          })}
        {!hasEvents && (
          <div className="muted">
            {String(searchTerm || "").trim() ? "No events match your search." : "No events yet."}
          </div>
        )}
      </div>

      <style>{styles}</style>
    </section>
  );
}

function OrgRatingInline({ value, count }) {
  const ratingValue = Number.isFinite(Number(value)) ? Number(value) : 5;
  const ratingCount = Number(count) || 0;
  const ratingPercent = Math.max(0, Math.min(100, (ratingValue / 5) * 100));

  return (
    <span
      className="org-rating-inline"
      role="img"
      aria-label={`Organization rating ${ratingValue.toFixed(1)} out of 5 stars from ${ratingCount} ratings`}
    >
      <span className="org-rating-inline-stars" aria-hidden="true">
        <span className="org-rating-inline-stars-base">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
        <span className="org-rating-inline-stars-fill" style={{ width: `${ratingPercent}%` }}>
          &#9733;&#9733;&#9733;&#9733;&#9733;
        </span>
      </span>
      <span className="org-rating-inline-text">
        {ratingValue.toFixed(1)} ({ratingCount})
      </span>
    </span>
  );
}

function fmt(start, end, tz) {
  if (!start) return "When • ?";
  try {
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : null;
    const base = startDate.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
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
      return `${base} - ${endLabel} (${tz || "UTC"})`;
    }
    return `${base} (${tz || "UTC"})`;
  } catch {
    return `${start}`;
  }
}

function formatVerificationLabel() {
  return "Check-in: Scan QR Code";
}

const styles = `
  .feed-head{margin-bottom:12px}
  .search-row{display:flex;align-items:center;gap:10px;max-width:760px}
  .search{flex:1 1 auto;width:auto;padding:10px;border:1px solid #e5e7eb;border-radius:12px}
  .search-submit{padding:10px 16px;border-radius:12px;white-space:nowrap}
  .pills{display:flex;gap:12px;align-items:center;margin:12px 0;flex-wrap:wrap}
  .pill-input{display:flex;align-items:center;gap:8px;background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:16px;font-size:12px}
  .pill-input input{border:none;background:transparent;min-width:120px;outline:none}
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
  .org-rating-inline{display:inline-flex;align-items:center;gap:0.45rem}
  .org-rating-inline-stars{position:relative;display:inline-block;font-size:0.9rem;line-height:1;letter-spacing:0.08em}
  .org-rating-inline-stars-base{color:#d2d9e6}
  .org-rating-inline-stars-fill{position:absolute;left:0;top:0;overflow:hidden;white-space:nowrap;color:#ff5656}
  .org-rating-inline-text{color:#455a7c;font-size:0.82rem;font-weight:600}
  .community-pill{background:#fff;border:1px solid #e5e7eb;border-radius:999px;padding:3px 10px;font-size:11px;color:#1f2937}
  .tag-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
  .tag{background:#f3f4f6;border:1px solid #e5e7eb;border-radius:999px;padding:3px 10px;font-size:11px;color:#374151}
  .requirements{color:#4b5563;font-size:12px;margin-top:6px}
  .meta-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
  .meta-pill{background:#fff;border:1px dashed #d1d5db;border-radius:999px;padding:3px 10px;font-size:11px;color:#4b5563}
  .capacity-row{display:flex;gap:10px;font-size:12px;color:#6b7280;margin-top:4px}
  .actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
  .btn{background:#ff5656;border:none;color:#fff;padding:10px 16px;border-radius:10px;font-weight:700;cursor:pointer}
  .btn.secondary{background:#fff;border:1px solid #e5e7eb;color:#1f2937}
  @media (max-width: 640px){
    .search-row{max-width:100%}
    .actions{width:100%;justify-content:stretch}
    .actions .btn{width:100%}
  }
`;
