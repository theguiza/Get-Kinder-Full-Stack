let telemetrySink = (eventName, payload) => {
  console.info("[analytics]", eventName, payload);
};

function normalize(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function classifyGuestDiscoveryQuery(message) {
  const text = normalize(message);
  if (!text) return "empty";

  if (/\b(rsvp|register me|sign me up|sign up|book me|save (this|that|it|event)|cancel my rsvp|withdraw me)\b/.test(text)) {
    return "restricted_action";
  }

  if (/\b(my profile|my account|my balance|impact credits|ic balance|my credits|my rating|my stats|my schedule)\b/.test(text)) {
    return "account_request";
  }

  if (/\b(log in|login|sign up|signup|create account|join now|get started)\b/.test(text)) {
    return "login_intent";
  }

  if (/\b(near me|nearby)\b/.test(text)) {
    return "near_me";
  }

  if (/\b(what can i do|what should i do|where can i help)\b/.test(text)) {
    return "vague_discovery";
  }

  if (/\b(find|search|show|list|browse|events?|opportunities|weekend|today|tomorrow|city|cause|date)\b/.test(text)) {
    return "event_search";
  }

  return "other";
}

export function bucketResultCount(count) {
  const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;
  if (safeCount <= 0) return "0";
  if (safeCount === 1) return "1";
  if (safeCount <= 3) return "2_3";
  return "4_plus";
}

export function emitGuestDiscoveryTelemetry(eventName, payload = {}) {
  try {
    telemetrySink(eventName, {
      channel: "guest_kai_discovery",
      ...payload,
    });
  } catch (error) {
    console.warn("[kai-guest-telemetry] emit failed:", error);
  }
}

export const __testables = {
  bucketResultCount,
  classifyGuestDiscoveryQuery,
  setTelemetrySinkForTests(fn) {
    telemetrySink = typeof fn === "function" ? fn : telemetrySink;
  },
  resetTelemetrySinkForTests() {
    telemetrySink = (eventName, payload) => {
      console.info("[analytics]", eventName, payload);
    };
  },
};
