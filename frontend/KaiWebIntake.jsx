import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  batchesPath,
  confirmUploadPath,
  createBatchPath,
  declaredMimeTypeForFile,
  DUPLICATE_RESOLUTION_ACTION,
  duplicateResolutionFromResult,
  duplicateResolutionView,
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
  readIntakeFileSensitivityProfileId,
  requestUploadUrlPath,
  resolveFileReservationIdempotencyKey,
  sha256HexOfFile,
  uploadUrlResultRequiresConfirmOnly,
} from "./kaiWebIntakeLogic.js";
import { pipelineFileStatusText } from "./knowledgeStudio/clientEvidencePipelineLogic.js";
import useClientEvidencePipeline from "./knowledgeStudio/useClientEvidencePipeline.js";

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
  // selected/known) - from the GK-only review-cockpit file lookup, never
  // from the restricted file-detail DTO and never derived or fabricated
  // client-side. Only an opted-in mount ever issues that lookup; every mount
  // that does not pass this prop (e.g. the standalone adminDashboard KAI Web
  // Intake panel) is completely unaffected.
  onSensitivityProfileDiscovered,
  // Per-file processing status comes from the Project's client evidence
  // pipeline (useClientEvidencePipeline), never from the restricted intake
  // DTOs. A parent that already reads it passes its request (and refresh)
  // here; otherwise this component reads it for its own active Project.
  processingStatus,
  onProcessingStatusRefresh,
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
  // Each file-input change is a new selection, so a reservation intent (and
  // its idempotency key, checksum, and any duplicate resolution) never
  // carries over to a different choice of file.
  const [fileSelectionId, setFileSelectionId] = useState(0);
  // { resolution, selectedFile, selectionId, intakeBatchId } from the
  // server's duplicate-resolution response for the current selection.
  const [duplicateResolution, setDuplicateResolution] = useState(null);
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
  // The sensitivity-profile lookup reports only for the file and
  // organization it was issued for, and only if no later lookup started.
  const intakeFileIdRef = useRef(intakeFileId);
  intakeFileIdRef.current = intakeFileId;
  const organizationIdRef = useRef(organizationId);
  organizationIdRef.current = organizationId;
  const sensitivityLookupSeqRef = useRef(0);
  const [ownPipelineRefresh, setOwnPipelineRefresh] = useState(0);
  const ownPipeline = useClientEvidencePipeline(
    organizationId,
    processingStatus ? "" : engagementId,
    ownPipelineRefresh,
  );
  const pipeline = processingStatus || ownPipeline;
  const refreshPipeline = useCallback(() => {
    if (processingStatus) {
      if (typeof onProcessingStatusRefresh === "function") onProcessingStatusRefresh();
      return;
    }
    setOwnPipelineRefresh((value) => value + 1);
  }, [processingStatus, onProcessingStatusRefresh]);
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
    setDuplicateResolution(null);
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
    setDuplicateResolution(null);
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

  // Gate C-2A: reserve -> requestUploadUrl -> signed browser PUT to GCS ->
  // confirmUpload. The signed URL/headers live only in this local scope for
  // the duration of the PUT; they are never stored in component state,
  // rendered, or logged. A reservation already past "reserved" has its bytes
  // in storage, so only confirmation remains - including when the server
  // refuses to sign because the record moved on since this browser last saw
  // it (a replayed reservation whose earlier confirmation response was lost).
  // Confirmation always re-verifies the stored bytes against the
  // reservation's declared checksum and size.
  const transferAndConfirm = useCallback(async ({ reservedFileId, selectedFile, uploadState }) => {
    if (uploadState === "reserved") {
      const uploadUrlResult = await postJson(requestUploadUrlPath(intakeBatchId), {
        organization_id: organizationId,
        engagement_id: engagementId,
        intake_file_id: reservedFileId,
      });
      if (!uploadUrlResultRequiresConfirmOnly(uploadUrlResult)) {
        if (uploadUrlResult.statusCode !== 200 || !uploadUrlResult.body?.ok) {
          return { ok: false, message: errorText(uploadUrlResult) };
        }
        const { upload_url: uploadUrl, upload_method: uploadMethod, upload_headers: uploadHeaders } = uploadUrlResult.body.data;

        const putResult = await putToSignedUrl(uploadUrl, uploadMethod, uploadHeaders, selectedFile);
        if (!putResult.ok) {
          return { ok: false, message: `Upload failed (${putResult.statusCode}).` };
        }
      }
    }

    const confirmResult = await postJson(confirmUploadPath(organizationId, reservedFileId), {
      organization_id: organizationId,
    });
    if (confirmResult.statusCode !== 200) {
      return { ok: false, message: errorText(confirmResult) };
    }
    return { ok: true };
  }, [organizationId, engagementId, intakeBatchId]);

  const reserveAndUpload = useCallback(async ({ duplicateOfIntakeFileId = null } = {}) => {
    if (!organizationId || !engagementId || !intakeBatchId || !file) {
      setMessage("A batch and a chosen file are required.");
      return;
    }
    setBusy(true);
    setMessage("");
    setDuplicateResolution(null);

    const selectedFile = file;
    const selectionId = fileSelectionId;
    // Always the checksum of exactly the bytes selected now - never a value
    // carried over from an earlier selection.
    const checksum = await sha256HexOfFile(selectedFile);

    fileReservationIdentityRef.current = resolveFileReservationIdempotencyKey(
      fileReservationIdentityRef.current,
      { selectionId, intakeBatchId, checksum, duplicateOfIntakeFileId },
    );
    fileReservationIdempotencyKeyRef.current = fileReservationIdentityRef.current.key;

    const reserveResult = await postJson(fileReservationsPath(intakeBatchId), {
      organization_id: organizationId,
      engagement_id: engagementId,
      original_filename: selectedFile.name,
      file_extension: fileExtensionOf(selectedFile.name),
      mime_type: declaredMimeTypeForFile(selectedFile),
      file_size_bytes: selectedFile.size,
      checksum,
      hash_algorithm: "sha256",
      idempotency_key: fileReservationIdempotencyKeyRef.current,
      ...(duplicateOfIntakeFileId
        ? { force_new_version: true, duplicate_of_intake_file_id: duplicateOfIntakeFileId }
        : {}),
    });
    if (reserveResult.statusCode !== 201 && reserveResult.statusCode !== 200) {
      setBusy(false);
      const resolution = duplicateResolutionFromResult(reserveResult);
      if (resolution) {
        setDuplicateResolution({ resolution, selectedFile, selectionId, intakeBatchId });
        return;
      }
      setMessage(errorText(reserveResult));
      return;
    }
    const reservedFileId = reserveResult.body?.data?.intake_file_id;
    setIntakeFileId(reservedFileId || "");

    const transfer = await transferAndConfirm({ reservedFileId, selectedFile, uploadState: "reserved" });
    setBusy(false);
    if (!transfer.ok) {
      setMessage(transfer.message);
      return;
    }
    fileReservationIdentityRef.current = null;
    fileReservationIdempotencyKeyRef.current = null;
    setMessage(duplicateOfIntakeFileId
      ? "New intake version reserved, uploaded, and confirmed."
      : "File reserved, uploaded, and confirmed.");
  }, [organizationId, engagementId, intakeBatchId, file, fileSelectionId, transferAndConfirm]);

  const loadFileStatus = useCallback(async (targetIntakeFileId) => {
    if (!organizationId || !targetIntakeFileId) return;
    setBusy(true);
    const result = await getJson(fileDetailPath(organizationId, targetIntakeFileId));
    setBusy(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setFileStatus(null);
      setMessage(errorText(result));
      reportSensitivityProfileDiscovered(null);
      return;
    }
    setFileStatus(result.body.data);
    refreshPipeline();
    // KAI B1A-3B-R2: only an opted-in parent triggers the GK-only lookup, and
    // only its server-grounded profile id is forwarded through the seam.
    if (typeof onSensitivityProfileDiscovered !== "function") return;
    sensitivityLookupSeqRef.current += 1;
    const lookupSeq = sensitivityLookupSeqRef.current;
    const intakeSensitivityProfileId = await readIntakeFileSensitivityProfileId({
      organizationId,
      intakeFileId: targetIntakeFileId,
    });
    if (
      lookupSeq !== sensitivityLookupSeqRef.current
      || intakeFileIdRef.current !== targetIntakeFileId
      || organizationIdRef.current !== organizationId
    ) {
      return;
    }
    reportSensitivityProfileDiscovered(intakeSensitivityProfileId);
  }, [organizationId, onSensitivityProfileDiscovered, refreshPipeline, reportSensitivityProfileDiscovered]);

  const refreshFileStatus = useCallback(() => loadFileStatus(intakeFileId), [loadFileStatus, intakeFileId]);

  // Executes only an action the server listed for this selection's duplicate
  // resolution. Use existing file reads that file's detail; Continue upload
  // finishes the existing reservation with the selected bytes; a new intake
  // version is an explicit, server-validated reservation of the selected
  // bytes that names the existing file it resolves.
  const resolveDuplicate = useCallback(async (action) => {
    const pending = duplicateResolution;
    if (!pending) return;
    if (pending.selectionId !== fileSelectionId || pending.intakeBatchId !== intakeBatchId) {
      setDuplicateResolution(null);
      setMessage("The selected file or batch changed. Upload the file again.");
      return;
    }
    if (!pending.resolution.available_actions.includes(action)) return;
    const existing = pending.resolution.existing_file;
    setDuplicateResolution(null);

    if (action === DUPLICATE_RESOLUTION_ACTION.CANCEL) {
      setMessage("");
      return;
    }
    if (action === DUPLICATE_RESOLUTION_ACTION.USE_EXISTING_FILE) {
      setIntakeFileId(existing.intake_file_id);
      intakeFileIdRef.current = existing.intake_file_id;
      setFileStatus(null);
      setMessage(`Using the existing file ${existing.safe_filename}.`);
      reportSensitivityProfileDiscovered(null);
      await loadFileStatus(existing.intake_file_id);
      return;
    }
    if (action === DUPLICATE_RESOLUTION_ACTION.CONTINUE_UPLOAD) {
      setBusy(true);
      setMessage("");
      setIntakeFileId(existing.intake_file_id);
      const transfer = await transferAndConfirm({
        reservedFileId: existing.intake_file_id,
        selectedFile: pending.selectedFile,
        uploadState: existing.upload_state,
      });
      setBusy(false);
      setMessage(transfer.ok ? "Upload continued and confirmed." : transfer.message);
      return;
    }
    if (action === DUPLICATE_RESOLUTION_ACTION.UPLOAD_NEW_INTAKE_VERSION) {
      await reserveAndUpload({ duplicateOfIntakeFileId: existing.intake_file_id });
    }
  }, [
    duplicateResolution,
    fileSelectionId,
    intakeBatchId,
    loadFileStatus,
    reportSensitivityProfileDiscovered,
    reserveAndUpload,
    transferAndConfirm,
  ]);

  const visibleDuplicateResolution =
    duplicateResolution
    && duplicateResolution.selectionId === fileSelectionId
    && duplicateResolution.intakeBatchId === intakeBatchId
      ? duplicateResolutionView(duplicateResolution.resolution)
      : null;

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
          onChange={(event) => {
            setFile(event.target.files?.[0] || null);
            setFileSelectionId((value) => value + 1);
            setDuplicateResolution(null);
          }}
          disabled={busy}
        />
        <button type="button" className="btn btn-sm btn-primary" onClick={() => reserveAndUpload()} disabled={busy || !intakeBatchId || !file}>
          Upload the selected file
        </button>
        {visibleDuplicateResolution ? (
          <div className="alert alert-info py-2 small mt-2 mb-0" role="status">
            <div className="fw-semibold mb-1">{visibleDuplicateResolution.heading}</div>
            <div>Existing file: {visibleDuplicateResolution.existingFilename}</div>
            <div>Location: {visibleDuplicateResolution.location}</div>
            <div>Status: {visibleDuplicateResolution.status}</div>
            <div>Processing: {visibleDuplicateResolution.processingStatus}</div>
            {visibleDuplicateResolution.restriction ? (
              <div className="mt-1">{visibleDuplicateResolution.restriction}</div>
            ) : null}
            <div className="d-flex flex-wrap gap-2 mt-2">
              {visibleDuplicateResolution.actions.map(({ action, label }) => (
                <button
                  key={action}
                  type="button"
                  className={action === DUPLICATE_RESOLUTION_ACTION.CANCEL ? "btn btn-sm btn-outline-secondary" : "btn btn-sm btn-primary"}
                  onClick={() => resolveDuplicate(action)}
                  disabled={busy}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
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
                <ValueRow label="Current stage" value={pipelineFileStatusText(pipeline, fileStatus.intake_file_id)} />
                <ValueRow label="Malware scan" value={fileStatus.malware_scan_status} />
                <ValueRow label="File policy" value={fileStatus.file_policy_status} />
                <ValueRow label="Security assessment" value={fileStatus.security_assessment?.category ?? fileStatus.security_assessment?.policy_outcome} />
                <ValueRow label="Processing" value={pipelineFileStatusText(pipeline, fileStatus.intake_file_id, "processing")} />
                <ValueRow label="Data dictionary" value={pipelineFileStatusText(pipeline, fileStatus.intake_file_id, "data_dictionary")} />
                <ValueRow
                  label="Sensitivity classification"
                  value={pipelineFileStatusText(pipeline, fileStatus.intake_file_id, "sensitivity_classification")}
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
                      {item.safe_filename} &mdash; {pipelineFileStatusText(pipeline, item.intake_file_id)}
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
