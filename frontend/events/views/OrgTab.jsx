import React, { useEffect, useMemo, useState } from "react";

const PAGE_BACKGROUND = "#fff";
const CARD_BACKGROUND = "#fff";
const CARD_BORDER = "0.5px solid #d6deeb";
const EXPANDED_BORDER = "1px solid #455a7c";
const PRIMARY_TEXT = "#455a7c";
const SECONDARY_TEXT = "#6b7280";
const CTA_BACKGROUND = "#ff5656";
const CTA_TEXT = "#fff";
const SECONDARY_BUTTON_BORDER = "0.5px solid #d6deeb";
const COLLAPSE_TEXT = "#ff5656";
const CAMPAIGN_BADGE_BACKGROUND = "#ffe8e8";
const CAMPAIGN_BADGE_TEXT = "#b83030";
const CAMPAIGN_BADGE_BORDER = "0.5px solid #f5c4b3";
const RECURRING_BADGE_BACKGROUND = "#e8f5e9";
const RECURRING_BADGE_TEXT = "#2e6b33";
const RECURRING_BADGE_BORDER = "0.5px solid #c0dd97";
const AVATAR_PALETTES = [
  { background: "#e8f0ff", color: "#3050a0" },
  { background: "#e8f5e9", color: "#2e6b33" },
  { background: "#fff3e0", color: "#8b5000" },
  { background: "#fce4ec", color: "#8b1a3a" },
];

function truncateText(value, maxLength = 80) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "No description available.";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function getInitials(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "OR";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
}

function formatShortDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatCardDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const month = date.toLocaleDateString(undefined, { month: "long" });
  return `${date.getDate()} ${month}`;
}

function formatEventDate(value) {
  if (!value) return "Date TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date TBD";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRating(value, count = 0) {
  const sampleSize = Number(count) || 0;
  if (sampleSize <= 0) return "5.0";
  const rating = Number(value);
  if (Number.isFinite(rating)) return rating.toFixed(1);
  return "5.0";
}

function formatUpcomingCount(value) {
  const count = Number(value) || 0;
  if (count <= 0) return "No upcoming events";
  if (count === 1) return "1 upcoming event";
  return `${count} upcoming events`;
}

function formatCapacityLabel(event) {
  const capacity = Number(event?.capacity);
  const accepted = Number(event?.rsvp_counts?.accepted) || 0;
  if (Number.isFinite(capacity) && capacity > 0) {
    const spotsLeft = Math.max(capacity - accepted, 0);
    return `${spotsLeft} spots left`;
  }
  return "Open capacity";
}

function groupEventsByType(events) {
  const groups = {
    multi_day: [],
    one_time: [],
    recurring: [],
  };

  (Array.isArray(events) ? events : []).forEach((event) => {
    const key = event?.event_type === "multi_day" || event?.event_type === "recurring"
      ? event.event_type
      : "one_time";
    groups[key].push(event);
  });

  return groups;
}

function buildAvatarStyle(index) {
  const palette = AVATAR_PALETTES[index % AVATAR_PALETTES.length];
  return {
    width: 56,
    height: 56,
    minWidth: 56,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: palette.background,
    color: palette.color,
    fontSize: 18,
    fontWeight: 700,
    overflow: "hidden",
    textTransform: "uppercase",
  };
}

function renderAvatar(org, index, size = 56) {
  const avatarStyle = {
    ...buildAvatarStyle(index),
    width: size,
    height: size,
    minWidth: size,
    fontSize: size >= 64 ? 20 : 18,
  };

  if (org?.logo_url) {
    return (
      <img
        src={org.logo_url}
        alt={`${org.name || "Organization"} logo`}
        style={{
          ...avatarStyle,
          objectFit: "cover",
          display: "block",
        }}
      />
    );
  }

  return <div style={avatarStyle}>{getInitials(org?.name)}</div>;
}

function EventRow({ event, ctaLabel, badge, compact = false }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: compact ? "16px 18px" : "18px 20px",
        border: CARD_BORDER,
        borderRadius: 18,
        background: CARD_BACKGROUND,
      }}
    >
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 6,
          }}
        >
          <div
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: PRIMARY_TEXT,
              lineHeight: 1.3,
            }}
          >
            {event?.title || "Untitled Event"}
          </div>
          {badge}
        </div>
        <div
          style={{
            fontSize: 14,
            color: SECONDARY_TEXT,
            lineHeight: 1.5,
          }}
        >
          {formatEventDate(event?.start_at)}
          {" • "}
          {formatCapacityLabel(event)}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          if (typeof window !== "undefined" && event?.id) {
            window.location.assign(`/events/${encodeURIComponent(String(event.id))}`);
          }
        }}
        style={{
          appearance: "none",
          border: 0,
          borderRadius: 999,
          background: CTA_BACKGROUND,
          color: CTA_TEXT,
          fontSize: 14,
          fontWeight: 700,
          padding: "12px 16px",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {ctaLabel}
      </button>
    </div>
  );
}

