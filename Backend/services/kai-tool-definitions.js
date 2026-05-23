import { getAvailableTools } from "../middleware/kai-tier.js";

export const TOOL_DEFINITIONS = {
  platform_faq: {
    name: "platform_faq",
    description:
      "Look up platform info such as how IC works, subscription tiers, verification, ratings, and reliability.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string" },
      },
      required: ["topic"],
      additionalProperties: false,
    },
  },
  get_reporting_readiness_info: {
    name: "get_reporting_readiness_info",
    description:
      "Get grounded information about Get Kinder's Impact Reporting & Data Readiness Assessment, including fit, materials to prepare, privacy expectations, and next steps.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: [
            "overview",
            "fit",
            "materials",
            "privacy",
            "next_steps",
            "data_readiness",
          ],
          default: "overview",
        },
      },
      additionalProperties: false,
    },
  },
  assess_reporting_readiness_question: {
    name: "assess_reporting_readiness_question",
    description:
      "Give read-only guidance for a nonprofit's reporting-readiness question. Use this for questions about reporting burden, data gaps, outcomes, funder expectations, privacy, assessment fit, or materials to prepare.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        reporting_challenges: { type: "array", items: { type: "string" } },
        data_locations: { type: "array", items: { type: "string" } },
        upcoming_deadline: { type: "string" },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  search_events: {
    name: "search_events",
    description: "Search upcoming published volunteer events.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        category: { type: "string" },
        cause_tags: { type: "array", items: { type: "string" } },
        days_ahead: { type: "integer", default: 14 },
        limit: { type: "integer", default: 5 },
      },
      additionalProperties: false,
    },
  },
  get_event_details: {
    name: "get_event_details",
    description: "Get full details for a specific event including roles, RSVP counts, and requirements.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
  },
  get_user_profile: {
    name: "get_user_profile",
    description:
      "Get the current user's full profile summary from the database. This provides data NOT available in conversation context: Impact Credits balance, average volunteer rating, total events attended, upcoming confirmed RSVPs with dates, and reliability score details. Always call this tool when the user asks about their profile, stats, balance, rating, or activity history.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  get_ic_balance: {
    name: "get_ic_balance",
    description: "Get user's IC balance and recent transactions.",
    input_schema: {
      type: "object",
      properties: {
        include_history: { type: "boolean", default: false },
        history_limit: { type: "integer", default: 5 },
      },
      additionalProperties: false,
    },
  },
  get_matched_events: {
    name: "get_matched_events",
    description:
      "Rank the best upcoming events for the current volunteer using saved interests, recent volunteering history, location text, timing, capacity, and existing RSVP state. If personal signals are weak, fall back honestly to broader upcoming suggestions.",
    input_schema: {
      type: "object",
      properties: {
        days_ahead: { type: "integer", default: 14 },
        limit: { type: "integer", default: 5 },
        min_score: { type: "number", default: 30 },
      },
      additionalProperties: false,
    },
  },
  get_weekly_digest: {
    name: "get_weekly_digest",
    description: "Generate a personalized weekly opportunity digest.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  rsvp_to_event: {
    name: "rsvp_to_event",
    description: "RSVP user to an event, optionally for a specific role. ALWAYS confirm with the user before calling this.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        role_id: { type: "string" },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
  },
  cancel_rsvp: {
    name: "cancel_rsvp",
    description: "Cancel an RSVP. Warning: cancelling within 48 hours may impact reliability.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
  },
  get_earning_optimization: {
    name: "get_earning_optimization",
    description: "Analyze earning patterns and suggest how to maximize IC.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  manage_schedule: {
    name: "manage_schedule",
    description: "View upcoming volunteer schedule and check conflicts.",
    input_schema: {
      type: "object",
      properties: {
        days_ahead: { type: "integer", default: 30 },
      },
      additionalProperties: false,
    },
  },
  auto_find_and_rsvp: {
    name: "auto_find_and_rsvp",
    description: "Autonomous: find the best match and RSVP in one action.",
    input_schema: {
      type: "object",
      properties: {
        preferences: { type: "string" },
        max_distance_km: { type: "number" },
        date_range_days: { type: "integer", default: 7 },
      },
      additionalProperties: false,
    },
  },
  draft_event_listing: {
    name: "draft_event_listing",
    description: "Create an event listing from natural language.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string" },
        date: { type: "string" },
        location: { type: "string" },
        roles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              spots_needed: { type: "integer" },
              description: { type: "string" },
            },
            required: ["title", "spots_needed"],
            additionalProperties: false,
          },
          minItems: 1,
        },
      },
      required: ["description", "date", "roles"],
      additionalProperties: false,
    },
  },
  get_matched_volunteers: {
    name: "get_matched_volunteers",
    description: "Find and rank best volunteers for an event or role.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        role_id: { type: "string" },
        limit: { type: "integer", default: 20 },
        min_reliability: {
          type: "string",
          enum: ["any", "standard", "high", "super"],
          default: "standard",
        },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
  },
  flag_noshow_risk: {
    name: "flag_noshow_risk",
    description: "Flag RSVPed volunteers with high no-show risk.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
  },
  send_volunteer_reminder: {
    name: "send_volunteer_reminder",
    description: "Send reminder messages to RSVPed volunteers.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        message: { type: "string" },
        volunteer_ids: { type: "array", items: { type: "integer" } },
      },
      required: ["event_id", "message"],
      additionalProperties: false,
    },
  },
  auto_staff_event: {
    name: "auto_staff_event",
    description: "Autonomous: match, invite, and manage volunteers for an event.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        strategy: {
          type: "string",
          enum: ["conservative", "balanced", "aggressive"],
          default: "balanced",
        },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
  },
  generate_post_event_report: {
    name: "generate_post_event_report",
    description: "Generate an attendance and impact report for an event.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
  },
};

export function getToolDefinitionsForTier(tier) {
  const toolNames = getAvailableTools(tier);
  return toolNames.map((toolName) => TOOL_DEFINITIONS[toolName]).filter(Boolean);
}

export function getToolDefinitionsForKaiContext(tier, { surface = "default" } = {}) {
  if (surface === "reporting_readiness") {
    return [
      "platform_faq",
      "get_reporting_readiness_info",
      "assess_reporting_readiness_question",
    ].map((toolName) => TOOL_DEFINITIONS[toolName]).filter(Boolean);
  }

  return getToolDefinitionsForTier(tier);
}
