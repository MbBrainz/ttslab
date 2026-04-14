import type { WERResult } from "./types";
import { THRESHOLDS } from "./types";

const DIGIT_WORDS: Record<string, string> = {
	"0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
	"5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine",
	"10": "ten",
};

function normalizeDigits(text: string): string {
	return text.replace(/\b\d+\b/g, (match) => DIGIT_WORDS[match] ?? match);
}

function normalize(text: string): string {
	return normalizeDigits(text)
		.toLowerCase()
		.replace(/[^\w\s]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function toWords(text: string): string[] {
	const normalized = normalize(text);
	return normalized === "" ? [] : normalized.split(" ");
}

function editDistance(ref: string[], hyp: string[]): [number, number, number] {
	const m = ref.length;
	const n = hyp.length;

	// dp[i][j] = [substitutions, deletions, insertions]
	const dp: [number, number, number][][] = Array.from(
		{ length: m + 1 },
		() => Array.from({ length: n + 1 }, () => [0, 0, 0] as [number, number, number]),
	);

	for (let i = 1; i <= m; i++) dp[i][0] = [0, i, 0];
	for (let j = 1; j <= n; j++) dp[0][j] = [0, 0, j];

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			const [sS, dS, iS] = dp[i - 1][j - 1];
			const [sD, dD, iD] = dp[i - 1][j];
			const [sI, dI, iI] = dp[i][j - 1];

			const costSub = ref[i - 1] === hyp[j - 1]
				? sS + dS + iS
				: sS + 1 + dS + iS;
			const costDel = sD + dD + 1 + iD;
			const costIns = sI + dI + iI + 1;

			if (costSub <= costDel && costSub <= costIns) {
				const sub = ref[i - 1] === hyp[j - 1] ? sS : sS + 1;
				dp[i][j] = [sub, dS, iS];
			} else if (costDel <= costIns) {
				dp[i][j] = [sD, dD + 1, iD];
			} else {
				dp[i][j] = [sI, dI, iI + 1];
			}
		}
	}

	return dp[m][n];
}

export function computeWER(reference: string, hypothesis: string): WERResult {
	const refWords = toWords(reference);
	const hypWords = toWords(hypothesis);

	if (refWords.length === 0) {
		return {
			wer: hypWords.length === 0 ? 0 : 1,
			substitutions: 0,
			deletions: 0,
			insertions: hypWords.length,
			refWords: 0,
		};
	}

	if (hypWords.length === 0) {
		return {
			wer: 1,
			substitutions: 0,
			deletions: refWords.length,
			insertions: 0,
			refWords: refWords.length,
		};
	}

	const [substitutions, deletions, insertions] = editDistance(refWords, hypWords);
	const totalErrors = substitutions + deletions + insertions;
	const wer = Math.min(totalErrors / refWords.length, 1);

	return { wer, substitutions, deletions, insertions, refWords: refWords.length };
}

export function werVerdict(wer: number): "pass" | "warn" | "fail" {
	if (wer > THRESHOLDS.wer.fail) return "fail";
	if (wer >= THRESHOLDS.wer.warn) return "warn";
	return "pass";
}
