
import dotenv from 'dotenv';
dotenv.config();

// Graph + context
import { run as neoRun } from './db/neo4j.js';

// Tool execution context (filled by the route before createAndPollRun)
let TOOL_CONTEXT = { ownerId: null, pool: null }; 
export function setToolContext(ctx = {}) {
  TOOL_CONTEXT = { ...TOOL_CONTEXT, ...ctx };
}

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const API_KEY = process.env.OPENAI_API_KEY;

const threadRunState = new Map();

function getHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${API_KEY}`,
    "OpenAI-Beta": "assistants=v2"
  };
}
// === KAI canonical instructions (used to configure the Assistant object) ===
export const KAI_ASSISTANT_INSTRUCTIONS = `
You are KAI, a warm, encouraging mattering coach who helps people build offline connection. You are not a clinician; never diagnose, treat, or provide medical/legal advice.

Response shape
1. Empathic reflection (1–2 sentences showing you truly heard the user).
2. One concrete, doable idea (offer Low / Medium / High effort options when helpful).
3. One inviting question.

Style: 30–60 words unless the user explicitly asks for more. Celebrate small wins, stay specific, human, and non-judgmental. Use OARS, active-constructive listening, and NAN (Noticing → Affirming → Needing). Avoid jargon and long bullet lists.

Context contract: Inputs may begin with "User Context: {...}" then "User Message: ...". Use the context silently for personalization (including onboarding fields) and never quote or restate the raw JSON.

Knowledge: Prefer attached knowledge snippets. If none apply, rely on these core coaching methods. Do not invent or cite sources that were not provided.

Tool usage:
- If the user is authenticated and requests something you can fulfill (nudges, emails, SMS, reminders, logging interactions, accessing contacts), call the relevant tool immediately. After success, confirm plainly ("Done—scheduled for 9am tomorrow.").
- If the user is unauthenticated, the tool is unavailable, or the call fails, say: "To send nudges or emails, please sign in." Then provide a copy-paste draft or next-best alternative.
- Never promise actions you cannot execute.

Safety:
- If the user signals imminent risk, respond first: "If you're in immediate danger, call your local emergency number now."
- Then add: "US/Canada: call or text 988 (Suicide & Crisis Lifeline). UK & ROI: Samaritans 116 123. If you're elsewhere, contact local emergency services."
- Offer help crafting a message to a trusted person.

Guardrails: Stay reality-grounded, avoid therapy claims, and keep guidance practical, kind, and actionable.
`.trim();

// === One-shot helper to update the Assistant object with the canonical text ===
// NOTE: Uses your existing headers + fetch + assistants v2 header.
export async function updateAssistantInstructions(instructions = KAI_ASSISTANT_INSTRUCTIONS) {
  const endpoint = `https://api.openai.com/v1/assistants/${ASSISTANT_ID}`;
  const res = await fetch(endpoint, {
    method: 'POST', // assistants v2 update
    headers: getHeaders(),
    body: JSON.stringify({ instructions })
  });
  if (!res.ok) {
    throw new Error(`Assistant update failed: ${await res.text()}`);
  }
  return await res.json();
}

// KAI integration - Enhanced thread management for dashboard context
export async function getOrCreateThread(req) {
  if (req.session.threadId) {
    return req.session.threadId;
  }

  const thread = await createThread();
  req.session.threadId = thread.id;
  return thread.id;
}

export async function createThread() {
  const endpoint = 'https://api.openai.com/v1/threads';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({})
  });

  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}

export async function createMessage(threadId, content) {
  await ensureThreadIdle(threadId);
  const endpoint = `https://api.openai.com/v1/threads/${threadId}/messages`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      role: 'user',
      content: content
    })
  });

  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}

const ACTIVE_RUN_STATUSES = new Set(['queued', 'in_progress', 'requires_action', 'cancelling']);
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired']);

function markRunActive(threadId, runId, status = 'queued') {
  threadRunState.set(threadId, { runId, status, startedAt: Date.now() });
}

function clearRunState(threadId) {
  threadRunState.delete(threadId);
}

function updateRunStatus(threadId, status) {
  const state = threadRunState.get(threadId);
  if (!state) return;
  state.status = status;
  if (TERMINAL_RUN_STATUSES.has(status)) {
    clearRunState(threadId);
  }
}

