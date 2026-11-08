import type { Metadata } from "next";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { APP_NAME, APP_URL } from "@/lib/constants";
import { serializeJsonLd } from "@/lib/jsonld";

export const metadata: Metadata = {
	title:
		"The Limits of WebGPU & WebAssembly in the Browser (November 2026) | TTSLab",
	description:
		"A dated, sourced report on what WebGPU and WebAssembly can and cannot do in a browser tab in 2026: adapter coverage, spec ceilings, iOS Safari memory kills, 4 GiB WASM limits, storage eviction, and what they mean for on-device speech AI.",
	alternates: {
		canonical: "/limits",
	},
};

const jsonLd = {
	"@context": "https://schema.org",
	"@graph": [
		{
			"@type": "TechArticle",
			headline:
				"The Limits of WebGPU and WebAssembly in the Browser (November 2026)",
			description:
				"What WebGPU and WebAssembly can and cannot do in a browser tab as of November 2026: adapter coverage, memory ceilings, iOS tab kills, storage eviction, and the measured cost of running speech models client-side.",
			datePublished: "2026-11-08",
			dateModified: "2026-11-08",
			author: {
				"@type": "Organization",
				name: APP_NAME,
				url: APP_URL,
			},
			publisher: {
				"@type": "Organization",
				name: APP_NAME,
				url: APP_URL,
			},
			mainEntityOfPage: {
				"@type": "WebPage",
				"@id": `${APP_URL}/limits`,
			},
			about: [
				{
					"@type": "Thing",
					name: "WebGPU",
				},
				{
					"@type": "Thing",
					name: "WebAssembly",
				},
			],
			keywords:
				"WebGPU limits, WebAssembly limits, browser memory limits, on-device AI, WebGPU iOS Safari, memory64, storage quotas",
		},
		{
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
					name: "Limits of WebGPU and WebAssembly",
					item: `${APP_URL}/limits`,
				},
			],
		},
	],
};

type SourceLink = {
	label: string;
	href: string;
};

// Every source cited on this page. Rendered in the Sources section and
// referenced inline from the body.
const sources: Record<string, SourceLink> = {
	caniuse: {
		label: "caniuse, November 2026",
		href: "https://caniuse.com/webgpu",
	},
	chrome113: {
		label: "Chrome for Developers",
		href: "https://developer.chrome.com/blog/webgpu-release",
	},
	safari26: {
		label: "Safari 26.0 release notes",
		href: "https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes",
	},
	firefox141: {
		label: "Firefox 141 release notes",
		href: "https://www.mozilla.org/en-US/firefox/141.0/releasenotes/",
	},
	spec: {
		label: "W3C WebGPU spec",
		href: "https://www.w3.org/TR/webgpu/",
	},
	web3dsurvey: {
		label: "Web3D Survey",
		href: "https://web3dsurvey.com/webgpu",
	},
	gpuwebStatus: {
		label: "gpuweb implementation status",
		href: "https://github.com/gpuweb/gpuweb/wiki/Implementation-Status",
	},
	crashbox: {
		label: "nearform/crashbox",
		href: "https://github.com/nearform/crashbox",
	},
	wasmRoadmap: {
		label: "WebAssembly roadmap",
		href: "https://webassembly.org/roadmap/",
	},
	mdnSab: {
		label: "MDN SharedArrayBuffer",
		href: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer",
	},
	dispatchOverheadVulkan: {
		label: "arXiv 2604.02344",
		href: "https://arxiv.org/abs/2604.02344",
	},
	dispatchOverheadMetal: {
		label: "arXiv 2608.08730",
		href: "https://arxiv.org/abs/2608.08730",
	},
	tung: {
		label: "briantung.me",
		href: "https://briantung.me/blog/tts-engines-in-the-browser/",
	},
	webllm: {
		label: "arXiv 2412.15803",
		href: "https://arxiv.org/abs/2412.15803",
	},
	speculative: {
		label: "arXiv 2610.39761",
		href: "https://arxiv.org/abs/2610.39761",
	},
	quotas: {
		label: "MDN storage quotas",
		href: "https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria",
	},
	webkitEviction: {
		label: "WebKit blog",
		href: "https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/",
	},
	storagePersist: {
		label: "MDN storage.persist()",
		href: "https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist",
	},
	webnn: {
		label: "Chrome for Developers",
		href: "https://developer.chrome.com/docs/web-platform/webnn",
	},
	webnnStatus: {
		label: "WebNN status",
		href: "https://webmachinelearning.github.io/webnn-status/",
	},
};

