export default function VoiceAgentLayout({
	children,
}: { children: React.ReactNode }) {
	return (
		<div
			className="fixed inset-0 z-[60] flex flex-col bg-background"
			role="dialog"
			aria-modal="true"
			aria-label="Voice Agent"
		>
			{children}
		</div>
	);
}
