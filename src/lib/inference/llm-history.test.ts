import { describe, expect, it } from "vitest";
import { estimateMessageTokens, fitMessagesToContext } from "./llm-history";
import { LLM_CONTEXT_TOKENS } from "./llm-types";

const SYSTEM_PROMPT =
	"You are a helpful voice assistant having a real-time conversation. Keep responses concise — 1-3 sentences maximum.";

function msg(role: "user" | "assistant", content: string) {
	return { role, content };
}

describe("estimateMessageTokens", () => {
	it("grows with content length and per-message overhead", () => {
		const one = estimateMessageTokens([msg("user", "a".repeat(40))]);
		const two = estimateMessageTokens([
			msg("user", "a".repeat(40)),
			msg("assistant", "b".repeat(40)),
		]);
		// ~10 tokens of content + 8 overhead each — second message adds the
		// same amount, so exactly double.
		expect(two).toBe(one * 2);
		expect(one).toBeGreaterThanOrEqual(18);
	});
});

describe("fitMessagesToContext", () => {
	it("returns all messages unchanged when they fit the budget", () => {
		const messages = [msg("user", "hello"), msg("assistant", "hi there")];
		const result = fitMessagesToContext(messages, LLM_CONTEXT_TOKENS, {
			systemPrompt: SYSTEM_PROMPT,
		});
		expect(result.kept).toHaveLength(2);
		expect(result.kept).toEqual(messages);
		expect(result.droppedCount).toBe(0);
	});

	it("returns the input untouched when contextTokens is undefined", () => {
		const messages = [msg("user", "hello")];
		const result = fitMessagesToContext(messages, undefined);
		expect(result.kept).toBe(messages);
		expect(result.droppedCount).toBe(0);
	});

	it("drops the oldest turns first until the budget fits", () => {
		// 400 chars ≈ 100 tokens + 8 overhead = 108 per message.
		const messages = [
			msg("user", "x".repeat(400)),
			msg("assistant", "x".repeat(400)),
			msg("user", "x".repeat(400)),
			msg("assistant", "x".repeat(400)),
			msg("user", "final question"),
		];
		// Budget 107 (300 − 128 − 65): every suffix of ≥1 message exceeds it,
		// so everything but the newest turn is dropped.
		const result = fitMessagesToContext(messages, 300, {
			maxNewTokens: 128,
			safetyMarginTokens: 65,
		});
		expect(result.droppedCount).toBe(4);
		expect(result.kept).toEqual([messages[4]]);
	});

	it("keeps a contiguous newest-first window (never drops middle turns)", () => {
		const messages = [
			msg("user", "a".repeat(400)),
			msg("assistant", "b".repeat(400)),
			msg("user", "c".repeat(400)),
			msg("assistant", "d".repeat(200)),
			msg("user", "final"),
		];
		// Budget 208 (400 − 128 − 64): total 397 → drop two oldest → 179 fits.
		const result = fitMessagesToContext(messages, 400, {
			maxNewTokens: 128,
			safetyMarginTokens: 64,
		});
		expect(result.droppedCount).toBe(2);
		// Whatever is kept must be a suffix of the conversation.
		expect(result.kept).toEqual(
			messages.slice(messages.length - result.kept.length),
		);
	});

	it("never drops the most recent message even if it alone exceeds the budget", () => {
		const huge = "z".repeat(100_000); // far beyond any budget
		const messages = [msg("user", huge)];
		const result = fitMessagesToContext(messages, 1024, {});
		expect(result.kept).toHaveLength(1);
		expect(result.kept[0].content).toBe(huge);
		expect(result.droppedCount).toBe(0);
	});

	it("returns empty for empty input", () => {
		const result = fitMessagesToContext([], LLM_CONTEXT_TOKENS, {});
		expect(result.kept).toHaveLength(0);
		expect(result.droppedCount).toBe(0);
	});

	it("counts the system prompt against the budget", () => {
		const messages = [
			msg("user", "x".repeat(400)),
			msg("assistant", "x".repeat(400)),
			msg("user", "keep me"),
		];
		const withoutSystem = fitMessagesToContext(messages, 900, {
			maxNewTokens: 64,
			safetyMarginTokens: 32,
		});
		const withSystem = fitMessagesToContext(messages, 900, {
			maxNewTokens: 64,
			safetyMarginTokens: 32,
			systemPrompt: "s".repeat(4000),
		});
		// Without the system prompt everything fits; a 4000-char system prompt
		// blows the budget and forces drops.
		expect(withoutSystem.droppedCount).toBe(0);
		expect(withSystem.droppedCount).toBeGreaterThan(0);
	});

	it("ignores non-positive or non-finite budgets", () => {
		const messages = [msg("user", "hello")];
		for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
			const result = fitMessagesToContext(messages, bad, {});
			expect(result.kept).toEqual(messages);
			expect(result.droppedCount).toBe(0);
		}
	});

	it("fits the honest 4096 window for a realistic voice-agent exchange", () => {
		const conversation = Array.from({ length: 20 }, (_, i) =>
			i % 2 === 0
				? msg("user", `Question number ${i} about the weather and my day.`)
				: msg("assistant", `Answer number ${i} with a friendly remark.`),
		);
		const result = fitMessagesToContext(conversation, LLM_CONTEXT_TOKENS, {
			maxNewTokens: 256,
			systemPrompt: SYSTEM_PROMPT,
		});
		expect(result.estimatedTokens).toBeLessThanOrEqual(
			LLM_CONTEXT_TOKENS - 256,
		);
		expect(result.kept[result.kept.length - 1]).toBe(conversation[19]);
	});
});