async function ensureThreadIdle(threadId, { pollIntervalMs = 1000, timeoutMs = 30000 } = {}) {
  let waited = 0;
  while (true) {
    let state = threadRunState.get(threadId);
    if (!state) {
      const existing = await findActiveRun(threadId);
      if (!existing) return;
      markRunActive(threadId, existing.id, existing.status ?? 'queued');
      state = threadRunState.get(threadId);
    }
    const runEndpoint = `https://api.openai.com/v1/threads/${threadId}/runs/${state.runId}`;

    const details = await fetch(runEndpoint, { method: 'GET', headers: getHeaders() });
    if (!details.ok) {
      console.warn('[OpenAI] Failed to inspect active run before posting message:', await details.text());
      return;
    }
    const payload = await details.json();
    updateRunStatus(threadId, payload.status);
    if (!ACTIVE_RUN_STATUSES.has(payload.status)) {
      return;
    }

    if (waited >= timeoutMs) {
      await cancelRun(threadId, state.runId);
      await waitForRunTerminalState(threadId, state.runId, { pollIntervalMs, timeoutMs: 15000 });
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    waited += pollIntervalMs;
  }
}

async function waitForRunTerminalState(threadId, runId, { pollIntervalMs = 1000, timeoutMs = 15000 } = {}) {
  const runEndpoint = `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`;
  const startedAt = Date.now();
  while (true) {
    const res = await fetch(runEndpoint, { method: 'GET', headers: getHeaders() });
    if (!res.ok) {
      console.warn('[OpenAI] Failed to poll run after cancellation attempt:', await res.text());
      return;
    }
    const payload = await res.json();
    updateRunStatus(threadId, payload.status);
    if (!ACTIVE_RUN_STATUSES.has(payload.status)) return;
    if (Date.now() - startedAt >= timeoutMs) {
      console.warn('[OpenAI] Run remained active after cancellation window');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function cancelRun(threadId, runId) {
  const endpoint = `https://api.openai.com/v1/threads/${threadId}/runs/${runId}/cancel`;
  const res = await fetch(endpoint, { method: 'POST', headers: getHeaders() });
  if (!res.ok) {
    console.warn('[OpenAI] Failed to cancel run:', await res.text());
  }
}

async function findActiveRun(threadId) {
  const endpoint = `https://api.openai.com/v1/threads/${threadId}/runs?order=desc&limit=10`;
  const res = await fetch(endpoint, { method: 'GET', headers: getHeaders() });
  if (!res.ok) {
    console.warn('[OpenAI] Failed to list runs for thread', threadId, await res.text());
    return null;
  }
  const payload = await res.json();
  return (payload?.data ?? []).find((run) => ACTIVE_RUN_STATUSES.has(run.status)) ?? null;
}

//  KAI integration - Enhanced run creation with tool support for dashboard functions
export async function createAndPollRun(threadId, tools = []) {
  await ensureThreadIdle(threadId);
  const runEndpoint = `https://api.openai.com/v1/threads/${threadId}/runs`;

  const runPayload = {
    assistant_id: ASSISTANT_ID
  };

  // KAI integration - Add tools if provided for dashboard-specific functions
  if (tools && tools.length > 0) {
    runPayload.tools = tools;
  }

  const runResponse = await fetch(runEndpoint, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(runPayload)
  });

  if (!runResponse.ok) throw new Error(await runResponse.text());
  const run = await runResponse.json();
  markRunActive(threadId, run.id, run.status);

  let runStatus = run.status;
  let runResult = null;
  
  // KAI integration - Enhanced polling with tool call handling
  while (runStatus !== 'completed' && runStatus !== 'failed') {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const statusCheck = await fetch(`${runEndpoint}/${run.id}`, {
      method: 'GET',
      headers: getHeaders()
    });

    if (!statusCheck.ok) throw new Error(await statusCheck.text());
    runResult = await statusCheck.json();
    runStatus = runResult.status;
    updateRunStatus(threadId, runStatus);

    // KAI integration - Handle tool calls if they occur
    if (runStatus === 'requires_action' && runResult.required_action) {
      const toolCalls = runResult.required_action.submit_tool_outputs.tool_calls;
      const toolOutputs = [];

      for (const toolCall of toolCalls) {
        const output = await handleToolCall(toolCall);
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(output)
        });
      }

      // Submit tool outputs
      const submitResponse = await fetch(`${runEndpoint}/${run.id}/submit_tool_outputs`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          tool_outputs: toolOutputs
        })
      });

      if (!submitResponse.ok) throw new Error(await submitResponse.text());
    }
  }

  clearRunState(threadId);
  return runResult;
}
// Stream a run as SSE frames; auto-handle requires_action tool calls.
// onEvent(evt) receives OpenAI event objects and internal 'tool.result' pings.
export async function createAndStreamRun(threadId, tools = [], onEvent) {
  await ensureThreadIdle(threadId);
  const runEndpoint = `https://api.openai.com/v1/threads/${threadId}/runs`;
  const payload = { assistant_id: ASSISTANT_ID };
  if (Array.isArray(tools) && tools.length) payload.tools = tools;

  const res = await fetch(`${runEndpoint}?stream=true`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });
  if (!res.ok || !res.body) throw new Error(await res.text());

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let activeRunId = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);

      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') {
          onEvent?.({ type: 'openai.done' });
          if (activeRunId) clearRunState(threadId);
          continue;
        }

        let evt;
        try { evt = JSON.parse(data); } catch { continue; }
        onEvent?.(evt);

        if (evt.type === 'thread.run.created') {
          activeRunId = evt?.data?.id;
          if (activeRunId) markRunActive(threadId, activeRunId, evt?.data?.status ?? 'queued');
        } else if (evt.type === 'thread.run.step.completed' && evt?.data?.run_id) {
          updateRunStatus(threadId, evt.data.status ?? 'in_progress');
        } else if (evt.type?.startsWith('thread.run.')) {
          const status = evt?.data?.status;
          if (status) updateRunStatus(threadId, status);
        }

        // Mid-stream tool calls
        if (evt.type === 'thread.run.requires_action') {
          const runId = evt?.data?.id;
          const calls = evt?.data?.required_action?.submit_tool_outputs?.tool_calls ?? [];
          const outputs = [];
          for (const call of calls) {
            const out = await handleToolCall(call); // uses your existing switch
            outputs.push({ tool_call_id: call.id, output: JSON.stringify(out) });
            onEvent?.({ type: 'tool.result', call, data: out });
          }
          const submit = await fetch(`${runEndpoint}/${runId}/submit_tool_outputs`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ tool_outputs: outputs })
          });
          if (!submit.ok) throw new Error(await submit.text());
        }
      }
    }
  }

  if (activeRunId) {
    clearRunState(threadId);
  }
}

