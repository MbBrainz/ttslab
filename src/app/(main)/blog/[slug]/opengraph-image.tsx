import { ImageResponse } from "next/og";
import { BLOG_POSTS, getBlogPost } from "@/lib/blog-posts";

export const revalidate = false;
// Prerender one OG image per post at build time so social/crawler hits never
// trigger an on-demand satori render. Unknown slugs return a static 404.
export const dynamicParams = false;
export const alt = "TTSLab Blog Post";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export async function generateStaticParams() {
	return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export default async function OGImage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const post = getBlogPost(slug);

	const title = post?.title ?? "From the TTSLab blog";
	const dek =
		post?.dek ??
		"Ports, kernels and measurements from the browser voice-AI lab.";

	// Audio waveform bar heights (symmetric pattern)
	const bars = [24, 44, 64, 88, 108, 84, 116, 92, 120, 96, 128, 100, 112, 84];

	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				backgroundColor: "#0a0a0f",
				color: "#ffffff",
				fontFamily: "Inter, sans-serif",
				padding: "72px 80px",
				position: "relative",
				overflow: "hidden",
			}}
		>
			{/* Gradient accent bar top */}
			<div
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					height: "6px",
					background: "linear-gradient(90deg, #6366f1, #8b5cf6, #a78bfa)",
				}}
			/>

			{/* Header row */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<div style={{ display: "flex", fontSize: "36px", fontWeight: 700 }}>
					TTSLab<span style={{ color: "#71717a" }}>.dev</span>
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "12px",
						padding: "10px 24px",
						borderRadius: "999px",
						border: "2px solid #4f46e5",
						color: "#a5b4fc",
						fontSize: "24px",
						fontWeight: 600,
					}}
				>
					Blog
				</div>
			</div>

			{/* Title block */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: "24px",
				}}
			>
				<h1
					style={{
						fontSize: "58px",
						fontWeight: 800,
						margin: 0,
						lineHeight: 1.15,
						letterSpacing: "-2px",
						maxWidth: "1000px",
						background: "linear-gradient(135deg, #ffffff, #c4b5fd)",
						backgroundClip: "text",
						color: "transparent",
					}}
				>
					{title}
				</h1>
				<p
					style={{
						fontSize: "28px",
						color: "#a1a1aa",
						margin: 0,
						lineHeight: 1.4,
						maxWidth: "980px",
					}}
				>
					{dek}
				</p>
			</div>

			{/* Waveform strip */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "8px",
					height: "120px",
				}}
			>
				{bars.map((h, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: static decorative bars — index is a stable identity
						key={i}
						style={{
							width: "10px",
							height: `${h}px`,
							borderRadius: "5px",
							background: "linear-gradient(180deg, #a78bfa, #4f46e5)",
							opacity: 0.9,
						}}
					/>
				))}
			</div>

			{/* Footer URL */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					fontSize: "26px",
					color: "#52525b",
					fontWeight: 500,
				}}
			>
				<span style={{ color: "#818cf8" }}>
					ttslab.dev/blog/{post?.slug ?? ""}
				</span>
				<span>On-device voice AI, documented</span>
			</div>
		</div>,
		{ ...size },
	);
}
