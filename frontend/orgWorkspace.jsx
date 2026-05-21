import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";

const MOCK_EVENTS = [
  {
    id: "spring-food-bank",
    group: "Active",
    name: "Spring Food Bank Drive",
    startIso: "2026-05-18T09:00:00-07:00",
    endIso: "2026-05-20T17:00:00-07:00",
    fillPct: 78,
    filled: 39,
    capacity: 50,
    status: "Recruiting",
    days: 3,
    locations: 4,
  },
  {
    id: "kits-meal-prep",
    group: "Active",
    name: "Kits Community Meal Prep",
    startIso: "2026-05-22T10:00:00-07:00",
    endIso: "2026-05-22T15:00:00-07:00",
    fillPct: 46,
    filled: 11,
    capacity: 24,
    status: "Live",
    days: 1,
    locations: 2,
  },
  {
    id: "june-garden-build",
    group: "Drafts",
    name: "June Garden Build",
    startIso: "2026-06-03T08:30:00-07:00",
    endIso: "2026-06-05T16:30:00-07:00",
    fillPct: 0,
    filled: 0,
    capacity: 36,
    status: "Draft",
    days: 3,
    locations: 1,
  },
  {
    id: "youth-supply-sort",
    group: "Drafts",
    name: "Youth Supply Sort",
    startIso: "2026-06-11T13:00:00-07:00",
    endIso: "2026-06-11T17:00:00-07:00",
    fillPct: 0,
    filled: 0,
    capacity: 18,
    status: "Draft",
    days: 1,
    locations: 1,
  },
  {
    id: "winter-coat-wrap",
    group: "Reported",
    name: "Winter Coat Wrap-up",
    startIso: "2026-04-21T09:00:00-07:00",
    endIso: "2026-04-23T16:00:00-07:00",
    fillPct: 100,
    filled: 62,
    capacity: 62,
    status: "Reported",
    days: 3,
    locations: 5,
  },
];

const PINNED_EVENTS = [
  { name: "Food bank drive", color: "#ff5656" },
  { name: "Garden build", color: "#16a085" },
  { name: "Meal prep day", color: "#5b7cfa" },
];

const OPPORTUNITIES = [
  { name: "Food sort lead", requirement: "FoodSafe preferred · 3 shifts", filled: 6, capacity: 8, tone: "partial" },
  { name: "Delivery driver", requirement: "Class 5 license · vehicle required", filled: 3, capacity: 6, tone: "urgent" },
  { name: "Volunteer check-in", requirement: "Tablet provided · 2 hour blocks", filled: 4, capacity: 4, tone: "filled" },
  { name: "Community greeter", requirement: "Public-facing · indoor station", filled: 0, capacity: 5, tone: "empty" },
];

const RECENT_ACTIVITY = [
  { initials: "MR", name: "Maya R.", action: "added 6 volunteers to Food sort lead", time: "12 min ago" },
  { initials: "AK", name: "Ari K.", action: "updated the delivery driver requirement", time: "41 min ago" },
  { initials: "JL", name: "Jordan L.", action: "created a draft message for applicants", time: "Yesterday" },
];

function formatEventDateRange(startIso, endIso) {
  if (!startIso) return "Date TBD";
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "Date TBD";
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (!endIso) return startLabel;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return startLabel;
  const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (startLabel === endLabel) return startLabel;
  return `${startLabel} – ${endLabel}`;
}

function formatDaysAway(startIso) {
  if (!startIso) return "";
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "";
  const diffMs = start.getTime() - Date.now();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    const ago = Math.abs(diffDays);
    return ago === 0 ? "Today" : `${ago}d ago`;
  }
  if (diffDays === 0) return "Today";
  return `${diffDays}d away`;
}

