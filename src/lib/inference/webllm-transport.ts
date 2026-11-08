import {
	CreateWebWorkerMLCEngine,
	type WebWorkerMLCEngine,
} from "@mlc-ai/web-llm";
import type { DownloadProgress } from "@/lib/inference/types";
import { buildVoiceMessages } from "./llm-prompt";
import type { LlmLoadedResult } from "./llm-transport";
import {
	type ChatMessage,
	LlmLoadSupersededError,
	type LlmModel,
} from "./llm-types";
import { ThinkTagFilter } from "./think-filter";

export interface LlmGenerateOptions {
	maxNewTokens?: number;
	temperature?: number;
}

export interface LlmGenerateCallbacks {
	onToken: (token: string) => void;
	onDone: (data: {
		fullText: string;
		totalMs: number;
		tokenCount: number;
		tokensPerSec: number;
	}) => void;
	onError: (error: Error) => void;
}

/**
 * Main-thread client for the WebLLM engine running in webllm-worker.ts.
 * Streams chat.completions chunks, strips <think> blocks, and reports the
 * same shape the transformers.js path produces (LlmTokenCallback semantics).
 */
export class WebLlmTransport {
	private client: WebWorkerMLCEngine | null = null;
	private worker: Worker | null = null;
	private abortController: AbortController | null = null;
	private generating = false;
	/**
	 * Monotonic epoch guarding concurrent load()s: a newer load() (or dispose())
	 * invalidates an in-flight older one, which must then resolve/reject
	 * cleanly and tear down its own worker instead of leaking it.
	 */
	private loadEpoch = 0;
	/** A generate() that arrived while the transport was still unwinding an
	 *  abort (cancel clears isGenerating immediately); run once settled. */
	private pendingGenerate: {
		messages: ChatMessage[];
		callbacks: LlmGenerateCallbacks;
		options?: LlmGenerateOptions;
	} | null = null;

	async load(
		model: LlmModel,
		onProgress?: (progress: DownloadProgress) => void,
	): Promise<LlmLoadedResult> {
		if (!model.mlcModelId) {
			throw new Error(
				`Model ${model.id} is not a WebLLM entry (missing mlcModelId)`,
			);
		}

		const epoch = ++this.loadEpoch;

		// Free any previous engine + worker (VRAM is held by the old worker until
		// it is terminated). Internal teardown only — disposeCore() must not bump
		// the epoch, or this load would fail its own staleness check below (the
		// regression where every load died with "cancelled by a newer load").
		await this.disposeCore();

		const worker = new Worker(new URL("./webllm-worker.ts", import.meta.url), {
			type: "module",
		});
		this.worker = worker;

		// Honest progress mapping: web-llm reports a 0..1 fraction; we scale it
		// against the advertised download size so the tracker shows real MB.
		const totalBytes = model.sizeMb * 1_000_000;
		const loadStart = performance.now();

		try {
			const client = await CreateWebWorkerMLCEngine(
				worker,
				model.mlcModelId,
				{
					initProgressCallback: (report) => {
						onProgress?.({
							status: report.progress >= 1 ? "ready" : "downloading",
							file: model.mlcModelId ?? model.id,
							loaded: Math.round(report.progress * totalBytes),
							total: totalBytes,
						});
					},
				},
				{
					// Pin the KV cache to the advertised honest context window instead of
					// the model's full context (262k for Qwen3.5) — VRAM honesty.
					context_window_size: model.contextTokens,
					sliding_window_size: -1,
				},
			);

			if (epoch !== this.loadEpoch) {
				// Superseded mid-load by a genuinely newer load()/dispose(): tear
				// down what we built through the LOCAL refs — this.client/
				// this.worker may already belong to the newer operation.
				try {
					await client.unload();
				} catch {
					// Engine may already be gone.
				}
				worker.terminate();
				if (this.client === client) this.client = null;
				if (this.worker === worker) this.worker = null;
				throw new LlmLoadSupersededError("WebLLM");
			}

			this.client = client;
		} catch (err) {
			if (epoch === this.loadEpoch) {
				// The engine never attached, so this worker holds nothing useful —
				// terminate it or the failed load leaks a live worker (and memory).
				// (When superseded, the newer operation already owns both refs.)
				worker.terminate();
				if (this.worker === worker) this.worker = null;
			}
			throw err;
		}

		return {
			backend: "webgpu",
			loadTime: Math.round(performance.now() - loadStart),
		};
	}

