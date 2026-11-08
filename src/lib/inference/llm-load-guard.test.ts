import { describe, expect, it } from "vitest";
import { LlmLoadGuard } from "./llm-load-guard";

/**
 * The dedupe guard behind the voice-agent LLM (re)load path: one selection
 * must start at most one load, a genuine switch (different id) always starts,
 * and only the owning id can release a slot.
 */
describe("LlmLoadGuard", () => {
	it("dedupes a duplicate trigger for the id already in flight", () => {
		const guard = new LlmLoadGuard();
		expect(guard.begin("qwen3.5-0.8b")).toBe(true);
		// Effect re-run / drawer re-set for the same selection: no second load.
		expect(guard.begin("qwen3.5-0.8b")).toBe(false);
		expect(guard.activeId).toBe("qwen3.5-0.8b");
	});

	it("always begins a genuine switch to a different id", () => {
		const guard = new LlmLoadGuard();
		guard.begin("a");
		expect(guard.begin("b")).toBe(true);
		expect(guard.activeId).toBe("b");
	});

	it("releases the slot when the owner settles", () => {
		const guard = new LlmLoadGuard();
		guard.begin("a");
		guard.end("a");
		expect(guard.activeId).toBeNull();
		// The released id can load again (boot Retry after a failure).
		expect(guard.begin("a")).toBe(true);
	});

	it("ignores end() from a stale id — the newer switch owns the slot", () => {
		const guard = new LlmLoadGuard();
		guard.begin("a");
		guard.begin("b"); // switch while a's load is still in flight
		guard.end("a"); // a's load settles late
		expect(guard.activeId).toBe("b");
		guard.end("b");
		expect(guard.activeId).toBeNull();
	});

	it("end() for an unknown id is a no-op", () => {
		const guard = new LlmLoadGuard();
		guard.end("never-started");
		expect(guard.activeId).toBeNull();
	});
});
