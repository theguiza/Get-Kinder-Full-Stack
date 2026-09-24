import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  listMyOrganizationJoinRequests,
  searchJoinableOrganizations,
  submitOrganizationJoinRequest,
  __organizationJoinRequestServiceContract,
} from "../Backend/kai/services/kaiOrganizationJoinRequestService.js";
import { listAuthorizedOrganizations } from "../Backend/kai/services/kaiOrganizationContextService.js";
import {
  getJoinableKaiOrganization,
  listOwnOrganizationJoinRequestsWithOrganization,
  searchJoinableKaiOrganizations,
} from "../Backend/kai/db/kaiOrganizationJoinRequestQueries.js";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const ACTOR_USER = "90000000-0000-4000-8000-000000000001";
const OTHER_USER = "90000000-0000-4000-8000-000000000002";
const ORG_TARGET = "00000000-0000-4000-8000-0000000000aa";
const ORG_AUTHORIZED = "00000000-0000-4000-8000-0000000000bb";
const ORG_DERIVED = "00000000-0000-4000-8000-0000000000cc";
const REQUEST_ID = "00000000-0000-4000-8000-000000000301";

function actorContext(overrides = {}) {
  return {
    actorType: "human",
    actorUserId: ACTOR_USER,
    legacyPublicUserdataId: 501,
    organizationMemberships: [],
    ...overrides,
  };
}

