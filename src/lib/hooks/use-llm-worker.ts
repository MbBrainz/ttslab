"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	type LlmLoadedResult,
	type LlmTokenCallback,
	LlmTransport,
} from "@/lib/inference/llm-transport";
import type { ChatMessage, LlmModel } from "@/lib/inference/llm-types";
import type { DownloadProgress } from "@/lib/inference/types";
import {
	type LlmGenerateCallbacks,
	WebLlmTransport,
} from "@/lib/inference/webllm-transport";
import { WllamaTransport } from "@/lib/inference/wllama-transport";

export type { LlmLoadedResult };

interface EngineTransports {
	transformersjs: LlmTransport | null;
	webllm: WebLlmTransport | null;
	wllama: WllamaTransport | null;
}

export function useLlmWorker() {
	const transportsRef = useRef<EngineTransports>({
		transformersjs: null,
		webllm: null,
		wllama: null,
	});
	/** Engine currently loaded — generate/cancel/dispose route here. */
	const activeEngineRef = useRef<LlmModel["engine"] | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isGenerating, setIsGenerating] = useState(false);

	const getTransformersTransport = useCallback(() => {
		if (!transportsRef.current.transformersjs) {
			transportsRef.current.transformersjs = new LlmTransport({
				onStateChange: (update) => {
					if (update.isLoading !== undefined) setIsLoading(update.isLoading);
					if (update.isGenerating !== undefined)
						setIsGenerating(update.isGenerating);
				},
			});
			transportsRef.current.transformersjs.ensureWorker();
		}
		return transportsRef.current.transformersjs;
	}, []);

	const getWebllmTransport = useCallback(() => {
		if (!transportsRef.current.webllm) {
			transportsRef.current.webllm = new WebLlmTransport();
		}
		return transportsRef.current.webllm;
	}, []);

	const getWllamaTransport = useCallback(() => {
		if (!transportsRef.current.wllama) {
			transportsRef.current.wllama = new WllamaTransport();
		}
		return transportsRef.current.wllama;
	}, []);

	/** Tear a transport down: engine transports via dispose(), the
	 *  transformers.js one via terminate() (it owns a raw Worker). */
	const disposeTransport = useCallback(
		(
			transport: LlmTransport | WebLlmTransport | WllamaTransport,
		): Promise<void> => {
			if (
				transport instanceof WebLlmTransport ||
				transport instanceof WllamaTransport
			) {
				return transport.dispose();
			}
			transport.terminate();
			return Promise.resolve();
		},
		[],
	);

	const loadModel = useCallback(
		async (
			model: LlmModel,
			options: {
				backend?: "webgpu" | "wasm" | "auto";
				onProgress?: (progress: DownloadProgress) => void;
			} = {},
		): Promise<LlmLoadedResult> => {
			setIsLoading(true);

			// Switching engines: tear the previous one down fully — each tier
			// holds a worker (and GPU/WASM memory) that the others cannot reuse.
			if (activeEngineRef.current && activeEngineRef.current !== model.engine) {
				const prev = transportsRef.current[activeEngineRef.current];
				if (prev) await disposeTransport(prev);
			}
			activeEngineRef.current = model.engine;

			if (model.engine === "transformersjs") {
				const transport = getTransformersTransport();
				const onProgress = options.onProgress;
				transport.setProgressCallback(
					onProgress
						? (p) =>
								onProgress({
									status: p.status === "downloading" ? "downloading" : "ready",
									file: p.file,
									loaded: p.loaded,
									total: p.total,
								})
						: null,
				);
				try {
					if (!model.hfId) throw new Error(`Model ${model.id} is missing hfId`);
					return await transport.sendCommand<LlmLoadedResult>({
						type: "load",
						modelId: model.id,
						hfId: model.hfId,
						backend: options.backend ?? "auto",
					});
				} catch (err) {
					setIsLoading(false);
					throw err;
				} finally {
					transport.setProgressCallback(null);
				}
			}

			// WebLLM and wllama share the load(model, onProgress) surface.
			const transport =
				model.engine === "webllm" ? getWebllmTransport() : getWllamaTransport();
			try {
				return await transport.load(model, options.onProgress);
			} catch (err) {
				setIsLoading(false);
				throw err;
			}
		},
		[
			getTransformersTransport,
			getWebllmTransport,
			getWllamaTransport,
			disposeTransport,
		],
	);

	const generate = useCallback(
		(
			messages: ChatMessage[],
			callbacks: LlmTokenCallback,
			options?: {
				maxNewTokens?: number;
				temperature?: number;
				/** Advertised context window — drives the transformers.js input pin
				 * (llm-history.ts). webllm/wllama pin context at load time instead. */
				contextTokens?: number;
			},
		): void => {
			const engine = activeEngineRef.current;
			if (!engine) {
				callbacks.onError(new Error("LLM not loaded"));
				return;
			}
			setIsGenerating(true);
			if (engine === "transformersjs") {
				const transport = getTransformersTransport();
				transport.setTokenCallback(callbacks);
				transport.postCommand({
					type: "generate",
					messages,
					maxNewTokens: options?.maxNewTokens ?? 256,
					temperature: options?.temperature ?? 0.7,
					contextTokens: options?.contextTokens,
				});
				return;
			}
			const transport =
				engine === "webllm" ? getWebllmTransport() : getWllamaTransport();
			const wrapped: LlmGenerateCallbacks = {
				onToken: callbacks.onToken,
				onDone: (data) => {
					setIsGenerating(false);
					callbacks.onDone(data);
				},
				onError: (error) => {
					setIsGenerating(false);
					callbacks.onError(error);
				},
			};
			transport.generate(messages, wrapped, options);
		},
		[getTransformersTransport, getWebllmTransport, getWllamaTransport],
	);

	const cancel = useCallback((): void => {
		const engine = activeEngineRef.current;
		if (engine === "transformersjs") {
			// The worker handles cancel out of band (before its command queue), so
			// this reaches the running generation immediately instead of parking
			// behind it. isGenerating clears here for instant UI feedback while
			// the worker unwinds; the genId match in LlmTransport keeps a stale
			// "cancelled" response from disturbing a re-generation that starts
			// before the unwind finishes.
			getTransformersTransport().postCommand({ type: "cancel" });
			return;
		}
		if (engine === "webllm") getWebllmTransport().cancel();
		if (engine === "wllama") getWllamaTransport().cancel();
		// webllm/wllama treat abort as silent return (same observable behavior
		// as the transformers "cancelled" path) — clear the flag here. A
		// generate() issued while their abort is still unwinding is queued by
		// the transport and runs once it settles.
		setIsGenerating(false);
	}, [getTransformersTransport, getWebllmTransport, getWllamaTransport]);

	const dispose = useCallback(async (): Promise<void> => {
		const engine = activeEngineRef.current;
		if (engine === "transformersjs") {
			await getTransformersTransport().sendCommand<void>({ type: "dispose" });
			return;
		}
		if (engine === "webllm") await getWebllmTransport().dispose();
		if (engine === "wllama") await getWllamaTransport().dispose();
	}, [getTransformersTransport, getWebllmTransport, getWllamaTransport]);

	useEffect(() => {
		getTransformersTransport();
		return () => {
			// Only the transformers.js path owns a raw Worker that needs
			// terminate(); webllm/wllama tear down via their own dispose().
			transportsRef.current.transformersjs?.terminate();
			void transportsRef.current.webllm?.dispose();
			void transportsRef.current.wllama?.dispose();
			transportsRef.current = {
				transformersjs: null,
				webllm: null,
				wllama: null,
			};
			activeEngineRef.current = null;
		};
	}, [getTransformersTransport]);

	return { loadModel, generate, cancel, dispose, isLoading, isGenerating };
}
