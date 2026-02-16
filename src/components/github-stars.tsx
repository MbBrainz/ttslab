import { Star } from "lucide-react";

const REPO = "MbBrainz/ttslab";

function formatCount(count: number): string {
	if (count >= 1000) {
		return `${(count / 1000).toFixed(1)}k`;
	}
	return String(count);
}

async function getStarCount(): Promise<number | null> {
	try {
		const headers: HeadersInit = {
			Accept: "application/vnd.github.v3+json",
		};
		if (process.env.GITHUB_TOKEN) {
			headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
		}

		const res = await fetch(`https://api.github.com/repos/${REPO}`, {
			headers,
			next: { revalidate: 3600 },
		});

		if (!res.ok) return null;

		const data = await res.json();
		return typeof data.stargazers_count === "number"
			? data.stargazers_count
			: null;
	} catch {
		return null;
	}
}

export async function GitHubStars() {
	const count = await getStarCount();

	return (
		<a
			href={`https://github.com/${REPO}`}
			target="_blank"
			rel="noopener noreferrer"
			className="hidden items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground sm:inline-flex"
		>
			<svg
				viewBox="0 0 16 16"
				className="h-3.5 w-3.5"
				fill="currentColor"
				aria-hidden="true"
			>
				<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
			</svg>
			<Star className="h-3 w-3" />
			{count != null ? formatCount(count) : "Star"}
		</a>
	);
}