function Source({ id }: { id: keyof typeof sources }) {
	const s = sources[id];
	return (
		<a
			href={s.href}
			target="_blank"
			rel="noopener noreferrer"
			className="text-primary hover:underline"
		>
			{s.label}
		</a>
	);
}

type TimelineItem = {
	date: string;
	title: string;
	body: React.ReactNode;
};

const timeline: TimelineItem[] = [
	{
		date: "Sep 15, 2025",
		title: "Safari ships WebGPU by default",
		body: (
			<>
				Safari 26.0 turned WebGPU on by default on macOS, iOS, iPadOS and
				visionOS — the last major engine to do so (
				<Source id="safari26" />
				).
			</>
		),
	},
	{
		date: "Sep 17, 2025",
		title: "Wasm 3.0 is finalized",
		body: (
			<>
				The WebAssembly Working Group completed Wasm 3.0, adding memory64,
				garbage collection and multi-memory to the standard (
				<Source id="wasmRoadmap" />
				).
			</>
		),
	},
	{
		date: "Aug 2026",
		title: "Subgroups land in Chromium only",
		body: (
			<>
				Chrome 151–152 shipped the subgroup-size-control feature, unlocking
				single-instruction parallel reductions in compute shaders. Safari and
				Firefox have not shipped it (
				<Source id="gpuwebStatus" />
				).
			</>
		),
	},
	{
		date: "Aug 2026",
		title: "WebNN origin trial closes",
		body: (
			<>
				Chrome's WebNN origin trial ended; the API remains flag-gated and is not
				production-ready (
				<Source id="webnn" />, <Source id="webnnStatus" />
				).
			</>
		),
	},
	{
		date: "Aug 2026",
		title: "Kokoro-82M, both backends, measured",
		body: (
			<>
				Published measurements put Kokoro-82M on an M1 Max at a 0.105 real-time
				factor over WebGPU and 2.002 over single-threaded WASM q8 — a 19× spread
				between the two backends on the same machine (
				<Source id="tung" />
				).
			</>
		),
	},
	{
		date: "Oct 2026",
		title: "Speculative decoding closes the LLM gap",
		body: (
			<>
				Research demonstrated 3.5–8.6× decode speedups over WebLLM in the
				browser using speculative decoding (
				<Source id="speculative" />
				).
			</>
		),
	},
	{
		date: "Nov 2026",
		title: "Coverage sits near 89%",
		body: (
			<>
				WebGPU is default-on in Chrome/Edge 113+ (every platform including
				Android 12+, since May 2023 — <Source id="chrome113" />
				), Safari 26.0+ on all Apple platforms, Firefox 141 on Windows (July
				2025 — <Source id="firefox141" />
				), Firefox 145 on macOS 26 Tahoe (Nov 2025) and Firefox 147 on all
				Apple-Silicon Macs (Jan 2026). That totals about 88.6% of browsers
				globally (
				<Source id="caniuse" />
				). The uncovered gaps: Firefox on Linux and Android, Safari on Intel
				Macs, Chrome on Windows ARM64.
			</>
		),
	},
];

