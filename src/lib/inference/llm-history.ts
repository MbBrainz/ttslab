import type { ChatMessage } from "./llm-types";

/**
 * Multi-turn context fitting for the transformers.js LLM engine.
 *
 * The worker deliberately does NOT persist the KV cache across turns (see
 * llm-worker.ts for why), so the message list it prefills IS the entire
 * context cost every turn. This module owns the honest context pin: trim the
 * oldest turns so that system prompt + kept history + the next answer always
 * fit the advertised window (`contextTokens`).
 */

/**
 * Rough token estimate. English across Qwen-class BPE tokenizers lands near
 * 4 chars/token; +8 covers the chat-template scaffolding per message (role
 * markers, newlines, <|im_start|>/<|im_end|>). Heuristic on purpose — an
 * underestimate degrades quality gracefully (RoPE extrapolation), it does not
 * crash; the 256-token safety margin absorbs the error.
 */
const CHARS_PER_TOKEN = 4;
const PER_MESSAGE_OVERHEAD_TOKENS = 8;

export function estimateMessageTokens(messages: ChatMessage[]): number {
	let total = 0;
	for (const message of messages) {
		total +=
			Math.ceil(message.content.length / CHARS_PER_TOKEN) +
			PER_MESSAGE_OVERHEAD_TOKENS;
	}
	return total;
}

export interface ContextFitOptions {
	/** Max tokens reserved for the next answer. Defaults to 256. */
	maxNewTokens?: number;
	/** Tokens kept unbudgeted for estimation error. Defaults to 256. */
	safetyMarginTokens?: number;
	/** System prompt sent with the history (counted against the budget). */
	systemPrompt?: string;
}

export interface ContextFitResult {
	/** The messages to send, oldest-first, always non-empty for non-empty input. */
	kept: ChatMessage[];
	/** How many oldest turns were dropped to fit the budget. */
	droppedCount: number;
	/** Estimated tokens of systemPrompt + kept (when a budget was given). */
	estimatedTokens: number;
}

/**
 * Trim a conversation to fit a context window. Newest turns win: the most
 * recent message is never dropped (it is the turn the model must answer), and
 * the result is never empty for non-empty input — an oversized last message is
 * kept as-is and simply overflows the heuristic budget.
 *
 * `contextTokens` undefined disables the trim (returns the input unchanged) —
 * engines that pin context at load time (webllm `context_window_size`, wllama
 * `n_ctx`) do not need it.
 */
export function fitMessagesToContext(
	messages: ChatMessage[],
	contextTokens: number | undefined,
	options: ContextFitOptions = {},
): ContextFitResult {
	if (
		contextTokens === undefined ||
		!Number.isFinite(contextTokens) ||
		contextTokens <= 0 ||
		messages.length === 0
	) {
		return {
			kept: messages,
			droppedCount: 0,
			estimatedTokens: estimateMessageTokens(messages),
		};
	}

	const maxNewTokens = options.maxNewTokens ?? 256;
	const safetyMarginTokens = options.safetyMarginTokens ?? 256;
	const systemTokens = options.systemPrompt
		? Math.ceil(options.systemPrompt.length / CHARS_PER_TOKEN) +
			PER_MESSAGE_OVERHEAD_TOKENS
		: 0;
	const budget = Math.max(
		0,
		contextTokens - maxNewTokens - safetyMarginTokens - systemTokens,
	);

	let kept = [...messages];
	while (kept.length > 1 && estimateMessageTokens(kept) > budget) {
		kept = kept.slice(1);
	}

	return {
		kept,
		droppedCount: messages.length - kept.length,
		estimatedTokens: estimateMessageTokens(kept) + systemTokens,
	};
}
