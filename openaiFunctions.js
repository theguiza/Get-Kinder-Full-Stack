// src/openaiFunctions.js

export const FUNCTIONS = [
  {
    name: "send_daily_kindness_prompts",
    description:
      "Sends daily kindness-prompt emails via SMTP or Mailgun. " +
      "Env vars: SMTP_HOST/PORT/USER/PASSWORD",
    strict: true,
    parameters: {
      type: "object",
      required: [
        "user_emails",
        "kindness_prompts",
        "subject",
        "send_time",
        "transport"
      ],
      properties: {
        user_emails: {
          type: "array",
          description: "Recipient email addresses",
          items: {
            type: "string",
            format: "email",
            description: "A user's email address"
          }
        },
        kindness_prompts: {
          type: "array",
          description: "List of kindness-prompt messages to send",
          items: {
            type: "string",
            description: "A kindness prompt"
          }
        },
        subject: {
          type: "string",
          description: "Subject line for the email"
        },
        send_time: {
          type: "string",
          format: "date-time",
          description:
            "ISO-8601 timestamp at which to send " +
            "(e.g. “2025-06-11T09:00:00-07:00”)"
        },
        transport: {
          type: "string",
          enum: ["smtp", "mailgun"],
          default: "smtp",
          description:
            "Which email transport to use; " +
            "SMTP falls back to env vars SMTP_HOST/PORT/USER/PASSWORD, " +
            "Mailgun uses MAILGUN_API_KEY & MAILGUN_DOMAIN"
        }
      },
      additionalProperties: false
    }
  }
];
