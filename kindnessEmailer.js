import nodemailer from "nodemailer";
import ejs from "ejs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { getUserByEmail } from "./fetchData.js"; 

// ES-module __dirname shim:
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function sendDailyKindnessPrompts({
  user_emails,
  kindness_prompts,
  subject,
  send_time,
  transport = "smtp"
}) {
  if (user_emails.length !== kindness_prompts.length) {
    throw new Error("user_emails.length must match kindness_prompts.length");
  }

const port = Number(process.env.SMTP_PORT);
const secure = port === 465; // SMTPS on 465 needs secure:true; 587 stays false (STARTTLS)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
});

   const templatePath = path.join(__dirname, "views", "email.ejs");
  await Promise.all(
    user_emails.map(async (to, i) => {
      const { firstname = "" } = await getUserByEmail(to);
      const html = await ejs.renderFile(templatePath, {
        prompt: kindness_prompts[i],
        user: { firstname }
      });
      await transporter.sendMail({
        from: `"Kindness Bot" <${process.env.SMTP_USER}>`,
        to,
        bcc: process.env.SMTP_USER,
        subject,
        html
      });
    })
  );

  console.log(
    `[${new Date().toISOString()}] Sent ${user_emails.length} kindness emails`
  );
}
// --- Nudge sender (email) ---
let _nudgesTransporter = null;
function getNudgesTransport() {
  if (_nudgesTransporter) return _nudgesTransporter;

  const url = process.env.SMTP_URL;
  if (url) {
    _nudgesTransporter = nodemailer.createTransport(url);
  } else {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD) {
      throw new Error('SMTP_* env vars missing (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD)');
    }
    _nudgesTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD }
    });
  }
  return _nudgesTransporter;
}
 //sendNudgeEmail: minimal one-off sender.
 //Default BCC -> kai@getkinder.com. Pass bcc=null to disable.
export async function sendNudgeEmail({
  to, subject, text, html,
  bcc = process.env.BCC_EMAIL || process.env.SMTP_USER || 'kai@getkinder.ai'
}) {
  const t = getNudgesTransport();
  const from = process.env.MAIL_FROM || `Kinder <${process.env.SMTP_USER}>`;

  const mail = {
    from,
    to,
    subject: subject || 'A quick nudge ✉️',
    text: text || undefined,
    html: html || undefined
  };
  if (bcc) mail.bcc = bcc;

  const info = await t.sendMail(mail);
  return { messageId: info.messageId };
}

// Core delivery worker for nudges_outbox
export async function deliverQueuedNudges(pool, { max = 100 } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock a batch of due email nudges for sending
    const { rows } = await client.query(
      `UPDATE nudges_outbox
          SET status = 'processing',
              updated_at = NOW()
        WHERE id IN (
          SELECT id
            FROM nudges_outbox
           WHERE status = 'queued'
             AND channel = 'email'
             AND send_after <= NOW()
           ORDER BY send_after ASC, id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $1
        )
        RETURNING id, to_address, subject, body_text, body_html, attempts`,
      [max]
    );

    let sent = 0, failed = 0;
    const errors = [];

    for (const row of rows) {
      try {
        await sendNudgeEmail({
          to: row.to_address,
          subject: row.subject || 'A quick nudge ✉️',
          text: row.body_text || undefined,
          html: row.body_html || undefined
        });

        await client.query(
          `UPDATE nudges_outbox
              SET status='sent',
                  attempts = attempts + 1,
                  last_error = NULL,
                  updated_at = NOW()
            WHERE id = $1`,
          [row.id]
        );
        sent++;
      } catch (e) {
        // Retry up to 5 times, then mark failed
        await client.query(
          `UPDATE nudges_outbox
              SET attempts = attempts + 1,
                  status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'queued' END,
                  last_error = $2,
                  updated_at = NOW()
            WHERE id = $1`,
          [row.id, e.message || String(e)]
        );
        failed++;
        errors.push({ id: row.id, error: e.message || String(e) });
      }
    }

    await client.query('COMMIT');
    return { picked: rows.length, sent, failed, errors };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