// KAI integration - Tool call handler for dashboard-specific functions
export async function handleToolCall(toolCall) {
  const { name, arguments: args } = toolCall.function;

  // Be defensive about malformed JSON from the model
  let parsedArgs = {};
  try {
    parsedArgs = args ? JSON.parse(args) : {};
  } catch (e) {
    return { error: `Invalid arguments for ${name}: ${e.message}` };
  }

  switch (name) {
    // --- NEW: Graph tools ---
    case 'recommend_from_graph':
      return await tool_recommend_from_graph(parsedArgs);

    case 'find_friend':
      return await tool_find_friend(parsedArgs);

    case 'get_friend_contacts':
      return await tool_get_friend_contacts(parsedArgs);

    case 'mattering_suggestions':
      // Reads Neo4j and returns latest-per-friend rows (optionally filtered)
      return await tool_mattering_suggestions(parsedArgs);

    case 'log_interaction':
      // Writes a minimal INTERACTION edge in Neo4j
      return await tool_log_interaction(parsedArgs);

    // --- Existing tools (leave as-is) ---
    case 'save_reflection':
      return await saveReflectionToProfile(parsedArgs);

    case 'generate_mystery_quest':
      return await generateMysteryQuest(parsedArgs);

    case 'get_challenge_preview':
      return await getChallengePreview(parsedArgs);

    case 'queue_nudge':
      return await tool_queue_nudge(parsedArgs);

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function tool_mattering_suggestions({ limit=20, min_score=null, exclude_flags=[], window_days=null }) {
  const ownerId = String(TOOL_CONTEXT.ownerId || '');
  if (!ownerId) return { error: 'ownerId missing in TOOL_CONTEXT' };

  const cypher = `
    MATCH (u:User {id:$ownerId})-[:CONSIDERS]->(p:Person)-[:HAS_ASSESSMENT]->(a:Assessment)
    WITH p, a ORDER BY a.created_at DESC
    WITH p, collect(a)[0] AS la
    OPTIONAL MATCH (la)-[:HAS_FLAG]->(fl:Flag)
    WITH p, la, collect(fl.id) AS flags
    WHERE ($min_score IS NULL OR la.score >= $min_score)
      AND (size($exclude_flags) = 0 OR none(f IN flags WHERE f IN $exclude_flags))
    WITH p, la, flags,
         la.score AS base,
         CASE
           WHEN $window_days IS NULL THEN 0
           ELSE CASE
             WHEN la.created_at >= datetime() - duration({ days: toInteger($window_days) }) THEN 3
             WHEN la.created_at >= datetime() - duration({ days: toInteger($window_days) * 2 }) THEN 1
             ELSE 0
           END
         END AS recency_bonus
    RETURN p.id AS friend_id,
           p.display_name AS name,
           la.score AS score,
           la.tier  AS tier,
           la.direct_ratio AS direct_ratio,
           la.proxy_ratio  AS proxy_ratio,
           la.created_at   AS assessed_at,
           flags           AS flags,
           (base + recency_bonus) AS rank_score
    ORDER BY assessed_at DESC
    LIMIT toInteger($limit)
  `;
  const result = await neoRun(cypher, { ownerId, limit, min_score, exclude_flags, window_days });
  return result.records.map(r => ({
    friend_id:    r.get('friend_id'),
    name:         r.get('name'),
    score:        r.get('score'),
    tier:         r.get('tier'),
    direct_ratio: r.get('direct_ratio'),
    proxy_ratio:  r.get('proxy_ratio'),
    assessed_at:  r.get('assessed_at'),
    flags:        r.get('flags'),
    rank_score:   r.get('rank_score')
  }));
}

async function tool_log_interaction({ friend_id, channel, occurred_at=null, notes=null }) {
  const ownerId = String(TOOL_CONTEXT.ownerId || '');
  if (!ownerId) return { error: 'ownerId missing in TOOL_CONTEXT' };

  // Normalize for Neo4j Person.id (string)
  const personId = String(friend_id);

  const cypher = `
    MATCH (u:User {id:$ownerId}), (p:Person {id:$friend_id})
    MERGE (u)-[i:INTERACTION {id: coalesce($id, randomUUID())}]->(p)
      ON CREATE SET i.created_at = datetime()
    SET i.channel = $channel,
        i.occurred_at = coalesce(datetime($occurred_at), datetime()),
        i.notes = coalesce($notes, "")
    RETURN i.id AS id, i.channel AS channel, i.occurred_at AS occurred_at
  `;
  const result = await neoRun(cypher, {
    ownerId,
    friend_id: personId,
    channel,
    occurred_at,
    notes,
    id: null
  });
  const r = result.records[0];
  return { id: r.get('id'), channel: r.get('channel'), occurred_at: r.get('occurred_at') };
}
// DB - Save user reflection to challenge_logs table
async function saveReflectionToProfile({ userId, challengeId, dayNumber, reflection, pool }) {
  try {
    if (!pool) {
      throw new Error('Database pool not provided');
    }

    const result = await pool.query(
      `INSERT INTO challenge_logs (user_id, challenge_id, day_number, reflection, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id`,
      [userId, challengeId, dayNumber, reflection]
    );

    return {
      success: true,
      message: 'Reflection saved successfully!',
      logId: result.rows[0].id
    };
  } catch (error) {
    console.error('Error saving reflection:', error);
    return {
      success: false,
      message: 'Failed to save reflection',
      error: error.message
    };
  }
}

// DB - Generate and save mystery quest task
async function generateMysteryQuest({ userId, questType = 'random_kindness', pool }) {
  try {
    if (!pool) {
      throw new Error('Database pool not provided');
    }

    // DB - Generate a random kindness task
    const mysteryTasks = [
      'Leave a positive note for a stranger to find',
      'Pay for someone\'s coffee or meal',
      'Compliment three different people today',
      'Help someone carry their groceries',
      'Send an encouraging message to a friend',
      'Donate items you no longer need',
      'Volunteer for 30 minutes at a local organization',
      'Pick up litter in your neighborhood',
      'Write a thank you note to someone who helped you'
    ];

    const randomTask = mysteryTasks[Math.floor(Math.random() * mysteryTasks.length)];

    const result = await pool.query(
      `INSERT INTO quest_logs (user_id, quest_type, task_description, status, created_at)
       VALUES ($1, $2, $3, 'active', NOW())
       RETURNING id`,
      [userId, questType, randomTask]
    );

    return {
      success: true,
      task: randomTask,
      questLogId: result.rows[0].id,
      message: 'Mystery quest generated! Complete this task to earn kindness points.'
    };
  } catch (error) {
    console.error('Error generating mystery quest:', error);
    return {
      success: false,
      message: 'Failed to generate mystery quest',
      error: error.message
    };
  }
}

// DB - Get challenge preview information
async function getChallengePreview({ challengeId, pool }) {
  try {
    if (!pool) {
      throw new Error('Database pool not provided');
    }

    const result = await pool.query(
      `SELECT name, description, total_days, difficulty, 
              COALESCE(instructions, 'Complete daily acts of kindness to spread positivity!') as instructions
       FROM challenges 
       WHERE id = $1 AND is_active = true`,
      [challengeId]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        message: 'Challenge not found or inactive'
      };
    }

    const challenge = result.rows[0];
    return {
      success: true,
      challenge: {
        name: challenge.name,
        description: challenge.description,
        totalDays: challenge.total_days,
        difficulty: challenge.difficulty,
        instructions: challenge.instructions
      },
      message: `Here's what you can expect from the "${challenge.name}" challenge!`
    };
  } catch (error) {
    console.error('Error getting challenge preview:', error);
    return {
      success: false,
      message: 'Failed to get challenge preview',
      error: error.message
    };
  }
}

export async function listMessages(threadId) {
  const endpoint = `https://api.openai.com/v1/threads/${threadId}/messages`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: getHeaders()
  });

  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}

