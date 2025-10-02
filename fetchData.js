// fetchData.js
import { Pool } from "pg";
import OpenAI from "openai";

//
// Use the SAME connection strategy you use in index.js to avoid prod mismatches.
//
let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
} else {
  pool = new Pool({
    user:     process.env.DB_USER,
    host:     process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port:     Number(process.env.DB_PORT) || 5432,
  });
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * fetchUserEmails:
 * - Aligns to your real table: public.userdata
 * - Returns DISTINCT, non-null emails.
 * - If you have a "wants_daily_prompt" boolean column, add a WHERE clause for it.
 */
export async function fetchUserEmails() {
  const { rows } = await pool.query(
    `SELECT DISTINCT email
       FROM public.userdata
      WHERE email IS NOT NULL`
    // If you later add a flag:
    // AND wants_daily_prompt IS TRUE
  );
  return rows.map(r => r.email);
}

/**
 * fetchKindnessPrompts:
 * - Tries DB first (table kindness_prompts with a "prompt_text" column).
 * - On no rows OR any DB error, falls back to OpenAI with JSON mode.
 */
export async function fetchKindnessPrompts() {
  try {
    const { rows } = await pool.query(
      `SELECT prompt_text
         FROM kindness_prompts
        WHERE scheduled_date = CURRENT_DATE`
      // If your scheduling is timezone-sensitive, consider:
      // WHERE scheduled_date = (CURRENT_DATE AT TIME ZONE 'America/Vancouver')
    );
    if (rows.length > 0) {
      return rows.map(r => r.prompt_text);
    }
  } catch (e) {
    // If the table is missing or any DB error occurs, fall through to OpenAI fallback.
    console.warn('[fetchKindnessPrompts] DB read failed, using OpenAI fallback:', e.message);
  }

  // Fallback: enforce JSON so parsing is deterministic.
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You generate short, kind, specific prompts people can take action on today." },
      {
        role: "user",
        content:
          "Return a JSON object with a 'prompts' array of exactly 3 short strings. No extra keys."
      }
    ],
  });

  let prompts = [];
  try {
    const obj = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
    if (Array.isArray(obj.prompts)) prompts = obj.prompts;
  } catch {
    // ignore
  }

  if (prompts.length === 0) {
    // Final safety fallback (static)
    prompts = [
      "Text a friend and set a time to catch up this week.",
      "Leave a kind note or review for someone who helped you recently.",
      "Share a small win with a friend and ask about theirs."
    ];
  }
  return prompts;
}

/**
 * fetchEmailSubject:
 * - Keep simple; matches your usage.
 */
export function fetchEmailSubject() {
  return "Your Daily Kindness Prompt";
}

/**
 * getUserByEmail:
 * - Aligns to your real table: public.userdata
 * - Returns { firstname } (empty string if missing), exactly what your mailer expects.
 */
export async function getUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT firstname
       FROM public.userdata
      WHERE email = $1
      LIMIT 1`,
    [email]
  );
  return { firstname: rows[0]?.firstname || "" };
}
