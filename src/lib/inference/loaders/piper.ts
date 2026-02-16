import type {
	AudioResult,
	LoadOptions,
	ModelLoader,
	ModelSession,
	Voice,
} from "../types";

/** Parse a WAV blob into raw PCM Float32 data and sample rate. */
async function decodeWavBlob(
	blob: Blob,
): Promise<{ audio: Float32Array; sampleRate: number }> {
	const buffer = await blob.arrayBuffer();
	const view = new DataView(buffer);

	const sampleRate = view.getUint32(24, true);
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
	const numSamples = Math.floor((buffer.byteLength - offset) / bytesPerSample);
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

	return { audio, sampleRate };
}

export class PiperLoader implements ModelLoader {
	slug = "piper-en-us-lessac-medium";
	type = "tts" as const;
	framework = "piper-web" as const;

	private session: ModelSession | null = null;
	private vits: typeof import("@diffusionstudio/vits-web") | null = null;

	async load(options: LoadOptions): Promise<ModelSession> {
		const vits = await import("@diffusionstudio/vits-web");
		this.vits = vits;

		await vits.download("en_US-lessac-medium", (progress) => {
			options.onProgress?.({
				status: "downloading",
				file: progress.url.split("/").pop() ?? "model",
				loaded: progress.loaded,
				total: progress.total,
			});
		});

		this.session = {
			dispose: () => {
				this.vits = null;
				this.session = null;
			},
		};

		return this.session;
	}

	async synthesize(text: string): Promise<AudioResult> {
		if (!this.session || !this.vits) throw new Error("Model not loaded");

		const start = performance.now();

		const wavBlob = await this.vits.predict({
			text,
			voiceId: "en_US-lessac-medium",
		});

		const totalMs = performance.now() - start;
		const { audio, sampleRate } = await decodeWavBlob(wavBlob);
		const duration = audio.length / sampleRate;

		return {
			audio,
			sampleRate,
			duration,
			metrics: {
				totalMs: Math.round(totalMs),
				backend: "wasm",
			},
		};
	}

	getVoices(): Voice[] {
		return [
			{ id: "en_US-lessac-medium", name: "Lessac Medium", gender: "male" },
		];
	}

	getLanguages(): string[] {
		return ["en"];
	}

	getSupportedBackends(): ("webgpu" | "wasm")[] {
		return ["wasm"];
	}
}
