import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  batchFilesPath,
  confirmUploadPath,
  createBatchPath,
  createBatchRequestBody,
  engagementsPath,
  errorText,
  fileDetailPath,
  fileExtensionOf,
  fileReservationRequestBody,
  fileReservationsPath,
  getJson,
  normalizeBatchCode,
  organizationsPath,
  postJson,
  putToSignedUrl,
  requestUploadUrlPath,
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

export default function KaiWebIntake() {
  const [organizations, setOrganizations] = useState([]);
  const [organizationId, setOrganizationId] = useState("");
  const [loadingOrganizations, setLoadingOrganizations] = useState(true);
  const [organizationsLoaded, setOrganizationsLoaded] = useState(false);
  const [engagements, setEngagements] = useState([]);
  const [engagementId, setEngagementId] = useState("");
  const [loadingEngagements, setLoadingEngagements] = useState(false);
  const [engagementsLoaded, setEngagementsLoaded] = useState(false);
  const [batchCode, setBatchCode] = useState("");
  const [intakeBatchId, setIntakeBatchId] = useState("");
  const [file, setFile] = useState(null);
  const [intakeFileId, setIntakeFileId] = useState("");
  const [fileStatus, setFileStatus] = useState(null);
  const [batchFiles, setBatchFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const batchIdempotencyControl = useRef(null);
  const fileReservationIdempotencyControl = useRef(null);

  // The browser never types or fabricates an organization id: it always
  // bootstraps from the server-authoritative list of organizations the
  // already-resolved actor is authorized to use for ordinary intake.
  useEffect(() => {
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
        setOrganizationId(items[0].organization_id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadEngagements = useCallback(async (orgId) => {
    if (!orgId) {
      setEngagements([]);
      setEngagementId("");
      setEngagementsLoaded(false);
      return;
    }
    setLoadingEngagements(true);
    const result = await getJson(engagementsPath(orgId));
    setLoadingEngagements(false);
    setEngagementsLoaded(true);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setEngagements([]);
      setEngagementId("");
      setMessage(errorText(result));
      return;
    }
    const items = result.body.data?.items || [];
    setEngagements(items);
    setEngagementId(items.length === 1 ? items[0].engagement_id : "");
  }, []);

  // Once an organization is selected (auto- or user-picked), the engagement
  // list for that organization is fetched automatically - the user never
  // types or fabricates an engagement id either.
  useEffect(() => {
    loadEngagements(organizationId);
  }, [organizationId, loadEngagements]);

  const createBatch = useCallback(async () => {
    const normalizedBatchCode = normalizeBatchCode(batchCode);
    if (!organizationId || !engagementId || !normalizedBatchCode) {
      setMessage("Organization id, an existing engagement, and batch code are required.");
      return;
    }
    setBusy(true);
    setMessage("");
    const result = await postJson(createBatchPath(), createBatchRequestBody(batchIdempotencyControl, {
      organizationId,
      engagementId,
      batchCode: normalizedBatchCode,
    }));
    setBusy(false);
    if (result.statusCode !== 201 && result.statusCode !== 200) {
      setMessage(errorText(result));
      return;
    }
    setIntakeBatchId(result.body?.data?.intake_batch_id || "");
    setMessage(`Batch created: ${result.body?.data?.intake_batch_id}`);
  }, [organizationId, engagementId, batchCode]);

  const reserveAndUpload = useCallback(async () => {
    if (!organizationId || !engagementId || !intakeBatchId || !file) {
      setMessage("A batch and a chosen file are required.");
      return;
    }
    setBusy(true);
    setMessage("");
    const checksum = await sha256HexOfFile(file);
    const fileExtension = fileExtensionOf(file.name);
    const mimeType = file.type || "text/csv";
    const hashAlgorithm = "sha256";
    const reserveResult = await postJson(fileReservationsPath(intakeBatchId), fileReservationRequestBody(fileReservationIdempotencyControl, {
      organizationId,
      engagementId,
      intakeBatchId,
      originalFilename: file.name,
      fileExtension,
      mimeType,
      fileSizeBytes: file.size,
      checksum,
      hashAlgorithm,
    }));
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
      return;
    }
    setFileStatus(result.body.data);
  }, [organizationId, intakeFileId]);

  const loadBatchFiles = useCallback(async () => {
    if (!organizationId || !intakeBatchId) return;
    setBusy(true);
    const result = await getJson(batchFilesPath(organizationId, intakeBatchId));
    setBusy(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setBatchFiles([]);
      setMessage(errorText(result));
      return;
    }
    setBatchFiles(result.body.data?.items || []);
  }, [organizationId, intakeBatchId]);

  return (
    <section>
      <h1 className="admin-title mb-3">KAI Web Intake</h1>
      {message ? <div className="alert alert-warning py-2">{message}</div> : null}

      <div className="admin-card mb-3">
        <h5 className="mb-2">1. Batch</h5>
        <div className="row g-2 align-items-end mb-2">
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
                onChange={(event) => setOrganizationId(event.target.value)}
                disabled={organizations.length <= 1}
              >
                {organizations.map((item) => (
                  <option key={item.organization_id} value={item.organization_id}>{item.organization_id}</option>
                ))}
              </select>
            )}
          </div>
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
                onChange={(event) => setEngagementId(event.target.value)}
                disabled={engagements.length <= 1}
              >
                {engagements.map((item) => (
                  <option key={item.engagement_id} value={item.engagement_id}>{item.engagement_id}</option>
                ))}
              </select>
            )}
            <div className="form-text">Only existing, tenant-authoritative organizations and engagements are selectable.</div>
          </div>
          <div className="col-12 col-lg-3">
            <label className="form-label small fw-semibold">Batch code</label>
            <input className="form-control form-control-sm" value={batchCode} onChange={(event) => setBatchCode(event.target.value.trim())} />
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-primary" onClick={createBatch} disabled={busy || !organizationId || !engagementId}>Create batch</button>
        {intakeBatchId ? <div className="small mt-2">Batch id: {intakeBatchId}</div> : null}
      </div>

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

      <div className="row g-3">
        <div className="col-12 col-lg-6">
          <div className="admin-card">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">File status</h5>
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={refreshFileStatus} disabled={busy || !intakeFileId}>Refresh</button>
            </div>
            {!fileStatus ? <div className="text-muted small">No file status loaded yet.</div> : (
              <>
                <ValueRow label="Processing" value={fileStatus.processing_status} />
                <ValueRow label="Malware scan" value={fileStatus.malware_scan_status} />
                <ValueRow label="File policy" value={fileStatus.file_policy_status} />
                <ValueRow label="Parse status" value={fileStatus.parse_status} />
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
            {batchFiles.length === 0 ? <div className="text-muted small">No files listed yet.</div> : (
              <ul className="small mb-0">
                {batchFiles.map((item) => (
                  <li key={item.intake_file_id}>{item.safe_filename} &mdash; {item.processing_status}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
