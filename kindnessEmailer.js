import nodemailer from "nodemailer";
import ejs from "ejs";
import path from "path";
import { getUserByEmail } from "./fetchData.js"; 

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
      const html = await ejs.renderFile(templatePath, {
        prompt: kindness_prompts[i]
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