function pendingRow(overrides = {}) {
  return {
    organization_join_request_id: REQUEST_ID,
    organization_id: ORG_TARGET,
    requester_user_id: ACTOR_USER,
    status: "pending",
    created_at: "2026-09-24T00:00:00.000Z",
    reviewed_at: null,
    reviewed_by_user_id: null,
    updated_at: "2026-09-24T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Fake transaction runner + repository. `state.committed` records whether
 * the callback's writes would persist, so rollback coherence is observable.
 */
function harness({
  actor = actorContext(),
  organization = { organization_id: ORG_TARGET, display_name: "Target Org" },
  storedMemberships = [],
  pending = null,
  insertResult = null,
  auditResult = { ok: true, auditEventId: 1 },
  searchRows = [],
  ownRows = [],
} = {}) {
  const state = {
    transactions: 0,
    committed: [],
    rolledBack: 0,
    calls: [],
    txClients: new Set(),
  };
  const deps = {
    env: enabledEnv,
    resolveKaiActorContext: async (req) => {
      state.calls.push(["resolveActor", req]);
      return { ok: true, actorContext: actor };
    },
    runInTransaction: async (callback) => {
      state.transactions += 1;
      const tx = { id: state.transactions, writes: [] };
      state.txClients.add(tx);
      try {
        const result = await callback(tx);
        state.committed.push(...tx.writes);
        return result;
      } catch (error) {
        state.rolledBack += 1;
        throw error;
      }
    },
    getJoinableKaiOrganization: async ({ organizationId }, tx) => {
      state.calls.push(["getOrganization", organizationId, tx?.id ?? null]);
      return organization;
    },
    getActorOrganizationAccess: async (userId, organizationId, tx) => {
      state.calls.push(["storedMemberships", userId, organizationId, tx?.id ?? null]);
      return storedMemberships;
    },
    getPendingOrganizationJoinRequestForRequester: async (input, tx) => {
      state.calls.push(["getPending", input, tx?.id ?? null]);
      return typeof pending === "function" ? pending(tx) : pending;
    },
    insertPendingOrganizationJoinRequest: async (input, tx) => {
      state.calls.push(["insert", input, tx?.id ?? null]);
      tx.writes.push("join_request");
      return insertResult || { ok: true, joinRequest: pendingRow() };
    },
    insertRequiredSuccessfulAuditEvent: async (metadata, tx) => {
      state.calls.push(["audit", metadata, tx?.id ?? null]);
      if (auditResult?.ok) tx.writes.push("audit");
      return auditResult;
    },
    searchJoinableKaiOrganizations: async (input) => {
      state.calls.push(["search", input]);
      return searchRows;
    },
    listOwnOrganizationJoinRequestsWithOrganization: async (input) => {
      state.calls.push(["listOwn", input]);
      return ownRows;
    },
  };
  return { deps, state };
}

const calls = (state, name) => state.calls.filter((call) => call[0] === name);

// ---------------------------------------------------------------- DISCOVERY

test("discovery: bounded search returns only organization_id + display_name", async () => {
  const { deps, state } = harness({
    searchRows: [
      { organization_id: ORG_TARGET, display_name: "Target Org", organization_code: "SECRET", contract_ref: "x" },
    ],
  });
  const result = await searchJoinableOrganizations({ searchTerm: "  target   org ", req: { user: { id: 501 } } }, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, [{ organization_id: ORG_TARGET, display_name: "Target Org" }]);
  const [searchCall] = calls(state, "search");
  assert.equal(searchCall[1].searchTerm, "target org");
  assert.equal(searchCall[1].limit, __organizationJoinRequestServiceContract.SEARCH_RESULT_LIMIT);
  assert.equal(__organizationJoinRequestServiceContract.SEARCH_RESULT_LIMIT, 10);
});

test("discovery: an empty, one-character, over-long, or non-string term is refused without querying (no enumeration)", async () => {
  for (const searchTerm of [undefined, "", "   ", "a", "%", "x".repeat(201), ["ab"], { q: "ab" }]) {
    const { deps, state } = harness();
    const result = await searchJoinableOrganizations({ searchTerm, req: { user: { id: 501 } } }, deps);
    assert.equal(result.ok, false, `term ${JSON.stringify(searchTerm)} must be refused`);
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(calls(state, "search").length, 0);
  }
});

test("discovery: already-authorized organizations (listed, derived, and any active membership) are excluded", async () => {
  const actor = actorContext({
    organizationMemberships: [
      { organization_id: ORG_AUTHORIZED, role_name: "client_contributor", membership_status: "active" },
      { organization_id: ORG_DERIVED, role_name: "client_admin", membership_status: "active", authority_source: "gk_organization_binding" },
      { organization_id: ORG_TARGET, role_name: "client_viewer", membership_status: "revoked" },
    ],
  });
  const { deps, state } = harness({
    actor,
    searchRows: [
      { organization_id: ORG_AUTHORIZED, display_name: "Authorized" },
      { organization_id: ORG_TARGET, display_name: "Target Org" },
    ],
  });
  deps.listAuthorizedOrganizations = listAuthorizedOrganizations;
  const result = await searchJoinableOrganizations({ searchTerm: "org", actorContext: actor }, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items.map((item) => item.organization_id), [ORG_TARGET]);
  const excluded = new Set(calls(state, "search")[0][1].excludeOrganizationIds);
  assert.ok(excluded.has(ORG_AUTHORIZED));
  assert.ok(excluded.has(ORG_DERIVED));
  assert.ok(!excluded.has(ORG_TARGET), "a revoked membership is not effective access");
});

test("discovery: rejects unknown input keys and unmapped/non-human actors; honours KAI_SPRINT2_ENABLED", async () => {
  const { deps } = harness();
  assert.equal((await searchJoinableOrganizations({ searchTerm: "ab", req: {}, userId: OTHER_USER }, deps)).error.code, "validation_blocker");
  assert.equal(
    (await searchJoinableOrganizations({ searchTerm: "ab", req: {} }, { ...deps, env: {} })).error.code,
    "feature_disabled",
  );
  const unmapped = harness();
  unmapped.deps.resolveKaiActorContext = async () => ({ ok: false, error_code: "mapped_kai_user_required" });
  assert.equal((await searchJoinableOrganizations({ searchTerm: "ab", req: {} }, unmapped.deps)).error.code, "mapped_kai_user_required");
  const assistant = harness({ actor: actorContext({ actorType: "assistant" }) });
  assert.equal((await searchJoinableOrganizations({ searchTerm: "ab", req: {} }, assistant.deps)).error.code, "authorization_denied");
});

test("discovery SQL: active KAI organizations only, safe columns only, escaped ILIKE, excluded ids, hard cap 10", async () => {
  const seen = [];
  const db = { async query(text, params) { seen.push({ text, params }); return { rows: [] }; } };
  await searchJoinableKaiOrganizations({ searchTerm: "50%_off\\", excludeOrganizationIds: [ORG_AUTHORIZED], limit: 500 }, db);
  const [{ text, params }] = seen;
  assert.match(text, /SELECT organization_id, name AS display_name\s+FROM kai\.organizations/);
  assert.match(text, /WHERE status = 'active'/);
  assert.match(text, /name ILIKE \$1 ESCAPE '\\'/);
  assert.match(text, /NOT \(organization_id = ANY\(\$2::uuid\[\]\)\)/);
  assert.doesNotMatch(text, /public\.|organization_code|contract_ref|dpa_ref|legacy_|memberships|SELECT \*/);
  assert.deepEqual(params, ["%50\\%\\_off\\\\%", [ORG_AUTHORIZED], 10]);
  assert.deepEqual(await searchJoinableKaiOrganizations({ searchTerm: "  " }, db), []);
  assert.equal(seen.length, 1);

  await getJoinableKaiOrganization({ organizationId: ORG_TARGET }, db);
  assert.match(seen[1].text, /WHERE organization_id = \$1\s+AND status = 'active'/);
  assert.doesNotMatch(seen[1].text, /public\./);
});

// ------------------------------------------------------------------- SUBMIT

test("submit: non-member -> pending request created with requester from actor context, audited in the same transaction", async () => {
  const { deps, state } = harness();
  const result = await submitOrganizationJoinRequest({ organizationId: ORG_TARGET, req: { user: { id: 501 } } }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.outcome, "created");
  assert.deepEqual(result.data.join_request, {
    organization_join_request_id: REQUEST_ID,
    organization_id: ORG_TARGET,
    organization_display_name: "Target Org",
    status: "pending",
    submitted_at: "2026-09-24T00:00:00.000Z",
    reviewed_at: null,
  });
  const [insertCall] = calls(state, "insert");
  assert.deepEqual(insertCall[1], { organizationId: ORG_TARGET, requesterUserId: ACTOR_USER });
  const [auditCall] = calls(state, "audit");
  assert.equal(state.transactions, 1);
  assert.equal(insertCall[2], 1);
  assert.equal(auditCall[2], 1, "audit must use the same transaction client as the insert");
  assert.deepEqual(state.committed, ["join_request", "audit"]);
  assert.equal(auditCall[1].operation, "submit_organization_join_request");
  assert.equal(auditCall[1].target_object_type, "organization_join_request");
  assert.equal(auditCall[1].object_id, REQUEST_ID);
  assert.equal(auditCall[1].organization_id, ORG_TARGET);
  assert.equal(auditCall[1].actor_user_id, ACTOR_USER);
  assert.equal(auditCall[1].metadata_only, true);
  assert.ok(!Object.hasOwn(auditCall[1], "display_name"));
  assert.ok(!Object.keys(auditCall[1]).some((key) => /role/.test(key)));
});

test("submit: duplicate pending -> same pending request replayed, no insert, no audit", async () => {
  const { deps, state } = harness({ pending: pendingRow() });
  const result = await submitOrganizationJoinRequest({ organizationId: ORG_TARGET, req: {} }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.outcome, "existing_pending");
  assert.equal(result.data.join_request.organization_join_request_id, REQUEST_ID);
  assert.equal(calls(state, "insert").length, 0);
  assert.equal(calls(state, "audit").length, 0);
  assert.deepEqual(state.committed, []);
});

test("submit: concurrent duplicate (unique-index race) rolls back and replays the winner without a second audit", async () => {
  const { deps, state } = harness({
    pending: (tx) => (tx ? null : pendingRow()),
    insertResult: { ok: false, error_code: "pending_request_exists" },
  });
  const result = await submitOrganizationJoinRequest({ organizationId: ORG_TARGET, req: {} }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.outcome, "existing_pending");
  assert.equal(state.rolledBack, 1);
  assert.equal(calls(state, "audit").length, 0);
  assert.deepEqual(state.committed, []);
});

test("submit: effectively authorized user (stored or derived GK->KAI authority) is blocked before any transaction", async () => {
  for (const membership of [
    { organization_id: ORG_TARGET, role_name: "client_contributor", membership_status: "active" },
    { organization_id: ORG_TARGET, role_name: "client_admin", membership_status: "active", authority_source: "gk_organization_binding" },
  ]) {
    const actor = actorContext({ organizationMemberships: [membership] });
    const { deps, state } = harness({ actor });
    deps.listAuthorizedOrganizations = listAuthorizedOrganizations;
    const result = await submitOrganizationJoinRequest({ organizationId: ORG_TARGET, actorContext: actor }, deps);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "membership_state_conflict");
    assert.equal(result.blockers[0].blocking_reason, "join_request_already_authorized");
    assert.equal(state.transactions, 0);
  }
});

test("submit: the existing authorized-organization authority path is consulted with the resolved actor", async () => {
  const { deps } = harness();
  let seenActor = null;
  deps.listAuthorizedOrganizations = async ({ actorContext: resolved }) => {
    seenActor = resolved;
    return { ok: true, data: { items: [{ organization_id: ORG_TARGET }] }, error: null };
  };
  const result = await submitOrganizationJoinRequest({ organizationId: ORG_TARGET, req: {} }, deps);
  assert.equal(result.blockers[0].blocking_reason, "join_request_already_authorized");
  assert.equal(seenActor.actorUserId, ACTOR_USER);
});

test("submit: an active stored membership found in-transaction (any role) is blocked; nothing is written", async () => {
  const { deps, state } = harness({
    storedMemberships: [{ organization_id: ORG_TARGET, user_id: ACTOR_USER, role_name: "client_viewer", membership_status: "active" }],
  });
  const result = await submitOrganizationJoinRequest({ organizationId: ORG_TARGET, req: {} }, deps);
  assert.equal(result.blockers[0].blocking_reason, "join_request_already_authorized");
  assert.equal(calls(state, "insert").length, 0);
  assert.deepEqual(calls(state, "storedMemberships")[0].slice(1), [ACTOR_USER, ORG_TARGET, 1]);
});

test("submit: inactive/revoked/invited membership -> administrator action required, never reactivated or overwritten", async () => {
  for (const membershipStatus of ["inactive", "revoked", "invited", "unexpected_status"]) {
    const { deps, state } = harness({
      storedMemberships: [{ organization_id: ORG_TARGET, user_id: ACTOR_USER, role_name: "client_contributor", membership_status: membershipStatus }],
    });
    const result = await submitOrganizationJoinRequest({ organizationId: ORG_TARGET, req: {} }, deps);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "membership_state_conflict");
    assert.equal(result.blockers[0].blocking_reason, "join_request_administrator_action_required");
    assert.equal(calls(state, "insert").length, 0);
    assert.equal(calls(state, "getPending").length, 0);
    assert.deepEqual(state.committed, []);
  }
  const serviceSource = readFileSync("Backend/kai/services/kaiOrganizationJoinRequestService.js", "utf8");
  assert.doesNotMatch(serviceSource, /upsertOrganizationMembership|organization_memberships\s*\(|UPDATE|INSERT INTO/);
});

test("submit: unknown or non-joinable organization -> not_found, nothing written", async () => {
  const { deps, state } = harness({ organization: null });
  const result = await submitOrganizationJoinRequest({ organizationId: ORG_TARGET, req: {} }, deps);
  assert.equal(result.error.code, "not_found");
  assert.equal(result.blockers[0].blocking_reason, "join_request_organization_not_joinable");
  assert.equal(calls(state, "storedMemberships").length, 0);
  assert.equal(calls(state, "insert").length, 0);
});

test("submit: browser cannot choose requester identity or a role; malformed ids are refused", async () => {
  const { deps, state } = harness();
  for (const extra of [
    { requesterUserId: OTHER_USER },
    { requester_user_id: OTHER_USER },
    { userId: OTHER_USER },
    { roleName: "client_admin" },
    { requestedRole: "client_reviewer" },
  ]) {
    const result = await submitOrganizationJoinRequest({ organizationId: ORG_TARGET, req: {}, ...extra }, deps);
    assert.equal(result.error.code, "validation_blocker", `extra ${Object.keys(extra)[0]} must be refused`);
  }
  for (const organizationId of [undefined, "", "not-a-uuid", ORG_TARGET.toUpperCase(), 42]) {
    const result = await submitOrganizationJoinRequest({ organizationId, req: {} }, deps);
    assert.equal(result.error.code, "validation_blocker");
  }
  assert.equal(calls(state, "resolveActor").length, 0);
  assert.equal(state.transactions, 0);
});

// ------------------------------------------------------ AUDIT / TRANSACTION

test("audit rejection rolls back the inserted request coherently", async () => {
  const { deps, state } = harness({ auditResult: { ok: false, skipped: true, reason: "audit_insert_shape_unavailable" } });
  const result = await submitOrganizationJoinRequest({ organizationId: ORG_TARGET, req: {} }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "audit_payload_rejected");
  assert.equal(state.rolledBack, 1);
  assert.deepEqual(state.committed, []);
});

test("an insert FK failure rolls back and surfaces a validation blocker; unexpected insert errors are a system error", async () => {
  const fk = harness({ insertResult: { ok: false, error_code: "invalid_reference" } });
  assert.equal((await submitOrganizationJoinRequest({ organizationId: ORG_TARGET, req: {} }, fk.deps)).error.code, "validation_blocker");
  assert.equal(calls(fk.state, "audit").length, 0);
  assert.equal(fk.state.rolledBack, 1);

  const other = harness({ insertResult: { ok: false, error_code: "invalid_join_request_fields" } });
  assert.equal((await submitOrganizationJoinRequest({ organizationId: ORG_TARGET, req: {} }, other.deps)).error.code, "system_error");
  assert.deepEqual(other.state.committed, []);
});

// ---------------------------------------------------------------- OWN STATUS

test("own status: reads only the actor's own requests with a safe projection (no reviewer identity)", async () => {
  const { deps, state } = harness({
    ownRows: [
      {
        organization_join_request_id: REQUEST_ID,
        organization_id: ORG_TARGET,
        organization_display_name: "Target Org",
        status: "declined",
        created_at: "2026-09-20T00:00:00.000Z",
        reviewed_at: "2026-09-21T00:00:00.000Z",
        reviewed_by_user_id: OTHER_USER,
        requester_user_id: ACTOR_USER,
      },
    ],
  });
  const result = await listMyOrganizationJoinRequests({ req: { user: { id: 501 } } }, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, [
    {
      organization_join_request_id: REQUEST_ID,
      organization_id: ORG_TARGET,
      organization_display_name: "Target Org",
      status: "declined",
      submitted_at: "2026-09-20T00:00:00.000Z",
      reviewed_at: "2026-09-21T00:00:00.000Z",
    },
  ]);
  assert.deepEqual(calls(state, "listOwn")[0][1], { requesterUserId: ACTOR_USER });
});

test("own status: another user's id cannot be supplied", async () => {
  const { deps, state } = harness();
  for (const extra of [{ requesterUserId: OTHER_USER }, { requester_user_id: OTHER_USER }, { userId: OTHER_USER }]) {
    assert.equal((await listMyOrganizationJoinRequests({ req: {}, ...extra }, deps)).error.code, "validation_blocker");
  }
  assert.equal(calls(state, "listOwn").length, 0);
});

test("own status SQL: scoped by requester, joined to the KAI org name, never selects reviewer identity", async () => {
  const seen = [];
  const db = { async query(text, params) { seen.push({ text, params }); return { rows: [] }; } };
  await listOwnOrganizationJoinRequestsWithOrganization({ requesterUserId: ACTOR_USER }, db);
  assert.match(seen[0].text, /JOIN kai\.organizations o ON o\.organization_id = r\.organization_id/);
  assert.match(seen[0].text, /WHERE r\.requester_user_id = \$1/);
  assert.doesNotMatch(seen[0].text, /reviewed_by_user_id|public\./);
  assert.deepEqual(seen[0].params, [ACTOR_USER, 50]);
  assert.deepEqual(await listOwnOrganizationJoinRequestsWithOrganization({}, db), []);
  assert.equal(seen.length, 1);
});

// ------------------------------------------------------------- ARCHITECTURE

test("architecture: the JOIN-2 service has no SQL or pool access and requires no admin role", () => {
  const serviceSource = readFileSync("Backend/kai/services/kaiOrganizationJoinRequestService.js", "utf8");
  const code = serviceSource.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\.query\(|\bpool\b|db\/pg\.js|SELECT |INSERT |UPDATE |DELETE /);
  assert.doesNotMatch(code, /validateActorCanPerformOperation|allowedRoles|client_admin|client_reviewer|gk_admin/);
  assert.doesNotMatch(code, /requested_?role|roleName/i);
});
