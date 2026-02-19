/**
 * Split text into sentences, keeping punctuation attached.
 * Handles common abbreviations (Mr., Dr., etc.) to avoid false splits.
 */
export function splitIntoSentences(text: string): string[] {
	// Replace common abbreviations with placeholders to avoid false splits
	const abbreviations = [
		"Mr.",
		"Mrs.",
		"Ms.",
		"Dr.",
		"Prof.",
		"Sr.",
		"Jr.",
		"St.",
		"vs.",
		"etc.",
		"e.g.",
		"i.e.",
	];
	let processed = text;
	const placeholders: [string, string][] = [];

	for (const abbr of abbreviations) {
		const placeholder = abbr.replace(/\./g, "\u0000");
		placeholders.push([placeholder, abbr]);
		processed = processed.split(abbr).join(placeholder);
	}

	// Split on sentence-ending punctuation followed by whitespace
	const parts = processed.split(/(?<=[.!?])\s+/);

	// Restore abbreviations and filter empty strings
	return parts
		.map((part) => {
			let restored = part;
			for (const [placeholder, original] of placeholders) {
				restored = restored.split(placeholder).join(original);
			}
			return restored.trim();
		})
		.filter((s) => s.length > 0);
}
