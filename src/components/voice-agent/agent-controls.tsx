"use client";

import { Mic, MicOff, Square, Cloud, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectOption } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { AgentPhase, AgentMetrics } from "@/lib/hooks/use-voice-agent";
import { LLM_MODELS, type LlmModel } from "@/lib/inference/llm-types";
import type { Voice } from "@/lib/inference/types";
import { formatMs } from "@/lib/format";

interface AgentControlsProps {
	phase: AgentPhase;
	allReady: boolean;
	metrics: AgentMetrics;
	isSpeechActive: boolean;
	// Voice
	voices: Voice[];
	selectedVoice: string;
	onVoiceChange: (voice: string) => void;
	// LLM
	selectedLlm: LlmModel;
	onLlmChange: (model: LlmModel) => void;
	// Cloud
	useCloud: boolean;
	onCloudToggle: () => void;
	// Actions
	onStart: () => void;
	onStop: () => void;
}

export function AgentControls({
	phase,
	allReady,
	metrics,
	isSpeechActive,
	voices,
	selectedVoice,
	onVoiceChange,
	selectedLlm,
	onLlmChange,
	useCloud,
	onCloudToggle,
	onStart,
	onStop,
}: AgentControlsProps) {
	const isActive = phase !== "idle";

	return (
		<div className="space-y-4">
			{/* Main controls row */}
			<div className="flex items-center gap-3">
				{isActive ? (
					<Button
						variant="destructive"
						size="lg"
						onClick={onStop}
						className="gap-2"
					>
						<Square className="h-4 w-4" />
						Stop
					</Button>
				) : (
					<Button
						size="lg"
						onClick={onStart}
						disabled={!allReady}
						className="gap-2"
					>
						<Mic className="h-4 w-4" />
						Start Conversation
					</Button>
				)}

				{isActive && (
					<Badge
						variant={isSpeechActive ? "default" : "secondary"}
						className="gap-1.5"
					>
						{isSpeechActive ? (
							<>
								<Mic className="h-3 w-3 animate-pulse" />
								Speaking...
							</>
						) : (
							<>
								<MicOff className="h-3 w-3" />
								Listening
							</>
						)}
					</Badge>
				)}
			</div>

			{/* Settings row */}
			<div className="flex flex-wrap items-center gap-3">
				{voices.length > 0 && (
					<Select
						value={selectedVoice}
						onChange={(e) => onVoiceChange(e.target.value)}
						disabled={isActive}
					>
						{voices.map((v) => (
							<SelectOption key={v.id} value={v.id}>
								{v.name}
							</SelectOption>
						))}
					</Select>
				)}

				<Select
					value={selectedLlm.id}
					onChange={(e) => {
						const model = LLM_MODELS.find((m) => m.id === e.target.value);
						if (model) onLlmChange(model);
					}}
					disabled={isActive}
				>
					{LLM_MODELS.map((m) => (
						<SelectOption key={m.id} value={m.id}>
							{m.name}
						</SelectOption>
					))}
				</Select>

				<Button
					variant={useCloud ? "default" : "outline"}
					size="sm"
					onClick={onCloudToggle}
					disabled={isActive}
					className="gap-1.5"
				>
					{useCloud ? (
						<Cloud className="h-3.5 w-3.5" />
					) : (
						<CloudOff className="h-3.5 w-3.5" />
					)}
					Cloud LLM: {useCloud ? "On" : "Off"}
				</Button>
			</div>

			{/* Metrics row */}
			{(metrics.sttMs !== null || metrics.llmTokensPerSec !== null || metrics.ttsRtf !== null) && (
				<div className="flex gap-4 text-xs tabular-nums text-muted-foreground">
					{metrics.sttMs !== null && (
						<span>STT {formatMs(metrics.sttMs)}</span>
					)}
					{metrics.llmTokensPerSec !== null && (
						<span>LLM {metrics.llmTokensPerSec} tok/s</span>
					)}
					{metrics.ttsRtf !== null && (
						<span>TTS {metrics.ttsRtf.toFixed(2)}x RTF</span>
					)}
				</div>
			)}
		</div>
	);
}
