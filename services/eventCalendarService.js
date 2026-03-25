function formatIcsDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString().replace(/[-:]/g, "").split(".")[0];
  return `${iso}Z`;
}

function escapeIcsText(value) {
  if (!value) return "";
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function buildEventCalendarInvite({
  eventId,
  title,
  description,
  startAt,
  endAt,
  locationText,
  baseUrl = process.env.APP_BASE_URL || "https://getkinder.ai",
} = {}) {
  const normalizedBaseUrl = String(baseUrl || "https://getkinder.ai").replace(/\/+$/, "");
  const start = formatIcsDate(startAt);
  const end = formatIcsDate(endAt || startAt);
  if (!eventId || !start || !end) return null;

  const summary = title || "Get Kinder Event";
  const eventLink = `${normalizedBaseUrl}/events/${encodeURIComponent(String(eventId))}`;
  const uid = `${eventId}@getkinder.ai`;
  const now = formatIcsDate(new Date());
  const safeDescription = description || "";
  const safeLocation = locationText || "";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Get Kinder//Events//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    safeDescription
      ? `DESCRIPTION:${escapeIcsText(safeDescription)}\\n${escapeIcsText(eventLink)}`
      : `DESCRIPTION:${escapeIcsText(eventLink)}`,
    safeLocation ? `LOCATION:${escapeIcsText(safeLocation)}` : "",
    `URL:${escapeIcsText(eventLink)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return {
    content: lines.join("\r\n"),
    fileName: `${summary.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "event"}.ics`,
    eventLink,
  };
}
