const GUEST_TOOLS = ["platform_faq"];

const FREE_TOOLS = [
  "search_events",
  "get_event_details",
  "get_user_profile",
  "get_ic_balance",
  "platform_faq",
];

const PLUS_TOOLS = [...FREE_TOOLS, "get_matched_events", "get_weekly_digest", "rsvp_to_event", "cancel_rsvp"];

const PRO_TOOLS = [...PLUS_TOOLS, "get_earning_optimization", "manage_schedule"];

// Org reps are also volunteers — they need personal tools (profile, IC balance, RSVP) alongside org management tools
const ORG_GROWTH_TOOLS = [
  "search_events",
  "get_event_details",
  "get_user_profile",
  "get_ic_balance",
  "platform_faq",
  "draft_event_listing",
  "get_matched_volunteers",
  "flag_noshow_risk",
  "send_volunteer_reminder",
];

const ALL_TOOLS = [
  "platform_faq",
  "search_events",
  "get_event_details",
  "get_user_profile",
  "get_ic_balance",
  "get_matched_events",
  "get_weekly_digest",
  "rsvp_to_event",
  "cancel_rsvp",
  "get_earning_optimization",
  "manage_schedule",
  "auto_find_and_rsvp",
  "draft_event_listing",
  "get_matched_volunteers",
  "flag_noshow_risk",
  "send_volunteer_reminder",
  "auto_staff_event",
  "generate_post_event_report",
];

export function determineKaiTier(user) {
  if (!user) return "guest";

  // PRE-LAUNCH TIER OVERRIDE
  // All users get 'pro' tier (full KAI experience) during pre-launch to build traction and test features.
  // User ID 4 (Mike) gets 'agent' tier for testing autonomous actions.
  // Org reps keep 'org_growth' (includes volunteer + org tools).
  // TODO: Replace with actual subscription tier lookup when payments are wired.
  if (user.id === 4) {
    return "agent";
  }

  if (user.org_rep === true) {
    return "org_growth";
  }

  return "pro";
}

export function getAvailableTools(tier) {
  switch (tier) {
    case "guest":
      return GUEST_TOOLS;
    case "free":
      return FREE_TOOLS;
    case "plus":
      return PLUS_TOOLS;
    case "pro":
      return PRO_TOOLS;
    case "agent":
      return ALL_TOOLS;
    case "org_growth":
      return ORG_GROWTH_TOOLS;
    case "org_enterprise":
      return ALL_TOOLS;
    default:
      return GUEST_TOOLS;
  }
}

export function getModelForTier(tier) {
  switch (tier) {
    case "guest":
    case "free":
      return "claude-haiku-4-5-20251001";
    case "plus":
    case "pro":
    case "org_growth":
    case "agent":
    case "org_enterprise":
      return "claude-sonnet-4-6";
    default:
      return "claude-haiku-4-5-20251001";
  }
}
