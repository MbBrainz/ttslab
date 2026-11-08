import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

/**
 * Dedicated Web Worker hosting the WebLLM MLCEngine.
 *
 * GPUAdapter/GPUDevice are not transferable via postMessage, so WebGPU must
 * be initialized inside this worker — the main thread only ever talks to it
 * through WebWorkerMLCEngine (CreateWebWorkerMLCEngine on the client side),
 * which relays chat.completions traffic here.
 */
const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (e: MessageEvent) => {
	handler.onmessage(e);
};
