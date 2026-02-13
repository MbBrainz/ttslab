"use client";

import { Loader2, Volume2 } from "lucide-react";
import { useCallback, useState } from "react";
import { AudioPlayer } from "@/components/audio-player";
import { GenerationHistory } from "@/components/generation-history";
import { type ModelState, ModelStatus } from "@/components/model-status";
import { addRecentText, RecentTexts } from "@/components/recent-texts";
import { Button } from "@/components/ui/button";
import { Select, SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Model } from "@/lib/db/schema";

type TtsDemoProps = {
	model: Model;
};

const DEFAULT_PLACEHOLDER = "Type or paste text here to convert to speech...";

export function TtsDemo({ model }: TtsDemoProps) {
	const [text, setText] = useState("");
	const [voice, setVoice] = useState("default");
	const [modelState, setModelState] = useState<ModelState>({
		status: "not_loaded",
	});
	const [audioUrl, _setAudioUrl] = useState<string | null>(null);
	const [comingSoon, setComingSoon] = useState(false);

	const voiceCount = model.voices ?? 0;
	const voiceOptions = Array.from({ length: voiceCount }, (_, i) => ({
		value: `voice_${i + 1}`,
		label: `Voice ${i + 1}`,
	}));

	const handleDownload = useCallback(() => {
		// MVP: Show coming soon since actual inference is not wired up yet
		setComingSoon(true);
		setTimeout(() => setComingSoon(false), 3000);
	}, []);

	const handleGenerate = useCallback(() => {
		if (!text.trim()) return;

		// Store in recent texts
		addRecentText(text);

		// MVP: Show coming soon since actual inference is not wired up yet
		setComingSoon(true);
		setTimeout(() => setComingSoon(false), 3000);
	}, [text]);

	const handleRetry = useCallback(() => {
		setModelState({ status: "not_loaded" });
	}, []);

	const handleSelectRecentText = useCallback((selected: string) => {
		setText(selected);
	}, []);

	return (
		<div className="space-y-6">
			<ModelStatus
				state={modelState}
				modelName={model.name}
				sizeMb={model.sizeMb}
				onDownload={handleDownload}
				onRetry={handleRetry}
			/>

			<div className="space-y-4">
				<div className="space-y-2">
					<label
						htmlFor="tts-text"
						className="text-sm font-medium text-foreground"
					>
						Text to speak
					</label>
					<Textarea
						id="tts-text"
						placeholder={DEFAULT_PLACEHOLDER}
						value={text}
						onChange={(e) => setText(e.target.value)}
						rows={4}
						className="resize-none"
					/>
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>{text.length} characters</span>
						<span>
							~{text.trim().split(/\s+/).filter(Boolean).length} words
						</span>
					</div>
				</div>

				{voiceCount > 0 && (
					<div className="space-y-2">
						<label
							htmlFor="tts-voice"
							className="text-sm font-medium text-foreground"
						>
							Voice
						</label>
						<Select
							id="tts-voice"
							value={voice}
							onChange={(e) => setVoice(e.target.value)}
						>
							<SelectOption value="default">Default voice</SelectOption>
							{voiceOptions.map((opt) => (
								<SelectOption key={opt.value} value={opt.value}>
									{opt.label}
								</SelectOption>
							))}
						</Select>
					</div>
				)}

				<Button
					onClick={handleGenerate}
					disabled={!text.trim() || modelState.status === "processing"}
					className="w-full gap-2"
				>
					{modelState.status === "processing" ? (
						<>
							<Loader2 className="h-4 w-4 animate-spin" />
							Generating...
						</>
					) : (
						<>
							<Volume2 className="h-4 w-4" />
							Generate Speech
						</>
					)}
				</Button>

				{comingSoon && (
					<div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-center text-sm text-primary">
						Coming soon -- inference pipeline is not wired up yet.
					</div>
				)}
			</div>

			{audioUrl && (
				<div className="space-y-2">
					<h3 className="text-sm font-medium text-foreground">Output</h3>
					<AudioPlayer audioUrl={audioUrl} />
				</div>
			)}

			{modelState.status === "result" && (
				<div className="grid grid-cols-3 gap-4 rounded-lg border border-border bg-secondary/30 p-4">
					<div className="text-center">
						<p className="text-xs text-muted-foreground">Generation time</p>
						<p className="text-lg font-semibold tabular-nums">
							{modelState.metrics.totalMs < 1000
								? `${modelState.metrics.totalMs}ms`
								: `${(modelState.metrics.totalMs / 1000).toFixed(2)}s`}
						</p>
					</div>
					{modelState.metrics.rtf != null && (
						<div className="text-center">
							<p className="text-xs text-muted-foreground">Real-time Factor</p>
							<p className="text-lg font-semibold tabular-nums">
								{modelState.metrics.rtf.toFixed(3)}x
							</p>
						</div>
					)}
					<div className="text-center">
						<p className="text-xs text-muted-foreground">Backend</p>
						<p className="text-lg font-semibold uppercase">
							{modelState.metrics.backend}
						</p>
					</div>
				</div>
			)}

			<RecentTexts onSelect={handleSelectRecentText} currentText={text} />

			<GenerationHistory modelSlug={model.slug} />
		</div>
	);
}