const ceilings: {
	limit: string;
	def: string;
	reality: string;
	bites: string;
	source: keyof typeof sources;
}[] = [
	{
		limit: "GPU buffer size (maxBufferSize)",
		def: "256 MiB",
		reality: "Requestable up to 4 GiB on capable desktop GPUs",
		bites:
			"Model binaries above 256 MiB need multi-buffer loading on stock limits",
		source: "spec",
	},
	{
		limit: "Storage buffer binding (maxStorageBufferBindingSize)",
		def: "128 MiB",
		reality:
			"2 GiB or larger bindings on only about 16% of devices; mobile is the constraint",
		bites:
			"Large weight tensors must be split before they fit a single binding",
		source: "web3dsurvey",
	},
	{
		limit: "shader-f16",
		def: "Off",
		reality: "Supported on roughly 94% of adapters",
		bites: "Half-precision kernels fall back to f32 on the remainder",
		source: "web3dsurvey",
	},
	{
		limit: "Subgroups",
		def: "Off",
		reality: "Chromium-only (Chrome 151–152, Aug 2026); Safari and Firefox lag",
		bites:
			"Fast reductions and softmax kernels stay portable-CPU or slower paths elsewhere",
		source: "gpuwebStatus",
	},
	{
		limit: "timestamp-query",
		def: "Off",
		reality: "Chromium-skewed availability",
		bites:
			"GPU timing instrumentation is not portable, so in-browser profiling is approximate",
		source: "gpuwebStatus",
	},
	{
		limit: "Per-tab committed memory on iOS Safari",
		def: "Hard kill at roughly 1.5–2 GB (measured on iPhone 15 Pro)",
		reality: "The tab is terminated with no device.lost event and no JS error",
		bites:
			"GPU and WASM allocations share one per-tab budget; large models can silently die on load",
		source: "crashbox",
	},
	{
		limit: "wasm32 module memory",
		def: "4 GiB practical ceiling",
		reality: "32-bit pointers cap a single module at 4 GiB",
		bites: "Big quantized LLMs plus activation memory crowd the same 4 GiB",
		source: "wasmRoadmap",
	},
	{
		limit: "memory64 (Wasm 3.0)",
		def: "Spec-final since Sep 17, 2025",
		reality:
			"Chrome 133+, Firefox 134+, Safari only in the 27 line — and llama.cpp / wllama do not use it yet",
		bites:
			"The theoretical fix for the 4 GiB cap is not reachable from today's in-browser LLM engines",
		source: "wasmRoadmap",
	},
	{
		limit: "relaxed-simd",
		def: "Flag-only in Safari",
		reality: "Unflagged in Firefox 145 (Feb 2026); stable in Chromium",
		bites: "SIMD-optimized CPU kernels run slower on Safari's WASM engine",
		source: "wasmRoadmap",
	},
	{
		limit: "SharedArrayBuffer / WASM threads",
		def: "Requires cross-origin isolation",
		reality: "COOP + COEP headers are mandatory in every browser",
		bites:
			"This site sets COOP same-origin and COEP credentialless to enable threaded WASM",
		source: "mdnSab",
	},
	{
		limit: "Origin storage quota",
		def: "Chrome/Edge: about 60% of disk. Firefox: min(10% of disk, 10 GiB). Safari: up to 60%",
		reality:
			"Safari additionally evicts after 7 days without interaction unless storage is persisted",
		bites:
			"A 2 GB model cache can silently vanish on iOS — the reason users re-download models",
		source: "quotas",
	},
	{
		limit: "WebNN",
		def: "Not shipped",
		reality: "Origin trial closed Aug 2026; still flag-gated",
		bites: "No production NPU path in a browser tab yet",
		source: "webnn",
	},
];

