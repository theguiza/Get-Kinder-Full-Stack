(function () {
  'use strict';

  const DEFAULT_CENTER = { lat: 49.2827, lng: -123.1207 };
  const DEFAULT_TIMEZONE = 'America/Vancouver';
  const TRAVEL_MODES = ['walk', 'bike', 'transit', 'drive'];
  const TRAVEL_MODE_LABELS = {
    walk: 'walk',
    bike: 'bike',
    transit: 'transit',
    drive: 'drive'
  };

  function parseInitialJson(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    try {
      const parsed = JSON.parse(el.textContent || '{}');
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function isValidTimezone(value) {
    if (typeof value !== 'string') return false;
    const tz = value.trim();
    if (!tz || !/^[A-Za-z0-9_+\-]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(tz)) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
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

  function normalizeMode(value, fallback) {
    const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (TRAVEL_MODES.includes(v)) return v;
    return TRAVEL_MODES.includes(fallback) ? fallback : 'transit';
  }

  function normalizeRadius(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const rounded = Math.round(n);
    if (rounded < 1) return 1;
    if (rounded > 25) return 25;
    return rounded;
  }

  function parseCoordinate(value, type) {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (type === 'lat' && (n < -90 || n > 90)) return null;
    if (type === 'lng' && (n < -180 || n > 180)) return null;
    return n;
  }

  function round3(value) {
    return Math.round(Number(value) * 1000) / 1000;
  }

  function formatCoord(value) {
    return Number(value).toFixed(3);
  }

  function toSummary(state) {
    if (state.lat == null || state.lng == null) return 'No saved location yet.';
    const label = state.label || `Near ${formatCoord(state.lat)}, ${formatCoord(state.lng)}`;
    return `Saved: ${label} • within ${state.travel_radius_km} km • by ${TRAVEL_MODE_LABELS[state.travel_mode]}`;
  }

  let leafletAssetsPromise = null;
  function loadLeafletAssets() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletAssetsPromise) return leafletAssetsPromise;

    leafletAssetsPromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-leaflet="1"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        link.setAttribute('data-leaflet', '1');
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

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      script.defer = true;
      script.setAttribute('data-leaflet', '1');
      script.onload = () => {
        if (!window.L) return reject(new Error('Leaflet failed to load.'));
        resolve(window.L);
      };
      script.onerror = () => reject(new Error('Unable to load map assets.'));
      document.body.appendChild(script);
    });

    return leafletAssetsPromise;
  }

  document.addEventListener('DOMContentLoaded', function () {
    const profileForm = document.getElementById('profile-form');
    if (!profileForm) return;

    const refs = {
      queryInput: document.getElementById('location_query'),
      findBtn: document.getElementById('location-find-btn'),
      useCurrentBtn: document.getElementById('location-use-current-btn'),
      editBtn: document.getElementById('location-edit-btn'),
      statusLine: document.getElementById('location-status-line'),
      summary: document.getElementById('location-saved-summary'),
      radiusRange: document.getElementById('location-radius-range'),
      radiusValue: document.getElementById('location-radius-value'),
      modeButtons: Array.from(document.querySelectorAll('[data-travel-mode]')),
      hiddenLat: document.getElementById('home_base_lat'),
      hiddenLng: document.getElementById('home_base_lng'),
      hiddenLabel: document.getElementById('home_base_label'),
      hiddenSource: document.getElementById('home_base_source'),
      hiddenRadius: document.getElementById('travel_radius_km'),
      hiddenMode: document.getElementById('travel_mode'),
      hiddenTimezone: document.getElementById('timezone'),
      availabilityTimezone: document.getElementById('availability_timezone'),
      modalEl: document.getElementById('locationPickerModal'),
      modalSaveBtn: document.getElementById('location-modal-save-btn'),
      mapEl: document.getElementById('location-map'),
      selectedLine: document.getElementById('location-selected-line')
    };

    if (!refs.hiddenLat || !refs.hiddenLng || !refs.hiddenRadius || !refs.hiddenMode || !refs.hiddenTimezone) return;

    const seed = parseInitialJson('location-initial', {});
    const browserTz = (function () {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
      } catch (_) {
        return DEFAULT_TIMEZONE;
      }
    })();

    const state = {
      lat: parseCoordinate(seed.lat, 'lat'),
      lng: parseCoordinate(seed.lng, 'lng'),
      label: typeof seed.label === 'string' ? seed.label.trim() : '',
      source: typeof seed.source === 'string' ? seed.source.trim().toLowerCase() : '',
      travel_radius_km: normalizeRadius(seed.travel_radius_km, 5),
      travel_mode: normalizeMode(seed.travel_mode, 'transit'),
      timezone: normalizeTimezone(seed.timezone, browserTz)
    };

    let draft = null;
    let map = null;
    let marker = null;
    let modal = null;
    let reverseToken = 0;

    function refreshMapLayout() {
      if (!map || !draft) return;
      map.invalidateSize({ pan: false });
      map.setView([draft.lat, draft.lng], map.getZoom(), { animate: false });
    }

    function setStatus(message, isError) {
      if (!refs.statusLine) return;
      refs.statusLine.textContent = message || '';
      refs.statusLine.classList.toggle('text-danger', !!isError);
      refs.statusLine.classList.toggle('text-success', !!message && !isError);
    }

    function syncHiddenInputs() {
      refs.hiddenLat.value = state.lat == null ? '' : formatCoord(round3(state.lat));
      refs.hiddenLng.value = state.lng == null ? '' : formatCoord(round3(state.lng));
      refs.hiddenLabel.value = state.label || '';
      refs.hiddenSource.value = state.source || '';
      refs.hiddenRadius.value = String(state.travel_radius_km);
      refs.hiddenMode.value = state.travel_mode;
      refs.hiddenTimezone.value = state.timezone;
      if (refs.availabilityTimezone) refs.availabilityTimezone.value = state.timezone;
    }

    function renderTravelPrefs() {
      if (refs.radiusRange) refs.radiusRange.value = String(state.travel_radius_km);
      if (refs.radiusValue) refs.radiusValue.textContent = String(state.travel_radius_km);
      refs.modeButtons.forEach((btn) => {
        const mode = btn.getAttribute('data-travel-mode');
        const active = mode === state.travel_mode;
        btn.classList.toggle('btn-primary', active);
        btn.classList.toggle('btn-outline-primary', !active);
      });
    }

    function renderSummary() {
      if (refs.summary) refs.summary.textContent = toSummary(state);
      if (refs.editBtn) refs.editBtn.classList.toggle('d-none', !(state.lat != null && state.lng != null));
      syncHiddenInputs();
      renderTravelPrefs();
    }

    function updateDraftLine() {
      if (!refs.selectedLine || !draft) return;
      const label = draft.label || `Near ${formatCoord(draft.lat)}, ${formatCoord(draft.lng)}`;
      refs.selectedLine.textContent = `${label} (${formatCoord(draft.lat)}, ${formatCoord(draft.lng)})`;
    }

    async function reverseLookup(lat, lng) {
      const token = ++reverseToken;
      try {
        const response = await fetch(`/api/geo/reverse?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok) return;
        if (token !== reverseToken || !draft) return;
        if (typeof payload?.data?.label === 'string' && payload.data.label.trim()) {
          draft.label = payload.data.label.trim();
          updateDraftLine();
        }
      } catch (_) {
        // Reverse lookup is optional; ignore errors silently.
      }
    }

    async function ensureMapReady() {
      if (!refs.mapEl) throw new Error('Map container not found.');
      const L = await loadLeafletAssets();
      if (!map) {
        map = L.map(refs.mapEl, { zoomControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        marker = L.marker([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], { draggable: true }).addTo(map);
        marker.on('dragend', function () {
          const pos = marker.getLatLng();
          if (!draft) return;
          draft.lat = pos.lat;
          draft.lng = pos.lng;
          draft.source = 'pin';
          updateDraftLine();
          reverseLookup(draft.lat, draft.lng);
        });

        map.on('click', function (event) {
          if (!marker || !draft) return;
          marker.setLatLng(event.latlng);
          draft.lat = event.latlng.lat;
          draft.lng = event.latlng.lng;
          draft.source = 'pin';
          updateDraftLine();
          reverseLookup(draft.lat, draft.lng);
        });
      }

      return { L, map, marker };
    }

    async function openModalWithDraft(nextDraft) {
      draft = {
        lat: Number(nextDraft.lat),
        lng: Number(nextDraft.lng),
        label: (nextDraft.label || '').trim(),
        source: nextDraft.source || 'address'
      };

      const { map: mapInstance, marker: markerInstance } = await ensureMapReady();
      markerInstance.setLatLng([draft.lat, draft.lng]);
      mapInstance.setView([draft.lat, draft.lng], 14);
      updateDraftLine();

      if (!modal && refs.modalEl && window.bootstrap && window.bootstrap.Modal) {
        modal = new window.bootstrap.Modal(refs.modalEl);
      }

      if (modal) {
        modal.show();
        // Firefox can report stale dimensions during modal transitions.
        requestAnimationFrame(refreshMapLayout);
        setTimeout(refreshMapLayout, 120);
        setTimeout(refreshMapLayout, 300);
      }
    }

    if (refs.modalEl) {
      refs.modalEl.addEventListener('shown.bs.modal', function () {
        requestAnimationFrame(refreshMapLayout);
        setTimeout(refreshMapLayout, 120);
        setTimeout(refreshMapLayout, 300);
      });
    }

    async function geocodeQuery(query) {
      const response = await fetch(`/api/geo/geocode?q=${encodeURIComponent(query)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok || !payload?.data) {
        throw new Error(payload?.error || 'Unable to find that location.');
      }
      return payload.data;
    }

    if (refs.findBtn && refs.queryInput) {
      refs.findBtn.addEventListener('click', async function () {
        const query = refs.queryInput.value.trim();
        if (!query) {
          setStatus('Enter a postal code or address first.', true);
          return;
        }

        try {
          refs.findBtn.disabled = true;
          setStatus('Finding location…', false);
          const result = await geocodeQuery(query);
          setStatus('Location found. Confirm on map.', false);
          await openModalWithDraft({
            lat: Number(result.lat),
            lng: Number(result.lng),
            label: result.label || query,
            source: 'address'
          });
        } catch (err) {
          setStatus(err.message || 'Unable to find that location.', true);
        } finally {
          refs.findBtn.disabled = false;
        }
      });
    }

    if (refs.useCurrentBtn) {
      refs.useCurrentBtn.addEventListener('click', function () {
        if (!navigator.geolocation) {
          setStatus('Geolocation is not available in this browser.', true);
          return;
        }

        setStatus('Getting your current location…', false);
        navigator.geolocation.getCurrentPosition(
          async function (position) {
            try {
              const lat = Number(position.coords.latitude);
              const lng = Number(position.coords.longitude);
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                throw new Error('Unable to read your current location.');
              }
              setStatus('Current location detected. Confirm on map.', false);
              await openModalWithDraft({ lat, lng, label: '', source: 'gps' });
              reverseLookup(lat, lng);
            } catch (err) {
              setStatus(err.message || 'Unable to use current location.', true);
            }
          },
          function (error) {
            const message = error && error.code === 1
              ? 'Location permission was denied.'
              : 'Unable to get your current location.';
            setStatus(message, true);
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });
    }

    if (refs.editBtn) {
      refs.editBtn.addEventListener('click', async function () {
        const lat = state.lat != null ? state.lat : DEFAULT_CENTER.lat;
        const lng = state.lng != null ? state.lng : DEFAULT_CENTER.lng;
        try {
          await openModalWithDraft({ lat, lng, label: state.label, source: state.source || 'pin' });
        } catch (err) {
          setStatus(err.message || 'Unable to open map right now.', true);
        }
      });
    }

    if (refs.modalSaveBtn) {
      refs.modalSaveBtn.addEventListener('click', function () {
        if (!draft) return;
        state.lat = round3(draft.lat);
        state.lng = round3(draft.lng);
        state.label = (draft.label || '').trim() || `Near ${formatCoord(state.lat)}, ${formatCoord(state.lng)}`;
        state.source = draft.source || 'pin';
        if (refs.queryInput && !refs.queryInput.value.trim() && state.label) refs.queryInput.value = state.label;
        renderSummary();
        setStatus('Location updated. Click Save preferences to persist.', false);
        if (modal) modal.hide();
      });
    }

    if (refs.radiusRange) {
      refs.radiusRange.addEventListener('input', function () {
        state.travel_radius_km = normalizeRadius(refs.radiusRange.value, state.travel_radius_km);
        renderSummary();
      });
    }

    refs.modeButtons.forEach((btn) => {
      btn.addEventListener('click', function () {
        const nextMode = btn.getAttribute('data-travel-mode');
        state.travel_mode = normalizeMode(nextMode, state.travel_mode);
        renderSummary();
      });
    });

    if (!state.label && state.lat != null && state.lng != null) {
      state.label = `Near ${formatCoord(state.lat)}, ${formatCoord(state.lng)}`;
    }
    if (refs.queryInput && state.label) refs.queryInput.value = state.label;
    renderSummary();
  });
})();
