"use client";

import { Info } from "lucide-react";
import { useState } from "react";

const HINTS: Record<string, string[]> = {
	"kokoro-82m": [
		"Use ... (ellipsis) to add pauses",
		"Punctuation affects rhythm and intonation",
		"Supports English, French, Japanese, Korean, Chinese",
		"Different voices have different speaking styles",
	],
	speecht5: [
		"Best with short, clear sentences",
		"English only",
		"Punctuation helps with natural pacing",
	],
	"piper-en-us-lessac-medium": [
		"Optimized for US English",
		"Works best with properly punctuated text",
		"Consistent quality across sentence lengths",
	],
};

const DEFAULT_HINTS = [
	"Use proper punctuation for natural results",
	"Keep sentences clear and well-structured",
];

export function SSMLHints({ modelSlug }: { modelSlug: string }) {
	const [open, setOpen] = useState(false);
	const tips = HINTS[modelSlug] ?? DEFAULT_HINTS;

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
				aria-expanded={open}
				aria-label="Text formatting tips"
			>
				<Info className="h-3.5 w-3.5" />
			</button>
			{open && (
				<ul className="mt-1.5 bg-secondary/50 border border-border rounded-lg p-3 text-xs text-muted-foreground space-y-1 list-disc list-inside">
					{tips.map((tip) => (
						<li key={tip}>{tip}</li>
					))}
				</ul>
			)}
		</>
	);
}
