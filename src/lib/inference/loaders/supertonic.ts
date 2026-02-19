import type {
	AudioResult,
	LoadOptions,
	ModelLoader,
	ModelSession,
	Voice,
} from "../types";

const VOICE_BASE_URL =
	"https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices";

const VOICES: Voice[] = [
	{ id: "F1", name: "Calm", gender: "female" },
	{ id: "F2", name: "Cheerful", gender: "female" },
	{ id: "F3", name: "Professional", gender: "female" },
	{ id: "F4", name: "Confident", gender: "female" },
	{ id: "F5", name: "Gentle", gender: "female" },
	{ id: "M1", name: "Energetic", gender: "male" },
	{ id: "M2", name: "Deep", gender: "male" },
	{ id: "M3", name: "Authoritative", gender: "male" },
	{ id: "M4", name: "Friendly", gender: "male" },
	{ id: "M5", name: "Storyteller", gender: "male" },
];

/**
 * Patch _postprocess_waveform to handle unexpected tensor shapes from the
 * voice decoder ONNX model (1D or 3D instead of expected 2D).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function patchPostprocessWaveform(pipelineInstance: any): void {
	const orig = pipelineInstance._postprocess_waveform;
	if (!orig) return;
	pipelineInstance._postprocess_waveform = function (
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		...args: any[]
	) {
		const waveform = args[1];
		if (waveform?.dims?.length === 1) {
			// 1D [num_frames] → 2D [1, num_frames]
			args[1] = waveform.view(1, waveform.dims[0]);
		} else if (waveform?.dims?.length === 3 && waveform.dims[1] === 1) {
			// 3D [batch, 1, time] → 2D [batch, time]
			args[1] = waveform.view(waveform.dims[0], waveform.dims[2]);
		}
		return orig.apply(this, args);
	};
}

export class SupertonicLoader implements ModelLoader {
	slug = "supertonic-2";
	type = "tts" as const;
	framework = "transformers-js" as const;

	private pipeline: unknown = null;
	private session: ModelSession | null = null;
	private loadedBackend: "webgpu" | "wasm" = "wasm";

	async load(options: LoadOptions): Promise<ModelSession> {
		this.loadedBackend = options.backend === "webgpu" ? "webgpu" : "wasm";
		const { env, pipeline } = await import("@huggingface/transformers");
		const { configureOnnxWasmPaths } = await import("../onnx-config");
		configureOnnxWasmPaths(env);

		const synthesizer = await pipeline(
			"text-to-speech",
			"onnx-community/Supertonic-TTS-2-ONNX",
			{
				device: options.backend === "wasm" ? "wasm" : "webgpu",
				dtype: "fp32",
				progress_callback: options.onProgress
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
					: undefined,
			},
		);

		patchPostprocessWaveform(synthesizer);

		this.pipeline = synthesizer;
		this.session = {
			dispose: () => {
				this.pipeline = null;
				this.session = null;
			},
		};

		return this.session;
	}

	async synthesize(text: string, voice: string): Promise<AudioResult> {
		if (!this.pipeline) throw new Error("Model not loaded");

		const resolvedVoice =
			voice === "default" ? VOICES[0].id : voice;
		const embeddingUrl = `${VOICE_BASE_URL}/${resolvedVoice}.bin`;

		const synthesizer = this.pipeline as (
			text: string,
			options: {
				speaker_embeddings: string;
				num_inference_steps?: number;
				speed?: number;
			},
		) => Promise<{ audio: Float32Array; sampling_rate: number }>;

		const start = performance.now();
		const result = await synthesizer(text, {
			speaker_embeddings: embeddingUrl,
			num_inference_steps: 10,
		});
		const totalMs = performance.now() - start;

		if (!result.audio || result.audio.length === 0) {
			throw new Error("Model returned empty audio data. Try reloading the model.");
		}

		// Debug: log audio stats to help diagnose quality issues
		if (typeof console !== "undefined") {
			let min = Infinity;
			let max = -Infinity;
			for (let i = 0; i < result.audio.length; i++) {
				if (result.audio[i] < min) min = result.audio[i];
				if (result.audio[i] > max) max = result.audio[i];
			}
			console.log(
				`[Supertonic] audio: ${result.audio.length} samples, ` +
					`${result.sampling_rate}Hz, ` +
					`range [${min.toFixed(4)}, ${max.toFixed(4)}], ` +
					`duration ${(result.audio.length / result.sampling_rate).toFixed(2)}s`,
			);
		}

		const duration = result.audio.length / result.sampling_rate;

		return {
			audio: result.audio,
			sampleRate: result.sampling_rate,
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
		return ["en", "ko", "es", "pt", "fr"];
	}

	getSupportedBackends(): ("webgpu" | "wasm")[] {
		return ["webgpu", "wasm"];
	}

	getPreferredBackend(): "webgpu" | "wasm" | "auto" {
		return "wasm";
	}
}
