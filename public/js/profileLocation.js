(function () {
  "use strict";

  const DEFAULT_CENTER = { lat: 49.2827, lng: -123.1207 };
  const DEFAULT_TIMEZONE = "America/Vancouver";
  const DEFAULT_TRAVEL_MODE = "transit";
  const ALLOWED_RADII = [5, 10, 25, 50];

  function parseInitialJson(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    try {
      const parsed = JSON.parse(el.textContent || "{}");
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function isValidTimezone(value) {
    if (typeof value !== "string") return false;
    const tz = value.trim();
    if (!tz || !/^[A-Za-z0-9_+\-]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(tz)) return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch (_) {
      return false;
    }
  }

  function normalizeTimezone(value, fallback) {
    if (isValidTimezone(value)) return value.trim();
    if (isValidTimezone(fallback)) return fallback.trim();
    return DEFAULT_TIMEZONE;
  }

  function normalizeRadius(value, fallback) {
    const n = Number(value);
    const target = Number.isFinite(n) ? n : Number(fallback);
    if (!Number.isFinite(target)) return 5;
    let nearest = ALLOWED_RADII[0];
    let bestDistance = Math.abs(target - nearest);
    for (const option of ALLOWED_RADII) {
      const distance = Math.abs(target - option);
      if (distance < bestDistance) {
        nearest = option;
        bestDistance = distance;
      }
    }
    return nearest;
  }

  function parseCoordinate(value, type) {
    if (value == null || value === "") return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (type === "lat" && (n < -90 || n > 90)) return null;
    if (type === "lng" && (n < -180 || n > 180)) return null;
    return n;
  }

  function round3(value) {
    return Math.round(Number(value) * 1000) / 1000;
  }

  function formatCoord(value) {
    return Number(value).toFixed(3);
  }

  function buildLabel(state) {
    if (state.lat == null || state.lng == null) return "";
    return state.label || `Near ${formatCoord(state.lat)}, ${formatCoord(state.lng)}`;
  }

  function toSummary(state) {
    if (state.lat == null || state.lng == null) return "No saved location yet.";
    return `Saved: ${buildLabel(state)} • within ${state.travel_radius_km} km`;
  }

  let leafletAssetsPromise = null;
  function loadLeafletAssets() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletAssetsPromise) return leafletAssetsPromise;

    leafletAssetsPromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-leaflet="1"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.setAttribute("data-leaflet", "1");
        document.head.appendChild(link);
      }

      if (document.querySelector('script[data-leaflet="1"]')) {
        const tick = () => {
          if (window.L) return resolve(window.L);
          setTimeout(tick, 30);
        };
        tick();
        return;
      }

      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.async = true;
      script.defer = true;
      script.setAttribute("data-leaflet", "1");
      script.onload = () => {
        if (!window.L) return reject(new Error("Leaflet failed to load."));
        resolve(window.L);
      };
      script.onerror = () => reject(new Error("Unable to load map assets."));
      document.body.appendChild(script);
    });

    return leafletAssetsPromise;
  }

  document.addEventListener("DOMContentLoaded", function () {
    const profileForm = document.getElementById("profile-form");
    if (!profileForm) return;

    const refs = {
      queryInput: document.getElementById("location_query"),
      findBtn: document.getElementById("location-find-btn"),
      useCurrentBtn: document.getElementById("location-use-current-btn"),
      statusLine: document.getElementById("location-status-line"),
      summary: document.getElementById("location-saved-summary"),
      selectedLine: document.getElementById("location-selected-line"),
      radiusSelect: document.getElementById("location-radius-select"),
      mapEl: document.getElementById("location-map"),
      hiddenLat: document.getElementById("home_base_lat"),
      hiddenLng: document.getElementById("home_base_lng"),
      hiddenLabel: document.getElementById("home_base_label"),
      hiddenSource: document.getElementById("home_base_source"),
      hiddenRadius: document.getElementById("travel_radius_km"),
      hiddenMode: document.getElementById("travel_mode"),
      hiddenTimezone: document.getElementById("timezone"),
      availabilityTimezone: document.getElementById("availability_timezone"),
    };

    if (!refs.mapEl || !refs.hiddenLat || !refs.hiddenLng || !refs.hiddenLabel || !refs.hiddenRadius) return;

    const seed = parseInitialJson("location-initial", {});
    const browserTz = (function () {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
      } catch (_) {
        return DEFAULT_TIMEZONE;
      }
    })();

    const state = {
      lat: parseCoordinate(seed.lat, "lat"),
      lng: parseCoordinate(seed.lng, "lng"),
      label: typeof seed.label === "string" ? seed.label.trim() : "",
      source: typeof seed.source === "string" ? seed.source.trim().toLowerCase() : "",
      travel_radius_km: normalizeRadius(seed.travel_radius_km, 5),
      travel_mode: typeof seed.travel_mode === "string" && seed.travel_mode.trim()
        ? seed.travel_mode.trim().toLowerCase()
        : DEFAULT_TRAVEL_MODE,
      timezone: normalizeTimezone(seed.timezone, browserTz),
    };

    let map = null;
    let marker = null;
    let reverseToken = 0;
    let mapHydratedFromState = false;

    function refreshMapLayout() {
      if (!map) return;
      requestAnimationFrame(function () { map.invalidateSize({ pan: false }); });
      setTimeout(function () { map.invalidateSize({ pan: false }); }, 120);
      setTimeout(function () { map.invalidateSize({ pan: false }); }, 260);
    }

    function isMapElementVisible() {
      if (!refs.mapEl) return false;
      if (refs.mapEl.hidden) return false;
      const rects = refs.mapEl.getClientRects();
      return !!(rects && rects.length && refs.mapEl.offsetWidth > 0 && refs.mapEl.offsetHeight > 0);
    }

    function setStatus(message, type) {
      if (!refs.statusLine) return;
      refs.statusLine.textContent = message || "";
      refs.statusLine.classList.remove("text-danger", "text-success");
      if (type === "error") refs.statusLine.classList.add("text-danger");
      if (type === "success") refs.statusLine.classList.add("text-success");
    }

    function syncHiddenInputs() {
      refs.hiddenLat.value = state.lat == null ? "" : formatCoord(round3(state.lat));
      refs.hiddenLng.value = state.lng == null ? "" : formatCoord(round3(state.lng));
      refs.hiddenLabel.value = state.label || "";
      if (refs.hiddenSource) refs.hiddenSource.value = state.source || "pin";
      refs.hiddenRadius.value = String(state.travel_radius_km);
      if (refs.hiddenMode) refs.hiddenMode.value = state.travel_mode || DEFAULT_TRAVEL_MODE;
      if (refs.hiddenTimezone) refs.hiddenTimezone.value = state.timezone;
      if (refs.availabilityTimezone) refs.availabilityTimezone.value = state.timezone;
    }

    function renderSummary() {
      if (refs.summary) refs.summary.textContent = toSummary(state);
      if (refs.radiusSelect) refs.radiusSelect.value = String(state.travel_radius_km);
      if (refs.selectedLine) {
        const label = buildLabel(state);
        refs.selectedLine.textContent = label
          ? `Selected map point: ${label} (${formatCoord(state.lat)}, ${formatCoord(state.lng)})`
          : "Selected map point: No location selected yet.";
      }
      syncHiddenInputs();
    }

    async function reverseLookup(lat, lng) {
      const token = ++reverseToken;
      try {
        const response = await fetch(`/api/geo/reverse?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok || token !== reverseToken) return;
        if (typeof payload?.data?.label === "string" && payload.data.label.trim()) {
          state.label = payload.data.label.trim();
          renderSummary();
        }
      } catch (_) {
        // Reverse lookup is optional.
      }
    }

    function applyLocation(nextLat, nextLng, options = {}) {
      const lat = Number(nextLat);
      const lng = Number(nextLng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      state.lat = round3(lat);
      state.lng = round3(lng);
      state.label = (typeof options.label === "string" ? options.label.trim() : "") || state.label || "";
      state.source = options.source || state.source || "pin";

      if (marker) marker.setLatLng([state.lat, state.lng]);
      if (map && options.center !== false) map.setView([state.lat, state.lng], 14, { animate: false });

      renderSummary();
      if (options.reverseLookup) {
        reverseLookup(state.lat, state.lng);
      }
    }

    async function ensureMapReady() {
      const L = await loadLeafletAssets();
      if (!map) {
        map = L.map(refs.mapEl, { zoomControl: true });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map);

        const initialLat = state.lat != null ? state.lat : DEFAULT_CENTER.lat;
        const initialLng = state.lng != null ? state.lng : DEFAULT_CENTER.lng;
        marker = L.marker([initialLat, initialLng], { draggable: true }).addTo(map);

        marker.on("dragend", function () {
          const pos = marker.getLatLng();
          applyLocation(pos.lat, pos.lng, { source: "pin", center: false, reverseLookup: true });
          setStatus("Map pin updated. Save your profile to persist.", "success");
        });

        map.on("click", function (event) {
          marker.setLatLng(event.latlng);
          applyLocation(event.latlng.lat, event.latlng.lng, { source: "pin", center: false, reverseLookup: true });
          setStatus("Map pin updated. Save your profile to persist.", "success");
        });

        map.setView([initialLat, initialLng], state.lat != null && state.lng != null ? 14 : 11, { animate: false });
        refreshMapLayout();
      }
      return { map, marker };
    }

    async function geocodeQuery(query) {
      const response = await fetch(`/api/geo/geocode?q=${encodeURIComponent(query)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok || !payload?.data) {
        throw new Error(payload?.error || "Unable to find that location.");
      }
      return payload.data;
    }

    if (refs.findBtn && refs.queryInput) {
      refs.findBtn.addEventListener("click", async function () {
        const query = refs.queryInput.value.trim();
        if (query.length < 3) {
          setStatus("Enter at least 3 characters to search.", "error");
          return;
        }
        try {
          refs.findBtn.disabled = true;
          setStatus("Finding location...", "info");
          await ensureMapReady();
          const result = await geocodeQuery(query);
          applyLocation(result.lat, result.lng, {
            label: result.label || query,
            source: "address",
            center: true,
            reverseLookup: false,
          });
          refs.queryInput.value = buildLabel(state);
          setStatus("Location selected. Save your profile to persist.", "success");
        } catch (err) {
          setStatus(err.message || "Unable to find that location.", "error");
        } finally {
          refs.findBtn.disabled = false;
        }
      });
    }

    if (refs.useCurrentBtn) {
      refs.useCurrentBtn.addEventListener("click", function () {
        if (!navigator.geolocation) {
          setStatus("Geolocation is not available in this browser.", "error");
          return;
        }
        setStatus("Getting your current location...", "info");
        navigator.geolocation.getCurrentPosition(
          async function (position) {
            try {
              await ensureMapReady();
              const lat = Number(position.coords.latitude);
              const lng = Number(position.coords.longitude);
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                throw new Error("Unable to read your current location.");
              }
              applyLocation(lat, lng, {
                label: `Near ${formatCoord(lat)}, ${formatCoord(lng)}`,
                source: "gps",
                center: true,
                reverseLookup: true,
              });
              if (refs.queryInput) refs.queryInput.value = buildLabel(state);
              setStatus("Current location selected. Save your profile to persist.", "success");
            } catch (err) {
              setStatus(err.message || "Unable to use current location.", "error");
            }
          },
          function (error) {
            const message = error && error.code === 1
              ? "Location permission was denied."
              : "Unable to get your current location.";
            setStatus(message, "error");
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
      });
    }

    if (refs.radiusSelect) {
      refs.radiusSelect.addEventListener("change", function () {
        state.travel_radius_km = normalizeRadius(refs.radiusSelect.value, state.travel_radius_km);
        renderSummary();
      });
    }

    function hydrateMapFromStateIfNeeded() {
      if (mapHydratedFromState) return;
      if (state.lat != null && state.lng != null) {
        applyLocation(state.lat, state.lng, { center: true, reverseLookup: !state.label, source: state.source || "pin" });
        if (refs.queryInput && state.label) refs.queryInput.value = state.label;
      } else {
        renderSummary();
      }
      mapHydratedFromState = true;
    }

    function activateMapWhenVisible() {
      if (!isMapElementVisible()) return;
      ensureMapReady()
        .then(function () {
          hydrateMapFromStateIfNeeded();
          refreshMapLayout();
        })
        .catch(function (err) {
          setStatus(err.message || "Unable to load the map.", "error");
          renderSummary();
        });
    }

    Array.from(document.querySelectorAll('[data-tab-target="preferences"]')).forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTimeout(activateMapWhenVisible, 80);
      });
    });
    window.addEventListener("resize", activateMapWhenVisible);
    document.addEventListener("profile:preferences-card-expanded", function () {
      setTimeout(activateMapWhenVisible, 20);
    });

    renderSummary();
    if (refs.queryInput && state.label) refs.queryInput.value = state.label;
    setTimeout(activateMapWhenVisible, 0);
    setTimeout(activateMapWhenVisible, 180);
  });
})();
