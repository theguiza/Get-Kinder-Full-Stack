import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
const authPreflightRouteSource = readFileSync("Backend/kai/routes/sprint2IntakeAuthPreflightApi.js", "utf8");
const legacyKaiRouteSource = readFileSync("Backend/routes/kaiApi.js", "utf8");
const accessAdministrationRouteSource = readFileSync("Backend/kai/routes/kaiAccessAdministrationApi.js", "utf8");
const indexSource = readFileSync("index.js", "utf8");
const kaiDbSource = readFileSync("Backend/kai/db/kaiDb.js", "utf8");
const kaiBackendIndexSource = readFileSync("Backend/kai/index.js", "utf8");
const actorSource = readFileSync("Backend/kai/auth/actorContext.js", "utf8");
const tenantAuthorizationSource = readFileSync("Backend/kai/auth/tenantAuthorization.js", "utf8");
const actorContextTestSource = readFileSync("__tests__/kai-sprint2-actor-context.spec.js", "utf8");
const tenantAuthorizationTestSource = readFileSync("__tests__/kai-sprint2-tenant-authorization.spec.js", "utf8");

test("service errors map through the canonical KAI HTTP status contract", () => {
  assert.match(routeSource, /import\s+\{\s*KAI_ERROR_STATUS,\s*sendKaiError\s*\}/);
  assert.match(routeSource, /Object\.hasOwn\(KAI_ERROR_STATUS,\s*requestedCode\)/);
  assert.match(routeSource, /return\s+sendKaiError\(res,\s*code/);
});

test("api contract exposes Sprint 2 status and admin metadata route shape", () => {
  assert.match(routeSource, /router\.get\(["']\/status["']/);
  assert.match(routeSource, /router\.post\(["']\/admin\/batches["']/);
  assert.match(routeSource, /router\.get\(["']\/admin\/batches\/:intakeBatchId["']/);
  assert.match(routeSource, /router\.get\(["']\/admin\/batches\/:intakeBatchId\/files["']/);
  assert.match(routeSource, /router\.get\(["']\/admin\/files\/:intakeFileId["']/);
  assert.match(routeSource, /router\.post\(["']\/admin\/files\/:intakeFileId\/block["']/);
  assert.match(routeSource, /router\.post\(\s*["']\/admin\/files\/:intakeFileId\/upload["']/);
  assert.match(routeSource, /router\.post\(["']\/admin\/files\/:intakeFileId\/confirm-upload["']/);
  assert.match(routeSource, /router\.post\(["']\/admin\/batches\/:intakeBatchId\/files\/upload-url["']/);
  assert.match(routeSource, /router\.get\(\s*["']\/admin\/organizations\/:organizationId\/generated-content-drafts\/:generatedContentDraftId\/export-review-queue\/:exportReviewQueueItemId\/packet["']/);
  assert.match(routeSource, /router\.get\(["']\/admin\/review-queue["']/);
  assert.match(routeSource, /router\.post\(["']\/admin\/review-queue\/:reviewQueueItemId\/status["']/);
  assert.match(routeSource, /router\.post\(["']\/admin\/batches\/:intakeBatchId\/file-reservations["']/);
  assert.match(routeSource, /mode:\s*["']admin_metadata_only["']/);
  assert.match(routeSource, /contract:\s*`kai_sprint2_p0_repository_contract_v\$\{KAI_SPRINT2_P0_CONTRACT_VERSION\}`/);
  assert.match(routeSource, /metadata_write_enabled:\s*true/);
  assert.match(routeSource, /areKaiSprint2UploadFeaturesEnabled\(env\)/);
  assert.match(routeSource, /isKaiGateC1GcsProviderEnabled\(env\)/);
  assert.match(routeSource, /file_upload_enabled:\s*uploadFeaturesEnabled/);
  assert.match(routeSource, /upload_confirmation_enabled:\s*uploadFeaturesEnabled/);
  assert.match(routeSource, /storage_provider_enabled:\s*storageProviderEnabled/);
  assert.match(routeSource, /storage_upload_enabled:\s*uploadFeaturesEnabled/);
  assert.match(routeSource, /signed_upload_enabled:\s*uploadFeaturesEnabled\s*&&\s*storageProviderEnabled/);
  assert.match(routeSource, /signed_read_enabled:\s*false/);
  assert.match(routeSource, /areKaiSprint2WorkerFeaturesEnabled\(env\)/);
  assert.match(routeSource, /parser_worker_enabled:\s*workerFeaturesEnabled/);
  assert.match(routeSource, /profiling_enabled:\s*workerFeaturesEnabled/);
  assert.match(routeSource, /source_promotion_enabled:\s*false/);
});

test("sprint2IntakeApi fails closed while disabled and does not expose req.user", () => {
  assert.match(routeSource, /requireKaiSprint2Enabled[\s\S]+from\s+["']\.\.\/config\/kaiSprint2Config\.js["']/);
  assert.match(routeSource, /router\.use\(requireKaiSprint2Enabled\)/);
  assert.doesNotMatch(routeSource, /\breq\.user\b/);
  assert.doesNotMatch(routeSource, /\buser:\s*req\b|\bsession:\s*req\b|\bheaders:\s*req\b/);
});

test("sprint2IntakeApi delegates admin metadata operations to service without direct kai table access", () => {
  assert.match(routeSource, /import\(["']\.\.\/services\/kaiIntakeRuntimeService\.js["']\)/);
  assert.match(routeSource, /\bcheckAdminAccess\b/);
  assert.match(routeSource, /\bcreateIntakeBatch\b/);
  assert.match(routeSource, /\breserveIntakeFileMetadata\b/);
  assert.match(routeSource, /\bmarkIntakeFilePolicyBlocked\b/);
  assert.match(routeSource, /\buploadReservedIntakeFile\b/);
  assert.match(routeSource, /\bconfirmUpload\b/);
  assert.match(routeSource, /\brequestUploadUrl\b/);
  assert.match(routeSource, /\bupdateReviewQueueStatus\b/);
  assert.match(routeSource, /service\.checkAdminAccess/);
  assert.match(routeSource, /service\.createIntakeBatch/);
  assert.match(routeSource, /service\.reserveIntakeFileMetadata/);
  assert.match(routeSource, /service\.markIntakeFilePolicyBlocked/);
  assert.match(routeSource, /service\.uploadReservedIntakeFile/);
  assert.match(routeSource, /service\.confirmUpload/);
  assert.match(routeSource, /service\.requestUploadUrl/);
  assert.match(routeSource, /service\.updateReviewQueueStatus/);
  assert.doesNotMatch(routeSource, /\b(?:select|insert|update|delete)\b[\s\S]{0,160}\bkai\./i);
  assert.doesNotMatch(routeSource, /\bkai\.(?!js\b)[a-z_]+\b/i);
});

test("Pass 1F API contract tests do not import pg or initialize a pool", () => {
  assert.doesNotMatch(routeSource, /from\s+["'][^"']*Backend\/db\/pg\.js["']/);
  assert.doesNotMatch(routeSource, /\bnew\s+Pool\b|\bpool\.query\b|\bconnect\s*\(/);
});

test("route files contain no direct SQL against kai schema", () => {
  for (const source of [routeSource, authPreflightRouteSource, legacyKaiRouteSource, accessAdministrationRouteSource]) {
    assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,200}\bkai\./i);
    assert.doesNotMatch(source, /\bkai\.(?!js\b)[a-z_]+\b/i);
  }
});

test("sprint2IntakeApi enables only service-delegated upload routes, not parser raw-file work, source promotion, or tenant DB lookup", () => {
  assert.match(routeSource, /requireKaiSprint2UploadMediaType/);
  assert.match(routeSource, /attachKaiSprint2UploadByteSource/);
  assert.doesNotMatch(routeSource, /\bparser\b[\s\S]{0,80}\braw[-_ ]?file\b/i);
  assert.doesNotMatch(routeSource, /\bpromote(?:Source)?\b|\bsource_promotion_enabled:\s*true\b/i);
  assert.doesNotMatch(routeSource, /from\s+["'][^"']*(?:kaiDb|kaiQueries|kaiIntakeQueries)\.js["']/);
  assert.doesNotMatch(routeSource, /\bSELECT\b[\s\S]{0,160}\b(?:kai\.|organization|tenant|membership)/i);
});

test("upload-url route delegates to requestUploadUrl without route-level storage provider facts", () => {
  const start = routeSource.indexOf('router.post("/admin/batches/:intakeBatchId/files/upload-url"');
  assert.notEqual(start, -1);
  const nextRoute = routeSource.indexOf("router.", start + 1);
  const slice = routeSource.slice(start, nextRoute);
  assert.match(slice, /service\.requestUploadUrl/);
  assert.doesNotMatch(slice, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\bpool\b|\bkaiDb\b|\bkaiIntakeQueries\b/i);
  assert.doesNotMatch(slice, /\bGoogleCloudStorageProvider\b|\bgcsProvider\b|\bstorageProvider\b|\blifecycleRepository\b/);
  assert.doesNotMatch(slice, /\bbucket\b|\bobjectKey\b|\bstorageObjectKey\b|\bmimeType\b|\boriginalFilename\b|\bsafeFilename\b|\bstoragePath\b|\bstorageUri\b/);
});

test("kaiDb imports the existing Postgres pool and does not instantiate a pool", () => {
  assert.match(kaiDbSource, /import\s+pool\s+from\s+["']\.\.\/\.\.\/db\/pg\.js["']/);
  assert.match(kaiDbSource, /export\s+function\s+query\(/);
  assert.doesNotMatch(kaiDbSource, /import\s+\{\s*Pool\s*\}\s+from\s+["']pg["']/);
  assert.doesNotMatch(kaiDbSource, /\bnew\s+Pool\b/);
  assert.doesNotMatch(kaiDbSource, /from\s+["']neo4j-driver["']/);
});

test("index.js preserves legacy KAI and Sprint 2 auth-preflight mounts", () => {
  assert.match(indexSource, /import\s+\{\s*verifyToken,\s*ensureAuthenticatedApi\s*\}\s+from\s+["']\.\/middleware\/auth\.js["']/);
  assert.match(indexSource, /import\s+\{\s*requireKaiSprint2Authenticated\s*\}\s+from\s+["']\.\/Backend\/kai\/middleware\/kaiSprint2Authentication\.js["']/);
  assert.match(indexSource, /app\.use\(["']\/api\/kai["'],\s*kaiRouter\)/);
  assert.match(indexSource, /["']\/api\/kai\/sprint2\/intake\/auth-preflight["'][\s\S]*requireKaiSprint2Enabled[\s\S]*requireKaiSprint2Authenticated[\s\S]*sprint2IntakeAuthPreflightApiRouter/);
  assert.match(indexSource, /["']\/api\/kai\/sprint2\/intake["'][\s\S]*requireKaiSprint2Enabled[\s\S]*kaiSprint2OrganizationMutationLimiter[\s\S]*kaiSprint2ActorMutationLimiter[\s\S]*requireKaiSprint2Authenticated[\s\S]*sprint2IntakeApiRouter/);
  assert.doesNotMatch(indexSource, /function\s+ensureAuthenticatedApi|const\s+ensureAuthenticatedApi\s*=/);
});

test("Backend KAI index exports Pass 1C actor and tenant helpers from accepted auth files", () => {
  assert.match(kaiBackendIndexSource, /from\s+["']\.\/auth\/actorContext\.js["']/);
  assert.match(kaiBackendIndexSource, /from\s+["']\.\/auth\/tenantAuthorization\.js["']/);
  assert.match(kaiBackendIndexSource, /hydrateSprint2ActorContextFromRequest/);
  assert.match(kaiBackendIndexSource, /findActiveOrganizationMembership/);
  assert.doesNotMatch(kaiBackendIndexSource, /from\s+["']\.\/auth\/kaiActorContext\.js["']/);
  assert.doesNotMatch(kaiBackendIndexSource, /from\s+["']\.\/auth\/kaiAuthorizationService\.js["']/);
});

test("Backend KAI index exports one canonical mounted intake service without DB adapters", () => {
  assert.match(kaiBackendIndexSource, /from\s+["']\.\/validators\/runValidators\.js["']/);
  assert.match(kaiBackendIndexSource, /from\s+["']\.\/validators\/intakeValidators\.js["']/);
  assert.match(kaiBackendIndexSource, /from\s+["']\.\/services\/kaiIntakeService\.js["']/);
  assert.match(kaiBackendIndexSource, /createIntakeBatch/);
  assert.match(kaiBackendIndexSource, /reserveIntakeFileMetadata/);
  assert.doesNotMatch(kaiBackendIndexSource, /from\s+["']\.\/services\/intakeService\.js["']/);
  assert.doesNotMatch(kaiBackendIndexSource, /from\s+["'][^"']*(?:kaiDb|db\/pg|kaiIntakeQueries|storageAdapter)\.js["']/);
});

test("Backend KAI index exports Pass 1E state, assistant, and audit contracts without DB adapters", () => {
  assert.match(kaiBackendIndexSource, /from\s+["']\.\/validators\/stateTransitionValidators\.js["']/);
  assert.match(kaiBackendIndexSource, /from\s+["']\.\/validators\/assistantBoundaryValidators\.js["']/);
  assert.match(kaiBackendIndexSource, /from\s+["']\.\/validators\/auditValidators\.js["']/);
  assert.match(kaiBackendIndexSource, /from\s+["']\.\/services\/auditService\.js["']/);
  assert.match(kaiBackendIndexSource, /validateP0IntakeStateTransitionAttempt/);
  assert.match(kaiBackendIndexSource, /validateBlockedAttemptAuditPayload/);
  assert.match(kaiBackendIndexSource, /recordBlockedAttemptAudit/);
  assert.doesNotMatch(kaiBackendIndexSource, /from\s+["'][^"']*(?:kaiDb|db\/pg|kaiIntakeQueries|storageAdapter)\.js["']/);
});

test("Pass 1C auth helper SQL source is SELECT-only and isolated to helper modules", () => {
  const authSource = `${actorSource}\n${tenantAuthorizationSource}`;
  assert.match(actorSource, /FROM kai\.users/);
  assert.match(actorSource, /JOIN kai\.roles/);
  assert.match(tenantAuthorizationSource, /FROM kai\.organization_memberships/);
  assert.doesNotMatch(authSource, /\b(?:INSERT|UPDATE|DELETE|UPSERT|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i);
  assert.doesNotMatch(authSource, /from\s+["'][^"']*(?:kaiDb|db\/pg|kaiQueries)\.js["']/);
  assert.doesNotMatch(authSource, /\bconnect\s*\(|\bnew\s+Pool\b/);
});

test("Pass 1C tests use injected query functions and do not runtime-import DB modules", () => {
  const pass1cTestSource = `${actorContextTestSource}\n${tenantAuthorizationTestSource}`;
  assert.doesNotMatch(pass1cTestSource, /import\s+[\s\S]*["'][^"']*Backend\/kai\/db\/kaiDb\.js["']/);
  assert.doesNotMatch(pass1cTestSource, /import\s+[\s\S]*["'][^"']*Backend\/db\/pg\.js["']/);
  assert.doesNotMatch(pass1cTestSource, /import\s+[\s\S]*["'][^"']*Backend\/kai\/db\/kaiQueries\.js["']/);
  assert.doesNotMatch(pass1cTestSource, /\bnew\s+Pool\b/);
  assert.match(pass1cTestSource, /createActorQuery/);
  assert.match(pass1cTestSource, /createMembershipQuery/);
  assert.match(pass1cTestSource, /hydrateSprint2ActorContextFromRequest/);
  assert.match(pass1cTestSource, /authorizeSprint2TenantMembershipWithLookup/);
});
