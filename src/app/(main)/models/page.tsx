import type { Metadata } from "next";
import { Suspense } from "react";
import { ModelScatterPlotSection } from "@/components/model-scatter-plot";
import { getAllModelsWithUpvotes } from "@/lib/db/queries";
import type { ModelWithUpvotes } from "@/lib/db/types";
import { ModelGrid } from "./model-grid";

export const metadata: Metadata = {
	title: "TTS & STT Model Directory — Browse Browser-Based Speech Models",
	description:
		"Browse and test open-source text-to-speech and speech-to-text models that run directly in your browser with WebGPU & WASM. No server, no data collection.",
};

export default async function ModelsPage() {
	let allModels: ModelWithUpvotes[] = [];
	try {
		allModels = await getAllModelsWithUpvotes();
	} catch {
		// DB not configured yet
	}

	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-3xl font-bold tracking-tight">Model Directory</h1>
				<p className="mt-2 text-muted-foreground">
					Browse and test TTS and STT models that run directly in your browser.
				</p>
			</div>
			<ModelScatterPlotSection
				models={allModels.map(({ model }) => ({
					slug: model.slug,
					name: model.name,
					type: model.type as "tts" | "stt",
					sizeMb: model.sizeMb,
					paramsMillions: model.paramsMillions,
					voices: model.voices,
					status: model.status,
				}))}
			/>
			<Suspense>
				<ModelGrid
					models={allModels.map(({ model, upvoteCount }) => ({
						...model,
						upvoteCount,
					}))}
				/>
			</Suspense>
		</div>
	);
}
