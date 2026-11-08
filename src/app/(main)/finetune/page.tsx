import type { Metadata } from "next";
import Link from "next/link";
import { FinetuneLab } from "@/components/finetune/finetune-lab";
import { Separator } from "@/components/ui/separator";
import { APP_NAME, APP_URL } from "@/lib/constants";
import { FT_KERNEL_COUNT } from "@/lib/finetune/kernels";
import { PARAM_COUNT } from "@/lib/finetune/mlp";
import { BATCH_SIZE } from "@/lib/finetune/tasks";
import { serializeJsonLd } from "@/lib/jsonld";

export const metadata: Metadata = {
	title:
		"Fine-tune a neural net in your browser on WebGPU — TTSLab Finetune Lab",
	description:
		"Finetune Lab: a real gradient-descent training loop running on your GPU in a browser tab — 9 hand-written WGSL kernels, forward + backprop + Adam, live loss curve and weight histogram. Today: proof of the pipeline. Roadmap: LoRA-style adaptation of tiny speech models, fully in-browser.",
	alternates: {
		canonical: "/finetune",
	},
};

const jsonLd = {
	"@context": "https://schema.org",
	"@graph": [
		{
			"@type": "WebApplication",
			name: "TTSLab Finetune Lab",
			url: `${APP_URL}/finetune`,
			description:
				"A from-scratch neural network (16-64-64-1 MLP, 5313 parameters) trained with real gradient descent on the visitor's GPU via hand-written WebGPU compute kernels: forward pass, backpropagation and Adam, with a live loss chart, curve fit and weight histogram.",
			applicationCategory: "EducationalApplication",
			operatingSystem:
				"Any browser with WebGPU (Chrome/Edge 113+, Safari 26+, Firefox 141+)",
			offers: {
				"@type": "Offer",
				price: "0",
				priceCurrency: "USD",
			},
			author: {
				"@type": "Organization",
				name: APP_NAME,
				url: APP_URL,
			},
			browserRequirements: "Requires WebGPU. No CPU fallback in v1.",
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
					name: "Finetune Lab",
					item: `${APP_URL}/finetune`,
				},
			],
		},
	],
};

const kernels: Array<{ name: string; role: string; uses: string }> = [
	{
		name: "ft_mm",
		role: "fp32 matmul",
		uses: "all 3 forward layers — one workgroup per (output, token), shared-memory tree reduction",
	},
	{
		name: "ft_tanh",
		role: "activation",
		uses: "in-place tanh after layers 1 and 2",
	},
	{
		name: "ft_mse_delta",
		role: "output delta",
		uses: "mean-squared-error deltas plus per-sample errors in one pass",
	},
	{
		name: "ft_wgrad",
		role: "weight gradients",
		uses: "6 dispatches: every weight and bias gradient, reduced over the batch",
	},
	{
		name: "ft_dgrad",
		role: "layer gradients",
		uses: "backprop into each hidden layer through the transposed weights",
	},
	{
		name: "ft_tanh_bwd",
		role: "chain rule",
		uses: "multiplies deltas by sech², the tanh derivative",
	},
	{
		name: "ft_adam",
		role: "optimizer",
		uses: "full Adam update (bias-corrected) — 6 dispatches, one per parameter tensor",
	},
	{
		name: "ft_sqnorm",
		role: "diagnostics",
		uses: "gradient sum-of-squares reduction for the live gradient norm",
	},
	{
		name: "ft_histogram",
		role: "diagnostics",
		uses: "atomicAdd 32-bin weight histogram for the 'weights visibly move' chart",
	},
];

