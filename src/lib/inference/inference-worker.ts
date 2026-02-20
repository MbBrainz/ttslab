import { selectBackend } from "./backend-select";
import { getLoader } from "./registry";
import { splitIntoSentences } from "./streaming";
import type {
	ModelLoader,
	ModelSession,
	WorkerCommand,
	WorkerResponse,
} from "./types";

const loaders = new Map<string, ModelLoader>();
const sessions = new Map<string, ModelSession>();
let streamCancelled = false;

self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
	const cmd = e.data;

	try {
		switch (cmd.type) {
			case "load": {
				const loader = await getLoader(cmd.modelSlug);
				if (!loader) {
					post({
						type: "error",
						code: "LOADER_NOT_FOUND",
						message: `No loader registered for ${cmd.modelSlug}`,
					});
					return;
				}

				loaders.set(cmd.modelSlug, loader);

				// Resolve backend in the worker (WebGPU is available in workers)
				const supported = loader.getSupportedBackends?.() ?? ["wasm"];
				const preferred = loader.getPreferredBackend?.() ?? "auto";
				const effectivePreference = cmd.options.backend === "auto" ? preferred : cmd.options.backend;
				const backend = await selectBackend(
					supported.includes("webgpu"),
					supported.includes("wasm"),
					effectivePreference,
				);

				const loadStart = performance.now();

				const session = await loader.load({
					...cmd.options,
					backend,
					onProgress: (progress) => {
						post({ type: "progress", data: progress });
					},
				});

				sessions.set(cmd.modelSlug, session);

				const voices = loader.getVoices?.() ?? [];

				// Warm up WASM JIT with a silent dummy inference so the first
				// real generation doesn't pay the cold-start penalty (~200-500ms)
				if (loader.synthesize) {
					const warmupVoice = voices[0]?.id ?? "default";
					try {
						await loader.synthesize("warmup", warmupVoice);
					} catch {
						// non-critical — model still works, just first call may be slower
					}
				}

				const loadTime = Math.round(performance.now() - loadStart);

				post({ type: "loaded", backend, loadTime, voices });
				break;
			}

			case "synthesize": {
				const loader = loaders.get(cmd.modelSlug);
				if (!loader?.synthesize) {
					post({
						type: "error",
						code: "NOT_LOADED",
						message: "Model not loaded or does not support synthesis",
					});
					return;
				}

				// Forward speaker embedding URL to SpeechT5 loader
				if (cmd.speakerEmbeddingUrl != null && "setSpeakerEmbedding" in loader) {
					(loader as { setSpeakerEmbedding: (url: string | null) => void }).setSpeakerEmbedding(cmd.speakerEmbeddingUrl);
				}

				const result = await loader.synthesize(cmd.text, cmd.voice, { speed: cmd.speed });
				post({ type: "audio", data: result }, [result.audio.buffer]);
				break;
			}

			case "transcribe": {
				const loader = loaders.get(cmd.modelSlug);
				if (!loader?.transcribe) {
					post({
						type: "error",
						code: "NOT_LOADED",
						message: "Model not loaded or does not support transcription",
					});
					return;
				}

				const result = await loader.transcribe(cmd.audio, cmd.sampleRate);
				post({ type: "transcript", data: result });
				break;
			}

			case "synthesize-stream": {
				const loader = loaders.get(cmd.modelSlug);
				if (!loader?.synthesize) {
					post({
						type: "error",
						code: "NOT_LOADED",
						message: "Model not loaded or does not support synthesis",
					});
					return;
				}

				// Forward speaker embedding URL to SpeechT5 loader
				if (cmd.speakerEmbeddingUrl != null && "setSpeakerEmbedding" in loader) {
					(loader as { setSpeakerEmbedding: (url: string | null) => void }).setSpeakerEmbedding(cmd.speakerEmbeddingUrl);
				}

				streamCancelled = false;
				const streamStart = performance.now();
				let chunkIndex = 0;

				if (loader.synthesizeStream) {
					// Native streaming (Kokoro) — use split() to pre-compute totalChunks
					let totalChunks: number;
					try {
						const sentences = splitIntoSentences(cmd.text);
						totalChunks = Math.max(1, sentences.length);
					} catch {
						totalChunks = 1;
					}

					for await (const chunk of loader.synthesizeStream(cmd.text, cmd.voice)) {
						if (streamCancelled) {
							post({ type: "stream-cancelled" });
							return;
						}
						post(
							{
								type: "audio-chunk",
								data: {
									audio: chunk.audio,
									sampleRate: chunk.sampleRate,
									chunkIndex,
									totalChunks,
									sentenceText: chunk.text,
								},
							},
							[chunk.audio.buffer],
						);
						chunkIndex++;
					}
				} else {
					// Fallback: sentence-level sequential synthesis
					const sentences = splitIntoSentences(cmd.text);
					const totalChunks = sentences.length;

					for (const sentence of sentences) {
						if (streamCancelled) {
							post({ type: "stream-cancelled" });
							return;
						}
						const result = await loader.synthesize(sentence, cmd.voice);
						post(
							{
								type: "audio-chunk",
								data: {
									audio: result.audio,
									sampleRate: result.sampleRate,
									chunkIndex,
									totalChunks,
									sentenceText: sentence,
								},
							},
							[result.audio.buffer],
						);
						chunkIndex++;
					}
				}

				const totalMs = Math.round(performance.now() - streamStart);
				post({
					type: "stream-end",
					data: { totalMs, sampleRate: 24000, totalChunks: chunkIndex },
				});
				break;
			}

			case "cancel-stream": {
				streamCancelled = true;
				break;
			}

			case "extract-embedding": {
				const { extractEmbeddingFromPCM } = await import(
					"./speaker-embedding"
				);
				const url = await extractEmbeddingFromPCM(cmd.audio, cmd.sampleRate, (p) => {
					post({ type: "progress", data: { status: "downloading", file: p.status, loaded: 0, total: 0 } });
				});
				post({ type: "embedding", url });
				break;
			}

			case "dispose": {
				const session = sessions.get(cmd.modelSlug);
				if (session) {
					await session.dispose();
					sessions.delete(cmd.modelSlug);
				}
				loaders.delete(cmd.modelSlug);
				post({ type: "disposed" });
				break;
			}
		}
	} catch (err) {
		post({
			type: "error",
			code: "WORKER_ERROR",
			message: err instanceof Error ? err.message : "Unknown worker error",
		});
	}
};

function post(msg: WorkerResponse, transfer?: Transferable[]) {
	self.postMessage(msg, { transfer: transfer ?? [] });
}
