// debugToolCall_responses.mjs    (Node 20+, ES-modules)

import OpenAI from 'openai';
import dotenv  from 'dotenv';
dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASSISTANT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'save_kindness_style',
      description: 'Store the quiz result in Postgres',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          style:   { type: 'string' },
          score:   { type: 'integer' }
        },
        required: ['user_id', 'style']
      }
    }
  }
];

const instructions =
  'Grade the kindness-style quiz. Then call save_kindness_style with user_id, style, and score.';

let previous_response_id = undefined;        // holds conversation state

// ---- send one message ----
const response = await openai.responses.create({
  model: 'gpt-4o',
  instructions,
  tools: ASSISTANT_TOOLS,
  input: JSON.stringify({
    user_id: '123e4567-e89b-12d3-a456-426614174000',
    answers: ['A','B','C','D']
  }),
  stream: false,                 // ← first test non-streaming
  previous_response_id           // omit on first turn
});

// inspect whether the model asked to run the tool
console.dir(response, { depth: null });
