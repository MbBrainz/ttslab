"use client";

import { ArrowRight, GitCompareArrows, Search } from "lucide-react";
import Link from "next/link";
import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

type CompareModelPickerProps = {
	comparisons: {
		slug: string;
		model: { slug: string; name: string; status: string; type: string };
	}[];
};

export function CompareModelPicker({ comparisons }: CompareModelPickerProps) {
	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState("");

	const filtered = useMemo(() => {
		if (!filter) return comparisons;
		const q = filter.toLowerCase();
		return comparisons.filter((c) => c.model.name.toLowerCase().includes(q));
	}, [comparisons, filter]);

	if (comparisons.length === 0) return null;

	return (
		<>
			<Button
				variant="outline"
				className="gap-2"
				onClick={() => setOpen(true)}
			>
				<GitCompareArrows className="h-4 w-4" />
				Compare with...
			</Button>

			<Dialog open={open} onClose={() => setOpen(false)}>
				<DialogHeader>
					<DialogTitle>Compare with</DialogTitle>
					<DialogClose onClose={() => setOpen(false)} />
				</DialogHeader>
				<DialogContent className="space-y-3">
					{comparisons.length > 4 && (
						<div className="relative">
							<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<input
								type="text"
								placeholder="Filter models..."
								value={filter}
								onChange={(e) => setFilter(e.target.value)}
								className="w-full rounded-md border border-border bg-transparent py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							/>
						</div>
					)}
					<div className="max-h-64 space-y-1 overflow-y-auto">
						{filtered.map((c) => (
							<Link
								key={c.slug}
								href={`/compare/${c.slug}`}
								onClick={() => setOpen(false)}
								className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-accent"
							>
								<div className="flex items-center gap-2">
									<span className="font-medium">{c.model.name}</span>
									<Badge variant="outline" className="text-xs">
										{c.model.type.toUpperCase()}
									</Badge>
								</div>
								<ArrowRight className="h-4 w-4 text-muted-foreground" />
							</Link>
						))}
						{filtered.length === 0 && (
							<p className="py-4 text-center text-sm text-muted-foreground">
								No matching models
							</p>
						)}
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
