function hasText(value) {
  if (typeof value === "string") return value.trim().length > 0;
  return value != null && String(value).trim().length > 0;
}

function safeParseJsonValue(value, fallback) {
  if (value == null) return fallback;
  if (Array.isArray(fallback)) {
    if (Array.isArray(value)) return value;
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string") return fallback;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : fallback;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function resolveAvailabilityState({ user, availability }) {
  if (availability && typeof availability === "object") {
    return {
      weekly: availability.weekly && typeof availability.weekly === "object" ? availability.weekly : {},
      exceptions: Array.isArray(availability.exceptions) ? availability.exceptions : []
    };
  }
  return {
    weekly: safeParseJsonValue(user?.availability_weekly ?? user?.weekly_availability_json, {}),
    exceptions: safeParseJsonValue(user?.specfifc_availability ?? user?.availability_exceptions_json, [])
  };
}

function resolveLocationState({ user, location }) {
  if (location && typeof location === "object") {
    return location;
  }
  return {
    lat: user?.home_base_lat ?? null,
    lng: user?.home_base_lng ?? null,
    label: user?.home_base_label ?? null
  };
}

function hasAvailabilityData(availabilityState) {
  const weekly = availabilityState?.weekly && typeof availabilityState.weekly === "object"
    ? availabilityState.weekly
    : {};
  const exceptions = Array.isArray(availabilityState?.exceptions) ? availabilityState.exceptions : [];
  return (
    (Array.isArray(weekly.days) && weekly.days.length > 0) ||
    (Array.isArray(weekly.time_of_day) && weekly.time_of_day.length > 0) ||
    exceptions.length > 0
  );
}

function hasLocationData(locationState) {
  const lat = locationState?.lat;
  const lng = locationState?.lng;
  return lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}

export function buildProfileCompletion({ user = null, availability = null, location = null } = {}) {
  const availabilityState = resolveAvailabilityState({ user, availability });
  const locationState = resolveLocationState({ user, location });
  const hasAvailability = hasAvailabilityData(availabilityState);
  const hasLocation = hasLocationData(locationState);
  const hasSdgGoals = hasText(user?.sdg1) || hasText(user?.sdg2) || hasText(user?.sdg3);

  const items = [
    {
      key: "photo",
      done: hasText(user?.picture),
      label: "Add a profile photo",
      tab: "portfolio",
      icon: "fa-camera",
      modal: "profilePictureModal"
    },
    {
      key: "preferences",
      done: hasText(user?.interest1),
      label: "Set your volunteer preferences",
      tab: "preferences",
      icon: "fa-sliders",
      card: "preferences"
    },
    {
      key: "availability",
      done: hasAvailability,
      label: "Set your availability",
      tab: "preferences",
      icon: "fa-calendar-days",
      card: "availability"
    },
    {
      key: "location",
      done: hasLocation,
      label: "Set your location",
      tab: "preferences",
      icon: "fa-location-dot",
      card: "location"
    },
    {
      key: "sdg",
      done: hasSdgGoals,
      label: "Choose your SDG goals",
      tab: "preferences",
      icon: "fa-globe",
      card: "sdg"
    },
    {
      key: "phone",
      done: hasText(user?.phone),
      label: "Add your phone number",
      tab: "account",
      icon: "fa-phone",
      focusId: "profile-phone-input"
    },
    {
      key: "city",
      done: hasText(user?.city),
      label: "Add your city",
      tab: "account",
      icon: "fa-location-dot",
      focusId: "profile-city-input"
    }
  ];

  const incompleteItems = items.filter((item) => !item.done);
  const completionPct = Math.round(((items.length - incompleteItems.length) / items.length) * 100);

  return {
    items,
    incompleteItems,
    completionPct,
    profileComplete: incompleteItems.length === 0
  };
}
