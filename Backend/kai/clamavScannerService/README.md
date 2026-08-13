# KAI Gate C ClamAV scanner service

Small runnable scanner foundation only:

- HTTP listener on `PORT`.
- `POST /scan` accepts only `application/octet-stream`.
- Request body is hard-bounded by `KAI_SPRINT2_MAX_FILE_SIZE_BYTES` (25 MiB).
- The scanner talks only to local `clamd` over loopback or Unix socket.
- Responses are sanitized to `clean`, `found`, or generic error reasons.

Signature freshness and definition update infrastructure are runtime
prerequisites for this package. The definition mirror updater, Scheduler, IAM,
and cloud provisioning are intentionally outside this repository package.
Readiness is still fail-closed: `/readyz` requires clamd to detect the EICAR
test signature, so PING alone is not sufficient scanner readiness.
