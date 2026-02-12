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

export async function fetchEventsList({ limit = 20, communityTag, causeTag, signal } = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (communityTag) params.set("community_tag", communityTag);
  if (causeTag) params.set("cause_tag", causeTag);
  const res = await fetch(`/api/events?${params.toString()}`, { signal, credentials: "include" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    const message = json?.error || "Failed to load events";
    throw new Error(message);
  }
  return Array.isArray(json?.data) ? json.data : [];
}
