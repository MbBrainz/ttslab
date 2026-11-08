import type { Metadata } from "next";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { APP_NAME, APP_URL } from "@/lib/constants";
import { serializeJsonLd } from "@/lib/jsonld";

export const metadata: Metadata = {
	title: "FAQ — Browser TTS & STT, Privacy, WebGPU Support | TTSLab",
	description:
		"Frequently asked questions about TTSLab: how fully local in-browser TTS and STT works, which browsers support WebGPU, where model downloads are cached, voice cloning status, and why some models are unsupported.",
	alternates: {
		canonical: "/faq",
	},
};

type FaqEntry = {
	question: string;
	answer: string;
	/** Optional visible link rendered under the answer. */
	cta?: { href: string; label: string; external?: boolean };
};

const faqs: FaqEntry[] = [
	{
		question: "Does TTSLab send my text or audio to a server?",
		answer:
			"No. Every demo on this site runs the model inside your browser, in a Web Worker, through ONNX Runtime Web. Text you type is synthesized locally, microphone audio is recorded and transcribed locally, and nothing is uploaded — there is no inference API to send anything to. The site loads Vercel Analytics for anonymous page-view counting, but your text and audio never leave your device.",
	},
	{
		question: "How does the inference actually run — WebGPU or WASM?",
		answer:
			"Both, selected automatically. When you load a model, the app asks the browser for a GPU adapter (navigator.gpu). If one is available, ONNX Runtime Web runs the model on the WebGPU execution provider; if not, it falls back to the WebAssembly (CPU) backend. There is currently no manual toggle — the demo always uses the fastest backend your browser supports.",
	},
	{
		question: "Which browsers can run the WebGPU versions of the models?",
		answer:
			"Chrome and Edge 113+ (including Android 12+), Safari 26.0 and later on all Apple platforms (shipped September 15, 2025), and Firefox 141+ on Windows, 145+ on macOS, and 147+ on Apple-Silicon Macs. That is roughly 88.6% of browsers globally as of November 2026. The remaining gaps are Firefox on Linux and Android, Safari on Intel Macs, and Chrome on Windows ARM64.",
		cta: {
			href: "/limits",
			label: "See the full WebGPU and WebAssembly limits report",
		},
	},
	{
		question: "Why do models take so long to download the first time?",
		answer:
			"Model weights are real neural network files, downloaded from the Hugging Face CDN directly into your browser. They range from roughly 24 MB (KittenTTS Nano) to around 2 GB (Cohere Transcribe), so first load depends on your connection. This is the price of running the model on your device instead of on a server — and you only pay it once.",
	},
	{
		question:
			"Where are downloaded models stored, and how much space do they use?",
		answer:
			"Model files are stored in your browser's Cache API — the same storage a browser uses for static assets — so they do not appear in your Downloads folder. Quotas differ by browser: Chrome and Edge allow up to about 60% of free disk, Firefox about 10% of disk capped at 10 GiB, and Safari up to 60% but may evict unused site data after 7 days of no interaction unless the site has requested persistent storage. Clearing site data in your browser removes cached models.",
		cta: { href: "/limits", label: "Read about storage quotas and eviction" },
	},
	{
		question: "Why are some models marked 'unsupported'?",
		answer:
			"Because the model needs operations the browser runtime cannot execute. The clearest example is Chatterbox Multilingual: the ONNX spec requires INT64 tensors for its Shape and Unsqueeze ops, but the browser WebGPU backend currently has no INT64 cast kernel, so the model cannot run on the GPU — and it is impractically slow on CPU. Unsupported model pages stay live with an upvote button and an email notification so you can hear when support lands.",
	},
	{
		question: "Can I clone a voice?",
		answer:
			"Partially, and we are honest about it. SpeechT5 can take a speaker embedding extracted from about 10 seconds of your reference audio (via a ~100 MB WavLM model) and speak new text with it. In our testing with an independent speaker-verification model as judge, cloned output shifted the voice away from the default but did not actually resemble the reference speaker — it stayed inside the different-speaker band. So today cloning changes the voice; it does not clone the speaker.",
	},
	{
		question: "What is the Voice Agent?",
		answer:
			"The Voice Agent is a complete speech-to-speech assistant running on one page: Whisper transcribes your microphone input, a Qwen3.5 language model generates the reply, and Kokoro speaks it aloud. The LLM stage comes in three engine tiers of the same model family, so you pick the trade-off that fits your hardware: Qwen3.5-0.8B (~490 MB) runs through transformers.js on any backend — WebGPU when available, WASM otherwise; Qwen3.5-2B (~1.1 GB) and Qwen3.5-4B (~2.4 GB) run through WebLLM and need a WebGPU-capable GPU; and a CPU-only tier runs the 0.8B model as GGUF through wllama (~533 MB) with no GPU at all. All stages run locally in your browser — the microphone audio never leaves your device.",
		cta: { href: "/voice-agent", label: "Try the Voice Agent" },
	},
	{
		question: "Are upvotes anonymous?",
		answer:
			"Yes. Clicking an upvote button stores a small flag in your browser's localStorage and sends an anonymous POST request that increments a per-model counter. There is no account, no email, and no identifier attached — the server only ever sees that one more person voted. Toggling the vote again removes your flag and decrements the count.",
	},
	{
		question: "Does TTSLab work on iPhone or iPad?",
		answer:
			"Yes on recent systems: iOS and iPadOS 26 ship WebGPU, so the demos load in Safari. Be conservative with model size, though. Apple's mobile memory limits are strict — research into iOS Safari tab kills found the browser hard-terminates a tab at roughly 1.5 to 2 GB of committed memory (measured on an iPhone 15 Pro), with no JavaScript error or device.lost event beforehand. Prefer the smaller models (Moonshine Tiny, Kokoro 82M) on mobile.",
		cta: { href: "/limits", label: "Read the limits report" },
	},
	{
		question: "Is TTSLab free and open source?",
		answer:
			"Yes. TTSLab is MIT-licensed and the entire codebase — model integration, UI, database schema — is on GitHub. No accounts, no API keys, no paywall.",
		cta: {
			href: "https://github.com/MbBrainz/ttslab",
			label: "View the repository on GitHub",
			external: true,
		},
	},
	{
		question: "Can I trust the benchmark numbers on this site?",
		answer:
			"You should trust their provenance, not their portability. The benchmark page only lists measurements published by external sources, each with its citation, because in-browser performance depends heavily on your specific GPU, CPU, and browser. Every model page shows live metrics — real-time factor, generation speed — measured on your own hardware while you run the demo.",
		cta: { href: "/benchmark", label: "See the attributed benchmark table" },
	},
];

