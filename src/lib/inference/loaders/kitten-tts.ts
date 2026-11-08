import { splitIntoSentences } from "../streaming";
import type {
	AudioResult,
	LoadOptions,
	ModelLoader,
	ModelSession,
	Voice,
} from "../types";

/**
 * KittenTTS Nano (15M params, ~24MB) — the low end of the lab's size spectrum.
 *
 * This repo is NOT loadable through the standard transformers.js
 * `pipeline("text-to-speech")`: transformers.js's `StyleTextToSpeech2Model` is
 * a bare `PreTrainedModel` subclass with no `generate_speech`, and the
 * pipeline's text-to-waveform path passes no style vector. The reference demo
 * (webml-community/KittenTTS-web) therefore uses a custom pipeline, which this
 * loader ports faithfully:
 *
 *   1. Normalize text (kokoro-style English normalizer: numbers, currency,
 *      times, abbreviations — ported from the demo bundle).
 *   2. Phonemize via eSpeak NG WASM (`public/espeak/espeakng.worker.js`,
 *      vendored from xenova/phonemizer.js — the same module the demo bundles).
 *   3. Tokenize phonemes with the repo's tokenizer.
 *   4. Run `StyleTextToSpeech2Model` with `{ input_ids, style, speed }` where
 *      `style` is a 256-dim float32 vector fetched from the repo's
 *      `voices/<id>.bin`.
 *   5. Trim 2000 samples of edge artifact and return at 24 kHz.
 *
 * ONNX graph I/O verified against onnx-community/kitten-tts-nano-0.1-ONNX:
 * inputs `input_ids` (+ optional `sequence_length`), `style`, `speed`;
 * outputs `waveform`, `num_samples`, `duration`.
 */