export default function LimitsPage() {
	return (
		<div className="space-y-12">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
			/>

			{/* Intro */}
			<section className="space-y-4">
				<h1 className="text-3xl font-bold tracking-tight">
					The Limits of WebGPU and WebAssembly in the Browser
					<span className="text-muted-foreground"> (November 2026)</span>
				</h1>
				<p className="max-w-2xl text-lg text-muted-foreground">
					{APP_NAME} exists because voice AI can now run entirely in a browser
					tab: TTS, STT and a small LLM, no server, powered by WebGPU and
					WebAssembly. But the same platform limits that make this remarkable
					also define exactly where it stops working — which models run, which
					fall back to WASM, which are marked unsupported, and why your
					downloaded model can disappear. This page is the documented, sourced
					version of every limit the demos run into. Each claim links to its
					source; nothing here is invented.
				</p>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Last updated November 8, 2026.
				</p>
			</section>

			<Separator />

			{/* Timeline */}
			<section className="space-y-6">
				<h2 className="text-2xl font-semibold">
					What changed in the last 12 months
				</h2>
				<p className="max-w-2xl text-muted-foreground">
					2025–2026 closed most of the availability gap but almost none of the
					capability gap. Chronological, newest last:
				</p>
				<ol className="max-w-2xl space-y-6 border-l border-border pl-6">
					{timeline.map((item) => (
						// date alone is not unique (three items share "Aug 2026")
						<li
							key={`${item.date}-${item.title}`}
							className="relative space-y-1"
						>
							<span
								className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary"
								aria-hidden="true"
							/>
							<p className="text-sm font-medium text-primary">{item.date}</p>
							<h3 className="font-semibold">{item.title}</h3>
							<p className="text-sm text-muted-foreground">{item.body}</p>
						</li>
					))}
				</ol>
			</section>

			<Separator />

			{/* Hard ceilings table */}
			<section className="space-y-6">
				<h2 className="text-2xl font-semibold">The hard ceilings</h2>
				<p className="max-w-2xl text-muted-foreground">
					Defaults from the WebGPU spec are not ideals — they are the numbers
					your code gets unless the adapter proves it can do better, and some
					limits are not requestable at all.
				</p>
				<div className="overflow-x-auto">
					<table className="w-full min-w-[720px] border-collapse text-sm">
						<thead>
							<tr className="border-b border-border text-left">
								<th className="py-2 pr-4 font-semibold">Limit</th>
								<th className="py-2 pr-4 font-semibold">Default</th>
								<th className="py-2 pr-4 font-semibold">Reality / ceiling</th>
								<th className="py-2 pr-4 font-semibold">
									Where it bites this site
								</th>
								<th className="py-2 font-semibold">Source</th>
							</tr>
						</thead>
						<tbody>
							{ceilings.map((row) => (
								<tr
									key={row.limit}
									className="border-b border-border/50 align-top"
								>
									<td className="py-3 pr-4 font-medium">{row.limit}</td>
									<td className="py-3 pr-4 text-muted-foreground">{row.def}</td>
									<td className="py-3 pr-4 text-muted-foreground">
										{row.reality}
									</td>
									<td className="py-3 pr-4 text-muted-foreground">
										{row.bites}
									</td>
									<td className="py-3">
										<Source id={row.source} />
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<div className="max-w-2xl space-y-3 text-sm text-muted-foreground">
					<p>
						Why the buffer defaults matter: the spec presets every adapter at
						256 MiB for <code className="text-foreground">maxBufferSize</code>{" "}
						and 128 MiB for{" "}
						<code className="text-foreground">maxStorageBufferBindingSize</code>{" "}
						(<Source id="spec" />
						). An app can ask for up to 4 GiB on a capable desktop GPU, but
						telemetry shows storage bindings of 2 GiB or more exist on only
						about 16% of real devices, with mobile the dominant constraint (
						<Source id="web3dsurvey" />
						). This is why multi-GiB model weights are sharded rather than
						loaded as one buffer.
					</p>
					<p>
						On the CPU side, a wasm32 module still tops out at 4 GiB of linear
						memory (<Source id="wasmRoadmap" />
						). Wasm 3.0 — finalized September 17, 2025 with memory64, GC and
						multi-memory — is shipped in Chrome 133 and Firefox 134 but only in
						Safari's 27 line, and the engines people actually run in tabs
						(llama.cpp, wllama) do not use memory64 yet, so the practical
						ceiling stands (<Source id="wasmRoadmap" />
						). Meanwhile relaxed-simd, which accelerates quantized CPU kernels,
						was unflagged in Firefox 145 in February 2026 but remains flag-only
						in Safari (<Source id="wasmRoadmap" />
						). Threads via SharedArrayBuffer still require cross-origin
						isolation — COOP plus COEP — in every browser (
						<Source id="mdnSab" />
						); this site sets those headers site-wide for exactly that reason.
					</p>
					<p>
						The least forgiving limit is physical memory. On iOS, Safari
						hard-kills the tab when committed memory runs out — the GPU and WASM
						allocations share one per-tab budget — with no{" "}
						<code className="text-foreground">device.lost</code> event and no
						JavaScript error, at roughly 1.5–2 GB on an iPhone 15 Pro (
						<Source id="crashbox" />
						). A "large" model on a laptop is a crashed tab on a phone.
					</p>
					<p>
						And even when a model loads, browser storage is not a guarantee.
						Chrome and Edge grant origins about 60% of free disk, Firefox
						min(10% of disk, 10 GiB), Safari up to 60% — but Safari evicts
						non-persisted site data after 7 days without user interaction (
						<Source id="quotas" />, <Source id="webkitEviction" />
						). Requesting{" "}
						<code className="text-foreground">navigator.storage.persist()</code>{" "}
						(<Source id="storagePersist" />) protects a multi-gigabyte model
						cache from that sweep.
					</p>
				</div>
			</section>

			<Separator />

			{/* What this means for models */}
			<section className="space-y-6">
				<h2 className="text-2xl font-semibold">
					What this means for the models on this site
				</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						<strong className="text-foreground">
							The backend gap is a 19× performance gap, not a rounding error.
						</strong>{" "}
						Kokoro-82M on an M1 Max runs at a real-time factor of 0.105 over
						WebGPU — about 9.5× faster than real time — while the
						single-threaded WASM q8 fallback on the same machine measures 2.002,
						i.e. half real time (<Source id="tung" />
						). Every TTSLab demo auto-selects WebGPU when the browser offers it,
						and falls back to WASM when it does not; that fallback is audibly
						slower on exactly the devices (Linux, older Safari) WebGPU has not
						reached (<Source id="caniuse" />
						).
					</p>
					<p>
						<strong className="text-foreground">
							Missing kernels block whole models.
						</strong>{" "}
						Chatterbox Multilingual is marked unsupported here because the ONNX
						spec requires INT64 tensors for its Shape and Unsqueeze operations,
						and the browser WebGPU backend has no INT64 cast kernel — the model
						cannot run on the GPU at all. This is an ecosystem gap, not a
						property of the model; when browsers add the kernel, the model
						unlocks.
					</p>
					<p>
						<strong className="text-foreground">
							LLMs run, at a measurable discount to native.
						</strong>{" "}
						The WebLLM paper measures Llama-3.1-8B at 41.1 tokens per second on
						an M3 Max in-browser — roughly 71% of native Metal performance on
						the same hardware (<Source id="webllm" />
						). Per-dispatch CPU-side overhead of 24–36 µs on Vulkan and 32–71 µs
						on Metal at batch size 1 (<Source id="dispatchOverheadVulkan" />,{" "}
						<Source id="dispatchOverheadMetal" />) is a large part of why small
						models with fewer, larger kernels fare better in a tab. Speculative
						decoding research shows 3.5–8.6× faster WebLLM decode is reachable
						without changing the platform (
						<Source id="speculative" />
						).
					</p>
					<p>
						<strong className="text-foreground">
							Memory and storage limits decide mobile behavior.
						</strong>{" "}
						The iOS per-tab kill radius (<Source id="crashbox" />) and Safari's
						7-day storage eviction (<Source id="quotas" />) are why we recommend
						Moonshine Tiny or Kokoro on phones, and why a model you downloaded
						last week may need re-downloading today.
					</p>
					<p>
						<strong className="text-foreground">
							WebNN is not a rescue yet.
						</strong>{" "}
						A native NPU API would sidestep most of the ceilings above, but
						Chrome's WebNN origin trial closed in August 2026 and the API
						remains flag-gated (<Source id="webnn" />,{" "}
						<Source id="webnnStatus" />
						). Nothing on this site depends on it.
					</p>
				</div>
			</section>

			<Separator />

			{/* Sources */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">Sources</h2>
				<ul className="max-w-2xl list-inside list-disc space-y-2 text-sm">
					{Object.values(sources).map((s) => (
						<li key={s.href}>
							<a
								href={s.href}
								target="_blank"
								rel="noopener noreferrer"
								className="text-primary hover:underline"
							>
								{s.label}
							</a>{" "}
							<span className="text-muted-foreground">— {s.href}</span>
						</li>
					))}
				</ul>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Run the demos yourself on{" "}
					<Link href="/models" className="text-primary hover:underline">
						the models page
					</Link>{" "}
					to see where your own hardware lands against these ceilings.
				</p>
			</section>
		</div>
	);
}
