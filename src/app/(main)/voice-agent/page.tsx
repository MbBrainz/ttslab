import type { Metadata } from "next";
import { VoiceAgentClient } from "@/components/voice-agent/voice-agent-client";

export const metadata: Metadata = {
	title: "Voice Agent — TTSLab",
	description:
		"Talk to an AI voice agent running entirely in your browser. Mic → Whisper STT → LLM → Kokoro TTS → Speaker. No server required.",
};

export default function VoiceAgentPage() {
	return (
		<div className="mx-auto max-w-3xl space-y-8">
			<div className="space-y-2">
				<h1 className="text-3xl font-bold tracking-tight">Voice Agent</h1>
				<p className="text-muted-foreground">
					Talk to an AI assistant powered entirely by in-browser models. Your voice
					and conversation never leave your device.
				</p>
			</div>
			<VoiceAgentClient />
		</div>
	);
}
