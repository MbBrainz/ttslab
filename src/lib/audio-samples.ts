export type AudioSample = {
	id: string;
	modelSlug: string;
	modelName: string;
	text: string;
	audioPath: string;
};

export const audioSamples: AudioSample[] = [
	{
		id: "kokoro-hello",
		modelSlug: "kokoro-82m",
		modelName: "Kokoro 82M",
		text: "Welcome to TTSLab, where you can test text-to-speech models directly in your browser.",
		audioPath: "/audio-samples/kokoro-hello.wav",
	},
	{
		id: "kokoro-poem",
		modelSlug: "kokoro-82m",
		modelName: "Kokoro 82M",
		text: "The quick brown fox jumps over the lazy dog, while the sun sets behind the distant mountains.",
		audioPath: "/audio-samples/kokoro-poem.wav",
	},
	{
		id: "speecht5-intro",
		modelSlug: "speecht5",
		modelName: "SpeechT5",
		text: "All models run entirely on your device using WebGPU or WebAssembly. No data ever leaves your browser.",
		audioPath: "/audio-samples/speecht5-intro.wav",
	},
	{
		id: "kokoro-technical",
		modelSlug: "kokoro-82m",
		modelName: "Kokoro 82M",
		text: "Neural text-to-speech synthesis has improved dramatically, enabling real-time voice generation on consumer hardware.",
		audioPath: "/audio-samples/kokoro-technical.wav",
	},
];
