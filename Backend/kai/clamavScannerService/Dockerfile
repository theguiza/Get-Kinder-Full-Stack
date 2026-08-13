# Gate C ClamAV scanner image.
# Runs a local clamd (loopback-only, no exposed clamd port) behind a Node
# HTTP boundary. The entrypoint bootstraps accepted private-mirror definitions
# before clamd starts; the updater job image/provisioning remains separate.
FROM node:20-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends clamav-daemon clamdscan \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/clamav \
    && chown -R clamav:clamav /var/lib/clamav

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY Backend/kai ./Backend/kai

RUN chmod +x ./Backend/kai/clamavScannerService/entrypoint.sh

ENV NODE_ENV=production
EXPOSE 8080

ENTRYPOINT ["./Backend/kai/clamavScannerService/entrypoint.sh"]
