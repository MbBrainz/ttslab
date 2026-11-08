import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import {
	BLOG_POSTS,
	type BlogPostMeta,
	blogPostPath,
	getBlogPost,
} from "@/lib/blog-posts";
import { APP_NAME, APP_URL } from "@/lib/constants";
import { serializeJsonLd } from "@/lib/jsonld";

export const revalidate = false;
// All blog slugs are prerendered via generateStaticParams; unknown paths get a
// static 404 instead of an on-demand render. Keeps Vercel compute near zero.
export const dynamicParams = false;

type PageProps = {
	params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
	return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { slug } = await params;
	const post = getBlogPost(slug);

	if (!post) {
		return { title: "Post Not Found" };
	}

	return {
		title: `${post.title} | ${APP_NAME}`,
		description: post.description,
		alternates: {
			canonical: blogPostPath(post.slug),
		},
		openGraph: {
			title: post.title,
			description: post.description,
			url: `${APP_URL}${blogPostPath(post.slug)}`,
			siteName: APP_NAME,
			type: "article",
			publishedTime: post.datePublished,
			modifiedTime: post.dateModified,
		},
	};
}

// Every external source cited in the post, referenced inline from the body.
const LINKS = {
	announcement: "https://x.com/UnderdogAI/status/2118921155713372212",
	landing: "https://underdog.ai/woof",
	techcrunch:
		"https://techcrunch.com/2026/11/06/underdog-shows-off-a-32mb-speech-model-in-new-demo",
	repo: "https://huggingface.co/ConwayResearch/Underdog-Woof",
} as const;

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="text-primary hover:underline"
		>
			{children}
		</a>
	);
}

function buildJsonLd(post: BlogPostMeta) {
	const url = `${APP_URL}${blogPostPath(post.slug)}`;
	return {
		"@context": "https://schema.org",
		"@graph": [
			{
				"@type": "BlogPosting",
				headline: post.title,
				description: post.description,
				datePublished: post.datePublished,
				dateModified: post.dateModified,
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
					"@id": url,
				},
				about: [
					{
						"@type": "SoftwareApplication",
						name: "Underdog Woof",
						applicationCategory: "MultimediaApplication",
						operatingSystem: "Web browser",
					},
				],
				mentions: [
					{
						"@type": "Thing",
						name: "Underdog Woof",
					},
					{
						"@type": "Thing",
						name: "WebGPU",
					},
					{
						"@type": "Thing",
						name: "WebAssembly",
					},
				],
				keywords: post.keywords,
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
						name: "Blog",
						item: `${APP_URL}/blog`,
					},
					{
						"@type": "ListItem",
						position: 3,
						name: post.title,
						item: url,
					},
				],
			},
		],
	};
}

