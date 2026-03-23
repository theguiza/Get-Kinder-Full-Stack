import Anthropic from "@anthropic-ai/sdk";
import pool from "../db/pg.js";
import { getSystemPrompt, getGuestSystemPrompt, getOrgSystemPrompt } from "./kai-prompts.js";
import { getToolDefinitionsForTier } from "./kai-tool-definitions.js";
import { executeToolCall } from "./kai-tool-executor.js";
import { determineKaiTier, getModelForTier } from "../middleware/kai-tier.js";

const anthropic = new Anthropic();
const GUEST_TOOL_ALLOWLIST = new Set(["search_events"]);
let anthropicCreateImpl = (payload) => anthropic.messages.create(payload);

const MAX_HISTORY_MESSAGES = 40;
const MAX_LOOPS = 10;
const MAX_REQUEST_CONTEXT_TOKENS = 80000;
const MAX_TEXT_BLOCK_CHARS = 12000;
const MAX_TOOL_RESULT_BLOCK_CHARS = 16000;
const MAX_TOOL_INPUT_JSON_CHARS = 4000;
const ANTHROPIC_FAILURE_MESSAGE =
  "I'm having trouble connecting right now. Please try again in a moment.";

function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toContentBlocks(content) {
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (content && typeof content === "object" && typeof content.type === "string") return [content];
  if (content === null || content === undefined) return [];
  return [{ type: "text", text: String(content) }];
}

function groupConsecutiveRoles(messages = []) {
  const grouped = [];

  for (const message of messages) {
    const role = message?.role;
    const contentBlocks = toContentBlocks(message?.content);
    if (!role || contentBlocks.length === 0) continue;

    const previous = grouped[grouped.length - 1];
    if (previous && previous.role === role) {
      previous.content = [...toContentBlocks(previous.content), ...contentBlocks];
    } else {
      grouped.push({ role, content: contentBlocks });
    }
  }

  return grouped;
}

function safeJsonStringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function truncateMiddleText(value, maxChars) {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (!maxChars || text.length <= maxChars) return text;
  if (maxChars <= 32) return text.slice(0, maxChars);
  const marker = "\n...[truncated]...\n";
  const remaining = maxChars - marker.length;
  const head = Math.ceil(remaining * 0.7);
  const tail = Math.max(0, remaining - head);
  return text.slice(0, head) + marker + text.slice(text.length - tail);
}

function compactContentBlockForAnthropic(block) {
  if (!block || typeof block !== "object") return block;

  if (block.type === "text") {
    return {
      ...block,
      text: truncateMiddleText(block.text ?? "", MAX_TEXT_BLOCK_CHARS),
    };
  }

  if (block.type === "tool_result") {
    const content = typeof block.content === "string"
      ? block.content
      : safeJsonStringify(block.content, "[]");
    return {
      ...block,
      content: truncateMiddleText(content, MAX_TOOL_RESULT_BLOCK_CHARS),
    };
  }

  if (block.type === "tool_use") {
    const inputJson = safeJsonStringify(block.input ?? {}, "{}");
    if (inputJson.length <= MAX_TOOL_INPUT_JSON_CHARS) {
      return block;
    }
    return {
      ...block,
      input: {
        _truncated: true,
        preview: truncateMiddleText(inputJson, MAX_TOOL_INPUT_JSON_CHARS),
      },
    };
  }

  return block;
}

function compactMessageForAnthropic(message) {
  if (!message || typeof message !== "object") return message;
  const content = Array.isArray(message.content)
    ? message.content.map(compactContentBlockForAnthropic)
    : truncateMiddleText(message.content ?? "", MAX_TEXT_BLOCK_CHARS);
  return {
    ...message,
    content,
  };
}

function estimateContentTokens(content) {
  if (Array.isArray(content)) {
    return content.reduce((sum, block) => sum + estimateContentTokens(block), 0);
  }
  if (content && typeof content === "object") {
    return Math.ceil(safeJsonStringify(content, "{}").length / 4);
  }
  return Math.ceil(String(content ?? "").length / 4);
}

function estimateMessageTokens(message) {
  if (!message) return 0;
  return estimateContentTokens(message.content) + 12;
}

