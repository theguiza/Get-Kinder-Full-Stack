import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildProfileFieldUpdates,
  buildProfileRedirectParams,
  resolveProfileSaveAction,
} from "../services/profileSaveService.js";
import { buildProfileCompletion } from "../services/profileCompletionService.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");
const profileViewSource = fs.readFileSync(path.join(repoRoot, "views/profile.ejs"), "utf8");
const indexSource = fs.readFileSync(path.join(repoRoot, "index.js"), "utf8");

const existingUserRow = {
  firstname: "Existing",
  lastname: "User",
  email: "existing@example.com",
  phone: "555-0000",
  address1: "101 Main St",
  city: "Vancouver",
  state: "BC",
  country: "Canada",
  interest1: "Food security",
  interest2: "Outreach",
  interest3: "Events",
  sdg1: "2 – Zero Hunger",
  sdg2: null,
  sdg3: null,
};

test("resolveProfileSaveAction classifies profile, photo, and per-card preference saves", () => {
  assert.deepEqual(resolveProfileSaveAction(undefined), {
    action: "save_profile",
    isPreferenceSave: false,
    isPhotoSave: false,
    isProfileSave: true,
    savedPreferenceCard: null,
  });

  assert.deepEqual(resolveProfileSaveAction("save_photo"), {
    action: "save_photo",
    isPreferenceSave: false,
    isPhotoSave: true,
    isProfileSave: false,
    savedPreferenceCard: null,
  });

  assert.deepEqual(resolveProfileSaveAction("save_preferences:availability"), {
    action: "save_preferences:availability",
    isPreferenceSave: true,
    isPhotoSave: false,
    isProfileSave: false,
    savedPreferenceCard: "availability",
  });
});

test("buildProfileFieldUpdates only changes account fields on save_profile", () => {
  const updates = buildProfileFieldUpdates({
    actionState: resolveProfileSaveAction("save_profile"),
    existingUserRow,
    body: {
      firstname: "  New  ",
      lastname: " Name ",
      email: " new@example.com ",
      phone: " 555-1111 ",
      address1: " 500 Oak St ",
      city: " Seattle ",
      state: " WA ",
      country: " USA ",
      interest1: "Should not apply",
      sdg1: "Should not apply",
    },
  });

  assert.equal(updates.firstname, "New");
  assert.equal(updates.lastname, "Name");
  assert.equal(updates.email, "new@example.com");
  assert.equal(updates.phone, "555-1111");
  assert.equal(updates.address1, "500 Oak St");
  assert.equal(updates.city, "Seattle");
  assert.equal(updates.state, "WA");
  assert.equal(updates.country, "USA");
  assert.equal(updates.interest1, existingUserRow.interest1);
  assert.equal(updates.sdg1, existingUserRow.sdg1);
});

test("buildProfileFieldUpdates only changes preference fields on save_preferences", () => {
  const updates = buildProfileFieldUpdates({
    actionState: resolveProfileSaveAction("save_preferences:sdg"),
    existingUserRow,
    body: {
      firstname: "Ignored",
      phone: "Ignored",
      interest1: "  Youth mentorship ",
      interest2: " Logistics ",
      interest3: " Admin ",
      sdg1: "4 – Quality Education",
      sdg2: "10 – Reduced Inequality",
      sdg3: "17 – Partnerships for the Goals",
    },
  });

  assert.equal(updates.firstname, existingUserRow.firstname);
  assert.equal(updates.phone, existingUserRow.phone);
  assert.equal(updates.interest1, "Youth mentorship");
  assert.equal(updates.interest2, "Logistics");
  assert.equal(updates.interest3, "Admin");
  assert.equal(updates.sdg1, "4 – Quality Education");
  assert.equal(updates.sdg2, "10 – Reduced Inequality");
  assert.equal(updates.sdg3, "17 – Partnerships for the Goals");
});

test("buildProfileFieldUpdates leaves text fields unchanged on save_photo", () => {
  const updates = buildProfileFieldUpdates({
    actionState: resolveProfileSaveAction("save_photo"),
    existingUserRow,
    body: {
      firstname: "Ignored",
      interest1: "Ignored",
      city: "Ignored",
    },
  });

  assert.deepEqual(updates, {
    firstname: existingUserRow.firstname,
    lastname: existingUserRow.lastname,
    email: existingUserRow.email,
    phone: existingUserRow.phone,
    address1: existingUserRow.address1,
    city: existingUserRow.city,
    state: existingUserRow.state,
    country: existingUserRow.country,
    interest1: existingUserRow.interest1,
    interest2: existingUserRow.interest2,
    interest3: existingUserRow.interest3,
    sdg1: existingUserRow.sdg1,
    sdg2: existingUserRow.sdg2,
    sdg3: existingUserRow.sdg3,
  });
});

