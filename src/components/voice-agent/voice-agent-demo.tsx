"use client";

import { useState } from "react";
import { useVoiceAgent } from "@/lib/hooks/use-voice-agent";
import { LLM_MODELS, type LlmModel } from "@/lib/inference/llm-types";
import type { Voice } from "@/lib/inference/types";
import { AgentModelLoader } from "./agent-model-loader";
import { PipelineStatus } from "./pipeline-status";
import { ConversationLog } from "./conversation-log";
import { AgentControls } from "./agent-controls";
import { StreamingVisualizer } from "@/components/streaming-visualizer";

// Default Kokoro voices — loaded after TTS model loads
const DEFAULT_VOICES: Voice[] = [
	{ id: "af_heart", name: "Heart (Female)" },
	{ id: "af_bella", name: "Bella (Female)" },
	{ id: "am_adam", name: "Adam (Male)" },
	{ id: "am_michael", name: "Michael (Male)" },
];

export function VoiceAgentDemo() {
	const [selectedLlm, setSelectedLlm] = useState<LlmModel>(LLM_MODELS[0]);
	const [selectedVoice, setSelectedVoice] = useState("af_heart");

	const agent = useVoiceAgent({
		sttModel: "whisper-tiny.en",
		ttsModel: "kokoro-82m",
		ttsVoice: selectedVoice,
		llmModel: selectedLlm,
	});

	const isStreaming = agent.phase === "thinking" || agent.phase === "speaking";

	return (
		<div className="space-y-6">
			{/* Model Loader */}
			<AgentModelLoader
				sttState={agent.sttState}
				llmState={agent.llmState}
				ttsState={agent.ttsState}
				sttSizeMb={39}
				llmSizeMb={selectedLlm.sizeMb}
				ttsSizeMb={82}
				onLoadStt={() => agent.loadStt()}
				onLoadLlm={() => agent.loadLlm()}
				onLoadTts={() => agent.loadTts()}
				onLoadAll={agent.loadAll}
				allReady={agent.allModelsReady}
			/>

			{/* Pipeline Status */}
			<PipelineStatus phase={agent.phase} />

			{/* Conversation */}
			<ConversationLog
				turns={agent.conversation}
				streamingText={agent.streamingText}
				isStreaming={isStreaming}
			/>

			{/* Visualizer */}
			{agent.phase !== "idle" && (
				<StreamingVisualizer
					analyser={agent.audioQueue?.analyserNode ?? null}
					isActive={agent.phase === "speaking"}
					height={48}
				/>
			)}

			{/* Controls */}
			<AgentControls
				phase={agent.phase}
				allReady={agent.allModelsReady}
				metrics={agent.metrics}
				isSpeechActive={agent.isSpeechActive}
				voices={DEFAULT_VOICES}
				selectedVoice={selectedVoice}
				onVoiceChange={setSelectedVoice}
				selectedLlm={selectedLlm}
				onLlmChange={setSelectedLlm}
				onStart={agent.startConversation}
				onStop={agent.stopConversation}
			/>
		</div>
	);
}