	generate(
		messages: ChatMessage[],
		callbacks: LlmGenerateCallbacks,
		options?: LlmGenerateOptions,
	): void {
		if (!this.client) {
			callbacks.onError(new Error("WebLLM engine not loaded"));
			return;
		}
		if (this.generating) {
			// cancel() clears isGenerating immediately while the engine is still
			// unwinding the aborted stream — an immediate re-generate must not
			// error. Queue it; runSettled fires it once the unwind finishes.
			this.pendingGenerate = { messages, callbacks, options };
			return;
		}

		this.generating = true;
		const controller = new AbortController();
		this.abortController = controller;
		const filter = new ThinkTagFilter();
		const genStart = performance.now();
		// Count surfaced (post-filter) text pieces; final count prefers usage.
		let pieceCount = 0;
		let fullText = "";
		let usageCompletionTokens: number | null = null;
		let usageTokensPerSec: number | null = null;

		const client = this.client;

		void (async () => {
			try {
				// web-llm's OpenAI-compatible surface takes no AbortSignal —
				// cancellation goes through engine.interruptGenerate() in cancel(),
				// which ends this stream. The controller tracks our own state.
				const stream = await client.chat.completions.create({
					messages: buildVoiceMessages(messages),
					stream: true,
					stream_options: { include_usage: true },
					temperature: options?.temperature ?? 0.7,
					max_tokens: options?.maxNewTokens ?? 256,
				});

				for await (const chunk of stream) {
					if (controller.signal.aborted) break;

					const delta = chunk.choices[0]?.delta?.content ?? "";
					if (delta) {
						const surfaced = filter.push(delta);
						if (surfaced) {
							pieceCount++;
							fullText += surfaced;
							callbacks.onToken(surfaced);
						}
					}

					if (chunk.usage) {
						usageCompletionTokens = chunk.usage.completion_tokens;
						usageTokensPerSec = chunk.usage.extra?.decode_tokens_per_s ?? null;
					}
				}

				if (controller.signal.aborted) {
					this.settleGenerate();
					return; // cancelled — caller resolves via its own cancellation flow
				}

				const tail = filter.flush();
				if (tail) {
					pieceCount++;
					fullText += tail;
					callbacks.onToken(tail);
				}

				const totalMs = Math.round(performance.now() - genStart);
				const tokenCount = usageCompletionTokens ?? pieceCount;
				const tokensPerSec =
					usageTokensPerSec ??
					(tokenCount > 0 && totalMs > 0
						? Math.round((tokenCount / totalMs) * 1000 * 10) / 10
						: 0);

				this.settleGenerate();
				callbacks.onDone({
					fullText: fullText.trim(),
					totalMs,
					tokenCount,
					tokensPerSec,
				});
			} catch (err) {
				this.settleGenerate();
				// Aborted streams surface as errors in some web-llm versions; treat
				// an abort after cancel() as cancellation, not failure.
				if (controller.signal.aborted) return;
				callbacks.onError(
					err instanceof Error ? err : new Error("WebLLM generation failed"),
				);
			}
		})();
	}

	/** Reset the generating flag after a stream settles and start a queued
	 *  re-generate, if cancel() + immediate generate() queued one. */
	private settleGenerate(): void {
		this.generating = false;
		this.abortController = null;
		const next = this.pendingGenerate;
		this.pendingGenerate = null;
		if (next) this.generate(next.messages, next.callbacks, next.options);
	}

	cancel(): void {
		this.abortController?.abort();
		// Best-effort engine-side stop; safe to call without a generation.
		void this.client?.interruptGenerate();
	}

	async dispose(): Promise<void> {
		// Invalidate any in-flight load() (see loadEpoch in load()).
		this.loadEpoch++;
		await this.disposeCore();
	}

	/** Tear the engine + worker down WITHOUT invalidating an in-flight load().
	 *  Used by load() itself between attempts; the public dispose() bumps the
	 *  epoch first so a concurrent load() rejects as superseded. */
	private async disposeCore(): Promise<void> {
		this.cancel();
		// A queued re-generate belongs to a disappearing engine — error it so
		// its caller is not left hanging.
		const pending = this.pendingGenerate;
		this.pendingGenerate = null;
		if (this.client) {
			try {
				await this.client.unload();
			} catch {
				// Engine may already be gone (worker died) — terminating below is
				// what actually releases the GPU process memory.
			}
		}
		this.worker?.terminate();
		this.client = null;
		this.worker = null;
		this.abortController = null;
		this.generating = false;
		if (pending) {
			pending.callbacks.onError(new Error("WebLLM engine disposed"));
		}
	}
}
