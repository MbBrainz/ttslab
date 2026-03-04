import type { Metadata } from "next";
import { VoiceAgentClient } from "@/components/voice-agent/voice-agent-client";

export const metadata: Metadata = {
	title: "Voice Agent — Talk to AI in Your Browser with On-Device STT & TTS",
	description:
		"Talk to an AI voice agent running entirely in your browser. Whisper STT, LLM, and Kokoro TTS — all on-device. Zero server, zero data collection.",
};

export default function VoiceAgentPage() {
	return <VoiceAgentClient />;
}
