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
		id: "lfm2.5-1.2b",
		name: "LFM2.5 1.2B",
		hfId: "LiquidAI/LFM2.5-1.2B-Instruct-ONNX",
		isQwen3: false,
		sizeMb: 760,
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
