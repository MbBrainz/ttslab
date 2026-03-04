import type {
	AudioResult,
	LoadOptions,
	ModelLoader,
	ModelSession,
	Voice,
} from "../types";

/** Default voice from the onnx-community repo (shared by both variants). */
const DEFAULT_VOICE_URL =
	"https://huggingface.co/onnx-community/chatterbox-ONNX/resolve/main/default_voice.wav";
const SAMPLE_RATE = 24000;

const VOICES: Voice[] = [
	{ id: "default", name: "Default", gender: "male" },
];

/** Parse a WAV buffer into raw PCM Float32 data. */
function decodeWav(buffer: ArrayBuffer): Float32Array {
	const view = new DataView(buffer);
	const bitsPerSample = view.getUint16(34, true);

	// Find the "data" chunk
	let offset = 12;
	while (offset < buffer.byteLength - 8) {
		const id = String.fromCharCode(
			view.getUint8(offset),
			view.getUint8(offset + 1),
			view.getUint8(offset + 2),
			view.getUint8(offset + 3),
		);
		const chunkSize = view.getUint32(offset + 4, true);
		if (id === "data") {
			offset += 8;
			break;
		}
		offset += 8 + chunkSize;
	}

	const bytesPerSample = bitsPerSample / 8;
	const numSamples = Math.floor(
		(buffer.byteLength - offset) / bytesPerSample,
	);
	const audio = new Float32Array(numSamples);

	if (bitsPerSample === 16) {
		for (let i = 0; i < numSamples; i++) {
			audio[i] = view.getInt16(offset + i * 2, true) / 32768;
		}
	} else if (bitsPerSample === 32) {
		for (let i = 0; i < numSamples; i++) {
			audio[i] = view.getFloat32(offset + i * 4, true);
		}
	}

	return audio;
}

type DtypeSpec = Record<string, string>;

export class ChatterboxLoader implements ModelLoader {
	slug: string;
	type = "tts" as const;
	framework = "transformers-js" as const;

	private modelId: string;
	/** When true, all components have quantized variants (Turbo). */
	private allQuantized: boolean;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private model: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private processor: any = null;
	private defaultVoiceAudio: Float32Array | null = null;
	private session: ModelSession | null = null;
	private loadedBackend: "webgpu" | "wasm" = "wasm";

	constructor(
		slug = "chatterbox",
		modelId = "onnx-community/chatterbox-ONNX",
		allQuantized = false,
	) {
		this.slug = slug;
		this.modelId = modelId;
		this.allQuantized = allQuantized;
	}

	private getDtype(backend: "webgpu" | "wasm"): DtypeSpec {
		const lmQuant = backend === "webgpu" ? "q4f16" : "q4";

		if (this.allQuantized) {
			// Turbo: all components have quantized variants
			return {
				embed_tokens: lmQuant,
				speech_encoder: lmQuant,
				language_model: lmQuant,
				conditional_decoder: lmQuant,
			};
		}

		// Regular: only language_model has quantized variants
		return {
			embed_tokens: "fp32",
			speech_encoder: "fp32",
			language_model: lmQuant,
			conditional_decoder: "fp32",
		};
	}

	/** Model ID — use the same repo for all backends. */
	private getModelId(_backend: "webgpu" | "wasm"): string {
		return this.modelId;
	}

	async load(options: LoadOptions): Promise<ModelSession> {
		const backend = options.backend === "webgpu" ? "webgpu" : "wasm";
		this.loadedBackend = backend;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const transformers: any = await import("@huggingface/transformers");
		const { configureOnnxWasmPaths } = await import("../onnx-config");
		configureOnnxWasmPaths(transformers.env);

		const dtype = this.getDtype(backend);
		const modelId = this.getModelId(backend);

		console.log(`[chatterbox] Loading ${this.slug} from ${modelId} (backend: ${backend}, dtype: ${JSON.stringify(dtype)})`);

		const progressCallback = (progress: {
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
		};

		try {
			// Load model, processor, and default voice in parallel
			const [model, processor, voiceBuffer] = await Promise.all([
				transformers.ChatterboxModel.from_pretrained(modelId, {
					device: backend,
					dtype,
					progress_callback: progressCallback,
				}),
				transformers.AutoProcessor.from_pretrained(modelId),
				fetch(DEFAULT_VOICE_URL).then((r: Response) => r.arrayBuffer()),
			]);

			this.model = model;
			this.processor = processor;
			this.defaultVoiceAudio = decodeWav(voiceBuffer);

			console.log(`[chatterbox] Model loaded successfully on ${backend} (model: ${modelId})`);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const stack = err instanceof Error ? err.stack : undefined;
			console.error(`[chatterbox] Load failed (model: ${modelId}, backend: ${backend}, dtype: ${JSON.stringify(dtype)}):`, message);
			if (stack) console.error(`[chatterbox] Stack:`, stack);
			throw new Error(`Chatterbox ${backend} load failed (model: ${modelId}): ${message}`);
		}

		this.session = {
			dispose: () => {
				this.model?.dispose?.();
				this.model = null;
				this.processor = null;
				this.defaultVoiceAudio = null;
				this.session = null;
			},
		};

		return this.session;
	}

	async synthesize(text: string, _voice: string): Promise<AudioResult> {
		if (!this.model || !this.processor || !this.defaultVoiceAudio) {
			throw new Error("Model not loaded");
		}

		const start = performance.now();

		// Process text + reference audio via the processor
		const inputs = await this.processor(text, this.defaultVoiceAudio);

		// The processor returns { input_ids, attention_mask, input_values }
		// but the model expects audio_values, so rename the key
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const generateInputs: Record<string, any> = {};
		for (const [key, value] of Object.entries(inputs)) {
			if (key === "input_values") {
				generateInputs.audio_values = value;
			} else {
				generateInputs[key] = value;
			}
		}

		let waveform;
		try {
			// Generate waveform — returns a Tensor directly
			waveform = await this.model.generate({
				...generateInputs,
				exaggeration: 0.5,
				max_new_tokens: 2048,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[chatterbox] Generation failed (backend: ${this.loadedBackend}):`, message);
			if (err instanceof Error && err.stack) console.error(`[chatterbox] Stack:`, err.stack);
			throw new Error(`Chatterbox ${this.loadedBackend} generation failed: ${message}`);
		}

		const totalMs = performance.now() - start;

		// Convert Tensor to Float32Array
		const audioData =
			waveform.data instanceof Float32Array
				? waveform.data
				: new Float32Array(waveform.data);

		const duration = audioData.length / SAMPLE_RATE;

		return {
			audio: audioData,
			sampleRate: SAMPLE_RATE,
			duration,
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
		// WebGPU blocked: browser JSEP-based WebGPU EP rejects INT64 in Cast kernels,
		// but ONNX spec requires INT64 for Shape/Unsqueeze axes. Fundamental catch-22
		// that cannot be solved by model patching. See TTSL-5 for full investigation.
		return ["wasm"];
	}

	getPreferredBackend(): "webgpu" | "wasm" | "auto" {
		return "wasm";
	}
}
