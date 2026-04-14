import type {
	AudioResult,
	LoadOptions,
	ModelLoader,
	ModelSession,
	Voice,
} from "../types";
import { splitIntoSentences } from "../streaming";

/**
 * Split text into chunks suitable for VITS synthesis.
 *
 * VITS models use an attention mechanism that loses alignment on long
 * phoneme sequences, causing audio truncation. First split on sentence
 * boundaries, then break any remaining long segments on clause-level
 * punctuation (commas, semicolons, colons, dashes).
 */
function splitForVits(text: string, maxWords = 8): string[] {
	const sentences = splitIntoSentences(text);
	const chunks: string[] = [];

	for (const sentence of sentences) {
		if (sentence.split(/\s+/).length <= maxWords) {
			chunks.push(sentence);
			continue;
		}
		// Break on clause punctuation (keep punctuation with preceding segment)
		const clauses = sentence
			.split(/(?<=[,;:\u2014–-])\s+/)
			.filter((s) => s.length > 0);

		if (clauses.length > 1) {
			chunks.push(...clauses);
		} else {
			chunks.push(sentence);
		}
	}

	return chunks;
}

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
		// vits-web hardcodes onnxruntime-web wasmPaths to a CDN URL for v1.18.0,
		// but the pnpm override forces v1.25.0-dev. The version-mismatched CDN
		// WASM files cause "Failed to fetch dynamically imported module: blob:..."
		// on Chrome macOS. Lock wasmPaths to same-origin /onnx/ (where the correct
		// 1.25.0-dev WASM files are served) so vits-web's overwrite is ignored.
		const ort = await import("onnxruntime-web");
		ort.env.wasm.wasmPaths = "/onnx/";
		Object.defineProperty(ort.env.wasm, "wasmPaths", {
			get() {
				return "/onnx/";
			},
			set() {
				/* prevent vits-web from overwriting to CDN */
			},
			configurable: true,
		});

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

		// Split into short chunks to avoid VITS attention truncation.
		// The VITS model generates one utterance at a time; long phoneme sequences
		// cause the attention to lose alignment and the audio gets cut short.
		const sentences = splitForVits(text);
		const chunks: { audio: Float32Array; sampleRate: number }[] = [];

		for (const sentence of sentences) {
			const wavBlob = await this.vits.predict({
				text: sentence,
				voiceId: "en_US-lessac-medium",
			});
			chunks.push(await decodeWavBlob(wavBlob));
		}

		const sampleRate = chunks[0]?.sampleRate ?? 22050;
		const totalLength = chunks.reduce((sum, c) => sum + c.audio.length, 0);
		const audio = new Float32Array(totalLength);
		let offset = 0;
		for (const chunk of chunks) {
			audio.set(chunk.audio, offset);
			offset += chunk.audio.length;
		}

		const totalMs = performance.now() - start;
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
