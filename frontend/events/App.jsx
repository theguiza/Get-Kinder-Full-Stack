import React, { useEffect, useState } from "react";
import {
  buildEventsTabUrl,
  EventsRouter,
  getEventDetailPath,
  getEventIdFromRoute,
  parseEventsLocation,
} from "./router.js";
import { Drawer } from "./components/Drawer.jsx";
import { TopTabs } from "./components/TopTabs.jsx";
import { Feed } from "./views/Feed.jsx";
import { Invites } from "./views/Invites.jsx";
import { EventDetail } from "./views/EventDetail.jsx";

function readInitialPreviewHtml() {
  if (typeof document === "undefined") return "";
  const shell = document.querySelector("#events-root > .events-ssr-shell");
  return shell ? shell.innerHTML : "";
}

function resolveInitialRoute(initialRoute) {
  if (typeof window === "undefined") {
    return initialRoute === "invites" ? "/invites" : "/events";
  }
  return parseEventsLocation(window.location, initialRoute).route;
}

export function EventsApp(props = {}) {
  const {
    initialRoute = "events",
    initialEventData = null,
    initialFeed = [],
    isAuthenticated = false,
    pagination = { limit: 20, sort: "relevance" },
    brand = { primary: "#ff5656", ink: "#455a7c" },
    geoCheckinEnabled = false,
  } = props;
  const [ssrPreviewHtml] = useState(() => readInitialPreviewHtml());
  const [interactiveReady, setInteractiveReady] = useState(() => !ssrPreviewHtml);
  const [route, setRoute] = useState(() => resolveInitialRoute(initialRoute));
  const [drawerId, setDrawerId] = useState(() => getEventIdFromRoute(resolveInitialRoute(initialRoute)));

  const [feed, setFeed] = useState(Array.isArray(initialFeed) ? initialFeed : []);

  useEffect(() => {
    if (!ssrPreviewHtml) return;
    setInteractiveReady(true);
  }, [ssrPreviewHtml]);

  useEffect(() => {
    if (typeof window === "undefined") return () => {};

    const syncRouteFromLocation = () => {
      const next = parseEventsLocation(window.location, initialRoute);
      if (next.replaceUrl) {
        window.history.replaceState({}, "", next.replaceUrl);
      }
      setRoute(next.route);
    };

    syncRouteFromLocation();
    window.addEventListener("hashchange", syncRouteFromLocation);
    window.addEventListener("popstate", syncRouteFromLocation);
    return () => {
      window.removeEventListener("hashchange", syncRouteFromLocation);
      window.removeEventListener("popstate", syncRouteFromLocation);
    };
  }, [initialRoute]);

  useEffect(() => {
    setDrawerId(getEventIdFromRoute(route));
  }, [route]);

  if (!interactiveReady && ssrPreviewHtml) {
    return <div className="events-ssr-shell" dangerouslySetInnerHTML={{ __html: ssrPreviewHtml }} />;
  }

  const navigate = (nextUrl, nextRoute) => {
    if (typeof window === "undefined") return;
    window.history.pushState({}, "", nextUrl);
    setRoute(nextRoute);
  };

  const handleCloseDrawer = () => {
    if (typeof window !== "undefined") {
      navigate(buildEventsTabUrl("/events", window.location.search || ""), "/events");
    }
  };

  const handleSelectEvent = (eventId) => {
    if (!eventId || typeof window === "undefined") return;
    const detailPath = getEventDetailPath(eventId);
    navigate(`${detailPath}${window.location.search || ""}`, detailPath);
  };

  const handleNavigate = (nextRoute) => {
    if (typeof window === "undefined") return;
    navigate(buildEventsTabUrl(nextRoute, window.location.search || ""), nextRoute);
  };

  return (
    <div
      className="events-app-shell"
      style={{
        "--events-brand": brand.primary,
        "--events-ink": brand.ink,
      }}
    >
      <TopTabs route={route} onNavigate={handleNavigate} />

      <EventsRouter
        route={route}
        feed={feed}
        setFeed={setFeed}
        pagination={pagination}
        geoCheckinEnabled={geoCheckinEnabled}
        brand={brand}
        onSelectEvent={handleSelectEvent}
      >
        <Feed path="/events" />
        <Invites path="/invites" />
      </EventsRouter>

      <Drawer open={Boolean(drawerId)} onClose={handleCloseDrawer}>
        {drawerId ? (
          <EventDetail
            eventId={drawerId}
            isAuthenticated={isAuthenticated}
            initialEventData={initialEventData}
            onCloseDetail={handleCloseDrawer}
            onNavigateToInvites={() => handleNavigate("/invites")}
          />
        ) : null}
      </Drawer>

    </div>
  );
}
