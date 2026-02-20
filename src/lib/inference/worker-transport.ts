import type {
	AudioResult,
	DownloadProgress,
	TranscribeResult,
	Voice,
	WorkerCommand,
	WorkerResponse,
} from "./types";

export interface StreamCallbacks {
	onChunk: (data: {
		audio: Float32Array;
		sampleRate: number;
		chunkIndex: number;
		totalChunks: number;
		sentenceText: string;
	}) => void;
	onEnd: (data: {
		totalMs: number;
		sampleRate: number;
		totalChunks: number;
	}) => void;
	onError: (error: Error) => void;
}

export interface LoadedResult {
	backend: "webgpu" | "wasm";
	loadTime: number;
	voices: Voice[];
}

export interface StateUpdate {
	isLoading?: boolean;
	isGenerating?: boolean;
	isStreaming?: boolean;
}

export interface TransportCallbacks {
	onStateChange: (update: StateUpdate) => void;
}

export class WorkerTransport {
	private worker: Worker | null = null;
	private pending: {
		// biome-ignore lint/suspicious/noExplicitAny: promise resolves with different types per command
		resolve: (value: any) => void;
		reject: (error: Error) => void;
	} | null = null;
	private progressCallback: ((progress: DownloadProgress) => void) | null =
		null;
	private streamCallbacks: StreamCallbacks | null = null;
	private callbacks: TransportCallbacks;

	constructor(callbacks: TransportCallbacks) {
		this.callbacks = callbacks;
	}

	ensureWorker(): Worker {
		if (!this.worker) {
			this.worker = new Worker(
				new URL("./inference-worker.ts", import.meta.url),
			);

			this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
				this.handleMessage(e.data);
			};

			this.worker.onerror = (e) => {
				this.handleError(new Error(e.message || "Worker error"));
			};
		}
		return this.worker;
	}

	private handleMessage(msg: WorkerResponse): void {
		switch (msg.type) {
			case "progress":
				this.progressCallback?.(msg.data);
				break;

			case "loaded": {
				this.callbacks.onStateChange({ isLoading: false });
				const result: LoadedResult = {
					backend: msg.backend,
					loadTime: msg.loadTime,
					voices: msg.voices,
				};
				this.pending?.resolve(result);
				this.pending = null;
				break;
			}

			case "audio":
				this.callbacks.onStateChange({ isGenerating: false });
				this.pending?.resolve(msg.data);
				this.pending = null;
				break;

			case "transcript":
				this.callbacks.onStateChange({ isGenerating: false });
				this.pending?.resolve(msg.data);
				this.pending = null;
				break;

			case "embedding":
				this.callbacks.onStateChange({ isGenerating: false });
				this.pending?.resolve(msg.url);
				this.pending = null;
				break;

			case "disposed":
				this.pending?.resolve(undefined);
				this.pending = null;
				break;

			case "audio-chunk":
				this.streamCallbacks?.onChunk(msg.data);
				break;

			case "stream-end":
				this.callbacks.onStateChange({ isStreaming: false });
				this.streamCallbacks?.onEnd(msg.data);
				this.streamCallbacks = null;
				break;

			case "stream-cancelled":
				this.callbacks.onStateChange({ isStreaming: false });
				this.streamCallbacks = null;
				break;

			case "error":
				this.callbacks.onStateChange({
					isLoading: false,
					isGenerating: false,
				});
				if (this.streamCallbacks) {
					this.callbacks.onStateChange({ isStreaming: false });
					this.streamCallbacks.onError(new Error(msg.message));
					this.streamCallbacks = null;
				}
				this.pending?.reject(new Error(msg.message));
				this.pending = null;
				break;
		}
	}

	private handleError(error: Error): void {
		this.callbacks.onStateChange({
			isLoading: false,
			isGenerating: false,
			isStreaming: false,
		});
		if (this.streamCallbacks) {
			this.streamCallbacks.onError(error);
			this.streamCallbacks = null;
		}
		this.pending?.reject(error);
		this.pending = null;
	}

	sendCommand<T>(cmd: WorkerCommand, transfer?: Transferable[]): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.pending = { resolve, reject };
			const worker = this.ensureWorker();
			worker.postMessage(cmd, { transfer: transfer ?? [] });
		});
	}

	postCommand(cmd: WorkerCommand): void {
		const worker = this.ensureWorker();
		worker.postMessage(cmd);
	}

	setStreamCallbacks(cbs: StreamCallbacks | null): void {
		this.streamCallbacks = cbs;
	}

	setProgressCallback(
		cb: ((progress: DownloadProgress) => void) | null,
	): void {
		this.progressCallback = cb;
	}

	terminate(): void {
		this.worker?.terminate();
		this.worker = null;
		this.pending = null;
		this.streamCallbacks = null;
		this.progressCallback = null;
	}
}
