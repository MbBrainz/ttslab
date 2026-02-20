export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface LlmModel {
	id: string;
	name: string;
	hfId: string;
	isQwen3: boolean;
	sizeMb: number;
}

export const LLM_MODELS: LlmModel[] = [
	{
		id: "qwen3-0.6b",
		name: "Qwen3 0.6B",
		hfId: "onnx-community/Qwen3-0.6B-ONNX",
		isQwen3: true,
		sizeMb: 370,
	},
	{
		id: "qwen2.5-1.5b",
		name: "Qwen2.5 1.5B",
		hfId: "onnx-community/Qwen2.5-1.5B-Instruct",
		isQwen3: false,
		sizeMb: 924,
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
	  }
	| { type: "cancel" }
	| { type: "dispose" };

export type LlmWorkerResponse =
	| {
			type: "progress";
			data: { status: "downloading" | "ready"; file: string; loaded: number; total: number };
	  }
	| { type: "loaded"; backend: "webgpu" | "wasm"; loadTime: number }
	| { type: "token"; token: string }
	| {
			type: "done";
			fullText: string;
			totalMs: number;
			tokenCount: number;
			tokensPerSec: number;
	  }
	| { type: "cancelled" }
	| { type: "error"; code: string; message: string }
	| { type: "disposed" };
