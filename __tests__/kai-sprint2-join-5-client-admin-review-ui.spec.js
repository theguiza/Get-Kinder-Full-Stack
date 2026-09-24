import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";

import accessAdministrationRouter, { __testables } from "../Backend/kai/routes/kaiAccessAdministrationApi.js";
import {
  approveOrganizationJoinRequest,
  declineOrganizationJoinRequest,
  listPendingOrganizationJoinRequestsForReviewer,
} from "../Backend/kai/services/kaiOrganizationJoinRequestReviewService.js";
import {
  describeJoinReviewError,
  isJoinReviewAvailable,
  joinReviewErrorFromResult,
  kaiOrganizationJoinRequestDecisionPath,
  kaiOrganizationJoinRequestsReviewPath,
  toJoinReviewQueueItems,
} from "../frontend/kaiOrganizationJoinLogic.js";

/**
 * JOIN-5: the organization client_admin's Impact Library review path.
 * The real access-administration router + the real JOIN-3 review service +
 * the real validateActorCanPerformOperation decide every response here
 * (only the pending-queue repository read is a synthetic stub), and the
 * Impact Library's own frontend helpers interpret those real HTTP responses
 * exactly as ImpactLibraryApp.jsx does.
 */

const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const ORG_B = "00000000-0000-4000-8000-0000000000bb";
const REQUEST_ID = "00000000-0000-4000-8000-000000000301";
const BASE = "/api/kai/sprint2/access-administration";
const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
const shellSource = readFileSync("frontend/impactLibraryShell.jsx", "utf8");
const panelSource = readFileSync("frontend/impactLibrary/OrganizationJoinRequestsReviewPanel.jsx", "utf8");
const adminSource = readFileSync("frontend/adminDashboard.jsx", "utf8");
const indexSource = readFileSync("index.js", "utf8");

const actor = (organizationMemberships, extra = {}) => ({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  kaiRoles: [],
  organizationMemberships,
  ...extra,
});
const ACTORS = {
  storedClientAdmin: actor([{ organization_id: ORG_A, role_name: "client_admin", membership_status: "active" }]),
  derivedClientAdmin: actor([{ organization_id: ORG_A, role_name: "client_admin", membership_status: "active", authority_source: "gk_organization_binding" }]),
  siteAdmin: actor([], { platformSuperuser: true, platformSuperuserAuthority: "get_kinder_site_admin" }),
  contributor: actor([{ organization_id: ORG_A, role_name: "client_contributor", membership_status: "active" }]),
  reviewer: actor([{ organization_id: ORG_A, role_name: "client_reviewer", membership_status: "active" }]),
  otherOrgAdmin: actor([{ organization_id: ORG_B, role_name: "client_admin", membership_status: "active" }]),
  globalGkAdminOnly: actor([], { kaiRoles: ["gk_admin"] }),
};

const reviewDeps = {
  env: { KAI_SPRINT2_ENABLED: "true" },
  listPendingOrganizationJoinRequestsForReview: async ({ organizationId }) => [
    {
      organization_join_request_id: REQUEST_ID,
      organization_id: organizationId,
      requester_user_id: "90000000-0000-4000-8000-000000000001",
      requester_email: "requester@synthetic.test",
      status: "pending",
      created_at: "2026-09-23T15:30:00.000Z",
    },
  ],
  runInTransaction: async () => {
    throw new Error("no decision transaction may start in this spec");
  },
};

async function asActor(actorContext, work) {
  const previous = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = __testables.setAccessAdministrationServiceForTest({
    listPendingOrganizationJoinRequestsForReviewer: (input) => listPendingOrganizationJoinRequestsForReviewer(input, reviewDeps),
    approveOrganizationJoinRequest: (input) => approveOrganizationJoinRequest(input, reviewDeps),
    declineOrganizationJoinRequest: (input) => declineOrganizationJoinRequest(input, reviewDeps),
  });
  const app = express();
  app.use(express.json());
  app.use(BASE, (req, res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: 46 };
    req.kaiSprint2ActorContext = actorContext;
    next();
  });
  app.use(BASE, accessAdministrationRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = server.address();
  // Same { statusCode, body } shape as the Impact Library's getJson/postJson.
  const call = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { statusCode: response.status, body: await response.json().catch(() => null) };
  };
  try {
    return await work(call);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restore();
    if (previous === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = previous;
  }
}

test("client_admin (stored and derived) and the site-admin fallback get the review surface from the real JOIN-3 GET", async () => {
  for (const name of ["storedClientAdmin", "derivedClientAdmin", "siteAdmin"]) {
    await asActor(ACTORS[name], async (call) => {
      const result = await call("GET", kaiOrganizationJoinRequestsReviewPath(ORG_A));
      assert.equal(result.statusCode, 200, name);
      assert.equal(isJoinReviewAvailable(result), true, `${name} must see the review UI`);
      assert.deepEqual(toJoinReviewQueueItems(result.body.data.items), [
        { organization_join_request_id: REQUEST_ID, requester_email: "requester@synthetic.test", submitted_at: "2026-09-23T15:30:00.000Z" },
      ]);
    });
  }
});

