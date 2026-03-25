import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeVolunteerPortfolioRows,
  sortVolunteerPortfolioRows,
} from "../services/profileService.js";

test("portfolio rows mark only active future commitments as upcoming", () => {
  const now = new Date("2026-03-25T12:00:00.000Z");
  const rows = normalizeVolunteerPortfolioRows(
    [
      {
        id: "future-pending",
        title: "Pending future event",
        start_at: "2026-03-26T17:00:00.000Z",
        end_at: "2026-03-26T18:00:00.000Z",
        event_status: "published",
        rsvp_status: "pending",
      },
      {
        id: "future-declined",
        title: "Declined future event",
        start_at: "2026-03-27T17:00:00.000Z",
        end_at: "2026-03-27T18:00:00.000Z",
        event_status: "published",
        rsvp_status: "declined",
      },
      {
        id: "future-checked-in",
        title: "Checked in future event",
        start_at: "2026-03-28T17:00:00.000Z",
        end_at: "2026-03-28T18:00:00.000Z",
        event_status: "published",
        rsvp_status: "checked_in",
      },
      {
        id: "past-accepted",
        title: "Accepted past event",
        start_at: "2026-03-20T17:00:00.000Z",
        end_at: "2026-03-20T18:00:00.000Z",
        event_status: "published",
        rsvp_status: "accepted",
      },
      {
        id: "future-cancelled",
        title: "Cancelled future event",
        start_at: "2026-03-29T17:00:00.000Z",
        end_at: "2026-03-29T18:00:00.000Z",
        event_status: "cancelled",
        rsvp_status: "accepted",
      },
    ],
    { now }
  );

  const byId = new Map(rows.map((row) => [row.id, row]));

  assert.equal(byId.get("future-pending")?.is_upcoming, true);
  assert.equal(byId.get("future-declined")?.is_upcoming, false);
  assert.equal(byId.get("future-checked-in")?.is_upcoming, false);
  assert.equal(byId.get("future-cancelled")?.is_upcoming, false);

  assert.equal(byId.get("past-accepted")?.is_completed, true);
  assert.equal(byId.get("past-accepted")?.is_recent_impact, true);
  assert.equal(byId.get("future-declined")?.is_recent_impact, false);
});

test("portfolio row sorting keeps nearest upcoming events ahead of history", () => {
  const now = new Date("2026-03-25T12:00:00.000Z");
  const sortedIds = sortVolunteerPortfolioRows(
    normalizeVolunteerPortfolioRows(
      [
        {
          id: "past-most-recent",
          start_at: "2026-03-24T17:00:00.000Z",
          end_at: "2026-03-24T18:00:00.000Z",
          event_status: "published",
          rsvp_status: "accepted",
        },
        {
          id: "future-later",
          start_at: "2026-04-01T17:00:00.000Z",
          end_at: "2026-04-01T18:00:00.000Z",
          event_status: "published",
          rsvp_status: "accepted",
        },
        {
          id: "future-sooner",
          start_at: "2026-03-26T17:00:00.000Z",
          end_at: "2026-03-26T18:00:00.000Z",
          event_status: "published",
          rsvp_status: "pending",
        },
      ],
      { now }
    )
  ).map((row) => row.id);

  assert.deepEqual(sortedIds, ["future-sooner", "future-later", "past-most-recent"]);
});
