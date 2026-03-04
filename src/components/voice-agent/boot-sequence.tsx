"use client";

import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ModelState } from "@/components/model-status";

interface BootSequenceProps {
	sttState: ModelState;
	llmState: ModelState;
	ttsState: ModelState;
	onPowerOn: () => void;
	allReady: boolean;
}

function isLoading(state: ModelState): boolean {
	return state.status === "downloading" || state.status === "initializing";
}

function modelLabel(state: ModelState, name: string): string {
	switch (state.status) {
		case "not_loaded":
			return name;
		case "downloading":
			return `${name} ${Math.round(state.progress)}%`;
		case "initializing":
			return `${name} initializing...`;
		case "ready":
			return `${name} ready`;
		case "error":
			return `${name} failed`;
		default:
			return name;
	}
}

export function BootSequence({
	sttState,
	llmState,
	ttsState,
	onPowerOn,
	allReady,
}: BootSequenceProps) {
	if (allReady) return null;

	const anyLoading =
		isLoading(sttState) || isLoading(llmState) || isLoading(ttsState);
	const anyErrored =
		sttState.status === "error" ||
		llmState.status === "error" ||
		ttsState.status === "error";

	return (
		<div className="flex flex-col items-center gap-6">
			{/* Model status lines */}
			<div className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
				<span>{modelLabel(sttState, "Whisper")}</span>
				<span>{modelLabel(llmState, "LFM2.5")}</span>
				<span>{modelLabel(ttsState, "Kokoro")}</span>
			</div>

			{/* Power On / Retry button */}
			{!anyLoading && (
				<Button
					size="lg"
					className="rounded-full gap-2 px-8"
					onClick={onPowerOn}
				>
					<Zap className="h-5 w-5" />
					{anyErrored ? "Retry" : "Power On"}
				</Button>
			)}

			{/* Helper text */}
			{!anyLoading && !anyErrored && (
				<p className="text-xs text-muted-foreground">
					3 models &middot; ~850 MB total
				</p>
			)}
		</div>
	);
}
