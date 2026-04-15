"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings, X, Mic, Square } from "lucide-react";
import { useVoiceAgent } from "@/lib/hooks/use-voice-agent";
import { LLM_MODELS, type LlmModel } from "@/lib/inference/llm-types";
import type { Voice } from "@/lib/inference/types";
import { cn } from "@/lib/utils";
import { VoiceAgentOrb } from "./voice-agent-orb";
import { OrbCanvas } from "./orb-canvas";
import { BootSequence } from "./boot-sequence";
import { HudMetrics } from "./hud-metrics";
import { ConversationLog } from "./conversation-log";
import { SettingsDrawer } from "./settings-drawer";

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
	const [drawerOpen, setDrawerOpen] = useState(false);

	const agent = useVoiceAgent({
		sttModel: "whisper-tiny.en",
		ttsModel: "kokoro-82m",
		ttsVoice: selectedVoice,
		llmModel: selectedLlm,
	});

	const isStreaming = agent.phase === "thinking" || agent.phase === "speaking";
	const isActive = agent.phase !== "idle";

	return (
		<div className="flex h-dvh flex-col">
			<h1 className="sr-only">Voice Agent — Talk to AI</h1>

			{/* Header: minimal, fades when agent is active */}
			<header
				className={cn(
					"flex items-center justify-between px-4 py-3 transition-opacity duration-700",
					isActive ? "opacity-20 hover:opacity-80" : "opacity-100",
				)}
			>
				<Link href="/" className="text-sm font-medium text-foreground">
					TTSLab<span className="text-muted-foreground">.dev</span>
					<span className="text-muted-foreground"> · Voice Agent</span>
				</Link>
				<div className="flex items-center gap-2">
					<button
						type="button"
						aria-label="Open settings"
						onClick={() => setDrawerOpen(true)}
						className="p-2 -m-2 text-muted-foreground hover:text-foreground"
					>
						<Settings className="h-4 w-4" />
					</button>
					<Link
						href="/"
						aria-label="Close voice agent"
						className="p-2 -m-2 text-muted-foreground hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</Link>
				</div>
			</header>

			{/* Center: orb zone (flex-1, centered) */}
			<div className="flex flex-1 flex-col items-center justify-center gap-4">
				<VoiceAgentOrb phase={agent.phase}>
					<OrbCanvas
						analyser={agent.audioQueue?.analyserNode ?? null}
						phase={agent.phase}
						orbSize={160}
					/>
				</VoiceAgentOrb>

				{/* State label */}
				<p className="text-sm font-medium capitalize text-muted-foreground">
					{agent.phase === "idle" && !agent.allModelsReady
						? ""
						: agent.phase === "idle"
							? "Ready"
							: agent.phase}
				</p>

				{/* Boot sequence (only shown when not all models ready) */}
				{!agent.allModelsReady && (
					<BootSequence
						sttState={agent.sttState}
						llmState={agent.llmState}
						ttsState={agent.ttsState}
						llmLabel={selectedLlm.name}
						onPowerOn={agent.loadAll}
						allReady={agent.allModelsReady}
					/>
				)}

				{/* HUD metrics */}
				<HudMetrics metrics={agent.metrics} visible={agent.phase !== "idle"} />
			</div>

			{/* Bottom: transcript + mic button */}
			<div className="px-4 pb-6">
				<ConversationLog
					turns={agent.conversation}
					streamingText={agent.streamingText}
					isStreaming={isStreaming}
				/>

				{/* Floating mic button */}
				<div className="flex justify-center pt-4">
					{agent.allModelsReady && (
						<button
							type="button"
							aria-label={isActive ? "Stop conversation" : "Start conversation"}
							onClick={
								isActive ? agent.stopConversation : agent.startConversation
							}
							className={cn(
								"flex h-14 w-14 items-center justify-center rounded-full transition-all duration-300",
								isActive
									? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
									: "bg-primary text-primary-foreground hover:bg-primary/90",
							)}
						>
							{isActive ? (
								<Square className="h-5 w-5" />
							) : (
								<Mic className="h-6 w-6" />
							)}
						</button>
					)}
				</div>
			</div>

			{/* Settings drawer */}
			<SettingsDrawer
				open={drawerOpen}
				onOpenChange={setDrawerOpen}
				voices={DEFAULT_VOICES}
				selectedVoice={selectedVoice}
				onVoiceChange={setSelectedVoice}
				selectedLlm={selectedLlm}
				onLlmChange={setSelectedLlm}
				turns={agent.conversation}
				disabled={isActive}
			/>
		</div>
	);
}
