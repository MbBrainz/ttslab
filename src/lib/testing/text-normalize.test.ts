import { describe, expect, it } from "vitest";
import { normalizeForWER, numberToWords, toWords } from "./text-normalize";

describe("numberToWords", () => {
	it("covers the range the old DIGIT_WORDS table did not", () => {
		expect(numberToWords(0)).toBe("zero");
		expect(numberToWords(7)).toBe("seven");
		expect(numberToWords(10)).toBe("ten");
		expect(numberToWords(11)).toBe("eleven");
		expect(numberToWords(19)).toBe("nineteen");
		expect(numberToWords(20)).toBe("twenty");
		expect(numberToWords(42)).toBe("forty two");
		expect(numberToWords(100)).toBe("one hundred");
		expect(numberToWords(101)).toBe("one hundred one");
		expect(numberToWords(999)).toBe("nine hundred ninety nine");
		expect(numberToWords(1000)).toBe("one thousand");
		expect(numberToWords(1250)).toBe("one thousand two hundred fifty");
		expect(numberToWords(1_000_000)).toBe("one million");
		expect(numberToWords(2_500_000)).toBe("two million five hundred thousand");
	});

	it("handles negatives and non-finite input without throwing", () => {
		expect(numberToWords(-5)).toBe("minus five");
		expect(numberToWords(Number.NaN)).toBe("");
		expect(numberToWords(Number.POSITIVE_INFINITY)).toBe("");
	});
});

describe("normalizeForWER — contractions", () => {
	// The regression that matters: a bare /(\w+)n't/ -> "$1 not" rule turns
	// "won't" into "wo not" and "can't" into "ca not". The explicit table must
	// run first.
	it("expands irregular contractions without mangling the stem", () => {
		expect(normalizeForWER("won't")).toBe("will not");
		expect(normalizeForWER("can't")).toBe("cannot");
		expect(normalizeForWER("shan't")).toBe("shall not");
	});

	it("expands regular n't via the suffix rule", () => {
		expect(normalizeForWER("doesn't")).toBe("does not");
		expect(normalizeForWER("isn't")).toBe("is not");
		expect(normalizeForWER("couldn't")).toBe("could not");
		expect(normalizeForWER("didn't")).toBe("did not");
	});

	it("expands 'm / 're / 've / 'll / 'd", () => {
		expect(normalizeForWER("I'm")).toBe("i am");
		expect(normalizeForWER("you're")).toBe("you are");
		expect(normalizeForWER("they've")).toBe("they have");
		expect(normalizeForWER("we'll")).toBe("we will");
		expect(normalizeForWER("she'd")).toBe("she would");
	});

	it("strips possessive apostrophes rather than expanding them", () => {
		expect(normalizeForWER("the dog's bowl")).toBe("the dogs bowl");
		expect(normalizeForWER("the dogs' bowls")).toBe("the dogs bowls");
	});
});

describe("normalizeForWER — numerics", () => {
	it("expands currency including the cents form", () => {
		expect(normalizeForWER("$42.50")).toBe("forty two dollars and fifty cents");
		expect(normalizeForWER("$85")).toBe("eighty five dollars");
		expect(normalizeForWER("$1")).toBe("one dollar");
		expect(normalizeForWER("$1,020.75")).toBe(
			"one thousand twenty dollars and seventy five cents",
		);
	});

	it("drops a zero cents component", () => {
		expect(normalizeForWER("$20.00")).toBe("twenty dollars");
	});

	it("expands percent, ordinals and decimals", () => {
		expect(normalizeForWER("15%")).toBe("fifteen percent");
		expect(normalizeForWER("3rd")).toBe("third");
		expect(normalizeForWER("21st")).toBe("twenty first");
		expect(normalizeForWER("20th")).toBe("twentieth");
		expect(normalizeForWER("2.5")).toBe("two point five");
		expect(normalizeForWER("0.25")).toBe("zero point two five");
	});

	it("strips thousands separators before converting", () => {
		expect(normalizeForWER("1,250")).toBe("one thousand two hundred fifty");
	});
});

describe("normalizeForWER — punctuation", () => {
	// The old normalizer used /[^\w\s]/g, which deleted the hyphen and joined
	// the words: an ASR's "forty-two" became "fortytwo".
	it("turns hyphens and slashes into a space, never nothing", () => {
		expect(normalizeForWER("forty-two")).toBe("forty two");
		expect(normalizeForWER("read/write")).toBe("read write");
		expect(normalizeForWER("state—of—the—art")).toBe("state of the art");
	});

	it("collapses whitespace and lowercases", () => {
		expect(normalizeForWER("  The   QUICK  fox. ")).toBe("the quick fox");
	});
});

describe("normalizeForWER — abbreviations", () => {
	it("expands honorifics with or without the period", () => {
		expect(normalizeForWER("Dr. Smith")).toBe("doctor smith");
		expect(normalizeForWER("Mr Jones")).toBe("mister jones");
		expect(normalizeForWER("Mrs. Patel")).toBe("missus patel");
		expect(normalizeForWER("Prof. Lee")).toBe("professor lee");
	});

	it("leaves St. alone on purpose — saint vs street is unresolvable", () => {
		// Guessing either way would introduce a NEW false failure, so the
		// reference and hypothesis are simply left to disagree by one word.
		expect(normalizeForWER("St. Paul")).toBe("st paul");
	});
});

describe("toWords", () => {
	it("returns an empty array for empty or punctuation-only input", () => {
		expect(toWords("")).toEqual([]);
		expect(toWords("   ")).toEqual([]);
		expect(toWords("...")).toEqual([]);
	});
});
