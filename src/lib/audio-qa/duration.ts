import { toWords } from "../testing/text-normalize";

export interface DurationResult {
	actualSec: number;
	expectedSec: number;
	/** actual / expected. Names the bug: ~0.5 truncated, ~2.0 doubled. */
	ratio: number;
	/** Symmetric severity — an octave either way is the same magnitude. */
	log2Ratio: number;
	wordCount: number;
}

/**
 * Words per second of synthesized speech.
 *
 * CALIBRATED, not assumed — measured against every real Kokoro render in this
 * repo with known source text, including one produced by an actual harness run:
 *
 *   hero-demo-1     13 words / 6.22s = 2.09 w/s
 *   hero-demo-2     13 words / 6.33s = 2.05 w/s
 *   hero-demo-3     12 words / 4.95s = 2.42 w/s
 *   qa-run pangram   9 words / 3.30s = 2.73 w/s   \
 *   qa-run alice    11 words / 3.48s = 3.16 w/s    > scripts/model-qa.mjs, WebGPU
 *   qa-run oranges  10 words / 3.67s = 2.72 w/s   /
 *
 * 2.5 is the geometric mean of those six, which minimizes worst-case log2
 * error (0.338).
 *
 * THE CAVEAT THAT MATTERS MOST: within this ONE model the rate spans
 * 2.05-3.16 w/s — a 1.54x spread, log2 0.62. Legitimate phrase-to-phrase
 * variation is therefore the same order as the thing being detected. The
 * "alice" phrase measured log2 -0.399 against what was then a 0.40 warn: it
 * came within 0.001 of warning on perfectly correct output, which is what
 * forced this recalibration.
 *
 * So: a slower or faster model WILL warn. Pass `wordsPerSecond` for it rather
 * than widening the threshold for everyone.
 *
 * Word counts come from the WER normalizer on purpose: "$1,234,567.89" is 13
 * characters but ~9 spoken words, so a character-rate prior would be wrong by
 * an order of magnitude on numeric text.
 */
const WORDS_PER_SECOND = 2.5;

/**
 * Duration plausibility, per spec Tier-1 #2. Runs PRE-ASR — it needs no model
 * and it is the only detector that can catch a sample-rate relabel.
 *
 * A relabel changes no sample: the DFT magnitudes are bit-identical and only
 * the frequency labels scale, so Nyquist-edge detection cannot see it even in
 * principle. A rate error is a time-base error, so duration is the detector.
 */
export function measureDuration(
	pcm: Float32Array,
	sampleRate: number,
	text: string,
	wordsPerSecond = WORDS_PER_SECOND,
): DurationResult {
	const actualSec = sampleRate > 0 ? pcm.length / sampleRate : 0;
	const wordCount = toWords(text).length;
	const expectedSec = wordCount / wordsPerSecond;

	if (expectedSec <= 0 || actualSec <= 0) {
		return { actualSec, expectedSec, ratio: 0, log2Ratio: 0, wordCount };
	}

	const ratio = actualSec / expectedSec;
	return {
		actualSec,
		expectedSec,
		ratio,
		log2Ratio: Math.log2(ratio),
		wordCount,
	};
}
