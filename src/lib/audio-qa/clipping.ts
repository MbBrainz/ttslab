export interface RunClippingResult {
	/** Number of runs of >= MIN_RUN consecutive samples at/over the ceiling. */
	runCount: number;
	longestRunSamples: number;
	/** Samples that belong to a qualifying run, over total samples. */
	clippedFraction: number;
	/** Samples at/over the ceiling regardless of run length — diagnostic only. */
	ceilingSampleCount: number;
}

const CEILING = 0.99;
/**
 * A run of 3 is the shortest that cannot happen by chance at a waveform peak.
 * A single sample reaching full scale is a legitimate peak — the existing
 * per-sample `detectClipping` reports count 1 for exactly that, which is noise
 * rather than a defect. Overdrive flattens the waveform, producing runs.
 */
const MIN_RUN = 3;

/** Consecutive-run clipping detection, per spec Tier-1 #6. */
export function detectRunClipping(pcm: Float32Array): RunClippingResult {
	let runCount = 0;
	let longestRunSamples = 0;
	let clippedSamples = 0;
	let ceilingSampleCount = 0;
	let currentRun = 0;

	const closeRun = () => {
		if (currentRun >= MIN_RUN) {
			runCount++;
			clippedSamples += currentRun;
			if (currentRun > longestRunSamples) longestRunSamples = currentRun;
		}
		currentRun = 0;
	};

	for (let i = 0; i < pcm.length; i++) {
		if (Math.abs(pcm[i]) >= CEILING) {
			ceilingSampleCount++;
			currentRun++;
		} else {
			closeRun();
		}
	}
	closeRun();

	return {
		runCount,
		longestRunSamples,
		clippedFraction: pcm.length === 0 ? 0 : clippedSamples / pcm.length,
		ceilingSampleCount,
	};
}
