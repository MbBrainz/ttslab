"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { HeroDemo } from "@/components/hero-demo";
import { HeroVisualizer } from "@/components/hero-visualizer";
import { buttonVariants } from "@/components/ui/button";
import { APP_DESCRIPTION } from "@/lib/constants";

export function HeroClient() {
	const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);

	return (
		<>
			<HeroVisualizer analyser={analyser} isActive={isPlaying} />

			<div className="relative z-10 flex flex-col items-center gap-6">
				<h1 className="max-w-3xl bg-gradient-to-r from-gradient-from to-gradient-to bg-clip-text text-center text-4xl font-bold tracking-tight text-transparent sm:text-5xl">
					Test Speech AI In Your Browser
				</h1>
				<p className="max-w-xl text-center text-muted-foreground">
					{APP_DESCRIPTION}
				</p>

				<HeroDemo
					onAnalyserReady={setAnalyser}
					onPlayingChange={setIsPlaying}
				/>

				<Link
					href="/models/kokoro-82m"
					className={`${buttonVariants({ variant: "default", size: "lg" })} gap-2`}
				>
					Try it yourself
					<ArrowRight className="h-4 w-4" />
				</Link>
			</div>
		</>
	);
}
