import { Github } from "lucide-react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";
import "./globals.css";

const inter = Inter({
	variable: "--font-inter",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: {
		template: `%s | ${APP_NAME}`,
		default: APP_NAME,
	},
	description: APP_DESCRIPTION,
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" className="dark">
			<head>
				{process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN && (
					<script
						defer
						data-domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN}
						src="https://plausible.io/js/script.js"
					/>
				)}
			</head>
			<body
				className={`${inter.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
			>
				<header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
					<nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
						<Link
							href="/"
							className="text-lg font-bold tracking-tight text-foreground"
						>
							{APP_NAME}
						</Link>
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
						</div>
					</nav>
				</header>

				<main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>

				<footer className="border-t border-border">
					<div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
						<p className="text-sm text-muted-foreground">
							MIT License &copy; {new Date().getFullYear()} {APP_NAME}
						</p>
						<a
							href="https://github.com/nicholasgriffintn/voicebench"
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							<Github className="h-4 w-4" />
							GitHub
						</a>
					</div>
				</footer>
			</body>
		</html>
	);
}