const MODEL_ID = "onnx-community/kitten-tts-nano-0.1-ONNX";
const VOICE_BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/voices`;
const SAMPLE_RATE = 24000;
const STYLE_DIM = 256;
/**
 * The model emits a short burst artifact at both ends of the waveform; the
 * reference demo trims 2000 samples per side. Skipped for very short audio
 * where trimming would eat the whole utterance.
 */
const EDGE_TRIM_SAMPLES = 2000;

const VOICES: Voice[] = [
	{ id: "expr-voice-2-f", name: "Voice 2 (Female)", gender: "female" },
	{ id: "expr-voice-2-m", name: "Voice 2 (Male)", gender: "male" },
	{ id: "expr-voice-3-f", name: "Voice 3 (Female)", gender: "female" },
	{ id: "expr-voice-3-m", name: "Voice 3 (Male)", gender: "male" },
	{ id: "expr-voice-4-f", name: "Voice 4 (Female)", gender: "female" },
	{ id: "expr-voice-4-m", name: "Voice 4 (Male)", gender: "male" },
	{ id: "expr-voice-5-f", name: "Voice 5 (Female)", gender: "female" },
	{ id: "expr-voice-5-m", name: "Voice 5 (Male)", gender: "male" },
];
const DEFAULT_VOICE = "expr-voice-5-m";

// ---------------------------------------------------------------------------
// eSpeak NG WASM phonemizer (vendored, see public/espeak/README.md)
// ---------------------------------------------------------------------------

interface EspeakNgWorker {
	set_voice(identifier: string): void;
	synthesize_ipa(text: string): { code: number; ipa: string };
}

interface EspeakNgModule {
	calledRun?: boolean;
	onRuntimeInitialized?: (() => void) | null;
	eSpeakNGWorker: new () => EspeakNgWorker;
}

let espeakPromise: Promise<EspeakNgWorker> | null = null;

async function getEspeakWorker(): Promise<EspeakNgWorker> {
	if (!espeakPromise) {
		espeakPromise = (async () => {
			// Kept out of the bundle: the file is ~1.4MB (engine + embedded data).
			// webpackIgnore/turbopackIgnore force a runtime import from public/.
			const specifier = "/espeak/espeakng.worker.js";
			// The file is an ES module ending in `export default Module`, where
			// Module is the emscripten module object. We must reach `.default`
			// BEFORE assigning hooks: an ES module NAMESPACE object is sealed
			// (non-extensible), so `namespace.onRuntimeInitialized = ...` throws
			// "TypeError: Cannot add property onRuntimeInitialized" and the load
			// fails. The default export (a plain object) is extensible. The
			// `?? namespace` fallback keeps plain (non-module) shapes working.
			const imported = await import(
				/* webpackIgnore: true */
				/* turbopackIgnore: true */
				specifier
			);
			const mod =
				(imported as { default?: EspeakNgModule }).default ??
				(imported as EspeakNgModule);
			const module = await new Promise<EspeakNgModule>((resolve) => {
				if (mod.calledRun) {
					resolve(mod);
				} else {
					mod.onRuntimeInitialized = () => resolve(mod);
				}
			});
			return new module.eSpeakNGWorker();
		})();
	}
	return espeakPromise;
}

/** IPA phonemize via eSpeak NG — mirrors phonemizer.js's `phonemize()`. */
async function phonemize(text: string, language = "en-us"): Promise<string[]> {
	const worker = await getEspeakWorker();
	worker.set_voice(language);
	return (
		worker
			.synthesize_ipa(text)
			.ipa?.split("\n")
			.filter((l) => l.length > 0) ?? []
	);
}

// ---------------------------------------------------------------------------
// English text normalization (ported from the reference demo, which ports it
// from kokoro-js / misaki: number, time, currency and abbreviation expansion)
// ---------------------------------------------------------------------------

/** "3:30" → words; "1994"-style years → "nineteen ninety-four". */
function normalizeNumberToken(token: string): string {
	if (token.includes(".")) return token;
	if (token.includes(":")) {
		const [hours, minutes] = token.split(":").map(Number);
		return minutes === 0
			? `${hours} o'clock`
			: minutes < 10
				? `${hours} oh ${minutes}`
				: `${hours} ${minutes}`;
	}
	const year = Number.parseInt(token.slice(0, 4), 10);
	if (year < 1100 || year % 1000 < 10) return token;
	const first = token.slice(0, 2);
	const last = Number.parseInt(token.slice(2, 4), 10);
	const plural = token.endsWith("s") ? "s" : "";
	if (year % 1000 >= 100 && year % 1000 <= 999) {
		if (last === 0) return `${first} hundred${plural}`;
		if (last < 10) return `${first} oh ${last}${plural}`;
	}
	return `${first} ${last}${plural}`;
}

/** "$3" / "£2.50" → words. */
function normalizeCurrencyToken(token: string): string {
	const unit = token[0] === "$" ? "dollar" : "pound";
	if (Number.isNaN(Number(token.slice(1)))) {
		return `${token.slice(1)} ${unit}s`;
	}
	if (!token.includes(".")) {
		const plural = token.slice(1) === "1" ? "" : "s";
		return `${token.slice(1)} ${unit}${plural}`;
	}
	const [whole, cents] = token.slice(1).split(".");
	const centsCount = Number.parseInt(cents.padEnd(2, "0"), 10);
	const unitPlural = whole === "1" ? "" : "s";
	const centsUnit =
		token[0] === "$"
			? centsCount === 1
				? "cent"
				: "cents"
			: centsCount === 1
				? "penny"
				: "pence";
	return `${whole} ${unit}${unitPlural} and ${centsCount} ${centsUnit}`;
}

/** "1.23" → "one point two three". */
function normalizeDecimalToken(token: string): string {
	const [whole, decimals] = token.split(".");
	return `${whole} point ${decimals.split("").join(" ")}`;
}

