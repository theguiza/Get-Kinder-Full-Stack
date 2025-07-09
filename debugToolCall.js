// debugToolCall.js
import OpenAI from 'openai';
import dotenv  from 'dotenv';
dotenv.config();                               // loads .env

const openai       = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;  // <-- put real ID

const TEST_USER_ID = '14'; // anything

// ------------ 1. make a blank thread ------------
const { id: threadId } = await openai.beta.threads.create({});

// ------------ 2. post answers (and user_id!) ------------
await openai.beta.threads.messages.create(threadId, {
  role: 'user',
  content: JSON.stringify({
    user_id : TEST_USER_ID,
    answers : ['A','C','B','D']        // whatever your quiz expects
  })
});

// ------------ 3. run WITHOUT streaming ------------
let run = await openai.beta.threads.runs.create(threadId, {
  assistant_id: ASSISTANT_ID
});

// ---- wait until the run leaves queued/in_progress states ----
while (['queued','in_progress','cancelling'].includes(run.status)) {
  await new Promise(r => setTimeout(r, 800));
  run = await openai.beta.threads.runs.retrieve(threadId, run.id);
}

console.dir(run, { depth: null });
