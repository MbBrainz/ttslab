export interface FrameSilenceResult {
	/** Fraction of 20ms frames below the silence gate. */
	silenceFraction: number;
	/** Fraction below the (higher) pause gate — includes low-level speech tails. */
	pauseFraction: number;
	leadingMs: number;
	trailingMs: number;
	/** Contiguous runs of speech frames. 0 means dead audio. */
	segmentCount: number;
	longestSilenceMs: number;
	frameCount: number;
}

const FRAME_MS = 20;

/**
 * Gates are relative to the signal's own PEAK, not to full scale.
 *
 * This is a deliberate departure from the spec, which prescribes a fixed
 * -45 dBFS gate and calls it level-independent. It is not. Measured on one
 * fixture scaled to four levels, a fixed -45 dBFS gate is *worse* than the
 * per-sample test it replaces:
 *
 *   level    per-sample (old)   fixed -45 dBFS   peak-relative (shipped)
 *   0 dB           0.230            0.235              0.235
 *   -20 dB         0.337            0.470              0.235
 *   -34 dB         0.533            0.990              0.235
 *   -46 dB         0.900            1.000              0.235
 *
 * An absolute gate must call a quiet signal silent — that is what absolute
 * means. Since TTS output levels vary per model, that is exactly the failure
 * the check exists to avoid. Peak-relative gating is scale-invariant because
 * scaling moves the signal and its gate together.
 */
const SILENCE_BELOW_PEAK_DB = 40;
/**
 * Pause gate, 30dB below peak. Deliberately higher than the silence gate:
 * superimposed speech fills each other's gaps, so pause fraction DROPS when two
 * voices overlap. That is the only Tier-1 signal with any sensitivity to
 * variable-speed overlap, which the cepstral metric is structurally blind to.
 */
const PAUSE_BELOW_PEAK_DB = 30;
/**
 * Below this absolute peak level the buffer has no signal to be relative to, so
 * peak-relative gating is meaningless and it is simply dead audio.
 */
const DEAD_AUDIO_PEAK_DBFS = -60;

function frameRmsDb(pcm: Float32Array, start: number, end: number): number {
	let sumSquares = 0;
	for (let i = start; i < end; i++) sumSquares += pcm[i] * pcm[i];
	const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
	return rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY;
}

function peakDb(pcm: Float32Array): number {
	let peak = 0;
	for (let i = 0; i < pcm.length; i++) {
		const abs = Math.abs(pcm[i]);
		if (abs > peak) peak = abs;
	}
	return peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY;
}

const ALL_SILENT: FrameSilenceResult = {
	silenceFraction: 1,
	pauseFraction: 1,
	leadingMs: 0,
	trailingMs: 0,
	segmentCount: 0,
	longestSilenceMs: 0,
	frameCount: 0,
};

/**
 * Frame-RMS silence measurement, replacing the per-sample |x| < 0.001 test.
 *
 * Two problems with the old test, both measured:
 * - It is level-dependent. Same clean speech, no silence added: 0.230 at full
 *   level, 0.900 at -46dB.
 * - It counts a tone's zero crossings as silence. A 200Hz sine at 16kHz reads
 *   2.5% silent with no silence present; framing reports 0.000.
 */
export function measureFrameSilence(
	pcm: Float32Array,
	sampleRate: number,
): FrameSilenceResult {
	const frameSize = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
	const frameCount = Math.floor(pcm.length / frameSize);
	if (frameCount === 0) return ALL_SILENT;

	const peak = peakDb(pcm);
	if (peak < DEAD_AUDIO_PEAK_DBFS) return { ...ALL_SILENT, frameCount };

	const silenceGate = peak - SILENCE_BELOW_PEAK_DB;
	const pauseGate = peak - PAUSE_BELOW_PEAK_DB;

	const silent: boolean[] = [];
	let pauseFrames = 0;
	for (let f = 0; f < frameCount; f++) {
		const db = frameRmsDb(pcm, f * frameSize, (f + 1) * frameSize);
		silent.push(db < silenceGate);
		if (db < pauseGate) pauseFrames++;
	}

	return {
		silenceFraction: silent.filter(Boolean).length / frameCount,
		pauseFraction: pauseFrames / frameCount,
		leadingMs: countEdge(silent, "leading") * FRAME_MS,
		trailingMs: countEdge(silent, "trailing") * FRAME_MS,
		segmentCount: countSegments(silent),
		longestSilenceMs: longestRun(silent) * FRAME_MS,
		frameCount,
	};
}

function countEdge(silent: boolean[], side: "leading" | "trailing"): number {
	const frames = side === "leading" ? silent : [...silent].reverse();
	let count = 0;
	while (count < frames.length && frames[count]) count++;
	return count;
}

/** Contiguous speech runs — the babbling/fragmentation signal. */
function countSegments(silent: boolean[]): number {
	let segments = 0;
	let inSpeech = false;
	for (const isSilent of silent) {
		if (!isSilent && !inSpeech) segments++;
		inSpeech = !isSilent;
	}
	return segments;
}

function longestRun(silent: boolean[]): number {
	let longest = 0;
	let current = 0;
	for (const isSilent of silent) {
		current = isSilent ? current + 1 : 0;
		if (current > longest) longest = current;
	}
	return longest;
}
