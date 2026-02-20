import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { VoiceAgentClient } from "@/components/voice-agent/voice-agent-client";

export const metadata: Metadata = {
	title: "Voice Agent — Talk to AI in Your Browser with On-Device STT & TTS",
	description:
		"Talk to an AI voice agent running entirely in your browser. Whisper STT, LLM, and Kokoro TTS — all on-device. Zero server, zero data collection.",
};

export default function VoiceAgentPage() {
	return (
		<div className="mx-auto max-w-3xl space-y-8">
			<div className="space-y-2">
				<div className="flex items-center gap-3">
					<h1 className="text-3xl font-bold tracking-tight">Voice Agent</h1>
					<Badge variant="secondary">Preview</Badge>
				</div>
				<p className="text-muted-foreground">
					Talk to an AI assistant powered entirely by in-browser models. Your voice
					and conversation never leave your device.
				</p>
			</div>
			<VoiceAgentClient />
		</div>
	);
}
