import pool from "../Backend/db/pg.js";

function normalizeOptionalString(value, maxLen = 255) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!Number.isFinite(maxLen) || maxLen <= 0) return trimmed;
  return trimmed.slice(0, Math.trunc(maxLen));
}

function buildGeoContactEmail() {
  return normalizeOptionalString(process.env.GEO_CONTACT_EMAIL, 160) || "support@getkinder.ai";
}

function buildGeoUserAgent() {
  const configured = normalizeOptionalString(process.env.GEO_USER_AGENT, 255);
  const contactEmail = buildGeoContactEmail();
  if (!configured) return `GetKinder.ai/1.0 (${contactEmail})`;
  return /@/.test(configured) ? configured : `${configured} (${contactEmail})`;
}

function buildGeoHeaders() {
  return {
    "User-Agent": buildGeoUserAgent(),
    "Accept-Language": "en",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function parseNominatimFirst(payload) {
  const first = Array.isArray(payload) ? payload[0] : null;
  const lat = Number(first?.lat);
  const lng = Number(first?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function parsePhotonFirst(payload) {
  const feature = Array.isArray(payload?.features) ? payload.features[0] : null;
  const coords = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : null;
  const lng = Number(coords?.[0]);
  const lat = Number(coords?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function geocodeEventLocation(locationText) {
  const query = normalizeOptionalString(locationText, 255);
  if (!query) return null;

  const nominatimUrl = new URL("https://nominatim.openstreetmap.org/search");
  nominatimUrl.searchParams.set("q", query);
  nominatimUrl.searchParams.set("format", "json");
  nominatimUrl.searchParams.set("limit", "1");

  const nominatim = await fetchJsonWithTimeout(nominatimUrl, {
    headers: buildGeoHeaders(),
  });

  if (nominatim.response.ok) {
    const parsed = parseNominatimFirst(nominatim.payload);
    if (parsed) return parsed;
  }

  const photonUrl = new URL("https://photon.komoot.io/api/");
  photonUrl.searchParams.set("q", query);
  photonUrl.searchParams.set("limit", "1");
  photonUrl.searchParams.set("lang", "en");

  const photon = await fetchJsonWithTimeout(photonUrl, {
    headers: { "Accept-Language": "en" },
  });
  if (!photon.response.ok) return null;
  return parsePhotonFirst(photon.payload);
}

async function main() {
  const { rows } = await pool.query(
    `SELECT id, location_text
       FROM events
      WHERE location_lat IS NULL
        AND location_text IS NOT NULL`
  );

  console.log(`Found ${rows.length} events missing coordinates.`);
  let updated = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const eventId = row.id;
    const locationText = String(row.location_text || "").trim();

    try {
      const coords = await geocodeEventLocation(locationText);
      if (!coords) {
        console.log(`[${eventId}] ${locationText || "(empty)"} -> no result`);
      } else {
        await pool.query(
          `UPDATE events
              SET location_lat = $1,
                  location_lng = $2
            WHERE id = $3`,
          [coords.lat, coords.lng, eventId]
        );
        updated += 1;
        console.log(`[${eventId}] ${locationText} -> ${coords.lat}, ${coords.lng}`);
      }
    } catch (err) {
      console.log(`[${eventId}] ${locationText || "(empty)"} -> no result (${err.message})`);
    }

    if (i < rows.length - 1) {
      await sleep(1100);
    }
  }

  console.log(`Done. Updated ${updated} event(s).`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
