import {API_BASE_URL} from '@env';

function buildError(json, fallback) {
  return new Error(json?.error || fallback);
}

export async function fetchEvents({
  view = 'upcoming',
  limit = 20,
  cursor,
  community_tag,
  cause_tag,
} = {}) {
  const params = new URLSearchParams();

  if (view != null) {
    params.set('view', String(view));
  }
  if (limit != null) {
    params.set('limit', String(limit));
  }
  if (cursor && typeof cursor === 'object') {
    Object.entries(cursor).forEach(([key, value]) => {
      if (value != null) {
        params.set(key, String(value));
      }
    });
  }
  if (community_tag != null) {
    params.set('community_tag', String(community_tag));
  }
  if (cause_tag != null) {
    params.set('cause_tag', String(cause_tag));
  }

  const query = params.toString();
  const response = await fetch(
    `${API_BASE_URL}/api/events/${query ? `?${query}` : ''}`,
  );
  const json = await response.json();

  if (!response.ok || !json.ok) {
    throw buildError(json, 'Unable to load events');
  }

  return json;
}

export async function fetchEvent(id, token) {
  const response = await fetch(`${API_BASE_URL}/api/events/${id}`, {
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : undefined,
  });
  const json = await response.json();

  if (!response.ok || !json.ok) {
    throw buildError(json, 'Unable to load event');
  }

  return json;
}

export async function rsvpEvent(id, action, token) {
  const response = await fetch(`${API_BASE_URL}/api/events/${id}/rsvp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({action}),
  });
  const json = await response.json();

  if (!response.ok || !json.ok) {
    throw buildError(json, 'Unable to update RSVP');
  }

  return json;
}
