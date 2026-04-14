import type {
	EchoResult,
	SilenceResult,
	ClippingResult,
	EnergyResult,
	AudioAnalysis,
} from "./types";
import { THRESHOLDS } from "./types";

function autocorrelationAt(pcm: Float32Array, delaySamples: number): number {
	const n = pcm.length - delaySamples;
	if (n <= 0) return 0;

	let sum = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < n; i++) {
		sum += pcm[i] * pcm[i + delaySamples];
		normA += pcm[i] * pcm[i];
		normB += pcm[i + delaySamples] * pcm[i + delaySamples];
	}

	const denom = Math.sqrt(normA * normB);
	return denom === 0 ? 0 : sum / denom;
}

export function detectEcho(
	pcm: Float32Array,
	sampleRate: number,
): EchoResult {
	const minDelay = Math.round(sampleRate * 0.05);
	const maxDelay = Math.round(sampleRate * 0.5);
	const step = Math.round(sampleRate * 0.005);

	let peakCorr = 0;
	let peakDelay = minDelay;

	for (let d = minDelay; d <= maxDelay; d += step) {
		const corr = autocorrelationAt(pcm, d);
		if (corr > peakCorr) {
			peakCorr = corr;
			peakDelay = d;
		}
	}

	return {
		detected: peakCorr > THRESHOLDS.echo.warn,
		peakDelayMs: (peakDelay / sampleRate) * 1000,
		confidence: peakCorr,
	};
}

export function measureSilence(
	pcm: Float32Array,
	sampleRate: number,
): SilenceResult {
	const threshold = 0.001;
	const len = pcm.length;

	let silentCount = 0;
	for (let i = 0; i < len; i++) {
		if (Math.abs(pcm[i]) < threshold) silentCount++;
	}

	let leadingSamples = 0;
	while (leadingSamples < len && Math.abs(pcm[leadingSamples]) < threshold) {
		leadingSamples++;
	}

	let trailingSamples = 0;
	while (
		trailingSamples < len &&
		Math.abs(pcm[len - 1 - trailingSamples]) < threshold
	) {
		trailingSamples++;
	}

	const samplesToMs = (s: number) => (s / sampleRate) * 1000;

	return {
		ratio: len === 0 ? 0 : silentCount / len,
		leadingMs: samplesToMs(leadingSamples),
		trailingMs: samplesToMs(trailingSamples),
	};
}

export function detectClipping(pcm: Float32Array): ClippingResult {
	const threshold = 0.99;
	let count = 0;

	for (let i = 0; i < pcm.length; i++) {
		if (Math.abs(pcm[i]) >= threshold) count++;
	}

	return {
		ratio: pcm.length === 0 ? 0 : count / pcm.length,
		count,
	};
}

function toDb(linear: number): number {
	if (linear === 0) return -Infinity;
	return 20 * Math.log10(linear);
}

export function measureEnergy(pcm: Float32Array): EnergyResult {
	if (pcm.length === 0) {
		return { rmsDb: -Infinity, peakDb: -Infinity, dynamicRange: 0 };
	}

	let sumSq = 0;
	let peak = 0;

	for (let i = 0; i < pcm.length; i++) {
		const abs = Math.abs(pcm[i]);
		sumSq += pcm[i] * pcm[i];
		if (abs > peak) peak = abs;
	}

	const rms = Math.sqrt(sumSq / pcm.length);
	const rmsDb = toDb(rms);
	const peakDb = toDb(peak);

	return {
		rmsDb,
		peakDb,
		dynamicRange: peakDb - rmsDb,
	};
}

export function analyzeAudio(
	pcm: Float32Array,
	sampleRate: number,
): AudioAnalysis {
	return {
		echo: detectEcho(pcm, sampleRate),
		silence: measureSilence(pcm, sampleRate),
		clipping: detectClipping(pcm),
		energy: measureEnergy(pcm),
	};
}
