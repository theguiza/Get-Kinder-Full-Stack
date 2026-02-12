import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_BRAND = { primary: "#ff5656", ink: "#455a7c" };
const VISIBILITY_OPTIONS = [
  { value: "public", label: "Public" },
  { value: "fof", label: "Friends-of-friends" },
  { value: "private", label: "Private link" },
];
const ATTENDANCE_BASE = [
  { value: "host_code", label: "Host Code", always: true },
  { value: "social_proof", label: "Social Proof", always: true },
  { value: "geo", label: "Geo Check-in", requiresGeo: true },
];
const MAX_COVER_SIZE = 2 * 1024 * 1024; // 2MB

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
  return ["host_code", "social_proof"];
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

function normalizeVerificationMethod(value) {
  return ["host_attest", "qr_stub", "social_proof"].includes(value)
    ? value
    : "host_attest";
}

function eventToFormState(event = {}) {
  const causeTags = Array.isArray(event.cause_tags) ? event.cause_tags : [];
  return {
    title: event.title || "",
    category: event.category || "",
    date: formatDateInput(event.start_at, event.tz || event.timezone || "UTC"),
    time: formatTimeRangeFromIso(event.start_at, event.end_at, event.tz || event.timezone || "UTC"),
    tz: event.tz || "America/Vancouver",
    location_text: event.location_text || "",
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
    cause_tags: causeTags.join(", "),
    requirements: event.requirements || "",
    verification_method: normalizeVerificationMethod(event.verification_method),
    impact_credits_base:
      event.impact_credits_base === null || event.impact_credits_base === undefined
        ? "25"
        : String(event.impact_credits_base),
    reliability_weight:
      event.reliability_weight === null || event.reliability_weight === undefined
        ? "1"
        : String(event.reliability_weight),
    reward_pool_kind:
      event.reward_pool_kind === null || event.reward_pool_kind === undefined
        ? 0
        : Number(event.reward_pool_kind),
    attendance_methods: normalizeAttendanceArray(event.attendance_methods),
    safety_notes: event.safety_notes || "",
  };
}

const INITIAL_STATE = {
  title: "",
  category: "",
  date: "",
  time: "",
  tz: "America/Vancouver",
  location_text: "",
  visibility: "public",
  capacity: "",
  waitlist_enabled: true,
  cover_url: "",
  description: "",
  org_name: "",
  community_tag: "",
  cause_tags: "",
  requirements: "",
  verification_method: "host_attest",
  impact_credits_base: "25",
  reliability_weight: "1",
  reward_pool_kind: 0,
  attendance_methods: ["host_code", "social_proof"],
  safety_notes: "",
};

