/** Maps ISO 639-1 language codes to human-readable names. */
export const LANGUAGE_NAMES: Record<string, string> = {
	ar: "Arabic",
	da: "Danish",
	de: "German",
	el: "Greek",
	en: "English",
	es: "Spanish",
	fi: "Finnish",
	fr: "French",
	he: "Hebrew",
	hi: "Hindi",
	it: "Italian",
	ja: "Japanese",
	ko: "Korean",
	ms: "Malay",
	nl: "Dutch",
	no: "Norwegian",
	pl: "Polish",
	pt: "Portuguese",
	ru: "Russian",
	sv: "Swedish",
	sw: "Swahili",
	tr: "Turkish",
	zh: "Chinese",
};

export function getLanguageName(code: string): string {
	return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}
