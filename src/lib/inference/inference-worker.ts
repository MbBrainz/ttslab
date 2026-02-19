import { selectBackend } from "./backend-select";
import { getLoader } from "./registry";
import type {
	ModelLoader,
	ModelSession,
	WorkerCommand,
	WorkerResponse,
} from "./types";

const loaders = new Map<string, ModelLoader>();
const sessions = new Map<string, ModelSession>();

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

				const loadTime = Math.round(performance.now() - loadStart);
				const voices = loader.getVoices?.() ?? [];

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

				const result = await loader.synthesize(cmd.text, cmd.voice);
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
