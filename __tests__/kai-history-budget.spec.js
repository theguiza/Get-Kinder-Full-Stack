import test from "node:test";
import assert from "node:assert/strict";
import pool from "../Backend/db/pg.js";
import { handleKaiMessage, __testables as kaiServiceTestables } from "../Backend/services/kai.js";

function buildHistoryRow(index, role) {
  const marker = `history-${index}-${role}`;
  return {
    role,
    content: `${marker} ${"x".repeat(50000)}`,
    tool_use_id: null,
    tool_name: null,
    tool_input: null,
    tool_output: null,
    created_at: new Date(Date.now() + index * 1000),
  };
}

test("handleKaiMessage trims oversized stored history before the Anthropic call", async () => {
  const originalQuery = pool.query;
  const capturedPayloads = [];

  pool.query = async (rawSql, params = []) => {
    const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
    const trimmed = sql.trim();

    if (trimmed === "SELECT * FROM userdata WHERE id = $1 LIMIT 1") {
      return { rows: [{ id: params[0], role: "volunteer" }], rowCount: 1 };
    }

    if (trimmed === "SELECT id FROM kai_conversations WHERE id = $1 AND user_id = $2 LIMIT 1") {
      return { rows: [{ id: params[0] }], rowCount: 1 };
    }

    if (
      trimmed.includes("SELECT role, content, tool_use_id, tool_name, tool_input, tool_output, created_at") &&
      trimmed.includes("FROM kai_messages") &&
      trimmed.includes("ORDER BY created_at ASC")
    ) {
      const rows = Array.from({ length: 60 }, (_, index) =>
        buildHistoryRow(index, index % 2 === 0 ? "user" : "assistant")
      );
      return { rows, rowCount: rows.length };
    }

    if (trimmed.startsWith("INSERT INTO kai_messages")) {
      return { rows: [], rowCount: 1 };
    }

    if (trimmed === "UPDATE kai_conversations SET last_msg_at = NOW() WHERE id = $1") {
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled kai history budget query: ${trimmed}`);
  };

  kaiServiceTestables.setAnthropicCreateForTests(async (payload) => {
    capturedPayloads.push(payload);
    return {
      content: [{ type: "text", text: "Trimmed history ok." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });

  try {
    const result = await handleKaiMessage({
      userId: 42,
      userMessage: "What should I do next?",
      conversationId: "conv-1",
      tier: "pro",
    });

    assert.equal(result.error, undefined);
    assert.equal(capturedPayloads.length, 1);

    const payload = capturedPayloads[0];
    const estimatedTokens = payload.messages.reduce(
      (sum, message) => sum + kaiServiceTestables.estimateMessageTokens(message),
      0,
    );
    assert.ok(estimatedTokens <= kaiServiceTestables.MAX_REQUEST_CONTEXT_TOKENS);

    const serialized = JSON.stringify(payload.messages);
    assert.match(serialized, /history-59-assistant/);
    assert.doesNotMatch(serialized, /history-0-user/);
  } finally {
    pool.query = originalQuery;
    kaiServiceTestables.resetAnthropicCreateForTests();
  }
});
