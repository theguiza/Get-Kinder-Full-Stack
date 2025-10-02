export const FUNCTIONS = [
  {
    name: "send_daily_kindness_prompts",
    description:
      "Send daily kindness-prompt emails to users. " +
      "Only call this if the user is signed in. " +
      "Uses SMTP credentials from env (SMTP_HOST/PORT/USER/PASSWORD).",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["user_emails", "kindness_prompts", "subject"],
      properties: {
        user_emails: {
          type: "array",
          description: "Recipient email addresses (must align 1-to-1 with kindness_prompts).",
          minItems: 1,
          uniqueItems: true,
          items: {
            type: "string",
            format: "email",
            description: "A user's email address"
          }
        },
        kindness_prompts: {
          type: "array",
          description: "List of kindness-prompt messages to send (1-to-1 with user_emails).",
          minItems: 1,
          items: {
            type: "string",
            minLength: 1,
            description: "A kindness prompt"
          }
        },
        subject: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description: "Subject line for the email"
        },
        send_time: {
          type: "string",
          format: "date-time",
          description:
            "Optional ISO-8601 timestamp for when these were initiated (e.g., “2025-06-11T09:00:00-07:00”). " +
            "The server does not schedule delivery with this; it is informational."
        },
        transport: {
          type: "string",
          enum: ["smtp", "mailgun"],
          default: "smtp",
          description:
            "Optional. Current implementation uses SMTP via env vars. " +
            "Mailgun is not active unless implemented server-side."
        }
      }
    }
  }
];
