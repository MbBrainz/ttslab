import { ImageResponse } from "next/og";
import { getComparisonBySlug, getModelById } from "@/lib/db/queries";

export const runtime = "edge";
export const alt = "TTSLab Comparison";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OGImage({
	params,
}: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const comparison = await getComparisonBySlug(slug);

	let modelAName = "Model A";
	let modelBName = "Model B";
	let modelAType = "MODEL";
	let modelBType = "MODEL";

	if (comparison) {
		const [modelA, modelB] = await Promise.all([
			getModelById(comparison.modelAId),
			getModelById(comparison.modelBId),
		]);
		if (modelA) {
			modelAName = modelA.name;
			modelAType = modelA.type.toUpperCase();
		}
		if (modelB) {
			modelBName = modelB.name;
			modelBType = modelB.type.toUpperCase();
		}
	}

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
				{/* Gradient accent bar */}
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

				{/* Subtle radial glow */}
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

				{/* Comparison layout */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: "32px",
						zIndex: 1,
					}}
				>
					{/* Model names row */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "40px",
						}}
					>
						<span
							style={{
								fontSize: "64px",
								fontWeight: 800,
								letterSpacing: "-2px",
								background: "linear-gradient(135deg, #ffffff, #c4b5fd)",
								backgroundClip: "text",
								color: "transparent",
							}}
						>
							{modelAName}
						</span>

						<span
							style={{
								fontSize: "36px",
								color: "#52525b",
								fontWeight: 600,
							}}
						>
							vs
						</span>

						<span
							style={{
								fontSize: "64px",
								fontWeight: 800,
								letterSpacing: "-2px",
								background: "linear-gradient(135deg, #ffffff, #c4b5fd)",
								backgroundClip: "text",
								color: "transparent",
							}}
						>
							{modelBName}
						</span>
					</div>

					{/* Single type badge */}
					<div
						style={{
							padding: "8px 24px",
							borderRadius: "20px",
							backgroundColor:
								modelAType === "TTS" ? "#6366f1" : "#22c55e",
							fontSize: "22px",
							fontWeight: 600,
						}}
					>
						{modelAType} Comparison
					</div>
				</div>

				{/* Footer — prominent TTSLab branding */}
				<div
					style={{
						position: "absolute",
						bottom: "28px",
						left: "72px",
						right: "72px",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
					}}
				>
					<span
						style={{
							fontSize: "40px",
							fontWeight: 700,
							letterSpacing: "-1px",
							color: "#3f3f46",
						}}
					>
						TTSLab
					</span>
					<span
						style={{
							fontSize: "28px",
							color: "#52525b",
							fontWeight: 500,
						}}
					>
						ttslab.dev
					</span>
				</div>
			</div>
		),
		{ ...size },
	);
}