test("buildProfileRedirectParams returns section-specific success redirects", () => {
  assert.deepEqual(
    buildProfileRedirectParams(resolveProfileSaveAction("save_preferences:location")),
    { tab: "preferences", card: "location", saved: "preferences" }
  );
  assert.deepEqual(
    buildProfileRedirectParams(resolveProfileSaveAction("save_photo")),
    { tab: "portfolio", saved: "photo" }
  );
  assert.deepEqual(
    buildProfileRedirectParams(resolveProfileSaveAction("save_profile")),
    { tab: "account", saved: "profile" }
  );
});

test("profile view forms post to dedicated section endpoints", () => {
  assert.match(profileViewSource, /<form id="profile-photo-form" action="\/profile\/photo"/);
  assert.match(profileViewSource, /<form id="profile-preferences-form" action="\/profile\/preferences"/);
  assert.match(profileViewSource, /<form id="profile-account-form" action="\/profile\/account"/);
  assert.doesNotMatch(profileViewSource, /action="\/profile"/);
});

test("profile routes only register dedicated save endpoints", () => {
  assert.match(indexSource, /['"]\/profile\/photo['"]/);
  assert.match(indexSource, /app\.post\('\/profile\/account'/);
  assert.match(indexSource, /app\.post\('\/profile\/preferences'/);
  assert.doesNotMatch(indexSource, /app\.post\('\/profile',/);
});

test("buildProfileCompletion requires coords for location and substantive availability signals", () => {
  const locationOnlyLabel = buildProfileCompletion({
    user: {
      picture: "pic",
      interest1: "Food security",
      sdg1: "2 – Zero Hunger",
      phone: "555-1111",
      city: "Vancouver",
      home_base_label: "Downtown Vancouver",
      availability_weekly: JSON.stringify({ earliest_time: "09:00" }),
      specfifc_availability: "[]",
    },
  });

  assert.equal(
    locationOnlyLabel.incompleteItems.some((item) => item.key === "location"),
    true
  );
  assert.equal(
    locationOnlyLabel.incompleteItems.some((item) => item.key === "availability"),
    true
  );

  const complete = buildProfileCompletion({
    user: {
      picture: "pic",
      interest1: "Food security",
      sdg1: "2 – Zero Hunger",
      phone: "555-1111",
      city: "Vancouver",
      home_base_lat: 49.2827,
      home_base_lng: -123.1207,
    },
    availability: {
      weekly: { days: ["mon"], time_of_day: [], earliest_time: null, latest_time: null },
      exceptions: [],
    },
    location: { lat: 49.2827, lng: -123.1207, label: "Vancouver" },
  });

  assert.equal(complete.profileComplete, true);
  assert.equal(complete.completionPct, 100);
});

test("buildProfileCompletion stays in parity across user JSON fallback and explicit hydrated state", () => {
  const user = {
    picture: "pic",
    interest1: "Food security",
    sdg1: "2 – Zero Hunger",
    phone: "555-1111",
    city: "Vancouver",
    availability_weekly: JSON.stringify({ days: ["tue"], time_of_day: ["evening"] }),
    specfifc_availability: JSON.stringify([{ date: "2026-03-30", start: "09:00", end: "11:00" }]),
    home_base_lat: 49.2827,
    home_base_lng: -123.1207,
    home_base_label: "Vancouver, BC",
  };

  const fromUserOnly = buildProfileCompletion({ user });
  const fromHydratedState = buildProfileCompletion({
    user,
    availability: {
      weekly: { days: ["tue"], time_of_day: ["evening"] },
      exceptions: [{ date: "2026-03-30", start: "09:00", end: "11:00" }],
    },
    location: { lat: 49.2827, lng: -123.1207, label: "Vancouver, BC" },
  });

  assert.equal(fromUserOnly.completionPct, fromHydratedState.completionPct);
  assert.deepEqual(
    fromUserOnly.incompleteItems.map((item) => item.key),
    fromHydratedState.incompleteItems.map((item) => item.key)
  );
});
