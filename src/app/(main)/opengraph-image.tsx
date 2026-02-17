import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "TTSLab — Test TTS & STT models in your browser";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
	return new ImageResponse(
		(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					justifyContent: "space-between",
					backgroundColor: "#1a1a1a",
					color: "#ffffff",
					fontFamily: "Inter, sans-serif",
					padding: "60px",
				}}
			>
				{/* Purple accent bar */}
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						height: "4px",
						background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
					}}
				/>

				{/* Content */}
				<div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
					<h1
						style={{
							fontSize: "72px",
							fontWeight: 700,
							margin: 0,
							letterSpacing: "-2px",
						}}
					>
						TTSLab
					</h1>
					<p
						style={{
							fontSize: "28px",
							color: "#a1a1aa",
							margin: 0,
							maxWidth: "800px",
							lineHeight: 1.4,
						}}
					>
						Test TTS & STT models in your browser. No server. No data
						collection.
					</p>
				</div>

				{/* Stats row */}
				<div
					style={{
						display: "flex",
						gap: "48px",
						fontSize: "18px",
						color: "#a1a1aa",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
						<div
							style={{
								width: "8px",
								height: "8px",
								borderRadius: "50%",
								backgroundColor: "#6366f1",
							}}
						/>
						WebGPU Powered
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
						<div
							style={{
								width: "8px",
								height: "8px",
								borderRadius: "50%",
								backgroundColor: "#22c55e",
							}}
						/>
						100% Private
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
						<div
							style={{
								width: "8px",
								height: "8px",
								borderRadius: "50%",
								backgroundColor: "#f59e0b",
							}}
						/>
						Open Source
					</div>
				</div>

				{/* Footer URL */}
				<div
					style={{
						display: "flex",
						justifyContent: "flex-end",
						fontSize: "20px",
						color: "#71717a",
					}}
				>
					ttslab.dev
				</div>
			</div>
		),
		{ ...size },
	);
}