test("ordinary contributor/reviewer, another org's admin, and a global gk_admin role alone get 403 and no review UI or decision capability", async () => {
  for (const name of ["contributor", "reviewer", "otherOrgAdmin", "globalGkAdminOnly"]) {
    await asActor(ACTORS[name], async (call) => {
      const queue = await call("GET", kaiOrganizationJoinRequestsReviewPath(ORG_A));
      assert.equal(queue.statusCode, 403, name);
      assert.equal(isJoinReviewAvailable(queue), false, `${name} must not see the review UI`);
      for (const decision of ["approve", "decline"]) {
        const result = await call("POST", kaiOrganizationJoinRequestDecisionPath(ORG_A, REQUEST_ID, decision), {});
        assert.equal(result.statusCode, 403, `${name} ${decision}`);
        assert.match(describeJoinReviewError(joinReviewErrorFromResult(result)), /not authorized/);
      }
    });
  }
});

test("Impact Library renders the review surface only after the JOIN-3 GET succeeded for the selected organization", () => {
  assert.match(appSource, /const result = await getJson\(kaiOrganizationJoinRequestsReviewPath\(organizationId\)\);/);
  assert.match(appSource, /available: isJoinReviewAvailable\(result\),/);
  // The JOIN-3 GET is issued only when the server reports organizationJoinReview.
  assert.match(appSource, /if \(!canReviewJoinRequests\) \{[\s\S]*?\}\s*refetchJoinReview\(selectedOrganizationId\);\s*\}, \[selectedOrganizationId, canReviewJoinRequests, refetchJoinReview\]\);/);
  assert.match(appSource, /joinReview\.available && joinReview\.organizationId === selectedOrganizationId && \(joinReviewOpen \|\| joinReview\.items\.length > 0\)/);
  assert.match(appSource, /onReviewJoinRequests=\{hasAuthorizedOrganizations && joinReview\.available \? openJoinReview : undefined\}/);
  assert.match(shellSource, /typeof onReviewJoinRequests === "function" \? \([\s\S]*?Review join requests/);
  const code = appSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const reviewBlock = code.slice(code.indexOf("const [joinReview, setJoinReview]"), code.indexOf("const completeKaiSetup"));
  assert.doesNotMatch(reviewBlock, /client_admin|platformSuperuser|role_name|organizationMemberships/, "no frontend authority computation");
});

test("Impact Library decisions call the JOIN-3 endpoints with an empty body, refresh the queue, and refresh on 409/404", () => {
  assert.match(appSource, /postJson\(\s*kaiOrganizationJoinRequestDecisionPath\(organizationId, item\.organization_join_request_id, decision\),\s*\{\},\s*\)/);
  assert.match(appSource, /if \(result\.statusCode === 200 && result\.body\?\.ok\) \{[\s\S]*?await refetchJoinReview\(organizationId\);/);
  assert.match(appSource, /if \(shouldRefreshJoinQueueAfterError\(failure\.status\)\) await refetchJoinReview\(organizationId\);/);
  assert.match(describeJoinReviewError(joinReviewErrorFromResult({ statusCode: 409, body: { error: { code: "conflict_current_state_changed" } } })), /already changed/);
});

test("the review panel offers Approve as contributor / Decline only, with accessible labels and no role selector", () => {
  assert.match(panelSource, /Approve as contributor/);
  assert.match(panelSource, /Decline/);
  assert.match(panelSource, /aria-label=\{`Approve \$\{requester\} as contributor`\}/);
  assert.match(panelSource, /aria-labelledby="gk-join-review-heading"/);
  assert.match(panelSource, /role="status" aria-live="polite"/);
  const code = panelSource.replace(/\/\*\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /<select|role_name|client_admin|client_reviewer|requester_user_id|fetch\(|postJson/);
});

test("site-admin /admin KAI Access fallback review UI remains intact", () => {
  assert.match(adminSource, /<h6 id="kai-join-requests-heading" className="mb-1">Join requests<\/h6>/);
  assert.match(adminSource, /submitKaiJoinRequestDecision\(joinRequest, "approve"\)/);
  assert.match(adminSource, /Approve as contributor/);
});

test("/home side effects: the known internal /home returns are retired or normal-landing destinations (no contextual workflow regression)", () => {
  // GET /org-portal is retired: this app.use is registered before the page
  // route, so the org-portal page (the only place its logo/description
  // forms render) is unreachable and every GET returns to /home.
  const retiredOrgPortal = indexSource.indexOf('app.use("/org-portal", (req, res, next) => {\n  if (req.method === "GET") return res.redirect(302, "/home");');
  const orgPortalPage = indexSource.indexOf('app.get("/org-portal", ensureOrgRepPage,');
  assert.ok(retiredOrgPortal > -1 && orgPortalPage > retiredOrgPortal, "org-portal page is shadowed by the retired redirect");
  assert.match(indexSource, /function buildOrgPortalRedirectPath\(\{ logoUploadError = "" \} = \{\}\) \{\s*return "\/home";/);
  assert.match(indexSource, /function buildOrgPortalDescriptionRedirectPath\([\s\S]*?\) \{\s*return "\/home";/);
  // /dashboard is a retired pivot route.
  assert.match(indexSource, /\/\/ Retired pivot routes stay preserved on archive-pre-pivot-pages and redirect in production\.\napp\.get\("\/dashboard", \(req, res\) => res\.redirect\(302, "\/home"\)\);/);
  // The JOIN-4 decision is preserved: one redirect seam on /home only.
  assert.match(indexSource, /app\.get\("\/home", redirectAuthenticatedHomeToSignedInLanding, renderIndexPage\);/);
});
