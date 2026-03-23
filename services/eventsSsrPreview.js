function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatEventListDate(startAt, endAt, tz) {
  if (!startAt) return "Date TBD";
  try {
    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) return "Date TBD";
    const zone = tz || "UTC";
    const startLabel = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
    }).format(start);
    const end = endAt ? new Date(endAt) : null;
    if (end && !Number.isNaN(end.getTime())) {
      const endLabel = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: zone,
      }).format(end);
      return `${startLabel} - ${endLabel} (${zone})`;
    }
    return `${startLabel} (${zone})`;
  } catch {
    return "Date TBD";
  }
}

function formatEventDetailDate(startAt, tz) {
  if (!startAt) return "Date TBD";
  try {
    return new Date(startAt).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz || "UTC",
    });
  } catch {
    return String(startAt);
  }
}

function formatEventSummaryLine(startAt, endAt, tz, locationText) {
  const location = locationText || "Location TBD";
  if (!startAt) return location;
  try {
    const zone = tz || "America/Vancouver";
    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) return location;
    const startLabel = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
    }).format(start);
    const end = endAt ? new Date(endAt) : null;
    const endLabel = end && !Number.isNaN(end.getTime())
      ? new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: zone,
        }).format(end)
      : "Time TBD";
    return `${startLabel} - ${endLabel} · ${location}`;
  } catch {
    return location;
  }
}

function truncateText(value, maxLength = 180) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

function renderCauseTags(tags = []) {
  const items = Array.isArray(tags) ? tags.filter(Boolean) : [];
  if (!items.length) return "";
  return `
    <div class="events-ssr-tag-row">
      ${items.map((tag) => `<span class="events-ssr-tag">${escapeHtml(tag)}</span>`).join("")}
    </div>
  `;
}

function renderEventCard(event, selectedEventId) {
  if (!event?.id) return "";
  const isSelected = selectedEventId && String(selectedEventId) === String(event.id);
  const orgName = event.org_name || "Independent organizer";
  const description = truncateText(event.description || event.requirements || "", 140);
  const communityTag = event.community_tag ? `<span class="events-ssr-chip">${escapeHtml(event.community_tag)}</span>` : "";
  const primaryCause = Array.isArray(event.cause_tags) && event.cause_tags[0]
    ? `<span class="events-ssr-chip">${escapeHtml(event.cause_tags[0])}</span>`
    : "";
  const cover = event.cover_url
    ? `<div class="events-ssr-card-cover"><img src="${escapeHtml(event.cover_url)}" alt="" loading="lazy"></div>`
    : "";

  return `
    <article class="events-ssr-card${isSelected ? " is-selected" : ""}"${isSelected ? ' aria-current="true"' : ""}>
      ${cover}
      <div class="events-ssr-card-body">
        <div class="events-ssr-card-kicker">${escapeHtml(orgName)}${communityTag || primaryCause ? " · " : ""}${communityTag}${primaryCause}</div>
        <h2 class="events-ssr-card-title">
          <a href="/events/${encodeURIComponent(event.id)}">${escapeHtml(event.title || "Untitled Event")}</a>
        </h2>
        <p class="events-ssr-card-meta">${escapeHtml(formatEventListDate(event.start_at, event.end_at, event.tz))}</p>
        <p class="events-ssr-card-meta">${escapeHtml(event.location_text || "Location TBD")}</p>
        ${description ? `<p class="events-ssr-card-description">${escapeHtml(description)}</p>` : ""}
        ${renderCauseTags(Array.isArray(event.cause_tags) ? event.cause_tags.slice(1, 4) : [])}
      </div>
    </article>
  `;
}