function prepareMessagesForAnthropic(messages = []) {
  const grouped = groupConsecutiveRoles(messages);
  const compacted = grouped.map(compactMessageForAnthropic);
  const limited = compacted.length > MAX_HISTORY_MESSAGES
    ? compacted.slice(-MAX_HISTORY_MESSAGES)
    : compacted;

  const kept = [];
  let tokenCount = 0;
  for (let index = limited.length - 1; index >= 0; index -= 1) {
    const message = limited[index];
    const nextTokens = estimateMessageTokens(message);
    if (kept.length > 0 && tokenCount + nextTokens > MAX_REQUEST_CONTEXT_TOKENS) {
      continue;
    }
    kept.unshift(message);
    tokenCount += nextTokens;
  }

  if (kept.length === 0 && limited.length > 0) {
    return [limited[limited.length - 1]];
  }
  return kept;
}

function rowsToClaudeMessages(rows = []) {
  const mapped = rows.map((row) => {
    if (row.role === "tool_use") {
      return {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: row.tool_use_id || `tool_use_${row.created_at?.getTime?.() || Date.now()}`,
            name: row.tool_name || "unknown_tool",
            input: safeJsonParse(row.tool_input, {}),
          },
        ],
      };
    }

    if (row.role === "tool_result") {
      const outputValue = row.tool_output !== null && row.tool_output !== undefined
        ? row.tool_output
        : safeJsonParse(row.content, row.content ?? {});
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: row.tool_use_id,
            content: JSON.stringify(outputValue ?? {}),
          },
        ],
      };
    }

    const role = row.role === "assistant" ? "assistant" : "user";
    return {
      role,
      content: row.content || "",
    };
  });

  const limited = mapped.length > MAX_HISTORY_MESSAGES ? mapped.slice(-MAX_HISTORY_MESSAGES) : mapped;
  return groupConsecutiveRoles(limited);
}

async function getUserRow(userId) {
  if (!userId) return null;
  const { rows } = await pool.query("SELECT * FROM userdata WHERE id = $1 LIMIT 1", [userId]);
  return rows?.[0] || null;
}

async function getOrgContextForUser(userId) {
  if (!userId) return null;
  const { rows } = await pool.query(
    `
      SELECT o.id, o.name
      FROM organizations o
      JOIN userdata u ON u.org_id = o.id
      WHERE u.id = $1
      LIMIT 1
    `,
    [userId]
  );
  const orgRow = rows?.[0];
  if (!orgRow) return null;
  return {
    orgId: orgRow.id,
    orgName: orgRow.name,
  };
}

async function resolveConversationIdForUser(userId, conversationId) {
  if (conversationId) {
    const { rows } = await pool.query(
      "SELECT id FROM kai_conversations WHERE id = $1 AND user_id = $2 LIMIT 1",
      [conversationId, userId]
    );
    if (rows?.[0]?.id) return rows[0].id;
  }

  const insertResult = await pool.query(
    "INSERT INTO kai_conversations (user_id, last_msg_at) VALUES ($1, NOW()) RETURNING id",
    [userId]
  );
  return insertResult.rows?.[0]?.id || null;
}

async function loadConversationRows(conversationId) {
  const { rows } = await pool.query(
    `
      SELECT role, content, tool_use_id, tool_name, tool_input, tool_output, created_at
      FROM kai_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
    `,
    [conversationId]
  );
  return rows || [];
}

async function getMostRecentSummaryForUser(userId) {
  if (!userId) return null;
  const { rows } = await pool.query(
    `
      SELECT summary
      FROM kai_conversations
      WHERE user_id = $1
        AND summary IS NOT NULL
        AND summary != ''
      ORDER BY last_msg_at DESC
      LIMIT 1
    `,
    [userId]
  );
  return rows?.[0]?.summary || null;
}

async function saveConversationSummary(conversationId, summary) {
  if (!conversationId) return;
  await pool.query(
    `
      UPDATE kai_conversations
      SET summary = $1
      WHERE id = $2
    `,
    [summary, conversationId]
  );
}

async function saveUserMessage(conversationId, content) {
  await pool.query(
    "INSERT INTO kai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)",
    [conversationId, content]
  );
}

async function saveToolUseMessage(conversationId, toolUseBlock) {
  await pool.query(
    `
      INSERT INTO kai_messages (conversation_id, role, tool_use_id, tool_name, tool_input)
      VALUES ($1, 'tool_use', $2, $3, $4::jsonb)
    `,
    [
      conversationId,
      toolUseBlock.id,
      toolUseBlock.name,
      JSON.stringify(toolUseBlock.input ?? {}),
    ]
  );
}

async function saveToolResultMessage(conversationId, toolUseBlock, result) {
  await pool.query(
    `
      INSERT INTO kai_messages (conversation_id, role, tool_use_id, tool_name, tool_output, content)
      VALUES ($1, 'tool_result', $2, $3, $4::jsonb, $5)
    `,
    [
      conversationId,
      toolUseBlock.id,
      toolUseBlock.name,
      JSON.stringify(result ?? {}),
      JSON.stringify(result ?? {}),
    ]
  );
}