// KAI integration - Dashboard-specific tools definition
export const DASHBOARD_TOOLS = [
  {
  type: 'function',
  function: {
    name: 'queue_nudge',
    description: 'Queue a nudge to contact a friend. Writes to Postgres outbox; a server job delivers it.',
    parameters: {
      type: 'object',
      properties: {
        // Prefer friend_id, but allow friend_name fallback
        friend_id:   { type: 'string', description: 'Friend UUID (friends.id)' },
        friend_name: { type: 'string', description: 'Friend name (fallback if UUID unknown)' },

        channel:     { type: 'string', enum: ['email','sms'], default: 'email' },
        to:          { type: 'string', description: 'Override destination; otherwise uses friend.email/phone' },
        subject:     { type: 'string' },
        message:     { type: 'string' },
        send_after:  { type: 'string', description: 'ISO datetime; defaults to now' },
        preview_only:{ type: 'boolean' }
      },
      // We can’t express "oneOf" well here, so keep message required;
      // handler will enforce (friend_id || friend_name)
      required: ['channel','message']
    }
  }
},
  {
  type: 'function',
  function: {
    name: 'recommend_from_graph',
    description: 'Alias of mattering_suggestions. Returns latest assessment per friend with optional filters.',
    parameters: {
      type: 'object',
      properties: {
        limit:            { type: 'integer', minimum: 1, maximum: 50,  default: 3 },
        min_score:        { type: 'number',  minimum: 0, maximum: 100 },
        exclude_flags:    { type: 'array',   items: { type: 'string' } },
        window_days:      { type: 'integer', minimum: 1, maximum: 365, description: 'Recency boost window' },
        prefer_stale_days:{ type: 'integer', minimum: 7, maximum: 365, description: 'Prefer if no interaction in ≥ X days' }
      }
    }
  }
},
{
  type: 'function',
  function: {
    name: 'find_friend',
    description: 'Find (owner-scoped) friend rows by name substring; resolves friend_id from free text.',
    parameters: {
      type: 'object',
      properties: {
        name:  { type: 'string',  description: 'Partial/full name, case-insensitive' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 5 }
      },
      required: ['name']
    }
  }
},
{
  type: 'function',
  function: {
    name: 'get_friend_contacts',
    description: 'Fetch contact info (email/phone) for a friend (Postgres).',
    parameters: {
      type: 'object',
      properties: {
        friend_id: {
          type: 'string',
          description: 'Friend UUID (friends.id) use find_friend first to resolve from name'
        }
      },
      required: ['friend_id']
    }
  }
},
  {
    type: 'function',
    function: {
      name: 'save_reflection',
      description: 'Save a user\'s reflection about their kindness challenge progress',
      parameters: {
        type: 'object',
        properties: {
          userId: {
            type: 'integer',
            description: 'The user\'s ID'
          },
          challengeId: {
            type: 'integer',
            description: 'The challenge ID they\'re reflecting on'
          },
          dayNumber: {
            type: 'integer',
            description: 'The day number of the challenge'
          },
          reflection: {
            type: 'string',
            description: 'The user\'s reflection text'
          }
        },
        required: ['userId', 'challengeId', 'dayNumber', 'reflection']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_mystery_quest',
      description: 'Generate a random kindness quest for the user',
      parameters: {
        type: 'object',
        properties: {
          userId: {
            type: 'integer',
            description: 'The user\'s ID'
          },
          questType: {
            type: 'string',
            description: 'Type of quest to generate',
            enum: ['random_kindness', 'community_help', 'personal_growth']
          }
        },
        required: ['userId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_challenge_preview',
      description: 'Get detailed information about a specific challenge',
      parameters: {
        type: 'object',
        properties: {
          challengeId: {
            type: 'integer',
            description: 'The challenge ID to preview'
          }
        },
        required: ['challengeId']
      }
    }
  },
  // ---- Graph tools ----
{
  type: 'function',
  function: {
    name: 'mattering_suggestions',
    description: 'Return latest assessment per friend for the signed-in user, with optional filters.',
    parameters: {
      type: 'object',
      properties: {
        limit:        { type: 'integer', minimum: 1, maximum: 200, default: 20 },
        min_score:    { type: 'number',  minimum: 0, maximum: 100 },
        exclude_flags:{ type: 'array',   items: { type: 'string' } },
        window_days:  { type: 'integer', minimum: 1, maximum: 365, description: 'Optional recency window' }
      }
    }
  }
},
{
  type: 'function',
  function: {
    name: 'log_interaction',
    description: 'Record that the user interacted with a friend (e.g., text/call/coffee).',
    parameters: {
      type: 'object',
      properties: {
        friend_id:   { type: 'string' },
        channel:     { type: 'string', enum: ['text','call','dm','coffee','video','other'] },
        occurred_at: { type: 'string', description: 'ISO datetime; defaults to now' },
        notes:       { type: 'string' }
      },
      required: ['friend_id','channel']
    }
  }
}
];
// Quota helper (owner/day + per-recipient/day)
async function checkNudgeQuota(pool, ownerId, to, {
  maxPerDay = Number(process.env.NUDGE_DAILY_LIMIT) || 25,
  maxPerRecipient = Number(process.env.NUDGE_PER_RECIPIENT_LIMIT) || 3
} = {}) {
  const [{ rows: [{ cnt_owner }] }, { rows: [{ cnt_rcpt }] }] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS cnt_owner
         FROM nudges_outbox
        WHERE owner_user_id = $1
          AND created_at >= NOW() - INTERVAL '1 day'`,
      [ownerId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS cnt_rcpt
         FROM nudges_outbox
        WHERE owner_user_id = $1
          AND to_address = $2
          AND created_at >= NOW() - INTERVAL '1 day'`,
      [ownerId, to]
    )
  ]);

  if (cnt_owner >= maxPerDay) {
    return { error: `Daily limit reached (${maxPerDay}). Try again tomorrow.` };
  }
  if (cnt_rcpt >= maxPerRecipient) {
    return { error: `You’ve already nudged this person ${cnt_rcpt} times today.` };
  }
  return { ok: true };
}

