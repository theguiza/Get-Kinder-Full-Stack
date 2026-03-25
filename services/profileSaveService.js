function normalizeOptionalString(value, maxLen = 255) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function normalizeRequiredName(value) {
  return normalizeOptionalString(value, 80) || "";
}

export function resolveProfileSaveAction(rawValue) {
  const normalized = typeof rawValue === "string" && rawValue.trim()
    ? rawValue.trim().toLowerCase()
    : "save_profile";
  const isPreferenceSave = normalized === "save_preferences" || normalized.startsWith("save_preferences:");
  const savedPreferenceCard = isPreferenceSave
    ? normalizeOptionalString(normalized.split(":")[1], 32)
    : null;

  return {
    action: normalized,
    isPreferenceSave,
    isPhotoSave: normalized === "save_photo",
    isProfileSave: !isPreferenceSave && normalized !== "save_photo",
    savedPreferenceCard
  };
}

export function buildProfileFieldUpdates({ actionState, body = {}, existingUserRow = {} } = {}) {
  const isProfileSave = Boolean(actionState?.isProfileSave);
  const isPreferenceSave = Boolean(actionState?.isPreferenceSave);

  return {
    firstname: isProfileSave ? normalizeRequiredName(body.firstname) : (existingUserRow.firstname || ""),
    lastname: isProfileSave ? normalizeRequiredName(body.lastname) : (existingUserRow.lastname || ""),
    email: isProfileSave && typeof body.email === "string" && body.email.trim()
      ? body.email.trim()
      : existingUserRow.email,
    phone: isProfileSave ? normalizeOptionalString(body.phone, 40) : existingUserRow.phone,
    address1: isProfileSave ? normalizeOptionalString(body.address1, 255) : existingUserRow.address1,
    city: isProfileSave ? normalizeOptionalString(body.city, 120) : existingUserRow.city,
    state: isProfileSave ? normalizeOptionalString(body.state, 120) : existingUserRow.state,
    country: isProfileSave ? normalizeOptionalString(body.country, 120) : existingUserRow.country,
    interest1: isPreferenceSave ? normalizeOptionalString(body.interest1, 255) : existingUserRow.interest1,
    interest2: isPreferenceSave ? normalizeOptionalString(body.interest2, 255) : existingUserRow.interest2,
    interest3: isPreferenceSave ? normalizeOptionalString(body.interest3, 255) : existingUserRow.interest3,
    sdg1: isPreferenceSave ? normalizeOptionalString(body.sdg1, 120) : existingUserRow.sdg1,
    sdg2: isPreferenceSave ? normalizeOptionalString(body.sdg2, 120) : existingUserRow.sdg2,
    sdg3: isPreferenceSave ? normalizeOptionalString(body.sdg3, 120) : existingUserRow.sdg3
  };
}

export function buildProfileRedirectParams(actionState) {
  if (actionState?.isPreferenceSave) {
    return {
      tab: "preferences",
      card: actionState.savedPreferenceCard || "preferences",
      saved: "preferences"
    };
  }
  if (actionState?.isPhotoSave) {
    return {
      tab: "portfolio",
      saved: "photo"
    };
  }
  return {
    tab: "account",
    saved: "profile"
  };
}
