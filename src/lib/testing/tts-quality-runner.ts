import { analyzeAudio } from "./audio-analysis";
import { computeWER, werVerdict } from "./wer";
import type {
	QualityReport,
	PhraseResult,
	TestConfig,
	TestPhrase,
	AudioAnalysis,
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

function phraseVerdict(analysis: AudioAnalysis, wer: number): "pass" | "warn" | "fail" {
	if (analysis.echo.detected || wer > THRESHOLDS.wer.fail) return "fail";
	if (wer >= THRESHOLDS.wer.warn || analysis.silence.ratio > THRESHOLDS.silence.warn) return "warn";
	return "pass";
}

function overallVerdict(tests: PhraseResult[], errors: string[]): "pass" | "warn" | "fail" {
	if (errors.length > 0) return "fail";
	if (tests.some((t) => t.sttRoundTrip.verdict === "fail")) return "fail";
	if (tests.some((t) => t.sttRoundTrip.verdict === "warn")) return "warn";
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

	const audioAnalysis = analyzeAudio(result.audio, result.sampleRate);

	const resampled =
		result.sampleRate !== TARGET_SAMPLE_RATE
			? resampleAudio(result.audio, result.sampleRate, TARGET_SAMPLE_RATE)
			: result.audio;

	const transcript = await worker.transcribe(sttModel, resampled, TARGET_SAMPLE_RATE);
	const werResult = computeWER(phrase.text, transcript.text);

	return {
		phrase: phrase.text,
		category: phrase.category,
		generationMs: result.metrics.totalMs,
		audioAnalysis,
		sttRoundTrip: {
			transcription: transcript.text,
			wer: werResult.wer,
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