function normalizeText(input: string): string {
	return input
		.replace(/[‘’]/g, "'")
		.replace(/«/g, "“")
		.replace(/»/g, "”")
		.replace(/[“”]/g, '"')
		.replace(/\(/g, "«")
		.replace(/\)/g, "»")
		.replace(/、/g, ", ")
		.replace(/。/g, ". ")
		.replace(/！/g, "! ")
		.replace(/，/g, ", ")
		.replace(/：/g, ": ")
		.replace(/；/g, "; ")
		.replace(/？/g, "? ")
		.replace(/[^\S \n]/g, " ")
		.replace(/ {2,}/, " ")
		.replace(/(?<=\n) +(?=\n)/g, "")
		.replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
		.replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister")
		.replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
		.replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs")
		.replace(/\betc\.(?! [A-Z])/gi, "etc")
		.replace(/\b(y)eah?\b/gi, "$1e'a")
		.replace(
			/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g,
			normalizeNumberToken,
		)
		.replace(/(?<=\d),(?=\d)/g, "")
		.replace(
			/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi,
			normalizeCurrencyToken,
		)
		.replace(/\d*\.\d+/g, normalizeDecimalToken)
		.replace(/(?<=\d)-(?=\d)/g, " to ")
		.replace(/(?<=\d)S/g, " S")
		.replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
		.replace(/(?<=X')S\b/g, "s")
		.replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (w) => w.replace(/\./g, "-"))
		.replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-")
		.trim();
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

interface KittenTensor {
	data: Float32Array;
	dims: number[];
}

export class KittenTtsLoader implements ModelLoader {
	slug = "kitten-tts-nano";
	type = "tts" as const;
	framework = "transformers-js" as const;

	// biome-ignore lint/suspicious/noExplicitAny: transformers.js session is untyped
	private model: any = null;
	// biome-ignore lint/suspicious/noExplicitAny: transformers.js tokenizer is untyped
	private tokenizer: any = null;
	private session: ModelSession | null = null;
	private loadedBackend: "webgpu" | "wasm" = "wasm";
	private voiceCache = new Map<string, Float32Array>();

	async load(options: LoadOptions): Promise<ModelSession> {
		// The repo only ships onnx/model_quantized.onnx (q8). There is no fp32 or
		// fp16 variant, and int8 models are not supported by the WebGPU EP, so
		// this model is WASM-only regardless of the requested backend.
		this.loadedBackend = "wasm";

		const transformers = await import("@huggingface/transformers");
		const { configureOnnxWasmPaths } = await import("../onnx-config");
		configureOnnxWasmPaths(transformers.env);

		const progress_callback = options.onProgress
			? (progress: {
					status: string;
					file?: string;
					loaded?: number;
					total?: number;
				}) => {
					if (progress.status === "progress" && progress.file != null) {
						options.onProgress?.({
							status: "downloading",
							file: progress.file,
							loaded: progress.loaded ?? 0,
							total: progress.total ?? 0,
						});
					}
				}
			: undefined;

		// Same classes and options as the reference demo's from_pretrained().
		// Benign console warning expected here: transformers.js logs
		// "Architecture 'style_text_to_speech_2' not in MODEL_TYPE_MAPPING —
		// defaulting to EncoderOnly model type." That fallback classification is
		// fine — this loader does NOT use the transformers.js pipeline; it drives
		// the ONNX sessions manually in synthesizeChunk() with explicit
		// input_ids/style/speed tensors, so the model-type guess never matters.
		const [model, tokenizer] = await Promise.all([
			transformers.StyleTextToSpeech2Model.from_pretrained(MODEL_ID, {
				dtype: "q8",
				device: "wasm",
				progress_callback,
			}),
			transformers.AutoTokenizer.from_pretrained(MODEL_ID, {
				progress_callback,
			}),
		]);

		this.model = model;
		this.tokenizer = tokenizer;

		// Warm the phonemizer now so load failures surface during load, not on
		// the first synthesis (the worker's warmup call needs it too).
		await getEspeakWorker();

		this.session = {
			dispose: () => {
				this.model = null;
				this.tokenizer = null;
				this.voiceCache.clear();
				espeakPromise = null;
				this.session = null;
			},
		};

		return this.session;
	}

	private async loadVoice(voiceId: string): Promise<Float32Array> {
		const cached = this.voiceCache.get(voiceId);
		if (cached) return cached;

		const url = `${VOICE_BASE_URL}/${voiceId}.bin`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to fetch voice ${voiceId}: ${response.status}`);
		}
		const vector = new Float32Array(await response.arrayBuffer());
		if (vector.length !== STYLE_DIM) {
			throw new Error(
				`Voice file voices/${voiceId}.bin has ${vector.length} style dimensions; expected ${STYLE_DIM}. The voice asset is corrupt or from an incompatible model revision.`,
			);
		}
		this.voiceCache.set(voiceId, vector);
		return vector;
	}

	/** Phonemize + run the model for one text chunk. Returns edge-trimmed audio. */
	private async synthesizeChunk(
		text: string,
		voiceId: string,
		speed: number,
	): Promise<Float32Array> {
		const normalized = normalizeText(text);
		const phonemes = (await phonemize(normalized)).join(" ");
		if (!phonemes) {
			throw new Error(`Phonemization produced no phonemes for: "${text}"`);
		}

		const { Tensor } = await import("@huggingface/transformers");
		// max_length 512 matches the model's phoneme-token budget (the reference
		// demo chunks sentences at the same 512); explicit so the truncation
		// target cannot drift with tokenizer defaults.
		const { input_ids } = this.tokenizer(phonemes, {
			truncation: true,
			max_length: 512,
		});

		const styleVector = await this.loadVoice(voiceId);
		const { waveform } = (await this.model({
			input_ids,
			style: new Tensor("float32", styleVector, [1, STYLE_DIM]),
			speed: new Tensor("float32", [speed], [1]),
		})) as { waveform: KittenTensor };

		const data = waveform.data;
		// Trim edge artifacts, but keep short utterances intact.
		if (data.length > EDGE_TRIM_SAMPLES * 4) {
			return data.slice(EDGE_TRIM_SAMPLES, data.length - EDGE_TRIM_SAMPLES);
		}
		return data.slice();
	}

	async synthesize(
		text: string,
		voice: string,
		options?: { speed?: number },
	): Promise<AudioResult> {
		if (!this.model || !this.tokenizer) throw new Error("Model not loaded");

		const resolvedVoice = voice === "default" ? DEFAULT_VOICE : voice;
		if (!VOICES.some((v) => v.id === resolvedVoice)) {
			throw new Error(
				`Voice "${resolvedVoice}" not found. Should be one of: ${VOICES.map((v) => v.id).join(", ")}.`,
			);
		}
		const speed = options?.speed ?? 1;

		const start = performance.now();
		// The tokenizer truncates at 512 phoneme tokens, so synthesize per
		// sentence (same chunking the reference demo uses in its stream path).
		const chunks = splitIntoSentences(text);
		const audioChunks: Float32Array[] = [];
		for (const chunk of chunks.length > 0 ? chunks : [text]) {
			audioChunks.push(await this.synthesizeChunk(chunk, resolvedVoice, speed));
		}

		const totalLength = audioChunks.reduce((sum, c) => sum + c.length, 0);
		const audio = new Float32Array(totalLength);
		let offset = 0;
		for (const chunk of audioChunks) {
			audio.set(chunk, offset);
			offset += chunk.length;
		}
		const totalMs = performance.now() - start;

		if (audio.length === 0) {
			throw new Error(
				"Model returned empty audio data. Try reloading the model.",
			);
		}

		return {
			audio,
			sampleRate: SAMPLE_RATE,
			duration: audio.length / SAMPLE_RATE,
			metrics: {
				totalMs: Math.round(totalMs),
				backend: this.loadedBackend,
			},
		};
	}

	getVoices(): Voice[] {
		return VOICES;
	}

	getLanguages(): string[] {
		return ["en"];
	}

	getSupportedBackends(): ("webgpu" | "wasm")[] {
		return ["wasm"];
	}

	getPreferredBackend(): "webgpu" | "wasm" | "auto" {
		return "wasm";
	}
}
