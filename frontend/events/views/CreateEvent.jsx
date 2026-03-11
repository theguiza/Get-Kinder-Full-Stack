import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InviteModal } from "../components/InviteModal.jsx";

const DEFAULT_BRAND = { primary: "#ff5656", ink: "#455a7c" };
const VISIBILITY_OPTIONS = [
  { value: "public", label: "Public" },
  { value: "fof", label: "Friends-of-friends" },
  { value: "private", label: "Private link" },
];
const CAUSE_TAG_OPTIONS = [
  { value: "Outdoors", label: "🌿 Outdoors" },
  { value: "Food & Hunger", label: "🍎 Food & Hunger" },
  { value: "Education", label: "📚 Education" },
  { value: "Community", label: "🏘 Community" },
  { value: "Health", label: "💊 Health" },
  { value: "Arts & Culture", label: "🎨 Arts & Culture" },
  { value: "Sports", label: "🏅 Sports" },
  { value: "Animals", label: "🐾 Animals" },
  { value: "Environment", label: "♻️ Environment" },
  { value: "Other", label: "Other" },
];
const MAX_COVER_SIZE = 2 * 1024 * 1024; // 2MB
const FUNDING_POOL_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DEFAULT_MAP_CENTER = { lat: 49.2827, lng: -123.1207 };

let leafletAssetsPromise = null;

function formatCoordinate(value) {
  return Number(value).toFixed(3);
}

function loadLeafletAssets() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Map is unavailable on the server."));
  }
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
      if (!window.L) {
        reject(new Error("Leaflet failed to load."));
        return;
      }
      resolve(window.L);
    };
    script.onerror = () => reject(new Error("Unable to load map assets."));
    document.body.appendChild(script);
  });

  return leafletAssetsPromise;
}

function getEditIdFromHash() {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash || "";
  const [, query = ""] = hash.split("?");
  if (!query) return null;
  const params = new URLSearchParams(query);
  return params.get("edit");
}

function formatDateInput(iso, tz) {
  if (!iso) return "";
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(new Date(iso));
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
    return iso.slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}

function formatTimeRangeFromIso(startIso, endIso, tz) {
  if (!startIso || !endIso) return "";
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz || "UTC",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    const start = formatter.format(new Date(startIso));
    const end = formatter.format(new Date(endIso));
    return `${start}–${end}`;
  } catch {
    return "";
  }
}

function normalizeAttendanceArray(value) {
  if (Array.isArray(value) && value.length) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
  }
  if (value && Array.isArray(value)) return value;
  return ["social_proof"];
}

