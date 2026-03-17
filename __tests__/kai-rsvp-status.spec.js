import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { __testables } from "../Backend/services/kai-tool-executor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

test("resolveAcceptedRsvpStatus accepts when capacity is open or unlimited", () => {
  assert.deepEqual(
    __testables.resolveAcceptedRsvpStatus({ capacity: null, waitlist_enabled: false }, 99),
    { status: "accepted" },
  );
  assert.deepEqual(
    __testables.resolveAcceptedRsvpStatus({ capacity: 10, waitlist_enabled: true }, 4),
    { status: "accepted" },
  );
});

test("resolveAcceptedRsvpStatus waitlists when full and waitlist is enabled", () => {
  assert.deepEqual(
    __testables.resolveAcceptedRsvpStatus({ capacity: 10, waitlist_enabled: true }, 10),
    {
      status: "waitlisted",
      message: "Event is full. You have been added to the waitlist.",
    },
  );
});

test("resolveAcceptedRsvpStatus blocks when full and waitlist is disabled", () => {
  assert.deepEqual(
    __testables.resolveAcceptedRsvpStatus({ capacity: 10, waitlist_enabled: false }, 10),
    {
      error: "EVENT_FULL",
      message: "This event is full and waitlist is disabled.",
    },
  );
});

test("KAI RSVP tool source no longer writes pending RSVP statuses", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "Backend/services/kai-tool-executor.js"),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /INSERT INTO event_rsvps[\s\S]*VALUES \(\$1, \$2, 'pending'/,
    "KAI RSVP tool should not insert invalid pending event_rsvps statuses",
  );
  assert.doesNotMatch(
    source,
    /r\.status IN \('accepted', 'pending'\)/,
    "KAI profile queries should not rely on legacy pending RSVP status",
  );
  assert.match(source, /waitlisted/, "KAI RSVP tool should understand waitlisted status");
});