export function CreateEvent({ brand = DEFAULT_BRAND, geoCheckinEnabled = false }) {
  const [form, setForm] = useState(INITIAL_STATE);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [activeIntent, setActiveIntent] = useState(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [coverError, setCoverError] = useState(null);
  const coverInputRef = useRef(null);
  const [editId, setEditId] = useState(() =>
    typeof window === "undefined" ? null : getEditIdFromHash()
  );
  const [editingMeta, setEditingMeta] = useState(null);
  const [editLoading, setEditLoading] = useState(() =>
    typeof window === "undefined" ? false : Boolean(getEditIdFromHash())
  );
  const [editError, setEditError] = useState(null);
  const [editReloadKey, setEditReloadKey] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const publishErrors = useMemo(
    () => validateForm(form, { strict: true, requireAttendance: true }),
    [form]
  );
  const isEditing = Boolean(editId);
  const editingStatus = editingMeta?.status || (isEditing ? "draft" : null);
  const isPublishDisabled =
    submitting || editLoading || Object.keys(publishErrors).length > 0;
  const isFieldsetDisabled = submitting || editLoading;
  const isEditingPublished = isEditing && editingStatus === "published";
  const secondaryLabel = isEditingPublished ? "Save Changes" : "Save Draft";
  const primaryLabel = isEditingPublished ? "Update & Publish" : "Publish";
  const primaryBusyLabel = isEditingPublished ? "Updating…" : "Publishing…";
  const canDeleteDraft = isEditing && editingStatus === "draft" && !editLoading && !editError;

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

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
    if (typeof window === "undefined") return () => {};
    const handleHash = () => setEditId(getEditIdFromHash());
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

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
      setForm({ ...INITIAL_STATE });
      setErrors({});
      return () => {};
    }

    loadEventForEdit();
    return () => {
      aborted = true;
    };
  }, [editId, editReloadKey]);

  const attendanceOptions = ATTENDANCE_BASE.filter(
    (opt) => !opt.requiresGeo || geoCheckinEnabled
  );

  const reloadEditEvent = useCallback(() => {
    setEditReloadKey((key) => key + 1);
  }, []);

  const exitEditMode = useCallback(() => {
    if (typeof window === "undefined") return;
    window.location.hash = "#/create";
  }, []);

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

  function toggleAttendance(value) {
    setForm((prev) => {
      const exists = prev.attendance_methods.includes(value);
      let next;
      if (exists) {
        next = prev.attendance_methods.filter((item) => item !== value);
      } else {
        next = [...prev.attendance_methods, value];
      }
      if (next.length === 0) next = [];
      return { ...prev, attendance_methods: next };
    });
  }

  function handleGetMapLink() {
    const link = window.prompt("Paste a Google or Apple Maps link");
    if (typeof link === "string" && link.trim()) {
      const value = link.trim();
      setForm((prev) => ({
        ...prev,
        location_text: prev.location_text
          ? `${prev.location_text}\n${value}`
          : value,
      }));
    }
  }

  function showToast(message, type = "info", actionLabel, onAction) {
    setToast({ message, type, actionLabel, onAction });
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
              placeholder="e.g., Coffee & Co-work at Main Street"
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
            />
          </Field>

          <div className="grid three">
            <Field label="Category">
              <input
                type="text"
                name="category"
                placeholder="Select category"
                value={form.category}
                onChange={(e) => updateField("category", e.target.value)}
              />
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
          </div>

          <div className="grid two">
            <Field label="Timezone" required error={errors.tz}>
              <input
                type="text"
                name="tz"
                placeholder="America/Vancouver"
                value={form.tz}
                onChange={(e) => updateField("tz", e.target.value)}
              />
            </Field>
            <Field label="Location" required error={errors.location_text}>
              <textarea
                name="location_text"
                placeholder="123 Main St, Vancouver — or paste a map link"
                value={form.location_text}
                onChange={(e) => updateField("location_text", e.target.value)}
                rows={3}
              />
              <div className="helper-row">
                <button
                  type="button"
                  className="btn tiny"
                  onClick={handleGetMapLink}
                >
                  Get Map Link
                </button>
                <span className="muted small">
                  Add a Google/Apple Maps URL to help people find you.
                </span>
              </div>
            </Field>
          </div>

          <div className="grid two">
            <Field label="Organization">
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

          <Field label="Cause tags">
            <input
              type="text"
              name="cause_tags"
              placeholder="Hunger, Seniors, Environment"
              value={form.cause_tags}
              onChange={(e) => updateField("cause_tags", e.target.value)}
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

          <Field label="Visibility" required error={errors.visibility}>
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

          <div className="grid two">
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

          <Field label="Description">
            <textarea
              name="description"
              rows={5}
              placeholder="Tell folks what to expect, what to bring, and why it matters."
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
            />
          </Field>

          <div className="grid three">
            <Field label="Verification method">
              <select
                name="verification_method"
                value={form.verification_method}
                onChange={(e) => updateField("verification_method", e.target.value)}
              >
                <option value="host_attest">Host attestation</option>
                <option value="qr_stub">QR check-in (stub)</option>
                <option value="social_proof">Social proof</option>
              </select>
            </Field>
            <Field label="Impact Credits (base)">
              <input
                type="number"
                min="0"
                name="impact_credits_base"
                value={form.impact_credits_base}
                onChange={(e) => updateField("impact_credits_base", e.target.value)}
              />
            </Field>
            <Field label="Reliability weight">
              <input
                type="number"
                min="0"
                name="reliability_weight"
                value={form.reliability_weight}
                onChange={(e) => updateField("reliability_weight", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid two">
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

          <Field
            label="Attendance methods"
            required
            error={errors.attendance_methods}
          >
            <div className="pill-row wrap">
              {attendanceOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`pill${
                    form.attendance_methods.includes(option.value) ? " active" : ""
                  }`}
                  onClick={() => toggleAttendance(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
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

          <div className="cta-row">
            <button type="button" className="btn secondary" onClick={() => showToast("Invites coming soon.", "info")}>
              Invite People
            </button>
            <button type="button" className="btn secondary" onClick={() => showToast("Private links coming soon.", "info")}>
              Share Private Link
            </button>
          </div>

          <p className="legal-note">
            By publishing, you agree to Get Kinder’s Community Guidelines and assume responsibility for event safety and
            compliance with local laws.
          </p>
        </fieldset>
      </form>

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
  const causeTags = normalizeCauseTagsInput(form.cause_tags);
  const verificationMethod = normalizeVerificationMethod(form.verification_method);
  const impactCreditsInput = typeof form.impact_credits_base === "string"
    ? form.impact_credits_base.trim()
    : form.impact_credits_base;
  const reliabilityWeightInput = typeof form.reliability_weight === "string"
    ? form.reliability_weight.trim()
    : form.reliability_weight;
  const impactCreditsBaseRaw =
    impactCreditsInput === "" || impactCreditsInput === null || impactCreditsInput === undefined
      ? NaN
      : Number(impactCreditsInput);
  const reliabilityWeightRaw =
    reliabilityWeightInput === "" || reliabilityWeightInput === null || reliabilityWeightInput === undefined
      ? NaN
      : Number(reliabilityWeightInput);
  const impactCreditsBase = Number.isFinite(impactCreditsBaseRaw) ? impactCreditsBaseRaw : 25;
  const reliabilityWeight = Number.isFinite(reliabilityWeightRaw) ? reliabilityWeightRaw : 1;
  return {
    title: form.title?.trim(),
    category: form.category?.trim() || null,
    date: form.date || null,
    time_range: form.time || null,
    tz: form.tz?.trim() || "America/Vancouver",
    location_text: form.location_text?.trim() || "",
    visibility: form.visibility,
    capacity: form.capacity ? Number(form.capacity) : null,
    waitlist_enabled: Boolean(form.waitlist_enabled),
    cover_url: form.cover_url?.trim() || null,
    description: form.description?.trim() || null,
    org_name: form.org_name?.trim() || null,
    community_tag: form.community_tag?.trim() || null,
    cause_tags: causeTags,
    requirements: form.requirements?.trim() || null,
    verification_method: verificationMethod,
    impact_credits_base: impactCreditsBase,
    reliability_weight: reliabilityWeight,
    reward_pool_kind: Number(form.reward_pool_kind) || 0,
    attendance_methods: form.attendance_methods,
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
  if (strict && !form.tz?.trim()) {
    errs.tz = "Timezone required.";
  }
  if (strict && !form.location_text?.trim()) {
    errs.location_text = "Location required.";
  }
  if (!form.visibility) {
    errs.visibility = "Choose a visibility.";
  }
  if (form.capacity && Number(form.capacity) < 1) {
    errs.capacity = "Capacity must be at least 1.";
  }
  if (!form.attendance_methods || form.attendance_methods.length === 0) {
    errs.attendance_methods = "Select at least one method.";
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
  .modal-actions {
    margin-top:20px;
    display:flex;
    gap:12px;
    justify-content:flex-end;
  }
`;