function renderSelectedEvent(event) {
  if (!event) return "";
  const description = String(event.description || "").trim();
  const requirements = String(event.requirements || "").trim();
  const safetyNotes = String(event.safety_notes || "").trim();
  const orgName = event.org_name || "Independent organizer";
  const credits = Number.isFinite(Number(event.impact_credits_base))
    ? Number(event.impact_credits_base)
    : 25;

  return `
    <section class="events-ssr-detail" aria-label="Selected event">
      <p class="events-ssr-detail-eyebrow">Selected event</p>
      <h2 class="events-ssr-detail-title">${escapeHtml(event.title || "Event detail")}</h2>
      <p class="events-ssr-detail-summary">${escapeHtml(formatEventSummaryLine(event.start_at, event.end_at, event.tz, event.location_text))}</p>
      <div class="events-ssr-detail-grid">
        <div>
          <span class="events-ssr-detail-label">Organization</span>
          <p>${escapeHtml(orgName)}</p>
        </div>
        <div>
          <span class="events-ssr-detail-label">Community tag</span>
          <p>${escapeHtml(event.community_tag || "General")}</p>
        </div>
        <div>
          <span class="events-ssr-detail-label">Verification</span>
          <p>${escapeHtml(event.verification_method || "host_attest")}</p>
        </div>
        <div>
          <span class="events-ssr-detail-label">Impact Credits</span>
          <p>${escapeHtml(String(credits))}</p>
        </div>
        <div>
          <span class="events-ssr-detail-label">Date</span>
          <p>${escapeHtml(formatEventDetailDate(event.start_at, event.tz))}</p>
        </div>
        <div>
          <span class="events-ssr-detail-label">Location</span>
          <p>${escapeHtml(event.location_text || "Location TBD")}</p>
        </div>
      </div>
      ${renderCauseTags(event.cause_tags)}
      ${description ? `
        <div class="events-ssr-detail-copy">
          <span class="events-ssr-detail-label">Description</span>
          <p>${escapeHtml(description)}</p>
        </div>
      ` : ""}
      ${requirements ? `
        <div class="events-ssr-detail-copy">
          <span class="events-ssr-detail-label">Requirements</span>
          <p>${escapeHtml(requirements)}</p>
        </div>
      ` : ""}
      ${safetyNotes ? `
        <div class="events-ssr-detail-copy">
          <span class="events-ssr-detail-label">Safety notes</span>
          <p>${escapeHtml(safetyNotes)}</p>
        </div>
      ` : ""}
      <p class="events-ssr-detail-link">
        <a href="/events/${encodeURIComponent(event.id)}">Open this event</a>
      </p>
    </section>
  `;
}

function renderMissingSelectedEvent(selectedEventId) {
  if (!selectedEventId) return "";
  return `
    <section class="events-ssr-detail" aria-label="Selected event">
      <p class="events-ssr-detail-eyebrow">Selected event</p>
      <h2 class="events-ssr-detail-title">Event not found</h2>
      <p class="events-ssr-detail-summary">
        The event <code>${escapeHtml(selectedEventId)}</code> is unavailable or no longer public.
      </p>
    </section>
  `;
}

export function renderEventsSsrPreview({ feed = [], selectedEvent = null, selectedEventId = null } = {}) {
  const items = Array.isArray(feed) ? feed.filter(Boolean) : [];
  const selectedId = selectedEventId || selectedEvent?.id || null;
  const detailHtml = selectedEvent
    ? renderSelectedEvent(selectedEvent)
    : renderMissingSelectedEvent(selectedId);

  return `
    ${detailHtml}
    <section class="events-ssr-feed" aria-label="Volunteer opportunities">
      <div class="events-ssr-feed-head">
        <h2 class="events-ssr-feed-title">Volunteer opportunities</h2>
        <p class="events-ssr-feed-copy">Browse published public events on Get Kinder.</p>
      </div>
      <div class="events-ssr-feed-grid">
        ${
          items.length
            ? items.map((event) => renderEventCard(event, selectedId)).join("")
            : '<div class="events-ssr-empty">No public events are available right now.</div>'
        }
      </div>
    </section>
  `;
}
