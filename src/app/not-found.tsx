import { Search } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
			<Search className="h-12 w-12 text-muted-foreground" />
			<h1 className="font-mono text-6xl font-bold text-foreground">404</h1>
			<p className="max-w-md text-lg text-muted-foreground">
				The page you are looking for does not exist or has been moved.
			</p>
			<Link
				href="/"
				className={buttonVariants({ variant: "default", size: "lg" })}
			>
				Back to Home
			</Link>
			<p className="text-sm text-muted-foreground">
				Or try:{" "}
				<Link href="/models" className="text-primary hover:underline">
					Models
				</Link>
				,{" "}
				<Link href="/compare" className="text-primary hover:underline">
					Compare
				</Link>
				,{" "}
				<Link href="/about" className="text-primary hover:underline">
					About
				</Link>
			</p>
		</div>
	);
}
