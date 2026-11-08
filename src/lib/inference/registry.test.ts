import { describe, expect, it } from "vitest";
import { getLoader, getRegisteredSlugs } from "./registry";

describe("registry invariants", () => {
	it("registers unique slugs", () => {
		const slugs = getRegisteredSlugs();
		expect(slugs.length).toBeGreaterThan(0);
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	it("kitten-tts-nano resolves to a TTS loader with WASM-only backends", async () => {
		const loader = await getLoader("kitten-tts-nano");
		expect(loader).not.toBeNull();
		expect(loader?.slug).toBe("kitten-tts-nano");
		expect(loader?.type).toBe("tts");
		expect(loader?.getLanguages()).toEqual(["en"]);
		expect(loader?.getVoices?.().length).toBe(8);
		// The ONNX repo only ships a q8 quantized file — no WebGPU variant.
		expect(loader?.getSupportedBackends()).toEqual(["wasm"]);
	});

	it("distil-whisper-small-en resolves to an English-only STT loader", async () => {
		const loader = await getLoader("distil-whisper-small-en");
		expect(loader).not.toBeNull();
		expect(loader?.slug).toBe("distil-whisper-small-en");
		expect(loader?.type).toBe("stt");
		expect(loader?.getLanguages()).toContain("en");
		expect(loader?.transcribe).toBeDefined();
	});

	it("woof-tts resolves to a custom-JS TTS loader with WebGPU + WASM backends", async () => {
		const loader = await getLoader("woof-tts");
		expect(loader).not.toBeNull();
		expect(loader?.slug).toBe("woof-tts");
		expect(loader?.type).toBe("tts");
		// Hand-ported inference (typed-array CPU path + hand-written WGSL WebGPU
		// path): still no ONNX/WASM engine underneath.
		expect(loader?.framework).toBe("custom-js");
		expect(loader?.getSupportedBackends()).toEqual(["webgpu", "wasm"]);
		// Auto: the backend-select probe prefers WebGPU when an adapter exists
		// and falls back to the typed-array path otherwise.
		expect(loader?.getPreferredBackend?.()).toBe("auto");
	});

	it("woof-tts exposes the two HF voices, juno and mira", async () => {
		const loader = await getLoader("woof-tts");
		expect(loader?.getVoices?.().map((v) => v.id)).toEqual(["juno", "mira"]);
		expect(loader?.getLanguages()).toEqual(["en"]);
		expect(loader?.synthesize).toBeDefined();
		expect(typeof loader?.synthesize).toBe("function");
	});

	it("returns null for unregistered slugs", async () => {
		expect(await getLoader("does-not-exist")).toBeNull();
	});
});
