export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

/**
 * Which inference engine runs a given model entry. Three tiers of the same
 * Qwen3.5 family:
 * - "transformersjs": ONNX weights via @huggingface/transformers (ORT WebGPU
 *   with q4f16, ORT WASM fallback with q4). Default tier.
 * - "webllm": MLC-compiled q4f16_1 weights via @mlc-ai/web-llm, WebGPU only.
 * - "wllama": GGUF via @wllama/wllama with GPU offload forced off — the
 *   deliberate pure-CPU WASM exhibit.
 */
export type LlmEngine = "transformersjs" | "webllm" | "wllama";

/**
 * Context window we actually pin at load time across every engine. Honest
 * number: the models support far more, but KV cache memory and real-time
 * voice latency demand a small window. Do not advertise longer.
 */
export const LLM_CONTEXT_TOKENS = 4096;

export interface LlmModel {
	id: string;
	name: string;
	engine: LlmEngine;
	/** HF repo id (transformersjs + wllama engines). */
	hfId?: string;
	/** MLC prebuilt model id from the web-llm registry (webllm engine). */
	mlcModelId?: string;
	/** GGUF source repo (wllama engine), e.g. "unsloth/Qwen3.5-0.8B-GGUF". */
	ggufRepo?: string;
	/** GGUF file inside ggufRepo (wllama engine), e.g. "Qwen3.5-0.8B-Q4_K_M.gguf". */
	ggufFile?: string;
	isQwen3: boolean;
	/** Honest estimated download size in MB (weights + tokenizer assets). */
	sizeMb: number;
	/** Estimated peak VRAM in MB; set only for entries that require a GPU. */
	vramMb?: number;
	/** Context window pinned at load time. See LLM_CONTEXT_TOKENS. */
	contextTokens: number;
	/** True when the entry cannot run at all without a WebGPU adapter. */
	requiresWebGPU: boolean;
	/** True when the entry additionally needs the shader-f16 adapter feature. */
	requiresShaderF16: boolean;
	/** One-line honest note shown in the picker (engine + trade-off). */
	note: string;
}

export const LLM_MODELS: LlmModel[] = [
	{
		id: "qwen3.5-0.8b",
		name: "Qwen3.5 0.8B",
		engine: "transformersjs",
		hfId: "onnx-community/Qwen3.5-0.8B-Text-ONNX",
		isQwen3: true,
		sizeMb: 490,
		contextTokens: LLM_CONTEXT_TOKENS,
		requiresWebGPU: false,
		requiresShaderF16: false,
		note: "transformers.js · WebGPU when available, falls back to WASM",
	},
	{
		id: "qwen3.5-2b-webllm",
		name: "Qwen3.5 2B",
		engine: "webllm",
		mlcModelId: "Qwen3.5-2B-q4f16_1-MLC",
		isQwen3: true,
		sizeMb: 1080,
		vramMb: 2200,
		contextTokens: LLM_CONTEXT_TOKENS,
		requiresWebGPU: true,
		requiresShaderF16: true,
		note: "WebLLM (MLC q4f16_1) · WebGPU + shader-f16 required, ~2.2GB VRAM",
	},
	{
		id: "qwen3.5-4b-webllm",
		name: "Qwen3.5 4B",
		engine: "webllm",
		mlcModelId: "Qwen3.5-4B-q4f16_1-MLC",
		isQwen3: true,
		sizeMb: 2390,
		vramMb: 3900,
		contextTokens: LLM_CONTEXT_TOKENS,
		requiresWebGPU: true,
		requiresShaderF16: true,
		note: "WebLLM (MLC q4f16_1) · WebGPU + shader-f16 required, ~3.9GB VRAM",
	},
	{
		id: "qwen3.5-0.8b-wllama",
		name: "Qwen3.5 0.8B (WASM)",
		engine: "wllama",
		hfId: "unsloth/Qwen3.5-0.8B-GGUF",
		ggufRepo: "unsloth/Qwen3.5-0.8B-GGUF",
		ggufFile: "Qwen3.5-0.8B-Q4_K_M.gguf",
		isQwen3: true,
		sizeMb: 533,
		contextTokens: LLM_CONTEXT_TOKENS,
		requiresWebGPU: false,
		requiresShaderF16: false,
		note: "wllama (llama.cpp GGUF Q4_K_M) · pure CPU/WASM, GPU offload forced off",
	},
];

export type LlmWorkerCommand =
	| {
			type: "load";
			modelId: string;
			hfId: string;
			backend: "webgpu" | "wasm" | "auto";
	  }
	| {
			type: "generate";
			messages: ChatMessage[];
			maxNewTokens: number;
			temperature: number;
			/**
			 * Advertised context window for the honest input pin (see
			 * llm-history.ts). Optional: undefined disables the trim, which is
			 * correct for engines that pin context at load time.
			 */
			contextTokens?: number;
	  }
	| { type: "cancel" }
	| { type: "dispose" };

export type LlmWorkerResponse =
	| {
			type: "progress";
			data: {
				status: "downloading" | "ready";
				file: string;
				loaded: number;
				total: number;
			};
	  }
	| { type: "loaded"; backend: "webgpu" | "wasm"; loadTime: number }
	| { type: "token"; token: string; genId?: number }
	| {
			type: "done";
			fullText: string;
			totalMs: number;
			tokenCount: number;
			tokensPerSec: number;
			genId?: number;
	  }
	| { type: "cancelled"; genId?: number }
	| { type: "error"; code: string; message: string }
	| { type: "disposed" };

/**
 * Thrown by the WebLLM/wllama transports when an in-flight load() is
 * invalidated by a genuinely newer load() (model switch) or dispose().
 * This is an expected cancellation, not a load failure — the voice-agent
 * hook swallows it so a superseded tier never flashes "failed" while its
 * successor is loading.
 */
export class LlmLoadSupersededError extends Error {
	constructor(engine: string) {
		super(`${engine} load cancelled by a newer load`);
		this.name = "LlmLoadSupersededError";
	}
}
