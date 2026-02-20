import { Github } from "lucide-react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SubscribeForm } from "@/components/subscribe-form";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = {
	title: "Contribute a TTS or STT Model — Add Your Model to TTSLab",
	description: `Submit your ONNX-exported text-to-speech or speech-to-text model to ${APP_NAME}. Make it available for in-browser testing and comparison. Open source, MIT licensed.`,
};

export default function ContributePage() {
	return (
		<div className="space-y-12">
			<section className="space-y-4">
				<div className="flex items-center gap-3">
					<h1 className="text-3xl font-bold tracking-tight">
						Contribute a Model
					</h1>
					<Badge variant="secondary">Coming Soon</Badge>
				</div>
				<p className="max-w-2xl text-lg text-muted-foreground">
					Help grow the {APP_NAME} model directory. Submit your ONNX-exported
					TTS or STT model and make it available for browser-based testing.
				</p>
			</section>

			<Separator />

			<section className="space-y-6">
				<h2 className="text-2xl font-semibold">How It Will Work</h2>
				<div className="grid gap-6 sm:grid-cols-2">
					<Card>
						<CardHeader>
							<div className="flex items-center gap-3">
								<span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
									1
								</span>
								<CardTitle>Export to ONNX</CardTitle>
							</div>
						</CardHeader>
						<CardContent>
							<CardDescription>
								Convert your model to ONNX format for efficient browser-based
								inference. We provide guides for common frameworks like PyTorch
								and TensorFlow.
							</CardDescription>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<div className="flex items-center gap-3">
								<span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
									2
								</span>
								<CardTitle>Upload to HuggingFace</CardTitle>
							</div>
						</CardHeader>
						<CardContent>
							<CardDescription>
								Host your model weights on HuggingFace. This ensures reliable,
								fast downloads and makes your model accessible to the community.
							</CardDescription>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<div className="flex items-center gap-3">
								<span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
									3
								</span>
								<CardTitle>Submit via Form</CardTitle>
							</div>
						</CardHeader>
						<CardContent>
							<CardDescription>
								Fill in your model metadata and configuration — name, type (TTS
								or STT), supported languages, voice options, and HuggingFace
								repo URL.
							</CardDescription>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<div className="flex items-center gap-3">
								<span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
									4
								</span>
								<CardTitle>Auto-Validation</CardTitle>
							</div>
						</CardHeader>
						<CardContent>
							<CardDescription>
								We automatically test that your model loads and runs correctly in
								the browser. Once validated, it appears in the model directory.
							</CardDescription>
						</CardContent>
					</Card>
				</div>
			</section>

			<Separator />

			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">Early Contributors</h2>
				<p className="max-w-2xl text-muted-foreground">
					Can&apos;t wait for the contribution portal? Open a GitHub issue with
					your model details and we&apos;ll work with you to add it manually.
				</p>
				<a
					href="https://github.com/MbBrainz/ttslab/issues"
					target="_blank"
					rel="noopener noreferrer"
					className={`${buttonVariants({ variant: "outline" })} gap-2`}
				>
					<Github className="h-4 w-4" />
					Open a GitHub Issue
				</a>
			</section>

			<Separator />

			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">Get Notified</h2>
				<p className="max-w-2xl text-muted-foreground">
					Subscribe to be the first to know when the contribution portal
					launches.
				</p>
				<div className="max-w-md">
					<SubscribeForm comparisonSlug="contribute-updates" />
				</div>
			</section>
		</div>
	);
}
