import { toWords } from "./text-normalize";
import type { Verdict, WERResult } from "./types";
import { THRESHOLDS } from "./types";

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

/**
 * `I/N` — insertions per reference word. Unlike WER this is unbounded and
 * ignores substitutions, which makes it the primary non-termination signal:
 * a decoder that loops inserts words without substituting any, so I/N grows
 * linearly with how many extra passes it made (x2 -> 1.0, x3 -> 2.0) while
 * WER saturates at 1.0 and cannot be told apart from total garbage.
 */
function insertionRate(insertions: number, refWords: number): number {
	return refWords === 0 ? 0 : insertions / refWords;
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
			insertionRate: 0,
		};
	}

	if (hypWords.length === 0) {
		return {
			wer: 1,
			substitutions: 0,
			deletions: refWords.length,
			insertions: 0,
			refWords: refWords.length,
			insertionRate: 0,
		};
	}

	const [substitutions, deletions, insertions] = editDistance(refWords, hypWords);
	const totalErrors = substitutions + deletions + insertions;

	// Deliberately UNCAPPED. Clamping to 1.0 made "said it twice" and "emitted
	// pure noise" both score exactly 1.000, hiding the severity and the failure
	// mode. Nothing regresses: every value the clamp used to touch was already
	// >= 1.0 and therefore already failing.
	const wer = totalErrors / refWords.length;

	return {
		wer,
		substitutions,
		deletions,
		insertions,
		refWords: refWords.length,
		insertionRate: insertionRate(insertions, refWords.length),
	};
}

export function werVerdict(wer: number): Verdict {
	if (wer > THRESHOLDS.wer.fail) return "fail";
	if (wer >= THRESHOLDS.wer.warn) return "warn";
	return "pass";
}
