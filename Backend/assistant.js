
import dotenv from 'dotenv';
dotenv.config();

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const API_KEY = process.env.OPENAI_API_KEY;

function getHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${API_KEY}`,
    "OpenAI-Beta": "assistants=v2"
  };
}

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

export async function createAndPollRun(threadId) {
  const runEndpoint = `https://api.openai.com/v1/threads/${threadId}/runs`;

  const runResponse = await fetch(runEndpoint, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      assistant_id: ASSISTANT_ID
    })
  });

  if (!runResponse.ok) throw new Error(await runResponse.text());
  const run = await runResponse.json();

  let runStatus = run.status;
  let runResult = null;
  while (runStatus !== 'completed') {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const statusCheck = await fetch(`${runEndpoint}/${run.id}`, {
      method: 'GET',
      headers: getHeaders()
    });

    if (!statusCheck.ok) throw new Error(await statusCheck.text());
    runResult = await statusCheck.json();
    runStatus = runResult.status;
  }

  return runResult;
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
