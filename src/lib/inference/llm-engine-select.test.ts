import { describe, expect, it } from "vitest";
import {
	availableLlmModels,
	CAPABILITY_UNPROBED,
	isModelAvailable,
	type LlmCapability,
} from "./llm-engine-select";
import { LLM_MODELS, type LlmModel } from "./llm-types";

const GPU_ENTRY = LLM_MODELS.find((m) => m.engine === "webllm") as LlmModel;
const WASM_ENTRY = LLM_MODELS[0]; // transformers.js — WebGPU optional, WASM fallback
const WLLAMA_ENTRY = LLM_MODELS.find((m) => m.engine === "wllama") as LlmModel;

const cap = (overrides: Partial<LlmCapability>): LlmCapability => ({
	probed: true,
	webgpu: false,
	shaderF16: false,
	...overrides,
});

describe("isModelAvailable gating", () => {
	it("always offers WASM-capable entries, even with no probe and no GPU", () => {
		expect(isModelAvailable(WASM_ENTRY, null)).toBe(true);
		expect(isModelAvailable(WASM_ENTRY, CAPABILITY_UNPROBED)).toBe(true);
		expect(
			isModelAvailable(WASM_ENTRY, cap({ webgpu: false, shaderF16: false })),
		).toBe(true);
	});

	it("always offers the wllama CPU/WASM exhibit regardless of capability", () => {
		expect(isModelAvailable(WLLAMA_ENTRY, null)).toBe(true);
		expect(isModelAvailable(WLLAMA_ENTRY, CAPABILITY_UNPROBED)).toBe(true);
		expect(isModelAvailable(WLLAMA_ENTRY, cap({ webgpu: false }))).toBe(true);
	});

	it("never offers WebGPU-only entries before the probe completes", () => {
		expect(isModelAvailable(GPU_ENTRY, null)).toBe(false);
		expect(isModelAvailable(GPU_ENTRY, CAPABILITY_UNPROBED)).toBe(false);
	});

	it("offers WebGPU entries only when the adapter has shader-f16", () => {
		expect(
			isModelAvailable(GPU_ENTRY, cap({ webgpu: true, shaderF16: true })),
		).toBe(true);
		expect(
			isModelAvailable(GPU_ENTRY, cap({ webgpu: true, shaderF16: false })),
		).toBe(false);
		expect(
			isModelAvailable(GPU_ENTRY, cap({ webgpu: false, shaderF16: true })),
		).toBe(false);
	});
});

describe("availableLlmModels", () => {
	it("keeps list order while filtering", () => {
		const full = availableLlmModels(
			LLM_MODELS,
			cap({ webgpu: true, shaderF16: true }),
		);
		expect(full.map((m) => m.id)).toEqual(LLM_MODELS.map((m) => m.id));

		const wasmOnly = availableLlmModels(
			LLM_MODELS,
			cap({ webgpu: false, shaderF16: false }),
		);
		expect(wasmOnly.map((m) => m.id)).toEqual([WASM_ENTRY.id, WLLAMA_ENTRY.id]);
	});

	it("falls back to the two WASM tiers while probing (null capability)", () => {
		const models = availableLlmModels(LLM_MODELS, null);
		expect(models.every((m) => !m.requiresWebGPU)).toBe(true);
		expect(models.length).toBe(2);
	});

	it("gates the shader-f16 requirement per entry", () => {
		const noF16 = availableLlmModels(
			LLM_MODELS,
			cap({ webgpu: true, shaderF16: false }),
		);
		expect(noF16.some((m) => m.requiresShaderF16)).toBe(false);
		expect(noF16.length).toBe(2);
	});
});
