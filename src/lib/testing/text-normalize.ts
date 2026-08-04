/**
 * Text normalization for WER comparison.
 *
 * Both the reference and the hypothesis go through this, so the only job is to
 * map the two spellings of the same *spoken* utterance onto one string. The
 * reference is written text ("$42.50"); the hypothesis is what an ASR heard
 * ("forty two dollars and fifty cents"). Without expansion those score WER
 * 1.000 on output that was in fact perfect.
 *
 * Everything here expands toward the spoken form, because that is the form the
 * ASR produces and it is the side we cannot control.
 *
 * Known residuals, accepted deliberately (each costs ~1 insertion/substitution,
 * not a false failure):
 * - "one hundred and fifty" vs "one hundred fifty" — we emit the US form
 *   without "and". Dropping a bare "and" globally would corrupt real text.
 * - "he'd" expands to "he would"; "he had" costs one substitution.
 * - Years: "1984" expands to "one thousand nine hundred eighty four", not
 *   "nineteen eighty four". The spec's Harvard corpus contains no digits, so
 *   this only affects ad-hoc phrases.
 * - "St." is deliberately NOT expanded — "saint" vs "street" is unresolvable
 *   without context and guessing would introduce a new false failure.
 */

// ── Number words ─────────────────────────────────────────────────────

const ONES = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
	"thirteen",
	"fourteen",
	"fifteen",
	"sixteen",
	"seventeen",
	"eighteen",
	"nineteen",
];

const TENS = [
	"",
	"",
	"twenty",
	"thirty",
	"forty",
	"fifty",
	"sixty",
	"seventy",
	"eighty",
	"ninety",
];

const SCALES: Array<[number, string]> = [
	[1_000_000_000, "billion"],
	[1_000_000, "million"],
	[1_000, "thousand"],
];

function belowHundred(n: number): string {
	if (n < 20) return ONES[n];
	const tens = TENS[Math.floor(n / 10)];
	const ones = n % 10;
	return ones === 0 ? tens : `${tens} ${ONES[ones]}`;
}

function belowThousand(n: number): string {
	if (n < 100) return belowHundred(n);
	const hundreds = `${ONES[Math.floor(n / 100)]} hundred`;
	const rest = n % 100;
	return rest === 0 ? hundreds : `${hundreds} ${belowHundred(rest)}`;
}

export function numberToWords(n: number): string {
	if (!Number.isFinite(n)) return "";
	if (n < 0) return `minus ${numberToWords(-n)}`;
	if (n === 0) return "zero";

	const parts: string[] = [];
	let rest = Math.floor(n);

	for (const [value, name] of SCALES) {
		if (rest >= value) {
			parts.push(`${belowThousand(Math.floor(rest / value))} ${name}`);
			rest %= value;
		}
	}
	if (rest > 0) parts.push(belowThousand(rest));

	return parts.join(" ");
}

// ── Ordinals ─────────────────────────────────────────────────────────

const ORDINAL_IRREGULAR: Record<string, string> = {
	one: "first",
	two: "second",
	three: "third",
	five: "fifth",
	eight: "eighth",
	nine: "ninth",
	twelve: "twelfth",
};

/** "twenty one" -> "twenty first". Only the final word takes the suffix. */
function toOrdinal(cardinal: string): string {
	const words = cardinal.split(" ");
	const last = words[words.length - 1];

	if (ORDINAL_IRREGULAR[last]) {
		words[words.length - 1] = ORDINAL_IRREGULAR[last];
	} else if (last.endsWith("y")) {
		words[words.length - 1] = `${last.slice(0, -1)}ieth`;
	} else {
		words[words.length - 1] = `${last}th`;
	}

	return words.join(" ");
}

// ── Contractions ─────────────────────────────────────────────────────

/**
 * Expanded because an ASR writes them out. Order matters only in that these
 * run before the generic apostrophe strip, which would otherwise turn "it's"
 * into "its" and cost a substitution against "it is".
 */
const CONTRACTIONS: Record<string, string> = {
	"can't": "cannot",
	"won't": "will not",
	"shan't": "shall not",
	"ain't": "is not",
	"let's": "let us",
	"i'm": "i am",
	"i've": "i have",
	"i'll": "i will",
	"i'd": "i would",
	"it's": "it is",
	"he's": "he is",
	"she's": "she is",
	"that's": "that is",
	"there's": "there is",
	"here's": "here is",
	"what's": "what is",
	"who's": "who is",
	"where's": "where is",
	"how's": "how is",
	"you're": "you are",
	"we're": "we are",
	"they're": "they are",
	"you've": "you have",
	"we've": "we have",
	"they've": "they have",
	"you'll": "you will",
	"he'll": "he will",
	"she'll": "she will",
	"we'll": "we will",
	"they'll": "they will",
	"it'll": "it will",
	"you'd": "you would",
	"he'd": "he would",
	"she'd": "she would",
	"we'd": "we would",
	"they'd": "they would",
};

