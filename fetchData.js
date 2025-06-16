// src/fetchData.js
import { Pool } from "pg";
import OpenAI from "openai";

const pool = new Pool({
  user:     process.env.DB_USER,
  host:     process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.DB_PORT, 10),
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function fetchUserEmails() {
  const { rows } = await pool.query(
    `SELECT email FROM users WHERE wants_daily_prompt = TRUE`
  );
  return rows.map(r => r.email);
}

export async function fetchKindnessPrompts() {
  const { rows } = await pool.query(
    `SELECT prompt_text FROM kindness_prompts WHERE scheduled_date = CURRENT_DATE`
  );
  if (rows.length) return rows.map(r => r.prompt_text);

  // fallback: ask OpenAI
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a daily kindness-prompt generator." },
      { role: "user",   content: "Give me 3 kindness prompts for today." }
    ],
  });
  try {
    return JSON.parse(resp.choices[0].message.content);
  } catch {
    return [
      "Reach out to someone you haven’t talked to in a while.",
      "Pay for the coffee of the person behind you.",
      "Write a handwritten thank-you note to someone who helped you."
    ];
  }
}

export function fetchEmailSubject() {
  return "Your Daily Kindness Prompt";
}
// Fetch the user’s first name by email. Returns { firstname } or { firstname: "" } if none found.
export async function getUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT firstname
       FROM users
      WHERE email = $1
      LIMIT 1`,
    [email]
  );
  return { firstname: rows[0]?.firstname || "" };
}