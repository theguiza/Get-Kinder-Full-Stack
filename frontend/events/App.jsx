import React, { useEffect, useState } from "react";
import { EventsRouter } from "./router.js";
import { Drawer } from "./components/Drawer.jsx";
import { TopTabs } from "./components/TopTabs.jsx";
import { Feed } from "./views/Feed.jsx";
import { CreateEvent } from "./views/CreateEvent.jsx";
import { MyEvents } from "./views/MyEvents.jsx";
import { Invites } from "./views/Invites.jsx";
import { MyInvites } from "./views/MyInvites.jsx";
import { EventDetail } from "./views/EventDetail.jsx";

export function EventsApp(props = {}) {
  const {
    initialRoute = "events",
    initialFeed = [],
    pagination = { limit: 20, sort: "relevance" },
    brand = { primary: "#ff5656", ink: "#455a7c" },
    geoCheckinEnabled = false,
  } = props;

  const [route, setRoute] = useState(
    typeof window !== "undefined" && window.location.hash
      ? window.location.hash
      : `#/${initialRoute}`
  );
  const [drawerId, setDrawerId] = useState(null);
  const [feed, setFeed] = useState(Array.isArray(initialFeed) ? initialFeed : []);

  useEffect(() => {
    if (typeof window === "undefined") return () => {};
    const ensureDefaultHash = () => {
      if (!window.location.hash) {
        window.location.hash = `#/${initialRoute}`;
      }
    };
    ensureDefaultHash();
    const onHash = () => setRoute(window.location.hash || `#/${initialRoute}`);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [initialRoute]);

  useEffect(() => {
    if (!route) {
      setDrawerId(null);
      return;
    }
    const match = route.match(/^#\/events\/([^/?#]+)/);
    setDrawerId(match ? match[1] : null);
  }, [route]);

  const handleCloseDrawer = () => {
    if (typeof window !== "undefined") {
      window.location.hash = "#/events";
    }
  };

  const handleSelectEvent = (eventId) => {
    if (!eventId || typeof window === "undefined") return;
    window.location.hash = `#/events/${eventId}`;
  };

  return (
    <div
      className="events-app-shell"
      style={{
        "--events-brand": brand.primary,
        "--events-ink": brand.ink,
      }}
    >
      <TopTabs route={route} />

      <EventsRouter
        route={route}
        feed={feed}
        setFeed={setFeed}
        pagination={pagination}
        geoCheckinEnabled={geoCheckinEnabled}
        brand={brand}
        onSelectEvent={handleSelectEvent}
      >
        <Feed path="#/events" />
        <CreateEvent path="#/create" />
        <MyEvents path="#/my" />
        <Invites path="#/invites" />
        <MyInvites path="#/my-invites" />
      </EventsRouter>

      <Drawer open={Boolean(drawerId)} onClose={handleCloseDrawer}>
        {drawerId ? <EventDetail eventId={drawerId} /> : null}
      </Drawer>

    </div>
  );
}