async function saveAssistantMessage(conversationId, content, usage) {
  await pool.query(
    `
      INSERT INTO kai_messages (conversation_id, role, content, tokens_in, tokens_out)
      VALUES ($1, 'assistant', $2, $3, $4)
    `,
    [
      conversationId,
      content,
      usage?.input_tokens ?? null,
      usage?.output_tokens ?? null,
    ]
  );
}

async function touchConversation(conversationId) {
  await pool.query("UPDATE kai_conversations SET last_msg_at = NOW() WHERE id = $1", [conversationId]);
}

function extractFinalText(response) {
  const textBlocks = (response?.content || [])
    .filter((block) => block?.type === "text")
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .filter(Boolean);
  return textBlocks.join("\n").trim();
}

async function generateAndSaveSummary(conversationId, userId, messages) {
  if (!conversationId || !userId || !Array.isArray(messages) || messages.length < 6) return;

  const textOnlyMessages = messages
    .map((msg) => {
      if (typeof msg.content === "string") return msg;
      if (Array.isArray(msg.content)) {
        const textParts = msg.content.filter((block) => block.type === "text");
        if (textParts.length === 0) return null;
        return { role: msg.role, content: textParts };
      }
      return null;
    })
    .filter(Boolean);

  if (textOnlyMessages.length < 4) return;

  try {
    const response = await anthropicCreateImpl({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: [
        "Summarize this KAI conversation in 3-5 sentences.",
        "Focus on: what the user was trying to do, what actions were taken,",
        "and any unresolved items. Be specific about event names, org names,",
        "or volunteer roles if they appeared. Keep it under 120 words.",
      ].join(" "),
      messages: textOnlyMessages,
    });
    const summary = extractFinalText(response);
    if (!summary) return;
    await saveConversationSummary(conversationId, summary);
  } catch (error) {
    console.error("[kai] generateAndSaveSummary error:", error);
  }
}

function countPatternMatches(text, patterns = []) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function selectDiscoveryToolHint(userMessage, allowedTools = new Set()) {
  const lower = normalizeStringForRouting(userMessage);
  if (!lower) return null;

  const allowMatched = allowedTools.has("get_matched_events");
  const allowSearch = allowedTools.has("search_events");
  if (!allowMatched && !allowSearch) return null;

  const recommendationPatterns = [
    /\b(recommend|recommendation|recommended)\b/,
    /\b(best events?|best opportunities|best fit)\b/,
    /\b(events? for me|opportunities for me|match me)\b/,
    /\b(personalized|tailored)\b/,
    /\b(what should i do|where should i help|what should i volunteer for)\b/,
  ];
  const explicitSearchPatterns = [
    /\b(find|search|show|list|browse|look for)\b/,
    /\b(near me|nearby|in [a-z])/,
    /\b(this weekend|this week|today|tomorrow|tonight)\b/,
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
    /\b(cause|category|city|location|date)\b/,
  ];

  const recommendationCount = countPatternMatches(lower, recommendationPatterns);
  const explicitSearchCount = countPatternMatches(lower, explicitSearchPatterns);

  if (allowMatched && recommendationCount > 0 && explicitSearchCount === 0) {
    return {
      toolName: "get_matched_events",
      instruction:
        "Use the get_matched_events tool for a personalized recommendation. If the tool says personalization is weak, say that plainly and present the results as broader upcoming suggestions.",
    };
  }

  if (allowSearch && explicitSearchCount > 0) {
    return {
      toolName: "search_events",
      instruction:
        "Use the search_events tool for explicit discovery by cause, city, date, or general browsing filters.",
    };
  }

  if (allowMatched && recommendationCount > 0) {
    return {
      toolName: "get_matched_events",
      instruction:
        "Use the get_matched_events tool for an explainable recommendation, and stay honest if the result is only lightly personalized.",
    };
  }

  return null;
}

