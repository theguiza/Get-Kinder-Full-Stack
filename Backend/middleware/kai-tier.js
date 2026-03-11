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

const ORG_GROWTH_TOOLS = [
  "search_events",
  "get_event_details",
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

  if (user.org_rep === true) {
    // TODO: Replace with organization subscription lookup once billing/subscriptions are wired.
    // TODO: Return org_growth/org_enterprise based on org plan from persistent subscription source.
    return "org_growth";
  }

  // TODO: Replace this default with user subscription lookup once personal plans are wired.
  // TODO: Return free/plus/pro/agent based on the user's active subscription tier.
  return "free";
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
