
import dotenv from 'dotenv';
dotenv.config();
import OpenAI from "openai";

// --- Initialization ---
// The dotenv config in index.js makes these available.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const assistantId = process.env.OPENAI_ASSISTANT_ID;

// --- Tool Definition ---
// This schema describes the save_kindness_type function to the Assistant.
const tools = [
  {
    type: "function",
    function: {
      name: "save_kindness_type",
      description: "Saves the user's calculated kindness type to their profile after they complete the quiz.",
      parameters: {
        type: "object",
        properties: {
          kindnessType: {
            type: "string",
            description: "The kindness type determined from the quiz, e.g., 'Empathetic Listener'."
          }
        },
        required: ["kindnessType"]
      }
    }
  }
];

// --- Exported Functions ---

// Creates a new, empty thread. This is called from index.js.
export const createThread = async () => {
  console.log('[Assistant] Creating a new thread...');
  return await openai.beta.threads.create();
};

// Main function to get a response. This replaces all your old export functions.
export const getAssistantResponse = async (message, threadId, userId, dbSaveFunction) => {
  console.log(`[Assistant] Adding message to thread ${threadId}...`);

  // 1. Add the user's message to the thread
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: message,
  });

  // 2. Create a run and provide the 'tools' (our save function)
  let run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: assistantId,
    tools: tools
  });

  // 3. Keep checking the run's status
  while (['queued', 'in_progress', 'requires_action'].includes(run.status)) {
    // If the run pauses because it needs to call our function
    if (run.status === 'requires_action') {
      const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
      const toolOutputs = [];

      for (const toolCall of toolCalls) {
        if (toolCall.function.name === "save_kindness_type") {
          const args = JSON.parse(toolCall.function.arguments);
          console.log(`[Assistant] Function call requested: save_kindness_type with arg: ${args.kindnessType}`);

          // Here we execute the actual database function from index.js
          const output = await dbSaveFunction(userId, args.kindnessType);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(output), // The result must be a string
          });
        }
      }
      // Submit the result back to the Assistant
      run = await openai.beta.threads.runs.submitToolOutputs(threadId, run.id, {
        tool_outputs: toolOutputs,
      });
    }

    await new Promise(resolve => setTimeout(resolve, 500)); // Wait before checking again
    run = await openai.beta.threads.runs.retrieve(threadId, run.id);
  }

  // 4. When the run is complete, return the final message
  if (run.status === 'completed') {
    const messages = await openai.beta.threads.messages.list(threadId);
    return messages.data[0].content[0].text.value;
  } else {
    console.error(`[Assistant] Run failed with status: ${run.status}`);
    return "I seem to be having trouble thinking. Please try again in a moment.";
  }
};