import { HeroClient } from "@/components/hero-client";
import { HeroWaveform } from "@/components/hero-waveform";

export function HeroSection() {
	return (
		<section className="relative flex flex-col items-center gap-8 overflow-hidden py-16">
			<HeroWaveform />
			<HeroClient />
		</section>
	);
}
