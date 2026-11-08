// Deep-import the prebuilt ESM bundle: @wllama/wllama 3.8.1's `main` points at
// a nonexistent index.js, which makes bare-specifier resolution fall through to
// the package's raw TypeScript sources — they fail to parse through webpack's
// client module pipeline. esm/index.js is the package's own published bundle
// (same sources, same version) and ships esm/index.d.ts for types.
import type { Wllama } from "@wllama/wllama/esm/index.js";
import type { DownloadProgress } from "@/lib/inference/types";
import { buildVoiceMessages } from "./llm-prompt";
import type { LlmLoadedResult } from "./llm-transport";
import type { ChatMessage, LlmModel } from "./llm-types";
import { ThinkTagFilter } from "./think-filter";
import type {
	LlmGenerateCallbacks,
	LlmGenerateOptions,
} from "./webllm-transport";

// Same-origin assets copied from node_modules by scripts/copy-wllama-wasm.mjs
// (postinstall). wllama must fetch its .wasm same-origin; the compat build is
// served too so Safari (no JSPI/MEMORY64) needs no CDN at runtime.
const WLLAMA_WASM_URL = "/wllama/wllama.wasm";
const WLLAMA_COMPAT_WASM_URL = "/wllama/compat/wllama.wasm";
const WLLAMA_COMPAT_WORKER_URL = "/wllama/compat/wllama.js";

/**
 * Main-thread transport for the wllama (llama.cpp/WASM) engine.
 *
 * This is the deliberate "no WebGPU" contrast exhibit: `n_gpu_layers: 0`
 * forces pure CPU/WASM inference even on machines that have a GPU. wllama
 * spawns its own internal worker, so no dedicated worker file is needed here.
 * The package is dynamically imported to keep it out of the initial bundle.
 */
export class WllamaTransport {
	private instance: Wllama | null = null;
	private abortController: AbortController | null = null;
	private generating = false;
	/**
	 * Monotonic epoch guarding concurrent load()s: a newer load() (or dispose())
	 * invalidates an in-flight older one, which must then reject cleanly and
	 * tear down its own instance instead of leaking it.
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
		if (!model.ggufRepo || !model.ggufFile) {
			throw new Error(
				`Model ${model.id} is not a wllama entry (missing gguf repo/file)`,
			);
		}

		const epoch = ++this.loadEpoch;

		await this.dispose();

		// Dynamic import — @wllama/wllama is only fetched when this tier runs.
		const { Wllama: WllamaCtor, LoggerWithoutDebug } = await import(
			"@wllama/wllama/esm/index.js"
		);

		const instance = new WllamaCtor(
			{ default: WLLAMA_WASM_URL },
			{ logger: LoggerWithoutDebug, parallelDownloads: 3 },
		);
		// Self-hosted compat assets (Asyncify build) for browsers without
		// JSPI/MEMORY64 — most notably Safari. 'safari' mode keeps Firefox on
		// the default build, where compat-mode WebGPU is unusably slow.
		instance.setCompat(
			{ wasm: WLLAMA_COMPAT_WASM_URL, worker: WLLAMA_COMPAT_WORKER_URL },
			"safari",
		);

		const loadStart = performance.now();

		try {
			await instance.loadModelFromHF(
				{ repo: model.ggufRepo, file: model.ggufFile },
				{
					// The whole point of this tier: zero GPU offload.
					n_gpu_layers: 0,
					// Honest context pin, same as the other engines.
					n_ctx: model.contextTokens,
					progressCallback: (e: { loaded: number; total: number }) => {
						onProgress?.({
							status:
								e.total > 0 && e.loaded >= e.total ? "ready" : "downloading",
							file: model.ggufFile ?? model.id,
							loaded: e.loaded,
							total: e.total,
						});
					},
				},
			);
		} catch (err) {
			// The instance already spawned its internal worker and holds WASM
			// memory — exit() releases both; without this a failed load leaks.
			try {
				await instance.exit();
			} catch {
				// Instance may not have survived startup — nothing to free.
			}
			throw err;
		}

		if (epoch !== this.loadEpoch) {
			// Superseded mid-load by a newer load()/dispose(): release this
			// instance cleanly and reject the stale caller.
			try {
				await instance.exit();
			} catch {
				// Instance may already be gone.
			}
			throw new Error("wllama load cancelled by a newer load");
		}

		this.instance = instance;
		return {
			backend: "wasm",
			loadTime: Math.round(performance.now() - loadStart),
		};
	}

	generate(
		messages: ChatMessage[],
		callbacks: LlmGenerateCallbacks,
		options?: LlmGenerateOptions,
	): void {
		const instance = this.instance;
		if (!instance) {
			callbacks.onError(new Error("wllama engine not loaded"));
			return;
		}
		if (this.generating) {
			// cancel() clears isGenerating immediately while the abort is still
			// unwinding — an immediate re-generate must not error. Queue it;
			// runSettled fires it once the unwind finishes.
			this.pendingGenerate = { messages, callbacks, options };
			return;
		}

		this.generating = true;
		const controller = new AbortController();
		this.abortController = controller;
		const filter = new ThinkTagFilter();
		const genStart = performance.now();
		let pieceCount = 0;
		let fullText = "";
		let predictedTokens: number | null = null;
		let predictedTokensPerSec: number | null = null;

		void (async () => {
			try {
				const stream = await instance.createChatCompletion({
					messages: buildVoiceMessages(messages),
					stream: true,
					temperature: options?.temperature ?? 0.7,
					max_tokens: options?.maxNewTokens ?? 256,
					abortSignal: controller.signal,
					cache_prompt: true,
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

					// Final chunks carry llama.cpp timings.
					if (chunk.timings) {
						predictedTokens = chunk.timings.predicted_n;
						predictedTokensPerSec =
							chunk.timings.predicted_per_second > 0
								? Math.round(chunk.timings.predicted_per_second * 10) / 10
								: null;
					}
				}

				if (controller.signal.aborted) {
					this.settleGenerate();
					return;
				}

				const tail = filter.flush();
				if (tail) {
					pieceCount++;
					fullText += tail;
					callbacks.onToken(tail);
				}

				const totalMs = Math.round(performance.now() - genStart);
				const tokenCount = predictedTokens ?? pieceCount;
				const tokensPerSec =
					predictedTokensPerSec ??
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
				if (controller.signal.aborted) return;
				callbacks.onError(
					err instanceof Error ? err : new Error("wllama generation failed"),
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
	}

	async dispose(): Promise<void> {
		// Invalidate any in-flight load() (see loadEpoch in load()).
		this.loadEpoch++;
		this.cancel();
		// A queued re-generate belongs to a disappearing engine — error it so
		// its caller is not left hanging.
		const pending = this.pendingGenerate;
		this.pendingGenerate = null;
		if (this.instance) {
			try {
				// exit() tears down the internal worker and frees WASM memory.
				await this.instance.exit();
			} catch {
				// Instance may already be dead — nothing to free.
			}
		}
		this.instance = null;
		this.abortController = null;
		this.generating = false;
		if (pending) {
			pending.callbacks.onError(new Error("wllama engine disposed"));
		}
	}
}
