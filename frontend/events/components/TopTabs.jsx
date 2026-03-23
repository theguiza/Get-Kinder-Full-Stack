import React, { useEffect, useState } from "react";
import { buildEventsTabUrl, normalizeEventsRoute } from "../router.js";

export function TopTabs({ route, onNavigate }) {
  const [active, setActive] = useState(normalizeEventsRoute(route));

  useEffect(() => {
    setActive(normalizeEventsRoute(route));
  }, [route]);

  const search = typeof window !== "undefined" ? window.location.search || "" : "";
  const items = [
    { href: buildEventsTabUrl("/events", search), route: "/events", label: "Events" },
    { href: buildEventsTabUrl("/invites", search), route: "/invites", label: "Invites" },
  ];

  return (
    <nav className="events-tabs" role="tablist" aria-label="Events navigation">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className={`tab-link${active === item.route ? " active" : ""}`}
          aria-current={active === item.route ? "page" : undefined}
          onClick={(event) => {
            if (typeof onNavigate !== "function") return;
            event.preventDefault();
            onNavigate(item.route);
          }}
        >
          {item.label}
        </a>
      ))}
      <style>{`
        .events-tabs {
          display:flex;
          gap:36px;
          align-items:center;
          border:1px solid #d6deeb;
          border-radius:18px;
          padding:18px 32px;
          background:#fff;
          margin:12px 0 20px;
          flex-wrap:wrap;
          box-shadow:0 12px 30px rgba(15,23,42,0.08);
        }
        .tab-link {
          font-weight:700;
          font-size:1.2rem;
          color:#455a7c;
          text-decoration:none;
        }
        .tab-link.active {
          color:#20304d;
        }
        .tab-link:hover {
          text-decoration:underline;
        }
      `}</style>
    </nav>
  );
}