/** Any remaining n't/'ve/'ll/'re/'d after the explicit table. */
const CONTRACTION_SUFFIXES: Array<[RegExp, string]> = [
	[/(\w+)n't\b/g, "$1 not"],
	[/(\w+)'ve\b/g, "$1 have"],
	[/(\w+)'ll\b/g, "$1 will"],
	[/(\w+)'re\b/g, "$1 are"],
	[/(\w+)'d\b/g, "$1 would"],
];

function expandContractions(text: string): string {
	let out = text;
	for (const [contracted, expanded] of Object.entries(CONTRACTIONS)) {
		out = out.replaceAll(contracted, expanded);
	}
	for (const [pattern, replacement] of CONTRACTION_SUFFIXES) {
		out = out.replace(pattern, replacement);
	}
	// "doesn't" -> "does not" leaves "does"; but "didn't" -> "did not" is fine.
	// Remaining apostrophes are possessives: "dog's" -> "dogs".
	return out.replace(/'/g, "");
}

// ── Abbreviations ────────────────────────────────────────────────────

/**
 * Conservative on purpose. "St." is omitted: saint vs street cannot be
 * resolved without context, and a wrong guess creates a new false failure.
 */
const ABBREVIATIONS: Array<[RegExp, string]> = [
	[/\bdr\.?(?=\s|$)/g, "doctor"],
	[/\bmr\.?(?=\s|$)/g, "mister"],
	[/\bmrs\.?(?=\s|$)/g, "missus"],
	[/\bms\.?(?=\s|$)/g, "miss"],
	[/\bprof\.?(?=\s|$)/g, "professor"],
	[/\bjr\.?(?=\s|$)/g, "junior"],
	[/\bsr\.?(?=\s|$)/g, "senior"],
	[/\bvs\.?(?=\s|$)/g, "versus"],
	[/\be\.g\.?(?=\s|$)/g, "for example"],
	[/\bi\.e\.?(?=\s|$)/g, "that is"],
	[/\betc\.?(?=\s|$)/g, "et cetera"],
];

function expandAbbreviations(text: string): string {
	let out = text;
	for (const [pattern, replacement] of ABBREVIATIONS) {
		out = out.replace(pattern, replacement);
	}
	return out;
}

// ── Numerics ─────────────────────────────────────────────────────────

/** "2.5" -> "two point five"; digits after the point are read individually. */
function decimalToWords(whole: string, fraction: string): string {
	const digits = [...fraction].map((d) => ONES[Number(d)]).join(" ");
	return `${numberToWords(Number(whole))} point ${digits}`;
}

function currencyToWords(whole: string, cents?: string): string {
	const dollars = Number(whole.replace(/,/g, ""));
	const unit = dollars === 1 ? "dollar" : "dollars";
	const head = `${numberToWords(dollars)} ${unit}`;

	if (!cents || Number(cents) === 0) return head;
	const centValue = Number(cents.padEnd(2, "0"));
	return `${head} and ${numberToWords(centValue)} ${centValue === 1 ? "cent" : "cents"}`;
}

/**
 * Ordered: each pattern consumes the punctuation the next one would otherwise
 * see. Currency before decimals before bare integers.
 */
function expandNumerics(text: string): string {
	return text
		.replace(/\$(\d[\d,]*)\.(\d{1,2})\b/g, (_m, w, c) => currencyToWords(w, c))
		.replace(/\$(\d[\d,]*)/g, (_m, w) => currencyToWords(w))
		.replace(
			/(\d[\d,]*)\s*%/g,
			(_m, n) => `${numberToWords(Number(n.replace(/,/g, "")))} percent`,
		)
		.replace(/\b(\d+)(?:st|nd|rd|th)\b/g, (_m, n) =>
			toOrdinal(numberToWords(Number(n))),
		)
		.replace(/\b(\d[\d,]*)\.(\d+)\b/g, (_m, w, f) =>
			decimalToWords(w.replace(/,/g, ""), f),
		)
		.replace(/\b\d[\d,]*\b/g, (m) =>
			numberToWords(Number(m.replace(/,/g, ""))),
		);
}

// ── Entry point ──────────────────────────────────────────────────────

export function normalizeForWER(text: string): string {
	return (
		expandNumerics(expandAbbreviations(expandContractions(text.toLowerCase())))
			// Hyphens and slashes become a space, never nothing: an ASR's
			// "forty-two" must not collapse to "fortytwo" against "forty two".
			.replace(/[-–—/]+/g, " ")
			.replace(/[^\w\s]/g, "")
			.replace(/\s+/g, " ")
			.trim()
	);
}

export function toWords(text: string): string[] {
	const normalized = normalizeForWER(text);
	return normalized === "" ? [] : normalized.split(" ");
}
