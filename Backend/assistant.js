
import dotenv from 'dotenv';
dotenv.config();

// Graph + context
import { run as neoRun } from './db/neo4j.js';

// Tool execution context (filled by the route before createAndPollRun)
let TOOL_CONTEXT = { ownerId: null }; // (add pool later if you want DB writes)
export function setToolContext(ctx = {}) {
  TOOL_CONTEXT = { ...TOOL_CONTEXT, ...ctx };
}

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const API_KEY = process.env.OPENAI_API_KEY;

function getHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${API_KEY}`,
    "OpenAI-Beta": "assistants=v2"
  };
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

//  KAI integration - Enhanced run creation with tool support for dashboard functions
export async function createAndPollRun(threadId, tools = []) {
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

  return runResult;
}

// KAI integration - Tool call handler for dashboard-specific functions
// KAI integration - Tool call handler for dashboard-specific functions
// KAI integration - Tool call handler for dashboard-specific functions
async function handleToolCall(toolCall) {
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
    ownerId, friend_id, channel, occurred_at, notes, id: null
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
