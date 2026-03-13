import Anthropic from "@anthropic-ai/sdk";
import pool from "../db/pg.js";
import { getSystemPrompt, getGuestSystemPrompt } from "./kai-prompts.js";
import { getToolDefinitionsForTier } from "./kai-tool-definitions.js";
import { executeToolCall } from "./kai-tool-executor.js";
import { determineKaiTier, getModelForTier } from "../middleware/kai-tier.js";

const anthropic = new Anthropic();

const MAX_HISTORY_MESSAGES = 40;
const MAX_LOOPS = 10;
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

function enrichMessageForClaude(userMessage) {
  const lower = userMessage.toLowerCase();
  const hints = [];

  if (/\b(my profile|my stats|my rating|my score|about me|my account|my info|show me my)\b/.test(lower)) {
    hints.push('Use the get_user_profile tool to retrieve the user\'s full profile data.');
  }
  if (/\b(my balance|my credits|my ic|impact credits|how many credits|how much.*earned)\b/.test(lower)) {
    hints.push('Use the get_ic_balance tool to retrieve the user\'s IC balance.');
  }
  if (/\b(events?|opportunities|volunteer.*near|what.*coming up|find.*volunteer|search)\b/.test(lower)) {
    hints.push('Use the search_events tool to find events.');
  }
  if (/\b(rsvp|sign me up|register me|sign up for)\b/.test(lower)) {
    hints.push('Use the rsvp_to_event tool for this request.');
  }
  if (/\b(cancel.*rsvp|cancel.*registration|withdraw|pull out)\b/.test(lower)) {
    hints.push('Use the cancel_rsvp tool for this request.');
  }
  if (/\b(my schedule|my upcoming|my events|what.*signed up|my rsvp)\b/.test(lower)) {
    hints.push('Use the manage_schedule tool to check the user\'s schedule.');
  }
  if (/\b(how does|how do|what is|what are|explain|tell me about.*platform|tell me about.*ic|tell me about.*credit|tell me about.*reliab)\b/.test(lower)) {
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
    let resolvedTier = isGuest ? "guest" : tier;
    let messages = [];

    if (!isGuest) {
      user = await getUserRow(userId);
      if (!resolvedTier) {
        resolvedTier = determineKaiTier(user);
      }

      resolvedConversationId = await resolveConversationIdForUser(userId, conversationId);
      const historyRows = await loadConversationRows(resolvedConversationId);
      messages = rowsToClaudeMessages(historyRows);

      await saveUserMessage(resolvedConversationId, rawUserMessage);
    } else {
      resolvedTier = "guest";
      resolvedConversationId = null;
    }

    messages.push({ role: "user", content: enrichMessageForClaude(rawUserMessage) });
    messages = groupConsecutiveRoles(messages);

    const systemPrompt = isGuest
      ? getGuestSystemPrompt()
      : getSystemPrompt(resolvedTier, user);

    const toolDefinitions =
      resolvedTier === "guest" ? [] : getToolDefinitionsForTier(resolvedTier);
    const model = getModelForTier(resolvedTier);

    let response;
    let loopCount = 0;
    let structuredEvents = null;

    do {
      try {
        response = await anthropic.messages.create({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages,
          tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
        });
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
        const result = await executeToolCall(toolUse.name, toolUse.input, userId ?? null);
        if (toolUse.name === "search_events" && result && typeof result === "object") {
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

    if (!isGuest && resolvedConversationId) {
      await saveAssistantMessage(resolvedConversationId, finalText, response?.usage);
      await touchConversation(resolvedConversationId);
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
