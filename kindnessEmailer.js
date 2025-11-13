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
 // --- Nudge sender (email) ---
export async function sendNudgeEmail({
  to,
  subject,
  text,
  html,
  // default BCC -> env overrideable; falls back to your SMTP user
  bcc = process.env.BCC_EMAIL || process.env.SMTP_USER || 'kai@getkinder.ai',
  // new:
  fromName,
  replyTo
}) {
  const t = getNudgesTransport();
  // "Michael via Kinder <kai@getkinder.ai>"
  const from = process.env.MAIL_FROM
    ? process.env.MAIL_FROM
    : `${fromName || 'Via Get Kinder'} <${process.env.SMTP_USER}>`;
  const mail = {
    from,
    to,
    subject: subject || 'A quick nudge ✉️', // deliverQueuedNudges supplies personalized default
    text: text || undefined,
    html: html || undefined
  };
  if (replyTo) mail.replyTo = replyTo;
  if (bcc) mail.bcc = bcc;

  const info = await t.sendMail(mail);
  return { messageId: info.messageId };
}

export async function sendProspectInviteEmail({
  to,
  inviteeName,
  hostName,
  eventTitle,
  eventLink,
  joinLink,
  subject,
  text,
  html,
  sendByKai = false,
}) {
  const transport = getNudgesTransport();
  const safeHost = hostName || "A friend";
  const title = eventTitle || "a Get Kinder event";
  const link = joinLink || eventLink || (process.env.APP_BASE_URL || "https://getkinder.ai");
  const displayName = inviteeName ? inviteeName.split(/\s+/)[0] : "there";
  const defaultSubject = `${safeHost} invited you to ${title}`;
  const defaultText = `Hi ${displayName},\n\n${safeHost} just invited you to ${title}.\nJoin the event: ${eventLink || link}\nCreate your account: ${link}\n\nSee you soon!`;
  const defaultHtml = `
    <p>Hi ${displayName},</p>
    <p><strong>${safeHost}</strong> just invited you to <strong>${title}</strong>.</p>
    <p><a href="${eventLink || link}" target="_blank" rel="noopener">View the event details</a></p>
    <p><a href="${link}" target="_blank" rel="noopener">Join Get Kinder to RSVP</a></p>
    <p>Hope to see you there! 💛</p>
  `;

  await transport.sendMail({
    to,
    from: process.env.MAIL_FROM || `${sendByKai ? "KAI" : safeHost} via Get Kinder <${process.env.SMTP_USER}>`,
    subject: subject?.trim() || defaultSubject,
    text: text?.trim() || defaultText,
    html: html?.trim() || defaultHtml,
  });
}
// Core delivery worker for nudges_outbox
// Core delivery worker for nudges_outbox (emails)
export async function deliverQueuedNudges(pool, { max = 100 } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock & mark a batch as processing
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
        RETURNING id, owner_user_id, friend_id, channel, to_address,
                  subject, body_text, body_html, attempts`,
      [max]
    );

    let sent = 0, failed = 0;
    const errors = [];

    for (const row of rows) {
      try {
        // Identify the human sender (the owner who queued this nudge)
        const { rows: [owner] } = await client.query(
          `SELECT firstname, email
             FROM userdata
            WHERE id = $1
            LIMIT 1`,
          [row.owner_user_id]
        );

        const ownerFirst =
          (owner?.firstname || owner?.email?.split('@')[0] || 'your friend').trim();
        const fromName = `${ownerFirst} via Get Kinder`;
        const replyTo  = owner?.email || null;

        // ✅ Subject: "{user}, sending a friendly message to {friend}"
        //    We look up the friend name to personalize it.
        const { rows: [friend] } = await client.query(
          `SELECT name FROM public.friends WHERE id = $1 LIMIT 1`,
          [row.friend_id]
        );
        const friendName = (friend?.name || 'your friend').trim();
        const subject = (row.subject && row.subject.trim())
          ? row.subject
          : `${ownerFirst}, sending a friendly message to ${friendName}`;

        await sendNudgeEmail({
          to: row.to_address,
          subject,
          text: row.body_text || undefined,
          html: row.body_html || undefined,
          fromName,
          replyTo
          // bcc default is handled inside sendNudgeEmail
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
