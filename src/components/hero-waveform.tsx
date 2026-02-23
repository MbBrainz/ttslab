/**
 * Animated gradient blob background for the hero section.
 * Pure CSS — no canvas, no JavaScript, GPU-accelerated.
 */
export function HeroWaveform() {
	return (
		<div
			className="absolute inset-0 overflow-hidden pointer-events-none"
			aria-hidden="true"
		>
			<div
				className="absolute left-[10%] top-[5%] h-[70%] w-[50%] rounded-full opacity-[0.08] blur-[100px]"
				style={{
					backgroundColor: "var(--gradient-from)",
					animation: "hero-blob-1 20s ease-in-out infinite",
				}}
			/>
			<div
				className="absolute right-[5%] top-[15%] h-[55%] w-[45%] rounded-full opacity-[0.06] blur-[100px]"
				style={{
					backgroundColor: "var(--gradient-to)",
					animation: "hero-blob-2 25s ease-in-out infinite",
				}}
			/>
			<div
				className="absolute bottom-[5%] left-[25%] h-[45%] w-[40%] rounded-full opacity-[0.05] blur-[80px]"
				style={{
					backgroundColor: "var(--gradient-from)",
					animation: "hero-blob-3 30s ease-in-out infinite",
				}}
			/>
		</div>
	);
}
