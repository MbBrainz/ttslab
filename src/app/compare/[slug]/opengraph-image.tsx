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
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						flex: 1,
						gap: "32px",
					}}
				>
					{/* Comparison layout */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "40px",
						}}
					>
						{/* Model A */}
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								gap: "12px",
							}}
						>
							<div
								style={{
									padding: "6px 16px",
									borderRadius: "20px",
									backgroundColor:
										modelAType === "TTS" ? "#6366f1" : "#22c55e",
									fontSize: "14px",
									fontWeight: 600,
								}}
							>
								{modelAType}
							</div>
							<span
								style={{
									fontSize: "48px",
									fontWeight: 700,
									letterSpacing: "-1px",
								}}
							>
								{modelAName}
							</span>
						</div>

						{/* VS */}
						<span
							style={{
								fontSize: "28px",
								color: "#71717a",
								fontWeight: 500,
							}}
						>
							vs
						</span>

						{/* Model B */}
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								gap: "12px",
							}}
						>
							<div
								style={{
									padding: "6px 16px",
									borderRadius: "20px",
									backgroundColor:
										modelBType === "TTS" ? "#6366f1" : "#22c55e",
									fontSize: "14px",
									fontWeight: 600,
								}}
							>
								{modelBType}
							</div>
							<span
								style={{
									fontSize: "48px",
									fontWeight: 700,
									letterSpacing: "-1px",
								}}
							>
								{modelBName}
							</span>
						</div>
					</div>
				</div>

				{/* Footer */}
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						fontSize: "20px",
						color: "#71717a",
					}}
				>
					<span>TTSLab</span>
					<span>ttslab.dev</span>
				</div>
			</div>
		),
		{ ...size },
	);
}
