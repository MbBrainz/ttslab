/**
 * Blog metadata — the single source of truth for everything the index, the
 * post pages, the sitemap and the JSON-LD must agree on: slugs, titles, deks
 * and dates. Post bodies live in the pages that render them (repo convention:
 * limits, faq and about keep their content inline in the page file).
 */

export type BlogPostMeta = {
	slug: string;
	title: string;
	/** One-sentence standfirst shown on the index. */
	dek: string;
	/** Meta description (also the JSON-LD description). */
	description: string;
	keywords: string;
	/** ISO dates, YYYY-MM-DD. */
	datePublished: string;
	dateModified: string;
};

export const BLOG_POSTS: BlogPostMeta[] = [
	{
		slug: "underdog-woof-deep-dive",
		title:
			"Underdog Woof: the 40MB TTS that ships no runtime — and what porting it taught us",
		dek: "Underdog AI released a tiny TTS model with no runtime at all — numpy weights and a readable reference. We ported it to typed-array TypeScript, then to 22 hand-written WebGPU kernels. Here is what their approach gave us.",
		description:
			"Underdog's Woof is a 40 MB TTS model that ships numpy weights and a ~380-line readable reference instead of a runtime. We ported it to a typed-array TypeScript CPU backend (numerically exact against the numpy original) and 22 hand-written WGSL kernels over raw WebGPU — browser-verified CPU-vs-GPU correlation 0.9999998 on a fixed seed.",
		keywords:
			"Underdog Woof, TTS, text-to-speech, WebGPU, WebAssembly, WGSL, on-device AI, numpy port, MT19937, deterministic TTS, browser speech synthesis",
		datePublished: "2026-11-08",
		dateModified: "2026-11-08",
	},
];

export function getBlogPost(slug: string): BlogPostMeta | undefined {
	return BLOG_POSTS.find((post) => post.slug === slug);
}

export function blogPostPath(slug: string): string {
	return `/blog/${slug}`;
}