function normalizeStringForRouting(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function enrichMessageForClaude(userMessage, tier = null) {
  const lower = normalizeStringForRouting(userMessage);
  const hints = [];
  const allowedTools = new Set(getToolDefinitionsForTier(tier || "guest").map((tool) => tool?.name).filter(Boolean));
  const allow = (toolName) => allowedTools.has(toolName);
  const discoveryHint = selectDiscoveryToolHint(userMessage, allowedTools);

  if (discoveryHint) {
    hints.push(discoveryHint.instruction);
  }

  if (allow("get_user_profile") && /\b(my profile|my stats|my rating|my score|about me|my account|my info|show me my)\b/.test(lower)) {
    hints.push('Use the get_user_profile tool to retrieve the user\'s full profile data.');
  }
  if (allow("get_ic_balance") && /\b(my balance|my credits|my ic|impact credits|how many credits|how much.*earned)\b/.test(lower)) {
    hints.push('Use the get_ic_balance tool to retrieve the user\'s IC balance.');
  }
  if (!discoveryHint && allow("search_events") && /\b(events?|opportunities|volunteer.*near|what.*coming up|find.*volunteer|search)\b/.test(lower)) {
    hints.push('Use the search_events tool to find events.');
  }
  if (!discoveryHint && allow("get_matched_events") && /\b(recommend|recommendation|matched|match me|best events|best opportunities|events for me|personalized)\b/.test(lower)) {
    hints.push('Use the get_matched_events tool to rank the best-fit events for this user.');
  }
  if (allow("rsvp_to_event") && /\b(rsvp|sign me up|register me|sign up for)\b/.test(lower)) {
    hints.push('Use the rsvp_to_event tool for this request.');
  }
  if (allow("cancel_rsvp") && /\b(cancel.*rsvp|cancel.*registration|withdraw|pull out)\b/.test(lower)) {
    hints.push('Use the cancel_rsvp tool for this request.');
  }
  if (allow("manage_schedule") && /\b(my schedule|my upcoming|my events|what.*signed up|my rsvp)\b/.test(lower)) {
    hints.push('Use the manage_schedule tool to check the user\'s schedule.');
  }
  if (allow("platform_faq") && /\b(how does|how do|what is|what are|explain|tell me about.*platform|tell me about.*ic|tell me about.*credit|tell me about.*reliab)\b/.test(lower)) {
    hints.push('Use the platform_faq tool to answer platform questions.');
  }

  if (hints.length === 0) return userMessage;
  return userMessage + '\n\n[System instruction: ' + hints.join(' ') + ']';
}

export async function handleKaiMessage({ userId, userMessage, conversationId, tier } = {}) {
  let resolvedConversationId = conversationId || null;

  try {
    const rawUserMessage = typeof userMessage === "string" ? userMessage : "";
    const normalizedUserMessage = rawUserMessage.trim();
    if (!normalizedUserMessage) {
      return {
        message: "Please share a message so I can help.",
        conversationId: resolvedConversationId,
        error: true,
      };
    }

    const isGuest = userId === null || userId === undefined;
    let user = null;
    let orgContext = null;
    let resolvedTier = isGuest ? "guest" : tier;
    let messages = [];
    let isNewConversation = false;

    if (!isGuest) {
      user = await getUserRow(userId);
      if (user?.org_rep === true) {
        orgContext = await getOrgContextForUser(userId);
      }
      if (!resolvedTier) {
        resolvedTier = determineKaiTier(user);
      }

      let existingConversationId = null;
      if (conversationId) {
        const { rows } = await pool.query(
          "SELECT id FROM kai_conversations WHERE id = $1 AND user_id = $2 LIMIT 1",
          [conversationId, userId]
        );
        existingConversationId = rows?.[0]?.id || null;
      }

      resolvedConversationId = await resolveConversationIdForUser(userId, conversationId);
      isNewConversation = Boolean(resolvedConversationId) && !existingConversationId;
      const historyRows = await loadConversationRows(resolvedConversationId);
      messages = rowsToClaudeMessages(historyRows);

      await saveUserMessage(resolvedConversationId, rawUserMessage);
    } else {
      resolvedTier = "guest";
      resolvedConversationId = null;
    }

    messages.push({ role: "user", content: enrichMessageForClaude(rawUserMessage, resolvedTier) });
    messages = groupConsecutiveRoles(messages);

    const isOrgRep = user?.org_rep === true;
    let systemPrompt = isGuest
      ? getGuestSystemPrompt()
      : resolvedTier === "org_growth" || resolvedTier === "org_enterprise" || (resolvedTier === "agent" && isOrgRep)
        ? getOrgSystemPrompt(resolvedTier, user, orgContext)
        : getSystemPrompt(resolvedTier, user);
    if (!isGuest && isNewConversation) {
      const previousSummary = await getMostRecentSummaryForUser(userId);
      if (previousSummary) {
        systemPrompt +=
          "\n\nPrevious session context (do not repeat this to the user unless asked):\n" + previousSummary;
      }
    }

    const toolDefinitions = getToolDefinitionsForTier(resolvedTier).filter(
      (tool) => resolvedTier !== "guest" || GUEST_TOOL_ALLOWLIST.has(tool?.name)
    );
    const model = getModelForTier(resolvedTier);

    let response;
    let loopCount = 0;
    let structuredEvents = null;

    do {
      messages = prepareMessagesForAnthropic(messages);

      try {
        const requestPayload = {
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages,
          tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
        };
        let lastError = null;

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            response = await anthropicCreateImpl(requestPayload);
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            const status = error?.status;
            const shouldRetry =
              status === 529 || status === 500 || status === 502 || status === 503 || status === 504;

            if (!shouldRetry || attempt === 3) break;

            const delayMs = attempt === 1 ? 1000 : 2000;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }

        if (lastError) throw lastError;
      } catch (error) {
        error._kaiSource = "anthropic";
        throw error;
      }

      const toolUseBlocks = (response.content || []).filter((block) => block.type === "tool_use");
      if (toolUseBlocks.length === 0) break;

      if (!isGuest && resolvedConversationId) {
        for (const toolUseBlock of toolUseBlocks) {
          await saveToolUseMessage(resolvedConversationId, toolUseBlock);
        }
      }

      messages.push({ role: "assistant", content: response.content });
      messages = groupConsecutiveRoles(messages);

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executeToolCall(
          toolUse.name,
          toolUse.input,
          userId ?? null,
          orgContext?.orgId ?? null
        );
        if ((toolUse.name === "search_events" || toolUse.name === "get_matched_events") && result && typeof result === "object") {
          structuredEvents = result;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });

        if (!isGuest && resolvedConversationId) {
          await saveToolResultMessage(resolvedConversationId, toolUse, result);
        }
      }

      messages.push({ role: "user", content: toolResults });
      messages = groupConsecutiveRoles(messages);
      loopCount += 1;
    } while (response.stop_reason === "tool_use" && loopCount < MAX_LOOPS);

    const finalText = extractFinalText(response) || "I'm here and ready to help with your next step.";
    messages.push({ role: "assistant", content: response?.content || finalText });
    messages = groupConsecutiveRoles(messages);

    if (!isGuest && resolvedConversationId) {
      await saveAssistantMessage(resolvedConversationId, finalText, response?.usage);
      await touchConversation(resolvedConversationId);
      void generateAndSaveSummary(resolvedConversationId, userId, messages);
    }

    return {
      message: finalText,
      conversationId: resolvedConversationId,
      tokensUsed: response?.usage || null,
      structuredEvents,
    };
  } catch (error) {
    if (error?._kaiSource === "anthropic") {
      console.error("[kai] Anthropic API error:", error);
    } else {
      console.error("[kai] Database or service error:", error);
    }

    return {
      message: ANTHROPIC_FAILURE_MESSAGE,
      conversationId: resolvedConversationId,
      error: true,
    };
  }
}

