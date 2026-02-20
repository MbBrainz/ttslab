"use client";

import dynamic from "next/dynamic";

const VoiceAgentDemo = dynamic(
	() =>
		import("@/components/voice-agent/voice-agent-demo").then(
			(mod) => mod.VoiceAgentDemo,
		),
	{ ssr: false },
);

export function VoiceAgentClient() {
	return <VoiceAgentDemo />;
}
