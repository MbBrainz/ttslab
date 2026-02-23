"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Sample = {
	text: string;
	audioSrc: string;
	label: string;
};

const SAMPLES: Sample[] = [
	{
		text: "Welcome to TTSLab, where you can test speech models right in your browser.",
		audioSrc: "/audio-samples/hero-demo-1.wav",
		label: "Kokoro 82M \u00b7 af_heart",
	},
	{
		text: "No downloads, no API keys. Just natural sounding speech, generated on your device.",
		audioSrc: "/audio-samples/hero-demo-2.wav",
		label: "Kokoro 82M \u00b7 af_bella",
	},
	{
		text: "Compare voices, benchmark performance, and find the perfect model for your project.",
		audioSrc: "/audio-samples/hero-demo-3.wav",
		label: "Kokoro 82M \u00b7 am_adam",
	},
];

type HeroDemoProps = {
	onAnalyserReady?: (analyser: AnalyserNode) => void;
	onPlayingChange?: (playing: boolean) => void;
};

export function HeroDemo({ onAnalyserReady, onPlayingChange }: HeroDemoProps) {
	const [sampleIdx, setSampleIdx] = useState(0);
	const [displayedText, setDisplayedText] = useState("");
	const [isTyping, setIsTyping] = useState(false);
	const [isAudioPlaying, setIsAudioPlaying] = useState(false);
	const [isMuted, setIsMuted] = useState(false);
	const [active, setActive] = useState(true);
	const [restartKey, setRestartKey] = useState(0);

	const audioRef = useRef<HTMLAudioElement>(null);
	const typeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const charIdxRef = useRef(0);
	const reducedMotionRef = useRef(false);
	const isMutedRef = useRef(false);
	const audioCtxRef = useRef<AudioContext | null>(null);

	// Keep callback refs current without affecting dependency arrays
	const onPlayingChangeRef = useRef(onPlayingChange);
	onPlayingChangeRef.current = onPlayingChange;
	const onAnalyserReadyRef = useRef(onAnalyserReady);
	onAnalyserReadyRef.current = onAnalyserReady;

	const sample = SAMPLES[sampleIdx];

	useEffect(() => {
		reducedMotionRef.current = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
	}, []);

	// Keep muted ref in sync with state and apply to audio element
	useEffect(() => {
		isMutedRef.current = isMuted;
		if (audioRef.current) audioRef.current.muted = isMuted;
	}, [isMuted]);

	// Create AudioContext + AnalyserNode on first play (once per audio element)
	const ensureAudioContext = useCallback(() => {
		if (audioCtxRef.current || !audioRef.current) return;
		try {
			const audioCtx = new AudioContext();
			const source = audioCtx.createMediaElementSource(
				audioRef.current,
			);
			const analyser = audioCtx.createAnalyser();
			analyser.fftSize = 256;
			analyser.smoothingTimeConstant = 0.8;
			source.connect(analyser);
			analyser.connect(audioCtx.destination);
			audioCtxRef.current = audioCtx;
			onAnalyserReadyRef.current?.(analyser);
		} catch {
			// AudioContext creation failed — audio plays normally without visualization
		}
	}, []);

	// Start audio playback for current sample
	const playAudio = useCallback(async () => {
		const audio = audioRef.current;
		if (!audio) return;

		audio.src = sample.audioSrc;
		audio.volume = 0.75;
		audio.muted = isMutedRef.current;

		try {
			ensureAudioContext();
			// Resume AudioContext if suspended (e.g. no user gesture yet)
			if (audioCtxRef.current?.state === "suspended") {
				await audioCtxRef.current.resume();
			}
			await audio.play();
			setIsAudioPlaying(true);
			onPlayingChangeRef.current?.(true);
		} catch {
			// Autoplay blocked by browser — user can click the play button
		}
	}, [sample.audioSrc, ensureAudioContext]);

	// Start typewriter + audio simultaneously when active sample changes
	useEffect(() => {
		if (!active) return;

		// Start audio immediately
		playAudio();

		// Start typewriter
		if (reducedMotionRef.current) {
			setDisplayedText(sample.text);
			setIsTyping(false);
			return;
		}

		charIdxRef.current = 0;
		setDisplayedText("");
		setIsTyping(true);

		typeTimerRef.current = setInterval(() => {
			charIdxRef.current++;
			setDisplayedText(sample.text.slice(0, charIdxRef.current));

			if (charIdxRef.current >= sample.text.length) {
				if (typeTimerRef.current) clearInterval(typeTimerRef.current);
				setIsTyping(false);
			}
		}, 40);

		return () => {
			if (typeTimerRef.current) clearInterval(typeTimerRef.current);
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps -- restartKey forces re-run when replaying from sample 0
	}, [active, sampleIdx, restartKey, sample.text, playAudio]);

	// Advance to next sample when audio ends
	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;

		const handleEnded = () => {
			setIsAudioPlaying(false);
			onPlayingChangeRef.current?.(false);
			pauseTimerRef.current = setTimeout(() => {
				setSampleIdx((prev) => {
					const next = (prev + 1) % SAMPLES.length;
					if (next === 0) setIsMuted(true);
					return next;
				});
			}, 100);
		};

		audio.addEventListener("ended", handleEnded);
		return () => {
			audio.removeEventListener("ended", handleEnded);
			if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
		};
	}, []);

	const handleReplay = useCallback(() => {
		const audio = audioRef.current;
		if (!audio) return;

		// Stop everything immediately
		if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
		if (typeTimerRef.current) clearInterval(typeTimerRef.current);
		audio.pause();
		setIsAudioPlaying(false);
		onPlayingChangeRef.current?.(false);

		// Wait 1 second, then reset to beginning of all samples
		pauseTimerRef.current = setTimeout(() => {
			setSampleIdx(0);
			setRestartKey((k) => k + 1);
			setActive(true);
		}, 1000);
	}, []);

	const handleToggleMute = useCallback(() => {
		setIsMuted((prev) => !prev);
	}, []);

	// Cleanup all timers and audio resources on unmount
	useEffect(() => {
		return () => {
			if (typeTimerRef.current) clearInterval(typeTimerRef.current);
			if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
			const audio = audioRef.current;
			if (audio) {
				audio.pause();
				audio.removeAttribute("src");
				audio.load();
			}
			if (audioCtxRef.current) {
				audioCtxRef.current.close();
			}
		};
	}, []);

	return (
		<div className="mx-auto w-full max-w-2xl text-center">
			{/* eslint-disable-next-line jsx-a11y/media-has-caption */}
			<audio ref={audioRef} preload="auto" />

			{/* Typewriter text — large, italic, in curly quotes */}
			<div className="relative min-h-[5rem] px-4 sm:min-h-[6rem]">
				<p className="text-xl leading-relaxed text-foreground/90 italic sm:text-2xl">
					<span className="select-none text-muted-foreground/40">
						&ldquo;
					</span>
					{displayedText}
					{isTyping && (
						<span
							className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[0.15em] bg-primary align-baseline"
							style={{
								animation: "hero-cursor 1s steps(1) infinite",
							}}
						/>
					)}
					<span className="select-none text-muted-foreground/40">
						&rdquo;
					</span>
				</p>
			</div>

			{/* Voice label + controls */}
			<div className="mt-4 flex items-center justify-center gap-2.5">
				{isAudioPlaying && (
					<span className="flex h-3.5 items-end gap-[2px]">
						<span
							className="hero-eq-bar w-[3px] origin-bottom rounded-full bg-primary"
							style={{
								height: "100%",
								animation: "hero-eq 0.6s ease-in-out infinite",
							}}
						/>
						<span
							className="hero-eq-bar w-[3px] origin-bottom rounded-full bg-primary"
							style={{
								height: "100%",
								animation:
									"hero-eq 0.6s ease-in-out infinite 0.15s",
							}}
						/>
						<span
							className="hero-eq-bar w-[3px] origin-bottom rounded-full bg-primary"
							style={{
								height: "100%",
								animation:
									"hero-eq 0.6s ease-in-out infinite 0.3s",
							}}
						/>
					</span>
				)}
				<button
					onClick={handleReplay}
					type="button"
					aria-label="Replay from beginning"
					className="inline-flex items-center p-1 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
				>
					<svg
						className="h-4.5 w-4.5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<polyline points="1 4 1 10 7 10" />
						<path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
					</svg>
				</button>
				<span className="text-xs text-muted-foreground">
					{sample.label}
				</span>
				<button
					onClick={handleToggleMute}
					type="button"
					aria-label={isMuted ? "Unmute" : "Mute"}
					className="inline-flex items-center p-1 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
				>
					{isMuted ? (
						<svg
							className="h-4.5 w-4.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M11 5L6 9H2v6h4l5 4V5z" />
							<line x1="23" y1="9" x2="17" y2="15" />
							<line x1="17" y1="9" x2="23" y2="15" />
						</svg>
					) : (
						<svg
							className="h-4.5 w-4.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M11 5L6 9H2v6h4l5 4V5z" />
							<path d="M19.07 4.93a10 10 0 010 14.14" />
							<path d="M15.54 8.46a5 5 0 010 7.07" />
						</svg>
					)}
				</button>
			</div>

			{/* Carousel dots */}
			<div className="mt-4 flex justify-center gap-1.5">
				{SAMPLES.map((_, i) => (
					<div
						key={i}
						className={`h-1.5 rounded-full transition-all duration-300 ${
							i === sampleIdx
								? "w-6 bg-primary"
								: "w-1.5 bg-muted-foreground/30"
						}`}
					/>
				))}
			</div>
		</div>
	);
}
