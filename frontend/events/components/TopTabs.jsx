import React, { useEffect, useState } from "react";

function normalize(hash) {
  const h = (hash || "#/events").split("?")[0];
  return h.startsWith("#/events/") ? "#/events" : h;
}

export function TopTabs({ route }) {
  const [active, setActive] = useState(normalize(route));

  useEffect(() => {
    setActive(normalize(route));
  }, [route]);

  const items = [
    { href: "#/events", label: "Events" },
    { href: "#/create", label: "Create" },
    { href: "#/my", label: "My Events" },
    { href: "#/invites", label: "Invites" },
  ];

  return (
    <nav className="events-tabs" role="tablist" aria-label="Events navigation">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className={`tab-link${active === item.href ? " active" : ""}`}
          aria-current={active === item.href ? "page" : undefined}
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
