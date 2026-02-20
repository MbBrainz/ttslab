import { selectBackend } from "./backend-select";
import { configureOnnxWasmPaths } from "./onnx-config";
import type { LlmWorkerCommand, LlmWorkerResponse, ChatMessage } from "./llm-types";

// biome-ignore lint/suspicious/noExplicitAny: dynamically loaded transformers types
let tokenizer: any = null;
// biome-ignore lint/suspicious/noExplicitAny: dynamically loaded transformers types
let model: any = null;
let cancelled = false;

const SYSTEM_PROMPT =
	"You are a helpful voice assistant having a real-time conversation. Keep responses concise — 1-3 sentences maximum. Never use markdown formatting, bullet points, or numbered lists. Never use emojis. Be natural and conversational. Remember what the user said earlier in the conversation and refer back to it when relevant.";

self.onmessage = async (e: MessageEvent<LlmWorkerCommand>) => {
	const cmd = e.data;

	try {
		switch (cmd.type) {
			case "load": {
				// Dispose previous model to free memory before loading a new one
				if (model?.dispose) await model.dispose();
				model = null;
				tokenizer = null;

				const {
					AutoTokenizer,
					AutoModelForCausalLM,
					env,
				} = await import("@huggingface/transformers");

				configureOnnxWasmPaths(env);

				const backend = await selectBackend(true, true, cmd.backend);

				const device = backend === "webgpu" ? "webgpu" : "wasm";
				const dtype = backend === "webgpu" ? "q4f16" : "q4";

				const loadStart = performance.now();

				const progressCallback = (progress: { status: string; file?: string; loaded?: number; total?: number }) => {
					if (progress.status === "progress" && progress.file) {
						post({
							type: "progress",
							data: {
								status: "downloading",
								file: progress.file,
								loaded: progress.loaded ?? 0,
								total: progress.total ?? 0,
							},
						});
					}
				};

				tokenizer = await AutoTokenizer.from_pretrained(cmd.hfId, {
					progress_callback: progressCallback,
				});

				model = await AutoModelForCausalLM.from_pretrained(cmd.hfId, {
					device,
					dtype,
					progress_callback: progressCallback,
				});

				const loadTime = Math.round(performance.now() - loadStart);
				post({ type: "loaded", backend, loadTime });
				break;
			}

			case "generate": {
				if (!tokenizer || !model) {
					post({ type: "error", code: "NOT_LOADED", message: "Model not loaded" });
					return;
				}

				cancelled = false;
				const genStart = performance.now();
				let tokenCount = 0;
				let fullText = "";

				// Build messages with system prompt
				const messages: ChatMessage[] = [
					{ role: "system", content: SYSTEM_PROMPT },
					...cmd.messages,
				];

				// For Qwen3, prepend /no_think to system content to disable thinking
				const isQwen3 = tokenizer.chat_template?.includes?.("Qwen3") ||
					tokenizer.name_or_path?.includes?.("Qwen3");
				if (isQwen3) {
					messages[0] = {
						...messages[0],
						content: `/no_think\n${messages[0].content}`,
					};
				}

				const inputs = tokenizer.apply_chat_template(messages, {
					add_generation_prompt: true,
					return_dict: true,
				});

				let insideThinkBlock = false;
				let thinkBuffer = "";

				const { TextStreamer } = await import("@huggingface/transformers");

				const streamer = new TextStreamer(tokenizer, {
					skip_prompt: true,
					skip_special_tokens: true,
					callback_function: (token: string) => {
						if (cancelled) return;

						// Filter <think>...</think> blocks
						const combined = thinkBuffer + token;
						thinkBuffer = "";

						if (insideThinkBlock) {
							const endIdx = combined.indexOf("</think>");
							if (endIdx !== -1) {
								insideThinkBlock = false;
								const after = combined.slice(endIdx + 8);
								if (after.length > 0) {
									tokenCount++;
									fullText += after;
									post({ type: "token", token: after });
								}
							}
							// Still inside think block, discard
							return;
						}

						const thinkIdx = combined.indexOf("<think>");
						if (thinkIdx !== -1) {
							const before = combined.slice(0, thinkIdx);
							if (before.length > 0) {
								tokenCount++;
								fullText += before;
								post({ type: "token", token: before });
							}
							insideThinkBlock = true;
							const rest = combined.slice(thinkIdx + 7);
							const endIdx = rest.indexOf("</think>");
							if (endIdx !== -1) {
								insideThinkBlock = false;
								const after = rest.slice(endIdx + 8);
								if (after.length > 0) {
									tokenCount++;
									fullText += after;
									post({ type: "token", token: after });
								}
							}
							return;
						}

						// Check for partial <think> at the end
						if (combined.includes("<") && !combined.includes(">")) {
							thinkBuffer = combined;
							return;
						}

						tokenCount++;
						fullText += combined;
						post({ type: "token", token: combined });
					},
				});

				await model.generate({
					...inputs,
					max_new_tokens: cmd.maxNewTokens,
					temperature: cmd.temperature,
					do_sample: cmd.temperature > 0,
					streamer,
				});

				if (cancelled) {
					post({ type: "cancelled" });
					return;
				}

				// Flush any remaining buffer
				if (thinkBuffer.length > 0 && !insideThinkBlock) {
					fullText += thinkBuffer;
					post({ type: "token", token: thinkBuffer });
					tokenCount++;
				}

				const totalMs = Math.round(performance.now() - genStart);
				const tokensPerSec = tokenCount > 0 ? Math.round((tokenCount / totalMs) * 1000 * 10) / 10 : 0;

				post({
					type: "done",
					fullText: fullText.trim(),
					totalMs,
					tokenCount,
					tokensPerSec,
				});
				break;
			}

			case "cancel": {
				cancelled = true;
				break;
			}

			case "dispose": {
				if (model?.dispose) await model.dispose();
				model = null;
				tokenizer = null;
				post({ type: "disposed" });
				break;
			}
		}
	} catch (err) {
		post({
			type: "error",
			code: "LLM_WORKER_ERROR",
			message: err instanceof Error ? err.message : "Unknown LLM worker error",
		});
	}
};

function post(msg: LlmWorkerResponse) {
	self.postMessage(msg);
}