const faqJsonLd = {
	"@context": "https://schema.org",
	"@type": "FAQPage",
	mainEntity: faqs.map((faq) => ({
		"@type": "Question",
		name: faq.question,
		acceptedAnswer: {
			"@type": "Answer",
			text: faq.answer,
		},
	})),
};

const breadcrumbJsonLd = {
	"@context": "https://schema.org",
	"@type": "BreadcrumbList",
	itemListElement: [
		{
			"@type": "ListItem",
			position: 1,
			name: APP_NAME,
			item: APP_URL,
		},
		{
			"@type": "ListItem",
			position: 2,
			name: "FAQ",
			item: `${APP_URL}/faq`,
		},
	],
};

export default function FaqPage() {
	return (
		<div className="space-y-12">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }}
			/>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
			/>

			<section className="space-y-4">
				<h1 className="text-3xl font-bold tracking-tight">
					Frequently Asked Questions
				</h1>
				<p className="max-w-2xl text-lg text-muted-foreground">
					How {APP_NAME} runs TTS and STT models entirely in your browser, what
					it stores on your device, and where the limits are.
				</p>
			</section>

			<Separator />

			<div className="space-y-10">
				{faqs.map((faq) => (
					<section key={faq.question} className="space-y-3">
						<h2 className="text-xl font-semibold">{faq.question}</h2>
						<p className="max-w-2xl text-muted-foreground">{faq.answer}</p>
						{faq.cta &&
							(faq.cta.external ? (
								<a
									href={faq.cta.href}
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm text-primary hover:underline"
								>
									{faq.cta.label}
								</a>
							) : (
								<Link
									href={faq.cta.href}
									className="text-sm text-primary hover:underline"
								>
									{faq.cta.label}
								</Link>
							))}
					</section>
				))}
			</div>
		</div>
	);
}
