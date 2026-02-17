import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { APP_DESCRIPTION, APP_NAME, APP_URL } from "@/lib/constants";
import "./globals.css";

const inter = Inter({
	variable: "--font-inter",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	metadataBase: new URL(APP_URL),
	title: {
		template: `%s | ${APP_NAME}`,
		default: APP_NAME,
	},
	description: APP_DESCRIPTION,
	openGraph: {
		type: "website",
		siteName: APP_NAME,
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" className="dark">
			<body
				className={`${inter.variable} flex min-h-screen flex-col bg-background font-sans text-foreground antialiased`}
			>
				<a
					href="#main-content"
					className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground focus:shadow-lg"
				>
					Skip to content
				</a>
				{children}
				<Analytics />
			</body>
		</html>
	);
}
