import { type AudioQaMetrics, analyzeAudioQa } from "../audio-qa";
import { measureEnergy } from "./audio-analysis";
import { computeWER, werVerdict } from "./wer";
import type {
	QualityReport,
	PhraseResult,
	TestConfig,
	TestPhrase,
	CheckFailure,
	EnergyResult,
	Verdict,
	WERResult,
} from "./types";
import { DEFAULT_PHRASES, THRESHOLDS } from "./types";

// ── Worker API shape (duck-typed, not imported) ──────────────────────

export interface InferenceWorkerAPI {
	loadModel(
		slug: string,
		options: {
			backend: "webgpu" | "wasm" | "auto";
			onProgress?: (p: unknown) => void;
		},
	): Promise<{
		backend: string;
		loadTime: number;
		voices: Array<{ id: string; name: string }>;
		languages: string[];
	}>;
	synthesize(
		slug: string,
		text: string,
		voice: string,
		speakerEmbeddingUrl?: string,
		speed?: number,
		language?: string,
	): Promise<{
		audio: Float32Array;
		sampleRate: number;
		duration: number;
		metrics: { totalMs: number; backend: string };
	}>;
	transcribe(
		slug: string,
		audio: Float32Array,
		sampleRate: number,
	): Promise<{ text: string; metrics: { totalMs: number } }>;
	disposeModel(slug: string): Promise<void>;
}

// ── Progress callback ────────────────────────────────────────────────

export interface ProgressUpdate {
	phase: "loading-stt" | "testing-model" | "done";
	modelSlug?: string;
	modelIndex?: number;
	totalModels?: number;
	phraseIndex?: number;
	totalPhrases?: number;
	message: string;
}

// ── Constants ────────────────────────────────────────────────────────

const SUPPORTED_TTS_MODELS = [
	"kokoro-82m",
	"supertonic-2",
	"speecht5",
	"piper-en-us-lessac-medium",
	"chatterbox",
	"chatterbox-turbo",
];

const DEFAULT_STT_MODEL = "moonshine-tiny";
const TARGET_SAMPLE_RATE = 16_000;

// ── Audio resampling ─────────────────────────────────────────────────

function resampleAudio(
	pcm: Float32Array,
	fromRate: number,
	toRate: number,
): Float32Array {
	if (fromRate === toRate) return pcm;

	const ratio = fromRate / toRate;
	const outLen = Math.round(pcm.length / ratio);
	const out = new Float32Array(outLen);

	for (let i = 0; i < outLen; i++) {
		const srcIdx = i * ratio;
		const lo = Math.floor(srcIdx);
		const hi = Math.min(lo + 1, pcm.length - 1);
		const frac = srcIdx - lo;
		out[i] = pcm[lo] * (1 - frac) + pcm[hi] * frac;
	}

	return out;
}

// ── Verdict logic ────────────────────────────────────────────────────

/** Everything a gating rule is allowed to look at. */
interface CheckContext {
	qa: AudioQaMetrics;
	energy: EnergyResult;
	wer: WERResult;
}

/**
 * One gating rule: pull a scalar out of the context, compare it against its
 * warn/fail thresholds. `direction` says which side of the threshold is bad.
 */
interface CheckRule {
	check: string;
	value: (ctx: CheckContext) => number;
	warn: number;
	fail: number;
	direction: "above" | "below";
}