function normalizeCauseTagsInput(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function isPresetCauseTag(value) {
  return CAUSE_TAG_OPTIONS.some((option) => option.value !== "Other" && option.value === value);
}

function eventToFormState(event = {}) {
  const causeTags = Array.isArray(event.cause_tags) ? event.cause_tags : [];
  const primaryCauseTag = typeof causeTags[0] === "string" ? causeTags[0].trim() : "";
  const causeTagSelection = isPresetCauseTag(primaryCauseTag)
    ? primaryCauseTag
    : primaryCauseTag
      ? "Other"
      : "";
  const causeTagOther = causeTagSelection === "Other" ? primaryCauseTag : "";
  const locationLat = Number(event.location_lat);
  const locationLng = Number(event.location_lng);
  return {
    title: event.title || "",
    category: event.category || "",
    date: formatDateInput(event.start_at, event.tz || event.timezone || "UTC"),
    time: formatTimeRangeFromIso(event.start_at, event.end_at, event.tz || event.timezone || "UTC"),
    tz: event.tz || "America/Vancouver",
    location_text: event.location_text || "",
    location_lat: Number.isFinite(locationLat) ? locationLat : null,
    location_lng: Number.isFinite(locationLng) ? locationLng : null,
    visibility: event.visibility || "public",
    capacity:
      event.capacity === null || event.capacity === undefined
        ? ""
        : String(event.capacity),
    waitlist_enabled: event.waitlist_enabled !== false,
    cover_url: event.cover_url || "",
    description: event.description || "",
    org_name: event.org_name || "",
    community_tag: event.community_tag || "",
    cause_tags: causeTagSelection,
    cause_tag_other: causeTagOther,
    requirements: event.requirements || "",
    reward_pool_kind:
      event.reward_pool_kind === null || event.reward_pool_kind === undefined
        ? 0
        : Number(event.reward_pool_kind),
    funding_pool_slug: (event.funding_pool_slug || "general").toLowerCase(),
    attendance_methods: normalizeAttendanceArray(event.attendance_methods),
    safety_notes: event.safety_notes || "",
  };
}

function createInitialState(defaultOrgName = "") {
  return {
    title: "",
    category: "",
    date: "",
    time: "",
    tz: "America/Vancouver",
    location_text: "",
    location_lat: null,
    location_lng: null,
    visibility: "public",
    capacity: "",
    waitlist_enabled: true,
    cover_url: "",
    description: "",
    org_name: defaultOrgName || "",
    community_tag: "",
    cause_tags: "",
    cause_tag_other: "",
    requirements: "",
    reward_pool_kind: 0,
    funding_pool_slug: "general",
    attendance_methods: ["social_proof"],
    safety_notes: "",
  };
}

export function CreateEvent({
  brand = DEFAULT_BRAND,
  geoCheckinEnabled = false,
  embedded = false,
  initialEditId = null,
  defaultOrgName = "",
  onSaved,
  onCancel,
}) {
  const [form, setForm] = useState(() => createInitialState(defaultOrgName));
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [activeIntent, setActiveIntent] = useState(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [coverError, setCoverError] = useState(null);
  const coverInputRef = useRef(null);
  const [editId, setEditId] = useState(() => {
    if (initialEditId) return String(initialEditId);
    return typeof window === "undefined" ? null : getEditIdFromHash();
  });
  const [editingMeta, setEditingMeta] = useState(null);
  const [editLoading, setEditLoading] = useState(() => {
    if (initialEditId) return true;
    return typeof window === "undefined" ? false : Boolean(getEditIdFromHash());
  });
  const [editError, setEditError] = useState(null);
  const [editReloadKey, setEditReloadKey] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePreparing, setInvitePreparing] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationStatus, setLocationStatus] = useState(null);
  const [locationFinding, setLocationFinding] = useState(false);
  const [locationCurrentBusy, setLocationCurrentBusy] = useState(false);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [locationDraft, setLocationDraft] = useState(null);
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const reverseLookupTokenRef = useRef(0);

  const publishErrors = useMemo(
    () => validateForm(form, { strict: true, requireAttendance: true }),
    [form]
  );
  const isEditing = Boolean(editId);
  const editingStatus = editingMeta?.status || (isEditing ? "draft" : null);
  const isPublishDisabled =
    submitting || editLoading || Object.keys(publishErrors).length > 0;
  const isFieldsetDisabled = submitting || editLoading || invitePreparing;
  const isEditingPublished = isEditing && editingStatus === "published";
  const secondaryLabel = isEditingPublished ? "Save Changes" : "Save Draft";
  const primaryLabel = isEditingPublished ? "Update & Publish" : "Publish";
  const primaryBusyLabel = isEditingPublished ? "Updating…" : "Publishing…";
  const canDeleteDraft = isEditing && editingStatus === "draft" && !editLoading && !editError;
  const inviteTargetId = editingMeta?.id || editId || null;

  const setLocationMessage = useCallback((message, type = "info") => {
    if (!message) {
      setLocationStatus(null);
      return;
    }
    setLocationStatus({ message, type });
  }, []);

  const reverseLookupLocation = useCallback(async (lat, lng) => {
    const token = ++reverseLookupTokenRef.current;
    try {
      const response = await fetch(
        `/api/geo/reverse?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(
          String(lng)
        )}`
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok || token !== reverseLookupTokenRef.current) {
        return;
      }
      const label = typeof payload?.data?.label === "string" ? payload.data.label.trim() : "";
      if (!label) return;
      setLocationDraft((prev) => (prev ? { ...prev, label } : prev));
    } catch {
      // Reverse lookup is optional in the picker.
    }
  }, []);

  const ensureLocationMapReady = useCallback(async () => {
    if (!mapContainerRef.current) {
      throw new Error("Map container not ready.");
    }
    const L = await loadLeafletAssets();
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, { zoomControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      const marker = L.marker([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], {
        draggable: true,
      }).addTo(map);

      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        setLocationDraft((prev) => ({
          lat: pos.lat,
          lng: pos.lng,
          label: prev?.label || "",
          source: "pin",
        }));
        reverseLookupLocation(pos.lat, pos.lng);
      });

      map.on("click", (event) => {
        marker.setLatLng(event.latlng);
        setLocationDraft((prev) => ({
          lat: event.latlng.lat,
          lng: event.latlng.lng,
          label: prev?.label || "",
          source: "pin",
        }));
        reverseLookupLocation(event.latlng.lat, event.latlng.lng);
      });

      mapInstanceRef.current = map;
      markerRef.current = marker;
    }
    return { map: mapInstanceRef.current, marker: markerRef.current };
  }, [reverseLookupLocation]);

  useEffect(() => {
    const lat = Number(locationDraft?.lat);
    const lng = Number(locationDraft?.lng);
    if (!locationModalOpen || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    let cancelled = false;

    (async () => {
      try {
        const { map, marker } = await ensureLocationMapReady();
        if (cancelled) return;
        marker.setLatLng([lat, lng]);
        map.setView([lat, lng], 14, { animate: false });
        requestAnimationFrame(() => map.invalidateSize({ pan: false }));
        setTimeout(() => map.invalidateSize({ pan: false }), 120);
        setTimeout(() => map.invalidateSize({ pan: false }), 280);
      } catch (error) {
        if (cancelled) return;
        setLocationMessage(error?.message || "Unable to load map.", "error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ensureLocationMapReady, locationDraft?.lat, locationDraft?.lng, locationModalOpen, setLocationMessage]);

  useEffect(() => {
    if (locationModalOpen) return;
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
    }
  }, [locationModalOpen]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!inviteTargetId) {
      setInviteOpen(false);
    }
  }, [inviteTargetId]);

  useEffect(() => {
    setCoverPreview(form.cover_url || "");
  }, [form.cover_url]);

  useEffect(() => {
    if (!canDeleteDraft) {
      setDeleteDialogOpen(false);
      setDeleteError(null);
      setDeleteBusy(false);
    }
  }, [canDeleteDraft]);

  useEffect(() => {
    if (embedded || typeof window === "undefined") return () => {};
    const handleHash = () => setEditId(getEditIdFromHash());
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, [embedded]);

  useEffect(() => {
    if (!embedded) return;
    const normalized = initialEditId ? String(initialEditId) : null;
    setEditId(normalized);
  }, [embedded, initialEditId]);

  useEffect(() => {
    let aborted = false;

    async function loadEventForEdit() {
      if (!editId) return;
      setEditLoading(true);
      setEditError(null);
      try {
        const res = await fetch(`/api/events/${editId}?mode=edit`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || "Unable to load event for editing.");
        }
        if (aborted) return;
        const nextForm = eventToFormState(json.data || {});
        setForm(nextForm);
        setLocationQuery(nextForm.location_text || "");
        setErrors({});
        setEditingMeta({
          id: json.data?.id || editId,
          title: json.data?.title || "Untitled Event",
          status: json.data?.status || "draft",
        });
        setEditLoading(false);
      } catch (err) {
        if (aborted) return;
        setEditError(err.message || "Unable to load event for editing.");
        setEditLoading(false);
      }
    }

    if (!editId) {
      setEditingMeta(null);
      setEditError(null);
      setEditLoading(false);
      setForm(createInitialState(defaultOrgName));
      setLocationQuery("");
      setErrors({});
      return () => {};
    }

    loadEventForEdit();
    return () => {
      aborted = true;
    };
  }, [defaultOrgName, editId, editReloadKey]);

  const reloadEditEvent = useCallback(() => {
    setEditReloadKey((key) => key + 1);
  }, []);

  const exitEditMode = useCallback(() => {
    if (embedded) {
      onCancel?.();
      return;
    }
    if (typeof window === "undefined") return;
    window.location.hash = "#/create";
  }, [embedded, onCancel]);

  const rememberDraftHighlight = useCallback((id, title) => {
    if (typeof window === "undefined" || !id) return;
    sessionStorage.setItem("gkLastDraftId", id);
    sessionStorage.setItem("gkLastDraftTitle", title || "Untitled Event");
  }, []);

  function handleCoverFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setCoverError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_COVER_SIZE) {
      setCoverError("Image must be 2MB or less.");
      return;
    }
    setCoverError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      setForm((prev) => ({ ...prev, cover_url: typeof dataUrl === "string" ? dataUrl : prev.cover_url }));
    };
    reader.onerror = () => {
      setCoverError("Unable to read that file. Try another image.");
    };
    reader.readAsDataURL(file);
  }

  function handleCoverUrlChange(value) {
    setCoverError(null);
    setForm((prev) => ({ ...prev, cover_url: value }));
  }

  function clearCoverImage() {
    setCoverError(null);
    if (coverInputRef.current) {
      coverInputRef.current.value = "";
    }
    setForm((prev) => ({ ...prev, cover_url: "" }));
  }

  function updateField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function toggleWaitlist(enabled) {
    setForm((prev) => ({ ...prev, waitlist_enabled: enabled }));
  }

  function openLocationPicker(nextDraft) {
    setLocationDraft({
      lat: Number(nextDraft.lat),
      lng: Number(nextDraft.lng),
      label: (nextDraft.label || "").trim(),
      source: nextDraft.source || "address",
    });
    setLocationModalOpen(true);
  }

  async function geocodeViaBackend(query) {
    const response = await fetch(`/api/geo/geocode?q=${encodeURIComponent(query)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok || !payload?.data) {
      const details = Array.isArray(payload?.details) ? payload.details.join(", ") : "";
      const message = payload?.error || "Unable to find that location.";
      throw new Error(details ? `${message} (${details})` : message);
    }
    const lat = Number(payload.data.lat);
    const lng = Number(payload.data.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("Geocoder returned invalid coordinates.");
    }
    const label = typeof payload.data.label === "string" ? payload.data.label.trim() : "";
    return {
      lat,
      lng,
      label: label || `Near ${formatCoordinate(lat)}, ${formatCoordinate(lng)}`,
      source: "address",
      usedFallback: false,
    };
  }

  async function geocodeViaPublicFallback(query) {
    const candidateQueries = Array.from(new Set([
      query,
      `${query}, BC, Canada`,
      `${query}, Canada`,
    ]));

    for (const candidate of candidateQueries) {
      const searchUrl = new URL("https://nominatim.openstreetmap.org/search");
      searchUrl.searchParams.set("q", candidate);
      searchUrl.searchParams.set("format", "jsonv2");
      searchUrl.searchParams.set("limit", "1");
      searchUrl.searchParams.set("addressdetails", "1");
      const response = await fetch(searchUrl.toString(), {
        headers: { "Accept-Language": "en" },
      });
      if (!response.ok) continue;
      const payload = await response.json().catch(() => []);
      const first = Array.isArray(payload) ? payload[0] : null;
      if (!first) continue;
      const lat = Number(first.lat);
      const lng = Number(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const label = typeof first.display_name === "string" ? first.display_name.trim() : "";
      return {
        lat,
        lng,
        label: label || `Near ${formatCoordinate(lat)}, ${formatCoordinate(lng)}`,
        source: "address",
        usedFallback: true,
      };
    }

    const photonUrl = new URL("https://photon.komoot.io/api/");
    photonUrl.searchParams.set("q", query);
    photonUrl.searchParams.set("limit", "1");
    photonUrl.searchParams.set("lang", "en");
    const photonResponse = await fetch(photonUrl.toString(), {
      headers: { "Accept-Language": "en" },
    });
    if (!photonResponse.ok) {
      throw new Error("Backup geocoder unavailable.");
    }
    const photonPayload = await photonResponse.json().catch(() => ({}));
    const feature = Array.isArray(photonPayload?.features) ? photonPayload.features[0] : null;
    const coords = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : null;
    const lng = Number(coords?.[0]);
    const lat = Number(coords?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("Backup geocoder returned invalid coordinates.");
    }
    const props = feature?.properties || {};
    const parts = [props.name, props.district || props.suburb, props.city || props.town || props.village]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean);
    const label = parts.length
      ? parts.slice(0, 3).join(", ")
      : `Near ${formatCoordinate(lat)}, ${formatCoordinate(lng)}`;
    return { lat, lng, label, source: "address", usedFallback: true };
  }

  async function geocodeWithFallback(query) {
    try {
      return await geocodeViaBackend(query);
    } catch (backendError) {
      const backupResult = await geocodeViaPublicFallback(query).catch(() => null);
      if (backupResult) return backupResult;
      throw backendError;
    }
  }

  async function handleFindLocationOnMap() {
    const query = locationQuery.trim();
    if (query.length < 3) {
      setLocationMessage("Enter at least 3 characters to search.", "error");
      return;
    }
    setLocationFinding(true);
    setLocationMessage("Finding location…", "info");
    try {
      const result = await geocodeWithFallback(query);
      openLocationPicker(result);
      setLocationMessage(
        result.usedFallback
          ? "Backup geocoder used. Confirm your location on the map."
          : "Confirm your location on the map.",
        "success"
      );
    } catch (error) {
      setLocationMessage(error?.message || "Unable to find that location.", "error");
    } finally {
      setLocationFinding(false);
    }
  }

  async function handleUseCurrentLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationMessage("Geolocation is not available in this browser.", "error");
      return;
    }
    setLocationCurrentBusy(true);
    setLocationMessage("Getting your current location…", "info");
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
        });
      });
      const lat = Number(position?.coords?.latitude);
      const lng = Number(position?.coords?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error("Unable to read your coordinates.");
      }
      openLocationPicker({
        lat,
        lng,
        label: `Near ${formatCoordinate(lat)}, ${formatCoordinate(lng)}`,
        source: "device",
      });
      reverseLookupLocation(lat, lng);
      setLocationMessage("Confirm your location on the map.", "success");
    } catch (error) {
      const errCode = Number(error?.code);
      if (errCode === 1) {
        setLocationMessage("Location access was denied.", "error");
      } else if (errCode === 2) {
        setLocationMessage("Unable to determine your current location.", "error");
      } else if (errCode === 3) {
        setLocationMessage("Location request timed out.", "error");
      } else {
        setLocationMessage(error?.message || "Unable to get current location.", "error");
      }
    } finally {
      setLocationCurrentBusy(false);
    }
  }

  function handleConfirmLocation() {
    if (!locationDraft) return;
    const label =
      locationDraft.label?.trim()
      || `Near ${formatCoordinate(locationDraft.lat)}, ${formatCoordinate(locationDraft.lng)}`;
    const lat = Number(locationDraft.lat);
    const lng = Number(locationDraft.lng);
    setForm((prev) => ({
      ...prev,
      location_text: label,
      location_lat: Number.isFinite(lat) ? lat : null,
      location_lng: Number.isFinite(lng) ? lng : null,
    }));
    setLocationQuery(label);
    setErrors((prev) => {
      if (!prev?.location_text) return prev;
      const next = { ...prev };
      delete next.location_text;
      return next;
    });
    setLocationModalOpen(false);
    setLocationMessage("Location selected.", "success");
  }

  function showToast(message, type = "info", actionLabel, onAction) {
    setToast({ message, type, actionLabel, onAction });
  }

  function handleOpenInvitePeople() {
    if (invitePreparing || submitting || editLoading) return;
    if (inviteTargetId) {
      setInviteOpen(true);
      return;
    }
    void prepareDraftForInvites();
  }

  async function prepareDraftForInvites() {
    const inviteDraftForm = form.title?.trim()
      ? form
      : { ...form, title: "Untitled Event" };
    const nextErrors = validateForm(inviteDraftForm, { strict: false });
    const hasErrors = Object.keys(nextErrors).length > 0;
    if (hasErrors) {
      setErrors(nextErrors);
      showToast("Add the required fields before inviting people.", "error");
      return;
    }

    setInvitePreparing(true);
    try {
      if (!form.title?.trim()) {
        setForm((prev) => ({ ...prev, title: "Untitled Event" }));
      }
      const payload = buildPayload(inviteDraftForm, "draft");
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Unable to save draft before inviting.");
      }
      const savedId = data?.data?.id ? String(data.data.id) : "";
      if (!savedId) {
        throw new Error("Draft saved but missing event id.");
      }
      const nextTitle = inviteDraftForm.title?.trim() || "Untitled Event";
      setEditId(savedId);
      setEditingMeta({
        id: savedId,
        title: nextTitle,
        status: "draft",
      });
      showToast("Draft saved. You can now send invites.", "success");
      setInviteOpen(true);
    } catch (error) {
      showToast(error?.message || "Unable to prepare invites.", "error");
    } finally {
      setInvitePreparing(false);
    }
  }

  async function handleSubmit(intent) {
    if (isEditing && editLoading) {
      showToast("Still loading the event details…", "info");
      return;
    }

    setActiveIntent(intent);
    const intentIsPublish = intent === "published";
    const targetStatus = intentIsPublish
      ? "published"
      : isEditingPublished
        ? "published"
        : "draft";
    const strict = targetStatus === "published";
    const nextErrors = validateForm(form, { strict });
    const hasErrors = Object.keys(nextErrors).length > 0;
    setErrors(nextErrors);
    if (hasErrors) {
      const message = strict
        ? "Fix the highlighted fields before publishing."
        : "Fix the highlighted fields before saving.";
      showToast(message, "error");
      setActiveIntent(null);
      return;
    }

    setSubmitting(true);
    try {
      const payload = buildPayload(form, targetStatus);
      const endpoint = isEditing ? `/api/events/${editId}` : "/api/events";
      const method = isEditing ? "PATCH" : "POST";
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Unable to save event");
      }

      const savedId = data?.data?.id || editId;
      const titleLabel = form.title || editingMeta?.title || "Untitled Event";
      const savingPublishedViaSecondary = isEditingPublished && !intentIsPublish;

      if (isEditing) {
        setEditingMeta((prev) => {
          if (!prev) return prev;
          return { ...prev, title: titleLabel, status: targetStatus };
        });
      }

      if (!isEditing) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("orgPortalEventCreated", {
              detail: data?.data || null,
            })
          );
        }

        if (embedded) {
          onSaved?.(data?.data || null);
          return;
        }

        if (targetStatus === "draft") {
          rememberDraftHighlight(savedId, titleLabel);
          window.location.hash = "#/my";
          return;
        }
        showToast("Event published! 🎉", "success", "View in My Events", () => {
          window.location.hash = "#/my";
        });
        if (savedId) {
          setTimeout(() => {
            window.location.hash = `#/events/${savedId}`;
          }, 300);
        }
        return;
      }

      if (embedded) {
        onSaved?.(data?.data || null);
        return;
      }

      if (savingPublishedViaSecondary) {
        showToast("Changes saved.", "success", "View Event", () => {
          if (savedId) {
            window.location.hash = `#/events/${savedId}`;
          }
        });
        return;
      }

      if (targetStatus === "draft") {
        rememberDraftHighlight(savedId, titleLabel);
        window.location.hash = "#/my";
        return;
      }

      const message = isEditingPublished ? "Event updated." : "Event published! 🎉";
      showToast(message, "success", "View in My Events", () => {
        window.location.hash = "#/my";
      });
      if (savedId) {
        setTimeout(() => {
          window.location.hash = `#/events/${savedId}`;
        }, 300);
      }
    } catch (error) {
      console.error("Create event failed:", error);
      showToast(error.message || "Something went wrong.", "error");
    } finally {
      setSubmitting(false);
      setActiveIntent(null);
    }
  }

  function openDeleteDialog() {
    if (!canDeleteDraft) return;
    setDeleteError(null);
    setDeleteDialogOpen(true);
  }

  function closeDeleteDialog() {
    if (deleteBusy) return;
    setDeleteDialogOpen(false);
    setDeleteError(null);
  }

  async function handleDeleteDraft() {
    if (!editId) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/events/${editId}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Unable to delete draft.");
      }
      setDeleteDialogOpen(false);
      if (typeof window !== "undefined") {
        window.location.hash = "#/my";
      }
    } catch (error) {
      console.error("delete draft failed:", error);
      setDeleteError(error.message || "Unable to delete draft.");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <section className="create-event">
      {toast && (
        <div className={`toast ${toast.type}`} role="status" aria-live="polite">
          <span>{toast.message}</span>
          {toast.actionLabel && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.onAction?.();
                setToast(null);
              }}
            >
              {toast.actionLabel}
            </button>
          )}
          <button
            type="button"
            className="toast-close"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <header className="create-head">
        <div>
          <p className="eyebrow">Plan something kind</p>
          <h1>{isEditing ? "Edit Event" : "Create Event"}</h1>
        </div>
        <div className="action-group">
          <button
            type="button"
            className="btn secondary"
            disabled={submitting || editLoading}
            onClick={() => handleSubmit("draft")}
          >
            {submitting && activeIntent === "draft" ? "Saving…" : secondaryLabel}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={isPublishDisabled}
            onClick={() => handleSubmit("published")}
            style={{ backgroundColor: brand.primary, borderColor: brand.primary }}
          >
            {submitting && activeIntent === "published" ? primaryBusyLabel : primaryLabel}
          </button>
        </div>
      </header>

      {isEditing && !editError && (
        <div className="edit-banner">
          <div>
            <span className="muted small">Editing</span>
            <strong>{editingMeta?.title || "This event"}</strong>
          </div>
          <button type="button" className="ghost-link" onClick={exitEditMode}>
            Start a new event
          </button>
        </div>
      )}

      {editError && (
        <div className="banner error">
          <span>{editError}</span>
          <div className="banner-actions">
            <button type="button" className="ghost-link" onClick={reloadEditEvent}>
              Retry
            </button>
            <button type="button" className="ghost-link" onClick={exitEditMode}>
              Exit edit mode
            </button>
          </div>
        </div>
      )}

      {isEditing && editLoading && !editError && (
        <p className="loading-note">Loading event details…</p>
      )}

      <form className="create-form" onSubmit={(event) => event.preventDefault()}>
        <fieldset disabled={isFieldsetDisabled} className="create-fieldset">
          <Field
            label="Title"
            required
            error={errors.title}
          >
            <input
              type="text"
              name="title"
              placeholder="e.g. Spring Food Drive – Apr 5 | Helping Hands Network"
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
            />
          </Field>

          <div className="top-meta-grid">
            <Field label="Cause tags" required error={errors.cause_tags}>
              <select
                name="cause_tags"
                value={form.cause_tags}
                onChange={(e) => {
                  const next = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    cause_tags: next,
                    cause_tag_other: next === "Other" ? prev.cause_tag_other : "",
                  }));
                }}
              >
                <option value="">Select cause tag</option>
                {CAUSE_TAG_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {form.cause_tags === "Other" && (
                <input
                  type="text"
                  name="cause_tag_other"
                  placeholder="Enter custom cause tag"
                  value={form.cause_tag_other || ""}
                  onChange={(e) => updateField("cause_tag_other", e.target.value)}
                />
              )}
            </Field>
            <Field label="Date" required error={errors.date}>
              <input
                type="date"
                name="date"
                value={form.date}
                onChange={(e) => updateField("date", e.target.value)}
              />
            </Field>
            <Field label="Time" required error={errors.time}>
              <input
                type="text"
                name="time"
                placeholder="10:00–12:00"
                value={form.time}
                onChange={(e) => updateField("time", e.target.value)}
              />
            </Field>
            <Field label="Timezone">
              <input
                type="text"
                name="tz"
                placeholder="America/Vancouver"
                value={form.tz}
                onChange={(e) => updateField("tz", e.target.value)}
              />
            </Field>
          </div>

          <div className="org-location-grid">
            <div className="org-location-left">
              <Field label="Organization" required error={errors.org_name}>
                <input
                  type="text"
                  name="org_name"
                  placeholder="e.g., Vancouver Green Crew"
                  value={form.org_name}
                  onChange={(e) => updateField("org_name", e.target.value)}
                />
              </Field>
              <Field label="Community tag">
                <input
                  type="text"
                  name="community_tag"
                  placeholder="e.g., vancouver"
                  value={form.community_tag}
                  onChange={(e) => updateField("community_tag", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Location" required error={errors.location_text}>
              <input
                type="text"
                name="location_query"
                placeholder="Postal code or address"
                value={locationQuery}
                onChange={(e) => setLocationQuery(e.target.value)}
              />
              <div className="helper-row">
                <button
                  type="button"
                  className="btn tiny"
                  onClick={handleFindLocationOnMap}
                  disabled={locationFinding || locationCurrentBusy}
                >
                  {locationFinding ? "Finding…" : "Find on map"}
                </button>
                <button
                  type="button"
                  className="btn tiny secondary"
                  onClick={handleUseCurrentLocation}
                  disabled={locationFinding || locationCurrentBusy}
                >
                  {locationCurrentBusy ? "Locating…" : "Use current location"}
                </button>
              </div>
              {locationStatus?.message && (
                <span className={`location-status ${locationStatus.type || "info"}`}>
                  {locationStatus.message}
                </span>
              )}
              <div className="location-selected">
                <span className="muted small">Selected location</span>
                <strong>{form.location_text || "No location selected yet."}</strong>
              </div>
            </Field>
          </div>

          <Field label="Description">
            <textarea
              name="description"
              rows={5}
              placeholder="Tell folks what to expect, what to bring, and why it matters."
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
            />
          </Field>

          <Field label="Requirements">
            <textarea
              name="requirements"
              rows={3}
              placeholder="e.g., Closed-toe shoes, arrive 10 minutes early."
              value={form.requirements}
              onChange={(e) => updateField("requirements", e.target.value)}
            />
          </Field>

          <Field label="Safety notes">
            <textarea
              name="safety_notes"
              rows={4}
              placeholder="Share any accessibility notes, safety reminders, or special instructions."
              value={form.safety_notes}
              onChange={(e) => updateField("safety_notes", e.target.value)}
            />
          </Field>

          <div className="grid three">
            <Field label="Capacity" error={errors.capacity}>
              <input
                type="number"
                min="1"
                name="capacity"
                placeholder="Leave blank for unlimited"
                value={form.capacity}
                onChange={(e) => updateField("capacity", e.target.value)}
              />
            </Field>
            <Field label="Waitlist" error={errors.waitlist_enabled}>
              <div className="pill-row">
                <button
                  type="button"
                  className={`pill${form.waitlist_enabled ? " active" : ""}`}
                  onClick={() => toggleWaitlist(true)}
                >
                  Enabled
                </button>
                <button
                  type="button"
                  className={`pill${!form.waitlist_enabled ? " active" : ""}`}
                  onClick={() => toggleWaitlist(false)}
                >
                  Disabled
                </button>
              </div>
            </Field>
            <Field label="Invite People">
              <button
                type="button"
                className="btn secondary"
                onClick={handleOpenInvitePeople}
                disabled={invitePreparing || submitting || editLoading}
              >
                {invitePreparing ? "Preparing invites…" : "Invite People"}
              </button>
            </Field>
          </div>

        <Field label="Cover Image" error={coverError}>
          <div className="cover-uploader">
            {coverPreview ? (
              <img src={coverPreview} alt="Event cover" className="cover-preview" />
            ) : (
              <div className="cover-placeholder">Upload a banner to make your event pop.</div>
            )}
            <div className="cover-actions">
              <label className="btn secondary tiny" style={{ cursor: "pointer" }}>
                Upload image
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleCoverFileChange}
                />
              </label>
              {coverPreview && (
                <button type="button" className="btn tiny" onClick={clearCoverImage}>
                  Remove
                </button>
              )}
            </div>
            <p className="muted small">Prefer a link? Paste a hosted image URL:</p>
            <input
              type="url"
              name="cover_url"
              placeholder="https://example.com/cover.jpg"
              value={form.cover_url?.startsWith("data:") ? "" : form.cover_url}
              onChange={(e) => handleCoverUrlChange(e.target.value)}
            />
          </div>
        </Field>

          <div className="grid three">
            <Field label="Reward Pool ($KIND)">
              <input
                type="number"
                min="0"
                name="reward_pool_kind"
                value={form.reward_pool_kind}
                onChange={(e) =>
                  updateField("reward_pool_kind", Number(e.target.value) || 0)
                }
              />
            </Field>
            <Field label="Funding pool" error={errors.funding_pool_slug}>
              <input
                type="text"
                name="funding_pool_slug"
                value={form.funding_pool_slug}
                onChange={(e) =>
                  updateField("funding_pool_slug", (e.target.value || "").toLowerCase())
                }
                placeholder="general"
              />
            </Field>
            <Field label="Boost visibility">
              <button
                type="button"
                className="btn secondary"
                onClick={() => showToast("Boosting with $KIND coming soon.", "info")}
              >
                Boost with $KIND
              </button>
            </Field>
          </div>

          <Field label="Visibility">
            <div className="pill-row">
              {VISIBILITY_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={`pill${form.visibility === option.value ? " active" : ""}`}
                  onClick={() => updateField("visibility", option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>

          <p className="legal-note">
            By publishing, you agree to Get Kinder’s Community Guidelines and assume responsibility for event safety and
            compliance with local laws.
          </p>
        </fieldset>
      </form>

      {locationModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Confirm location">
          <div className="location-modal" role="document">
            <h2>Confirm event location</h2>
            <p className="muted">
              Drag the pin to fine-tune the spot, or click directly on the map.
            </p>
            <div ref={mapContainerRef} className="location-map" />
            <p className="location-draft-line">
              {locationDraft?.label
                || (locationDraft
                  ? `Near ${formatCoordinate(locationDraft.lat)}, ${formatCoordinate(locationDraft.lng)}`
                  : "No location selected")}
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={handleConfirmLocation}>
                Use this location
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setLocationModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {canDeleteDraft && (
        <div className="draft-delete-zone">
          <div>
            <h3>Delete this draft</h3>
            <p>This permanently removes the draft and all saved details.</p>
          </div>
          <button type="button" className="btn danger" onClick={openDeleteDialog}>
            Delete draft
          </button>
        </div>
      )}

      {deleteDialogOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="delete-modal" role="document">
            <h2>Delete draft?</h2>
            <p>This can’t be undone. Are you sure you want to delete this event draft?</p>
            {deleteError && <p className="error-text">{deleteError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn danger"
                onClick={handleDeleteDraft}
                disabled={deleteBusy}
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={closeDeleteDialog}
                disabled={deleteBusy}
              >
                Return
              </button>
            </div>
          </div>
        </div>
      )}

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        eventId={inviteTargetId}
        eventTitle={form.title || editingMeta?.title || "This event"}
        onSent={(data) => {
          setInviteOpen(false);
          showToast(
            `Invite sent to ${data?.invitee_name || data?.invitee_email}.`,
            "success"
          );
        }}
      />

      <style>{styles}</style>
    </section>
  );
}

function Field({ label, children, required, error }) {
  return (
    <label className={`field ${error ? "has-error" : ""}`}>
      <span className="label">
        {label} {required && <span className="required">*</span>}
      </span>
      {children}
      {error && <span className="error-text">{error}</span>}
    </label>
  );
}

function buildPayload(form, status) {
  const selectedCause = typeof form.cause_tags === "string" ? form.cause_tags.trim() : "";
  const otherCause = typeof form.cause_tag_other === "string" ? form.cause_tag_other.trim() : "";
  const causeTags = selectedCause === "Other"
    ? (otherCause ? [otherCause] : [])
    : (selectedCause ? [selectedCause] : []);
  const fundingPoolSlug = (form.funding_pool_slug || "").trim().toLowerCase() || "general";
  const attendanceMethods =
    Array.isArray(form.attendance_methods) && form.attendance_methods.length > 0
      ? form.attendance_methods
      : ["social_proof"];
  return {
    title: form.title?.trim(),
    category: causeTags[0] || null,
    date: form.date || null,
    time_range: form.time || null,
    tz: form.tz?.trim() || "America/Vancouver",
    location_text: form.location_text?.trim() || "",
    location_lat: Number.isFinite(Number(form.location_lat)) ? Number(form.location_lat) : null,
    location_lng: Number.isFinite(Number(form.location_lng)) ? Number(form.location_lng) : null,
    visibility: form.visibility,
    capacity: form.capacity ? Number(form.capacity) : null,
    waitlist_enabled: Boolean(form.waitlist_enabled),
    cover_url: form.cover_url?.trim() || null,
    description: form.description?.trim() || null,
    org_name: form.org_name?.trim() || null,
    community_tag: form.community_tag?.trim() || null,
    cause_tags: causeTags,
    requirements: form.requirements?.trim() || null,
    reward_pool_kind: Number(form.reward_pool_kind) || 0,
    funding_pool_slug: fundingPoolSlug,
    attendance_methods: attendanceMethods,
    safety_notes: form.safety_notes?.trim() || null,
    status,
  };
}

function validateForm(form, { strict = false } = {}) {
  const errs = {};

  if (!form.title?.trim()) {
    errs.title = "Title is required.";
  }
  if (strict && !form.date) {
    errs.date = "Date is required.";
  }
  if (strict && !form.time?.trim()) {
    errs.time = "Time range is required.";
  } else if (form.time?.trim()) {
    const parsed = parseTimeRange(form.time);
    if (!parsed) {
      errs.time = "Use format HH:mm–HH:mm.";
    } else if (parsed.endTotal <= parsed.startTotal) {
      errs.time = "End time must be after start time.";
    }
  }
  if (strict && !form.location_text?.trim()) {
    errs.location_text = "Location required.";
  }
  if (!form.org_name?.trim()) {
    errs.org_name = "Organization is required.";
  }
  const selectedCause = typeof form.cause_tags === "string" ? form.cause_tags.trim() : "";
  if (!selectedCause) {
    errs.cause_tags = "Cause tag is required.";
  } else if (selectedCause === "Other" && !form.cause_tag_other?.trim()) {
    errs.cause_tags = "Enter a custom cause tag.";
  }
  if (form.capacity && Number(form.capacity) < 1) {
    errs.capacity = "Capacity must be at least 1.";
  }
  const fundingPoolSlug = (form.funding_pool_slug || "").trim().toLowerCase();
  if (!fundingPoolSlug) {
    errs.funding_pool_slug = "Funding pool is required.";
  } else if (!FUNDING_POOL_SLUG_RE.test(fundingPoolSlug)) {
    errs.funding_pool_slug = "Use lowercase letters/numbers plus - or _.";
  }
  return errs;
}

function parseTimeRange(value) {
  if (typeof value !== "string") return null;
  const delimiter = value.includes("–") ? "–" : "-";
  const [startRaw, endRaw] = value.split(delimiter).map((part) => part?.trim());
  if (!startRaw || !endRaw) return null;
  const start = parseTime(startRaw);
  const end = parseTime(endRaw);
  if (!start || !end) return null;
  return {
    start,
    end,
    startTotal: start.hour * 60 + start.minute,
    endTotal: end.hour * 60 + end.minute,
  };
}

function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

const styles = `
  .create-event {
    background:#fff;
    border:1px solid #e5e7eb;
    border-radius:20px;
    padding:24px;
    box-shadow:0 20px 40px rgba(15,23,42,0.08);
  }
  .edit-banner {
    display:flex;
    justify-content:space-between;
    align-items:center;
    padding:12px 16px;
    border:1px solid #cbd5f5;
    border-radius:12px;
    background:#f8fafc;
    margin-bottom:16px;
  }
  .banner {
    border-radius:12px;
    padding:12px 16px;
    margin-bottom:16px;
    display:flex;
    justify-content:space-between;
    gap:12px;
    align-items:center;
  }
  .banner.error {
    background:#fee2e2;
    color:#991b1b;
    border:1px solid #fecaca;
  }
  .banner-actions {
    display:flex;
    gap:12px;
    flex-wrap:wrap;
  }
  .ghost-link {
    border:none;
    background:transparent;
    color:#455a7c;
    text-decoration:underline;
    cursor:pointer;
    font-weight:600;
  }
  .loading-note {
    color:#6b7280;
    font-size:0.95rem;
    margin:4px 0 16px;
  }
  .create-head {
    display:flex;
    justify-content:space-between;
    gap:24px;
    align-items:center;
    flex-wrap:wrap;
    margin-bottom:24px;
  }
  .eyebrow {
    font-size:0.85rem;
    text-transform:uppercase;
    letter-spacing:0.08em;
    color:#94a3b8;
    margin:0 0 4px;
  }
  .create-head h1 {
    margin:0;
    color:#111827;
  }
  .action-group {
    display:flex;
    gap:12px;
  }
  .btn {
    border:1px solid #d1d5db;
    border-radius:999px;
    padding:10px 20px;
    font-weight:600;
    cursor:pointer;
    transition:transform 0.1s ease;
  }
  .btn:disabled {
    opacity:0.6;
    cursor:not-allowed;
  }
  .btn.primary {
    color:#fff;
    background-color:#ff5656;
    border-color:#ff5656;
  }
  .btn.secondary {
    background:#fff;
    color:#1f2937;
  }
  .btn.danger {
    background:#fee2e2;
    border-color:#fecaca;
    color:#b91c1c;
  }
  .btn.tiny {
    padding:6px 12px;
    font-size:0.85rem;
  }
  .create-form {
    display:flex;
    flex-direction:column;
    gap:20px;
  }
  .create-fieldset {
    border:0;
    padding:0;
    margin:0;
    display:flex;
    flex-direction:column;
    gap:20px;
  }
  .create-fieldset:disabled {
    opacity:0.6;
  }
  .grid {
    display:grid;
    gap:18px;
  }
  .grid.two {
    grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
  }
  .grid.three {
    grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
  }
  .top-meta-grid {
    display:grid;
    gap:18px;
    grid-template-columns:repeat(4,minmax(0,1fr));
    align-items:start;
  }
  .org-location-grid {
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:18px;
    align-items:start;
  }
  .org-location-left {
    display:grid;
    gap:18px;
    align-content:start;
  }
  .field {
    display:flex;
    flex-direction:column;
    gap:8px;
  }
  .label {
    font-weight:600;
    color:#111827;
  }
  .required {
    color:#ff5656;
  }
  .field input,
  .field textarea {
    border:1px solid #d1d5db;
    border-radius:12px;
    padding:12px 14px;
    font-size:1rem;
    font-family:inherit;
    resize:vertical;
  }
  .field textarea {
    min-height:160px;
  }
  .field.has-error input,
  .field.has-error textarea {
    border-color:#f87171;
  }
  .error-text {
    color:#b91c1c;
    font-size:0.85rem;
  }
  .pill-row {
    display:flex;
    gap:12px;
    flex-wrap:wrap;
  }
  .pill-row.wrap {
    flex-wrap:wrap;
  }
  .pill {
    border:1px solid #d1d5db;
    padding:8px 16px;
    border-radius:999px;
    background:#fff;
    cursor:pointer;
    font-weight:600;
  }
  .pill.active {
    background:#ff5656;
    color:#fff;
    border-color:#ff5656;
  }
  .helper-row {
    display:flex;
    gap:12px;
    align-items:center;
    flex-wrap:wrap;
  }
  .location-status {
    font-size:0.85rem;
    font-weight:600;
  }
  .location-status.info {
    color:#2563eb;
  }
  .location-status.success {
    color:#15803d;
  }
  .location-status.error {
    color:#b91c1c;
  }
  .location-selected {
    border:1px solid #e5e7eb;
    background:#f8fafc;
    border-radius:12px;
    padding:10px 12px;
    display:flex;
    flex-direction:column;
    gap:4px;
  }
  .location-selected strong {
    color:#111827;
    font-size:0.95rem;
    line-height:1.35;
    white-space:pre-wrap;
    word-break:break-word;
  }
  .muted {
    color:#6b7280;
  }
  .muted.small {
    font-size:0.85rem;
  }
  .cover-uploader {
    display:flex;
    flex-direction:column;
    gap:8px;
    border:1px dashed #cbd5f5;
    padding:12px;
    border-radius:16px;
    background:#f8fafc;
  }
  .cover-preview {
    width:100%;
    max-height:220px;
    object-fit:cover;
    border-radius:12px;
    border:1px solid #e5e7eb;
  }
  .cover-placeholder {
    border:1px dashed #d1d5db;
    border-radius:12px;
    padding:24px;
    text-align:center;
    color:#6b7280;
    font-size:0.95rem;
  }
  .cover-actions {
    display:flex;
    gap:8px;
    flex-wrap:wrap;
  }
  .cta-row {
    display:flex;
    gap:12px;
    flex-wrap:wrap;
    justify-content:flex-start;
  }
  .legal-note {
    font-size:0.85rem;
    color:#6b7280;
    margin-top:16px;
  }
  .toast {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    border-radius:12px;
    padding:12px 16px;
    margin-bottom:16px;
    color:#fff;
  }
  .toast.info { background:#3b82f6; }
  .toast.success { background:#16a34a; }
  .toast.error { background:#ef4444; }
  .toast-action {
    border:1px solid rgba(255,255,255,0.5);
    border-radius:999px;
    padding:6px 14px;
    font-size:0.85rem;
    background:transparent;
    color:inherit;
    cursor:pointer;
  }
  .toast-close {
    background:transparent;
    border:none;
    color:inherit;
    font-size:1.2rem;
    cursor:pointer;
  }
  .draft-delete-zone {
    margin-top:24px;
    padding:16px;
    border:1px solid #fecaca;
    border-radius:12px;
    background:#fff7f7;
    display:flex;
    justify-content:space-between;
    align-items:center;
    gap:16px;
    flex-wrap:wrap;
  }
  .draft-delete-zone h3 {
    margin:0 0 6px;
  }
  .draft-delete-zone p {
    margin:0;
    color:#b91c1c;
  }
  .modal-overlay {
    position:fixed;
    inset:0;
    background:rgba(15,23,42,0.45);
    display:flex;
    align-items:center;
    justify-content:center;
    padding:16px;
    z-index:50;
  }
  .delete-modal {
    background:#fff;
    border-radius:16px;
    padding:24px;
    width:100%;
    max-width:420px;
    box-shadow:0 32px 60px rgba(15,23,42,0.2);
  }
  .delete-modal h2 {
    margin:0 0 8px;
  }
  .delete-modal p {
    margin:0;
    color:#4b5563;
  }
  .location-modal {
    background:#fff;
    border-radius:16px;
    padding:24px;
    width:100%;
    max-width:640px;
    box-shadow:0 32px 60px rgba(15,23,42,0.2);
    display:flex;
    flex-direction:column;
    gap:12px;
  }
  .location-modal h2 {
    margin:0;
  }
  .location-map {
    width:100%;
    min-height:320px;
    border-radius:12px;
    border:1px solid #e5e7eb;
  }
  .location-draft-line {
    margin:0;
    color:#111827;
    font-weight:600;
    line-height:1.4;
  }
  .modal-actions {
    margin-top:20px;
    display:flex;
    gap:12px;
    justify-content:flex-end;
  }
  @media (max-width: 900px) {
    .top-meta-grid {
      grid-template-columns:repeat(2,minmax(0,1fr));
    }
    .org-location-grid {
      grid-template-columns:1fr;
    }
  }
`;
