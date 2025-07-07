// server/routes/openaiQuiz.js   (ES-module style; Node ≥ 18 with `"type":"module"`)

import express from 'express';
import { Pool }   from 'pg';
import OpenAI     from 'openai';

const pool  = new Pool();                 // env vars still drive host/port
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });
const router = express.Router();
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
//const API_KEY = process.env.OPENAI_API_KEY; //used in earlier code

router.post('/quiz', async (req, res) => {
  const { threadId, message } = req.body;

  try {
    // 1  append the user’s message to the thread
    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: message,
    });

  const stream = openai.beta.threads.runs.stream(threadId, {
      assistant_id: ASSISTANT_ID,
      stream: true

  });

  stream.on('toolCallDelta', async (tc) => {
      if (tc.type === 'function' && tc.function.name === 'save_kindness_style') {
        const { user_id, style, score } = JSON.parse(tc.function.arguments);

          await pool.query(
          `UPDATE users
             SET kindness_style = $1,
                 kindness_score = $2
           WHERE id = $3`,
          [style, score ?? null, user_id]         
        );

        await openai.beta.threads.runs.submitToolOutputs(
          threadId,
          tc.run_id,
          [{ tool_call_id: tc.id, output: 'stored' }]
        );
      }
    })
    stream
      .on('runCompleted', (snapshot) => res.json(snapshot))
      .on('error', (err) => {
        console.error(err);
        res.status(500).json({ error: err.message });
      });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;