const CHECK_RULES: CheckRule[] = [
	{
		// Runs first. NaN compares false against every threshold, so without an
		// explicit count a broken tensor would sail through as a pass.
		check: "integrity",
		value: (c) => c.qa.integrity.nanCount + c.qa.integrity.infiniteCount,
		warn: 0,
		fail: 0,
		direction: "above",
	},
	{
		// Replaces the old `echo` autocorrelation, which could not see the 1-5s
		// duplication it existed to catch. See cepstrum.ts for the measurements.
		check: "cepstral_repeat",
		value: (c) => c.qa.cepstral.ratio,
		warn: THRESHOLDS.cepstralRatio.warn,
		fail: THRESHOLDS.cepstralRatio.fail,
		direction: "above",
	},
	{
		check: "duration",
		value: (c) => Math.abs(c.qa.duration?.log2Ratio ?? 0),
		warn: THRESHOLDS.durationLog2Ratio.warn,
		fail: THRESHOLDS.durationLog2Ratio.fail,
		direction: "above",
	},
	{
		// Peak-relative frame RMS, replacing the level-dependent per-sample test.
		check: "silence",
		value: (c) => c.qa.silence.silenceFraction,
		warn: THRESHOLDS.frameSilence.warn,
		fail: THRESHOLDS.frameSilence.fail,
		direction: "above",
	},
	{
		// Consecutive-run based, so an isolated full-scale peak no longer counts.
		check: "clipping",
		value: (c) => c.qa.clipping.clippedFraction,
		warn: THRESHOLDS.clippedFraction.warn,
		fail: THRESHOLDS.clippedFraction.fail,
		direction: "above",
	},
	{
		check: "dc_offset",
		value: (c) => c.qa.integrity.dcOffsetDb,
		warn: THRESHOLDS.dcOffsetDb.warn,
		fail: THRESHOLDS.dcOffsetDb.fail,
		direction: "above",
	},
	{
		check: "energy",
		value: (c) => c.energy.rmsDb,
		warn: THRESHOLDS.energyDb.warn,
		fail: THRESHOLDS.energyDb.fail,
		direction: "below",
	},
	{
		check: "wer",
		value: (c) => c.wer.wer,
		warn: THRESHOLDS.wer.warn,
		fail: THRESHOLDS.wer.fail,
		direction: "above",
	},
	{
		check: "insertion_rate",
		value: (c) => c.wer.insertionRate,
		warn: THRESHOLDS.insertionRate.warn,
		fail: THRESHOLDS.insertionRate.fail,
		direction: "above",
	},
];

function breaches(value: number, threshold: number, direction: "above" | "below"): boolean {
	return direction === "above" ? value > threshold : value < threshold;
}

function evaluateRule(rule: CheckRule, ctx: CheckContext): CheckFailure | null {
	const value = rule.value(ctx);
	if (breaches(value, rule.fail, rule.direction)) {
		return { check: rule.check, value, threshold: rule.fail, severity: "fail" };
	}
	if (breaches(value, rule.warn, rule.direction)) {
		return { check: rule.check, value, threshold: rule.warn, severity: "warn" };
	}
	return null;
}

/** Worst severity wins. */
function phraseVerdict(ctx: CheckContext): { verdict: Verdict; failures: CheckFailure[] } {
	const failures = CHECK_RULES.map((r) => evaluateRule(r, ctx)).filter(
		(f): f is CheckFailure => f !== null,
	);

	if (failures.some((f) => f.severity === "fail")) return { verdict: "fail", failures };
	if (failures.length > 0) return { verdict: "warn", failures };
	return { verdict: "pass", failures };
}

function overallVerdict(tests: PhraseResult[], errors: string[]): Verdict {
	if (errors.length > 0) return "fail";
	if (tests.some((t) => t.verdict === "fail")) return "fail";
	if (tests.some((t) => t.verdict === "warn")) return "warn";
	return "pass";
}

// ── Single phrase test ───────────────────────────────────────────────

async function testPhrase(
	worker: InferenceWorkerAPI,
	modelSlug: string,
	sttModel: string,
	phrase: TestPhrase,
	voice: string,
): Promise<PhraseResult> {
	const result = await worker.synthesize(modelSlug, phrase.text, voice);

	// Reference text is passed so the duration check has an expectation to
	// compare against — it is the only pre-ASR detector of a rate relabel.
	const qa = analyzeAudioQa(result.audio, result.sampleRate, phrase.text);
	const energy = measureEnergy(result.audio);

	const resampled =
		result.sampleRate !== TARGET_SAMPLE_RATE
			? resampleAudio(result.audio, result.sampleRate, TARGET_SAMPLE_RATE)
			: result.audio;

	const transcript = await worker.transcribe(sttModel, resampled, TARGET_SAMPLE_RATE);
	const werResult = computeWER(phrase.text, transcript.text);
	const { verdict, failures } = phraseVerdict({ qa, energy, wer: werResult });

	return {
		phrase: phrase.text,
		category: phrase.category,
		generationMs: result.metrics.totalMs,
		sampleRate: result.sampleRate,
		qa,
		energy,
		verdict,
		failures,
		sttRoundTrip: {
			transcription: transcript.text,
			wer: werResult.wer,
			substitutions: werResult.substitutions,
			deletions: werResult.deletions,
			insertions: werResult.insertions,
			refWords: werResult.refWords,
			insertionRate: werResult.insertionRate,
			verdict: werVerdict(werResult.wer),
		},
	};
}

