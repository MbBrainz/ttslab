import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "./types";
import { computeWER, werVerdict } from "./wer";

const REF = "The quick brown fox jumps over the lazy dog."; // 9 words

describe("computeWER — S/D/I breakdown", () => {
	it("scores identical text as clean", () => {
		const r = computeWER(REF, REF);
		expect(r.wer).toBe(0);
		expect(r).toMatchObject({
			substitutions: 0,
			deletions: 0,
			insertions: 0,
			refWords: 9,
		});
		expect(r.insertionRate).toBe(0);
	});

	it("attributes a wrong word to a substitution", () => {
		const r = computeWER(REF, "The quick brown fox jumps over the crazy dog.");
		expect(r).toMatchObject({ substitutions: 1, deletions: 0, insertions: 0 });
		expect(r.insertionRate).toBe(0);
	});

	it("attributes truncation to deletions", () => {
		const r = computeWER(REF, "The quick brown fox");
		expect(r).toMatchObject({ substitutions: 0, deletions: 5, insertions: 0 });
		// Truncation must NOT look like non-termination.
		expect(r.insertionRate).toBe(0);
	});

	it("attributes a repeat to insertions", () => {
		const r = computeWER(REF, `${REF} ${REF}`);
		expect(r).toMatchObject({ substitutions: 0, deletions: 0, insertions: 9 });
		expect(r.insertionRate).toBe(1);
	});
});

describe("computeWER — uncapped", () => {
	// The old code clamped to 1.0, so x2 / x3 / x5 / garbage were all exactly
	// 1.000 and severity was unrecoverable.
	it("lets WER exceed 1.0 so loop severity is rankable", () => {
		expect(computeWER(REF, `${REF} ${REF}`).wer).toBeCloseTo(1.0, 6);
		expect(computeWER(REF, `${REF} ${REF} ${REF}`).wer).toBeCloseTo(2.0, 6);
		expect(
			computeWER(REF, `${REF} ${REF} ${REF} ${REF} ${REF}`).wer,
		).toBeCloseTo(4.0, 6);
	});

	it("uncapping alone does NOT separate a 2x loop from total garbage", () => {
		// Documented so nobody re-derives it: a 2x repeat of a 9-word reference
		// is exactly 9 insertions, so both score 1.000. I/N is what separates
		// them. See the I/N test below and CLAUDE.md.
		const looped = computeWER(REF, `${REF} ${REF}`);
		const garbage = computeWER(REF, "zzz qqq vvv mmm nnn bbb ttt hhh ggg");
		expect(looped.wer).toBeCloseTo(garbage.wer, 6);
		expect(looped.wer).toBeCloseTo(1.0, 6);
	});
});

describe("insertionRate — the non-termination signal", () => {
	it("separates a 2x loop from total garbage where WER cannot", () => {
		expect(computeWER(REF, `${REF} ${REF}`).insertionRate).toBe(1);
		expect(
			computeWER(REF, "zzz qqq vvv mmm nnn bbb ttt hhh ggg").insertionRate,
		).toBe(0);
	});

	it("grows without bound as the loop count grows", () => {
		const rates = [2, 3, 5].map(
			(n) => computeWER(REF, Array(n).fill(REF).join(" ")).insertionRate,
		);
		expect(rates).toEqual([1, 2, 4]);
	});

	it("stays under the warn threshold for benign ASR fillers", () => {
		// One or two spurious words on an 8-10 word phrase must not trip the
		// gate, or every real run warns.
		const one = computeWER(
			REF,
			"The quick brown fox jumps over the the lazy dog.",
		);
		const two = computeWER(
			REF,
			"The quick brown fox um jumps over the the lazy dog.",
		);
		expect(one.insertionRate).toBeLessThan(THRESHOLDS.insertionRate.warn);
		expect(two.insertionRate).toBeLessThan(THRESHOLDS.insertionRate.warn);
	});

	it("fires on the ground-truth SpeechT5 stutter shape", () => {
		// Coherent intro, then the decoder loops real words from its own
		// reference until the length cap. Scored against ITS OWN reference —
		// a mismatched pair reports this as mispronunciation instead.
		const ref =
			"The Union developed sophisticated computer systems for the department.";
		const hyp =
			"The Union and Union and Union developed sophisticated, sophisticated computer and computer and systems for the department.";
		const r = computeWER(ref, hyp);
		expect(r.substitutions).toBe(0);
		expect(r.deletions).toBe(0);
		expect(r.insertions).toBeGreaterThan(0);
		expect(r.insertionRate).toBeGreaterThan(THRESHOLDS.insertionRate.fail);
	});
});

