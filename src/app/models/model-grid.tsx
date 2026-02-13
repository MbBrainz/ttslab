"use client";

import { useMemo, useState } from "react";
import { ModelCard } from "@/components/model-card";
import { Input } from "@/components/ui/input";
import { Select, SelectOption } from "@/components/ui/select";
import type { Model } from "@/lib/db/schema";

type ModelWithUpvotes = Model & { upvoteCount: number };

type ModelGridProps = {
	models: ModelWithUpvotes[];
};

type TypeFilter = "all" | "tts" | "stt";
type StatusFilter = "all" | "supported" | "coming-soon";
type SortOption = "popular" | "alphabetical" | "size";

export function ModelGrid({ models }: ModelGridProps) {
	const [search, setSearch] = useState("");
	const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [sort, setSort] = useState<SortOption>("popular");

	const filteredModels = useMemo(() => {
		let result = [...models];

		// Search filter
		if (search.trim()) {
			const q = search.toLowerCase();
			result = result.filter(
				(m) =>
					m.name.toLowerCase().includes(q) ||
					m.slug.toLowerCase().includes(q) ||
					m.description?.toLowerCase().includes(q),
			);
		}

		// Type filter
		if (typeFilter !== "all") {
			result = result.filter((m) => m.type === typeFilter);
		}

		// Status filter
		if (statusFilter === "supported") {
			result = result.filter((m) => m.status === "supported");
		} else if (statusFilter === "coming-soon") {
			result = result.filter((m) => m.status !== "supported");
		}

		// Sort
		switch (sort) {
			case "popular":
				result.sort((a, b) => b.upvoteCount - a.upvoteCount);
				break;
			case "alphabetical":
				result.sort((a, b) => a.name.localeCompare(b.name));
				break;
			case "size":
				result.sort((a, b) => (a.sizeMb ?? 0) - (b.sizeMb ?? 0));
				break;
		}

		return result;
	}, [models, search, typeFilter, statusFilter, sort]);

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-4 sm:flex-row">
				<Input
					placeholder="Search models..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="sm:max-w-xs"
				/>
				<Select
					value={typeFilter}
					onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
				>
					<SelectOption value="all">All Types</SelectOption>
					<SelectOption value="tts">TTS</SelectOption>
					<SelectOption value="stt">STT</SelectOption>
				</Select>
				<Select
					value={statusFilter}
					onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
				>
					<SelectOption value="all">All Status</SelectOption>
					<SelectOption value="supported">Supported</SelectOption>
					<SelectOption value="coming-soon">Coming Soon</SelectOption>
				</Select>
				<Select
					value={sort}
					onChange={(e) => setSort(e.target.value as SortOption)}
				>
					<SelectOption value="popular">Popular</SelectOption>
					<SelectOption value="alphabetical">Alphabetical</SelectOption>
					<SelectOption value="size">Size</SelectOption>
				</Select>
			</div>

			{filteredModels.length === 0 ? (
				<div className="py-12 text-center text-muted-foreground">
					No models found matching your filters.
				</div>
			) : (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{filteredModels.map((model) => (
						<ModelCard
							key={model.id}
							model={model}
							upvoteCount={model.upvoteCount}
						/>
					))}
				</div>
			)}
		</div>
	);
}
