import OpenAI from 'openai'; 
const apiKey = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = "asst_mGJF5SnwFuvlG050xBUbEKuk"; 
require('dotenv').config(); // ✅ Needed to load .env variables

function getHeaders(apiKey) {
	return{
		"Content-Type": "application/json",
		"Authorization": `Bearer ${apiKey}`,
		"OpenAI-Beta": "assistants=v2",
	};
}
export async function createThread() {
	const apiKey = process.env.OPENAI_API_KEY; 
	if (!apiKey) {
		throw new Error("Missing OPENAI_API_KEY in environment variables.");
	  }

	const endpoint = 'https://api.openai.com/v1/threads';
	const options = {
			method: "POST",
 			headers:  getHeaders(apiKey),
			body: JSON.stringify({}),   
    };

	try {
		const response = await fetch(endpoint, options);
		if (!response.ok) {
		  const errorBody = await response.text();
		  throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
		}
	
		const data = await response.json();
		return data;
	  } catch (err) {
		console.error("❌ Error creating thread:", err.message || err);
		throw err; // Re-throw for calling functions to handle
	  }
	}
    
export async function  listMessages(threadId) {
	const endpoint = `https://api.openai.com/v1/threads/${threadId}/messages` ;
	const apiKey = process.env.OPENAI_API_KEY; 
	const options = {
	method: "GET",
 	headers:  getHeaders(apiKey),
    }
	const response = await fetch(endpoint, options);
	const data = await response.json();
	return data;

}

export async function createMessage(threadId, content) {
	const endpoint = `https://api.openai.com/v1/threads/${threadId}/messages` ;
	const apiKey = process.env.OPENAI_API_KEY; 
	const options = {
		method: "POST",
		headers:  getHeaders(apiKey),
		body: JSON.stringify({ 
			role: 'user', 
			content
		})
	}
	const response = await fetch(endpoint, options);
	const data = await response.json();
	return data;
}
export async function runAssistant(threadId) {
	const endpoint = `https://api.openai.com/v1/threads/${threadId}/runs` ;
	const apiKey = process.env.OPENAI_API_KEY; 
	const options = {
		method: "POST",
		headers:  getHeaders(apiKey),
		body: JSON.stringify({
			assistant_id: ASSISTANT_ID 
		})
	}
	const response = await fetch(endpoint, options);
	const data = await response.json();
	return data;
}

export async function retrieveRun(threadId, runId) { // add wixChatChannelId here too
	const endpoint = `https://api.openai.com/v1/threads/${threadId}/runs/${runId}` ;
	const apiKey = process.env.OPENAI_API_KEY; 
	const options = {
	method: "GET",
 	headers:  getHeaders(apiKey),
    }
    
	const response = await fetch(endpoint, options);
	const data = await response.json();
	// await sendMessageToFrontEnd(wixChatChannelId, data) // this is for the realtime api
	return data;
}

export async function createAndPollRun(threadId) {
	const run = await runAssistant(threadId);
	const runId = run.id;
	let status = run.status;
	let timeout = 0;
	while (status !== 'completed' && timeout < 30) {
		timeout++
		const run = await retrieveRun(threadId, runId);
		console.log("status", status);
		await delay(3000);
	}
	return runId;
}

const delay = (ms) => new Promise((resolve, reject)=> setTimeout(() => {
	resolve();
	}, ms))













