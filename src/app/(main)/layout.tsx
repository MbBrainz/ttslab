import { Github } from "lucide-react";
import Link from "next/link";
import { GitHubStars } from "@/components/github-stars";
import { MobileNav } from "@/components/mobile-nav";
import { NavLinks } from "@/components/nav-links";
import { APP_NAME } from "@/lib/constants";

export default function MainLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<>
			<header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
				<nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
					<Link
						href="/"
						className="text-lg font-bold tracking-tight text-foreground"
					>
						{APP_NAME}
					</Link>
					<div className="flex items-center gap-4">
						<NavLinks />
						<GitHubStars />
						<MobileNav />
					</div>
				</nav>
			</header>

			<main
				id="main-content"
				className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6"
			>
				{children}
			</main>

			<footer className="border-t border-border">
				<div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
					<p className="text-sm text-muted-foreground">
						MIT License &copy; {new Date().getFullYear()} {APP_NAME}
					</p>
					<div className="flex items-center gap-6">
						<Link
							href="/models"
							className="text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							Models
						</Link>
						<Link
							href="/compare"
							className="text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							Compare
						</Link>
						<Link
							href="/about"
							className="text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							About
						</Link>
						<a
							href="https://github.com/MbBrainz/ttslab"
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							<Github className="h-4 w-4" />
							GitHub
						</a>
					</div>
				</div>
			</footer>
		</>
	);
}