export default async function BlogPostPage({ params }: PageProps) {
	const { slug } = await params;
	const post = getBlogPost(slug);
	if (!post) {
		notFound();
	}

	const date = new Date(`${post.datePublished}T00:00:00Z`).toLocaleDateString(
		"en-US",
		{ year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
	);

	return (
		<div className="space-y-12">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{
					__html: serializeJsonLd(buildJsonLd(post)),
				}}
			/>

			{/* Intro */}
			<section className="space-y-4">
				<p className="text-sm font-medium text-primary">{date}</p>
				<h1 className="max-w-3xl text-3xl font-bold tracking-tight">
					{post.title}
				</h1>
				<p className="max-w-2xl text-lg text-muted-foreground">{post.dek}</p>
			</section>

			<Separator />

			<section className="space-y-4">
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						On November 7, 2026, Underdog AI released Woof, a text-to-speech
						model small enough to email — and, per Underdog&rsquo;s own evals,
						one of the most accurate small TTS systems ever published. We have
						no affiliation with Underdog; {APP_NAME} is an independent,
						open-source browser lab for voice models. Woof earned this write-up
						for a reason that has nothing to do with its claimed numbers: the
						release ships no runtime. No ONNX graph, no WASM engine, no
						inference library. Numpy arrays and a ~380-line Python reference,
						published on Underdog&rsquo;s own Hugging Face org (
						<Ext href={LINKS.repo}>ConwayResearch/Underdog-Woof</Ext>).
					</p>
					<p>
						We ported it anyway — first to a typed-array TypeScript runtime,
						then to 22 hand-written WGSL compute kernels over raw WebGPU. Both
						run in the Woof demo on {APP_NAME} today, and the two agree to a
						Pearson correlation of 0.9999998 in the browser. What follows is our
						appreciation of what Underdog built, and an honest account of what
						meeting it in the browser took.
					</p>
				</div>
			</section>

			<Separator />

			{/* The release */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">The release, in numbers</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						Woof comes in two published configurations (
						<Ext href={LINKS.announcement}>announcement</Ext>,{" "}
						<Ext href={LINKS.landing}>landing page</Ext>): a one-voice model,
						isla, at 30.7M parameters and 31.7 MB, and a two-voice model — juno
						and mira, the pair we ship — at 38.2M parameters and 40.6 MB.
						Underdog&rsquo;s announcement claims a word error rate of
						1.42&ndash;2.06% on a set of hard sentences — per Underdog&rsquo;s
						evals, which we have not independently reproduced — and 13 seconds
						of speech synthesized in 0.73 seconds on a single CPU thread.{" "}
						<Ext href={LINKS.techcrunch}>TechCrunch</Ext> wrote up the demo on
						November 6, the day before the release post.
					</p>
					<p>
						For calibration: the two-voice 40.6 MB file is the second-smallest
						download in our catalog. Most of what we run is hundreds of
						megabytes; a few models top 2 GB. A TTS with claims like these,
						small enough to arrive before a coffee does, is rare enough that we
						read the repository twice.
					</p>
				</div>
			</section>

			<Separator />

			{/* The reference */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">
					The radical part: they shipped a spec
				</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						Most model releases ship a checkpoint and leave the plumbing to the
						ecosystem: ONNX exports, conversion scripts, runtime bindings, a
						README of version pins. Woof ships none of that. The Hugging Face
						repo is a set of numpy arrays and one ~380-line Python file —{" "}
						<code className="text-foreground">underdog_woof/runtime.py</code> —
						that reads them and speaks.
					</p>
					<p>
						We think this is the most underrated decision in the release. A
						readable reference implementation is a spec — an executable one. The
						char-level vocabulary, the RoPE transformer, the flow-head decode
						loop, the SEANet vocoder, the exact defaults for temperature and
						end-of-sequence gating: all of it sits in ~380 lines of numpy that
						fit in your head. There is no ambiguity about which operation goes
						where, because the operations are right there, in the order they
						run. Reverse-engineering an exported compute graph costs weeks
						before a single line of a port gets written; the reference saved us
						all of it.
					</p>
				</div>
			</section>

			<Separator />

			{/* The port */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">
					Porting it: the reference doubles as an oracle
				</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						We ported <code className="text-foreground">runtime.py</code> to
						TypeScript — plain typed-array loops, no native code — one stage at
						a time, and after each stage compared our intermediate tensors
						against the numpy original. Final agreement: correlation
						+1.00000000, at every stage.
					</p>
					<p>
						That sentence is the best part of this story, because of everything
						it ruled out. Our port compiled cleanly under TypeScript strict
						mode, and four real bugs still made it through. The stage-by-stage
						oracle comparison caught every one:
					</p>
				</div>
				<ol className="max-w-2xl list-inside list-decimal space-y-3 text-muted-foreground">
					<li>
						<strong className="text-foreground">
							An MT19937 tempering shift.
						</strong>{" "}
						Woof&rsquo;s decoder generates audio frame by frame from seeded
						Gaussian noise, drawn from a torch-compatible MT19937 stream. Our
						first implementation tempered the generator&rsquo;s raw output with
						one bit-shift in the wrong place. The result was a smooth, plausible
						stream of noise — just not the specified one. Nothing downstream
						crashes; the audio merely is not the audio the seed promises. The
						correlation check caught it at the first stage that consumes noise.
					</li>
					<li>
						<strong className="text-foreground">
							A RoPE key offset applied twice.
						</strong>{" "}
						The rotary position embedding added the key-side position offset two
						times, so attention scored every position against a skewed index.
						Subtly wrong attention degrades prosody; it never throws an
						exception.
					</li>
					<li>
						<strong className="text-foreground">An in-place layernorm.</strong>{" "}
						NumPy is functional by default — operations return new arrays. Our
						typed-array port normalized its input in place, silently mutating a
						residual the decoder still needed two layers later. This is the
						classic hazard of porting immutable-by-default code to mutable
						arrays, and it corrupts output without touching any error path.
					</li>
					<li>
						<strong className="text-foreground">
							A conv-transpose orientation.
						</strong>{" "}
						The SEANet vocoder&rsquo;s transposed convolutions store their
						weights in a shape numpy reshapes without ceremony; our first read
						had the matrix orientation wrong. Shapes still lined up; the vocoder
						just reconstructed the wrong signal.
					</li>
				</ol>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						Every one of those four bugs passes a compiler and produces audio
						that sounds like speech. Only an exact oracle separates a working
						port from a correct one — and the reference being short enough to
						execute stage by stage is what made that oracle free. We could claim
						numerical exactness rather than &ldquo;seems fine&rdquo;, which is a
						claim most ports of weight files never get to make.
					</p>
				</div>
			</section>

			<Separator />

			{/* The WebGPU backend */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">
					The second backend: 22 WGSL kernels, int8 in registers
				</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						Exactness is not speed. The typed-array path rendered our test
						sentence in about 6.1 seconds on our dev machine (Apple Silicon,
						measured 2026-11-08) — real, but not demo-snappy. So we built a
						second backend: 22 hand-written WGSL compute kernels driving raw
						WebGPU directly, no ONNX Runtime and no engine — the same reason
						Underdog skipped a runtime on the CPU side. We are not the first to
						make this choice in front of this model: Underdog&rsquo;s own
						browser demo bundle runs 19 WGSL compute kernels, and we cite that
						work as the lineage for our kernel decomposition — their structure,
						our own WGSL and TypeScript throughout.
					</p>
					<p>
						Two decisions carry the backend. First,{" "}
						<strong className="text-foreground">
							weights stay int8-packed on the GPU and are dequantized in
							registers
						</strong>{" "}
						inside the matmul and convolution kernels. Dequantizing the 40 MB
						file into fp32 buffers would transiently cost roughly 250 MB of
						JavaScript heap — comfortably into the range where iOS Safari
						hard-kills a tab with no error (our{" "}
						<Link href="/limits" className="text-primary hover:underline">
							limits report
						</Link>{" "}
						has the numbers). Packed, peak heap stays at about the download
						size. On a phone, that decision is the difference between the model
						running and not running.
					</p>
					<p>
						Second, the decode loop steps frames in small batches with a single
						end-of-sequence readback per batch, and positions travel through a
						small storage buffer so every dispatch plan is built once and
						cached. Per batch, only noise and positions cross the CPU/GPU
						boundary.
					</p>
					<p>
						Verified in the browser on 2026-11-08: same sentence, same voice,
						same seed through both backends — Pearson correlation 0.9999998
						(bit-exactness across backends is not expected; floating-point
						accumulation order differs), identical frame counts, and about 0.19
						seconds of GPU time against about 6.1 seconds on the typed-array
						path — roughly 31x. Those are our numbers: one sentence, one Apple
						Silicon dev machine. They are a port-verification result, not a
						benchmark of Underdog&rsquo;s model, and your hardware will differ.
					</p>
				</div>
			</section>

			<Separator />

			{/* Determinism */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">
					Determinism you can put in a link
				</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						Both backends draw their noise from the same torch-compatible
						MT19937 stream, generated on the CPU and uploaded to the GPU. Same
						text, same voice, same seed, either backend: identical audio. On a
						demo site that is a feature, not a detail — &ldquo;can you render
						that again?&rdquo; becomes a URL that renders exactly that again.
						Deterministic generation is one of the quiet benefits of small
						on-device models, and it only holds because the random stream is
						part of the published spec rather than a hidden implementation
						detail.
					</p>
				</div>
			</section>

			<Separator />

			{/* What we did not port */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">What we did not port</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>Three gaps, all deliberate:</p>
					<ul className="list-inside list-disc space-y-2">
						<li>
							<strong className="text-foreground">The text normalizer.</strong>{" "}
							Underdog&rsquo;s{" "}
							<code className="text-foreground">normalize.py</code> is roughly
							48 KB of rules that expand numbers, dates and prices into spoken
							words, and the model was trained on normalized text. We did not
							port it, so our demo asks for spelled-out text (&ldquo;twenty-five
							dollars&rdquo;, not &ldquo;$25&rdquo;); digits may be read oddly.
							It is the main quality gap between our port and the reference
							experience.
						</li>
						<li>
							<strong className="text-foreground">Streaming.</strong> We render
							whole text pieces and concatenate; the reference&rsquo;s streaming
							modes are not implemented.
						</li>
						<li>
							<strong className="text-foreground">Take-retry.</strong> The
							reference detects stalled takes and retries them; we render a
							single take per piece.
						</li>
					</ul>
					<p>
						None of these are mysteries. Because the spec exists, each is a
						well-scoped to-do with the answer already written down in Python.
						That is what a shipped reference does to ambiguity.
					</p>
				</div>
			</section>

			<Separator />

			{/* License */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">The license, stated plainly</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						Woof is not open-licensed in the MIT sense, and anyone building on
						it should know exactly what applies. The Hugging Face repo — weights
						and reference code — carries the{" "}
						<Ext href={LINKS.repo}>Underdog Non-Commercial License 1.0</Ext>.
						Underdog&rsquo;s <Ext href={LINKS.landing}>landing page</Ext> names
						CC BY-NC 4.0 instead. We are not lawyers and offer no resolution
						between the two documents; we note both as published and build to
						the stricter reading. What both agree on: free for non-commercial
						use with credit, commercial use by arrangement —{" "}
						<Ext href="mailto:license@conway.tech">license@conway.tech</Ext>.
						{APP_NAME} is a non-commercial lab, and the Woof model page carries
						the required &ldquo;Voice by Underdog Woof&rdquo; credit.
					</p>
				</div>
			</section>

			<Separator />

			{/* Try it */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">Hear it</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						Woof runs in your browser at{" "}
						<Link
							href="/models/woof-tts"
							className="text-primary hover:underline"
						>
							ttslab.dev/models/woof-tts
						</Link>{" "}
						— the typed-array path everywhere, the WGSL path wherever your
						browser offers WebGPU. For the platform context this port lives in —
						what a browser tab can and cannot do for on-device speech — read the{" "}
						<Link href="/limits" className="text-primary hover:underline">
							limits report
						</Link>
						, and for what the timing numbers above do and do not mean, the{" "}
						<Link href="/benchmark" className="text-primary hover:underline">
							benchmark page
						</Link>{" "}
						explains why we do not publish leaderboard claims from a single
						machine.
					</p>
				</div>
			</section>

			<Separator />

			{/* Appreciation */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">Why we appreciate this</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						It would have been easier for Underdog to ship an ONNX export and a
						pip package. Instead they shipped a model small enough to be
						everywhere and a reference readable enough to be rebuilt anywhere —
						including inside a browser tab, with no runtime vendor in the loop.
						The reference made our port exact instead of approximate; the small
						size made it loadable instead of aspirational; the determinism made
						it demoable; the license made our obligations a paragraph instead of
						a debate.
					</p>
					<p>
						Small models, readable references, on-device inference: we built a
						whole site on that bet, and it is good to see a model lab bet the
						same way. We are fans of what they built — and we did the
						engineering to meet it in the browser, which is, we think, the
						highest form of appreciation available to a lab like ours.
					</p>
				</div>
			</section>
		</div>
	);
}
