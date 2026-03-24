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

const WHEN_FILTER_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "this_weekend", label: "This weekend" },
  { value: "next_week", label: "Next week" },
  { value: "this_month", label: "This month" },
  { value: "all_upcoming", label: "All upcoming" },
];

const FEED_SECTION_ORDER = [
  "today",
  "this_weekend",
  "next_week",
  "later",
  "ongoing",
];

const FEED_SECTION_LABELS = {
  today: "Today",
  this_weekend: "This weekend",
  next_week: "Next week",
  later: "Later",
  ongoing: "Ongoing — join any time",
};

const CAUSE_TAG_LABELS = {
  outdoors: "🌿 Outdoors",
  food: "🍎 Food & Hunger",
  education: "📚 Education",
  community: "🏘 Community",
  health: "💊 Health",
  arts: "🎨 Arts & Culture",
  sports: "🏅 Sports",
  animals: "🐾 Animals",
  environment: "♻️ Environment",
};

function formatCauseTagLabel(value) {
  const normalized = normalizeFilterToken(value);
  if (!normalized) return "";
  if (CAUSE_TAG_LABELS[normalized]) return CAUSE_TAG_LABELS[normalized];
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getCurrentTimeWindows(now = new Date()) {
  const dayStart = startOfDay(now);
  const tomorrow = addDays(dayStart, 1);
  const weekStart = addDays(dayStart, -dayStart.getDay());
  const weekendStart = addDays(weekStart, 6);
  const weekendEnd = addDays(weekendStart, 2);
  const nextWeekStart = weekendEnd;
  const nextWeekEnd = addDays(nextWeekStart, 7);
  const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
  const nextMonthStart = new Date(dayStart.getFullYear(), dayStart.getMonth() + 1, 1);

  return {
    dayStart,
    tomorrow,
    weekendStart,
    weekendEnd,
    nextWeekStart,
    nextWeekEnd,
    monthStart,
    nextMonthStart,
  };
}

function getEventStartMs(evt) {
  const startMs = Date.parse(evt?.start_at || "");
  return Number.isFinite(startMs) ? startMs : Number.NaN;
}

function getEventTimeBucket(evt, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date();
  const nowMs = nowDate.getTime();
  const startMs = getEventStartMs(evt);

  if (evt?.event_type === "recurring" && (!Number.isFinite(startMs) || startMs <= nowMs)) {
    return "ongoing";
  }

  if (!Number.isFinite(startMs)) return "later";

  const {
    dayStart,
    tomorrow,
    weekendStart,
    weekendEnd,
    nextWeekStart,
    nextWeekEnd,
  } = getCurrentTimeWindows(nowDate);

  if (startMs >= dayStart.getTime() && startMs < tomorrow.getTime()) {
    return "today";
  }
  if (startMs >= weekendStart.getTime() && startMs < weekendEnd.getTime()) {
    return "this_weekend";
  }
  if (startMs >= nextWeekStart.getTime() && startMs < nextWeekEnd.getTime()) {
    return "next_week";
  }
  return "later";
}

function matchesWhenSelection(evt, whenFilter, now = new Date()) {
  if (whenFilter === "all_upcoming") return true;

  const bucket = getEventTimeBucket(evt, now);
  if (whenFilter === "today") return bucket === "today";
  if (whenFilter === "this_weekend") return bucket === "this_weekend";
  if (whenFilter === "next_week") return bucket === "next_week";
  if (whenFilter === "this_month") {
    const startMs = getEventStartMs(evt);
    if (!Number.isFinite(startMs)) return false;
    const { monthStart, nextMonthStart } = getCurrentTimeWindows(now);
    return startMs >= monthStart.getTime() && startMs < nextMonthStart.getTime();
  }
  return true;
}

function groupEventsByTimeWindow(events, now = new Date()) {
  const grouped = {
    today: [],
    this_weekend: [],
    next_week: [],
    later: [],
    ongoing: [],
  };

  events.forEach((evt) => {
    grouped[getEventTimeBucket(evt, now)].push(evt);
  });

  return FEED_SECTION_ORDER
    .map((key) => ({
      key,
      title: FEED_SECTION_LABELS[key],
      events: grouped[key],
    }))
    .filter((section) => section.events.length > 0);
}

function getEventTypeMeta(eventType) {
  if (eventType === "multi_day") {
    return {
      label: "Multi-day",
      badgeClassName: "event-type-badge multi-day",
      cardClassName: "card-multi-day",
    };
  }
  if (eventType === "recurring") {
    return {
      label: "Recurring",
      badgeClassName: "event-type-badge recurring",
      cardClassName: "",
    };
  }
  return {
    label: "One-time",
    badgeClassName: "event-type-badge one-time",
    cardClassName: "",
  };
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

export function Feed({ feed = [], setFeed, pagination, onSelectEvent }) {
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
  const [whenFilter, setWhenFilter] = useState("all_upcoming");
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

  const filteredFeed = useMemo(() => {
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

  const visibleFeed = useMemo(() => {
    const now = new Date();
    return filteredFeed.filter((evt) => matchesWhenSelection(evt, whenFilter, now));
  }, [filteredFeed, whenFilter]);

  const groupedFeed = useMemo(() => {
    if (whenFilter === "all_upcoming") return [];
    return groupEventsByTimeWindow(visibleFeed, new Date());
  }, [visibleFeed, whenFilter]);

  const activeFilterChips = useMemo(() => {
    const chips = [];
    const trimmedCauseTag = String(causeTag || "").trim();
    const trimmedSearchTerm = String(searchTerm || "").trim();
    const trimmedCommunityTag = String(communityTag || "").trim();

    if (whenFilter !== "all_upcoming") {
      const whenLabel = FEED_SECTION_LABELS[whenFilter] || whenFilter;
      chips.push({
        key: "when",
        label: whenLabel,
        onRemove: () => setWhenFilter("all_upcoming"),
      });
    }
    if (trimmedCauseTag) {
      chips.push({
        key: "cause",
        label: formatCauseTagLabel(trimmedCauseTag),
        onRemove: () => setCauseTag(""),
      });
    }
    if (trimmedSearchTerm) {
      chips.push({
        key: "search",
        label: `Search: ${trimmedSearchTerm}`,
        onRemove: () => {
          setSearchTerm("");
          setSearchInput("");
        },
      });
    }
    if (trimmedCommunityTag) {
      chips.push({
        key: "community",
        label: `Community: ${trimmedCommunityTag}`,
        onRemove: () => setCommunityTag(""),
      });
    }

    return chips;
  }, [whenFilter, causeTag, searchTerm, communityTag]);

  const hasActiveFilterBar = activeFilterChips.length > 0;
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
        <div className="when-filter-row" aria-label="When filter">
          <span className="when-filter-label">When</span>
          <div className="when-filter-pills" role="group" aria-label="Filter events by time window">
            {WHEN_FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`when-pill${whenFilter === option.value ? " active" : ""}`}
                aria-pressed={whenFilter === option.value}
                onClick={() => setWhenFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
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

      {hasActiveFilterBar && (
        <div className="active-filters-bar" aria-label="Active filters">
          <div className="active-filters-left">
            {activeFilterChips.map((chip) => (
              <span className="active-filter-chip" key={chip.key}>
                <span>{chip.label}</span>
                <button
                  type="button"
                  className="active-filter-remove"
                  aria-label={`Remove ${chip.label}`}
                  onClick={chip.onRemove}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="active-filters-clear"
              onClick={() => {
                setWhenFilter("all_upcoming");
                setCauseTag("");
                setSearchTerm("");
                setSearchInput("");
                setCommunityTag("");
              }}
            >
              Clear all
            </button>
          </div>
          <div className="active-filters-count">{visibleFeed.length} events</div>
        </div>
      )}

      <div className="feed-results" ref={listRef}>
        {hasEvents && whenFilter === "all_upcoming" && (
          <div className="cards">
            {visibleFeed.map((evt) => (
              <EventCard key={evt.id} evt={evt} onSelectEvent={onSelectEvent} />
            ))}
          </div>
        )}
        {hasEvents && whenFilter !== "all_upcoming" && (
          <div className="feed-sections">
            {groupedFeed.map((section) => (
              <section className="feed-section" key={section.key}>
                <div className="feed-section-head">
                  <h3 className="feed-section-title">{section.title}</h3>
                  <span className="feed-section-count">{section.events.length}</span>
                </div>
                <div className="cards">
                  {section.events.map((evt) => (
                    <EventCard key={evt.id} evt={evt} onSelectEvent={onSelectEvent} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
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

function EventCard({ evt, onSelectEvent }) {
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
  const extraTagCount = Math.max(0, causeTags.length - 1 - causePreview.length);
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
  const ctaLabel =
    rsvpStatus === "accepted" || rsvpStatus === "interested"
      ? "View"
      : rsvpStatus === "declined"
        ? "Reconsider"
        : evt.event_type === "multi_day"
          ? "View roles →"
          : "View & Sign Up";
  const eventTypeMeta = getEventTypeMeta(evt.event_type);

  return (
    <article className={`card ${eventTypeMeta.cardClassName}`.trim()}>
      <div
        className={`cover${hasCover ? " has-image" : ""}`}
        aria-hidden
        style={hasCover ? { backgroundImage: `url(${evt.cover_url})` } : undefined}
      />
      <div className="meta">
        <div className="meta-top">
          <div className="title">{evt.title || "Untitled Event"}</div>
          <span className={eventTypeMeta.badgeClassName}>{eventTypeMeta.label}</span>
        </div>
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
          onClick={() => {
            if (typeof onSelectEvent === "function") {
              onSelectEvent(evt.id);
              return;
            }
            window.location.href = `/events/${encodeURIComponent(evt.id)}`;
          }}
        >
          {ctaLabel}
        </button>
      </div>
    </article>
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
  .when-filter-row{display:flex;align-items:center;gap:12px;margin:14px 0 10px;flex-wrap:wrap}
  .when-filter-label{font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280}
  .when-filter-pills{display:flex;gap:8px;flex-wrap:wrap}
  .when-pill{border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:999px;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.18s ease}
  .when-pill.active{background:#455a7c;border-color:#455a7c;color:#fff;box-shadow:0 8px 18px rgba(69,90,124,0.16)}
  .pills{display:flex;gap:12px;align-items:center;margin:12px 0;flex-wrap:wrap}
  .pill-input{display:flex;align-items:center;gap:8px;background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:16px;font-size:12px}
  .pill-input input{border:none;background:transparent;min-width:120px;outline:none}
  .muted{color:#6b7280;font-size:12px}
  .active-filters-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;background:#f7f3ed;border:1px solid #ebe4d8;border-radius:16px;padding:12px 14px;margin:0 0 16px}
  .active-filters-left{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .active-filter-chip{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #d6deeb;border-radius:999px;padding:6px 10px;color:#455a7c;font-size:12px;font-weight:600}
  .active-filter-remove{border:none;background:transparent;color:#ff5656;font-size:16px;line-height:1;cursor:pointer;padding:0}
  .active-filters-clear{border:none;background:transparent;color:#ff5656;text-decoration:underline;font-size:12px;font-weight:700;cursor:pointer;padding:0}
  .active-filters-count{margin-left:auto;color:#6b7280;font-size:12px;text-align:right}
  .feed-results{display:flex;flex-direction:column;gap:18px}
  .feed-sections{display:flex;flex-direction:column;gap:22px}
  .feed-section{display:flex;flex-direction:column;gap:12px}
  .feed-section-head{display:flex;align-items:center;gap:10px;justify-content:space-between;border-bottom:1px solid #eceff3;padding-bottom:8px}
  .feed-section-title{margin:0;font-size:20px;line-height:1.1;color:#1f2937}
  .feed-section-count{display:inline-flex;align-items:center;justify-content:center;min-width:32px;padding:4px 10px;border-radius:999px;background:#eef2f7;color:#455a7c;font-size:12px;font-weight:700}
  .cards{display:flex;flex-direction:column;gap:16px}
  .card{display:grid;grid-template-columns:180px 1fr 220px;gap:16px;align-items:center;border:1px solid #e5e7eb;border-radius:16px;padding:16px;background:#fff}
  .card.card-multi-day{border-color:#ff9b84;box-shadow:0 0 0 1px rgba(255,155,132,0.2)}
  @media (max-width: 991px){.card{grid-template-columns:1fr}}
  .cover{height:120px;background:#e5e7eb;border:1px solid #e5e7eb;border-radius:12px}
  .cover.has-image{background-size:cover;background-position:center;border:none}
  .meta-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .title{font-weight:700;font-size:18px}
  .event-type-badge{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:700;white-space:nowrap}
  .event-type-badge.multi-day{background:#fff1ec;color:#c24c33;border:1px solid #ffb29f}
  .event-type-badge.recurring{background:#eaf8ee;color:#217a43;border:1px solid #9fd5af}
  .event-type-badge.one-time{background:#f3f4f6;color:#4b5563;border:1px solid #e5e7eb}
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
    .when-filter-row{align-items:flex-start}
    .active-filters-bar{align-items:flex-start}
    .active-filters-count{width:100%;margin-left:0;text-align:left}
    .meta-top{flex-direction:column;align-items:flex-start}
    .search-row{max-width:100%}
    .actions{width:100%;justify-content:stretch}
    .actions .btn{width:100%}
  }
`;