function fillBarClass(pct, capacity) {
  if (!capacity) return "";
  if (pct >= 100) return "full";
  if (pct < 30) return "urgent";
  return "";
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function initialsFromName(name) {
  const parts = String(name || "Get Kinder").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "GK";
}

function StatusPill({ status }) {
  return <span className={`orgw-status orgw-status-${String(status).toLowerCase()}`}>{status}</span>;
}

function EventFillBar({ pct, capacity }) {
  const safePct = Math.max(0, Math.min(100, safeNumber(pct, 0)));
  return (
    <div className={`orgw-fill ${fillBarClass(safePct, capacity)}`}>
      <span style={{ width: `${safePct}%` }} />
    </div>
  );
}

function EventsList({ onSelectEvent }) {
  const groupedEvents = useMemo(
    () => ["Active", "Drafts", "Reported"].map((group) => ({
      group,
      events: MOCK_EVENTS.filter((event) => event.group === group),
    })),
    []
  );

  return (
    <div className="orgw-center-inner">
      <div className="orgw-page-head">
        <div>
          <h1>Events</h1>
          <p>Plan, recruit, run, and report every volunteer opportunity.</p>
        </div>
        <button type="button" className="orgw-btn orgw-btn-coral">+ New Event</button>
      </div>

      <div className="orgw-filterbar" aria-label="Event filters">
        <select defaultValue="all">
          <option value="all">Status</option>
          <option>Draft</option>
          <option>Recruiting</option>
          <option>Live</option>
          <option>Reported</option>
        </select>
        <select defaultValue="all">
          <option value="all">Project</option>
          <option>Community Food Security</option>
          <option>Youth Essentials</option>
        </select>
        <select defaultValue="upcoming">
          <option value="upcoming">Date</option>
          <option>This week</option>
          <option>This month</option>
          <option>Past events</option>
        </select>
      </div>

      {groupedEvents.map(({ group, events }) => (
        <section className="orgw-event-group" key={group}>
          <div className="orgw-group-title">
            <h2>{group}</h2>
            <span>{events.length} events</span>
          </div>
          <div className="orgw-table" role="table" aria-label={`${group} events`}>
            {events.map((event) => (
              <button
                type="button"
                className="orgw-event-row"
                key={event.id}
                onClick={() => onSelectEvent(event.id)}
              >
                <span className="orgw-event-name">
                  <strong>{event.name}</strong>
                  <small>{formatDaysAway(event.startIso)}</small>
                </span>
                <span>{formatEventDateRange(event.startIso, event.endIso)}</span>
                <span className="orgw-fill-cell">
                  <EventFillBar pct={event.fillPct} capacity={event.capacity} />
                  <small>{event.filled}/{event.capacity}</small>
                </span>
                <StatusPill status={event.status} />
                <span className="orgw-chevron">›</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function LifecycleStrip() {
  const stages = ["Draft", "Recruiting", "Live", "Closing out", "Reported"];
  return (
    <div className="orgw-lifecycle">
      <div className="orgw-lifecycle-row">
        {stages.map((stage) => (
          <button
            type="button"
            key={stage}
            className={`orgw-stage ${stage === "Recruiting" ? "active" : ""}`}
          >
            {stage}
          </button>
        ))}
      </div>
      <span>Click any stage to advance</span>
    </div>
  );
}

function MetricCard({ label, value, subtext }) {
  return (
    <div className="orgw-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{subtext}</small>
    </div>
  );
}

function OpportunitiesSection() {
  const totalFilled = OPPORTUNITIES.reduce((sum, item) => sum + item.filled, 0);
  const totalCapacity = OPPORTUNITIES.reduce((sum, item) => sum + item.capacity, 0);
  return (
    <section className="orgw-opportunities">
      <div className="orgw-section-head">
        <div>
          <h2>Opportunities</h2>
          <p>{OPPORTUNITIES.length} roles · {totalFilled}/{totalCapacity} slots filled</p>
        </div>
        <button type="button" className="orgw-btn orgw-btn-light">+ Add</button>
      </div>
      <div className="orgw-legend">
        <span><i className="filled" />Filled</span>
        <span><i className="partial" />Partial</span>
        <span><i className="urgent" />Urgent</span>
        <span><i className="empty" />Empty</span>
      </div>
      <div className="orgw-opp-list">
        {OPPORTUNITIES.map((item) => (
          <button type="button" className="orgw-opp-row" key={item.name}>
            <span className="orgw-opp-copy">
              <strong>{item.name}</strong>
              <small>{item.requirement}</small>
            </span>
            <span className="orgw-dot-fill" aria-label={`${item.filled} of ${item.capacity} filled`}>
              {Array.from({ length: item.capacity }).map((_, index) => (
                <i key={`${item.name}-${index}`} className={index < item.filled ? item.tone : "empty"} />
              ))}
            </span>
            <span className="orgw-opp-count">{item.filled}/{item.capacity}</span>
            <span className="orgw-chevron">›</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function EventWorkspace({ eventId }) {
  const event = MOCK_EVENTS.find((item) => item.id === eventId) || MOCK_EVENTS[0];
  return (
    <div className="orgw-center-inner">
      <div className="orgw-breadcrumb">Projects &gt; Events &gt; {event.name}</div>
      <div className="orgw-workspace-head">
        <div>
          <h1>{event.name}</h1>
          <p>{formatEventDateRange(event.startIso, event.endIso)} · {event.days} days · {event.locations} locations</p>
        </div>
        <div className="orgw-actions">
          <button type="button" className="orgw-btn orgw-btn-light">Message volunteers</button>
          <button type="button" className="orgw-btn orgw-btn-coral">+ Add opportunity</button>
        </div>
      </div>

      <LifecycleStrip />

      <nav className="orgw-tabs" aria-label="Event workspace sections">
        {["Overview", "Roster", "Schedule", "Comms", "Check-in", "Close-out", "Reports"].map((tab) => (
          <button type="button" className={tab === "Overview" ? "active" : ""} key={tab}>{tab}</button>
        ))}
      </nav>

      <div className="orgw-metrics">
        <MetricCard label="Spots Planned" value="—" subtext="Not yet recruiting" />
        <MetricCard label="Verified Hours" value="—" subtext="Logged at check-out" />
        <MetricCard label="Beneficiary Reach" value="—" subtext="Captured at close-out" />
      </div>

      <section className="orgw-next">
        <div className="orgw-next-icon">✓</div>
        <div>
          <span>NEXT ACTION</span>
          <h2>Finish opportunity details before recruiting</h2>
          <p>Add shift requirements, capacity, and location notes so volunteers can self-select the right role.</p>
          <div className="orgw-next-actions">
            <button type="button" className="orgw-btn orgw-btn-coral">Continue draft →</button>
            <button type="button" className="orgw-btn orgw-btn-light">Snooze</button>
          </div>
        </div>
      </section>

      <OpportunitiesSection />
    </div>
  );
}

function LeftSidebar({ orgName }) {
  const initials = initialsFromName(orgName);
  return (
    <aside className="orgw-left">
      <div className="orgw-org-card">
        <div className="orgw-avatar">{initials}</div>
        <div>
          <strong>{orgName}</strong>
          <span>Nonprofit · BC</span>
        </div>
      </div>
      <label className="orgw-search">
        <input placeholder="Quick find" />
        <span>⌘K</span>
      </label>
      <nav className="orgw-nav" aria-label="Organization workspace navigation">
        {["Home", "Projects", "Events", "Volunteers", "Reports"].map((item) => (
          <a href="#" className={item === "Events" ? "active" : ""} key={item}>{item}</a>
        ))}
      </nav>
      <div className="orgw-pinned">
        <h2>PINNED EVENTS</h2>
        {PINNED_EVENTS.map((item) => (
          <a href="#" key={item.name}><i style={{ background: item.color }} />{item.name}</a>
        ))}
      </div>
      <div className="orgw-left-bottom">
        <a href="#" className="orgw-settings">⚙ Settings</a>
        <div className="orgw-user">
          <span>{initials}</span>
          <small>Workspace user</small>
        </div>
      </div>
    </aside>
  );
}

function RightSidebar({ orgName }) {
  const initials = initialsFromName(orgName);
  return (
    <aside className="orgw-right">
      <section>
        <h2>ABOUT</h2>
        <p>
          Coordinating volunteer-powered food security programs across Metro Vancouver with recurring
          opportunities, partner sites, and verified community impact.
        </p>
      </section>
      <section>
        <h2>PARENT PROJECT</h2>
        <div className="orgw-project-card">
          <div className="orgw-avatar small">{initials}</div>
          <div>
            <strong>Community Food Security</strong>
            <span>{orgName} · 8 events</span>
          </div>
        </div>
      </section>
      <section>
        <h2>LANGUAGES</h2>
        <div className="orgw-tags">
          <span>English</span>
          <span>French</span>
          <span>Punjabi</span>
        </div>
      </section>
      <section>
        <h2>PARTNER ORGANIZATIONS</h2>
        <div className="orgw-partners">
          <span><i style={{ background: "#ff5656" }} />Neighbourhood House</span>
          <span><i style={{ background: "#16a085" }} />BC Food Network</span>
          <span><i style={{ background: "#5b7cfa" }} />Youth Kitchen Co-op</span>
        </div>
      </section>
      <section>
        <h2>LOCATIONS</h2>
        <ol className="orgw-locations">
          <li>Mount Pleasant Community Hall</li>
          <li>Kitsilano Food Hub</li>
          <li>East Van Sorting Centre</li>
        </ol>
      </section>
      <section>
        <h2>RECENT ACTIVITY</h2>
        <div className="orgw-activity">
          {RECENT_ACTIVITY.map((item) => (
            <div className="orgw-activity-row" key={`${item.name}-${item.time}`}>
              <div className="orgw-avatar mini">{item.initials}</div>
              <p><strong>{item.name}</strong> {item.action}<span>{item.time}</span></p>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

function OrgWorkspace({ orgName = "Get Kinder", eventId = null }) {
  const [selectedEventId, setSelectedEventId] = useState(eventId || null);
  const activeEventId = selectedEventId || eventId;

  return (
    <div className="orgw-shell">
      <OrgWorkspaceStyles />
      <LeftSidebar orgName={orgName} />
      <main className="orgw-center">
        {activeEventId ? (
          <EventWorkspace eventId={activeEventId} />
        ) : (
          <EventsList onSelectEvent={setSelectedEventId} />
        )}
      </main>
      <RightSidebar orgName={orgName} />
    </div>
  );
}

function OrgWorkspaceStyles() {
  return (
    <style>{`
      .gk-workspace-main {
        margin: 0;
        padding: 0;
      }

      .orgw-shell {
        --orgw-coral: #ff5656;
        --orgw-slate: #455a7c;
        --orgw-border: #e8eef8;
        color: #22324d;
        display: grid;
        grid-template-columns: 220px minmax(0, 1fr) 280px;
        height: calc(100vh - 76px);
        min-height: 680px;
        overflow: hidden;
        background: #f7f3ed;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .orgw-left,
      .orgw-right {
        background: #fff;
        height: 100%;
        overflow-y: auto;
        padding: 18px;
      }

      .orgw-left {
        border-right: 1px solid var(--orgw-border);
      }

      .orgw-right {
        border-left: 1px solid var(--orgw-border);
      }

      .orgw-center {
        background: #f7f3ed;
        height: 100%;
        overflow-y: auto;
      }

      .orgw-center-inner {
        max-width: 1120px;
        margin: 0 auto;
        padding: 28px;
      }

      .orgw-org-card,
      .orgw-project-card,
      .orgw-user,
      .orgw-activity-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .orgw-avatar {
        align-items: center;
        background: var(--orgw-coral);
        border-radius: 50%;
        color: #fff;
        display: inline-flex;
        flex: 0 0 auto;
        font-size: 13px;
        font-weight: 800;
        height: 42px;
        justify-content: center;
        width: 42px;
      }

      .orgw-avatar.small {
        height: 34px;
        width: 34px;
      }

      .orgw-avatar.mini {
        background: #eef4ff;
        color: var(--orgw-slate);
        font-size: 11px;
        height: 30px;
        width: 30px;
      }

      .orgw-org-card strong,
      .orgw-project-card strong {
        display: block;
        font-size: 14px;
        line-height: 1.2;
      }

      .orgw-org-card span,
      .orgw-project-card span,
      .orgw-user small {
        color: #8290aa;
        display: block;
        font-size: 12px;
      }

      .orgw-search {
        align-items: center;
        border: 1px solid var(--orgw-border);
        border-radius: 8px;
        display: flex;
        gap: 8px;
        margin: 22px 0;
        padding: 8px 10px;
      }

      .orgw-search input {
        border: 0;
        flex: 1;
        font-size: 13px;
        min-width: 0;
        outline: 0;
      }

      .orgw-search span {
        background: #f3f6fb;
        border-radius: 5px;
        color: #8794ab;
        font-size: 11px;
        padding: 2px 5px;
      }

      .orgw-nav {
        display: grid;
        gap: 3px;
      }

      .orgw-nav a {
        border-left: 3px solid transparent;
        color: var(--orgw-slate);
        font-weight: 700;
        padding: 9px 10px;
        text-decoration: none;
      }

      .orgw-nav a.active {
        border-left-color: var(--orgw-coral);
        color: var(--orgw-coral);
      }

      .orgw-pinned {
        margin-top: 28px;
      }

      .orgw-pinned h2,
      .orgw-right h2 {
        color: #8b98ad;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0;
        margin: 0 0 10px;
      }

      .orgw-pinned a,
      .orgw-partners span {
        align-items: center;
        color: var(--orgw-slate);
        display: flex;
        font-size: 13px;
        gap: 8px;
        padding: 7px 0;
        text-decoration: none;
      }

      .orgw-pinned i,
      .orgw-partners i {
        border-radius: 50%;
        display: inline-block;
        height: 8px;
        width: 8px;
      }

      .orgw-left-bottom {
        display: grid;
        gap: 16px;
        margin-top: 120px;
      }

      .orgw-settings {
        color: var(--orgw-slate);
        font-weight: 700;
        text-decoration: none;
      }

      .orgw-page-head,
      .orgw-workspace-head,
      .orgw-section-head,
      .orgw-lifecycle {
        align-items: center;
        display: flex;
        justify-content: space-between;
        gap: 16px;
      }

      .orgw-page-head h1,
      .orgw-workspace-head h1 {
        font-size: 34px;
        font-weight: 850;
        line-height: 1.05;
        margin: 0;
      }

      .orgw-page-head p,
      .orgw-workspace-head p,
      .orgw-section-head p {
        color: #75839c;
        margin: 6px 0 0;
      }

      .orgw-btn {
        border: 1px solid transparent;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 800;
        padding: 9px 13px;
        white-space: nowrap;
      }

      .orgw-btn-coral {
        background: var(--orgw-coral);
        color: #fff;
      }

      .orgw-btn-light {
        background: #fff;
        border-color: var(--orgw-border);
        color: var(--orgw-slate);
      }

      .orgw-filterbar {
        display: flex;
        gap: 10px;
        margin: 24px 0;
      }

      .orgw-filterbar select {
        background: #fff;
        border: 1px solid var(--orgw-border);
        border-radius: 8px;
        color: var(--orgw-slate);
        font-weight: 700;
        padding: 9px 32px 9px 12px;
      }

      .orgw-event-group {
        margin-top: 24px;
      }

      .orgw-group-title {
        align-items: baseline;
        display: flex;
        justify-content: space-between;
        margin-bottom: 10px;
      }

      .orgw-group-title h2,
      .orgw-section-head h2,
      .orgw-opportunities h2,
      .orgw-next h2 {
        font-size: 18px;
        font-weight: 850;
        margin: 0;
      }

      .orgw-group-title span {
        color: #8491a8;
        font-size: 13px;
      }

      .orgw-table,
      .orgw-next,
      .orgw-opportunities {
        background: #fff;
        border: 1px solid var(--orgw-border);
        border-radius: 8px;
        overflow: hidden;
      }

      .orgw-event-row {
        align-items: center;
        background: #fff;
        border: 0;
        border-bottom: 1px solid var(--orgw-border);
        color: #263854;
        cursor: pointer;
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(210px, 1.5fr) 150px minmax(150px, 1fr) 110px 24px;
        padding: 14px 16px;
        text-align: left;
        width: 100%;
      }

      .orgw-event-row:last-child {
        border-bottom: 0;
      }

      .orgw-event-row:hover {
        background: #fffaf7;
      }

      .orgw-event-name strong,
      .orgw-event-name small {
        display: block;
      }

      .orgw-event-name small,
      .orgw-fill-cell small {
        color: #8491a8;
        font-size: 12px;
        margin-top: 3px;
      }

      .orgw-fill {
        background: #edf2f8;
        border-radius: 999px;
        height: 7px;
        overflow: hidden;
        width: 100%;
      }

      .orgw-fill span {
        background: #5b7cfa;
        display: block;
        height: 100%;
      }

      .orgw-fill.full span {
        background: #16a085;
      }

      .orgw-fill.urgent span {
        background: var(--orgw-coral);
      }

      .orgw-status {
        border-radius: 999px;
        display: inline-flex;
        font-size: 12px;
        font-weight: 800;
        justify-content: center;
        padding: 5px 9px;
      }

      .orgw-status-draft {
        background: #eef2f7;
        color: #53627a;
      }

      .orgw-status-recruiting {
        background: #fff0ee;
        color: var(--orgw-coral);
      }

      .orgw-status-live {
        background: #eefaf5;
        color: #138564;
      }

      .orgw-status-reported {
        background: #eef3ff;
        color: #4768df;
      }

      .orgw-chevron {
        color: #9aa6ba;
        font-size: 24px;
        line-height: 1;
      }

      .orgw-breadcrumb {
        color: #8390a7;
        font-size: 13px;
        font-weight: 700;
        margin-bottom: 12px;
      }

      .orgw-actions {
        display: flex;
        gap: 10px;
      }

      .orgw-lifecycle {
        background: #fff;
        border: 1px solid var(--orgw-border);
        border-radius: 8px;
        margin: 24px 0 14px;
        padding: 12px;
      }

      .orgw-lifecycle-row {
        display: flex;
        gap: 8px;
      }

      .orgw-lifecycle span {
        color: #8491a8;
        font-size: 12px;
        margin-left: auto;
        text-align: right;
      }

      .orgw-stage {
        background: #f3f6fb;
        border: 0;
        border-radius: 999px;
        color: var(--orgw-slate);
        font-weight: 800;
        padding: 7px 11px;
      }

      .orgw-stage.active {
        background: var(--orgw-coral);
        color: #fff;
      }

      .orgw-tabs {
        border-bottom: 1px solid #ded7cd;
        display: flex;
        gap: 6px;
        margin-bottom: 18px;
        overflow-x: auto;
      }

      .orgw-tabs button {
        background: transparent;
        border: 0;
        border-bottom: 3px solid transparent;
        color: var(--orgw-slate);
        font-weight: 800;
        padding: 11px 9px;
      }

      .orgw-tabs button.active {
        border-bottom-color: var(--orgw-coral);
        color: var(--orgw-coral);
      }

      .orgw-metrics {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin-bottom: 16px;
      }

      .orgw-metric {
        background: #fff;
        border: 1px solid var(--orgw-border);
        border-radius: 8px;
        padding: 16px;
      }

      .orgw-metric span,
      .orgw-next span {
        color: #8a97ad;
        display: block;
        font-size: 11px;
        font-weight: 850;
        margin-bottom: 8px;
      }

      .orgw-metric strong {
        display: block;
        font-size: 28px;
        line-height: 1;
      }

      .orgw-metric small {
        color: #8491a8;
        display: block;
        margin-top: 8px;
      }

      .orgw-next {
        display: flex;
        gap: 14px;
        margin-bottom: 16px;
        padding: 18px;
      }

      .orgw-next-icon {
        align-items: center;
        background: #fff0ee;
        border-radius: 50%;
        color: var(--orgw-coral);
        display: flex;
        flex: 0 0 auto;
        font-weight: 900;
        height: 38px;
        justify-content: center;
        width: 38px;
      }

      .orgw-next p {
        color: #64728a;
        margin: 8px 0 12px;
      }

      .orgw-next-actions {
        display: flex;
        gap: 10px;
      }

      .orgw-opportunities {
        padding: 16px;
      }

      .orgw-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 14px 0;
      }

      .orgw-legend span {
        align-items: center;
        color: #75839c;
        display: inline-flex;
        font-size: 12px;
        gap: 5px;
      }

      .orgw-legend i,
      .orgw-dot-fill i {
        border-radius: 50%;
        display: inline-block;
        height: 8px;
        width: 8px;
      }

      .filled {
        background: #16a085;
      }

      .partial {
        background: #5b7cfa;
      }

      .urgent {
        background: var(--orgw-coral);
      }

      .empty {
        background: #d7dee9;
      }

      .orgw-opp-row {
        align-items: center;
        background: #fff;
        border: 0;
        border-top: 1px solid var(--orgw-border);
        display: grid;
        gap: 12px;
        grid-template-columns: minmax(180px, 1fr) minmax(160px, 240px) 48px 20px;
        padding: 13px 0;
        text-align: left;
        width: 100%;
      }

      .orgw-opp-copy strong,
      .orgw-opp-copy small {
        display: block;
      }

      .orgw-opp-copy small {
        color: #7c89a0;
        margin-top: 3px;
      }

      .orgw-dot-fill {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      .orgw-opp-count {
        color: var(--orgw-slate);
        font-weight: 850;
      }

      .orgw-right section {
        border-bottom: 1px solid var(--orgw-border);
        padding: 0 0 18px;
        margin-bottom: 18px;
      }

      .orgw-right section:last-child {
        border-bottom: 0;
      }

      .orgw-right p {
        color: #64728a;
        font-size: 13px;
        line-height: 1.5;
        margin: 0;
      }

      .orgw-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
      }

      .orgw-tags span {
        background: #f3f6fb;
        border-radius: 999px;
        color: var(--orgw-slate);
        font-size: 12px;
        font-weight: 800;
        padding: 6px 9px;
      }

      .orgw-locations {
        color: #64728a;
        font-size: 13px;
        margin: 0;
        padding-left: 20px;
      }

      .orgw-locations li + li {
        margin-top: 8px;
      }

      .orgw-activity {
        display: grid;
        gap: 13px;
      }

      .orgw-activity-row {
        align-items: flex-start;
      }

      .orgw-activity-row p {
        flex: 1;
        margin: 0;
      }

      .orgw-activity-row span {
        color: #8b98ad;
        display: block;
        font-size: 12px;
        margin-top: 2px;
      }

      @media (max-width: 1080px) {
        .orgw-shell {
          grid-template-columns: 190px minmax(0, 1fr);
        }

        .orgw-right {
          display: none;
        }
      }

      @media (max-width: 760px) {
        .orgw-shell {
          display: block;
          height: auto;
          min-height: 100vh;
          overflow: visible;
        }

        .orgw-left,
        .orgw-center {
          height: auto;
        }

        .orgw-left {
          border-bottom: 1px solid var(--orgw-border);
          border-right: 0;
        }

        .orgw-left-bottom {
          margin-top: 24px;
        }

        .orgw-center-inner {
          padding: 20px;
        }

        .orgw-page-head,
        .orgw-workspace-head,
        .orgw-section-head,
        .orgw-lifecycle {
          align-items: flex-start;
          flex-direction: column;
        }

        .orgw-filterbar,
        .orgw-actions,
        .orgw-next-actions {
          flex-direction: column;
          width: 100%;
        }

        .orgw-event-row,
        .orgw-opp-row,
        .orgw-metrics {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}

export function renderOrgWorkspace(selector, props) {
  const el = typeof selector === "string"
    ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = ReactDOM.createRoot(el);
  root.render(
    <React.StrictMode>
      <OrgWorkspace {...props} />
    </React.StrictMode>
  );
}
