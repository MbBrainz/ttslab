import { type AudioQaMetrics, analyzeAudioQa } from "../audio-qa";
import { measureEnergy } from "./audio-analysis";
import { computeWER, werVerdict } from "./wer";
import type {
	TestVariant,
	QualityReport,
	PhraseResult,
	TestConfig,
	TestPhrase,
	CheckFailure,
	EnergyResult,
	Verdict,
	WERResult,
} from "./types";
import { DEFAULT_PHRASES, DEFAULT_VARIANT, THRESHOLDS } from "./types";

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
	/**
	 * Optional. Absent adapters simply cannot run streaming variants — the
	 * runner reports that as an error rather than silently testing the
	 * non-streaming path and calling it streaming coverage.
	 */
	synthesizeStream?(
		slug: string,
		text: string,
		voice: string,
		speakerEmbeddingUrl: string | null | undefined,
		callbacks: {
			onChunk: (data: {
				audio: Float32Array;
				sampleRate: number;
				chunkIndex: number;
				totalChunks: number;
				sentenceText: string;
			}) => void;
			onEnd: (data: {
				totalMs: number;
				sampleRate: number;
				totalChunks: number;
			}) => void;
			onError: (error: Error) => void;
		},
		language?: string,
	): void;
	/**
	 * Aborts an in-flight stream. Optional only because a minimal adapter may
	 * not have one, but an adapter that provides `synthesizeStream` should
	 * provide this too — without it a timed-out generation keeps running inside
	 * the worker after the harness has given up on it.
	 */
	cancelStream?(): void;
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
	variant?: string;
	modelIndex?: number;
	totalModels?: number;
	phraseIndex?: number;
	totalPhrases?: number;
	message: string;
}

// ── Constants ────────────────────────────────────────────────────────

