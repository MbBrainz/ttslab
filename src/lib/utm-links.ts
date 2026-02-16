import { APP_URL } from "@/lib/constants";

const BASE = APP_URL;
const CAMPAIGN = "launch";
const MEDIUM = "social";

function buildUrl(source: string, path = "/") {
	const url = new URL(path, BASE);
	url.searchParams.set("utm_source", source);
	url.searchParams.set("utm_medium", MEDIUM);
	url.searchParams.set("utm_campaign", CAMPAIGN);
	return url.toString();
}

export const utmLinks = {
	twitter: buildUrl("twitter"),
	reddit: buildUrl("reddit"),
	hackerNews: buildUrl("hackernews"),
	productHunt: buildUrl("producthunt"),
	linkedin: buildUrl("linkedin"),
} as const;

/** Share text templates for different platforms. */
export const shareText = {
	twitter: `Test TTS & STT models right in your browser — no server, no data collection. ${utmLinks.twitter}`,
	reddit: utmLinks.reddit,
	hackerNews: utmLinks.hackerNews,
	linkedin: `Check out TTSLab — test text-to-speech and speech-to-text models directly in your browser with WebGPU. ${utmLinks.linkedin}`,
} as const;
