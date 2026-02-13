import type { ModelLoader } from "./types";

const loaders = new Map<string, () => Promise<ModelLoader>>();

// Register model loaders lazily to avoid bundling all frameworks upfront
loaders.set("kokoro-82m", async () => {
	const { KokoroLoader } = await import("./loaders/kokoro");
	return new KokoroLoader();
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

loaders.set("speecht5", async () => {
	const { SpeechT5Loader } = await import("./loaders/speecht5");
	return new SpeechT5Loader();
});

loaders.set("moonshine-base", async () => {
	const { MoonshineLoader } = await import("./loaders/moonshine");
	return new MoonshineLoader();
});

loaders.set("piper-en-us-lessac-medium", async () => {
	const { PiperLoader } = await import("./loaders/piper");
	return new PiperLoader();
});

export async function getLoader(slug: string): Promise<ModelLoader | null> {
	const factory = loaders.get(slug);
	if (!factory) return null;
	return factory();
}

export function getRegisteredSlugs(): string[] {
	return Array.from(loaders.keys());
}
