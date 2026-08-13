# KAI Gate C ClamAV scanner service

Small runnable scanner foundation only:

- HTTP listener on `PORT`.
- `POST /scan` accepts only `application/octet-stream`.
- Request body is hard-bounded by `KAI_SPRINT2_MAX_FILE_SIZE_BYTES` (25 MiB).
- The scanner talks only to local `clamd` over loopback or Unix socket.
- Responses are sanitized to `clean`, `found`, or generic error reasons.
- Startup bootstraps definitions from the configured private GCS mirror
  `current` pointer before `clamd` starts.
- Definition freshness is bounded by ClamAV database build metadata recorded
  in the manifest, not GCS object modification time.

The repository includes the smallest mirror-updater executable foundation for
a later Cloud Run Job. Scheduler, IAM, bucket creation, deployment, production
configuration, and old-generation retention are intentionally outside this
repository package. Readiness is still fail-closed: `/readyz` requires clamd to
detect the EICAR test signature, so PING alone is not sufficient scanner
readiness.
