import type {
	AudioResult,
	LoadOptions,
	ModelLoader,
	ModelSession,
	Voice,
} from "../types";

export class PiperLoader implements ModelLoader {
	slug = "piper-en-us-lessac-medium";
	type = "tts" as const;
	framework = "piper-web" as const;

	private session: ModelSession | null = null;

	async load(_options: LoadOptions): Promise<ModelSession> {
		// Piper TTS web implementation
		// This is a placeholder — actual piper-tts-web integration
		// requires loading ONNX model files directly
		this.session = {
			dispose: () => {
				this.session = null;
			},
		};
		return this.session;
	}

	async synthesize(text: string): Promise<AudioResult> {
		if (!this.session) throw new Error("Model not loaded");

		// Placeholder — actual Piper integration would use the VITS model
		const sampleRate = 22050;
		const duration = text.length * 0.06; // rough estimate
		const samples = new Float32Array(Math.floor(sampleRate * duration));

		return {
			audio: samples,
			sampleRate,
			duration,
			metrics: {
				totalMs: 0,
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
