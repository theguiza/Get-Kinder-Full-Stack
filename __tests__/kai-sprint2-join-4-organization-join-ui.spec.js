import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";

import {
  SIGNED_IN_LANDING_PATH,
  redirectAuthenticatedHomeToSignedInLanding,
} from "../middleware/signedInLanding.js";
import {
  JOIN_SEARCH_MIN_LENGTH,
  buildOrganizationJoinRequestBody,
  declinedJoinRequestMessage,
  deriveJoinRequestView,
  describeJoinReviewError,
  describeJoinSearchError,
  describeJoinSubmissionError,
  joinableOrganizationsSearchPath,
  kaiOrganizationJoinRequestDecisionPath,
  kaiOrganizationJoinRequestsReviewPath,
  myOrganizationJoinRequestsPath,
  normalizeJoinSearchTerm,
  organizationJoinRequestsPath,
  pendingJoinRequestMessage,
  shouldRefreshJoinQueueAfterError,
  stalePendingJoinRequestMessage,
  toJoinSearchResults,
} from "../frontend/kaiOrganizationJoinLogic.js";
import { __organizationJoinRequestServiceContract } from "../Backend/kai/services/kaiOrganizationJoinRequestService.js";

/**
 * JOIN-4: Impact Library Join UI, existing access-admin review UI, and the
 * signed-in landing. Follows this repository's established frontend
 * convention (pure logic-module unit tests + readFileSync source
 * assertions; no jsdom/Playwright exists here) plus a real Express proof of
 * the landing middleware.
 */

const indexSource = readFileSync("index.js", "utf8");
const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
const shellSource = readFileSync("frontend/impactLibraryShell.jsx", "utf8");
const panelSource = readFileSync("frontend/impactLibrary/OrganizationJoinPanel.jsx", "utf8");
const logicSource = readFileSync("frontend/kaiOrganizationJoinLogic.js", "utf8");
const adminSource = readFileSync("frontend/adminDashboard.jsx", "utf8");
const cssSource = readFileSync("public/css/gk-design-tokens.css", "utf8");

const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const ORG_B = "00000000-0000-4000-8000-0000000000bb";
const ORG_C = "00000000-0000-4000-8000-0000000000cc";

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// ------------------------------------------------------------------ LANDING

