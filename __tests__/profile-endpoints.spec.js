import test from "node:test";
import assert from "node:assert/strict";

import { makeProfileController } from "../Backend/profileController.js";
import {
  buildProfileFieldUpdates,
  buildProfileRedirectParams,
  resolveProfileSaveAction,
} from "../services/profileSaveService.js";

function buildProfileRedirectPath(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    const normalized = typeof value === "string" ? value.trim() : String(value);
    if (!normalized) continue;
    search.set(key, normalized);
  }
  const suffix = search.toString();
  return suffix ? `/profile?${suffix}` : "/profile";
}

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    redirectStatus: null,
    redirectPath: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    redirect(first, second) {
      if (typeof second === "undefined") {
        this.redirectPath = first;
      } else {
        this.redirectStatus = first;
        this.redirectPath = second;
      }
      return this;
    },
  };
}

function createProfileControllerHarness(overrides = {}) {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      return { rowCount: 1, rows: [{ id: 42 }] };
    },
  };

  const fetchExistingProfileUserRow = async () => ({
    id: 42,
    firstname: "Existing",
    lastname: "User",
    email: "existing@example.com",
    phone: "555-0000",
    address1: "101 Main St",
    city: "Vancouver",
    state: "BC",
    country: "Canada",
    interest1: "Food security",
    interest2: "Logistics",
    interest3: "Events",
    sdg1: "2 – Zero Hunger",
    sdg2: null,
    sdg3: null,
    picture: "data:image/png;base64,old",
  });

  const controller = makeProfileController({
    pool,
    fetchExistingProfileUserRow,
    buildProfileRedirectPath,
    buildProfileFieldUpdates,
    buildProfileRedirectParams,
    resolveProfileSaveAction,
    parseLocationFromRequestBody: () => ({
      lat: 49.2827,
      lng: -123.1207,
      label: "Vancouver, BC",
      source: "address",
      travel_radius_km: 10,
      travel_mode: "transit",
      timezone: "America/Vancouver",
    }),
    parseAvailabilityFromRequestBody: () => ({
      weekly: { days: ["mon"], time_of_day: ["morning"], timezone: "America/Vancouver" },
      exceptions: [],
      timezone: "America/Vancouver",
    }),
    ...overrides,
  });

  return { controller, queries };
}

test("postPhoto redirects with an error when no file is selected", async () => {
  const { controller, queries } = createProfileControllerHarness();
  const req = { user: { id: 42, email: "existing@example.com" } };
  const res = createMockRes();

  await controller.postPhoto(req, res);

  assert.equal(res.redirectPath, "/profile?tab=portfolio&uploadError=noFileSelected");
  assert.equal(queries.length, 0);
});

test("postAccount persists trimmed account fields and redirects to the account tab", async () => {
  const { controller, queries } = createProfileControllerHarness();
  const req = {
    body: {
      firstname: "  New  ",
      lastname: " Name ",
      email: " new@example.com ",
      phone: " 555-1111 ",
      address1: " 500 Oak St ",
      city: " Seattle ",
      state: " WA ",
      country: " USA ",
    },
    user: { id: 42, email: "existing@example.com" },
  };
  const res = createMockRes();

  await controller.postAccount(req, res);

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /UPDATE userdata/);
  assert.deepEqual(queries[0].params.slice(0, 8), [
    "New",
    "Name",
    "new@example.com",
    "555-1111",
    "500 Oak St",
    "Seattle",
    "WA",
    "USA",
  ]);
  assert.equal(req.user.firstname, "New");
  assert.equal(req.user.city, "Seattle");
  assert.equal(res.redirectPath, "/profile?tab=account&saved=profile");
});

test("postPreferences defaults missing profile_action to a preferences save and redirects back to preferences", async () => {
  let locationRequestBody = null;
  let availabilityRequestBody = null;
  const { controller, queries } = createProfileControllerHarness({
    parseLocationFromRequestBody(body) {
      locationRequestBody = body;
      return {
        lat: 49.2827,
        lng: -123.1207,
        label: "Vancouver, BC",
        source: "address",
        travel_radius_km: 25,
        travel_mode: "transit",
        timezone: "America/Vancouver",
      };
    },
    parseAvailabilityFromRequestBody(body) {
      availabilityRequestBody = body;
      return {
        weekly: { days: ["tue"], time_of_day: ["evening"], timezone: body.timezone },
        exceptions: [{ date: "2026-03-30", start: "09:00", end: "11:00", timezone: body.timezone }],
        timezone: body.timezone,
      };
    },
  });
  const req = {
    body: {
      interest1: "  Youth mentorship ",
      interest2: " Logistics ",
      interest3: " Admin ",
      sdg1: "4 – Quality Education",
      availability_weekly_json: JSON.stringify({ days: ["tue"], time_of_day: ["evening"] }),
      availability_exceptions_json: JSON.stringify([{ date: "2026-03-30", start: "09:00", end: "11:00" }]),
      home_base_lat: "49.2827",
      home_base_lng: "-123.1207",
    },
    user: { id: 42, email: "existing@example.com" },
  };
  const res = createMockRes();

  await controller.postPreferences(req, res);

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /UPDATE userdata/);
  assert.equal(locationRequestBody, req.body);
  assert.equal(availabilityRequestBody.timezone, "America/Vancouver");
  assert.equal(req.user.interest1, "Youth mentorship");
  assert.equal(req.user.home_base_label, "Vancouver, BC");
  assert.equal(res.redirectPath, "/profile?tab=preferences&card=preferences&saved=preferences");
});

test("postPreferences returns 400 when location validation fails", async () => {
  const { controller, queries } = createProfileControllerHarness({
    parseLocationFromRequestBody() {
      throw new Error("Both home_base_lat and home_base_lng are required.");
    },
  });
  const req = {
    body: { interest1: "Food security" },
    user: { id: 42, email: "existing@example.com" },
  };
  const res = createMockRes();

  await controller.postPreferences(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body, "Invalid location settings: Both home_base_lat and home_base_lng are required.");
  assert.equal(queries.length, 0);
});
