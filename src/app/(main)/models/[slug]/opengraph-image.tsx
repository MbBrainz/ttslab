import { ImageResponse } from "next/og";
import { getModelBySlug } from "@/lib/db/queries";

export const runtime = "edge";
export const alt = "TTSLab Model";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OGImage({
	params,
}: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const model = await getModelBySlug(slug);

	const name = model?.name ?? slug;
	const description = model?.description ?? "A voice model on TTSLab";
	const type = model?.type?.toUpperCase() ?? "MODEL";
	const params_m = model?.paramsMillions
		? `${model.paramsMillions}M params`
		: null;
	const size_mb = model?.sizeMb ? `${model.sizeMb} MB` : null;
	const languages = model?.languages?.length
		? `${model.languages.length} language${model.languages.length > 1 ? "s" : ""}`
		: null;

	const specs = [params_m, size_mb, languages].filter(Boolean);

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
				<div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
					{/* Type badge */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "12px",
						}}
					>
						<div
							style={{
								padding: "6px 16px",
								borderRadius: "20px",
								backgroundColor:
									type === "TTS" ? "#6366f1" : "#22c55e",
								fontSize: "16px",
								fontWeight: 600,
							}}
						>
							{type}
						</div>
					</div>

					{/* Model name */}
					<h1
						style={{
							fontSize: "64px",
							fontWeight: 700,
							margin: 0,
							letterSpacing: "-2px",
						}}
					>
						{name}
					</h1>

					{/* Description */}
					<p
						style={{
							fontSize: "24px",
							color: "#a1a1aa",
							margin: 0,
							maxWidth: "800px",
							lineHeight: 1.4,
						}}
					>
						{description.length > 120
							? `${description.slice(0, 120)}...`
							: description}
					</p>
				</div>

				{/* Specs row */}
				{specs.length > 0 && (
					<div
						style={{
							display: "flex",
							gap: "32px",
							fontSize: "18px",
							color: "#a1a1aa",
						}}
					>
						{specs.map((spec) => (
							<div
								key={spec}
								style={{
									display: "flex",
									alignItems: "center",
									gap: "8px",
								}}
							>
								<div
									style={{
										width: "6px",
										height: "6px",
										borderRadius: "50%",
										backgroundColor: "#6366f1",
									}}
								/>
								{spec}
							</div>
						))}
					</div>
				)}

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
