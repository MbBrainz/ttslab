"use client";

import { ChevronUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { trackModelUpvote } from "@/lib/analytics";
import { getFingerprint } from "@/lib/fingerprint";
import { cn } from "@/lib/utils";

type UpvoteButtonProps = {
	modelSlug: string;
	initialCount: number;
};

function getStorageKey(slug: string) {
	return `ttslab:upvoted:${slug}`;
}

export function UpvoteButton({ modelSlug, initialCount }: UpvoteButtonProps) {
	const [count, setCount] = useState(initialCount);
	const [voted, setVoted] = useState(false);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		const stored = localStorage.getItem(getStorageKey(modelSlug));
		if (stored === "true") {
			setVoted(true);
		}
	}, [modelSlug]);

	const handleUpvote = useCallback(async () => {
		if (voted || loading) return;

		setLoading(true);
		// Optimistic update
		setCount((prev) => prev + 1);
		setVoted(true);
		localStorage.setItem(getStorageKey(modelSlug), "true");
		trackModelUpvote(modelSlug);

		try {
			const fingerprint = await getFingerprint();
			const response = await fetch("/api/upvote", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ modelSlug, fingerprint }),
			});

			if (!response.ok) {
				// Revert optimistic update
				setCount((prev) => prev - 1);
				setVoted(false);
				localStorage.removeItem(getStorageKey(modelSlug));
			}
		} catch {
			// Revert optimistic update
			setCount((prev) => prev - 1);
			setVoted(false);
			localStorage.removeItem(getStorageKey(modelSlug));
		} finally {
			setLoading(false);
		}
	}, [voted, loading, modelSlug]);

	return (
		<Button
			variant={voted ? "secondary" : "outline"}
			size="sm"
			onClick={handleUpvote}
			disabled={voted || loading}
			className={cn("gap-1 tabular-nums", voted && "text-primary")}
			aria-label={voted ? `Upvoted (${count})` : `Upvote (${count})`}
		>
			<ChevronUp
				className={cn("h-4 w-4 transition-transform", voted && "text-primary")}
			/>
			{count}
		</Button>
	);
}
