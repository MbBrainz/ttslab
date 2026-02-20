import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

export async function POST(req: Request) {
	const { messages } = await req.json();

	const result = streamText({
		model: openai("gpt-4o-mini"),
		system:
			"You are a helpful voice assistant having a real-time conversation. Keep responses concise — 1-3 sentences maximum. Never use markdown formatting, bullet points, or numbered lists. Never use emojis. Be natural and conversational. Remember what the user said earlier in the conversation and refer back to it when relevant.",
		messages,
	});

	return result.toTextStreamResponse();
}
