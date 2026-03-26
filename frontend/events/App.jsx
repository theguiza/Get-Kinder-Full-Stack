import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildEventsTabUrl,
  EventsRouter,
  getEventDetailPath,
  getEventIdFromRoute,
  normalizeEventsRoute,
  parseEventsLocation,
} from "./router.js";
import { Drawer } from "./components/Drawer.jsx";
import { Feed } from "./views/Feed.jsx";
import { EventDetail } from "./views/EventDetail.jsx";
import OrgTab from "./views/OrgTab.jsx";

function readInitialPreviewHtml() {
  if (typeof document === "undefined") return "";
  const shell = document.querySelector("#events-root > .events-ssr-shell");
  return shell ? shell.innerHTML : "";
}

function resolveInitialRoute(initialRoute) {
  if (typeof window === "undefined") {
    return "/events";
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
  const [activeTab, setActiveTab] = useState("orgs");

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

  const normalizedRoute = normalizeEventsRoute(route);
  const showDiscoveryTabs = normalizedRoute === "/events";
  const discoveryTabMount = typeof document !== "undefined"
    ? document.getElementById("events-discovery-tabs-root")
    : null;
  const discoveryTabs = showDiscoveryTabs ? (
    <div
      style={{
        background: "#fff",
        borderBottom: "0.5px solid #d6deeb",
      }}
    >
      <div
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "0 1.5rem",
          display: "flex",
          alignItems: "center",
          gap: 8,
          overflowX: "auto",
        }}
      >
        {[
          { value: "orgs", label: "Opportunities by Organization" },
          { value: "browse", label: "Browse Opportunities" },
        ].map((item) => {
          const isActive = activeTab === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setActiveTab(item.value)}
              style={{
                appearance: "none",
                border: 0,
                borderBottom: isActive ? "2px solid #ff5656" : "2px solid transparent",
                background: "transparent",
                color: isActive ? "#455a7c" : "#6b7280",
                fontSize: 15,
                fontWeight: 700,
                padding: "12px 20px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div
      className="events-app-shell"
      style={{
        "--events-brand": brand.primary,
        "--events-ink": brand.ink,
      }}
    >
      {discoveryTabMount ? createPortal(discoveryTabs, discoveryTabMount) : discoveryTabs}

      <EventsRouter
        route={route}
        feed={feed}
        setFeed={setFeed}
        pagination={pagination}
        geoCheckinEnabled={geoCheckinEnabled}
        brand={brand}
        onSelectEvent={handleSelectEvent}
      >
        {activeTab === "orgs" ? <OrgTab path="/events" /> : <Feed path="/events" />}
      </EventsRouter>

      <Drawer open={Boolean(drawerId)} onClose={handleCloseDrawer}>
        {drawerId ? (
          <EventDetail
            eventId={drawerId}
            isAuthenticated={isAuthenticated}
            initialEventData={initialEventData}
            onCloseDetail={handleCloseDrawer}
          />
        ) : null}
      </Drawer>

    </div>
  );
}
