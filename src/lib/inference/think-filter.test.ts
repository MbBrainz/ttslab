import { describe, expect, it } from "vitest";
import { ThinkTagFilter } from "./think-filter";

/** Push a sequence of tokens and return the concatenation of surfaced text. */
function run(filter: ThinkTagFilter, tokens: string[]): string {
	return tokens.map((t) => filter.push(t)).join("");
}

describe("ThinkTagFilter", () => {
	it("passes plain tokens through unchanged", () => {
		const f = new ThinkTagFilter();
		expect(run(f, ["Hello", " world", "!"])).toBe("Hello world!");
		expect(f.flush()).toBe("");
	});

	it("strips a think block contained in a single token", () => {
		const f = new ThinkTagFilter();
		expect(f.push("<think>reasoning</think>Answer")).toBe("Answer");
	});

	it("strips a think block split across many tokens", () => {
		const f = new ThinkTagFilter();
		const out = run(f, [
			"<thi",
			"nk>hidden ",
			"thought",
			"</thi",
			"nk>vis",
			"ible",
		]);
		expect(out).toBe("visible");
	});

	it("strips text before <think> and discards everything inside", () => {
		const f = new ThinkTagFilter();
		const out = run(f, [
			"Hmm<think>",
			"deep thoughts",
			" keep going",
			"</think>",
			"Final",
		]);
		expect(out).toBe("HmmFinal");
	});

	it("buffers a partial opening tag without surfacing it prematurely", () => {
		const f = new ThinkTagFilter();
		// "<th" could become <think> — must be buffered, not emitted
		expect(f.push("abc<th")).toBe("abc");
		// turns out it was not a think tag — flush must return the buffered text
		expect(f.push("ink is a drink>")).toBe("<think is a drink>");
	});

	it("holds back a lone partial tag at end of stream and flushes it", () => {
		const f = new ThinkTagFilter();
		expect(f.push("text <")).toBe("text ");
		expect(f.flush()).toBe("<");
	});

	it("discards the buffer when the stream ends inside a think block", () => {
		const f = new ThinkTagFilter();
		run(f, ["<think>", "never shown"]);
		expect(f.flush()).toBe("");
	});

	it("handles multiple sequential think blocks", () => {
		const f = new ThinkTagFilter();
		const out = run(f, ["A<think>x</think>B<think>y</think>C"]);
		expect(out).toBe("ABC");
	});

	it("treats a closed think block on the same line as a complete cycle", () => {
		const f = new ThinkTagFilter();
		expect(f.push("<think></think>")).toBe("");
	});

	it("reset() clears state between generations", () => {
		const f = new ThinkTagFilter();
		run(f, ["<think>leftover"]);
		f.reset();
		expect(f.push("fresh")).toBe("fresh");
		expect(f.flush()).toBe("");
	});

	it("returns empty string for tokens inside a think block", () => {
		const f = new ThinkTagFilter();
		expect(f.push("<think>")).toBe("");
		expect(f.push("hidden")).toBe("");
		expect(f.push("</think>")).toBe("");
		expect(f.push("shown")).toBe("shown");
	});

	it("closes a block whose </think> is split at the exact boundary", () => {
		const f = new ThinkTagFilter();
		const out = run(f, ["<think>hidden<", "/thi", "nk>visible"]);
		expect(out).toBe("visible");
	});

	it("does not delay plain text when a '<' is not a think tag", () => {
		const f = new ThinkTagFilter();
		expect(f.push("2 < 3 and 5 > 1")).toBe("2 < 3 and 5 > 1");
	});

	it("strips multiple blocks that arrive inside one chunk", () => {
		const f = new ThinkTagFilter();
		expect(f.push("<think>a</think>A<think>b</think>B")).toBe("AB");
	});

	it("discards partial closing tags inside a block without leaking them", () => {
		const f = new ThinkTagFilter();
		const out = run(f, ["<think>hidden</thi", "nks</think>shown"]);
		expect(out).toBe("shown");
	});
});
