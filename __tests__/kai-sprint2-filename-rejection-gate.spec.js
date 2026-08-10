import test from "node:test";
import assert from "node:assert/strict";

import { detectGroundedFilenameHazard } from "../Backend/kai/storage/storagePathPolicy.js";
import router, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { reserveIntakeFileMetadata } from "../Backend/kai/services/kaiIntakeService.js";
import {
  FILENAME_FIXTURES,
} from "./support/kaiSprint2FilenameFixtureCorpus.js";

const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const engagementId = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeBatchId = "8e426ea1-2be3-4e48-b80f-9783ddbacda0";
const actorContext = {
  actorType: "human",
  actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
  kaiRoles: ["gk_operator"],
  organizationMemberships: [
    { organization_id: organizationId, role_name: "gk_operator", membership_status: "active" },
  ],
};

const groundedBlockedFilenameCases = Object.freeze([
  { category: "path traversal and slash/backslash separators", label: "parent traversal", original: "../report.csv" },
  { category: "path traversal and slash/backslash separators", label: "slash separator", original: "folder/report.csv" },
  { category: "path traversal and slash/backslash separators", label: "backslash separator", original: "folder\\report.csv" },
  { category: "C0 controls, including CR and LF", label: "C0 control", original: "report\u0001.csv" },
  { category: "C0 controls, including CR and LF", label: "CR control", original: "report\r.csv" },
  { category: "C0 controls, including CR and LF", label: "LF control", original: "report\n.csv" },
  { category: "DEL and C1 controls", label: "DEL control", original: "report\u007F.csv" },
  { category: "DEL and C1 controls", label: "C1 control", original: "report\u0085.csv" },
  ...[
    ["ARABIC LETTER MARK", "\u061C"],
    ["LEFT-TO-RIGHT MARK", "\u200E"],
    ["RIGHT-TO-LEFT MARK", "\u200F"],
    ["LEFT-TO-RIGHT EMBEDDING", "\u202A"],
    ["RIGHT-TO-LEFT EMBEDDING", "\u202B"],
    ["POP DIRECTIONAL FORMATTING", "\u202C"],
    ["LEFT-TO-RIGHT OVERRIDE", "\u202D"],
    ["RIGHT-TO-LEFT OVERRIDE", "\u202E"],
    ["LEFT-TO-RIGHT ISOLATE", "\u2066"],
    ["RIGHT-TO-LEFT ISOLATE", "\u2067"],
    ["FIRST STRONG ISOLATE", "\u2068"],
    ["POP DIRECTIONAL ISOLATE", "\u2069"],
  ].map(([label, control]) => ({
    category: "approved Unicode bidi formatting controls",
    label,
    original: `report${control}cod.exe`,
  })),
  ...[
    ["CON", "CON"],
    ["PRN", "prn"],
    ["AUX", "Aux"],
    ["NUL", "nul"],
    ["COM1", "com1"],
    ["LPT1", "Lpt1"],
  ].map(([label, original]) => ({
    category: "exact reserved basenames",
    label,
    original,
  })),
  { category: "terminal .exe suffix, case-insensitively", label: "lowercase exe", original: "report.csv.exe" },
  { category: "terminal .exe suffix, case-insensitively", label: "uppercase exe", original: "report.CSV.EXE" },
  {
    category: "empty filename or empty safe result",
    label: "empty safe result from original",
    original: "!!!",
    directSafeFilename: "",
  },
]);

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    },
  };
}

