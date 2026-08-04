export interface IntegrityResult {
	nanCount: number;
	infiniteCount: number;
	/** Mean sample value. A non-zero mean is a DC offset. */
	dcOffset: number;
	/** DC offset relative to RMS, in dB. -Infinity when there is no offset. */
	dcOffsetDb: number;
	/** True when the buffer is safe to feed to the other metrics. */
	usable: boolean;
}

/**
 * Runs FIRST, ahead of every other metric.
 *
 * A single NaN sample propagates through every sum and every transform in this
 * stack and silently turns the whole report into NaN — measured on the existing
 * `measureEnergy`, which reports NaN rather than flagging anything. NaN is not
 * a quality score, it is a broken tensor, and it must short-circuit rather than
 * poison the rest of the analysis.
 *
 * DC is separate but belongs here for the same reason: the spec's landmine note
 * is that DC at -10dB drags a linear-magnitude spectral centroid from 1550 to
 * 1178 Hz, so any spectral measure taken without removing it is wrong.
 */
export function checkIntegrity(pcm: Float32Array): IntegrityResult {
	let nanCount = 0;
	let infiniteCount = 0;
	let sum = 0;
	let sumSquares = 0;

	for (let i = 0; i < pcm.length; i++) {
		const sample = pcm[i];
		if (Number.isNaN(sample)) {
			nanCount++;
			continue;
		}
		if (!Number.isFinite(sample)) {
			infiniteCount++;
			continue;
		}
		sum += sample;
		sumSquares += sample * sample;
	}

	const finiteCount = pcm.length - nanCount - infiniteCount;
	const dcOffset = finiteCount > 0 ? sum / finiteCount : 0;
	const rms = finiteCount > 0 ? Math.sqrt(sumSquares / finiteCount) : 0;
	const dcRatio = rms > 0 ? Math.abs(dcOffset) / rms : 0;

	return {
		nanCount,
		infiniteCount,
		dcOffset,
		dcOffsetDb:
			dcRatio > 0 ? 20 * Math.log10(dcRatio) : Number.NEGATIVE_INFINITY,
		usable: nanCount === 0 && infiniteCount === 0 && pcm.length > 0,
	};
}
