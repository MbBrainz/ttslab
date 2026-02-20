import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { APP_DESCRIPTION, APP_NAME, APP_TITLE, APP_URL } from "@/lib/constants";
import "./globals.css";

const inter = Inter({
	variable: "--font-inter",
	subsets: ["latin"],
	display: "swap",
});

export const metadata: Metadata = {
	metadataBase: new URL(APP_URL),
	title: {
		template: `%s | ${APP_NAME}`,
		default: APP_TITLE,
	},
	description: APP_DESCRIPTION,
	keywords: [
		"text-to-speech",
		"TTS",
		"speech-to-text",
		"STT",
		"browser TTS",
		"WebGPU TTS",
		"on-device speech",
		"Kokoro TTS",
		"WASM TTS",
		"open source TTS",
		"compare TTS models",
		"privacy speech AI",
	],
	openGraph: {
		type: "website",
		siteName: APP_NAME,
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
	},
};

const organizationJsonLd = {
	"@context": "https://schema.org",
	"@type": "Organization",
	name: APP_NAME,
	url: APP_URL,
	logo: `${APP_URL}/icon.svg`,
	sameAs: ["https://github.com/MbBrainz/ttslab"],
	description: APP_DESCRIPTION,
};

const softwareJsonLd = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: APP_NAME,
	url: APP_URL,
	applicationCategory: "MultimediaApplication",
	operatingSystem: "Web Browser",
	description:
		"Open-source platform for testing and comparing text-to-speech (TTS) and speech-to-text (STT) models directly in the browser using WebGPU and WASM. No server, no data collection.",
	offers: {
		"@type": "Offer",
		price: "0",
		priceCurrency: "USD",
	},
	author: {
		"@type": "Organization",
		name: APP_NAME,
		url: APP_URL,
	},
	license: "https://opensource.org/licenses/MIT",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" className="dark">
			<head>
				<script
					type="application/ld+json"
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(organizationJsonLd),
					}}
				/>
				<script
					type="application/ld+json"
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(softwareJsonLd),
					}}
				/>
			</head>
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
