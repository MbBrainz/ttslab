import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
			<h1 className="text-6xl font-bold text-foreground">404</h1>
			<p className="max-w-md text-lg text-muted-foreground">
				The page you are looking for does not exist or has been moved.
			</p>
			<Link href="/">
				<Button variant="default" size="lg">
					Back to Home
				</Button>
			</Link>
		</div>
	);
}