function routeHandler(path, method) {
  const layer = router.stack.find((candidate) => candidate.route?.path === path && candidate.route?.methods?.[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route exists`);
  return layer.route.stack[0].handle;
}

async function invokeFileReservationRoute(req) {
  const res = createResponse();
  await routeHandler("/admin/batches/:intakeBatchId/file-reservations", "post")(req, res);
  return res;
}

function createDependencies(calls) {
  return {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async getIntakeBatchTenantState(requestedBatchId, requestedOrganizationId) {
      assert.equal(requestedBatchId, intakeBatchId);
      assert.equal(requestedOrganizationId, organizationId);
      return {
        intake_batch_id: intakeBatchId,
        organization_id: organizationId,
        engagement_id: engagementId,
      };
    },
    async insertBlockedAttemptAuditEvent() {
      calls.blockedAttemptAudits += 1;
      return { ok: true, skipped: true };
    },
    async findIntakeFileReservationByIdempotencyKey() {
      calls.idempotencyLookups += 1;
      return null;
    },
    async findIntakeFileReservationByChecksum() {
      calls.checksumLookups += 1;
      return null;
    },
    buildObjectKey() {
      calls.objectKeyConstructions += 1;
      throw new Error("object-key construction must not be reached for rejected filenames");
    },
    async insertIntakeFileMetadata() {
      calls.inserts += 1;
      throw new Error("insert must not be reached for rejected filenames");
    },
  };
}

function validReservationInput() {
  return {
    actorContext,
    organizationId,
    engagementId,
    intakeBatchId,
    idempotencyKey: "kai-filename-gate-001",
    mimeType: "text/csv",
    checksum: "a".repeat(64),
    hashAlgorithm: "sha256",
  };
}

function assertRejectedBeforeObjectKeyAndInsert(result, calls, label) {
  assert.equal(result.ok, false, label);
  assert.equal(result.error.code, "validation_blocker", label);
  assert.equal(result.error.status, 422, label);
  assert.equal(result.blockers[0].validator_key, "VAL-STO-004", label);
  assert.equal(calls.objectKeyConstructions, 0, label);
  assert.equal(calls.idempotencyLookups, 0, label);
  assert.equal(calls.checksumLookups, 0, label);
  assert.equal(calls.inserts, 0, label);
}

test("P0-05B rejects grounded filename hazards through original_filename, safeFilename, and payload.safe_filename", async (t) => {
  for (const blockedCase of groundedBlockedFilenameCases) {
    await t.test(`${blockedCase.category}: ${blockedCase.label}`, async () => {
      const directValue = blockedCase.directSafeFilename ?? blockedCase.original;

      const routeCalls = {
        blockedAttemptAudits: 0,
        idempotencyLookups: 0,
        checksumLookups: 0,
        objectKeyConstructions: 0,
        inserts: 0,
      };
      const routeDependencies = createDependencies(routeCalls);
      const restore = intakeRouteTestables.setIntakeServiceForTest({
        async reserveIntakeFileMetadata(input) {
          return reserveIntakeFileMetadata({ ...input, actorContext }, routeDependencies);
        },
      });
      try {
        const routeResponse = await invokeFileReservationRoute({
          is() {
            return false;
          },
          params: { intakeBatchId },
          user: { id: 46 },
          body: {
            organization_id: organizationId,
            engagement_id: engagementId,
            idempotency_key: "kai-route-filename-gate-001",
            original_filename: blockedCase.original,
            mime_type: "text/csv",
            checksum: "a".repeat(64),
            hash_algorithm: "sha256",
          },
        });

        assert.equal(routeResponse.statusCode, 422, `${blockedCase.label} original_filename`);
        assert.equal(routeResponse.body.error.code, "validation_blocker", `${blockedCase.label} original_filename`);
        assert.equal(routeCalls.objectKeyConstructions, 0, `${blockedCase.label} original_filename`);
        assert.equal(routeCalls.idempotencyLookups, 0, `${blockedCase.label} original_filename`);
        assert.equal(routeCalls.checksumLookups, 0, `${blockedCase.label} original_filename`);
        assert.equal(routeCalls.inserts, 0, `${blockedCase.label} original_filename`);
      } finally {
        restore();
      }

      const safeFilenameCalls = {
        blockedAttemptAudits: 0,
        idempotencyLookups: 0,
        checksumLookups: 0,
        objectKeyConstructions: 0,
        inserts: 0,
      };
      const safeFilenameResult = await reserveIntakeFileMetadata(
        {
          ...validReservationInput(),
          originalFilename: "route-independent-safe.csv",
          safeFilename: directValue,
        },
        createDependencies(safeFilenameCalls),
      );
      assertRejectedBeforeObjectKeyAndInsert(
        safeFilenameResult,
        safeFilenameCalls,
        `${blockedCase.label} safeFilename`,
      );

      const payloadSafeFilenameCalls = {
        blockedAttemptAudits: 0,
        idempotencyLookups: 0,
        checksumLookups: 0,
        objectKeyConstructions: 0,
        inserts: 0,
      };
      const payloadSafeFilenameResult = await reserveIntakeFileMetadata(
        {
          ...validReservationInput(),
          originalFilename: "route-independent-safe.csv",
          payload: {
            organization_id: organizationId,
            engagement_id: engagementId,
            intake_batch_id: intakeBatchId,
            idempotency_key: "kai-payload-filename-gate-001",
            original_filename: "payload-independent-safe.csv",
            safe_filename: directValue,
            mime_type: "text/csv",
            checksum: "a".repeat(64),
            hash_algorithm: "sha256",
          },
        },
        createDependencies(payloadSafeFilenameCalls),
      );
      assertRejectedBeforeObjectKeyAndInsert(
        payloadSafeFilenameResult,
        payloadSafeFilenameCalls,
        `${blockedCase.label} payload.safe_filename`,
      );
    });
  }
});

test("P0-05B grounded filename helper leaves unresolved filename cases unclassified", () => {
  const corpusById = new Map(FILENAME_FIXTURES.map((fixture) => [fixture.fixture_id, fixture]));
  const unresolvedCorpusFixtureIds = [
    "FN-P0-05A-018-OWNER-UNICODE-NFD",
    "FN-P0-05A-019-OWNER-SPACE",
    "FN-P0-05A-020-OWNER-PUNCTUATION",
    "FN-P0-05A-022-OWNER-DRIVE-STYLE",
    "FN-P0-05A-023-OWNER-RESERVED-EXTENSION",
    "FN-P0-05A-024-OWNER-UNCLASSIFIED-EXTENSION",
  ];

  for (const fixtureId of unresolvedCorpusFixtureIds) {
    const fixture = corpusById.get(fixtureId);
    assert.ok(fixture, fixtureId);
    assert.equal(fixture.decision_status, "owner_decision_required", fixtureId);
    assert.equal(fixture.expected_policy, null, fixtureId);
    assert.equal(detectGroundedFilenameHazard(fixture.actual_input).matched, false, fixtureId);
  }

  for (const [label, value] of [
    ["other reserved-name variant COM2", "COM2"],
    ["other reserved-name variant LPT9", "LPT9"],
    ["reserved name with extension", "NUL.txt"],
    ["trailing-dot reserved candidate", "CON."],
    ["trailing-space reserved candidate", "CON "],
    ["bat suffix", "report.csv.bat"],
    ["cmd suffix", "report.csv.cmd"],
    ["com suffix", "report.csv.com"],
    ["scr suffix", "report.csv.scr"],
    ["js suffix", "report.csv.js"],
    ["vbs suffix", "report.csv.vbs"],
    ["sh suffix", "report.csv.sh"],
    ["markup suffix", "report.html"],
    ["multiple extension not otherwise classified", "report.tar.gz"],
  ]) {
    assert.equal(detectGroundedFilenameHazard(value).matched, false, label);
  }
});
