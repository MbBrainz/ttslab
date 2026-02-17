import type { ModelLoader } from "./types";

const loaders = new Map<string, () => Promise<ModelLoader>>();

// Register model loaders lazily to avoid bundling all frameworks upfront

// --- TTS ---

loaders.set("kokoro-82m", async () => {
	const { KokoroLoader } = await import("./loaders/kokoro");
	return new KokoroLoader();
});

loaders.set("supertonic-2", async () => {
	const { SupertonicLoader } = await import("./loaders/supertonic");
	return new SupertonicLoader();
});

loaders.set("speecht5", async () => {
	const { SpeechT5Loader } = await import("./loaders/speecht5");
	return new SpeechT5Loader();
});

loaders.set("piper-en-us-lessac-medium", async () => {
	const { PiperLoader } = await import("./loaders/piper");
	return new PiperLoader();
});

// --- STT ---

loaders.set("whisper-tiny", async () => {
	const { WhisperLoader } = await import("./loaders/whisper");
	return new WhisperLoader("whisper-tiny", "onnx-community/whisper-tiny");
});

loaders.set("whisper-base", async () => {
	const { WhisperLoader } = await import("./loaders/whisper");
	return new WhisperLoader("whisper-base", "onnx-community/whisper-base");
});

loaders.set("whisper-small", async () => {
	const { WhisperLoader } = await import("./loaders/whisper");
	return new WhisperLoader("whisper-small", "onnx-community/whisper-small");
});

loaders.set("whisper-large-v3-turbo", async () => {
	const { WhisperLoader } = await import("./loaders/whisper");
	return new WhisperLoader(
		"whisper-large-v3-turbo",
		"onnx-community/whisper-large-v3-turbo",
		{ encoder_model: "fp32", decoder_model_merged: "q4" },
	);
});

loaders.set("moonshine-base", async () => {
	const { MoonshineLoader } = await import("./loaders/moonshine");
	return new MoonshineLoader();
});

loaders.set("moonshine-tiny", async () => {
	const { MoonshineLoader } = await import("./loaders/moonshine");
	return new MoonshineLoader(
		"moonshine-tiny",
		"onnx-community/moonshine-tiny-ONNX",
		["en"],
	);
});

loaders.set("moonshine-tiny-ja", async () => {
	const { MoonshineLoader } = await import("./loaders/moonshine");
	return new MoonshineLoader(
		"moonshine-tiny-ja",
		"onnx-community/moonshine-tiny-ja-ONNX",
		["ja"],
	);
});

loaders.set("moonshine-tiny-ko", async () => {
	const { MoonshineLoader } = await import("./loaders/moonshine");
	return new MoonshineLoader(
		"moonshine-tiny-ko",
		"onnx-community/moonshine-tiny-ko-ONNX",
		["ko"],
	);
});

loaders.set("moonshine-tiny-zh", async () => {
	const { MoonshineLoader } = await import("./loaders/moonshine");
	return new MoonshineLoader(
		"moonshine-tiny-zh",
		"onnx-community/moonshine-tiny-zh-ONNX",
		["zh"],
	);
});

export async function getLoader(slug: string): Promise<ModelLoader | null> {
	const factory = loaders.get(slug);
	if (!factory) return null;
	return factory();
}

export function getRegisteredSlugs(): string[] {
	return Array.from(loaders.keys());
}
