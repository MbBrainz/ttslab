"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "voicebench:tts-texts";
const MAX_RECENT = 10;

type RecentTextsProps = {
	onSelect: (text: string) => void;
	currentText?: string;
};

function getStoredTexts(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function addRecentText(text: string) {
	const trimmed = text.trim();
	if (!trimmed) return;

	const existing = getStoredTexts();
	const filtered = existing.filter((t) => t !== trimmed);
	const updated = [trimmed, ...filtered].slice(0, MAX_RECENT);
	localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function RecentTexts({ onSelect, currentText }: RecentTextsProps) {
	const [texts, setTexts] = useState<string[]>([]);

	useEffect(() => {
		setTexts(getStoredTexts());
	}, []);

	const handleRemove = useCallback(
		(text: string, e: React.MouseEvent) => {
			e.stopPropagation();
			const updated = texts.filter((t) => t !== text);
			setTexts(updated);
			localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
		},
		[texts],
	);

	if (texts.length === 0) return null;

	return (
		<div className="space-y-2">
			<span className="text-xs font-medium text-muted-foreground">
				Recent texts
			</span>
			<div className="flex flex-wrap gap-1.5">
				{texts.map((text) => (
					<button
						key={text}
						type="button"
						onClick={() => onSelect(text)}
						className={cn(
							"group inline-flex max-w-[200px] items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:border-primary/50 hover:bg-accent",
							currentText === text && "border-primary bg-accent",
						)}
					>
						<span className="truncate">{text}</span>
						<span
							onClick={(e) => handleRemove(text, e)}
							className="ml-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-destructive/20 group-hover:opacity-100"
						>
							<X className="h-2.5 w-2.5" />
						</span>
					</button>
				))}
			</div>
		</div>
	);
}
