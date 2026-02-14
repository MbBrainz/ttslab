import type { Metadata } from "next";
import { Suspense } from "react";
import { getAllModelsWithUpvotes } from "@/lib/db/queries";
import type { ModelWithUpvotes } from "@/lib/db/types";
import { ModelGrid } from "./model-grid";

export const metadata: Metadata = {
	title: "Model Directory",
	description:
		"Browse and test TTS and STT models that run directly in your browser.",
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
