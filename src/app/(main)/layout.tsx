import { Coffee, Github, Linkedin, Twitter } from "lucide-react";
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
				<div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
					<div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
						{/* Left: nav links + copyright */}
						<div className="space-y-4">
							<div className="flex flex-wrap items-center gap-6">
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
									className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
								>
									<Github className="h-4 w-4" />
									GitHub
								</a>
							</div>
							<div className="flex items-center gap-4">
								<p className="text-xs text-muted-foreground">
									MIT License &copy; {new Date().getFullYear()} {APP_NAME}
								</p>
								<a
									href="https://seo-report.ai/verified/eyJkYXRhIjp7ImRvbWFpbiI6InR0c2xhYi5kZXYiLCJ0aWVyIjoicHJvIiwiY3JlYXRlZEF0IjoiMjAyNi0wMi0xOFQyMjo1NTo0Ny45MTJaIn0sInNpZ25hdHVyZSI6ImYyOTEzNDBmZDRkM2IwZjFkYjQ4NDgwNTJjYzY4NTAzYzM4ZTRhYzEyMGVmMDAxMWViNTk5ZTJhZmEyYTU2ZGQifQ?utm_source=badge&utm_medium=referral&utm_campaign=seo-verified"
									target="_blank"
									rel="noopener"
								>
									<img
										src="https://seo-report.ai/badges/seo-verified-premium.svg"
										alt="SEO Verified by SEO Report AI"
										width={96}
										height={38}
										loading="lazy"
									/>
								</a>
							</div>
						</div>

						{/* Right: creator section */}
						<div className="space-y-2">
							<p className="text-sm font-medium text-foreground">
								Built by Maurits Bos
							</p>
							<p className="text-xs text-muted-foreground">
								Full-stack developer | Applied AI
							</p>
							<div className="flex items-center gap-3 pt-1">
								<a
									href="https://github.com/MbBrainz"
									target="_blank"
									rel="noopener noreferrer"
									className="text-muted-foreground transition-colors hover:text-foreground"
									aria-label="GitHub"
								>
									<Github className="h-4 w-4" />
								</a>
								<a
									href="https://linkedin.com/in/mhwbos"
									target="_blank"
									rel="noopener noreferrer"
									className="text-muted-foreground transition-colors hover:text-foreground"
									aria-label="LinkedIn"
								>
									<Linkedin className="h-4 w-4" />
								</a>
								<a
									href="https://x.com/MbBrainz"
									target="_blank"
									rel="noopener noreferrer"
									className="text-muted-foreground transition-colors hover:text-foreground"
									aria-label="X / Twitter"
								>
									<Twitter className="h-4 w-4" />
								</a>
								<a
									href="https://buymeacoffee.com/mbbrainz"
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center gap-1.5 rounded-md bg-[#FFDD00] px-2.5 py-1 text-xs font-medium text-black transition-opacity hover:opacity-80"
								>
									<Coffee className="h-3.5 w-3.5" />
									Buy me a coffee
								</a>
							</div>
						</div>
					</div>
				</div>
			</footer>
		</>
	);
}