async function tool_queue_nudge({
  friend_id = null,
  friend_name = null,
  channel = 'email',
  to = null,
  subject = null,
  message,
  send_after = null,
  preview_only = false
}) {
  try {
    const ownerId = String(TOOL_CONTEXT.ownerId || '');
    const pool    = TOOL_CONTEXT.pool;
    if (!ownerId) return { error: 'ownerId missing in TOOL_CONTEXT' };
    if (!pool)    return { error: 'DB pool missing in TOOL_CONTEXT' };

    // 1) Resolve friend (UUID first; fallback to exact name)
    let friendRow = null;

    if (friend_id) {
      const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(friend_id);
      if (!uuidLike) return { error: `friend_id is not a valid UUID: ${friend_id}` };

      const byId = await pool.query(
        `SELECT id, name, email, phone
           FROM public.friends
          WHERE id = $1::uuid AND owner_user_id = $2
          LIMIT 1`,
        [friend_id, ownerId]
      );
      if (byId.rows.length) friendRow = byId.rows[0];
    }

    if (!friendRow && friend_name) {
      const byName = await pool.query(
        `SELECT id, name, email, phone
           FROM public.friends
          WHERE owner_user_id = $1
            AND lower(name) = lower($2)
          ORDER BY updated_at DESC NULLS LAST, id DESC
          LIMIT 2`,
        [ownerId, friend_name]
      );
      if (byName.rows.length === 0) {
        return { error: `friend_name not found for owner: ${friend_name}` };
      }
      if (byName.rows.length > 1) {
        return { error: `multiple friends match name "${friend_name}". Please specify friend_id.` };
      }
      friendRow = byName.rows[0];
      friend_id = friendRow.id; // ensure UUID going forward
    }

    if (!friendRow) {
      return { error: 'Provide friend_id (UUID) or friend_name (exact).' };
    }

    // 2) Destination
    let to_address = to;
    if (!to_address) {
      if (channel === 'email') to_address = friendRow.email || null;
      if (channel === 'sms')   to_address = friendRow.phone || null;
    }
    if (!to_address) {
      return { error: `no ${channel} destination (provide "to" or add ${channel} to friend)` };
    }

    const safeSubject  = subject || null;
    const sendAfterIso = send_after ? new Date(send_after).toISOString() : new Date().toISOString();

    // 3) Preview only
    if (preview_only) {
      return {
        preview: true,
        friend_id,
        friend_name: friendRow.name,
        channel,
        to: to_address,
        subject: safeSubject,
        message,
        send_after: sendAfterIso
      };
    }

    // 3.5) Quota guard
    const quota = await checkNudgeQuota(pool, ownerId, to_address);
    if (quota.error) return { error: quota.error };

    // 4) Insert outbox row
    const bodyText = (message && String(message).trim()) || 'Just a quick nudge to connect 😊';
    const ins = await pool.query(`
      INSERT INTO nudges_outbox
        (owner_user_id, friend_id, channel, to_address, subject, body_text, body_html, send_after, status, meta)
      VALUES
        ($1::int, $2::uuid, $3::text, $4::text, $5::text, $6::text, NULL, $7::timestamptz, 'queued',
         jsonb_build_object('friend_name', $8::text))
      RETURNING id, send_after
    `, [
      ownerId,
      friend_id,
      channel,
      to_address,
      safeSubject,
      bodyText,
      sendAfterIso,
      friendRow.name
    ]);

    return {
      queued: true,
      id: ins.rows[0].id,
      friend_id,
      friend_name: friendRow.name,
      send_after: ins.rows[0].send_after
    };
  } catch (e) {
    console.error('[queue_nudge] error:', e);
    return { error: e.message || String(e) };
  }
}

