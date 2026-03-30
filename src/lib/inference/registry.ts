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

loaders.set("chatterbox", async () => {
	const { ChatterboxLoader } = await import("./loaders/chatterbox");
	return new ChatterboxLoader();
});

loaders.set("chatterbox-turbo", async () => {
	const { ChatterboxLoader } = await import("./loaders/chatterbox");
	return new ChatterboxLoader(
		"chatterbox-turbo",
		"ResembleAI/chatterbox-turbo-ONNX",
		true,
	);
});

loaders.set("chatterbox-multilingual", async () => {
	const { ChatterboxLoader } = await import("./loaders/chatterbox");
	return new ChatterboxLoader(
		"chatterbox-multilingual",
		"onnx-community/chatterbox-multilingual-ONNX",
		false,
		["ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja", "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh"],
	);
});

// --- STT ---

loaders.set("whisper-tiny.en", async () => {
	const { WhisperLoader } = await import("./loaders/whisper");
	return new WhisperLoader("whisper-tiny.en", "onnx-community/whisper-tiny.en");
});

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

loaders.set("moonshine-tiny-ar", async () => {
	const { MoonshineLoader } = await import("./loaders/moonshine");
	return new MoonshineLoader(
		"moonshine-tiny-ar",
		"onnx-community/moonshine-tiny-ar-ONNX",
		["ar"],
	);
});

loaders.set("moonshine-base-ja", async () => {
	const { MoonshineLoader } = await import("./loaders/moonshine");
	return new MoonshineLoader(
		"moonshine-base-ja",
		"onnx-community/moonshine-base-ja-ONNX",
		["ja"],
	);
});

loaders.set("moonshine-base-ko", async () => {
	const { MoonshineLoader } = await import("./loaders/moonshine");
	return new MoonshineLoader(
		"moonshine-base-ko",
		"onnx-community/moonshine-base-ko-ONNX",
		["ko"],
	);
});

loaders.set("moonshine-base-zh", async () => {
	const { MoonshineLoader } = await import("./loaders/moonshine");
	return new MoonshineLoader(
		"moonshine-base-zh",
		"onnx-community/moonshine-base-zh-ONNX",
		["zh"],
	);
});

loaders.set("cohere-transcribe", async () => {
	const { CohereTranscribeLoader } = await import("./loaders/cohere-transcribe");
	return new CohereTranscribeLoader();
});

loaders.set("granite-speech", async () => {
	const { GraniteSpeechLoader } = await import("./loaders/granite-speech");
	return new GraniteSpeechLoader();
});

loaders.set("lite-whisper-large-v3-turbo", async () => {
	const { WhisperLoader } = await import("./loaders/whisper");
	return new WhisperLoader(
		"lite-whisper-large-v3-turbo",
		"onnx-community/lite-whisper-large-v3-turbo-ONNX",
		{ encoder_model: "fp32", decoder_model_merged: "q4" },
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
