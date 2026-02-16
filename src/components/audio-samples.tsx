"use client";

import { Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AudioPlayer } from "@/components/audio-player";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { type AudioSample, audioSamples } from "@/lib/audio-samples";
import { trackAudioSamplePlayed } from "@/lib/analytics";

export function AudioSamples() {
	const [availability, setAvailability] = useState<Record<string, boolean>>({});

	useEffect(() => {
		async function checkFiles() {
			const results: Record<string, boolean> = {};
			await Promise.all(
				audioSamples.map(async (sample) => {
					try {
						const res = await fetch(sample.audioPath, { method: "HEAD" });
						results[sample.id] = res.ok;
					} catch {
						results[sample.id] = false;
					}
				}),
			);
			setAvailability(results);
		}
		checkFiles();
	}, []);

	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{audioSamples.map((sample) => (
				<SampleCard
					key={sample.id}
					sample={sample}
					available={availability[sample.id] ?? false}
				/>
			))}
		</div>
	);
}

function SampleCard({
	sample,
	available,
}: { sample: AudioSample; available: boolean }) {
	return (
		<Card>
			<CardContent className="space-y-3 p-5">
				<div className="flex items-center gap-2">
					<Badge variant="secondary" className="text-xs">
						{sample.modelName}
					</Badge>
				</div>
				<p className="text-sm italic text-muted-foreground leading-relaxed">
					&ldquo;{sample.text}&rdquo;
				</p>
				{available ? (
					<div
						onClick={() =>
							trackAudioSamplePlayed(sample.modelSlug, sample.id)
						}
						onKeyDown={() => {}}
						role="presentation"
					>
						<AudioPlayer audioUrl={sample.audioPath} />
					</div>
				) : (
					<div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-secondary/20 px-4 py-3 text-sm text-muted-foreground">
						<Volume2 className="h-4 w-4" />
						Sample coming soon
					</div>
				)}
			</CardContent>
		</Card>
	);
}