export const __testables = {
  MAX_REQUEST_CONTEXT_TOKENS,
  estimateMessageTokens,
  prepareMessagesForAnthropic,
  selectDiscoveryToolHint,
  setAnthropicCreateForTests(fn) {
    anthropicCreateImpl = typeof fn === "function" ? fn : anthropicCreateImpl;
  },
  resetAnthropicCreateForTests() {
    anthropicCreateImpl = (payload) => anthropic.messages.create(payload);
  },
};

export async function getConversationHistory(conversationId, userId) {
  if (!conversationId || !userId) return [];

  try {
    const { rows: conversationRows } = await pool.query(
      "SELECT id FROM kai_conversations WHERE id = $1 AND user_id = $2 LIMIT 1",
      [conversationId, userId]
    );
    if (!conversationRows?.[0]?.id) return [];

    const { rows } = await pool.query(
      `
        SELECT role, content, tool_name, tool_input, tool_output, created_at
        FROM kai_messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC
      `,
      [conversationId]
    );

    return (rows || []).map((row) => {
      let content = row.content;
      if (row.role === "tool_use") {
        content = row.tool_input ?? row.content;
      } else if (row.role === "tool_result") {
        content = row.tool_output ?? row.content;
      }

      return {
        role: row.role,
        content,
        toolName: row.tool_name || null,
        createdAt: row.created_at,
      };
    });
  } catch (error) {
    console.error("[kai] getConversationHistory error:", error);
    return [];
  }
}

export async function generateConversationSummary(_conversationId) {
  // TODO: Summarize conversation with Claude for cross-session memory.
  return null;
}
