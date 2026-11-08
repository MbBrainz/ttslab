import type { LlmWorkerCommand, LlmWorkerResponse } from "./llm-types";

export interface LlmTokenCallback {
	onToken: (token: string) => void;
	onDone: (data: {
		fullText: string;
		totalMs: number;
		tokenCount: number;
		tokensPerSec: number;
	}) => void;
	onError: (error: Error) => void;
}

export interface LlmLoadedResult {
	backend: "webgpu" | "wasm";
	loadTime: number;
}

export interface LlmStateUpdate {
	isLoading?: boolean;
	isGenerating?: boolean;
}

export interface LlmTransportCallbacks {
	onStateChange: (update: LlmStateUpdate) => void;
}

export class LlmTransport {
	private worker: Worker | null = null;
	private pending: {
		// biome-ignore lint/suspicious/noExplicitAny: promise resolves with different types per command
		resolve: (value: any) => void;
		reject: (error: Error) => void;
	} | null = null;
	private progressCallback:
		| ((progress: {
				status: string;
				file: string;
				loaded: number;
				total: number;
		  }) => void)
		| null = null;
	private tokenCallback: LlmTokenCallback | null = null;
	private callbacks: LlmTransportCallbacks;
	/** Number of "load" commands sent that haven't received "loaded" responses yet. */
	private pendingLoads = 0;
	/**
	 * Generation ids: the transport assigns one per generate command and the
	 * worker echoes it on token/done/cancelled responses. Without it, a stale
	 * "cancelled" response from a just-cancelled generation would arrive after
	 * a fresh generate was posted (cancel clears isGenerating immediately so
	 * re-generation can start before the worker finished unwinding) and wipe
	 * the new generation's token callback mid-stream.
	 */
	private nextGenId = 0;
	private activeGenId: number | null = null;

	constructor(callbacks: LlmTransportCallbacks) {
		this.callbacks = callbacks;
	}

	ensureWorker(): Worker {
		if (!this.worker) {
			this.worker = new Worker(new URL("./llm-worker.ts", import.meta.url));

			this.worker.onmessage = (e: MessageEvent<LlmWorkerResponse>) => {
				this.handleMessage(e.data);
			};

			this.worker.onerror = (e) => {
				this.handleError(new Error(e.message || "LLM Worker error"));
			};
		}
		return this.worker;
	}

	private handleMessage(msg: LlmWorkerResponse): void {
		switch (msg.type) {
			case "progress":
				// Skip progress from superseded load commands
				if (this.pendingLoads <= 1) this.progressCallback?.(msg.data);
				break;

			case "loaded": {
				this.pendingLoads = Math.max(0, this.pendingLoads - 1);
				// Skip stale "loaded" from superseded load — only resolve for the latest
				if (this.pendingLoads > 0) break;
				this.callbacks.onStateChange({ isLoading: false });
				const result: LlmLoadedResult = {
					backend: msg.backend,
					loadTime: msg.loadTime,
				};
				this.pending?.resolve(result);
				this.pending = null;
				break;
			}

			case "token":
				if (this.isStaleGeneration(msg.genId)) break;
				this.tokenCallback?.onToken(msg.token);
				break;

			case "done": {
				if (this.isStaleGeneration(msg.genId)) break;
				this.activeGenId = null;
				this.callbacks.onStateChange({ isGenerating: false });
				this.tokenCallback?.onDone({
					fullText: msg.fullText,
					totalMs: msg.totalMs,
					tokenCount: msg.tokenCount,
					tokensPerSec: msg.tokensPerSec,
				});
				this.tokenCallback = null;
				break;
			}

			case "cancelled": {
				if (this.isStaleGeneration(msg.genId)) break;
				this.activeGenId = null;
				this.callbacks.onStateChange({ isGenerating: false });
				this.tokenCallback = null;
				this.pending?.resolve(undefined);
				this.pending = null;
				break;
			}

			case "disposed":
				this.pending?.resolve(undefined);
				this.pending = null;
				break;

			case "error": {
				// If multiple loads are queued, a stale error should not reject the current pending
				if (this.pendingLoads > 1) {
					this.pendingLoads--;
					break;
				}
				if (this.pendingLoads === 1) this.pendingLoads = 0;
				this.callbacks.onStateChange({ isLoading: false, isGenerating: false });
				if (this.tokenCallback) {
					this.tokenCallback.onError(new Error(msg.message));
					this.tokenCallback = null;
				}
				this.pending?.reject(new Error(msg.message));
				this.pending = null;
				break;
			}
		}
	}

	private handleError(error: Error): void {
		this.callbacks.onStateChange({ isLoading: false, isGenerating: false });
		if (this.tokenCallback) {
			this.tokenCallback.onError(error);
			this.tokenCallback = null;
		}
		this.pending?.reject(error);
		this.pending = null;
	}

	/** True when a response belongs to a generation that has already been
	 *  superseded by a newer generate command. Responses without a genId
	 *  (defensive: the worker always sends one on generate responses) are
	 *  treated as current. */
	private isStaleGeneration(genId?: number): boolean {
		return (
			genId !== undefined &&
			this.activeGenId !== null &&
			genId !== this.activeGenId
		);
	}

	sendCommand<T>(cmd: LlmWorkerCommand): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			// Reject any in-flight command before overwriting
			this.pending?.reject(new Error("Cancelled by new command"));
			if (cmd.type === "load") this.pendingLoads++;
			this.pending = { resolve, reject };
			const worker = this.ensureWorker();
			worker.postMessage(cmd);
		});
	}

	postCommand(cmd: LlmWorkerCommand): void {
		const worker = this.ensureWorker();
		if (cmd.type === "generate") {
			// Assign the generation id here so responses can be matched to the
			// current generation (see isStaleGeneration).
			const genId = this.nextGenId++;
			this.activeGenId = genId;
			worker.postMessage({ ...cmd, genId });
			return;
		}
		worker.postMessage(cmd);
	}

	setTokenCallback(cb: LlmTokenCallback | null): void {
		this.tokenCallback = cb;
	}

	setProgressCallback(
		cb:
			| ((progress: {
					status: string;
					file: string;
					loaded: number;
					total: number;
			  }) => void)
			| null,
	): void {
		this.progressCallback = cb;
	}

	terminate(): void {
		this.worker?.terminate();
		this.worker = null;
		this.pending = null;
		this.tokenCallback = null;
		this.progressCallback = null;
		this.activeGenId = null;
	}
}
