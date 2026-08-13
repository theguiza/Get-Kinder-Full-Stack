#!/bin/sh
# Gate C ClamAV Cloud Run scanner container entrypoint.
# Definition mirror bootstrap must succeed before local clamd starts. /readyz
# remains fail-closed unless clamd can detect EICAR, so PING alone is not
# enough.
set -eu

echo "[entrypoint] bootstrapping ClamAV definitions"
node /app/Backend/kai/clamavScannerService/bootstrapDefinitions.js

echo "[entrypoint] starting clamd"
clamd --config-file=/app/Backend/kai/clamavScannerService/clamd.conf &
CLAMD_PID=$!

echo "[entrypoint] waiting for clamd to become ready"
ATTEMPTS=0
until clamdscan --ping 1 --config-file=/app/Backend/kai/clamavScannerService/clamd.conf >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge 60 ]; then
    echo "[entrypoint] clamd did not become ready in time" >&2
    kill "$CLAMD_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

echo "[entrypoint] clamd ready, starting scanner HTTP service"
exec node /app/Backend/kai/clamavScannerService/server.js
