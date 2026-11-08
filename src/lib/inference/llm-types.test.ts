import { describe, expect, it } from "vitest";
import { LLM_CONTEXT_TOKENS, LLM_MODELS } from "./llm-types";

describe("LLM_MODELS invariants", () => {
	it("is non-empty", () => {
		expect(LLM_MODELS.length).toBeGreaterThan(0);
	});

	it("has the transformers.js 0.8B entry as the default first entry", () => {
		const first = LLM_MODELS[0];
		expect(first.engine).toBe("transformersjs");
		expect(first.id).toBe("qwen3.5-0.8b");
		expect(first.hfId).toBe("onnx-community/Qwen3.5-0.8B-Text-ONNX");
	});

	it("has unique, non-empty ids", () => {
		const ids = LLM_MODELS.map((m) => m.id);
		for (const id of ids) expect(id.length).toBeGreaterThan(0);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("pins every entry at the honest 4096-token context", () => {
		for (const m of LLM_MODELS) {
			expect(m.contextTokens).toBe(LLM_CONTEXT_TOKENS);
			expect(m.contextTokens).toBe(4096);
		}
	});

	it("advertises a positive download size for every entry", () => {
		for (const m of LLM_MODELS) expect(m.sizeMb).toBeGreaterThan(0);
	});

	it("flags every webllm entry as WebGPU + shader-f16 only, with an MLC id and VRAM estimate", () => {
		const webllm = LLM_MODELS.filter((m) => m.engine === "webllm");
		expect(webllm.length).toBeGreaterThanOrEqual(2);
		for (const m of webllm) {
			expect(m.requiresWebGPU).toBe(true);
			expect(m.requiresShaderF16).toBe(true);
			expect(m.mlcModelId).toMatch(/^Qwen3\.5-(2|4)B-q4f16_1-MLC$/);
			expect(m.hfId).toBeUndefined();
			expect(m.vramMb).toBeGreaterThan(0);
		}
	});

	it("uses the verified prebuilt MLC model ids", () => {
		expect(
			LLM_MODELS.find((m) => m.id === "qwen3.5-2b-webllm")?.mlcModelId,
		).toBe("Qwen3.5-2B-q4f16_1-MLC");
		expect(
			LLM_MODELS.find((m) => m.id === "qwen3.5-4b-webllm")?.mlcModelId,
		).toBe("Qwen3.5-4B-q4f16_1-MLC");
	});

	it("defines the wllama entry as a CPU/WASM GGUF exhibit with no GPU requirement", () => {
		const wllama = LLM_MODELS.find((m) => m.engine === "wllama");
		expect(wllama).toBeDefined();
		expect(wllama?.requiresWebGPU).toBe(false);
		expect(wllama?.requiresShaderF16).toBe(false);
		expect(wllama?.vramMb).toBeUndefined();
		expect(wllama?.ggufRepo).toBe("unsloth/Qwen3.5-0.8B-GGUF");
		expect(wllama?.ggufFile).toBe("Qwen3.5-0.8B-Q4_K_M.gguf");
	});

	it("keeps VRAM estimates on exactly the entries that require a GPU", () => {
		for (const m of LLM_MODELS) {
			if (m.requiresWebGPU) expect(m.vramMb).toBeGreaterThan(0);
			else expect(m.vramMb).toBeUndefined();
		}
	});

	it("stays within the Qwen3.5 family across all three tiers", () => {
		for (const m of LLM_MODELS) {
			expect(m.isQwen3).toBe(true);
			expect(m.name).toContain("Qwen3.5");
		}
	});
});