// KAI integration - Enhanced message creation with context
export async function createDashboardMessage(threadId, content, userContext = {}) {
  const contextualContent = `User Context: ${JSON.stringify(userContext)}\n\nUser Message: ${content}`;
  
  return await createMessage(threadId, contextualContent);
}

// KAI integration - Save reflection to KAI for context
export async function saveReflectionToKAI(userId, challengeId, dayNumber, reflection, pool) {
  try {
    // DB - Save to kai_interactions for conversation context
    await pool.query(`
      INSERT INTO kai_interactions (user_id, context_type, context_id, message, created_at)
      VALUES ($1, 'reflection', $2, $3, NOW())
    `, [userId, challengeId, `Day ${dayNumber}: ${reflection}`]);
    
    return {
      success: true,
      message: 'Reflection saved to KAI context'
    };
  } catch (error) {
    console.error('Error saving reflection to KAI:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
async function tool_recommend_from_graph({
  limit = 3,
  min_score = null,
  exclude_flags = [],
  window_days = 30,
  prefer_stale_days = 14
}) {
  const ownerId = String(TOOL_CONTEXT.ownerId || '');
  if (!ownerId) return { error: 'ownerId missing in TOOL_CONTEXT' };

  const cypher = `
    MATCH (u:User {id:$ownerId})-[:CONSIDERS]->(p:Person)-[:HAS_ASSESSMENT]->(a:Assessment)
    WITH u,p,a ORDER BY a.created_at DESC
    WITH u,p,collect(a)[0] AS la
    OPTIONAL MATCH (la)-[:HAS_FLAG]->(fl:Flag)
    WITH u,p,la, collect(DISTINCT fl.id) AS flags
    OPTIONAL MATCH (la)-[t:TOP_ARCHETYPE]->(ar:Archetype)
    WITH u,p,la, flags, collect(DISTINCT {rank:t.rank, name:ar.name}) AS archetypes
    OPTIONAL MATCH (la)-[:REPORTED]->(o:Observation)
    WITH u,p,la, flags, archetypes,
         collect(DISTINCT {field:o.field, value:o.value, round:o.round, source:o.source}) AS obs
    OPTIONAL MATCH (u)-[i:INTERACTION]->(p)
    WITH p, la, flags, archetypes, obs, max(i.occurred_at) AS last_interaction
    WITH p, la, flags, archetypes, obs, last_interaction,
         la.score AS base,
         CASE
           WHEN $window_days IS NULL THEN 0
           ELSE CASE
             WHEN la.created_at >= datetime() - duration({ days: toInteger($window_days) }) THEN 3
             WHEN la.created_at >= datetime() - duration({ days: toInteger($window_days) * 2 }) THEN 1
             ELSE 0
           END
         END AS recency_bonus,
         CASE
           WHEN last_interaction IS NULL THEN 2
           WHEN duration.between(date(last_interaction), date()).days >= toInteger($prefer_stale_days) THEN 2
           ELSE 0
         END AS stale_bonus
    WHERE ($min_score IS NULL OR la.score >= $min_score)
      AND (size($exclude_flags) = 0 OR none(f IN flags WHERE f IN $exclude_flags))
    RETURN
      p.id AS friend_id,
      p.display_name AS name,
      la.score AS score,
      la.tier  AS tier,
      la.direct_ratio AS direct_ratio,
      la.proxy_ratio  AS proxy_ratio,
      la.created_at   AS assessed_at,
      flags,
      archetypes,
      obs,
      last_interaction,
      (base + recency_bonus + stale_bonus) AS rank_score
    ORDER BY rank_score DESC, assessed_at DESC
    LIMIT toInteger($limit)
  `;

  const result = await neoRun(cypher, {
    ownerId, limit, min_score, exclude_flags, window_days, prefer_stale_days
  });

  return result.records.map(r => {
    const arche = (r.get('archetypes') || []).filter(Boolean).sort((a,b)=> (a.rank||99)-(b.rank||99));
    const obs   = (r.get('obs') || []).filter(Boolean);

    // strongest per round
    const byRound = {};
    for (const o of obs) {
      if (!o || o.value == null) continue;
      const key = o.round || 'Other';
      if (!byRound[key] || o.value > byRound[key].value) byRound[key] = o;
    }
    const top_observations = Object.values(byRound)
      .sort((a,b)=> (b.value||0)-(a.value||0))
      .slice(0, 4);

    // quick interest callouts
    const signals = obs
      .filter(o => (o.source === 'signal') || String(o.field||'').startsWith('sig_'))
      .map(o => o.field);

    return {
      friend_id:    r.get('friend_id'),
      name:         r.get('name'),
      score:        r.get('score'),
      tier:         r.get('tier'),
      direct_ratio: r.get('direct_ratio'),
      proxy_ratio:  r.get('proxy_ratio'),
      assessed_at:  r.get('assessed_at'),
      rank_score:   r.get('rank_score'),
      flags:        r.get('flags') || [],
      archetypes:   arche,               // [{rank:1,name:'…'}, {rank:2,name:'…'}]
      signals,                           // ['sig_nhl', ...]
      top_observations,                  // [{field,value,round,source}, ...]
      last_interaction: r.get('last_interaction') || null
    };
  });
}
async function tool_find_friend({ name, limit = 5 }) {
  const ownerId = String(TOOL_CONTEXT.ownerId || '');
  const pool    = TOOL_CONTEXT.pool;
  if (!ownerId) return { error: 'ownerId missing in TOOL_CONTEXT' };
  if (!pool)    return { error: 'DB pool missing in TOOL_CONTEXT' };
  if (!name || !name.trim()) return { error: 'name is required' };

  const q = `
    SELECT id, name, email, phone, score, updated_at
      FROM public.friends
     WHERE owner_user_id = $1 AND name ILIKE $2
     ORDER BY updated_at DESC NULLS LAST, name ASC
     LIMIT $3
  `;
  const { rows } = await pool.query(q, [ownerId, `%${name.trim()}%`, Number(limit)]);
  return rows.map(r => ({
    friend_id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    score: r.score,
    updated_at: r.updated_at
  }));
}

async function tool_get_friend_contacts({ friend_id }) {
  const ownerId = String(TOOL_CONTEXT.ownerId || '');
  const pool    = TOOL_CONTEXT.pool;
  if (!ownerId) return { error: 'ownerId missing in TOOL_CONTEXT' };
  if (!pool)    return { error: 'DB pool missing in TOOL_CONTEXT' };
  if (!friend_id) return { error: 'friend_id is required' };
// Enforce UUID early to avoid Postgres casting errors
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(friend_id);
  if (!uuidLike) {
    return { error: `friend_id is not a valid UUID: ${friend_id}` };
  }
  const { rows } = await pool.query(
  `SELECT id, name, email, phone
    FROM public.friends
    WHERE id = $1::uuid AND owner_user_id = $2
    LIMIT 1`,
    [friend_id, ownerId]
  );
  if (!rows.length) return { error: 'friend not found for owner' };
  const f = rows[0];
  return { friend_id: f.id, name: f.name, email: f.email, phone: f.phone };
}
