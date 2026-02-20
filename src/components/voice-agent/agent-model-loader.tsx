"use client";

import { ModelStatus, type ModelState } from "@/components/model-status";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface AgentModelLoaderProps {
	sttState: ModelState;
	llmState: ModelState;
	ttsState: ModelState;
	sttSizeMb: number;
	llmSizeMb: number;
	ttsSizeMb: number;
	onLoadStt: () => void;
	onLoadLlm: () => void;
	onLoadTts: () => void;
	onLoadAll: () => void;
	allReady: boolean;
}

export function AgentModelLoader({
	sttState,
	llmState,
	ttsState,
	sttSizeMb,
	llmSizeMb,
	ttsSizeMb,
	onLoadStt,
	onLoadLlm,
	onLoadTts,
	onLoadAll,
	allReady,
}: AgentModelLoaderProps) {
	const anyLoading =
		sttState.status === "downloading" ||
		sttState.status === "initializing" ||
		llmState.status === "downloading" ||
		llmState.status === "initializing" ||
		ttsState.status === "downloading" ||
		ttsState.status === "initializing";

	return (
		<div className="space-y-3">
			<div className="grid gap-3 sm:grid-cols-3">
				<ModelStatus
					state={sttState}
					modelName="STT: Whisper-tiny.en"
					sizeMb={sttSizeMb}
					onDownload={sttState.status === "not_loaded" ? onLoadStt : undefined}
					onRetry={sttState.status === "error" ? onLoadStt : undefined}
				/>
				<ModelStatus
					state={llmState}
					modelName="LLM"
					sizeMb={llmSizeMb}
					onDownload={llmState.status === "not_loaded" ? onLoadLlm : undefined}
					onRetry={llmState.status === "error" ? onLoadLlm : undefined}
				/>
				<ModelStatus
					state={ttsState}
					modelName="TTS: Kokoro-82M"
					sizeMb={ttsSizeMb}
					onDownload={ttsState.status === "not_loaded" ? onLoadTts : undefined}
					onRetry={ttsState.status === "error" ? onLoadTts : undefined}
				/>
			</div>

			{!allReady && !anyLoading && (
				<Button onClick={onLoadAll} className="w-full gap-2">
					<Download className="h-4 w-4" />
					Load All Models
				</Button>
			)}
		</div>
	);
}
