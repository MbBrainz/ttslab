import { track } from "@vercel/analytics";

export function trackModelLoad(
	model: string,
	backend: string,
	loadTimeMs: number,
) {
	track("model_loaded", { model, backend, loadTimeMs });
}

export function trackTTSGeneration(
	model: string,
	backend: string,
	textLength: number,
	generationMs: number,
	rtf?: number,
) {
	track("tts_generation", {
		model,
		backend,
		textLength,
		generationMs,
		...(rtf != null && { rtf: Math.round(rtf * 1000) / 1000 }),
	});
}

export function trackSTTTranscription(
	model: string,
	backend: string,
	audioDurationMs: number,
	transcriptionMs: number,
) {
	track("stt_transcription", { model, backend, audioDurationMs, transcriptionMs });
}

export function trackModelUpvote(model: string) {
	track("model_upvoted", { model });
}

export function trackAudioSamplePlayed(model: string, sample: string) {
	track("audio_sample_played", { model, sample });
}
