"use client";

import { Layers } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { ModelCard } from "@/components/model-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/select";
import type { Model } from "@/lib/db/schema";

type ModelWithUpvotes = Model & { upvoteCount: number };

type ModelGridProps = {
	models: ModelWithUpvotes[];
};

type TypeFilter = "all" | "tts" | "stt";
type StatusFilter = "all" | "supported" | "coming-soon";
type SortOption = "popular" | "alphabetical" | "size";

const TYPE_FILTER_VALUES: TypeFilter[] = ["all", "tts", "stt"];
const STATUS_FILTER_VALUES: StatusFilter[] = [
	"all",
	"supported",
	"coming-soon",
];
const SORT_VALUES: SortOption[] = ["popular", "alphabetical", "size"];

function isTypeFilter(v: string | null): v is TypeFilter {
	return TYPE_FILTER_VALUES.includes(v as TypeFilter);
}
function isStatusFilter(v: string | null): v is StatusFilter {
	return STATUS_FILTER_VALUES.includes(v as StatusFilter);
}
function isSortOption(v: string | null): v is SortOption {
	return SORT_VALUES.includes(v as SortOption);
}

export function ModelGrid({ models }: ModelGridProps) {
	const searchParams = useSearchParams();
	const router = useRouter();

	const [search, setSearch] = useState(searchParams.get("q") ?? "");
	const [typeFilter, setTypeFilter] = useState<TypeFilter>(
		isTypeFilter(searchParams.get("type"))
			? (searchParams.get("type") as TypeFilter)
			: "all",
	);
	const [statusFilter, setStatusFilter] = useState<StatusFilter>(
		isStatusFilter(searchParams.get("status"))
			? (searchParams.get("status") as StatusFilter)
			: "all",
	);
	const [sort, setSort] = useState<SortOption>(
		isSortOption(searchParams.get("sort"))
			? (searchParams.get("sort") as SortOption)
			: "popular",
	);

	const syncParams = useCallback(
		(overrides: {
			q?: string;
			type?: TypeFilter;
			status?: StatusFilter;
			sort?: SortOption;
		}) => {
			const params = new URLSearchParams();
			const q = overrides.q ?? search;
			const t = overrides.type ?? typeFilter;
			const s = overrides.status ?? statusFilter;
			const so = overrides.sort ?? sort;

			if (q.trim()) params.set("q", q.trim());
			if (t !== "all") params.set("type", t);
			if (s !== "all") params.set("status", s);
			if (so !== "popular") params.set("sort", so);

			const qs = params.toString();
			router.replace(qs ? `?${qs}` : "?", { scroll: false });
		},
		[search, typeFilter, statusFilter, sort, router],
	);

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

		// Pin verified models to the top: Kokoro first, then Piper
		const pinOrder = ["kokoro-82m", "piper-en-us-lessac-medium"];
		result.sort((a, b) => {
			const aPin = pinOrder.indexOf(a.slug);
			const bPin = pinOrder.indexOf(b.slug);
			if (aPin !== -1 && bPin !== -1) return aPin - bPin;
			if (aPin !== -1) return -1;
			if (bPin !== -1) return 1;
			return 0;
		});

		return result;
	}, [models, search, typeFilter, statusFilter, sort]);

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-4 sm:flex-row">
				<Input
					placeholder="Search models..."
					value={search}
					onChange={(e) => {
						setSearch(e.target.value);
						syncParams({ q: e.target.value });
					}}
					className="sm:max-w-xs"
				/>
				<CustomSelect
					value={typeFilter}
					onValueChange={(v) => {
						setTypeFilter(v as TypeFilter);
						syncParams({ type: v as TypeFilter });
					}}
					options={[
						{ value: "all", label: "All Types" },
						{ value: "tts", label: "TTS" },
						{ value: "stt", label: "STT" },
					]}
				/>
				<CustomSelect
					value={statusFilter}
					onValueChange={(v) => {
						setStatusFilter(v as StatusFilter);
						syncParams({ status: v as StatusFilter });
					}}
					options={[
						{ value: "all", label: "All Status" },
						{ value: "supported", label: "Supported" },
						{ value: "coming-soon", label: "Coming Soon" },
					]}
				/>
				<CustomSelect
					value={sort}
					onValueChange={(v) => {
						setSort(v as SortOption);
						syncParams({ sort: v as SortOption });
					}}
					options={[
						{ value: "popular", label: "Popular" },
						{ value: "alphabetical", label: "Alphabetical" },
						{ value: "size", label: "Size" },
					]}
				/>
			</div>

			{filteredModels.length === 0 ? (
				models.length === 0 ? (
					<div className="flex flex-col items-center gap-4 py-16 text-center">
						<Layers className="h-12 w-12 text-muted-foreground" />
						<div className="space-y-2">
							<h3 className="text-lg font-semibold">No models available yet</h3>
							<p className="text-sm text-muted-foreground">
								Models will appear here once the database is configured.
							</p>
						</div>
					</div>
				) : (
					<div className="flex flex-col items-center gap-4 py-16 text-center">
						<p className="text-muted-foreground">
							No models found matching your filters.
						</p>
						<Button
							variant="outline"
							onClick={() => {
								setSearch("");
								setTypeFilter("all");
								setStatusFilter("all");
								setSort("popular");
								router.replace("?", { scroll: false });
							}}
						>
							Clear filters
						</Button>
					</div>
				)
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
