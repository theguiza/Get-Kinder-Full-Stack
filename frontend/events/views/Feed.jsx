import React, { useEffect } from "react";

export function Feed({ feed = [], setFeed, pagination }) {
  useEffect(() => {
    if (Array.isArray(feed) && feed.length > 0) return;
    if (typeof fetch !== "function") return;
    let alive = true;
    const controller = new AbortController();
    const limit = pagination?.limit || 20;
    fetch(`/api/events?limit=${encodeURIComponent(limit)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load events"))))
      .then((json) => {
        if (!alive || !setFeed) return;
        setFeed(Array.isArray(json?.data) ? json.data : []);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [feed, pagination?.limit, setFeed]);

  const hasEvents = Array.isArray(feed) && feed.length > 0;

  return (
    <section className="events-feed">
      <header className="feed-head">
        <input className="search" placeholder="Search events, people, places…" />
        <div className="pills">
          <span className="pill">Date: Any</span>
          <span className="pill">Distance: Nearby</span>
          <span className="pill">Category: All</span>
          <span className="pill">Friends going</span>
          <span className="muted" style={{ marginLeft: "auto" }}>
            Sort: {pagination?.sort || "relevance"} ▾
          </span>
        </div>
      </header>

      <div className="cards">
        {hasEvents &&
          feed.map((evt) => {
            const hasCover = Boolean(evt.cover_url);
            return (
              <article className="card" key={evt.id}>
                <div
                  className={`cover${hasCover ? " has-image" : ""}`}
                  aria-hidden
                  style={hasCover ? { backgroundImage: `url(${evt.cover_url})` } : undefined}
                />
              <div className="meta">
                <div className="title">{evt.title || "Untitled Event"}</div>
                <div className="sub">
                  {fmt(evt.start_at, evt.end_at, evt.tz)} • {evt.location_text || "Location TBD"}
                  <br />
                  {evt?.rsvp_counts?.accepted || 0}/{evt.capacity || "∞"} going
                </div>
              </div>
                <div className="actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => (window.location.hash = `#/events/${evt.id}`)}
                  >
                    View
                  </button>
                  <button className="btn secondary" type="button">
                    Save
                  </button>
                </div>
              </article>
            );
          })}
        {!hasEvents && <div className="muted">No events yet.</div>}
      </div>

      <style>{styles}</style>
    </section>
  );
}

function fmt(start) {
  return "When • " + (start || "?");
}

const styles = `
  .feed-head{margin-bottom:12px}
  .search{width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:12px}
  .pills{display:flex;gap:12px;align-items:center;margin:12px 0;flex-wrap:wrap}
  .pill{background:#f3f4f6;border:1px solid #e5e7eb;padding:6px 12px;border-radius:16px;font-size:12px}
  .muted{color:#6b7280;font-size:12px}
  .cards{display:flex;flex-direction:column;gap:16px}
  .card{display:grid;grid-template-columns:180px 1fr 220px;gap:16px;align-items:center;border:1px solid #e5e7eb;border-radius:16px;padding:16px;background:#fff}
  @media (max-width: 991px){.card{grid-template-columns:1fr}}
  .cover{height:120px;background:#e5e7eb;border:1px solid #e5e7eb;border-radius:12px}
  .cover.has-image{background-size:cover;background-position:center;border:none}
  .title{font-weight:700;font-size:18px}
  .sub{color:#6b7280;font-size:13px}
  .actions{display:flex;gap:8px;justify-content:flex-end}
  .btn{background:#ff5656;border:none;color:#fff;padding:10px 16px;border-radius:10px;font-weight:700;cursor:pointer}
  .btn.secondary{background:#fff;border:1px solid #e5e7eb;color:#1f2937}
`;
