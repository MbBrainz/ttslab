export default function VoiceAgentLayout({
	children,
}: { children: React.ReactNode }) {
	return (
		<div className="fixed inset-0 z-40 flex flex-col bg-background">
			{children}
		</div>
	);
}
