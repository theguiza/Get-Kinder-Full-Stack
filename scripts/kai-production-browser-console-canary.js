/* KAI production browser-console canary (Plan A customer file-to-report journey).
 *
 * Paste this whole file into the Chrome DevTools Console of the signed-in Get
 * Kinder application (Knowledge Studio, /impact-library). It defines
 * window.KAI_CANARY and immediately runs a read-only preflight.
 *
 * The canary only ever sends same-origin GET requests to the KAI intake API
 * with the page's own session cookie. It performs no upload, decision,
 * generation, review or release: every write is a human action in the
 * product UI. Owner decision 2026-10-25: an ordinary measured fact needs no
 * GK review, factual approval or release for internal use, so the journey is
 * measurement -> automatic internal eligibility -> generation -> internal
 * report download. It stores only a run tag, workspace ids and stage outcomes in
 * localStorage, never tokens, cookies, signed URLs or report content.
 */
(() => {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const VERSION = "kai-console-canary-2026-10-25.1";
  const API = "/api/kai/sprint2/intake";
  const STORE_KEY = "kai.productionConsoleCanary.v1";
  const CONFIRM_PHRASE = "I AUTHORIZE A SYNTHETIC PRODUCTION RUN";
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const S = Object.freeze({
    PASS: "PASS",
    FAIL: "FAIL",
    BLOCKED: "BLOCKED",
    WAITING: "WAITING_FOR_HUMAN",
    NOT_CONFIRMED: "NOT_CONFIRMED",
  });
  const EXPECTED_COUNTS = Object.freeze({ dataRecords: 6, blankRecords: 1, duplicateRecords: 2, counted: 5 });
  const PROCESSING_STALL_MINUTES = 20;
  const MEASUREMENT_LIMITATION_CODES = Object.freeze([
    "measurement.record_meaning_human_defined",
    "measurement.period_human_attested_not_row_verified",
    "measurement.blank_records_excluded",
    "measurement.duplicate_records_included",
  ]);
  // Operating Model 7.2 categories: all 'absent' makes the measured fact
  // ordinary (usable internally with no further review); anything else keeps
  // it with Get Kinder.
  const ORDINARY_CATEGORIES = Object.freeze([
    "reviewed_personal_data_status",
    "reviewed_minor_data_status",
    "reviewed_health_housing_justice_immigration_status",
    "reviewed_indigenous_governance_status",
    "reviewed_story_testimonial_status",
    "reviewed_small_cell_risk_status",
  ]);
  const REQUIRED_CUSTOMER_CAPABILITIES = Object.freeze({
    intakeContribution: (c) => c.intakeContribution,
    reviewSensitivity: (c) => c.workflowOperations?.reviewSensitivity,
    promoteSource: (c) => c.workflowOperations?.promoteSource,
    recordSourceMeasurement: (c) => c.workflowOperations?.recordSourceMeasurement,
    proposeClaim: (c) => c.workflowOperations?.proposeClaim,
    generateDrafts: (c) => c.workflowOperations?.generateDrafts,
    readInternalDrafts: (c) => c.workflowOperations?.readInternalDrafts,
  });
  const STAGES = Object.freeze([
    { key: "workspace", name: "1 Workspace", expected: "Signed-in customer administrator with every workflow capability, in the authorized synthetic organization and Project" },
    { key: "fixture", name: "2 Synthetic CSV", expected: "Browser-generated CSV: 6 data rows, 1 blank, 2 exact duplicates, 5 counted" },
    { key: "upload_processing", name: "3 Upload, scan, P1", expected: "Exactly one uploaded file for this run; stored size matches; security policy passed; parse, dictionary and sensitivity profile complete" },
    { key: "sensitivity_source", name: "4 Sensitivity & promotion", expected: "Human 'reviewed' decision (allowed use allowed, AI permitted); source promoted; current version profiled 6/1/2/5" },
    { key: "measurement", name: "5 Measurement & claim", expected: "Human definition with attested period; measured value 5 (6 rows - 1 blank, 2 duplicates kept); evidence and claim linked" },
    { key: "internal_eligibility", name: "6 Internal eligibility", expected: "Claim eligible for internal use automatically (ordinary measured fact); no evidence, claim or limitation review required" },
    { key: "generation", name: "7 AI generation", expected: "New internal Evidence Summary generated in this run, citing only the measured claim, with count, unit, period and limitations, and no invented findings" },
    { key: "download_validation", name: "8 Internal report", expected: "Internal report Markdown download, with no factual approval or release step: count 5, period, method, duplicates, limitations, citations, no raw rows or invented findings" },
  ]);

  // ---------------------------------------------------------------- utilities
  const isUuid = (value) => typeof value === "string" && UUID_RE.test(value);
  const enc = encodeURIComponent;
  const nowIso = () => new Date().toISOString();
  const short = (value, max = 260) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text && text.length > max ? `${text.slice(0, max - 3)}...` : text;
  };
  const result = (status, observed, next, extra = {}) => ({ status, observed: short(observed, 400), next, ...extra });
  const pathOf = {
    orgs: () => `${API}/admin/organizations`,
    caps: (o) => `${API}/admin/organizations/${enc(o)}/access-capabilities`,
    engagements: (o) => `${API}/admin/organizations/${enc(o)}/engagements`,
    pipeline: (o, e) => `${API}/admin/organizations/${enc(o)}/engagements/${enc(e)}/client-evidence-pipeline`,
    fileDetail: (o, f) => `${API}/admin/files/${enc(f)}?organization_id=${enc(o)}`,
    fileSensitivity: (o, f) => `${API}/admin/review-cockpit/intake-files/${enc(f)}/sensitivity-profile?organization_id=${enc(o)}`,
    sensitivityProfile: (o, p) => `${API}/admin/review-cockpit/sensitivity-profiles/${enc(p)}?organization_id=${enc(o)}`,
    fileCandidate: (o, e, f) => `${API}/admin/review-cockpit/intake-files/${enc(f)}/source-candidate?organization_id=${enc(o)}&engagement_id=${enc(e)}`,
    candidate: (o, c) => `${API}/admin/review-cockpit/source-candidates/${enc(c)}?organization_id=${enc(o)}`,
    measurement: (o, v) => `${API}/admin/organizations/${enc(o)}/source-versions/${enc(v)}/record-count-measurement`,
    impactFacts: (o) => `${API}/admin/organizations/${enc(o)}/impact-facts`,
    traceability: (o, c) => `${API}/admin/organizations/${enc(o)}/claims/${enc(c)}/traceability?requested_audience=internal`,
    drafts: (o, e, cursor) => `${API}/admin/organizations/${enc(o)}/engagements/${enc(e)}/client-internal-drafts${cursor ? `?cursor=${enc(cursor)}` : ""}`,
    draft: (o, e, d) => `${API}/admin/organizations/${enc(o)}/engagements/${enc(e)}/client-internal-drafts/${enc(d)}`,
    markdown: (o, e, d) => `${API}/admin/organizations/${enc(o)}/engagements/${enc(e)}/client-internal-drafts/${enc(d)}/markdown`,
  };

  function classify(status, contentType) {
    if (status === 0) return "network_error";
    if (status === 401) return "authentication_required";
    if (status === 403) return "authorization_denied";
    if (status === 404) return "not_found_route_or_resource";
    if (status === 409) return "conflict_current_state_changed";
    if (status === 422) return "validation_blocker";
    if (status >= 500) return "server_error";
    if (!/json|markdown/.test(contentType || "")) return "non_api_response_possibly_signed_out";
    return `http_${status}`;
  }

  // The only network primitive: a same-origin GET with the page's session.
  // There is deliberately no helper that can send any other method.
  async function get(path, { markdown = false } = {}) {
    if (typeof path !== "string" || !path.startsWith(`${API}/`)) throw new Error("canary_refuses_non_KAI_path");
    if (typeof W.fetch !== "function") return { status: 0, ok: false, code: "fetch_unavailable", label: "0 fetch_unavailable" };
    let response;
    try {
      response = await W.fetch(path, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: markdown ? "text/markdown" : "application/json" },
      });
    } catch (error) {
      return { status: 0, ok: false, code: "network_error", label: `0 network_error ${short(String(error?.message || error), 80)}` };
    }
    const contentType = response.headers.get("content-type") || "";
    if (markdown && response.status === 200 && !/json/.test(contentType)) {
      return { status: 200, ok: true, text: await response.text(), disposition: response.headers.get("content-disposition") || "", contentType };
    }
    let body = null;
    if (/json/.test(contentType)) {
      try { body = await response.json(); } catch { body = null; }
    }
    const ok = response.status >= 200 && response.status < 300 && body?.ok === true;
    const code = ok ? null : (body?.error?.code || classify(response.status, contentType));
    const blockers = Array.isArray(body?.blockers)
      ? body.blockers.map((b) => b?.blocking_reason || b?.object_code).filter(Boolean)
      : [];
    return {
      status: response.status,
      ok,
      data: ok ? body.data : null,
      code,
      blockers,
      label: ok ? `${response.status}` : `${response.status} ${code}${blockers.length ? ` [${blockers.join(", ")}]` : ""}`,
    };
  }

  function apiFailure(stageName, response) {
    const code = response.code || "";
    const next = {
      authentication_required: "Sign in to Get Kinder again in this tab, then run KAI_CANARY.resume().",
      authorization_denied: "Use the authorized customer administrator account for this organization.",
      feature_disabled: "A server feature flag is off; the canary cannot change it. Report this to the owner.",
      not_found_route_or_resource: "The deployed version lacks this route or the object is not visible to this account.",
      not_found: "The object is not visible to this account, or it no longer exists.",
      conflict_current_state_changed: "The state changed (stale or superseded). Read the observed blockers.",
      validation_blocker: "The server refused the request shape; report this canary version and stage.",
      non_api_response_possibly_signed_out: "The API answered with a non-JSON page; the session probably expired. Sign in again.",
    }[code] || "Investigate the observed HTTP status and code.";
    const status = /authentication|authorization|feature_disabled|not_found|non_api|network|fetch_unavailable/.test(code) ? S.BLOCKED : S.FAIL;
    return result(status, `${stageName} read failed: ${response.label}`, next);
  }

  // --------------------------------------------------------------- fixture
  function makeTag() {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
    const random = (W.crypto?.getRandomValues ? Array.from(W.crypto.getRandomValues(new Uint8Array(3))) : [Math.random() * 256, Math.random() * 256, Math.random() * 256])
      .map((n) => Math.floor(n).toString(16).padStart(2, "0")).join("");
    return `kc${stamp}${random}`;
  }
  // The Plan A synthetic programme-session log plus a canary_run column, so
  // every run's bytes are unique (the intake refuses repeated bytes) and the
  // uploaded file is identifiable. No real person, client or organization.
  function fixtureText(tag) {
    if (!/^kc[0-9]{12}[0-9a-f]{6}$/.test(tag || "")) throw new Error("invalid_canary_tag");
    return [
      "session_date,programme,attendees,canary_run",
      `2026-09-02,literacy,12,${tag}`,
      `2026-09-09,literacy,,${tag}`,
      "",
      `2026-09-16,mentoring,8,${tag}`,
      `2026-09-16,mentoring,8,${tag}`,
      `2026-09-23,mentoring,11,${tag}`,
      "",
    ].join("\n");
  }
  const fixtureFilename = (tag) => `kai_canary_${tag}.csv`;
  // Mirrors the P1 profiling rules: every line after the header is a data
  // record (the final newline ends the last one); a record whose every field
  // is empty is blank; exact duplicates count every copy; counted = records - blank.
  function countFixture(text) {
    const lines = String(text).split("\n");
    if (lines.at(-1) === "") lines.pop();
    const data = lines.slice(1);
    const blank = data.filter((line) => line.split(",").every((cell) => cell.trim() === "")).length;
    const seen = new Map();
    for (const line of data) seen.set(line, (seen.get(line) || 0) + 1);
    const duplicates = [...seen.values()].filter((n) => n > 1).reduce((sum, n) => sum + n, 0);
    return { dataRecords: data.length, blankRecords: blank, duplicateRecords: duplicates, counted: data.length - blank };
  }
  const byteLength = (text) => new TextEncoder().encode(text).byteLength;

  // ---------------------------------------------------------------- state
  function loadState() {
    try {
      const raw = W.localStorage?.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function saveState(state) {
    try {
      W.localStorage?.setItem(STORE_KEY, JSON.stringify(state));
      return true;
    } catch {
      console.warn("[KAI canary] localStorage is unavailable: the run cannot be recovered after a reload.");
      return false;
    }
  }
  function requireRun() {
    const state = loadState();
    if (!state?.runId) throw new Error("No canary run in this browser. Run KAI_CANARY.preflight(), then KAI_CANARY.start({...}).");
    if (state.origin !== W.location?.origin) throw new Error(`This run belongs to ${state.origin}; open that site to continue it.`);
    return state;
  }
  function productionOrigin() {
    const { protocol, hostname } = W.location || {};
    return protocol === "https:" && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(hostname || "");
  }

  // ------------------------------------------------------------ workspace
  function missingCapabilities(caps) {
    return Object.entries(REQUIRED_CUSTOMER_CAPABILITIES).filter(([, read]) => read(caps || {}) !== true).map(([key]) => key);
  }
  function selectedProjectFromPage() {
    const select = W.document?.getElementById?.("gk-shell-project-select");
    return select && isUuid(select.value) ? select.value : null;
  }
  async function evaluateWorkspace(organizationId, engagementId) {
    const orgs = await get(pathOf.orgs());
    if (!orgs.ok) return apiFailure("Organization list", orgs);
    const orgIds = (orgs.data?.items || []).map((item) => item.organization_id).filter(isUuid);
    if (!isUuid(organizationId)) {
      return result(S.NOT_CONFIRMED, `Signed in. Authorized organizations: ${orgIds.join(", ") || "none"}`,
        "Pass the synthetic organization id: KAI_CANARY.preflight({ organizationId: '<uuid>', engagementId: '<uuid>' })", { orgIds });
    }
    if (!orgIds.includes(organizationId)) {
      return result(S.BLOCKED, `Organization ${organizationId} is not among this account's authorized organizations (${orgIds.join(", ") || "none"})`,
        "Sign in as the customer administrator of the synthetic organization.", { orgIds });
    }
    const caps = await get(pathOf.caps(organizationId));
    if (!caps.ok) return apiFailure("Access capabilities", caps);
    const missing = missingCapabilities(caps.data);
    const engagements = await get(pathOf.engagements(organizationId));
    if (!engagements.ok) return apiFailure("Projects", engagements);
    const items = engagements.data?.items || [];
    const engagement = items.find((item) => item.engagement_id === engagementId);
    if (missing.length) {
      return result(S.BLOCKED, `Missing customer capabilities: ${missing.join(", ")}`,
        "Use an active client_admin of this organization. The canary will not grant roles.", { caps: caps.data });
    }
    if (!isUuid(engagementId) || !engagement) {
      const listed = items.map((item) => `${item.engagement_code || "(no code)"}=${item.engagement_id}`).join("; ");
      return result(S.NOT_CONFIRMED, `Capabilities OK. Project ${engagementId || "(none selected)"} not confirmed. Projects: ${listed || "none"}`,
        "Pass the synthetic Project id as engagementId (or select it in the Project bar first).", { caps: caps.data });
    }
    return result(S.PASS, `Customer capabilities OK; organization ${organizationId}; Project ${engagement.engagement_code || ""} (${engagementId})`,
      "Continue.", { caps: caps.data, engagementCode: engagement.engagement_code || null });
  }

  // ----------------------------------------------------- stage evaluators
  function fileLabel(state) { return fixtureFilename(state.tag); }

  async function evalFixture(state) {
    const text = fixtureText(state.tag);
    const counts = countFixture(text);
    const ok = Object.entries(EXPECTED_COUNTS).every(([key, value]) => counts[key] === value);
    if (!ok) return result(S.FAIL, `Generated fixture counts ${JSON.stringify(counts)}`, "Do not upload; report this canary defect.");
    if (!state.fixture?.generatedAt) {
      return result(S.WAITING, `Fixture ${fileLabel(state)} verified in memory (${byteLength(text)} bytes) but not yet produced for upload`,
        "Run KAI_CANARY.makeFixture() (downloads it) or, on the Files tab, KAI_CANARY.attachFixture().");
    }
    return result(S.PASS, `${fileLabel(state)}: ${counts.dataRecords} data rows, ${counts.blankRecords} blank, ${counts.duplicateRecords} exact duplicates, ${counts.counted} counted; ${byteLength(text)} bytes`, "Upload it in the Files tab.");
  }

  async function readRunFile(state) {
    const pipeline = await get(pathOf.pipeline(state.organizationId, state.engagementId));
    if (!pipeline.ok) return { failure: apiFailure("Evidence pipeline", pipeline) };
    const files = (pipeline.data?.files || []).filter((file) => String(file.safeFilename || "").includes(state.tag));
    return { pipeline: pipeline.data, files };
  }
  const stageMap = (file) => new Map((file?.stages || []).map((stage) => [stage.key, stage]));

  async function evalUpload(state) {
    const read = await readRunFile(state);
    if (read.failure) return read.failure;
    if (read.files.length === 0) {
      if (read.pipeline?.truncated) return result(S.NOT_CONFIRMED, "Pipeline list is truncated at 100 files; this run's file is not in the first page", "Use a Project with fewer files.");
      return result(S.WAITING, `No uploaded file named like ${fileLabel(state)} in this Project yet`,
        `Knowledge Studio > Files tab > Project ${state.engagementCode || state.engagementId}: create or select a batch, choose ${fileLabel(state)} (or run KAI_CANARY.attachFixture()), click "Upload the selected file" once, then KAI_CANARY.next().`);
    }
    if (read.files.length > 1) {
      return result(S.BLOCKED, `${read.files.length} files carry this run tag: ${read.files.map((f) => f.intakeFileId).join(", ")}`,
        "The canary will not choose between them. Start a new run with KAI_CANARY.start({ ..., newRun: true }).");
    }
    const file = read.files[0];
    state.ids.intakeFileId = file.intakeFileId;
    const stages = stageMap(file);
    const ordered = ["upload", "security_check", "processing", "data_dictionary", "sensitivity_classification"];
    for (const key of ordered) {
      const stage = stages.get(key);
      if (stage?.status === "complete") continue;
      const summary = `${key}: ${stage?.status || "missing"}${stage?.failureCategory ? ` (${stage.failureCategory})` : ""}`;
      if (stage?.status === "failed") {
        return result(S.FAIL, `File ${file.intakeFileId} ${summary}`, stage.responsible === "get_kinder" ? "Contact Get Kinder; the deployed processing failed." : "Upload a corrected file in a new run.");
      }
      if (key === "security_check" && stage?.status === "waiting_for_client") {
        return result(S.BLOCKED, `Security scanner unavailable for file ${file.intakeFileId} (${stage.failureCategory || "security_check_unavailable"}); the file stays quarantined`,
          `When the scanner is available, Files tab > pipeline entry > "Check security again" (button [data-security-check-retry="${file.intakeFileId}"]), then KAI_CANARY.next().`);
      }
      const minutes = file.uploadedAt ? Math.round((Date.now() - Date.parse(file.uploadedAt)) / 60000) : null;
      if (minutes !== null && minutes >= PROCESSING_STALL_MINUTES) {
        return result(S.BLOCKED, `File ${file.intakeFileId} ${summary} for ${minutes} minutes; the deployed scanner or P1 worker appears unavailable`,
          "Report the stalled stage to the owner; the canary will not retry the upload.");
      }
      return result(S.NOT_CONFIRMED, `File ${file.intakeFileId} ${summary}${minutes !== null ? ` (${minutes} min since upload)` : ""}`,
        "Processing is pending. Wait a minute, then KAI_CANARY.next().");
    }
    const detail = await get(pathOf.fileDetail(state.organizationId, file.intakeFileId));
    if (!detail.ok) return apiFailure("File detail", detail);
    const d = detail.data || {};
    const expectedBytes = byteLength(fixtureText(state.tag));
    const problems = [];
    if (d.organization_id !== state.organizationId) problems.push(`organization ${d.organization_id}`);
    if (d.engagement_id !== state.engagementId) problems.push(`engagement ${d.engagement_id}`);
    // Sizes are bigint columns and may arrive as strings.
    if (Number(d.file_size_bytes) !== expectedBytes) problems.push(`size ${d.file_size_bytes} != ${expectedBytes}`);
    if (d.file_policy_status !== "passed") problems.push(`file_policy_status ${d.file_policy_status}`);
    const observed = `file ${file.intakeFileId} (${d.safe_filename}); ${d.file_size_bytes} bytes; policy ${d.file_policy_status}; scan ${d.malware_scan_status}; latest assessment ${d.security_assessment?.category || "none"}/${d.security_assessment?.policy_outcome || "none"}; processing ${d.processing_status}; parse ${d.parse_status}`;
    if (problems.length) return result(S.FAIL, `${observed}. Mismatch: ${problems.join("; ")}`, "Do not continue with this file.");
    if (d.security_assessment?.policy_outcome !== "passed") {
      return result(S.NOT_CONFIRMED, `${observed}. No persisted 'passed' security assessment decision is visible`, "Report to the owner; the scan result cannot be confirmed.");
    }
    return result(S.PASS, observed, "Continue to sensitivity review.");
  }

  async function evalSensitivitySource(state) {
    const read = await readRunFile(state);
    if (read.failure) return read.failure;
    const file = read.files.find((f) => f.intakeFileId === state.ids.intakeFileId);
    if (!file) return result(S.FAIL, `Run file ${state.ids.intakeFileId} no longer appears in the Project pipeline`, "Investigate; the canary will not re-upload.");
    const stages = stageMap(file);
    const sensitivity = stages.get("sensitivity_review");
    const source = stages.get("source_review");
    if (sensitivity?.status !== "complete") {
      return result(S.WAITING, `sensitivity_review: ${sensitivity?.status || "missing"} (next action ${file.nextAction})`,
        `Knowledge Studio > Data Sources tab > Project ${state.engagementCode || ""}: click "Review sensitivity & allowed use" on file ${file.intakeFileId} ([data-client-open-sensitivity-review]). Record your own judgment of each category, allowed use "allowed" and AI processing permitted only if you attest them, click "Submit review", then KAI_CANARY.next().`);
    }
    if (source?.status === "closed") {
      return result(S.FAIL, `source_review closed (${file.reason}); the decision does not allow use`, "This run cannot continue. Start a new run if the decision was recorded in error.");
    }
    if (source?.status !== "complete") {
      return result(S.WAITING, `source_review: ${source?.status || "missing"} (next action ${file.nextAction})`,
        `Data Sources tab: click "Review & promote source" ([data-client-open-source-review="${file.intakeFileId}"]), choose Decision outcome "promoted" and the reviewed source type you attest, read and tick the source authorization, click "Promote", then KAI_CANARY.next().`);
    }
    const lookup = await get(pathOf.fileSensitivity(state.organizationId, file.intakeFileId));
    if (!lookup.ok) return apiFailure("Sensitivity profile lookup", lookup);
    const profileId = lookup.data?.intake_sensitivity_profile_id;
    if (!isUuid(profileId)) return result(S.FAIL, "No sensitivity profile id for the run file", "Investigate the deployed P1-05 step.");
    const profile = await get(pathOf.sensitivityProfile(state.organizationId, profileId));
    if (!profile.ok) return apiFailure("Sensitivity profile", profile);
    const decision = profile.data?.current_decision;
    if (!decision) return result(S.FAIL, "Pipeline says sensitivity review is complete but no current decision is readable", "Investigate.");
    const categories = Object.fromEntries(ORDINARY_CATEGORIES.map((key) => [key.replace(/^reviewed_|_status$/g, ""), decision[key] ?? "missing"]));
    const ordinary = ORDINARY_CATEGORIES.every((key) => decision[key] === "absent");
    const decisionText = `decision ${decision.decision_outcome} by ${decision.decided_by_role} (${decision.created_by_type}); allowed use ${decision.reviewed_allowed_use_status}; AI ${decision.reviewed_llm_processing_allowed}; 7.2 categories ${JSON.stringify(categories)}`;
    if (decision.decision_outcome !== "reviewed" || decision.created_by_type !== "human"
      || decision.reviewed_allowed_use_status !== "allowed" || decision.reviewed_llm_processing_allowed !== true) {
      return result(S.FAIL, `${decisionText}: not a human decision permitting use and AI processing`, "This run cannot reach generation.");
    }
    const candidateLookup = await get(pathOf.fileCandidate(state.organizationId, state.engagementId, file.intakeFileId));
    if (!candidateLookup.ok) return apiFailure("Source candidate lookup", candidateLookup);
    const candidateId = candidateLookup.data?.intake_source_candidate_id;
    const candidate = isUuid(candidateId) ? await get(pathOf.candidate(state.organizationId, candidateId)) : null;
    if (!candidate?.ok) return candidate ? apiFailure("Source candidate", candidate) : result(S.FAIL, "No source candidate id", "Investigate.");
    const promotion = candidate.data?.promotion_decision;
    const version = candidate.data?.source_version;
    if (promotion?.decision_status !== "promoted" || !version || version.is_current !== true || !isUuid(version.source_version_id)
      || promotion.source_version_id !== version.source_version_id || version.organization_id !== state.organizationId) {
      return result(S.FAIL, `Promotion ${promotion?.decision_status || "none"}; version ${version?.source_version_id || "none"} current=${version?.is_current}`, "Investigate the promotion state.");
    }
    const basis = await get(pathOf.measurement(state.organizationId, version.source_version_id));
    if (!basis.ok) return apiFailure("Record-count basis", basis);
    const b = basis.data?.basis || {};
    const counts = { dataRecords: b.data_record_count, blankRecords: b.blank_record_count, duplicateRecords: b.duplicate_record_count, counted: b.counted_record_count };
    if (b.measurable !== true || !Object.entries(EXPECTED_COUNTS).every(([key, value]) => counts[key] === value)) {
      return result(S.FAIL, `${decisionText}; version ${version.source_version_id}; deployed P1 counts ${JSON.stringify(counts)}${b.blockers ? ` blockers ${short(b.blockers, 120)}` : ""}`,
        "The deployed parser's counts differ from the fixture; do not continue.");
    }
    state.ids.intakeSensitivityProfileId = profileId;
    state.ids.intakeSourceCandidateId = candidateId;
    state.ids.sourceVersionId = version.source_version_id;
    state.ordinary = ordinary;
    state.decidedByRole = decision.decided_by_role;
    return result(S.PASS, `${decisionText}; promoted as ${promotion.reviewed_source_type}; current version ${version.source_version_id}; deployed P1 counts 6 rows / 1 blank / 2 duplicates / 5 counted${ordinary ? "" : "; NOTE: not every 7.2 category is 'absent', so factual review and release stay with Get Kinder"}`,
      "Continue to Count records.");
  }

  async function evalMeasurement(state) {
    const basis = await get(pathOf.measurement(state.organizationId, state.ids.sourceVersionId));
    if (!basis.ok) return apiFailure("Record-count measurement", basis);
    const recorded = basis.data?.recorded;
    const instruction = `Data Sources tab: click "Count records" on version ${state.ids.sourceVersionId} ([data-client-open-source-measurement]). Enter what one record means (suggested: counted unit "programme session", unit label "programme sessions"), inclusion and exclusion rules, and a reporting period you attest for this synthetic log (suggested 2026-09-01 to 2026-09-30). Tick the period attestation, click "Record definition and count" once, then KAI_CANARY.next().`;
    if (!recorded) return result(S.WAITING, "No record-count definition recorded for this source version", instruction);
    const m = recorded.measurement;
    const d = recorded.definition || {};
    if (!m) return result(S.FAIL, "A definition is recorded but no measurement is readable", "Investigate.");
    const observed = `measured ${m.measured_value} ${d.unit_label} (rows ${m.total_record_count}, blank ${m.blank_record_count}, duplicates ${m.duplicate_record_count}); period ${d.period_start || "none"} to ${d.period_end || "none"}; definition by ${d.created_by_type} (${d.definition_status}); evidence ${m.evidence_item_id}`;
    if (m.measured_value !== 5 || m.total_record_count !== 6 || m.blank_record_count !== 1 || m.duplicate_record_count !== 2
      || !isUuid(m.evidence_item_id) || m.source_version_id !== state.ids.sourceVersionId || m.organization_id !== state.organizationId) {
      return result(S.FAIL, `${observed}: measurement does not equal the fixture's 5 counted records`, "Do not continue.");
    }
    if (d.created_by_type !== "human" || d.definition_status !== "human_confirmed") {
      return result(S.FAIL, `${observed}: definition is not human-confirmed`, "Do not continue.");
    }
    if (!d.period_start || !d.period_end) {
      return result(S.BLOCKED, `${observed}: no reporting period was recorded`, "A recorded definition is immutable for its version; start a new run and attest a reporting period.");
    }
    const codes = (recorded.limitations || []).map((entry) => entry.code);
    const missingCodes = MEASUREMENT_LIMITATION_CODES.filter((code) => !codes.includes(code));
    if (missingCodes.length) return result(S.FAIL, `${observed}; missing measurement limitations ${missingCodes.join(", ")}`, "Do not continue.");
    state.ids.evidenceItemId = m.evidence_item_id;
    state.period = { start: d.period_start, end: d.period_end };
    state.unit = { countedUnit: d.counted_unit, unitLabel: d.unit_label };
    const claim = recorded.claim;
    if (!claim) {
      return result(S.WAITING, `${observed}; no claim proposed yet`,
        `In the Count records panel click "Propose a claim" ([data-client-source-measurement-propose-claim="${m.evidence_item_id}"]) once, then KAI_CANARY.next().`);
    }
    const expectedStart = `The promoted source records 5 ${d.unit_label} for the reporting period ${d.period_start} to ${d.period_end}`;
    if (!isUuid(claim.claim_id) || !String(claim.statement || "").startsWith(expectedStart)) {
      return result(S.FAIL, `${observed}; claim ${claim.claim_id}: "${short(claim.statement, 160)}"`, "The claim does not state the measured value and period; do not continue.");
    }
    state.ids.claimId = claim.claim_id;
    return result(S.PASS, `${observed}; claim ${claim.claim_id} (${claim.claim_review_status}): "${short(claim.statement, 160)}"; limitations ${codes.join(", ")}`,
      "Internal eligibility is checked automatically; run KAI_CANARY.next().");
  }

  // Owner decision 2026-10-25: nobody reviews an ordinary measured fact for
  // internal use. A claim that is not eligible has a real reason (a high-risk
  // or unknown sensitivity category, a stale source, an open conflict); the
  // canary reports it and bypasses nothing.
  async function evalInternalEligibility(state) {
    const facts = await get(pathOf.impactFacts(state.organizationId));
    if (!facts.ok) return apiFailure("Impact Facts", facts);
    const fact = (facts.data?.items || []).find((item) => item.claimId === state.ids.claimId);
    if (!fact) {
      if (facts.data?.truncated) return result(S.NOT_CONFIRMED, "Impact Facts list is truncated and the claim is not on the first page", "Investigate with the Get Kinder team.");
      return result(S.BLOCKED, `Claim ${state.ids.claimId} is not eligible for internal use${state.ordinary === false ? " (the source records a high-risk or unknown sensitivity category, so Get Kinder reviews it)" : ""}`,
        `Data Sources tab > "View measurement" on claim ${state.ids.claimId} shows the server's reasons. The canary will not bypass them.`);
    }
    return result(S.PASS, `Claim ${state.ids.claimId} is eligible for internal use with no review step; limitations carried: ${(fact.limitationDimensionKeys || []).join(", ") || "none"}`, "Generate the internal Evidence Summary.");
  }

  async function listDrafts(state) {
    const items = [];
    let cursor = null;
    for (let page = 0; page < 10; page += 1) {
      const response = await get(pathOf.drafts(state.organizationId, state.engagementId, cursor));
      if (!response.ok) return { failure: response };
      items.push(...(response.data?.items || []));
      cursor = response.data?.nextCursor || null;
      if (!cursor) break;
    }
    return { items };
  }
  const draftText = (draft) => (draft?.blocks || []).map((block) => String(block.text || "")).join("\n");
  // Terms for findings the measured claim cannot support. A sentence that
  // only negates them ("not of distinct events") is reported, not failed.
  const UNSUPPORTED_RE = /\b(participants?|attendees?|people|individuals|outcomes?|rates?|percent(?:age)?s?|caused?|because|led to|resulted in|improv\w*|impact\w*|effective\w*|unique|distinct)\b|%/i;
  const NEGATION_RE = /\b(not|no|never|without|cannot|does not|do not|is not|are not|n't)\b/i;
  function scanFindings(text) {
    const sentences = String(text).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
    const violations = [];
    const negated = [];
    for (const sentence of sentences) {
      if (!UNSUPPORTED_RE.test(sentence)) continue;
      (NEGATION_RE.test(sentence) ? negated : violations).push(short(sentence, 160));
    }
    return { violations, negated };
  }
  function contentChecks(text, state) {
    const count = new RegExp(`\\b(?:5|five)\\s+${state.unit.unitLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return {
      countAndUnit: count.test(text),
      periodStart: text.includes(state.period.start),
      periodEnd: text.includes(state.period.end),
      blankDisclosed: /\bblank\b/i.test(text),
      duplicatesDisclosed: /\bduplicate/i.test(text),
      periodAttestationDisclosed: /\b(attested|as stated|stated in the definition|reported period|not (?:been )?verified|unverified)\b/i.test(text),
    };
  }

  async function evalGeneration(state) {
    const listed = await listDrafts(state);
    if (listed.failure) return apiFailure("Internal drafts", listed.failure);
    const baseline = new Set(state.baselineDraftIds || []);
    const fresh = listed.items
      .filter((item) => item.contentType === "evidence_summary" && !baseline.has(item.generatedContentDraftId))
      .filter((item) => !item.createdAt || Date.parse(item.createdAt) >= Date.parse(state.startedAt) - 60000)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const citing = [];
    for (const item of fresh) {
      const detail = await get(pathOf.draft(state.organizationId, state.engagementId, item.generatedContentDraftId));
      if (!detail.ok) return apiFailure(`Draft ${item.generatedContentDraftId}`, detail);
      if ((detail.data?.blocks || []).some((block) => (block.supportingClaimIds || []).includes(state.ids.claimId))) citing.push(detail.data);
    }
    if (citing.length === 0) {
      return result(S.WAITING, `No internal Evidence Summary generated since this run started cites claim ${state.ids.claimId}`,
        `Data Sources tab: tick "Use in an internal draft" on claim ${state.ids.claimId} ([data-client-claim="${state.ids.claimId}"]) only, click "Generate internal evidence summary" ONCE and wait for "Internal evidence summary created", then KAI_CANARY.next(). If generation shows an error, record it; do not retry repeatedly.`);
    }
    const draft = citing[0];
    const note = citing.length > 1 ? ` NOTE: ${citing.length} new drafts cite the claim; validating the earliest.` : "";
    state.ids.draftId = draft.generatedContentDraftId;
    const text = draftText(draft);
    const cited = new Set((draft.blocks || []).flatMap((block) => block.supportingClaimIds || []));
    const checks = contentChecks(text, state);
    const findings = scanFindings(text);
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
    if (draft.contentType !== "evidence_summary" || draft.audience !== "internal") failed.push(`type ${draft.contentType}/${draft.audience}`);
    if (cited.size !== 1 || !cited.has(state.ids.claimId)) failed.push(`citations ${[...cited].join(",")}`);
    if (draft.citedClaimsCurrentlyEligible !== true) failed.push("cited claim not currently eligible");
    if (findings.violations.length) failed.push(`unsupported findings: ${findings.violations.join(" | ")}`);
    state.generation = { checks, negatedMentions: findings.negated, limitations: draft.limitations };
    const observed = `draft ${draft.generatedContentDraftId} (${draft.reviewState}); ${draft.blocks?.length || 0} blocks; cites only claim ${state.ids.claimId}: ${cited.size === 1 && cited.has(state.ids.claimId)}; provider metadata is not exposed to the customer role, so provider use is shown only by a new draft created after this run started${note}`;
    if (draft.internalReport?.available !== true) failed.push(`internal report not available: ${[...(draft.internalReport?.getKinderReviewReasons || []), ...(draft.internalReport?.blockedReasons || [])].join(", ") || "no reason given"}`);
    if (failed.length) return result(S.FAIL, `${observed}. Failed: ${failed.join("; ")}`, "Do not use this draft. Record the failure; KAI_CANARY.report() shows the details.");
    return result(S.PASS, `${observed}. Count, unit, period, blank/duplicate and attestation disclosures present${findings.negated.length ? `; negated mentions: ${findings.negated.length}` : ""}; ready for internal use`,
      `"Your internal drafts" > "Read draft" on ${draft.generatedContentDraftId}, then "Open report" and "Download Markdown"; then KAI_CANARY.next().`);
  }

  // The internal report (kaiInternalReportMarkdownSerializer.js): its
  // generated narrative is the only model-written section, so only it is
  // scanned for unsupported findings.
  function validateMarkdown(markdown, state) {
    const text = String(markdown || "");
    const section = (heading) => (text.split(`\n## ${heading}\n`)[1] || "").split("\n## ")[0];
    const contentSection = section("Generated narrative");
    const escaped = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const findings = scanFindings(contentSection);
    const checks = {
      organizationLine: new RegExp(`^- \\*\\*Organization:\\*\\* .*\\(\`${escaped(state.organizationId)}\`\\)$`, "m").test(text),
      engagementLine: new RegExp(`^- \\*\\*Project / engagement:\\*\\* .*\\(\`${escaped(state.engagementId)}\`\\)$`, "m").test(text),
      internalEvidenceSummary: text.startsWith("# Internal Evidence Summary\n") && /internal use by this organization only/.test(text),
      countAndUnit: new RegExp(`\\*\\*(?:5|five)\\s+${escaped(state.unit.unitLabel)}\\*\\*`, "i").test(section("Key findings")),
      methodAndArithmetic: /minus 1 blank record excluded = \*\*5\*\* counted/.test(section("Measurement definition and counting method")),
      duplicatesIncluded: /2 exact-duplicate records\. They are included in the count of 5/.test(section("Duplicate records")),
      doesNotEstablish: /distinct people/.test(section("What this evidence does not establish")),
      conclusion: /records 5 /.test(section("Conclusion")),
      reportingPeriod: text.includes(state.period.start) && text.includes(state.period.end),
      claimEvidenceCitation: text.includes(`Claim \`${state.ids.claimId}\``) && text.includes(`Evidence \`${state.ids.evidenceItemId}\``),
      sourceVersionCitation: text.includes(`version \`${state.ids.sourceVersionId}\``),
      measurementLimitations: MEASUREMENT_LIMITATION_CODES.every((code) => text.includes(`\`${code}\``)),
      periodNotRowVerified: /not checked against dates in the records/.test(text),
      // A raw CSV row starts "date,programme"; a governed statement may put a
      // comma after the period's end date ("... 2026-09-30, counting ...").
      noRawRowsOrFileNames: !/literacy|mentoring|\d{4}-\d{2}-\d{2},[A-Za-z]/.test(text) && !text.includes(state.tag),
      noUnsupportedFindings: findings.violations.length === 0,
    };
    const coverageCodes = [...new Set(text.match(/`coverage\.[a-z_.]+`/g) || [])].map((code) => code.slice(1, -1));
    return { ok: Object.values(checks).every(Boolean), checks, coverageCodes, violations: findings.violations, negated: findings.negated, bytes: byteLength(text) };
  }

  async function evalDownload(state) {
    const path = pathOf.markdown(state.organizationId, state.engagementId, state.ids.draftId);
    const response = await get(path, { markdown: true });
    if (!response.ok) {
      if (response.status === 409) return result(S.FAIL, `Markdown download ${response.label}: a cited source is no longer current`, "Investigate currentness; nothing is re-generated automatically.");
      if (response.status === 422) return result(S.BLOCKED, `Markdown download ${response.label}: the draft is not usable as an internal report now`, "Read the draft's reasons in Internal Drafts; the canary bypasses nothing.");
      return apiFailure("Markdown download", response);
    }
    const link = W.document?.querySelector?.(`[data-client-download-internal-report="${state.ids.draftId}"]`);
    const linkNote = link ? `; UI download link ${link.getAttribute("href") === path ? "matches" : "DIFFERS"}` : "; UI download link not on screen";
    const validation = validateMarkdown(response.text, state);
    if (!/attachment/i.test(response.disposition)) validation.checks.attachmentDisposition = false;
    state.validation = { checks: validation.checks, coverageCodes: validation.coverageCodes, violations: validation.violations, negated: validation.negated, bytes: validation.bytes };
    const failed = Object.entries(validation.checks).filter(([, ok]) => !ok).map(([key]) => key);
    const observed = `HTTP 200 ${response.contentType}; ${validation.bytes} bytes; ${Object.keys(validation.checks).length - failed.length}/${Object.keys(validation.checks).length} checks; coverage limitations ${validation.coverageCodes.join(", ") || "none"}${linkNote}`;
    if (failed.length) return result(S.FAIL, `${observed}. Failed: ${failed.join(", ")}`, "KAI_CANARY.report() lists each check.");
    return result(S.PASS, observed, "Done.");
  }

  const EVALUATORS = {
    workspace: async (state) => {
      const r = await evaluateWorkspace(state.organizationId, state.engagementId);
      if (r.engagementCode) state.engagementCode = r.engagementCode;
      return r;
    },
    fixture: evalFixture,
    upload_processing: evalUpload,
    sensitivity_source: evalSensitivitySource,
    measurement: evalMeasurement,
    internal_eligibility: evalInternalEligibility,
    generation: evalGeneration,
    download_validation: evalDownload,
  };

  // ---------------------------------------------------------------- output
  function verdict(state) {
    const statuses = STAGES.map((stage) => state.stages?.[stage.key]?.status || S.NOT_CONFIRMED);
    if (statuses.every((status) => status === S.PASS)) {
      return productionOrigin() ? "END_TO_END_PASS" : "LOCAL_SIMULATION_ONLY (all stages passed on a non-production origin; not a production result)";
    }
    const index = statuses.findIndex((status) => status !== S.PASS);
    return `${statuses[index] === S.FAIL ? "FAILED" : "IN_PROGRESS"} at ${STAGES[index].name}: ${statuses[index]}`;
  }
  function rows(state) {
    return STAGES.map((stage) => {
      const entry = state.stages?.[stage.key] || {};
      return {
        Stage: stage.name,
        Status: entry.status || S.NOT_CONFIRMED,
        Observed: entry.observed || "(not evaluated yet)",
        Expected: stage.expected,
        "Next action": entry.next || "",
      };
    });
  }
  function print(state, title) {
    console.log(`%c[KAI canary] ${title}`, "font-weight:bold");
    console.log(`Run ${state.runId} (tag ${state.tag}) on ${state.origin}; organization ${state.organizationId}; Project ${state.engagementCode || ""} ${state.engagementId}`);
    console.table(rows(state));
    const current = STAGES.map((stage) => state.stages?.[stage.key]).find((entry) => entry && entry.status !== S.PASS);
    console.log(`%cVerdict: ${verdict(state)}`, "font-weight:bold");
    if (current?.next) console.log(`Next: ${current.next}`);
  }
  function summary(state) {
    return {
      verdict: verdict(state),
      runId: state.runId,
      tag: state.tag,
      stages: Object.fromEntries(STAGES.map((stage) => [stage.key, state.stages?.[stage.key]?.status || S.NOT_CONFIRMED])),
    };
  }

  // ------------------------------------------------------------ public API
  // Calls run one at a time, in the order typed (a command entered while the
  // paste-time preflight is still reading waits for it).
  let queue = Promise.resolve();
  function exclusive(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  async function preflight(options = {}) {
    return exclusive(async () => {
      const existing = loadState();
      const organizationId = options.organizationId || existing?.organizationId || null;
      let resolvedOrg = organizationId;
      const checks = [];
      const push = (check, status, observed, next = "") => checks.push({ Check: check, Status: status, Observed: short(observed, 300), "Next action": next });
      push("Execution surface", S.PASS, `Browser page ${W.location?.origin || "(no origin)"}${W.location?.pathname || ""}; canary ${VERSION}; read-only GET only`);
      push("Origin class", productionOrigin() ? S.PASS : S.NOT_CONFIRMED, productionOrigin() ? "HTTPS non-local origin (production-capable)" : "Local or non-HTTPS origin: results can never be END_TO_END_PASS");
      if (!String(W.location?.pathname || "").startsWith("/impact-library")) push("Page", S.NOT_CONFIRMED, "Not on /impact-library", "Open /impact-library (Knowledge Studio) before uploading or reviewing.");
      const counts = countFixture(fixtureText(existing?.tag || "kc000000000000000000"));
      const fixtureOk = Object.entries(EXPECTED_COUNTS).every(([key, value]) => counts[key] === value);
      push("Synthetic CSV (in memory)", fixtureOk ? S.PASS : S.FAIL, `${counts.dataRecords} data rows, ${counts.blankRecords} blank, ${counts.duplicateRecords} exact duplicates, ${counts.counted} counted`);
      const orgs = await get(pathOf.orgs());
      if (!orgs.ok) {
        const failure = apiFailure("Organization list", orgs);
        push("Signed-in session", failure.status, failure.observed, failure.next);
      } else {
        const orgIds = (orgs.data?.items || []).map((item) => item.organization_id).filter(isUuid);
        push("Signed-in session", S.PASS, `KAI API answered; ${orgIds.length} authorized organization(s): ${orgIds.join(", ") || "none"}`);
        if (!resolvedOrg && orgIds.length === 1) resolvedOrg = orgIds[0];
        const engagementId = options.engagementId || existing?.engagementId || selectedProjectFromPage();
        const workspace = await evaluateWorkspace(resolvedOrg, engagementId);
        push("Customer workspace & capabilities", workspace.status, workspace.observed, workspace.next);
        if (workspace.status === S.PASS) {
          const drafts = await listDrafts({ organizationId: resolvedOrg, engagementId });
          if (drafts.failure) {
            push("Internal drafts read", S.BLOCKED, drafts.failure.label);
          } else {
            push("Existing internal drafts (Project)", S.PASS, `${drafts.items.length} draft(s) visible; ${drafts.items.filter((item) => item.internalReportAvailable === true).length} ready for internal use`);
          }
        }
      }
      if (existing?.runId) push("Saved run", S.PASS, `Run ${existing.runId} (tag ${existing.tag}) - ${verdict(existing)}`, "KAI_CANARY.resume() to reconnect; nothing is repeated.");
      else push("Saved run", S.NOT_CONFIRMED, "No run in this browser", `KAI_CANARY.start({ organizationId: "${resolvedOrg || "<org uuid>"}", engagementId: "${options.engagementId || selectedProjectFromPage() || "<project uuid>"}", confirm: "${CONFIRM_PHRASE}" })`);
      console.log(`%c[KAI canary] Read-only preflight (${VERSION}) - no write was made`, "font-weight:bold");
      console.table(checks);
      return { readOnly: true, organizationId: resolvedOrg, checks };
    });
  }

  function makeFixture(options = {}) {
    let state = loadState();
    let tag = state?.tag;
    if (!tag) {
      const pending = (() => { try { return W.localStorage?.getItem(`${STORE_KEY}.pendingTag`); } catch { return null; } })();
      tag = pending || makeTag();
      try { W.localStorage?.setItem(`${STORE_KEY}.pendingTag`, tag); } catch { /* reload loses the tag */ }
    }
    const text = fixtureText(tag);
    const counts = countFixture(text);
    const ok = Object.entries(EXPECTED_COUNTS).every(([key, value]) => counts[key] === value);
    if (!ok) throw new Error(`fixture_self_check_failed ${JSON.stringify(counts)}`);
    const file = new File([text], fixtureFilename(tag), { type: "text/csv" });
    if (options.download !== false && W.document?.createElement) {
      const url = URL.createObjectURL(file);
      const anchor = W.document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      W.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    if (state?.runId) {
      state.fixture = { generatedAt: state.fixture?.generatedAt || nowIso(), bytes: file.size };
      saveState(state);
    }
    console.log(`[KAI canary] Synthetic CSV ${file.name}: ${counts.dataRecords} data rows, ${counts.blankRecords} blank, ${counts.duplicateRecords} exact duplicates, ${counts.counted} counted; ${file.size} bytes${options.download !== false ? " - downloaded" : ""}.`);
    console.log(text);
    return { file, name: file.name, bytes: file.size, counts, tag };
  }

  // Puts the generated File into the Files tab's file input, exactly as the
  // operator choosing it would. Nothing is uploaded until the operator clicks
  // "Upload the selected file".
  function attachFixture() {
    requireRun();
    const inputs = [...(W.document?.querySelectorAll?.('input[type="file"]') || [])];
    const input = inputs.find((el) => [...(el.parentElement?.querySelectorAll("button") || [])].some((b) => b.textContent.trim() === "Upload the selected file"));
    if (!input) throw new Error('Open Knowledge Studio > Files tab for the run Project (the "Upload the selected file" control must be on screen).');
    if (input.disabled) throw new Error("The file input is disabled (an upload is in progress or no batch is selected).");
    // makeFixture records the generated fixture on the saved run.
    const { file } = makeFixture({ download: false });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    console.log(`[KAI canary] ${file.name} attached to the Files input. Now click "Upload the selected file" ONCE, wait for "File reserved, uploaded, and confirmed.", then KAI_CANARY.next().`);
    return { attached: file.name };
  }

  async function start(options = {}) {
    return exclusive(async () => {
      if (options.confirm !== CONFIRM_PHRASE) {
        throw new Error(`start() needs the owner's explicit authorization: KAI_CANARY.start({ organizationId, engagementId, confirm: "${CONFIRM_PHRASE}" })`);
      }
      const existing = loadState();
      if (existing?.runId && options.newRun !== true) {
        throw new Error(`Run ${existing.runId} already exists (${verdict(existing)}). Use KAI_CANARY.resume(), or start({ ..., newRun: true }) to abandon it locally (nothing on the server is deleted).`);
      }
      const organizationId = options.organizationId;
      const engagementId = options.engagementId || selectedProjectFromPage();
      if (!isUuid(organizationId) || !isUuid(engagementId)) throw new Error("organizationId and engagementId must be the application's lowercase UUIDs.");
      const workspace = await evaluateWorkspace(organizationId, engagementId);
      if (workspace.status !== S.PASS) {
        console.table([{ Stage: STAGES[0].name, Status: workspace.status, Observed: workspace.observed, Expected: STAGES[0].expected, "Next action": workspace.next }]);
        throw new Error(`Workspace not confirmed: ${workspace.status}. No run was started.`);
      }
      const drafts = await listDrafts({ organizationId, engagementId });
      if (drafts.failure) throw new Error(`Cannot read existing internal drafts (${drafts.failure.label}); no run was started.`);
      let pendingTag = null;
      try { pendingTag = W.localStorage?.getItem(`${STORE_KEY}.pendingTag`); W.localStorage?.removeItem(`${STORE_KEY}.pendingTag`); } catch { /* none */ }
      const tag = pendingTag && !(existing?.tag === pendingTag) ? pendingTag : makeTag();
      const state = {
        version: VERSION,
        runId: (W.crypto?.randomUUID ? W.crypto.randomUUID() : `${Date.now()}-${tag}`),
        tag,
        origin: W.location?.origin,
        organizationId,
        engagementId,
        engagementCode: workspace.engagementCode,
        startedAt: nowIso(),
        authorizedPhrase: true,
        baselineDraftIds: drafts.items.map((item) => item.generatedContentDraftId),
        fixture: pendingTag ? { generatedAt: nowIso() } : null,
        ids: {},
        stages: { workspace: { status: S.PASS, observed: workspace.observed, next: "", at: nowIso() } },
      };
      saveState(state);
      return advance(state, "Run started (no write made)");
    });
  }

  async function advance(state, title) {
    const session = await get(pathOf.orgs());
    if (!session.ok) {
      const failure = apiFailure("Session check", session);
      console.table([{ Check: "Signed-in session", Status: failure.status, Observed: failure.observed, "Next action": failure.next }]);
      print(state, `${title} - stopped: session unavailable`);
      return summary(state);
    }
    for (const stage of STAGES) {
      if (state.stages?.[stage.key]?.status === S.PASS) continue;
      let outcome;
      try {
        outcome = await EVALUATORS[stage.key](state);
      } catch (error) {
        outcome = result(S.FAIL, `Canary error: ${short(String(error?.message || error), 200)}`, "Report this canary error with the stage name.");
      }
      state.stages[stage.key] = { status: outcome.status, observed: outcome.observed, next: outcome.next, at: nowIso() };
      saveState(state);
      if (outcome.status !== S.PASS) break;
    }
    saveState(state);
    print(state, title);
    return summary(state);
  }

  async function next() {
    return exclusive(async () => advance(requireRun(), "Advanced"));
  }

  async function resume() {
    return exclusive(async () => {
      const state = requireRun();
      // Re-verify the workspace each resume; completed workflow stages are
      // re-read only if they are not PASS, and nothing is ever re-submitted.
      delete state.stages.workspace;
      return advance(state, "Resumed");
    });
  }

  function status() {
    const state = loadState();
    if (!state?.runId) {
      console.log("[KAI canary] No run in this browser. KAI_CANARY.preflight() then KAI_CANARY.start({...}).");
      return null;
    }
    print(state, "Saved status (no network)");
    return summary(state);
  }

  function report() {
    const state = loadState();
    if (!state?.runId) return status();
    print(state, "Stage report");
    console.log("Run correlation ids:", { ...state.ids });
    if (state.period) console.log("Attested period:", state.period, "unit:", state.unit);
    if (state.ordinary !== undefined) console.log(`Source ordinary (all 7.2 categories absent): ${state.ordinary}; sensitivity decided by ${state.decidedByRole}`);
    if (state.generation) {
      console.log("Generated draft checks:");
      console.table(state.generation.checks);
      if (state.generation.negatedMentions?.length) console.log("Negated mentions (not failures):", state.generation.negatedMentions);
    }
    if (state.validation) {
      console.log("Markdown report checks:");
      console.table(state.validation.checks);
      console.log("Coverage limitation codes in report:", state.validation.coverageCodes);
      if (state.validation.violations?.length) console.log("Unsupported findings:", state.validation.violations);
    }
    return { ...summary(state), ids: { ...state.ids }, period: state.period || null, validation: state.validation || null, generation: state.generation || null };
  }

  // Read-only helper for the Get Kinder reviewer's own session: what the
  // claim still needs before it is eligible for internal use.
  async function gk(options = {}) {
    return exclusive(async () => {
      const { organizationId, claimId } = options;
      if (!isUuid(organizationId) || !isUuid(claimId)) throw new Error('KAI_CANARY.gk({ organizationId: "<uuid>", claimId: "<uuid>" })');
      const trace = await get(pathOf.traceability(organizationId, claimId));
      if (!trace.ok) {
        const failure = apiFailure("Claim traceability (GK only)", trace);
        console.table([{ Check: "Traceability", Status: failure.status, Observed: failure.observed, "Next action": failure.next }]);
        return { status: failure.status };
      }
      // An organization administrator receives only the client-safe internal
      // diagnostic, never the GK traceability view this helper reports.
      if (trace.data?.view === "organization_internal_traceability_diagnostic") {
        console.table([{ Check: "Traceability", Status: S.BLOCKED, Observed: "client-safe diagnostic only", "Next action": "Run this helper in the Get Kinder reviewer's own session." }]);
        return { status: S.BLOCKED };
      }
      const t = trace.data || {};
      const outstanding = Object.entries(t.dimensions || {})
        .filter(([, value]) => value?.assessment_status === "unresolved" && value?.internal_limitation_accepted !== true)
        .map(([key]) => key);
      const table = [
        { Item: "Eligible for internal use", Value: String(t.eligible === true) },
        { Item: "Blocker codes", Value: (t.blockerCodes || []).join(", ") || "none" },
        { Item: "Evidence review decision", Value: t.evidence_review_decision?.decision_outcome || "NOT RECORDED" },
        { Item: "Claim review decision", Value: t.claim_review_decision ? `${t.claim_review_decision.decision_outcome} (${(t.claim_review_decision.approved_audiences || []).join(", ")})` : "NOT RECORDED" },
        { Item: "Unresolved dimensions blocking internal use", Value: outstanding.filter((key) => t.dimensions[key]?.blocks_requested_audience === true).join(", ") || "none" },
      ];
      console.log(`%c[KAI canary] GK read-only check for claim ${claimId} - no write was made`, "font-weight:bold");
      console.table(table);
      return { eligible: t.eligible === true, blockerCodes: t.blockerCodes || [], outstandingDimensions: outstanding };
    });
  }

  W.KAI_CANARY = Object.freeze({
    version: VERSION,
    preflight,
    makeFixture,
    attachFixture,
    start,
    next,
    status,
    report,
    resume,
    gk,
    confirmPhrase: CONFIRM_PHRASE,
    // Pure helpers, exposed for local verification only.
    _test: Object.freeze({ fixtureText, countFixture, fixtureFilename, validateMarkdown, scanFindings, STAGES }),
  });

  console.log(`[KAI canary] ${VERSION} loaded. Running read-only preflight...`);
  W.KAI_CANARY.preflight().catch((error) => console.error("[KAI canary] Preflight error:", error?.message || error));
})();
