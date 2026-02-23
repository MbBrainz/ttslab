import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "TTSLab — Test TTS & STT models in your browser";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
	// Audio waveform bar heights (symmetric pattern)
	const bars = [
		24, 40, 28, 56, 72, 48, 88, 64, 96, 80, 112, 72, 120, 88, 104, 128, 96,
		136, 112, 80, 144, 104, 128, 96, 136, 120, 104, 88, 112, 144, 128, 96,
		112, 80, 64, 88, 48, 72, 56, 40, 28, 48, 32, 24,
	];

	return new ImageResponse(
		(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					alignItems: "center",
					backgroundColor: "#0a0a0f",
					color: "#ffffff",
					fontFamily: "Inter, sans-serif",
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

				{/* Subtle radial glow behind content */}
				<div
					style={{
						position: "absolute",
						top: "50%",
						left: "50%",
						transform: "translate(-50%, -50%)",
						width: "800px",
						height: "800px",
						borderRadius: "50%",
						background:
							"radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)",
					}}
				/>

				{/* Main content — centered vertically */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: "0px",
						zIndex: 1,
					}}
				>
					{/* Title */}
					<h1
						style={{
							fontSize: "116px",
							fontWeight: 800,
							margin: 0,
							letterSpacing: "-5px",
							background: "linear-gradient(135deg, #ffffff, #c4b5fd)",
							backgroundClip: "text",
							color: "transparent",
						}}
					>
						TTSLab
					</h1>

					{/* Tagline */}
					<p
						style={{
							fontSize: "34px",
							color: "#a1a1aa",
							margin: 0,
							marginTop: "-2px",
							textAlign: "center",
							maxWidth: "1080px",
							lineHeight: 1.3,
							fontWeight: 400,
						}}
					>
						Voice AI in your browser. No server. No data collection.
					</p>

					{/* Audio waveform visualization */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "4px",
							marginTop: "40px",
							height: "144px",
						}}
					>
						{bars.map((h, i) => (
							<div
								key={i}
								style={{
									width: "6px",
									height: `${h}px`,
									borderRadius: "3px",
									background: `linear-gradient(180deg, ${
										i < bars.length * 0.15 || i > bars.length * 0.85
											? "#4f46e5"
											: i < bars.length * 0.3 || i > bars.length * 0.7
												? "#6366f1"
												: i < bars.length * 0.4 || i > bars.length * 0.6
													? "#818cf8"
													: "#a78bfa"
									}, ${
										i < bars.length * 0.15 || i > bars.length * 0.85
											? "#312e81"
											: i < bars.length * 0.3 || i > bars.length * 0.7
												? "#4338ca"
												: i < bars.length * 0.4 || i > bars.length * 0.6
													? "#4f46e5"
													: "#6366f1"
									})`,
									opacity: 0.9,
								}}
							/>
						))}
					</div>

					{/* Feature badges */}
					<div
						style={{
							display: "flex",
							gap: "32px",
							marginTop: "36px",
							fontSize: "28px",
							fontWeight: 500,
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "12px",
								color: "#a5b4fc",
							}}
						>
							<div
								style={{
									width: "12px",
									height: "12px",
									borderRadius: "50%",
									backgroundColor: "#6366f1",
								}}
							/>
							WebGPU Powered
						</div>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "12px",
								color: "#86efac",
							}}
						>
							<div
								style={{
									width: "12px",
									height: "12px",
									borderRadius: "50%",
									backgroundColor: "#22c55e",
								}}
							/>
							100% Private
						</div>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "12px",
								color: "#fcd34d",
							}}
						>
							<div
								style={{
									width: "12px",
									height: "12px",
									borderRadius: "50%",
									backgroundColor: "#f59e0b",
								}}
							/>
							Open Source
						</div>
					</div>
				</div>

				{/* Footer URL */}
				<div
					style={{
						position: "absolute",
						bottom: "28px",
						right: "44px",
						fontSize: "28px",
						color: "#52525b",
						fontWeight: 500,
					}}
				>
					ttslab.dev
				</div>
			</div>
		),
		{ ...size },
	);
}
