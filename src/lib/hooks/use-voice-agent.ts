"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioQueue } from "@/lib/inference/audio-queue";
import { useInferenceWorker } from "@/lib/inference/use-inference-worker";
import { useLlmWorker } from "@/lib/hooks/use-llm-worker";
import { useVad } from "@/lib/hooks/use-vad";
import type { ChatMessage, LlmModel } from "@/lib/inference/llm-types";
import { createDownloadTracker } from "@/lib/inference/download-tracker";
import type { DownloadProgress } from "@/lib/inference/types";
import type { ModelState } from "@/components/model-status";

/** Strip emoji characters so TTS doesn't attempt to speak them. */
function stripEmojis(text: string): string {
	return text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/  +/g, " ");
}

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
	interrupted?: boolean;
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
}

export function useVoiceAgent({
	sttModel,
	ttsModel,
	ttsVoice,
	llmModel,
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
	const { loadModel: llmLoad, generate: llmGenerate, cancel: llmCancel } = useLlmWorker();

	const queueRef = useRef<AudioQueue | null>(null);
	const conversationRef = useRef<ChatMessage[]>([]);
	const phaseRef = useRef<AgentPhase>("idle");
	const abortRef = useRef(false);
	// Chain TTS calls sequentially — WorkerTransport has a single pending slot,
	// so concurrent synthesize() calls would overwrite each other and hang.
	const ttsChainRef = useRef<Promise<void>>(Promise.resolve());
	// Track which LLM model is currently loaded in the worker
	const loadedLlmIdRef = useRef<string | null>(null);

	// Barge-in: track enqueued sentences and how many finished playing
	const enqueuedSentencesRef = useRef<string[]>([]);
	const playedSentenceCountRef = useRef(0);
	// Generation counter — incremented on each new pipeline run and on interrupt
	const generationRef = useRef(0);

	// Keep phaseRef in sync
	useEffect(() => {
		phaseRef.current = phase;
	}, [phase]);

	// --- Model Loading ---

	const loadStt = useCallback(
		async (onProgress?: (p: DownloadProgress) => void) => {
			setSttState({ status: "initializing" });
			const tracker = createDownloadTracker();
			try {
				const result = await sttWorker.loadModel(sttModel, {
					backend: "wasm",
					onProgress: (p) => {
						const state = tracker.process(p);
						if (state) setSttState(state);
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
			setLlmState({ status: "initializing" });
			const tracker = createDownloadTracker();
			try {
				const result = await llmLoad(llmModel.id, llmModel.hfId, {
					backend: "auto",
					onProgress: (p) => {
						const state = tracker.process(p);
						if (state) setLlmState(state);
						onProgress?.(p);
					},
				});
				loadedLlmIdRef.current = llmModel.id;
				setLlmState({ status: "ready", backend: result.backend, loadTime: result.loadTime });
				return result;
			} catch (err) {
				// Ignore cancellation from model-switch (transport rejects the old command)
				if (err instanceof Error && err.message === "Cancelled by new command") return;
				setLlmState({
					status: "error",
					code: "LOAD_FAILED",
					message: err instanceof Error ? err.message : "Failed to load LLM",
					recoverable: true,
				});
				throw err;
			}
		},
		[llmLoad, llmModel],
	);

	const loadTts = useCallback(
		async (onProgress?: (p: DownloadProgress) => void) => {
			setTtsState({ status: "initializing" });
			const tracker = createDownloadTracker();
			try {
				const result = await ttsWorker.loadModel(ttsModel, {
					backend: "auto",
					onProgress: (p) => {
						const state = tracker.process(p);
						if (state) setTtsState(state);
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
	useEffect(() => {
		if (loadedLlmIdRef.current && loadedLlmIdRef.current !== llmModel.id) {
			loadLlm().catch(() => {});
		}
	}, [llmModel.id, loadLlm]);

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
			enqueuedSentencesRef.current.push(sentence);
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
						queueRef.current?.enqueue(result.audio, result.sampleRate, () => {
							playedSentenceCountRef.current++;
						});
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

	const runLocalLlm = useCallback(
		(messages: ChatMessage[]): Promise<{ fullText: string; llmMs: number; tokensPerSec: number }> => {
			return new Promise((resolve, reject) => {
				let sentenceBuffer = "";
				let fullText = "";

				llmGenerate(messages, {
					onToken: (rawToken) => {
						if (abortRef.current) return;
						const token = stripEmojis(rawToken);
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
		[llmGenerate, enqueueSentence],
	);

	const processSpeech = useCallback(
		async (audio: Float32Array) => {
			if (phaseRef.current === "idle" || abortRef.current) return;

			// Capture generation and reset sentence tracking for this run
			const myGeneration = ++generationRef.current;
			enqueuedSentencesRef.current = [];
			playedSentenceCountRef.current = 0;

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
				const result = await runLocalLlm(conversationRef.current);
				fullText = result.fullText;
				llmMs = result.llmMs;
				tokensPerSec = result.tokensPerSec;
			} catch (err) {
				queueRef.current?.stop();
				queueRef.current = null;
				setPhase("listening");
				return;
			}

			// If interrupted, the onSpeechStart handler already added the
			// truncated assistant turn — bail out to avoid a duplicate.
			if (myGeneration !== generationRef.current) {
				setStreamingText("");
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
		[sttWorker, sttModel, runLocalLlm],
	);

	// --- VAD ---

	const vad = useVad({
		onSpeechStart: () => {
			// Interrupt if currently speaking or thinking
			if (phaseRef.current === "speaking" || phaseRef.current === "thinking") {
				// Compute what was actually spoken before interruption
				const sentences = enqueuedSentencesRef.current;
				const played = playedSentenceCountRef.current;
				// Include the currently-playing sentence (at index = played)
				const spokenUpTo = Math.min(played + 1, sentences.length);
				const spokenText = sentences.slice(0, spokenUpTo).join(" ");

				// Invalidate the current generation so processSpeech won't add a duplicate turn
				generationRef.current++;

				// Add truncated assistant turn to context (if any text was spoken)
				if (spokenText) {
					conversationRef.current.push({ role: "assistant", content: spokenText });
					setConversation(prev => [...prev, {
						id: crypto.randomUUID(),
						role: "assistant" as const,
						content: spokenText,
						timestamp: Date.now(),
						interrupted: true,
					}]);
				}

				// Stop everything
				abortRef.current = true;
				queueRef.current?.stop();
				queueRef.current = null;
				llmCancel();
				ttsChainRef.current = Promise.resolve();
				abortRef.current = false;

				// Reset tracking and transition to listening
				enqueuedSentencesRef.current = [];
				playedSentenceCountRef.current = 0;
				setStreamingText("");
				setPhase("listening");
				phaseRef.current = "listening";
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
		llmCancel();
		queueRef.current?.stop();
		queueRef.current = null;
		ttsChainRef.current = Promise.resolve();
		setPhase("idle");
		setStreamingText("");
	}, [vad, llmCancel]);

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