// ── Single model test ────────────────────────────────────────────────

async function testModel(
	worker: InferenceWorkerAPI,
	slug: string,
	sttModel: string,
	phrases: TestPhrase[],
	backend: "webgpu" | "wasm" | "auto",
	onProgress?: (u: ProgressUpdate) => void,
	modelIndex?: number,
	totalModels?: number,
): Promise<QualityReport> {
	const errors: string[] = [];
	const tests: PhraseResult[] = [];
	let loadTimeMs = 0;
	let actualBackend: "webgpu" | "wasm" = "wasm";

	try {
		const loaded = await worker.loadModel(slug, { backend });
		loadTimeMs = loaded.loadTime;
		actualBackend = loaded.backend as "webgpu" | "wasm";

		const voice = loaded.voices[0]?.id ?? "default";

		for (let i = 0; i < phrases.length; i++) {
			onProgress?.({
				phase: "testing-model",
				modelSlug: slug,
				modelIndex,
				totalModels,
				phraseIndex: i,
				totalPhrases: phrases.length,
				message: `[${slug}] Testing phrase ${i + 1}/${phrases.length}`,
			});

			try {
				const result = await testPhrase(worker, slug, sttModel, phrases[i], voice);
				tests.push(result);
			} catch (err) {
				errors.push(`Phrase "${phrases[i].text}": ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	} catch (err) {
		errors.push(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
	}

	try {
		await worker.disposeModel(slug);
	} catch {
		// swallow dispose errors
	}

	return {
		slug,
		timestamp: new Date().toISOString(),
		overall: overallVerdict(tests, errors),
		loadTimeMs,
		backend: actualBackend,
		tests,
		errors,
	};
}

// ── Main entry point ─────────────────────────────────────────────────

export async function runQualityTests(
	worker: InferenceWorkerAPI,
	config: TestConfig,
	onProgress?: (update: ProgressUpdate) => void,
): Promise<QualityReport[]> {
	const models = config.models?.length ? config.models : SUPPORTED_TTS_MODELS;
	const phrases = config.phrases?.length ? config.phrases : DEFAULT_PHRASES;
	const sttModel = config.sttModel ?? DEFAULT_STT_MODEL;
	const backend = config.backend ?? "auto";

	// 1. Load STT judge model
	onProgress?.({ phase: "loading-stt", message: `Loading STT judge: ${sttModel}` });

	try {
		await worker.loadModel(sttModel, { backend: "wasm" });
	} catch (err) {
		throw new Error(`Failed to load STT judge (${sttModel}): ${err instanceof Error ? err.message : String(err)}`);
	}

	// 2. Test each TTS model
	const reports: QualityReport[] = [];

	for (let i = 0; i < models.length; i++) {
		onProgress?.({
			phase: "testing-model",
			modelSlug: models[i],
			modelIndex: i,
			totalModels: models.length,
			message: `Loading model ${i + 1}/${models.length}: ${models[i]}`,
		});

		const report = await testModel(
			worker,
			models[i],
			sttModel,
			phrases,
			backend,
			onProgress,
			i,
			models.length,
		);
		reports.push(report);
	}

	// 3. Dispose STT judge
	try {
		await worker.disposeModel(sttModel);
	} catch {
		// swallow
	}

	onProgress?.({ phase: "done", message: "All tests complete" });

	return reports;
}
