export default function EmbedLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="min-h-screen bg-background p-4">
			{children}
			<div className="mt-2 text-center">
				<a
					href="https://ttslab.dev"
					target="_blank"
					rel="noopener noreferrer"
					className="text-xs text-muted-foreground hover:text-foreground"
				>
					Powered by TTSLab
				</a>
			</div>
		</div>
	);
}