export const SUPPORTED_TTS_MODELS = [
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

function breaches(
	value: number,
	threshold: number,
	direction: "above" | "below",
): boolean {
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
function phraseVerdict(ctx: CheckContext): {
	verdict: Verdict;
	failures: CheckFailure[];
} {
	const failures = CHECK_RULES.map((r) => evaluateRule(r, ctx)).filter(
		(f): f is CheckFailure => f !== null,
	);

	if (failures.some((f) => f.severity === "fail"))
		return { verdict: "fail", failures };
	if (failures.length > 0) return { verdict: "warn", failures };
	return { verdict: "pass", failures };
}

function overallVerdict(tests: PhraseResult[], errors: string[]): Verdict {
	if (errors.length > 0) return "fail";
	if (tests.some((t) => t.verdict === "fail")) return "fail";
	if (tests.some((t) => t.verdict === "warn")) return "warn";
	return "pass";
}

// ── Synthesis, streaming and non-streaming ───────────────────────────

interface SynthesisResult {
	audio: Float32Array;
	sampleRate: number;
	totalMs: number;
	streaming?: { chunkCount: number; firstChunkMs: number };
}

/**
 * A hung stream must fail the case, not hang the whole run — and must be
 * CANCELLED, not merely abandoned. Rejecting the harness-side promise without
 * cancelling leaves the generation running inside the worker while the runner
 * moves on to disposeModel() and the next model, so an orphaned generation can
 * race or contaminate the following model's results.
 */
const STREAM_TIMEOUT_MS = 120_000;

function concatChunks(chunks: Float32Array[]): Float32Array {
	const total = chunks.reduce((sum, c) => sum + c.length, 0);
	const out = new Float32Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

/**
 * Bridges the callback-based streaming API to a promise, concatenating chunks
 * into one buffer so the same metric stack runs against it.
 *
 * Joining the chunks is the point: a model that streams correctly per chunk but
 * mis-joins them produces clicks and gaps at the boundaries, which is precisely
 * what a whole-utterance analysis catches and a per-chunk one does not.
 */
function synthesizeStreaming(
	worker: InferenceWorkerAPI,
	modelSlug: string,
	text: string,
	voice: string,
	speakerEmbeddingUrl: string | undefined,
): Promise<SynthesisResult> {
	if (!worker.synthesizeStream) {
		return Promise.reject(
			new Error(
				"Streaming variant requested but the worker adapter has no synthesizeStream",
			),
		);
	}

	return new Promise((resolve, reject) => {
		const chunks: Float32Array[] = [];
		const startedAt = Date.now();
		let firstChunkMs = 0;
		let sampleRate = 0;
		let settled = false;

		/** Callbacks can still fire after cancellation; ignore them. */
		const settle = (action: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			action();
		};

		const timer = setTimeout(() => {
			settle(() => {
				// Cancel BEFORE rejecting. The caller marks the phrase an error and
				// moves straight on to disposeModel() and the next model; an
				// uncancelled generation would still be running through that.
				if (worker.cancelStream) {
					try {
						worker.cancelStream();
					} catch {
						// A failed cancel must not mask the timeout error.
					}
				}
				reject(
					new Error(
						worker.cancelStream
							? `Stream did not finish within ${STREAM_TIMEOUT_MS}ms (cancelled)`
							: `Stream did not finish within ${STREAM_TIMEOUT_MS}ms (NOT cancelled — adapter has no cancelStream, generation may still be running)`,
					),
				);
			});
		}, STREAM_TIMEOUT_MS);

		worker.synthesizeStream?.(
			modelSlug,
			text,
			voice,
			speakerEmbeddingUrl ?? null,
			{
				onChunk: (data) => {
					if (settled) return;
					if (chunks.length === 0) firstChunkMs = Date.now() - startedAt;
					chunks.push(data.audio);
					sampleRate = data.sampleRate;
				},
				onEnd: (data) => {
					settle(() => {
						if (chunks.length === 0) {
							reject(new Error("Stream ended without emitting any audio"));
							return;
						}
						resolve({
							audio: concatChunks(chunks),
							sampleRate: sampleRate || data.sampleRate,
							totalMs: data.totalMs,
							streaming: { chunkCount: chunks.length, firstChunkMs },
						});
					});
				},
				onError: (error) => {
					settle(() => reject(error));
				},
			},
		);
	});
}

async function synthesizeVariant(
	worker: InferenceWorkerAPI,
	modelSlug: string,
	text: string,
	voice: string,
	variant: TestVariant,
): Promise<SynthesisResult> {
	if (variant.streaming) {
		return synthesizeStreaming(
			worker,
			modelSlug,
			text,
			voice,
			variant.speakerEmbeddingUrl,
		);
	}

	const result = await worker.synthesize(
		modelSlug,
		text,
		voice,
		variant.speakerEmbeddingUrl,
	);
	return {
		audio: result.audio,
		sampleRate: result.sampleRate,
		totalMs: result.metrics.totalMs,
	};
}

// ── Single phrase test ───────────────────────────────────────────────

interface PhraseTestArgs {
	worker: InferenceWorkerAPI;
	modelSlug: string;
	sttModel: string;
	phrase: TestPhrase;
	voice: string;
	variant: TestVariant;
	/** Receives the generated audio so the caller can dump it as an artifact. */
	onAudio?: (audio: Float32Array, sampleRate: number) => void | Promise<void>;
}

async function testPhrase(args: PhraseTestArgs): Promise<PhraseResult> {
	const { worker, modelSlug, sttModel, phrase, voice, variant } = args;
	const result = await synthesizeVariant(
		worker,
		modelSlug,
		phrase.text,
		voice,
		variant,
	);

	// Awaited: a rejected write must fail the case, not be silently dropped
	// while the report goes on to cite an artifact that does not exist.
	await args.onAudio?.(result.audio, result.sampleRate);

	// Reference text is passed so the duration check has an expectation to
	// compare against — it is the only pre-ASR detector of a rate relabel.
	const qa = analyzeAudioQa(result.audio, result.sampleRate, phrase.text);
	const energy = measureEnergy(result.audio);

	const resampled =
		result.sampleRate !== TARGET_SAMPLE_RATE
			? resampleAudio(result.audio, result.sampleRate, TARGET_SAMPLE_RATE)
			: result.audio;

	const transcript = await worker.transcribe(
		sttModel,
		resampled,
		TARGET_SAMPLE_RATE,
	);
	const werResult = computeWER(phrase.text, transcript.text);
	const { verdict, failures } = phraseVerdict({ qa, energy, wer: werResult });

	return {
		phrase: phrase.text,
		category: phrase.category,
		generationMs: result.totalMs,
		sampleRate: result.sampleRate,
		qa,
		energy,
		streaming: result.streaming,
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

interface ModelTestArgs {
	worker: InferenceWorkerAPI;
	slug: string;
	sttModel: string;
	phrases: TestPhrase[];
	variant: TestVariant;
	backend: "webgpu" | "wasm" | "auto";
	onProgress?: (u: ProgressUpdate) => void;
	onAudio?: AudioSink;
	modelIndex?: number;
	totalModels?: number;
}

async function testModel(args: ModelTestArgs): Promise<QualityReport> {
	const { worker, slug, sttModel, phrases, variant, backend, onProgress } =
		args;
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
				variant: variant.id,
				modelIndex: args.modelIndex,
				totalModels: args.totalModels,
				phraseIndex: i,
				totalPhrases: phrases.length,
				message: `[${slug} · ${variant.id}] Testing phrase ${i + 1}/${phrases.length}`,
			});

			try {
				const result = await testPhrase({
					worker,
					modelSlug: slug,
					sttModel,
					phrase: phrases[i],
					voice,
					variant,
					onAudio: (audio, sampleRate) =>
						args.onAudio?.({
							slug,
							variant: variant.id,
							phraseIndex: i,
							audio,
							sampleRate,
						}),
				});
				tests.push(result);
			} catch (err) {
				errors.push(
					`Phrase "${phrases[i].text}": ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	} catch (err) {
		errors.push(
			`Load failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		await worker.disposeModel(slug);
	} catch {
		// swallow dispose errors
	}

	return {
		slug,
		variant: variant.id,
		timestamp: new Date().toISOString(),
		overall: overallVerdict(tests, errors),
		loadTimeMs,
		backend: actualBackend,
		tests,
		errors,
	};
}

// ── Main entry point ─────────────────────────────────────────────────

/**
 * Receives every generated buffer so a caller can dump it to disk. This is what
 * makes a failure listenable and re-scorable without regenerating the audio.
 */
/**
 * Returning a promise is supported and AWAITED. If persisting an artifact
 * fails, that must surface: a report pointing at a WAV path that was never
 * written is worse than an error, because the verdict looks investigable when
 * the evidence does not exist.
 */
export type AudioSink = (item: {
	slug: string;
	variant: string;
	phraseIndex: number;
	audio: Float32Array;
	sampleRate: number;
}) => void | Promise<void>;

export interface RunHooks {
	onProgress?: (update: ProgressUpdate) => void;
	onAudio?: AudioSink;
	/**
	 * Fires as each model x variant cell COMPLETES, not once at the end.
	 *
	 * A long matrix run can die partway — a browser crash, a driver timeout —
	 * and returning only a batched array at the end loses the verdicts for every
	 * cell that already finished, even though their audio is already on disk.
	 */
	onReport?: (report: QualityReport) => void;
}

export async function runQualityTests(
	worker: InferenceWorkerAPI,
	config: TestConfig,
	hooks: RunHooks = {},
): Promise<QualityReport[]> {
	const { onProgress, onAudio, onReport } = hooks;
	const models = config.models?.length ? config.models : SUPPORTED_TTS_MODELS;
	const allPhrases = config.phrases?.length ? config.phrases : DEFAULT_PHRASES;
	const phrases =
		config.phraseLimit && config.phraseLimit > 0
			? allPhrases.slice(0, config.phraseLimit)
			: allPhrases;
	const sttModel = config.sttModel ?? DEFAULT_STT_MODEL;
	const backend = config.backend ?? "auto";
	const variants = config.variants?.length
		? config.variants
		: [DEFAULT_VARIANT];

	// 1. Load STT judge model
	onProgress?.({
		phase: "loading-stt",
		message: `Loading STT judge: ${sttModel}`,
	});

	try {
		await worker.loadModel(sttModel, { backend: "wasm" });
	} catch (err) {
		throw new Error(
			`Failed to load STT judge (${sttModel}): ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// 2. Test each TTS model
	const reports: QualityReport[] = [];

	// Model-major, variant-minor: every variant of a model runs while that
	// model is loaded, so the coverage matrix costs one load per model rather
	// than one per cell.
	for (let i = 0; i < models.length; i++) {
		for (const variant of variants) {
			onProgress?.({
				phase: "testing-model",
				modelSlug: models[i],
				variant: variant.id,
				modelIndex: i,
				totalModels: models.length,
				message: `Loading model ${i + 1}/${models.length}: ${models[i]} · ${variant.id}`,
			});

			const report = await testModel({
				worker,
				slug: models[i],
				sttModel,
				phrases,
				variant,
				backend,
				onProgress,
				onAudio,
				modelIndex: i,
				totalModels: models.length,
			});
			reports.push(report);
			onReport?.(report);
		}
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
