import nodemailer from "nodemailer";
import ejs from "ejs";
import path from "path";
import { getUserByEmail } from "./fetchData.js"; 

// ES-module __dirname shim:
//const __filename = fileURLToPath(import.meta.url); - causing a load failure
// const __dirname = dirname(__filename);

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

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: +process.env.SMTP_PORT,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });

  const templatePath = path.join(
    __dirname,
    "..",
    "views",
    "email.ejs"
  );

  await Promise.all(
    user_emails.map(async (to, i) => {
      const { firstname = "" } = await getUserByEmail(to);
      const html = await ejs.renderFile(templatePath, {
        prompt: kindness_prompts[i],
        userName:     firstname
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
/**
 * sendNudgeEmail: minimal one-off sender.
 * Default BCC -> kai@getkindr.com. Pass bcc=null to disable.
 */
export async function sendNudgeEmail({ to, subject, text, html, bcc = 'kai@getkindr.com' }) {
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

