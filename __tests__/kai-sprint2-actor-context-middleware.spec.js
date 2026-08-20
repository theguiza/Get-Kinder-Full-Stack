import test from "node:test";
import assert from "node:assert/strict";

import { createAttachKaiSprint2ActorContext } from "../Backend/kai/middleware/kaiSprint2Authentication.js";

const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "kai-user-1",
  kaiRoles: ["gk_admin"],
  organizationMemberships: [
    {
      organization_id: "org-1",
      membership_status: "active",
      role_name: "gk_admin",
    },
  ],
});

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("attachKaiSprint2ActorContext attaches the resolver's full actor context on success", async () => {
  const middleware = createAttachKaiSprint2ActorContext({
    resolveActorContext: async () => ({ ok: true, actorContext }),
  });
  const req = { user: { id: 46 } };
  const res = fakeRes();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.kaiSprint2ActorContext, actorContext);
  assert.equal(res.statusCode, null);
});

test("attachKaiSprint2ActorContext sends the canonical KAI error and does not attach an actor context on controlled resolver failure", async () => {
  const middleware = createAttachKaiSprint2ActorContext({
    resolveActorContext: async () => ({ ok: false, error_code: "mapped_kai_user_required" }),
  });
  const req = { user: { id: 46 } };
  const res = fakeRes();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(req.kaiSprint2ActorContext, undefined);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, "mapped_kai_user_required");
});

test("attachKaiSprint2ActorContext forwards a thrown resolver error to next(error) instead of fabricating a response", async () => {
  const thrown = new Error("resolver blew up");
  const middleware = createAttachKaiSprint2ActorContext({
    resolveActorContext: async () => {
      throw thrown;
    },
  });
  const req = { user: { id: 46 } };
  const res = fakeRes();
  let forwardedError = null;

  await middleware(req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(forwardedError, thrown);
  assert.equal(req.kaiSprint2ActorContext, undefined);
  assert.equal(res.statusCode, null);
});
