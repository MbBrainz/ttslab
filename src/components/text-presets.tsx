"use client";

type Preset = { label: string; text: string };

const PRESETS: Preset[] = [
	{
		label: "Quick Test",
		text: "Hello, this is a quick test of the text to speech model.",
	},
	{
		label: "News",
		text: "Breaking news today: scientists have discovered a new species of deep-sea fish that produces bioluminescent patterns never seen before in the animal kingdom.",
	},
	{
		label: "Audiobook",
		text: "The old house stood at the end of the lane, its windows dark and watchful. She hesitated at the gate, her hand trembling on the cold iron latch.",
	},
	{
		label: "Tongue Twister",
		text: "She sells seashells by the seashore. The shells she sells are seashells, I'm sure.",
	},
	{
		label: "Conversational",
		text: "Hey, have you tried that new coffee shop on Main Street? I went there yesterday and honestly, it might be the best latte I've ever had.",
	},
	{
		label: "Technical",
		text: "The WebGPU API provides a modern interface for GPU-accelerated graphics and compute operations, enabling high-performance machine learning inference directly in the browser.",
	},
	{
		label: "Poetic",
		text: "In the garden of twilight, where shadows dance with fading light, the last rose of summer whispers secrets to the evening breeze.",
	},
	{
		label: "Long Form",
		text: "Artificial intelligence has transformed the way we interact with technology. From voice assistants that understand natural language to recommendation systems that predict our preferences, AI is woven into the fabric of our daily lives. As these systems become more sophisticated, the line between human and machine communication continues to blur, raising important questions about the future of human-computer interaction.",
	},
];

const CHATTERBOX_PRESETS: Preset[] = [
	{ label: "Expressive", text: "Oh wow [laugh] that's absolutely hilarious! I can't believe you actually did that." },
	{ label: "Emotional", text: "I have something important to tell you. [cough] Sorry, let me start over. This really means a lot to me." },
	{ label: "Storytelling", text: "And then, right at the last moment [chuckle] he realized he'd been holding the map upside down the entire time." },
	{ label: "Quick Test", text: "Hello, this is a quick test of the Chatterbox text to speech model." },
	{ label: "Conversational", text: "Hey [laugh] have you heard the news? They're opening a new place downtown and apparently it's amazing." },
];

const MODEL_PRESETS: Record<string, Preset[]> = {
	"chatterbox": CHATTERBOX_PRESETS,
	"chatterbox-turbo": CHATTERBOX_PRESETS,
	"chatterbox-multilingual": [
		{ label: "English", text: "Hello! [laugh] This is Chatterbox speaking in English. Isn't this amazing?" },
		{ label: "Spanish", text: "¡Hola! Esta es una demostración de síntesis de voz en español." },
		{ label: "French", text: "Bonjour! Ceci est une démonstration de synthèse vocale en français." },
		{ label: "Japanese", text: "こんにちは！これは日本語の音声合成のデモンストレーションです。" },
		{ label: "Arabic", text: "مرحبًا! هذا عرض توضيحي لتركيب الكلام باللغة العربية." },
		{ label: "Korean", text: "안녕하세요! 이것은 한국어 음성 합성 시연입니다." },
		{ label: "Chinese", text: "你好！这是中文语音合成的演示。" },
		{ label: "German", text: "Hallo! Dies ist eine Demonstration der Sprachsynthese auf Deutsch." },
	],
	"supertonic-2": [
		{ label: "English", text: "Hello, this is a demonstration of Supertonic text to speech." },
		{ label: "Korean", text: "안녕하세요, 이것은 수퍼토닉 음성 합성 시연입니다." },
		{ label: "Spanish", text: "Hola, esta es una demostración de síntesis de voz de Supertonic." },
		{ label: "Portuguese", text: "Olá, esta é uma demonstração de síntese de voz do Supertonic." },
		{ label: "French", text: "Bonjour, ceci est une démonstration de synthèse vocale Supertonic." },
		{ label: "Quick Test", text: "Hello, this is a quick test of the text to speech model." },
	],
	"kokoro-82m": [
		{ label: "Quick Test", text: "Hello, this is a quick test of the Kokoro text to speech model." },
		{ label: "French", text: "Bonjour, ceci est une démonstration de la synthèse vocale Kokoro." },
		{ label: "Japanese", text: "こんにちは、これはKokoroの音声合成デモです。" },
		{ label: "Korean", text: "안녕하세요, 이것은 코코로 음성 합성 시연입니다." },
		{ label: "Chinese", text: "你好，这是Kokoro语音合成的演示。" },
		{ label: "Conversational", text: "Hey, have you tried that new coffee shop on Main Street? I went there yesterday and honestly, it might be the best latte I've ever had." },
		{ label: "Long Form", text: "Artificial intelligence has transformed the way we interact with technology. From voice assistants that understand natural language to recommendation systems that predict our preferences, AI is woven into the fabric of our daily lives." },
	],
};

function getPresets(modelSlug?: string): Preset[] {
	if (!modelSlug) return PRESETS;
	return MODEL_PRESETS[modelSlug] ?? PRESETS;
}

type TextPresetsProps = {
	onSelect: (text: string) => void;
	disabled?: boolean;
	modelSlug?: string;
};

export function TextPresets({ onSelect, disabled, modelSlug }: TextPresetsProps) {
	const presets = getPresets(modelSlug);

	return (
		<div className="space-y-1.5">
			<p className="text-xs text-muted-foreground">Try an example</p>
			<div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
				{presets.map((preset) => (
					<button
						key={preset.label}
						type="button"
						onClick={() => onSelect(preset.text)}
						disabled={disabled}
						title={preset.text.slice(0, 60) + (preset.text.length > 60 ? "..." : "")}
						className="shrink-0 rounded-md border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
					>
						{preset.label}
					</button>
				))}
			</div>
		</div>
	);
}
