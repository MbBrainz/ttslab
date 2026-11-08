import { selectBackend } from "./backend-select";
import { fitMessagesToContext } from "./llm-history";
import { SYSTEM_PROMPT } from "./llm-prompt";
import type {
	ChatMessage,
	LlmWorkerCommand,
	LlmWorkerResponse,
} from "./llm-types";
import { configureOnnxWasmPaths } from "./onnx-config";

// biome-ignore lint/suspicious/noExplicitAny: dynamically loaded transformers types
let tokenizer: any = null;
// biome-ignore lint/suspicious/noExplicitAny: dynamically loaded transformers types
let model: any = null;

// Pin HF revisions where the current upstream export no longer runs on the
// onnxruntime-web build pinned in pnpm-workspace.yaml. The Apr 22 2026
// re-export of Qwen3.5 ("Upload optimized models (#2)") fuses its conv layers
// into com.microsoft::CausalConvWithState, which ORT 1.25.0-dev does not
// register — session creation throws before any inference. This revision is
// the last pre-re-export commit (Mar 24 2026), the same files the voice agent
// shipped against in April. NOTE: this revision graph plus ORT 1.31.1 is
// BROWSER-UNVERIFIED (the 2026-11-08 pending-pass disclosure) — the pin is
// known-good on 1.25.0-dev only. Distil-Whisper and the engine picker have
// browser passes; the LLM engines do not yet.
const HF_REVISIONS: Record<string, string> = {
	"onnx-community/Qwen3.5-0.8B-Text-ONNX":
		"c76a8adddf6019838b0041ee7f29e8136d43f15b",
};

// Serialize all commands — async onmessage yields at first await, which would
// let the next message start concurrently causing race conditions.
let commandQueue: Promise<void> = Promise.resolve();

// Cancel is handled OUT OF BAND, before queueing: routing it through the
// serialized queue would park it behind the very generation it must interrupt
// (a queued promise cannot preempt the running one), leaving the cancel
// button dead until generation finished on its own. Each generate gets a
// monotonic id; a cancel marks every generate dispatched so far as cancelled
// (the running one plus any still-queued ones), and the generate loop polls
// isCancelled(genId) between tokens.
let nextGenerateId = 0;
let cancelledThrough = -1;

self.onmessage = (e: MessageEvent<LlmWorkerCommand>) => {
	if (e.data.type === "cancel") {
		cancelledThrough = nextGenerateId - 1;
		return;
	}
	if (e.data.type === "generate") {
		const genId = nextGenerateId++;
		commandQueue = commandQueue.then(() => handleCommand(e.data, genId));
		return;
	}
	commandQueue = commandQueue.then(() => handleCommand(e.data));
};

function isCancelled(genId: number): boolean {
	return genId <= cancelledThrough;
}

async function handleCommand(cmd: LlmWorkerCommand, genId?: number) {
	try {
		switch (cmd.type) {
			case "load": {
				// Dispose previous model to free memory before loading a new one
				if (model?.dispose) await model.dispose();
				model = null;
				tokenizer = null;

				const { AutoTokenizer, AutoModelForCausalLM, env } = await import(
					"@huggingface/transformers"
				);

				configureOnnxWasmPaths(env);

				const backend = await selectBackend(true, true, cmd.backend);

				const device = backend === "webgpu" ? "webgpu" : "wasm";
				const dtype = backend === "webgpu" ? "q4f16" : "q4";

				const loadStart = performance.now();

				const progressCallback = (progress: {
					status: string;
					file?: string;
					loaded?: number;
					total?: number;
				}) => {
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

				const revision = HF_REVISIONS[cmd.hfId];

				tokenizer = await AutoTokenizer.from_pretrained(cmd.hfId, {
					revision,
					progress_callback: progressCallback,
				});

				model = await AutoModelForCausalLM.from_pretrained(cmd.hfId, {
					device,
					dtype,
					revision,
					progress_callback: progressCallback,
				});

				const loadTime = Math.round(performance.now() - loadStart);
				post({ type: "loaded", backend, loadTime });
				break;
			}

			case "generate": {
				if (!tokenizer || !model) {
					post({
						type: "error",
						code: "NOT_LOADED",
						message: "Model not loaded",
					});
					return;
				}
				if (genId === undefined) {
					post({
						type: "error",
						code: "LLM_WORKER_ERROR",
						message: "Generate command is missing its generation id",
					});
					return;
				}

				// A generate cancelled before it started (barge-in during queue
				// wait) reports cancelled without prefilling at all.
				if (isCancelled(genId)) {
					post({ type: "cancelled", genId });
					return;
				}

				const genStart = performance.now();
				let tokenCount = 0;
				let fullText = "";

				// Honest context pin: no persisted KV cache means this message
				// list is the whole context cost of the turn, so trim the oldest
				// turns until system + kept history + this answer fit inside the
				// advertised window. The client (use-voice-agent) applies the
				// same helper first; this is the enforcing backstop for any
				// caller that sends uncapped history.
				const fit = fitMessagesToContext(cmd.messages, cmd.contextTokens, {
					maxNewTokens: cmd.maxNewTokens,
					systemPrompt: SYSTEM_PROMPT,
				});

				// Build messages with system prompt
				const messages: ChatMessage[] = [
					{ role: "system", content: SYSTEM_PROMPT },
					...fit.kept,
				];

				// For Qwen3, prepend /no_think to system content to disable thinking
				const isQwen3 =
					tokenizer.chat_template?.includes?.("Qwen3") ||
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
						if (isCancelled(genId)) return;

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
									post({ type: "token", token: after, genId });
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
								post({ type: "token", token: before, genId });
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
									post({ type: "token", token: after, genId });
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
						post({ type: "token", token: combined, genId });
					},
				});

				// NOTE: past_key_values are deliberately NOT persisted across turns.
				// The incremental-DynamicCache pattern (send only the newest tokens,
				// let the cache carry prior turns) is unsafe in this pipeline:
				// (1) re-tokenizing the assistant reply as continuation text can
				// split BPE tokens differently than the ids the model itself
				// generated, silently shifting positions; (2) barge-in cancels
				// leave the cache holding more assistant text than the conversation
				// records, so client and cache diverge. Full re-prefill of the
				// trimmed history is slower per turn but correct — history is
				// attended exactly once.
				await model.generate({
					...inputs,
					max_new_tokens: cmd.maxNewTokens,
					temperature: cmd.temperature,
					do_sample: cmd.temperature > 0,
					return_dict_in_generate: true,
					streamer,
				});

				if (isCancelled(genId)) {
					post({ type: "cancelled", genId });
					return;
				}

				// Flush any remaining buffer
				if (thinkBuffer.length > 0 && !insideThinkBlock) {
					fullText += thinkBuffer;
					post({ type: "token", token: thinkBuffer, genId });
					tokenCount++;
				}

				const totalMs = Math.round(performance.now() - genStart);
				const tokensPerSec =
					tokenCount > 0
						? Math.round((tokenCount / totalMs) * 1000 * 10) / 10
						: 0;

				post({
					type: "done",
					fullText: fullText.trim(),
					totalMs,
					tokenCount,
					tokensPerSec,
					genId,
				});
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
}

function post(msg: LlmWorkerResponse) {
	self.postMessage(msg);
}
