"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioQueue } from "@/lib/inference/audio-queue";
import { useInferenceWorker } from "@/lib/inference/use-inference-worker";
import { useLlmWorker } from "@/lib/hooks/use-llm-worker";
import { useVad } from "@/lib/hooks/use-vad";
import type { ChatMessage, LlmModel } from "@/lib/inference/llm-types";
import type { DownloadProgress } from "@/lib/inference/types";
import type { ModelState } from "@/components/model-status";

export type AgentPhase =
	| "idle"
	| "listening"
	| "transcribing"
	| "thinking"
	| "speaking";

export interface ConversationTurn {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: number;
	metrics?: {
		sttMs?: number;
		llmMs?: number;
		llmTokensPerSec?: number;
		ttsMs?: number;
	};
}

export interface AgentMetrics {
	sttMs: number | null;
	llmTokensPerSec: number | null;
	ttsRtf: number | null;
}

interface UseVoiceAgentOptions {
	sttModel: string;
	ttsModel: string;
	ttsVoice: string;
	llmModel: LlmModel;
	useCloudLlm: boolean;
}

export function useVoiceAgent({
	sttModel,
	ttsModel,
	ttsVoice,
	llmModel,
	useCloudLlm,
}: UseVoiceAgentOptions) {
	const [phase, setPhase] = useState<AgentPhase>("idle");
	const [conversation, setConversation] = useState<ConversationTurn[]>([]);
	const [streamingText, setStreamingText] = useState("");
	const [metrics, setMetrics] = useState<AgentMetrics>({
		sttMs: null,
		llmTokensPerSec: null,
		ttsRtf: null,
	});

	// Model states for UI
	const [sttState, setSttState] = useState<ModelState>({ status: "not_loaded" });
	const [llmState, setLlmState] = useState<ModelState>({ status: "not_loaded" });
	const [ttsState, setTtsState] = useState<ModelState>({ status: "not_loaded" });

	const sttWorker = useInferenceWorker();
	const ttsWorker = useInferenceWorker();
	const llm = useLlmWorker();

	const queueRef = useRef<AudioQueue | null>(null);
	const conversationRef = useRef<ChatMessage[]>([]);
	const phaseRef = useRef<AgentPhase>("idle");
	const abortRef = useRef(false);
	// Chain TTS calls sequentially — WorkerTransport has a single pending slot,
	// so concurrent synthesize() calls would overwrite each other and hang.
	const ttsChainRef = useRef<Promise<void>>(Promise.resolve());
	// Track which LLM model is currently loaded in the worker
	const loadedLlmIdRef = useRef<string | null>(null);

	// Keep phaseRef in sync
	useEffect(() => {
		phaseRef.current = phase;
	}, [phase]);

	// --- Model Loading ---

	const loadStt = useCallback(
		async (onProgress?: (p: DownloadProgress) => void) => {
			setSttState({ status: "initializing" });
			try {
				const result = await sttWorker.loadModel(sttModel, {
					backend: "wasm",
					onProgress: (p) => {
						setSttState({
							status: "downloading",
							progress: p.total > 0 ? (p.loaded / p.total) * 100 : 0,
							speed: 0,
							total: p.total,
							downloaded: p.loaded,
						});
						onProgress?.(p);
					},
				});
				setSttState({ status: "ready", backend: result.backend, loadTime: result.loadTime });
				return result;
			} catch (err) {
				setSttState({
					status: "error",
					code: "LOAD_FAILED",
					message: err instanceof Error ? err.message : "Failed to load STT",
					recoverable: true,
				});
				throw err;
			}
		},
		[sttWorker, sttModel],
	);

	const loadLlm = useCallback(
		async (onProgress?: (p: DownloadProgress) => void) => {
			if (useCloudLlm) {
				loadedLlmIdRef.current = "cloud";
				setLlmState({ status: "ready", backend: "wasm", loadTime: 0 });
				return { backend: "wasm" as const, loadTime: 0 };
			}
			setLlmState({ status: "initializing" });
			try {
				const result = await llm.loadModel(llmModel.id, llmModel.hfId, {
					backend: "auto",
					onProgress: (p) => {
						setLlmState({
							status: "downloading",
							progress: p.total > 0 ? (p.loaded / p.total) * 100 : 0,
							speed: 0,
							total: p.total,
							downloaded: p.loaded,
						});
						onProgress?.(p);
					},
				});
				loadedLlmIdRef.current = llmModel.id;
				setLlmState({ status: "ready", backend: result.backend, loadTime: result.loadTime });
				return result;
			} catch (err) {
				setLlmState({
					status: "error",
					code: "LOAD_FAILED",
					message: err instanceof Error ? err.message : "Failed to load LLM",
					recoverable: true,
				});
				throw err;
			}
		},
		[llm, llmModel, useCloudLlm],
	);

	const loadTts = useCallback(
		async (onProgress?: (p: DownloadProgress) => void) => {
			setTtsState({ status: "initializing" });
			try {
				const result = await ttsWorker.loadModel(ttsModel, {
					backend: "auto",
					onProgress: (p) => {
						setTtsState({
							status: "downloading",
							progress: p.total > 0 ? (p.loaded / p.total) * 100 : 0,
							speed: 0,
							total: p.total,
							downloaded: p.loaded,
						});
						onProgress?.(p);
					},
				});
				setTtsState({ status: "ready", backend: result.backend, loadTime: result.loadTime });
				return result;
			} catch (err) {
				setTtsState({
					status: "error",
					code: "LOAD_FAILED",
					message: err instanceof Error ? err.message : "Failed to load TTS",
					recoverable: true,
				});
				throw err;
			}
		},
		[ttsWorker, ttsModel],
	);

	const loadAll = useCallback(async () => {
		await Promise.all([loadStt(), loadLlm(), loadTts()]);
	}, [loadStt, loadLlm, loadTts]);

	// Auto-reload LLM when model selection changes while already loaded
	const targetLlmId = useCloudLlm ? "cloud" : llmModel.id;
	useEffect(() => {
		if (loadedLlmIdRef.current && loadedLlmIdRef.current !== targetLlmId) {
			loadLlm();
		}
	}, [targetLlmId, loadLlm]);

	const allModelsReady =
		sttState.status === "ready" &&
		llmState.status === "ready" &&
		ttsState.status === "ready";

	// --- Pipeline ---

	// TTS speech rate — slightly faster than default for snappier voice agent feel
	const TTS_SPEED = 1.1;

	const enqueueSentence = useCallback(
		(sentence: string) => {
			if (!sentence.trim() || abortRef.current) return;
			// Append to the sequential chain so each synthesize() completes
			// before the next one starts (WorkerTransport single-slot constraint).
			ttsChainRef.current = ttsChainRef.current.then(async () => {
				if (abortRef.current) return;
				try {
					const ttsStart = performance.now();
					const result = await ttsWorker.synthesize(ttsModel, sentence, ttsVoice, undefined, TTS_SPEED);
					const ttsMs = performance.now() - ttsStart;
					const duration = result.audio.length / result.sampleRate;
					const rtf = duration > 0 ? ttsMs / 1000 / duration : null;
					setMetrics((prev) => ({ ...prev, ttsRtf: rtf }));
					if (!abortRef.current) {
						queueRef.current?.enqueue(result.audio, result.sampleRate);
					}
				} catch {
					// TTS error for one sentence — continue with others
				}
			});
		},
		[ttsWorker, ttsModel, ttsVoice],
	);

	// Extract a TTS-ready clause from the buffer. Fires on sentence ends (.!?)
	// and clause boundaries (,;:—) to reduce time-to-first-audio.
	const extractClause = (buffer: string): { clause: string; rest: string } | null => {
		// Sentence-ending punctuation (highest priority)
		const sentenceMatch = buffer.match(/([.!?])\s/);
		if (sentenceMatch) {
			const idx = buffer.indexOf(sentenceMatch[0]) + 1;
			return { clause: buffer.slice(0, idx).trim(), rest: buffer.slice(idx).trim() };
		}
		// Clause-level punctuation — only fire if we have enough words (>=4)
		// to avoid tiny audio fragments
		const clauseMatch = buffer.match(/([,;:\u2014])\s/);
		if (clauseMatch) {
			const idx = buffer.indexOf(clauseMatch[0]) + 1;
			const candidate = buffer.slice(0, idx).trim();
			if (candidate.split(/\s+/).length >= 4) {
				return { clause: candidate, rest: buffer.slice(idx).trim() };
			}
		}
		return null;
	};

	const runCloudLlm = useCallback(
		async (messages: ChatMessage[]) => {
			const response = await fetch("/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ messages }),
			});

			if (!response.ok || !response.body) {
				throw new Error("Cloud LLM request failed");
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let fullText = "";
			let sentenceBuffer = "";

			const llmStart = performance.now();

			while (true) {
				const { done, value } = await reader.read();
				if (done || abortRef.current) break;

				const chunk = decoder.decode(value, { stream: true });
				fullText += chunk;
				sentenceBuffer += chunk;
				setStreamingText(fullText);

				// Extract clauses for early TTS
				let extracted = extractClause(sentenceBuffer);
				while (extracted) {
					if (extracted.clause && phaseRef.current !== "idle") {
						setPhase("speaking");
						enqueueSentence(extracted.clause);
					}
					sentenceBuffer = extracted.rest;
					extracted = extractClause(sentenceBuffer);
				}
			}

			// Flush remaining buffer
			if (sentenceBuffer.trim() && !abortRef.current) {
				setPhase("speaking");
				enqueueSentence(sentenceBuffer.trim());
			}

			const llmMs = performance.now() - llmStart;
			setMetrics((prev) => ({ ...prev, llmTokensPerSec: null }));

			// Wait for all queued TTS to complete
			await ttsChainRef.current;
			return { fullText, llmMs };
		},
		[enqueueSentence],
	);

	const runLocalLlm = useCallback(
		(messages: ChatMessage[]): Promise<{ fullText: string; llmMs: number; tokensPerSec: number }> => {
			return new Promise((resolve, reject) => {
				let sentenceBuffer = "";
				let fullText = "";

				llm.generate(messages, {
					onToken: (token) => {
						if (abortRef.current) return;
						fullText += token;
						sentenceBuffer += token;
						setStreamingText(fullText);

						// Extract clauses for early TTS
						let extracted = extractClause(sentenceBuffer);
						while (extracted) {
							if (extracted.clause && phaseRef.current !== "idle") {
								setPhase("speaking");
								enqueueSentence(extracted.clause);
							}
							sentenceBuffer = extracted.rest;
							extracted = extractClause(sentenceBuffer);
						}
					},
					onDone: async (data) => {
						// Flush remaining buffer
						if (sentenceBuffer.trim() && !abortRef.current) {
							setPhase("speaking");
							enqueueSentence(sentenceBuffer.trim());
						}
						setMetrics((prev) => ({
							...prev,
							llmTokensPerSec: data.tokensPerSec,
						}));
						// Wait for all queued TTS to complete
						await ttsChainRef.current;
						resolve({
							fullText: data.fullText,
							llmMs: data.totalMs,
							tokensPerSec: data.tokensPerSec,
						});
					},
					onError: reject,
				});
			});
		},
		[llm, enqueueSentence],
	);

	const processSpeech = useCallback(
		async (audio: Float32Array) => {
			if (phaseRef.current === "idle" || abortRef.current) return;

			// 1. STT
			setPhase("transcribing");
			const sttStart = performance.now();
			let transcript: string;
			try {
				const result = await sttWorker.transcribe(sttModel, audio, 16000);
				transcript = result.text.trim();
			} catch (err) {
				setPhase("listening");
				return;
			}
			const sttMs = Math.round(performance.now() - sttStart);
			setMetrics((prev) => ({ ...prev, sttMs }));

			if (!transcript || abortRef.current) {
				setPhase("listening");
				return;
			}

			// Add user turn
			const userTurn: ConversationTurn = {
				id: crypto.randomUUID(),
				role: "user",
				content: transcript,
				timestamp: Date.now(),
				metrics: { sttMs },
			};
			setConversation((prev) => [...prev, userTurn]);
			conversationRef.current.push({ role: "user", content: transcript });

			// 2. LLM
			setPhase("thinking");
			setStreamingText("");

			// Create AudioQueue for this response
			const queue = new AudioQueue();
			queueRef.current = queue;

			let fullText: string;
			let llmMs: number;
			let tokensPerSec: number | null = null;

			try {
				if (useCloudLlm) {
					const result = await runCloudLlm(conversationRef.current);
					fullText = result.fullText;
					llmMs = result.llmMs;
				} else {
					const result = await runLocalLlm(conversationRef.current);
					fullText = result.fullText;
					llmMs = result.llmMs;
					tokensPerSec = result.tokensPerSec;
				}
			} catch (err) {
				queueRef.current?.stop();
				queueRef.current = null;
				setPhase("listening");
				return;
			}

			if (abortRef.current) {
				queue.stop();
				queueRef.current = null;
				return;
			}

			// Add assistant turn
			const assistantTurn: ConversationTurn = {
				id: crypto.randomUUID(),
				role: "assistant",
				content: fullText,
				timestamp: Date.now(),
				metrics: { sttMs, llmMs, llmTokensPerSec: tokensPerSec ?? undefined },
			};
			setConversation((prev) => [...prev, assistantTurn]);
			conversationRef.current.push({ role: "assistant", content: fullText });
			setStreamingText("");

			// 3. Wait for audio playback to finish
			await new Promise<void>((resolve) => {
				if (!queue.isPlaying) {
					resolve();
					return;
				}
				queue.onAllEnded = resolve;
				// Safety timeout
				setTimeout(resolve, 30000);
			});

			queue.stop();
			queueRef.current = null;

			// Return to listening if still active
			if ((phaseRef.current as AgentPhase) !== "idle" && !abortRef.current) {
				setPhase("listening");
			}
		},
		[sttWorker, sttModel, useCloudLlm, runCloudLlm, runLocalLlm],
	);

	// --- VAD ---

	const vad = useVad({
		onSpeechStart: () => {
			// Interrupt if currently speaking
			if (phaseRef.current === "speaking") {
				abortRef.current = true;
				queueRef.current?.stop();
				queueRef.current = null;
				llm.cancel();
				abortRef.current = false;
			}
		},
		onSpeechEnd: (audio) => {
			if (phaseRef.current === "listening" || phaseRef.current === "speaking") {
				processSpeech(audio);
			}
		},
	});

	// --- Controls ---

	const startConversation = useCallback(async () => {
		if (!allModelsReady) return;
		abortRef.current = false;
		setPhase("listening");
		await vad.start();
	}, [allModelsReady, vad]);

	const stopConversation = useCallback(() => {
		abortRef.current = true;
		vad.stop();
		llm.cancel();
		queueRef.current?.stop();
		queueRef.current = null;
		ttsChainRef.current = Promise.resolve();
		setPhase("idle");
		setStreamingText("");
	}, [vad, llm]);

	const clearConversation = useCallback(() => {
		setConversation([]);
		conversationRef.current = [];
	}, []);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			abortRef.current = true;
			queueRef.current?.stop();
		};
	}, []);

	return {
		// State
		phase,
		conversation,
		streamingText,
		metrics,
		allModelsReady,

		// Model states
		sttState,
		llmState,
		ttsState,

		// Model loading
		loadStt,
		loadLlm,
		loadTts,
		loadAll,

		// Controls
		startConversation,
		stopConversation,
		clearConversation,

		// VAD state
		isListening: vad.isListening,
		isSpeechActive: vad.isSpeechActive,

		// Audio for visualizer
		audioQueue: queueRef.current,
	};
}
