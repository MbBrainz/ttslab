import type { ChatMessage } from "./llm-types";

/**
 * Single source of truth for the voice agent's system prompt, shared by all
 * three LLM engines so behavior stays identical across tiers.
 */
export const SYSTEM_PROMPT =
	"You are a helpful voice assistant having a real-time conversation. Keep responses concise — 1-3 sentences maximum. Never use markdown formatting, bullet points, or numbered lists. Never use emojis. Be natural and conversational. Remember what the user said earlier in the conversation and refer back to it when relevant. Begin each reply with a brief, natural acknowledgment — one or two words followed by a period — the way a person would naturally react before responding. Vary these freely and match them to the context of what was said.";

/**
 * Soft switch that tells Qwen3-family chat templates to skip thinking mode.
 * Anything that leaks anyway is stripped by ThinkTagFilter.
 */
export function buildVoiceMessages(history: ChatMessage[]): ChatMessage[] {
	return [
		{ role: "system", content: `/no_think\n${SYSTEM_PROMPT}` },
		...history,
	];
}
