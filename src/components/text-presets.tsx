"use client";

const PRESETS = [
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

type TextPresetsProps = {
	onSelect: (text: string) => void;
	disabled?: boolean;
};

export function TextPresets({ onSelect, disabled }: TextPresetsProps) {
	return (
		<div className="space-y-1.5">
			<p className="text-xs text-muted-foreground">Try an example</p>
			<div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
				{PRESETS.map((preset) => (
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