export function OrgTab() {
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [expandedOrgId, setExpandedOrgId] = useState(null);
  const [eventsByOrg, setEventsByOrg] = useState({});

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    async function loadOrganizations() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/organizations", { signal: controller.signal });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.error || "Could not load organizations.");
        }
        if (!alive) return;
        setOrganizations(Array.isArray(json?.organizations) ? json.organizations : []);
      } catch (err) {
        if (err?.name === "AbortError") return;
        if (!alive) return;
        setError("Could not load organizations.");
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    loadOrganizations();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [reloadToken]);

  async function loadEventsForOrg(orgId, { force = false } = {}) {
    const existing = eventsByOrg[orgId];
    if (!force && existing?.loading) return;
    if (!force && Array.isArray(existing?.items)) return;

    setEventsByOrg((prev) => ({
      ...prev,
      [orgId]: {
        items: Array.isArray(prev?.[orgId]?.items) ? prev[orgId].items : null,
        loading: true,
        error: null,
      },
    }));

    try {
      const res = await fetch(`/api/organizations/${encodeURIComponent(String(orgId))}/events`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || "Could not load organization events.");
      }
      setEventsByOrg((prev) => ({
        ...prev,
        [orgId]: {
          items: Array.isArray(json?.events) ? json.events : [],
          loading: false,
          error: null,
        },
      }));
    } catch (err) {
      setEventsByOrg((prev) => ({
        ...prev,
        [orgId]: {
          items: Array.isArray(prev?.[orgId]?.items) ? prev[orgId].items : [],
          loading: false,
          error: "Could not load organization events.",
        },
      }));
    }
  }

  function handleRetryOrganizations() {
    setReloadToken((value) => value + 1);
  }

  function handleExpand(orgId) {
    setExpandedOrgId(orgId);
    loadEventsForOrg(orgId);
  }

  function handleCollapse() {
    setExpandedOrgId(null);
  }

  const expandedEventsState = expandedOrgId !== null
    ? (eventsByOrg[expandedOrgId] || { items: null, loading: false, error: null })
    : null;

  const groupedExpandedEvents = useMemo(
    () => groupEventsByType(expandedEventsState?.items || []),
    [expandedEventsState]
  );

  return (
    <div
      style={{
        background: PAGE_BACKGROUND,
        padding: "24px 0 48px",
      }}
    >
      <div
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "0 20px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: 18,
            alignItems: "start",
            minHeight: 240,
          }}
        >
          {loading ? (
            <div
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 220,
                color: PRIMARY_TEXT,
                fontSize: 18,
                fontWeight: 600,
              }}
            >
              Loading organizations...
            </div>
          ) : null}

          {!loading && error ? (
            <div
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 14,
                minHeight: 220,
                color: PRIMARY_TEXT,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 600 }}>
                Could not load organizations.
              </div>
              <button
                type="button"
                onClick={handleRetryOrganizations}
                style={{
                  appearance: "none",
                  borderRadius: 999,
                  border: SECONDARY_BUTTON_BORDER,
                  background: CARD_BACKGROUND,
                  color: PRIMARY_TEXT,
                  fontSize: 14,
                  fontWeight: 700,
                  padding: "11px 16px",
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            </div>
          ) : null}

          {!loading && !error && organizations.length === 0 ? (
            <div
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 220,
                color: SECONDARY_TEXT,
                fontSize: 16,
              }}
            >
              No organizations available.
            </div>
          ) : null}

          {!loading && !error
            ? organizations.map((org, index) => {
                const isExpanded = expandedOrgId === org.id;
                const nextDate = formatShortDate(org?.next_event_at);
                const cardNextDate = formatCardDate(org?.next_event_at);
                const ratingText = formatRating(org?.rating_value, org?.rating_count);

                if (isExpanded) {
                  return (
                    <div
                      key={org.id}
                      style={{
                        gridColumn: "1 / -1",
                        background: CARD_BACKGROUND,
                        border: EXPANDED_BORDER,
                        borderRadius: 28,
                        padding: 24,
                        boxShadow: "0 12px 30px rgba(69, 90, 124, 0.08)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 18,
                          flexWrap: "wrap",
                          marginBottom: 20,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 16,
                            flex: "1 1 420px",
                            minWidth: 0,
                          }}
                        >
                          {renderAvatar(org, index, 64)}
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                color: PRIMARY_TEXT,
                                fontSize: 28,
                                fontWeight: 800,
                                lineHeight: 1.1,
                                marginBottom: 8,
                              }}
                            >
                              {org?.name || "Organization"}
                            </div>
                            <div
                              style={{
                                color: SECONDARY_TEXT,
                                fontSize: 15,
                                lineHeight: 1.6,
                                maxWidth: 720,
                              }}
                            >
                              {org?.description || "No description available."}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={handleCollapse}
                          style={{
                            appearance: "none",
                            border: 0,
                            background: "transparent",
                            color: COLLAPSE_TEXT,
                            fontSize: 15,
                            fontWeight: 700,
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          Collapse ↑
                        </button>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          flexWrap: "wrap",
                          marginBottom: 24,
                        }}
                      >
                        <div
                          style={{
                            border: CARD_BORDER,
                            borderRadius: 999,
                            padding: "8px 12px",
                            color: PRIMARY_TEXT,
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          {formatUpcomingCount(org?.upcoming_event_count)}
                        </div>
                        <div
                          style={{
                            border: CARD_BORDER,
                            borderRadius: 999,
                            padding: "8px 12px",
                            color: PRIMARY_TEXT,
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          {nextDate ? `Next: ${nextDate}` : "Next: TBD"}
                        </div>
                        <div
                          style={{
                            border: CARD_BORDER,
                            borderRadius: 999,
                            padding: "8px 12px",
                            color: PRIMARY_TEXT,
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          Rating: {ratingText}
                        </div>
                      </div>

                      {expandedEventsState?.loading ? (
                        <div
                          style={{
                            padding: "20px 0 8px",
                            color: PRIMARY_TEXT,
                            fontSize: 16,
                            fontWeight: 600,
                          }}
                        >
                          Loading organization events...
                        </div>
                      ) : null}

                      {!expandedEventsState?.loading && expandedEventsState?.error ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            flexWrap: "wrap",
                            padding: 18,
                            border: CARD_BORDER,
                            borderRadius: 18,
                            color: PRIMARY_TEXT,
                          }}
                        >
                          <div>{expandedEventsState.error}</div>
                          <button
                            type="button"
                            onClick={() => loadEventsForOrg(org.id, { force: true })}
                            style={{
                              appearance: "none",
                              borderRadius: 999,
                              border: SECONDARY_BUTTON_BORDER,
                              background: CARD_BACKGROUND,
                              color: PRIMARY_TEXT,
                              fontSize: 14,
                              fontWeight: 700,
                              padding: "10px 14px",
                              cursor: "pointer",
                            }}
                          >
                            Retry
                          </button>
                        </div>
                      ) : null}

                      {!expandedEventsState?.loading
                        && !expandedEventsState?.error
                        && Array.isArray(expandedEventsState?.items)
                        && expandedEventsState.items.length === 0 ? (
                          <div
                            style={{
                              padding: 18,
                              border: CARD_BORDER,
                              borderRadius: 18,
                              color: SECONDARY_TEXT,
                              fontSize: 15,
                            }}
                          >
                            No upcoming events right now.
                          </div>
                        ) : null}

                      {!expandedEventsState?.loading
                        && !expandedEventsState?.error
                        && groupedExpandedEvents.multi_day.length > 0 ? (
                          <div style={{ marginBottom: 22 }}>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                marginBottom: 12,
                              }}
                            >
                              <div
                                style={{
                                  color: PRIMARY_TEXT,
                                  fontSize: 18,
                                  fontWeight: 800,
                                }}
                              >
                                Campaigns
                              </div>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  borderRadius: 999,
                                  padding: "6px 10px",
                                  background: CAMPAIGN_BADGE_BACKGROUND,
                                  color: CAMPAIGN_BADGE_TEXT,
                                  border: CAMPAIGN_BADGE_BORDER,
                                  fontSize: 12,
                                  fontWeight: 700,
                                }}
                              >
                                Multi-day
                              </span>
                            </div>
                            <div
                              style={{
                                display: "grid",
                                gap: 12,
                              }}
                            >
                              {groupedExpandedEvents.multi_day.map((event) => (
                                <EventRow
                                  key={event.id}
                                  event={event}
                                  ctaLabel="View roles →"
                                  badge={null}
                                />
                              ))}
                            </div>
                          </div>
                        ) : null}

                      {!expandedEventsState?.loading
                        && !expandedEventsState?.error
                        && groupedExpandedEvents.one_time.length > 0 ? (
                          <div style={{ marginBottom: 22 }}>
                            <div
                              style={{
                                color: PRIMARY_TEXT,
                                fontSize: 18,
                                fontWeight: 800,
                                marginBottom: 12,
                              }}
                            >
                              Upcoming Events
                            </div>
                            <div
                              style={{
                                display: "grid",
                                gap: 12,
                              }}
                            >
                              {groupedExpandedEvents.one_time.map((event) => (
                                <EventRow
                                  key={event.id}
                                  event={event}
                                  ctaLabel="View & Sign Up"
                                  compact
                                  badge={null}
                                />
                              ))}
                            </div>
                          </div>
                        ) : null}

                      {!expandedEventsState?.loading
                        && !expandedEventsState?.error
                        && groupedExpandedEvents.recurring.length > 0 ? (
                          <div>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                marginBottom: 12,
                                flexWrap: "wrap",
                              }}
                            >
                              <div
                                style={{
                                  color: PRIMARY_TEXT,
                                  fontSize: 18,
                                  fontWeight: 800,
                                }}
                              >
                                Ongoing — join any time
                              </div>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  borderRadius: 999,
                                  padding: "6px 10px",
                                  background: RECURRING_BADGE_BACKGROUND,
                                  color: RECURRING_BADGE_TEXT,
                                  border: RECURRING_BADGE_BORDER,
                                  fontSize: 12,
                                  fontWeight: 700,
                                }}
                              >
                                Recurring
                              </span>
                            </div>
                            <div
                              style={{
                                display: "grid",
                                gap: 12,
                              }}
                            >
                              {groupedExpandedEvents.recurring.map((event) => (
                                <EventRow
                                  key={event.id}
                                  event={event}
                                  ctaLabel="Join"
                                  compact
                                  badge={null}
                                />
                              ))}
                            </div>
                          </div>
                        ) : null}
                    </div>
                  );
                }

                return (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => handleExpand(org.id)}
                    style={{
                      appearance: "none",
                      width: "100%",
                      textAlign: "left",
                      background: CARD_BACKGROUND,
                      border: CARD_BORDER,
                      borderRadius: 24,
                      padding: 20,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 16,
                      boxShadow: "0 10px 24px rgba(69, 90, 124, 0.05)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 14,
                      }}
                    >
                      {renderAvatar(org, index)}
                      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                        <div
                          style={{
                            color: PRIMARY_TEXT,
                            fontSize: 20,
                            fontWeight: 800,
                            lineHeight: 1.2,
                            marginBottom: 6,
                          }}
                        >
                          {org?.name || "Organization"}
                        </div>
                        <div
                          style={{
                            color: SECONDARY_TEXT,
                            fontSize: 14,
                            lineHeight: 1.6,
                          }}
                        >
                          {truncateText(org?.description, 80)}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 8,
                        fontSize: 14,
                        lineHeight: 1.5,
                      }}
                    >
                      <div
                        style={{
                          color: CTA_BACKGROUND,
                          fontWeight: 700,
                        }}
                      >
                        {formatUpcomingCount(org?.upcoming_event_count)}
                      </div>
                      <span
                        style={{
                          color: SECONDARY_TEXT,
                        }}
                      >
                        •
                      </span>
                      <div
                        style={{
                          color: SECONDARY_TEXT,
                        }}
                      >
                        {cardNextDate ? `Next: ${cardNextDate}` : "Next: TBD"}
                      </div>
                      <span
                        style={{
                          color: SECONDARY_TEXT,
                        }}
                      >
                        •
                      </span>
                      <div
                        style={{
                          color: SECONDARY_TEXT,
                        }}
                      >
                        Rating: {ratingText}
                      </div>
                    </div>

                    <div style={{ paddingTop: 4 }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: 999,
                          border: SECONDARY_BUTTON_BORDER,
                          color: PRIMARY_TEXT,
                          fontSize: 14,
                          fontWeight: 700,
                          padding: "10px 14px",
                        }}
                      >
                        Explore Opportunities
                      </span>
                    </div>
                  </button>
                );
              })
            : null}
        </div>
      </div>
    </div>
  );
}

export default OrgTab;
