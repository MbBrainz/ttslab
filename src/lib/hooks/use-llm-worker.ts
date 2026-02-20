"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/inference/llm-types";
import type { DownloadProgress } from "@/lib/inference/types";
import { LlmTransport, type LlmLoadedResult, type LlmTokenCallback } from "@/lib/inference/llm-transport";

export type { LlmLoadedResult };

export function useLlmWorker() {
	const transportRef = useRef<LlmTransport | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isGenerating, setIsGenerating] = useState(false);

	const getTransport = useCallback(() => {
		if (!transportRef.current) {
			transportRef.current = new LlmTransport({
				onStateChange: (update) => {
					if (update.isLoading !== undefined) setIsLoading(update.isLoading);
					if (update.isGenerating !== undefined) setIsGenerating(update.isGenerating);
				},
			});
			transportRef.current.ensureWorker();
		}
		return transportRef.current;
	}, []);

	const loadModel = useCallback(
		async (
			modelId: string,
			hfId: string,
			options: {
				backend: "webgpu" | "wasm" | "auto";
				onProgress?: (progress: DownloadProgress) => void;
			},
		): Promise<LlmLoadedResult> => {
			setIsLoading(true);
			const transport = getTransport();
			transport.setProgressCallback(
				options.onProgress
					? (p) => options.onProgress!({
						status: p.status === "downloading" ? "downloading" : "ready",
						file: p.file,
						loaded: p.loaded,
						total: p.total,
					})
					: null,
			);

			try {
				const result = await transport.sendCommand<LlmLoadedResult>({
					type: "load",
					modelId,
					hfId,
					backend: options.backend,
				});
				return result;
			} catch (err) {
				setIsLoading(false);
				throw err;
			} finally {
				transport.setProgressCallback(null);
			}
		},
		[getTransport],
	);

	const generate = useCallback(
		(
			messages: ChatMessage[],
			callbacks: LlmTokenCallback,
			options?: { maxNewTokens?: number; temperature?: number },
		): void => {
			setIsGenerating(true);
			const transport = getTransport();
			transport.setTokenCallback(callbacks);
			transport.postCommand({
				type: "generate",
				messages,
				maxNewTokens: options?.maxNewTokens ?? 256,
				temperature: options?.temperature ?? 0.7,
			});
		},
		[getTransport],
	);

	const cancel = useCallback((): void => {
		getTransport().postCommand({ type: "cancel" });
	}, [getTransport]);

	const dispose = useCallback(async (): Promise<void> => {
		await getTransport().sendCommand<void>({ type: "dispose" });
	}, [getTransport]);

	useEffect(() => {
		getTransport();
		return () => {
			transportRef.current?.terminate();
			transportRef.current = null;
		};
	}, [getTransport]);

	return { loadModel, generate, cancel, dispose, isLoading, isGenerating };
}
