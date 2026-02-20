import type {
	AudioResult,
	LoadOptions,
	ModelLoader,
	ModelSession,
	Voice,
} from "../types";

/** Minimal type for kokoro-js TextSplitterStream (not exported via package types) */
interface TextSplitterStream {
	push(...texts: string[]): void;
	close(): void;
	flush(): void;
	[Symbol.asyncIterator](): AsyncGenerator<string, void, void>;
}

export class KokoroLoader implements ModelLoader {
	slug = "kokoro-82m";
	type = "tts" as const;
	framework = "kokoro-js" as const;

	private session: ModelSession | null = null;
	private tts: unknown = null;
	private loadedBackend: "webgpu" | "wasm" = "wasm";
	private TextSplitterStream: (new () => TextSplitterStream) | null = null;

	async load(options: LoadOptions): Promise<ModelSession> {
		const kokoroModule = await import("kokoro-js");
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		this.TextSplitterStream = (kokoroModule as any).TextSplitterStream;
		const { KokoroTTS } = kokoroModule;

		const device = options.backend === "webgpu" ? "webgpu" : ("wasm" as const);
		// WebGPU requires fp32; quantized models only work with wasm/cpu
		const dtype = device === "webgpu" ? "fp32" : (options.quantization ?? "q8");

		this.loadedBackend = options.backend === "webgpu" ? "webgpu" : "wasm";

		const tts = await KokoroTTS.from_pretrained(
			"onnx-community/Kokoro-82M-v1.0-ONNX",
			{
				dtype,
				device,
				progress_callback: options.onProgress
					? (progress: {
							status: string;
							file: string;
							loaded: number;
							total: number;
						}) => {
							if (progress.status === "progress") {
								options.onProgress?.({
									status: "downloading",
									file: progress.file,
									loaded: progress.loaded,
									total: progress.total,
								});
							}
						}
					: undefined,
			},
		);

		this.tts = tts;
		this.session = {
			dispose: async () => {
				// Release underlying ONNX sessions to free WASM memory
				const instance = this.tts as {
					model?: { dispose?: () => Promise<unknown> };
				} | null;
				if (instance?.model?.dispose) {
					await instance.model.dispose();
				}
				this.tts = null;
				this.session = null;
			},
		};

		return this.session;
	}

	async *synthesizeStream(
		text: string,
		voice: string,
	): AsyncGenerator<
		{ text: string; audio: Float32Array; sampleRate: number },
		void,
		void
	> {
		if (!this.tts) throw new Error("Model not loaded");

		const resolvedVoice =
			voice === "default" ? this.getVoices()[0]?.id ?? "af_heart" : voice;

		// kokoro-js's tts.stream(string) creates a TextSplitterStream internally
		// but never calls close(), so the last sentence hangs forever.
		// Fix: create our own TextSplitterStream, push + close(), then pass
		// the stream instance directly — tts.stream() accepts it as first arg.
		const splitter = new this.TextSplitterStream!();
		splitter.push(text);
		splitter.close();

		const tts = this.tts as {
			stream: (
				input: TextSplitterStream,
				options: { voice: string },
			) => AsyncIterable<{
				text: string;
				phonemes: string;
				audio: { audio: Float32Array; sampling_rate: number };
			}>;
		};

		for await (const chunk of tts.stream(splitter, { voice: resolvedVoice })) {
			yield {
				text: chunk.text,
				audio: chunk.audio.audio,
				sampleRate: chunk.audio.sampling_rate,
			};
		}
	}

	async synthesize(text: string, voice: string, options?: { speed?: number }): Promise<AudioResult> {
		if (!this.tts) throw new Error("Model not loaded");

		// Resolve "default" to the first available voice
		const resolvedVoice =
			voice === "default" ? this.getVoices()[0]?.id ?? "af_heart" : voice;

		const tts = this.tts as {
			generate: (
				text: string,
				options: { voice: string; speed?: number },
			) => Promise<{ audio: Float32Array; sampling_rate: number }>;
		};
		const start = performance.now();
		const result = await tts.generate(text, { voice: resolvedVoice, speed: options?.speed });
		const totalMs = performance.now() - start;

		if (!result.audio || result.audio.length === 0) {
			throw new Error("Model returned empty audio data. Try reloading the model.");
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
		return [
			{ id: "af_heart", name: "Heart", gender: "female" },
			{ id: "af_alloy", name: "Alloy", gender: "female" },
			{ id: "af_aoede", name: "Aoede", gender: "female" },
			{ id: "af_bella", name: "Bella", gender: "female" },
			{ id: "af_jessica", name: "Jessica", gender: "female" },
			{ id: "af_kore", name: "Kore", gender: "female" },
			{ id: "af_nicole", name: "Nicole", gender: "female" },
			{ id: "af_nova", name: "Nova", gender: "female" },
			{ id: "af_river", name: "River", gender: "female" },
			{ id: "af_sarah", name: "Sarah", gender: "female" },
			{ id: "af_sky", name: "Sky", gender: "female" },
			{ id: "am_adam", name: "Adam", gender: "male" },
			{ id: "am_echo", name: "Echo", gender: "male" },
			{ id: "am_eric", name: "Eric", gender: "male" },
			{ id: "am_liam", name: "Liam", gender: "male" },
			{ id: "am_michael", name: "Michael", gender: "male" },
			{ id: "am_onyx", name: "Onyx", gender: "male" },
			{ id: "am_puck", name: "Puck", gender: "male" },
			{ id: "am_santa", name: "Santa", gender: "male" },
			{ id: "bf_emma", name: "Emma (British)", gender: "female" },
			{ id: "bm_george", name: "George (British)", gender: "male" },
		];
	}

	getLanguages(): string[] {
		return ["en", "fr", "ja", "ko", "zh"];
	}

	getSupportedBackends(): ("webgpu" | "wasm")[] {
		return ["webgpu", "wasm"];
	}
}
