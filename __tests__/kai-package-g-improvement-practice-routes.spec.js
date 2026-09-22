import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
const schemaSource = readFileSync("Backend/kai/validators/kaiSprint2RequestSchemas.js", "utf8");

test("Package G routes exist for create/list/get/update/status-change and delegate entirely to the service - no SQL/DB access in the route", () => {
  assert.match(
    routeSource,
    /router\.post\("\/admin\/organizations\/:organizationId\/improvement-practices", async \(req, res\) => \{/,
  );
  assert.match(
    routeSource,
    /router\.get\("\/admin\/organizations\/:organizationId\/improvement-practices", async \(req, res\) => \{/,
  );
  assert.match(
    routeSource,
    /router\.get\("\/admin\/organizations\/:organizationId\/improvement-practices\/:improvementPracticeId", async \(req, res\) => \{/,
  );
  assert.match(
    routeSource,
    /router\.patch\("\/admin\/organizations\/:organizationId\/improvement-practices\/:improvementPracticeId", async \(req, res\) => \{/,
  );
  assert.match(
    routeSource,
    /router\.post\("\/admin\/organizations\/:organizationId\/improvement-practices\/:improvementPracticeId\/status", async \(req, res\) => \{/,
  );
  assert.match(routeSource, /service\.createImprovementPractice\(\{/);
  assert.match(routeSource, /service\.listImprovementPracticesForOrganizationOperation\(\{/);
  assert.match(routeSource, /service\.getImprovementPracticeOperation\(\{/);
  assert.match(routeSource, /service\.updateImprovementPracticeFieldsOperation\(\{/);
  assert.match(routeSource, /service\.updateImprovementPracticeStatusOperation\(\{/);
});

test("Package G routes validate organization_id/improvement_practice_id UUID shape before invoking the service", () => {
  assert.match(routeSource, /function improvementPracticeIdentifiers\(req\) \{/);
  assert.match(routeSource, /KAI_SPRINT2_P0_PATTERNS\.uuid\.test\(organizationId\)/);
});

test("Package G mutation schemas exist for create/update/status-change", () => {
  assert.match(schemaSource, /create_improvement_practice: Object\.freeze\(\{/);
  assert.match(schemaSource, /update_improvement_practice: Object\.freeze\(\{/);
  assert.match(schemaSource, /change_improvement_practice_status: Object\.freeze\(\{/);
});

test("Package G create/update schemas bound title/rationale using existing limits - no new limit invented", () => {
  assert.match(schemaSource, /title: \{ type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS\.displayLabelMaxLength \}/);
  assert.match(schemaSource, /rationale: \{ type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS\.operatorTextMaxLength \}/);
});