describe("computeWER — degenerate input", () => {
	it("treats an empty hypothesis as total deletion", () => {
		const r = computeWER(REF, "");
		expect(r).toMatchObject({
			wer: 1,
			deletions: 9,
			insertions: 0,
			refWords: 9,
		});
	});

	it("does not divide by zero on an empty reference", () => {
		expect(computeWER("", "")).toMatchObject({ wer: 0, insertionRate: 0 });
		const r = computeWER("", "some words appeared");
		expect(r.wer).toBe(1);
		expect(Number.isFinite(r.insertionRate)).toBe(true);
	});
});

describe("normalization does not hide real defects", () => {
	it("still fails garbage, loops and truncation", () => {
		expect(
			werVerdict(computeWER(REF, "zzz qqq vvv mmm nnn bbb ttt hhh ggg").wer),
		).toBe("fail");
		expect(werVerdict(computeWER(REF, `${REF} ${REF}`).wer)).toBe("fail");
		expect(werVerdict(computeWER(REF, "The quick brown").wer)).toBe("fail");
	});

	it("scores correct-but-differently-spelled output as clean", () => {
		const pairs: Array<[string, string]> = [
			[
				"The total is $42.50 for the order.",
				"The total is forty two dollars and fifty cents for the order.",
			],
			[
				"Dr. Smith will see you now please.",
				"Doctor Smith will see you now please.",
			],
			[
				"It's not the dog's fault, don't worry.",
				"It is not the dogs fault do not worry.",
			],
			[
				"The population reached 1,250 people last year.",
				"The population reached one thousand two hundred fifty people last year.",
			],
			[
				"He finished 3rd in the final race.",
				"He finished third in the final race.",
			],
			[
				"Sales grew 15% over the previous quarter.",
				"Sales grew fifteen percent over the previous quarter.",
			],
			[
				"There were forty two people in attendance.",
				"There were forty-two people in attendance.",
			],
		];
		for (const [ref, hyp] of pairs) {
			expect(computeWER(ref, hyp).wer, `${ref} vs ${hyp}`).toBe(0);
		}
	});

	// Stated as a test so the reviewer sees it rather than discovering it:
	// expanding numbers inflates refWords, which dilutes a numeric misreading.
	it("KNOWN WEAKNESS: expansion dilutes numeric misreadings", () => {
		const wrongCents = computeWER(
			"The total is $42.50 for the order.",
			"The total is forty two dollars and fifteen cents for the order.",
		);
		expect(wrongCents.substitutions).toBe(1);
		// 1 substitution in 12 expanded words — passes the WER gate.
		expect(wrongCents.wer).toBeLessThan(THRESHOLDS.wer.warn);
		expect(werVerdict(wrongCents.wer)).toBe("pass");
	});
});

describe("werVerdict", () => {
	it("maps the threshold bands", () => {
		expect(werVerdict(0)).toBe("pass");
		expect(werVerdict(THRESHOLDS.wer.warn - 0.001)).toBe("pass");
		expect(werVerdict(THRESHOLDS.wer.warn)).toBe("warn");
		expect(werVerdict(THRESHOLDS.wer.fail)).toBe("warn");
		expect(werVerdict(THRESHOLDS.wer.fail + 0.001)).toBe("fail");
	});
});
