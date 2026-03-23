import React from "react";

export function getEventDetailPath(eventId) {
  const id = String(eventId || "").trim();
  return id ? `/events/${encodeURIComponent(id)}` : "/events";
}

function normalizeRouteCandidate(value, fallback = "/events") {
  const rawValue = String(value || "").trim();
  const withoutHash = rawValue.startsWith("#") ? rawValue.slice(1) : rawValue;
  const raw = withoutHash.split("?")[0];

  if (!raw) return fallback;
  if (raw === "/events" || raw === "/events/") return "/events";
  if (raw === "/invites" || raw === "/invites/") return "/invites";

  const match = raw.match(/^\/events\/([^/?#]+)/);
  if (!match) return fallback;

  try {
    return getEventDetailPath(decodeURIComponent(match[1]));
  } catch {
    return getEventDetailPath(match[1]);
  }
}

export function getEventIdFromRoute(route) {
  const normalized = normalizeRouteCandidate(route, "");
  const match = normalized.match(/^\/events\/([^/?#]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function normalizeEventsRoute(route) {
  const normalized = normalizeRouteCandidate(route, "/events");
  return getEventIdFromRoute(normalized) ? "/events" : normalized;
}

export function buildEventsTabUrl(route, search = "") {
  const params = new URLSearchParams(search || "");
  if (route === "/invites") {
    params.set("route", "invites");
  } else {
    params.delete("route");
  }
  const query = params.toString();
  return `/events${query ? `?${query}` : ""}`;
}

export function parseEventsLocation(locationLike, initialRoute = "events") {
  const fallbackRoute = initialRoute === "invites" ? "/invites" : "/events";
  const pathname = String(locationLike?.pathname || "");
  const search = String(locationLike?.search || "");
  const hash = String(locationLike?.hash || "");

  const legacyHashRoute = normalizeRouteCandidate(hash, fallbackRoute);
  const legacyHashEventId = getEventIdFromRoute(legacyHashRoute);
  if (legacyHashEventId) {
    return {
      route: getEventDetailPath(legacyHashEventId),
      detailId: legacyHashEventId,
      replaceUrl: `${getEventDetailPath(legacyHashEventId)}${search}`,
    };
  }

  const pathRoute = normalizeRouteCandidate(pathname, fallbackRoute);
  const pathEventId = getEventIdFromRoute(pathRoute);
  if (pathEventId) {
    return {
      route: pathRoute,
      detailId: pathEventId,
      replaceUrl: null,
    };
  }

  return {
    route: legacyHashRoute,
    detailId: null,
    replaceUrl: null,
  };
}

export function EventsRouter({ route, children, ...rest }) {
  const activePath = normalizeEventsRoute(route);
  const childArray = React.Children.toArray(children);
  const match = childArray.find((child) => child.props.path === activePath);
  if (!match) {
    const fallback = childArray.find((child) => child.props.path === "/events");
    return fallback ? React.cloneElement(fallback, rest) : null;
  }
  return React.cloneElement(match, rest);
}
