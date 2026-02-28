export async function verifyRsvp(eventId, payload = {}) {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    const message = json?.error || "Unable to verify attendee";
    throw new Error(message);
  }
  return json;
}

export async function fetchRoster(eventId, { signal } = {}) {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/roster`, {
    signal,
    credentials: "include",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    const message = json?.error || "Unable to load roster";
    throw new Error(message);
  }
  return Array.isArray(json?.data) ? json.data : [];
}

export async function fetchEventsList({
  limit = 20,
  view,
  cursor,
  communityTag,
  causeTag,
  signal,
} = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (view === "archive") params.set("view", "archive");
  if (cursor && typeof cursor === "object") {
    if (cursor.after_start_at) params.set("after_start_at", cursor.after_start_at);
    if (cursor.after_id) params.set("after_id", cursor.after_id);
    if (cursor.before_start_at) params.set("before_start_at", cursor.before_start_at);
    if (cursor.before_id) params.set("before_id", cursor.before_id);
  }
  if (communityTag) params.set("community_tag", communityTag);
  if (causeTag) params.set("cause_tag", causeTag);
  const url = `/api/events?${params.toString()}`;
  const isDebug =
    typeof window !== "undefined" &&
    window.localStorage &&
    window.localStorage.getItem("eventsDebug") === "1";
  if (isDebug) console.log("[events] GET /api/events", url);
  const res = await fetch(url, { signal, credentials: "include" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    const message = json?.error || "Failed to load events";
    throw new Error(message);
  }
  return Array.isArray(json?.data) ? json.data : [];
}
