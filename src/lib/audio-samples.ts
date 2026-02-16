export type AudioSample = {
	id: string;
	modelSlug: string;
	modelName: string;
	text: string;
	audioPath: string;
};

export const audioSamples: AudioSample[] = [
	{
		id: "kokoro-sample",
		modelSlug: "kokoro-82m",
		modelName: "Kokoro 82M",
		text: "Welcome to TTSLab, where you can test text-to-speech models directly in your browser.",
		audioPath: "/audio-samples/kokoro-82m.wav",
	},
	{
		id: "speecht5-sample",
		modelSlug: "speecht5",
		modelName: "SpeechT5",
		text: "Welcome to TTSLab, where you can test text-to-speech models directly in your browser.",
		audioPath: "/audio-samples/speecht5.wav",
	},
	{
		id: "piper-sample",
		modelSlug: "piper-en-us-lessac-medium",
		modelName: "Piper Lessac Medium",
		text: "Welcome to TTSLab, where you can test text-to-speech models directly in your browser.",
		audioPath: "/audio-samples/piper-lessac.wav",
	},
];
