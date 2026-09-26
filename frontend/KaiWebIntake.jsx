import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  batchesPath,
  confirmUploadPath,
  createBatchPath,
  engagementsPath,
  errorText,
  fileDetailPath,
  fileExtensionOf,
  fileReservationsPath,
  generateIdempotencyKey,
  getJson,
  INTAKE_READ_STATUS,
  organizationsPath,
  postJson,
  putToSignedUrl,
  readEngagementIntakeBatches,
  readIntakeBatchFiles,
  requestUploadUrlPath,
  resolveFileReservationIdempotencyKey,
  sha256HexOfFile,
} from "./kaiWebIntakeLogic.js";

function ValueRow({ label, value }) {
  return (
    <div className="d-flex justify-content-between gap-3 border-bottom py-2">
      <span className="text-muted small">{label}</span>
      <span className="small text-break text-end">{value ?? "none"}</span>
    </div>
  );
}

export default function KaiWebIntake({
  organizationId: parentOrganizationId = "",
  // KAI Impact Library redesign, Package C0 (shared Project/Engagement
  // context): when a parent supplies this, it is the one authoritative
  // active Project/Engagement for the whole /impact-library application -
  // this component's own engagement picker is hidden and its own
  // engagements list is never fetched, exactly mirroring how
  // parentOrganizationId already suppresses this component's organization
  // picker/fetch. A caller that does not pass it (e.g. the standalone
  // adminDashboard KAI Web Intake panel) is completely unaffected.
  engagementId: parentEngagementId = "",
  onEngagementIdChange,
  embedded = false,
  // Server-derived intake contribution capability (the P0
  // create_intake_batch/create_intake_file policies, reported by the
  // organization access-capabilities read). When false, the batch-create and
  // upload controls are not offered, so an actor those policies deny is never
  // shown a write that can only fail; the read-only batch/file views remain.
  // Defaults to true, so every mount that does not pass it is unaffected.
  canContribute = true,
  // Files persistence/rehydration: when a parent supplies the active
  // engagement, this component reconstructs its batch/file state from the
  // server on every mount - it reads the organization's batches, keeps only
  // those whose persisted engagement_id is the active engagement, and loads
  // the selected batch's files. A parent may also retain the selected batch
  // across this component's unmount (e.g. leaving the Files tab): it passes
  // the retained id here and receives every validated selection through
  // onIntakeBatchIdChange. The retained id is only a hint - it is used only
  // after the fresh server read confirms it belongs to this organization and
  // engagement, and is replaced otherwise. Standalone callers pass neither.
  intakeBatchId: retainedIntakeBatchId = "",
  onIntakeBatchIdChange,
  // KAI B1A-3B-R2: explicit opt-in seam only. When a parent passes this
  // callback, KaiWebIntake reports the ONE server-grounded fact a Phase-5
  // caller needs - the current selected file's P1-05
  // intake_sensitivity_profile_id (or null once no authoritative profile is
  // selected/known) - straight from the existing file-detail GET response,
  // never derived or fabricated client-side. Every existing mount that does
  // not pass this prop (e.g. the standalone adminDashboard KAI Web Intake
  // panel) is completely unaffected: the callback is simply never invoked.
  onSensitivityProfileDiscovered,
}) {
  const reportSensitivityProfileDiscovered = useCallback((intakeSensitivityProfileId) => {
    if (typeof onSensitivityProfileDiscovered === "function") {
      onSensitivityProfileDiscovered(intakeSensitivityProfileId || null);
    }
  }, [onSensitivityProfileDiscovered]);

  const [organizations, setOrganizations] = useState([]);
  const [localOrganizationId, setLocalOrganizationId] = useState("");
  const organizationId = parentOrganizationId || localOrganizationId;
  const [loadingOrganizations, setLoadingOrganizations] = useState(true);
  const [organizationsLoaded, setOrganizationsLoaded] = useState(false);
  const [engagements, setEngagements] = useState([]);
  const [localEngagementId, setLocalEngagementId] = useState("");
  const engagementId = parentEngagementId || localEngagementId;
  // Routes a user-driven engagement change to the shared Project context
  // when a parent owns it, otherwise to this component's own local state -
  // never both, so there is exactly one authoritative value.
  const updateEngagementId = useCallback((value) => {
    if (parentEngagementId) {
      if (typeof onEngagementIdChange === "function") onEngagementIdChange(value);
      return;
    }
    setLocalEngagementId(value);
  }, [parentEngagementId, onEngagementIdChange]);
  const [loadingEngagements, setLoadingEngagements] = useState(false);
  const [engagementsLoaded, setEngagementsLoaded] = useState(false);
  const [batchCode, setBatchCode] = useState("");
  const [batches, setBatches] = useState([]);
  const [intakeBatchId, setIntakeBatchId] = useState("");
  const [file, setFile] = useState(null);
  const [intakeFileId, setIntakeFileId] = useState("");
  const [fileStatus, setFileStatus] = useState(null);
  const [batchFiles, setBatchFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const createBatchIdempotencyKeyRef = useRef(null);
  const fileReservationIdempotencyKeyRef = useRef(null);
  const fileReservationIdentityRef = useRef(null);
  // Server-backed batch/file reconstruction runs only when a parent owns the
  // active engagement; standalone mounts keep their manual-load contract.
  const engagementScoped = Boolean(parentEngagementId);
  const [batchesRequest, setBatchesRequest] = useState({ status: INTAKE_READ_STATUS.NOT_STARTED, error: "" });
  const [batchFilesRequest, setBatchFilesRequest] = useState({ status: INTAKE_READ_STATUS.NOT_STARTED, error: "" });
  // Read through refs so a parent re-render (a new retained id or callback
  // identity) never re-triggers the bootstrap read.
  const retainedIntakeBatchIdRef = useRef(retainedIntakeBatchId);
  retainedIntakeBatchIdRef.current = retainedIntakeBatchId;
  const onIntakeBatchIdChangeRef = useRef(onIntakeBatchIdChange);
  onIntakeBatchIdChangeRef.current = onIntakeBatchIdChange;
  const intakeBatchIdRef = useRef(intakeBatchId);
  intakeBatchIdRef.current = intakeBatchId;
  // Incremented on every bootstrap start, context change, and unmount, so a
  // late batch-list response for a prior context is discarded instead of
  // selecting (or reporting to the parent) a batch from that context.
  const batchBootstrapTokenRef = useRef(0);
  const reportIntakeBatchSelection = useCallback((value) => {
    if (!engagementScoped) return;
    if (typeof onIntakeBatchIdChangeRef.current === "function") onIntakeBatchIdChangeRef.current(value || "");
  }, [engagementScoped]);

  // The browser never types or fabricates an organization id: it always
  // bootstraps from the server-authoritative list of organizations the
  // already-resolved actor is authorized to use for ordinary intake.
  useEffect(() => {
    if (parentOrganizationId) {
      setOrganizations([]);
      setLoadingOrganizations(false);
      setOrganizationsLoaded(true);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setLoadingOrganizations(true);
      const result = await getJson(organizationsPath());
      if (cancelled) return;
      setLoadingOrganizations(false);
      setOrganizationsLoaded(true);
      if (result.statusCode !== 200 || !result.body?.ok) {
        setOrganizations([]);
        setMessage(errorText(result));
        return;
      }
      const items = result.body.data?.items || [];
      setOrganizations(items);
      if (items.length === 1) {
        setLocalOrganizationId(items[0].organization_id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parentOrganizationId]);

  useEffect(() => {
    setEngagements([]);
    setLocalEngagementId("");
    setEngagementsLoaded(false);
    setBatchCode("");
    setBatches([]);
    setIntakeBatchId("");
    setFile(null);
    setIntakeFileId("");
    setFileStatus(null);
    setBatchFiles([]);
    setBatchesRequest({ status: INTAKE_READ_STATUS.NOT_STARTED, error: "" });
    setBatchFilesRequest({ status: INTAKE_READ_STATUS.NOT_STARTED, error: "" });
    setBusy(false);
    setMessage("");

    createBatchIdempotencyKeyRef.current = null;
    fileReservationIdempotencyKeyRef.current = null;
    fileReservationIdentityRef.current = null;
    // Organization change invalidates any previously reported profile
    // identity: it belonged to the prior organization's file selection.
    reportSensitivityProfileDiscovered(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const loadEngagements = useCallback(async (orgId) => {
    // A parent-supplied engagementId means the shared Project/Engagement
    // context (Package C0) already owns engagement selection for this
    // organization - this component must not run a second, independent
    // engagement fetch/selection that could disagree with it.
    if (parentEngagementId) {
      setEngagements([]);
      setEngagementsLoaded(true);
      return;
    }
    if (!orgId) {
      setEngagements([]);
      setLocalEngagementId("");
      setEngagementsLoaded(false);
      return;
    }
    setLoadingEngagements(true);
    const result = await getJson(engagementsPath(orgId));
    setLoadingEngagements(false);
    setEngagementsLoaded(true);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setEngagements([]);
      setLocalEngagementId("");
      setMessage(errorText(result));
      return;
    }
    const items = result.body.data?.items || [];
    setEngagements(items);
    setLocalEngagementId(items.length === 1 ? items[0].engagement_id : "");
  }, [parentEngagementId]);

  // Once an organization is selected (auto- or user-picked), the engagement
  // list for that organization is fetched automatically - the user never
  // types or fabricates an engagement id either. Skipped entirely when a
  // parent already supplies the active engagement (see loadEngagements).
  useEffect(() => {
    loadEngagements(organizationId);
  }, [organizationId, loadEngagements]);

  // A parent-owned engagement change invalidates every batch/file fact that
  // belonged to the previous Project before the new Project is bootstrapped
  // (declared ahead of the bootstrap effect so it always runs first).
  // Standalone mounts never change parentEngagementId, so they are unaffected.
  useEffect(() => {
    batchBootstrapTokenRef.current += 1;
    setBatches([]);
    setIntakeBatchId("");
    setBatchFiles([]);
    setIntakeFileId("");
    setFileStatus(null);
    setBatchesRequest({ status: INTAKE_READ_STATUS.NOT_STARTED, error: "" });
    setBatchFilesRequest({ status: INTAKE_READ_STATUS.NOT_STARTED, error: "" });
    setMessage("");
    createBatchIdempotencyKeyRef.current = null;
    fileReservationIdempotencyKeyRef.current = null;
    fileReservationIdentityRef.current = null;
    reportSensitivityProfileDiscovered(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentEngagementId]);

  // Reads the persisted batches for the active organization + engagement and
  // establishes the selection from that read alone (see
  // readEngagementIntakeBatches): a retained id only if it is in the scoped
  // list, else the sole scoped batch, else no selection and the chooser.
  const bootstrapEngagementBatches = useCallback(async (preferredIntakeBatchId) => {
    if (!organizationId || !parentEngagementId) return;
    batchBootstrapTokenRef.current += 1;
    const token = batchBootstrapTokenRef.current;
    setBatchesRequest({ status: INTAKE_READ_STATUS.LOADING, error: "" });
    const outcome = await readEngagementIntakeBatches({
      organizationId,
      engagementId: parentEngagementId,
      retainedIntakeBatchId: preferredIntakeBatchId || "",
    });
    if (token !== batchBootstrapTokenRef.current) return;
    setBatches(outcome.batches);
    setBatchesRequest({ status: outcome.status, error: outcome.error });
    if (outcome.status === INTAKE_READ_STATUS.ERROR) {
      // Nothing is validated, so nothing is selected: a batch already
      // validated by an earlier read in this mount stays; otherwise the file
      // route is never called for an unvalidated id.
      return;
    }
    if (outcome.intakeBatchId !== intakeBatchIdRef.current) {
      setIntakeBatchId(outcome.intakeBatchId);
      setBatchFiles([]);
      setBatchFilesRequest({ status: INTAKE_READ_STATUS.NOT_STARTED, error: "" });
      setIntakeFileId("");
      setFileStatus(null);
      reportSensitivityProfileDiscovered(null);
    }
    reportIntakeBatchSelection(outcome.intakeBatchId);
  }, [organizationId, parentEngagementId, reportIntakeBatchSelection, reportSensitivityProfileDiscovered]);

  // Files entry/remount: reconstruct from the server, never from the
  // "Load existing batches" button or any browser-only cache.
  useEffect(() => {
    if (!engagementScoped || !organizationId) return undefined;
    bootstrapEngagementBatches(retainedIntakeBatchIdRef.current);
    return () => {
      batchBootstrapTokenRef.current += 1;
    };
  }, [engagementScoped, organizationId, bootstrapEngagementBatches]);

  // Once a validated batch is selected, its persisted files are read
  // automatically - no second manual "Load".
  useEffect(() => {
    if (!engagementScoped || !organizationId || !intakeBatchId) return undefined;
    let cancelled = false;
    setBatchFilesRequest({ status: INTAKE_READ_STATUS.LOADING, error: "" });
    (async () => {
      const outcome = await readIntakeBatchFiles({ organizationId, intakeBatchId });
      if (cancelled) return;
      setBatchFiles(outcome.items);
      setBatchFilesRequest({ status: outcome.status, error: outcome.error });
    })();
    return () => {
      cancelled = true;
    };
  }, [engagementScoped, organizationId, intakeBatchId]);

  const loadBatches = useCallback(async () => {
    if (!organizationId) return;

    setBusy(true);
    setMessage("");
    const result = await getJson(batchesPath(organizationId));
    setBusy(false);

    if (result.statusCode !== 200 || !result.body?.ok) {
      setBatches([]);
      setMessage(errorText(result));
      return;
    }

    setBatches(result.body.data?.batches || []);
  }, [organizationId]);

  const createBatch = useCallback(async () => {
    if (!organizationId || !engagementId || !batchCode) {
      setMessage("Organization id, an existing engagement, and batch code are required.");
      return;
    }
    if (!createBatchIdempotencyKeyRef.current) {
      createBatchIdempotencyKeyRef.current = generateIdempotencyKey();
    }
    setBusy(true);
    setMessage("");
    const result = await postJson(createBatchPath(), {
      organization_id: organizationId,
      engagement_id: engagementId,
      batch_code: batchCode,
      idempotency_key: createBatchIdempotencyKeyRef.current,
    });
    setBusy(false);
    if (result.statusCode !== 201 && result.statusCode !== 200) {
      setMessage(errorText(result));
      return;
    }
    createBatchIdempotencyKeyRef.current = null;
    setIntakeBatchId(result.body?.data?.intake_batch_id || "");
    setMessage(`Batch created: ${result.body?.data?.intake_batch_id}`);
    // Engagement-scoped: re-read the batch list so the new batch is selected
    // (and retained by the parent) only once the server lists it for this
    // engagement.
    if (engagementScoped) bootstrapEngagementBatches(result.body?.data?.intake_batch_id || "");
  }, [organizationId, engagementId, batchCode, engagementScoped, bootstrapEngagementBatches]);

  const reserveAndUpload = useCallback(async () => {
    if (!organizationId || !engagementId || !intakeBatchId || !file) {
      setMessage("A batch and a chosen file are required.");
      return;
    }
    setBusy(true);
    setMessage("");

    const checksum = await sha256HexOfFile(file);

    // The server's preliminary duplicate protection is checksum-based, so
    // retrying the same file content in the same batch must replay the same
    // reservation key instead of minting a fresh key that trips VAL-IDEMP-006.
    fileReservationIdentityRef.current = resolveFileReservationIdempotencyKey(
      fileReservationIdentityRef.current,
      intakeBatchId,
      checksum,
    );
    fileReservationIdempotencyKeyRef.current = fileReservationIdentityRef.current.key;

    const reserveResult = await postJson(fileReservationsPath(intakeBatchId), {
      organization_id: organizationId,
      engagement_id: engagementId,
      original_filename: file.name,
      file_extension: fileExtensionOf(file.name),
      mime_type: file.type || "text/csv",
      file_size_bytes: file.size,
      checksum,
      hash_algorithm: "sha256",
      idempotency_key: fileReservationIdempotencyKeyRef.current,
    });
    if (reserveResult.statusCode !== 201 && reserveResult.statusCode !== 200) {
      setBusy(false);
      setMessage(errorText(reserveResult));
      return;
    }
    const reservedFileId = reserveResult.body?.data?.intake_file_id;
    setIntakeFileId(reservedFileId || "");

    // Gate C-2A: reserve -> requestUploadUrl -> signed browser PUT to GCS ->
    // confirmUpload. The signed URL/headers live only in this local scope for
    // the duration of the PUT; they are never stored in component state,
    // rendered, or logged.
    const uploadUrlResult = await postJson(requestUploadUrlPath(intakeBatchId), {
      organization_id: organizationId,
      engagement_id: engagementId,
      intake_file_id: reservedFileId,
    });
    if (uploadUrlResult.statusCode !== 200 || !uploadUrlResult.body?.ok) {
      setBusy(false);
      setMessage(errorText(uploadUrlResult));
      return;
    }
    const { upload_url: uploadUrl, upload_method: uploadMethod, upload_headers: uploadHeaders } = uploadUrlResult.body.data;

    const putResult = await putToSignedUrl(uploadUrl, uploadMethod, uploadHeaders, file);
    if (!putResult.ok) {
      setBusy(false);
      setMessage(`Upload failed (${putResult.statusCode}).`);
      return;
    }

    const confirmResult = await postJson(confirmUploadPath(organizationId, reservedFileId), {
      organization_id: organizationId,
    });
    setBusy(false);
    if (confirmResult.statusCode !== 200) {
      setMessage(errorText(confirmResult));
      return;
    }
    fileReservationIdentityRef.current = null;
    fileReservationIdempotencyKeyRef.current = null;
    setMessage("File reserved, uploaded, and confirmed.");
  }, [organizationId, engagementId, intakeBatchId, file]);

  const refreshFileStatus = useCallback(async () => {
    if (!organizationId || !intakeFileId) return;
    setBusy(true);
    const result = await getJson(fileDetailPath(organizationId, intakeFileId));
    setBusy(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setFileStatus(null);
      setMessage(errorText(result));
      reportSensitivityProfileDiscovered(null);
      return;
    }
    setFileStatus(result.body.data);
    // KAI B1A-3B-R2: report the server-grounded P1-05 profile id from this
    // same authoritative file-detail response - the ONLY thing forwarded
    // through the opt-in seam, never the raw fileStatus payload.
    reportSensitivityProfileDiscovered(result.body.data?.p1_lifecycle?.intake_sensitivity_profile_id || null);
  }, [organizationId, intakeFileId, reportSensitivityProfileDiscovered]);

  const loadBatchFiles = useCallback(async () => {
    if (!organizationId || !intakeBatchId) return;
    setBusy(true);
    setBatchFilesRequest({ status: INTAKE_READ_STATUS.LOADING, error: "" });
    const outcome = await readIntakeBatchFiles({ organizationId, intakeBatchId });
    setBusy(false);
    setBatchFiles(outcome.items);
    setBatchFilesRequest({ status: outcome.status, error: outcome.error });
    if (outcome.status === INTAKE_READ_STATUS.ERROR) setMessage(outcome.error);
  }, [organizationId, intakeBatchId]);

  return (
    <section>
      {embedded ? (
        <h2 className="h4 mb-3">KAI Web Intake</h2>
      ) : (
        <h1 className="admin-title mb-3">KAI Web Intake</h1>
      )}
      {message ? <div className="alert alert-warning py-2">{message}</div> : null}

      <div className="admin-card mb-3">
        <h5 className="mb-2">1. Batch</h5>
        <div className="row g-2 align-items-end mb-2">
          {parentOrganizationId ? null : (
            <div className="col-12 col-lg-4">
              <label className="form-label small fw-semibold">Organization</label>
            {loadingOrganizations ? (
              <div className="small text-muted">Loading your organizations...</div>
            ) : organizationsLoaded && organizations.length === 0 ? (
              <div className="small text-muted">No KAI organization is available for this account.</div>
            ) : (
              <select
                className="form-select form-select-sm"
                value={organizationId}
                onChange={(event) => setLocalOrganizationId(event.target.value)}
                disabled={organizations.length <= 1}
              >
                {organizations.map((item) => (
                  <option key={item.organization_id} value={item.organization_id}>{item.organization_id}</option>
                ))}
              </select>
            )}
          </div>
          )}
          {parentEngagementId ? null : (
          <div className="col-12 col-lg-5">
            <label className="form-label small fw-semibold">Engagement</label>
            {loadingEngagements ? (
              <div className="small text-muted">Loading engagements...</div>
            ) : !organizationId ? (
              <div className="small text-muted">Select an organization first.</div>
            ) : engagementsLoaded && engagements.length === 0 ? (
              <div className="small text-muted">No existing engagement is available for this organization.</div>
            ) : (
              <select
                className="form-select form-select-sm"
                value={engagementId}
                onChange={(event) => updateEngagementId(event.target.value)}
                disabled={engagements.length <= 1}
              >
                {engagements.map((item) => (
                  <option key={item.engagement_id} value={item.engagement_id}>{item.engagement_id}</option>
                ))}
              </select>
            )}
            <div className="form-text">Only existing, tenant-authoritative organizations and engagements are selectable.</div>
          </div>
          )}
          {canContribute ? (
          <div className="col-12 col-lg-3">
            <label className="form-label small fw-semibold">Batch code</label>
            <input className="form-control form-control-sm" value={batchCode} onChange={(event) => setBatchCode(event.target.value.trim())} />
          </div>
          ) : null}
        </div>
        <div className="d-flex gap-2">
          {canContribute ? (
          <button type="button" className="btn btn-sm btn-primary" onClick={createBatch} disabled={busy || !organizationId || !engagementId}>
            Create batch
          </button>
          ) : null}
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            onClick={engagementScoped ? () => bootstrapEngagementBatches(intakeBatchId) : loadBatches}
            disabled={busy || !organizationId || batchesRequest.status === INTAKE_READ_STATUS.LOADING}
          >
            Load existing batches
          </button>
        </div>
        {intakeBatchId ? <div className="small mt-2">Batch id: {intakeBatchId}</div> : null}
        {engagementScoped && batchesRequest.status === INTAKE_READ_STATUS.LOADING ? (
          <div className="small text-muted mt-2">Loading this project&rsquo;s batches...</div>
        ) : null}
        {engagementScoped && batchesRequest.status === INTAKE_READ_STATUS.ERROR ? (
          <div className="alert alert-danger py-2 small mt-2 mb-0">
            This project&rsquo;s batches could not be loaded: {batchesRequest.error}
          </div>
        ) : null}
        {engagementScoped && batchesRequest.status === INTAKE_READ_STATUS.SUCCESS_EMPTY ? (
          <div className="small text-muted mt-2">No intake batches exist for this project yet.</div>
        ) : null}
        {engagementScoped && batchesRequest.status === INTAKE_READ_STATUS.SUCCESS_WITH_DATA && !intakeBatchId ? (
          <div className="small text-muted mt-2">This project has more than one batch. Select a batch to view its files.</div>
        ) : null}
        {batches.length > 0 ? (
          <ul className="small mt-3 mb-0">
            {batches.map((item) => (
              <li
                key={item.intake_batch_id}
                className="d-flex justify-content-between align-items-center gap-2"
              >
                <span>
                  {item.batch_code || item.intake_batch_id}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  onClick={() => {
                    // Package C0 repair: resuming an existing batch is an
                    // internal intake action, never an explicit Project
                    // selection - when a parent owns the shared Project/
                    // Engagement context, that context stays authoritative
                    // even if this org-wide batch list happens to include a
                    // batch from a different engagement. Only in standalone
                    // (no parent) mode does this remain how the component's
                    // own local engagement id gets set, exactly as before.
                    if (!parentEngagementId) {
                      updateEngagementId(item.engagement_id || "");
                    }
                    setIntakeBatchId(item.intake_batch_id);
                    reportIntakeBatchSelection(item.intake_batch_id);
                    setBatchFiles([]);
                    setBatchFilesRequest({ status: INTAKE_READ_STATUS.NOT_STARTED, error: "" });
                    setIntakeFileId("");
                    setFileStatus(null);
                    setMessage("");
                    reportSensitivityProfileDiscovered(null);
                  }}
                  disabled={busy}
                >
                  Select
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {canContribute ? (
      <div className="admin-card mb-3">
        <h5 className="mb-2">2. Upload file</h5>
        <input
          type="file"
          className="form-control form-control-sm mb-2"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
        <button type="button" className="btn btn-sm btn-primary" onClick={reserveAndUpload} disabled={busy || !intakeBatchId || !file}>
          Upload the selected file
        </button>
        {intakeFileId ? <div className="small mt-2">Intake file id: {intakeFileId}</div> : null}
      </div>
      ) : (
      <div className="admin-card mb-3 small text-muted">
        Uploading files is not available for your role in this organization. You can still view existing batches and files.
      </div>
      )}

      <div className="row g-3">
        <div className="col-12 col-lg-6">
          <div className="admin-card">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">File status</h5>
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={refreshFileStatus} disabled={busy || !intakeFileId}>Refresh</button>
            </div>
            {!fileStatus ? <div className="text-muted small">No file status loaded yet.</div> : (
              <>
                <ValueRow
                  label="P1 processing"
                  value={fileStatus.p1_lifecycle?.automatic_stage ?? "not started"}
                />
                <ValueRow label="Malware scan" value={fileStatus.malware_scan_status} />
                <ValueRow label="File policy" value={fileStatus.file_policy_status} />
                <ValueRow label="Security assessment" value={fileStatus.security_assessment?.category ?? fileStatus.security_assessment?.policy_outcome} />
                <ValueRow
                  label="Parser/profile"
                  value={
                    fileStatus.p1_lifecycle?.file_profile_complete
                      ? "complete"
                      : (fileStatus.p1_lifecycle?.parser_status ?? "not started")
                  }
                />
                <ValueRow
                  label="Data dictionary"
                  value={fileStatus.p1_lifecycle?.data_dictionary_complete ? "complete" : "not complete"}
                />
                <ValueRow
                  label="Sensitivity profile"
                  value={fileStatus.p1_lifecycle?.sensitivity_profile_complete ? "complete" : "not complete"}
                />
                <ValueRow label="Review status" value={fileStatus.review_status} />
              </>
            )}
          </div>
        </div>
        <div className="col-12 col-lg-6">
          <div className="admin-card">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Batch files</h5>
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={loadBatchFiles} disabled={busy || !intakeBatchId}>Load</button>
            </div>
            {batchFilesRequest.status === INTAKE_READ_STATUS.LOADING ? (
              <div className="text-muted small">Loading this batch&rsquo;s files...</div>
            ) : batchFilesRequest.status === INTAKE_READ_STATUS.ERROR ? (
              <div className="alert alert-danger py-2 small mb-0">This batch&rsquo;s files could not be loaded: {batchFilesRequest.error}</div>
            ) : batchFilesRequest.status === INTAKE_READ_STATUS.SUCCESS_EMPTY ? (
              <div className="text-muted small">This batch has no files yet.</div>
            ) : batchFiles.length === 0 ? <div className="text-muted small">No files listed yet.</div> : (
              <ul className="small mb-0">
                {batchFiles.map((item) => (
                  <li
                    key={item.intake_file_id}
                    className="d-flex justify-content-between align-items-center gap-2"
                  >
                    <span>
                      {item.safe_filename} &mdash; P1: {item.p1_lifecycle?.automatic_stage ?? "not started"}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => {
                        setIntakeFileId(item.intake_file_id);
                        setFileStatus(null);
                        setMessage("");
                        reportSensitivityProfileDiscovered(null);
                      }}
                      disabled={busy}
                    >
                      Select
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