export default function FinetunePage() {
	return (
		<div className="space-y-12">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
			/>

			{/* Intro */}
			<section className="space-y-4">
				<h1 className="text-3xl font-bold tracking-tight">
					Finetune Lab — a real training loop on your GPU
					<span className="text-muted-foreground"> (proof, not a product)</span>
				</h1>
				<p className="max-w-2xl text-lg text-muted-foreground">
					Today: proof. Roadmap: LoRA-style adaptation of tiny speech models,
					fully in-browser. Below, a from-scratch neural net trains with real
					gradient descent — forward pass, backpropagation, Adam — on{" "}
					<em>your</em> GPU through {FT_KERNEL_COUNT} hand-written WGSL compute
					kernels. Weights visibly move, loss visibly falls. Nothing is
					uploaded; there is no server in the loop.
				</p>
				<p className="max-w-2xl text-sm text-muted-foreground">
					Honesty first: this page never implies we fine-tune Woof or any TTS
					model today. What trains here is a deliberately tiny toy task that
					exercises exactly the machinery in-browser speech-model fine-tuning
					will need.
				</p>
			</section>

			<Separator />

			{/* The demo */}
			<section className="space-y-6">
				<h2 className="text-2xl font-semibold">The lab</h2>
				<FinetuneLab />
			</section>

			<Separator />

			{/* How it works */}
			<section className="space-y-6">
				<h2 className="text-2xl font-semibold">How it works</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						The model is a 16 → 64 → 64 → 1 tanh MLP —{" "}
						{PARAM_COUNT.toLocaleString("en-US")} trainable parameters,
						Glorot-initialized from a fixed seed. It fits one period of a wave
						you pick (sine, square, triangle) over a full batch of {BATCH_SIZE}{" "}
						samples. Inputs pass through a fixed Fourier feature map (8 sin/cos
						pairs) — a disclosed, non-trainable input encoding that simply makes
						the fit converge fast enough to watch in real time. Optimization is
						genuine full-batch gradient descent with Adam (β₁ 0.9, β₂ 0.999).
					</p>
					<p>
						Like our{" "}
						<Link
							href="/models/woof-tts"
							className="text-primary underline underline-offset-2"
						>
							Woof WebGPU backend
						</Link>{" "}
						(22 kernels), everything runs over the raw WebGPU API — no ML
						framework, no ONNX Runtime, no dependency. But where Woof's kernels
						only <em>run</em> a frozen network, these {FT_KERNEL_COUNT} kernels{" "}
						<em>train</em> one: 22 dispatches per step flow forward, compute
						every weight's gradient by backpropagation, apply Adam, and read
						diagnostics back once per frame. Gradients are overwritten (never
						accumulated) by exactly one dispatch each, so no zeroing pass is
						needed between steps.
					</p>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full min-w-[640px] border-collapse text-sm">
						<thead>
							<tr className="border-b border-border text-left">
								<th className="py-2 pr-4 font-semibold">Kernel</th>
								<th className="py-2 pr-4 font-semibold">Role</th>
								<th className="py-2 font-semibold">What it does</th>
							</tr>
						</thead>
						<tbody>
							{kernels.map((k) => (
								<tr
									key={k.name}
									className="border-b border-border/50 align-top"
								>
									<td className="py-2.5 pr-4 font-mono text-xs">{k.name}</td>
									<td className="py-2.5 pr-4 text-muted-foreground">
										{k.role}
									</td>
									<td className="py-2.5 text-muted-foreground">{k.uses}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<Separator />

			{/* Verification status — honest */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">Verified status (honest)</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						The training math is unit-tested end to end in Node against a mocked
						GPU device: the CPU reference trainer passes a finite-difference
						gradient check (analytic backprop ≡ numerical derivatives) and a
						real CPU training run, the dispatch plans are asserted
						kernel-by-kernel against the WGSL binding surfaces, and a seeded run
						is bit-reproducible. The WGSL kernels themselves follow the same
						dispatch, buffer and reduction patterns as the browser-verified Woof
						GPU backend, but a headed-browser training run of this page is
						pending — the strongest proof is the demo above: if the loss falls
						in front of you, your GPU just ran real backprop. If it doesn't,
						that's a bug and{" "}
						<Link
							href="/contribute"
							className="text-primary underline underline-offset-2"
						>
							we'd want to hear about it
						</Link>
						.
					</p>
					<p>
						Robustness is part of the contract, not an afterthought: no WebGPU
						means a clear message with no CPU fallback (a typed-array trainer
						would be orders of magnitude slower and prove nothing about the GPU
						pipeline), device loss is caught and surfaced as a graceful reset,
						every GPU wait is time-bounded, and steps per animation frame are
						capped so the tab stays responsive.
					</p>
				</div>
			</section>

			<Separator />

			{/* Roadmap */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">Roadmap: from toy to speech</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						<strong className="text-foreground">
							Shipped today: the proof.
						</strong>{" "}
						A real GPU training loop in a tab — sequential compute passes with
						inter-pass memory coherence, per-step uniform updates, GPU-to-CPU
						readbacks without stalling the frame loop, weight histogramming via
						atomics, device-lost recovery.
					</p>
					<p>
						<strong className="text-foreground">
							Next (roadmap, not shipped): LoRA-style adaptation of tiny speech
							models, fully in-browser.
						</strong>{" "}
						The idea: freeze a small model's weights on your GPU, train only
						tiny low-rank adapter matrices on data that never leaves your
						device, and keep the base weights read-only in memory. The training
						loop above is the piece that has to exist first.
					</p>
					<p>
						<strong className="text-foreground">
							Why not fine-tune Woof or Kokoro today?
						</strong>{" "}
						Memory ceilings, mostly. A browser tab shares one budget between GPU
						and CPU allocations — iOS Safari hard-kills tabs around 1.5–2 GB,
						storage bindings are capped at 128 MiB by default, and optimizer
						states (Adam alone triples weight memory) multiply everything.
						Fine-tuning even a "tiny" TTS model naively blows through those
						numbers on phones. The full accounting, with sources, is in{" "}
						<Link
							href="/limits"
							className="text-primary underline underline-offset-2"
						>
							the limits report
						</Link>
						, and the story of the smallest speech model we do run is in{" "}
						<Link
							href="/blog/underdog-woof-deep-dive"
							className="text-primary underline underline-offset-2"
						>
							Underdog Woof: a deep dive
						</Link>
						.
					</p>
				</div>
			</section>
		</div>
	);
}
