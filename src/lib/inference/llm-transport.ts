import type { ChatMessage, LlmWorkerCommand, LlmWorkerResponse } from "./llm-types";

export interface LlmTokenCallback {
	onToken: (token: string) => void;
	onDone: (data: { fullText: string; totalMs: number; tokenCount: number; tokensPerSec: number }) => void;
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
	private progressCallback: ((progress: { status: string; file: string; loaded: number; total: number }) => void) | null = null;
	private tokenCallback: LlmTokenCallback | null = null;
	private callbacks: LlmTransportCallbacks;
	/** Number of "load" commands sent that haven't received "loaded" responses yet. */
	private pendingLoads = 0;

	constructor(callbacks: LlmTransportCallbacks) {
		this.callbacks = callbacks;
	}

	ensureWorker(): Worker {
		if (!this.worker) {
			this.worker = new Worker(
				new URL("./llm-worker.ts", import.meta.url),
			);

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
				this.tokenCallback?.onToken(msg.token);
				break;

			case "done":
				this.callbacks.onStateChange({ isGenerating: false });
				this.tokenCallback?.onDone({
					fullText: msg.fullText,
					totalMs: msg.totalMs,
					tokenCount: msg.tokenCount,
					tokensPerSec: msg.tokensPerSec,
				});
				this.tokenCallback = null;
				break;

			case "cancelled":
				this.callbacks.onStateChange({ isGenerating: false });
				this.tokenCallback = null;
				this.pending?.resolve(undefined);
				this.pending = null;
				break;

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
		worker.postMessage(cmd);
	}

	setTokenCallback(cb: LlmTokenCallback | null): void {
		this.tokenCallback = cb;
	}

	setProgressCallback(cb: ((progress: { status: string; file: string; loaded: number; total: number }) => void) | null): void {
		this.progressCallback = cb;
	}

	terminate(): void {
		this.worker?.terminate();
		this.worker = null;
		this.pending = null;
		this.tokenCallback = null;
		this.progressCallback = null;
	}
}