async function landingResponse(authenticated, path = "/home") {
  const app = express();
  app.use((req, res, next) => {
    req.isAuthenticated = () => authenticated;
    next();
  });
  app.get("/home", redirectAuthenticatedHomeToSignedInLanding, (req, res) => res.status(200).send("public home"));
  app.get("/home/faq", (req, res) => res.status(200).send("public faq"));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual" });
    return { status: response.status, location: response.headers.get("location"), body: await response.text() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("landing: unauthenticated /home stays the public page; authenticated /home redirects to /impact-library", async () => {
  const anonymous = await landingResponse(false);
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.body, "public home");
  const signedIn = await landingResponse(true);
  assert.equal(signedIn.status, 302);
  assert.equal(signedIn.location, "/impact-library");
  assert.equal(SIGNED_IN_LANDING_PATH, "/impact-library");
  const noSession = await (async () => {
    let nextCalled = false;
    redirectAuthenticatedHomeToSignedInLanding({}, { redirect() { throw new Error("must not redirect"); } }, () => { nextCalled = true; });
    return nextCalled;
  })();
  assert.equal(noSession, true, "a request without req.isAuthenticated is treated as public");
});

test("landing: explicit /home/<section> deep links stay public and unredirected even when signed in", async () => {
  const faq = await landingResponse(true, "/home/faq");
  assert.equal(faq.status, 200);
  assert.match(indexSource, /app\.get\(Object\.keys\(HOME_PATH_SECTIONS\), \(req, res, next\) => \{/);
  assert.doesNotMatch(indexSource, /app\.get\(Object\.keys\(HOME_PATH_SECTIONS\), redirectAuthenticated/);
});

test("landing: one central seam - every login success path still lands on /home, and /home is the only route using the redirect", () => {
  assert.match(indexSource, /app\.get\("\/home", redirectAuthenticatedHomeToSignedInLanding, renderIndexPage\);/);
  assert.equal((indexSource.match(/redirectAuthenticatedHomeToSignedInLanding/g) || []).length, 2, "import + the one /home route");
  const loginHandler = indexSource.slice(indexSource.indexOf('app.post("/login"'), indexSource.indexOf('app.post("/api/auth/mobile-login"'));
  assert.match(loginHandler, /req\.login\(user, \(err\) => \{[\s\S]*?res\.redirect\("\/home"\);/);
  for (const provider of ["google", "facebook"]) {
    const start = indexSource.indexOf(`app.get("/auth/${provider}/callback"`);
    assert.ok(start > -1);
    assert.match(indexSource.slice(start, start + 500), /return res\.redirect\("\/home"\);/);
  }
  // "/" and logout are untouched; /impact-library still requires authentication.
  assert.match(indexSource, /app\.get\("\/", async \(req, res, next\) => \{[\s\S]*?return renderIndexPage\(req, res, next\);/);
  assert.match(indexSource, /app\.get\("\/impact-library", ensureAuthenticated,/);
});

// ------------------------------------------------------------- JOIN SEARCH

test("search: the minimum term length mirrors the backend and no path is built below it (never browse-all)", () => {
  assert.equal(JOIN_SEARCH_MIN_LENGTH, __organizationJoinRequestServiceContract.SEARCH_TERM_MIN_LENGTH);
  for (const term of ["", " ", "a", " b ", null, undefined, 42]) {
    assert.equal(joinableOrganizationsSearchPath(term), null, `term ${JSON.stringify(term)} must not search`);
  }
  assert.equal(normalizeJoinSearchTerm("  harbour   trust "), "harbour trust");
  assert.equal(
    joinableOrganizationsSearchPath("Harbour & Co"),
    "/api/kai/sprint2/intake/admin/organization-join/organizations?q=Harbour%20%26%20Co",
  );
});

test("search: results keep only backend organization_id + display_name", () => {
  assert.deepEqual(
    toJoinSearchResults([
      { organization_id: ORG_A, display_name: "Harbour Trust", organization_code: "SECRET", name: "internal" },
      { organization_id: ORG_B },
      null,
    ]),
    [{ organization_id: ORG_A, display_name: "Harbour Trust" }],
  );
});

test("search UI: debounced, min-length gated, labelled input, backend display_name only, no role/admin/create controls", () => {
  assert.match(panelSource, /joinableOrganizationsSearchPath\(term\)/);
  assert.match(panelSource, /if \(!path\) \{[\s\S]*?setResults\(\[\]\);/);
  assert.match(panelSource, /setTimeout\(async \(\) => \{[\s\S]*?\}, JOIN_SEARCH_DEBOUNCE_MS\);/);
  assert.match(panelSource, /return \(\) => clearTimeout\(timer\);/);
  assert.match(panelSource, /<label className="gk-organization-join-label" htmlFor=\{inputId\}>\s*Search organizations/);
  assert.match(panelSource, /aria-live="polite"/);
  assert.match(panelSource, /\{organization\.display_name\}/);
  assert.match(panelSource, /aria-label=\{`Request to join \$\{organization\.display_name\}`\}/);
  assert.match(panelSource, /No matching organizations found\./);
  const code = stripComments(panelSource);
  assert.doesNotMatch(code, /<select|role_name|requested_role|client_admin|client_reviewer|invite|domain/i);
  assert.doesNotMatch(code, /organizationProfilePath|org_name|organization_code/);
});

// ------------------------------------------------------------------ SUBMIT

test("submit: body is only organization_id; requester/role are never sent", () => {
  assert.deepEqual(buildOrganizationJoinRequestBody(ORG_A), { organization_id: ORG_A });
  assert.throws(() => buildOrganizationJoinRequestBody(""), /organization_id is required/);
  assert.equal(organizationJoinRequestsPath(), "/api/kai/sprint2/intake/admin/organization-join/requests");
  assert.equal(myOrganizationJoinRequestsPath(), "/api/kai/sprint2/intake/admin/organization-join/requests/mine");
  assert.match(panelSource, /postJson\(organizationJoinRequestsPath\(\), buildOrganizationJoinRequestBody\(organization\.organization_id\)\)/);
  assert.match(panelSource, /await onRequestSubmitted\?\.\(\);/);
  assert.match(appSource, /onRequestSubmitted=\{refetchMyJoinRequests\}/);
});

test("submit: a pending organization shows 'Request pending' instead of a second request button", () => {
  assert.match(panelSource, /const isPending = pending\.has\(organization\.organization_id\);/);
  assert.match(panelSource, /Request pending/);
  assert.match(appSource, /pendingOrganizationIds=\{joinRequestView\.pendingOrganizationIds\}/);
});

test("submit errors map to concise copy without raw backend text", () => {
  const blocked = (reason, statusCode = 409) => ({ statusCode, body: { error: { code: "x", message: "RAW INTERNAL" }, blockers: [{ blocking_reason: reason }] } });
  assert.equal(describeJoinSubmissionError(blocked("join_request_already_authorized")), "You already have access to this organization.");
  assert.match(describeJoinSubmissionError(blocked("join_request_administrator_action_required")), /administrator of this organization/);
  assert.match(describeJoinSubmissionError(blocked("join_request_organization_not_joinable", 404)), /not available to join/);
  assert.match(describeJoinSubmissionError({ statusCode: 400, body: {} }), /Choose an organization/);
  assert.match(describeJoinSubmissionError({ statusCode: 403, body: {} }), /can't send join requests/);
  assert.equal(describeJoinSubmissionError({ statusCode: 500, body: { error: { message: "RAW INTERNAL" } } }), "Something went wrong. Please try again.");
  assert.match(describeJoinSearchError({ statusCode: 422 }), /at least 2 characters/);
  assert.doesNotMatch(logicSource.replace(/"RAW INTERNAL"/g, ""), /body\?\.error\?\.message/);
});

// ------------------------------------------------------------ STATE / VIEW

test("state: pending and declined notices for organizations the user cannot use yet", () => {
  const view = deriveJoinRequestView({
    requests: [
      { organization_join_request_id: "r1", organization_id: ORG_A, organization_display_name: "Harbour Trust", status: "pending", submitted_at: "2026-09-20T00:00:00Z" },
      { organization_join_request_id: "r2", organization_id: ORG_B, organization_display_name: "Cedar Fund", status: "declined", submitted_at: "2026-09-19T00:00:00Z" },
    ],
    authorizedOrganizationIds: [],
  });
  assert.deepEqual(view.pending.map((e) => e.organization_id), [ORG_A]);
  assert.deepEqual(view.declined.map((e) => e.organization_id), [ORG_B]);
  assert.deepEqual(view.pendingOrganizationIds, [ORG_A]);
  assert.equal(pendingJoinRequestMessage("Harbour Trust"), "Your request to join Harbour Trust is waiting for approval.");
  assert.match(declinedJoinRequestMessage("Cedar Fund"), /was not approved\. You can search again and send a new request\./);
});

test("state: declined permits retry - a newer pending request supersedes the older declined one", () => {
  const view = deriveJoinRequestView({
    requests: [
      { organization_join_request_id: "old", organization_id: ORG_B, status: "declined", submitted_at: "2026-09-01T00:00:00Z" },
      { organization_join_request_id: "new", organization_id: ORG_B, status: "pending", submitted_at: "2026-09-22T00:00:00Z" },
    ],
  });
  assert.deepEqual(view.declined, []);
  assert.deepEqual(view.pending.map((e) => e.organization_join_request_id), ["new"]);
  const declinedOnly = deriveJoinRequestView({ requests: [{ organization_join_request_id: "old", organization_id: ORG_B, status: "declined" }] });
  assert.deepEqual(declinedOnly.pendingOrganizationIds, [], "declined leaves the Request to join button available");
});

test("approved: no parallel approved state - the authorized organization list is the only authority", () => {
  const view = deriveJoinRequestView({
    requests: [{ organization_join_request_id: "a", organization_id: ORG_C, status: "approved", submitted_at: "2026-09-20T00:00:00Z" }],
    authorizedOrganizationIds: [ORG_C],
  });
  assert.deepEqual(view, { pending: [], declined: [], stalePending: [], pendingOrganizationIds: [] });
  const approvedNotYetListed = deriveJoinRequestView({ requests: [{ organization_id: ORG_C, status: "approved" }] });
  assert.deepEqual(approvedNotYetListed.pending, []);
  const code = stripComments(appSource);
  assert.doesNotMatch(code, /setOrganizations\([^)]*[Jj]oin/);
  assert.doesNotMatch(code, /"approved"/);
  assert.match(appSource, /authorizedOrganizationIds: organizations\.map\(\(org\) => org\.organization_id\)/);
});

test("pending + already authorized: usable access wins; the old request is only a compact cleanup notice", () => {
  const view = deriveJoinRequestView({
    requests: [{ organization_join_request_id: "s", organization_id: ORG_A, organization_display_name: "Harbour Trust", status: "pending" }],
    authorizedOrganizationIds: [ORG_A],
  });
  assert.deepEqual(view.pending, []);
  assert.deepEqual(view.stalePending.map((e) => e.organization_id), [ORG_A]);
  assert.match(stalePendingJoinRequestMessage("Harbour Trust"), /already have access to Harbour Trust[\s\S]*administrator cleanup/);
  // Authorized users always get their normal section content; join notices
  // render beside it, never instead of it.
  assert.match(appSource, /\{hasAuthorizedOrganizations && activeSection === "home" \? \(\s*<div className="gk-organization-join-area gk-organization-join-area--compact">/);
  assert.match(appSource, /\} else if \(activeSection === "home"\) \{\s*sectionContent = \(\s*<ImpactHomeView/);
  assert.doesNotMatch(stripComments(appSource), /hasAuthorizedOrganizations && joinRequestView/);
});

// ----------------------------------------------------------------- ZERO ORG

test("zero org: Impact Home presents Set up your organization with Request/create and Join existing, no popup", () => {
  assert.match(appSource, /title: "Set up your organization"/);
  assert.match(appSource, /action: "Request \/ create organization"/);
  assert.match(appSource, /const ORGANIZATION_REQUEST_HREF = "\/org-apply\?source=impact-library";/);
  assert.match(appSource, /Join existing organization/);
  assert.match(appSource, /onJoinOrganization=\{\(\) => setJoinPanelOpen\(true\)\}/);
  const zeroOrgBlock = appSource.slice(appSource.indexOf("if (!hasAuthorizedOrganizations && onboardingLoaded) {"), appSource.indexOf("} else if (!hasAuthorizedOrganizations) {"));
  assert.match(zeroOrgBlock, /<OrganizationOnboardingPanel/);
  assert.match(zeroOrgBlock, /<JoinRequestNotices view=\{joinRequestView\} \/>/);
  assert.match(zeroOrgBlock, /\{joinPanelOpen \? joinPanel : null\}/);
  assert.doesNotMatch(stripComments(appSource), /window\.(alert|confirm|open)|role="dialog"/);
});

// ------------------------------------------------------------ EXISTING USER

test("existing users: one-org auto-select and multi-org switcher are unchanged", () => {
  assert.match(appSource, /setSelectedOrganizationId\(items\[0\]\.organization_id\);/);
  assert.match(shellSource, /organizations\.length > 1 && typeof onSelectOrganization === "function"/);
  assert.match(shellSource, /onSelectOrganization\(org\.organization_id\);/);
});

test("existing users: '+ Add or join organization' offers Request/create (existing /org-apply) and Join existing (same panel)", () => {
  assert.match(shellSource, /\+ Add or join organization/);
  assert.match(shellSource, /aria-haspopup="menu"/);
  assert.match(shellSource, /aria-expanded=\{addOrgMenuOpen\}/);
  assert.match(shellSource, /if \(event\.key === "Escape"\) setAddOrgMenuOpen\(false\);/);
  assert.match(shellSource, /href=\{organizationActionHref\}>\s*Request \/ create new organization/);
  assert.match(shellSource, /onJoinOrganization\(\);[\s\S]*?Join existing organization/);
  assert.match(appSource, /onJoinOrganization=\{openJoinOrganization\}/);
  // One shared implementation for new and existing users.
  assert.equal((appSource.match(/<OrganizationJoinPanel/g) || []).length, 1);
  assert.equal((appSource.match(/\{joinPanelOpen \? joinPanel : null\}/g) || []).length, 2);
});

// -------------------------------------------------------------------- ADMIN

test("admin: join-request review lives in the existing KAI Access modal with requester email + submitted time", () => {
  assert.equal(kaiOrganizationJoinRequestsReviewPath(ORG_A), `/api/kai/sprint2/access-administration/organizations/${ORG_A}/join-requests`);
  assert.equal(
    kaiOrganizationJoinRequestDecisionPath(ORG_A, "r1", "approve"),
    `/api/kai/sprint2/access-administration/organizations/${ORG_A}/join-requests/r1/approve`,
  );
  assert.throws(() => kaiOrganizationJoinRequestDecisionPath(ORG_A, "r1", "promote"), /unsupported decision/);
  assert.match(adminSource, /kaiRequestJson\(kaiOrganizationJoinRequestsReviewPath\(kaiOrganizationId\)\)/);
  assert.match(adminSource, /loadKaiJoinRequests\(org\.id, kaiOrganizationId\);/);
  assert.match(adminSource, /joinRequest\.requester_email/);
  assert.match(adminSource, /joinRequest\.submitted_at/);
  assert.match(adminSource, /<h6 id="kai-join-requests-heading" className="mb-1">Join requests<\/h6>/);
});

test("admin: Approve as contributor / Decline call the JOIN-3 endpoints with an empty body and no role selector", () => {
  const section = adminSource.slice(adminSource.indexOf('aria-labelledby="kai-join-requests-heading"'), adminSource.indexOf("Grant KAI Access"));
  assert.match(section, /Approve as contributor/);
  assert.match(section, /submitKaiJoinRequestDecision\(joinRequest, "approve"\)/);
  assert.match(section, /submitKaiJoinRequestDecision\(joinRequest, "decline"\)/);
  assert.doesNotMatch(section.slice(0, section.indexOf("Email</label>")), /<select/);
  assert.match(adminSource, /kaiMutateJson\(kaiOrganizationJoinRequestDecisionPath\(kaiOrganizationId, joinRequestId, decision\), "POST", \{\}\)/);
});

test("admin: approval refreshes queue and roster; a 409/404 race refreshes the queue; backend decides authorization", () => {
  const handler = adminSource.slice(adminSource.indexOf("const submitKaiJoinRequestDecision = useCallback("), adminSource.indexOf("const submitKaiAccessRoleChange = useCallback("));
  assert.match(handler, /loadKaiJoinRequests\(organizationId, kaiOrganizationId\);\s*if \(decision === "approve"\) loadKaiAccess\(organizationId, kaiOrganizationId\);/);
  assert.match(handler, /if \(shouldRefreshJoinQueueAfterError\(err\?\.status\)\) loadKaiJoinRequests\(organizationId, kaiOrganizationId\);/);
  assert.doesNotMatch(handler, /platformSuperuser|client_admin|is_admin|role_name/);
  assert.equal(shouldRefreshJoinQueueAfterError(409), true);
  assert.equal(shouldRefreshJoinQueueAfterError(404), true);
  assert.equal(shouldRefreshJoinQueueAfterError(403), false);
  assert.match(describeJoinReviewError({ status: 409, code: "conflict_current_state_changed" }), /already changed\. The list has been refreshed\./);
  assert.match(describeJoinReviewError({ status: 409, blockingReason: "join_request_requester_already_authorized" }), /already has access/);
  assert.match(describeJoinReviewError({ status: 409, blockingReason: "join_request_administrator_action_required" }), /non-active membership/);
  assert.match(describeJoinReviewError({ status: 403 }), /not authorized/);
  assert.match(adminSource, /error\.status = response\.status;/);
});

// ---------------------------------------------------------- SECURITY / SOURCE

test("security: frontend never supplies requester/reviewer identity or a client_admin/client_reviewer request path, and has no SQL", () => {
  for (const source of [panelSource, logicSource]) {
    const code = stripComments(source);
    assert.doesNotMatch(code, /requester_user_id|reviewer_user_id|reviewed_by_user_id|role_name|membership_status/);
    assert.doesNotMatch(code, /client_admin|client_reviewer/);
    assert.doesNotMatch(code, /SELECT |INSERT |UPDATE |kai\.[a-z_]+/);
  }
  const joinAdmin = adminSource.slice(adminSource.indexOf("const loadKaiJoinRequests = useCallback("), adminSource.indexOf("const openKaiAccessModal = useCallback("));
  assert.doesNotMatch(joinAdmin, /requester_user_id|reviewer/);
});

test("accessibility/responsive: new controls have focus-visible styles and a mobile rule after the shell's mobile block", () => {
  assert.match(cssSource, /\.gk-organization-join-input:focus-visible,[\s\S]*?\.gk-organization-join-request-btn:focus-visible \{\s*outline: 2px solid #FF5656;/);
  assert.match(cssSource, /\.gk-organization-onboarding-secondary:focus-visible/);
  const lastMobile = cssSource.lastIndexOf("@media (max-width: 767.98px)");
  const shellMobile = cssSource.indexOf("/* ── Mobile: fixed bottom tab bar, single-column content ── */");
  assert.ok(lastMobile > shellMobile, "JOIN-4 mobile rules come after the shell's own mobile block");
  const joinMobile = cssSource.slice(lastMobile);
  assert.match(joinMobile, /\.gk-shell-add-org-menu \{ left: auto; right: 0; min-width: 200px; max-width: calc\(100vw - 32px\); \}/);
  assert.match(joinMobile, /\.gk-shell-org-action \{ white-space: normal; max-width: 34vw;/);
  assert.match(cssSource, /\.gk-organization-join-input \{\s*width: 100%; max-width: 100%; box-sizing: border-box;/);
  assert.match(cssSource, /\.gk-organization-join-result-name \{[^}]*overflow-wrap: anywhere;/);
});
