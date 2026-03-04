# Voice Agent Ambient UI Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the voice agent page from a utilitarian layout into an immersive, full-viewport ambient AI experience with an audio-reactive CSS/canvas orb.

**Architecture:** The page gets its own layout (no footer, minimal fading header). A central orb component uses CSS radial-gradient + box-shadow for the glow, with a canvas overlay for real-time audio ring visualization via AnalyserNode. The `useVoiceAgent` hook is unchanged — only UI components are rebuilt.

**Tech Stack:** React 19, Tailwind CSS v4 (oklch tokens), Canvas 2D API, CSS transitions/keyframes

---

### Task 1: Create voice-agent layout (no footer, immersive)

**Files:**
- Create: `src/app/(main)/voice-agent/layout.tsx`
- Modify: `src/app/(main)/voice-agent/page.tsx`

**Step 1: Create the voice-agent layout**

This overrides the parent layout's `<main>` padding and hides the footer for the voice agent page. The page renders full-height with its own minimal header.

```tsx
// src/app/(main)/voice-agent/layout.tsx
export default function VoiceAgentLayout({
	children,
}: { children: React.ReactNode }) {
	return (
		<div className="fixed inset-0 z-40 flex flex-col bg-background">
			{children}
		</div>
	);
}
```

**Step 2: Simplify the page to just render the client component**

```tsx
// src/app/(main)/voice-agent/page.tsx
import type { Metadata } from "next";
import { VoiceAgentClient } from "@/components/voice-agent/voice-agent-client";

export const metadata: Metadata = {
	title: "Voice Agent — Talk to AI in Your Browser with On-Device STT & TTS",
	description:
		"Talk to an AI voice agent running entirely in your browser. Whisper STT, LLM, and Kokoro TTS — all on-device. Zero server, zero data collection.",
};

export default function VoiceAgentPage() {
	return <VoiceAgentClient />;
}
```

**Step 3: Verify the page renders full-viewport**

Run: `pnpm dev` and navigate to `/voice-agent`
Expected: Full-screen dark background, no footer, no page padding

**Step 4: Commit**

```bash
git add src/app/\(main\)/voice-agent/layout.tsx src/app/\(main\)/voice-agent/page.tsx
git commit -m "feat(voice-agent): add immersive full-viewport layout"
```

---

### Task 2: Build the VoiceAgentOrb component

**Files:**
- Create: `src/components/voice-agent/voice-agent-orb.tsx`

The orb is a CSS div with layered radial gradients, box-shadow glow, and CSS transitions between states. It does NOT include the canvas ring (that's Task 3).

**Step 1: Create the orb component**

```tsx
// src/components/voice-agent/voice-agent-orb.tsx
"use client";

import { cn } from "@/lib/utils";
import type { AgentPhase } from "@/lib/hooks/use-voice-agent";

const ORB_STYLES: Record<AgentPhase, {
	gradient: string;
	shadow: string;
	scale: string;
	animation?: string;
}> = {
	idle: {
		gradient: "radial-gradient(circle, oklch(0.25 0.02 275) 0%, oklch(0.15 0.01 275) 70%)",
		shadow: "0 0 60px oklch(0.20 0.03 275 / 0.3)",
		scale: "scale-100",
	},
	listening: {
		gradient: "radial-gradient(circle, oklch(0.45 0.18 270) 0%, oklch(0.30 0.12 280) 60%, oklch(0.18 0.04 275) 100%)",
		shadow: "0 0 80px oklch(0.50 0.20 270 / 0.4), 0 0 160px oklch(0.40 0.15 280 / 0.2)",
		scale: "scale-100",
		animation: "orb-breathe",
	},
	transcribing: {
		gradient: "radial-gradient(circle, oklch(0.55 0.20 270) 0%, oklch(0.35 0.15 280) 60%, oklch(0.18 0.04 275) 100%)",
		shadow: "0 0 100px oklch(0.55 0.22 270 / 0.5), 0 0 180px oklch(0.45 0.18 280 / 0.25)",
		scale: "scale-102",
	},
	thinking: {
		gradient: "radial-gradient(circle, oklch(0.50 0.20 280) 0%, oklch(0.38 0.18 260) 50%, oklch(0.20 0.06 275) 100%)",
		shadow: "0 0 100px oklch(0.50 0.22 280 / 0.5), 0 0 200px oklch(0.40 0.16 260 / 0.3)",
		scale: "scale-100",
		animation: "orb-think",
	},
	speaking: {
		gradient: "radial-gradient(circle, oklch(0.60 0.22 300) 0%, oklch(0.50 0.20 270) 50%, oklch(0.25 0.08 275) 100%)",
		shadow: "0 0 120px oklch(0.55 0.25 300 / 0.5), 0 0 240px oklch(0.45 0.20 270 / 0.3)",
		scale: "scale-105",
		animation: "orb-speak",
	},
};

interface VoiceAgentOrbProps {
	phase: AgentPhase;
	children?: React.ReactNode;
}

export function VoiceAgentOrb({ phase, children }: VoiceAgentOrbProps) {
	const style = ORB_STYLES[phase];

	return (
		<div className="relative flex items-center justify-center">
			{/* Glow layer (behind orb) */}
			<div
				className={cn(
					"absolute h-48 w-48 rounded-full blur-xl transition-all duration-700 ease-out sm:h-56 sm:w-56",
					style.scale,
				)}
				style={{ background: style.gradient, opacity: phase === "idle" ? 0.3 : 0.5 }}
			/>
			{/* Main orb */}
			<div
				className={cn(
					"relative h-40 w-40 rounded-full transition-all duration-500 ease-out sm:h-48 sm:w-48",
					style.scale,
					style.animation,
				)}
				style={{
					background: style.gradient,
					boxShadow: style.shadow,
				}}
			/>
			{/* Canvas overlay slot */}
			{children}
		</div>
	);
}
```

**Step 2: Add orb keyframe animations to globals.css**

Append to `src/app/globals.css`:

```css
/* Voice Agent Orb animations */
@keyframes orb-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.03); }
}
@keyframes orb-think {
  0% { filter: hue-rotate(0deg); }
  100% { filter: hue-rotate(30deg); }
}
@keyframes orb-speak {
  0%, 100% { transform: scale(1.05); }
  50% { transform: scale(1.08); }
}
.orb-breathe { animation: orb-breathe 3s ease-in-out infinite; }
.orb-think { animation: orb-think 2s ease-in-out infinite alternate; }
.orb-speak { animation: orb-speak 1.5s ease-in-out infinite; }
```

**Step 3: Verify the orb renders**

Temporarily import VoiceAgentOrb in voice-agent-demo.tsx to verify it renders.
Expected: A round glowing element that responds to phase changes.

**Step 4: Commit**

```bash
git add src/components/voice-agent/voice-agent-orb.tsx src/app/globals.css
git commit -m "feat(voice-agent): add ambient AI orb component with state-based gradients"
```

---

### Task 3: Build the OrbCanvas audio-reactive ring

**Files:**
- Create: `src/components/voice-agent/orb-canvas.tsx`

A canvas element that renders an audio-reactive ring around the orb. Uses AnalyserNode frequency data (same as existing StreamingVisualizer) but draws a circular waveform.

**Step 1: Create the canvas component**

```tsx
// src/components/voice-agent/orb-canvas.tsx
"use client";

import { useEffect, useRef } from "react";
import type { AgentPhase } from "@/lib/hooks/use-voice-agent";

interface OrbCanvasProps {
	analyser: AnalyserNode | null;
	phase: AgentPhase;
	/** Diameter of the orb in px — ring renders around this */
	orbSize: number;
}

export function OrbCanvas({ analyser, phase, orbSize }: OrbCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rafRef = useRef(0);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

		const resize = () => {
			const dpr = window.devicePixelRatio || 1;
			const rect = canvas.getBoundingClientRect();
			canvas.width = rect.width * dpr;
			canvas.height = rect.height * dpr;
			ctx.scale(dpr, dpr);
		};

		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		resize();

		const draw = () => {
			rafRef.current = requestAnimationFrame(draw);
			const rect = canvas.getBoundingClientRect();
			const w = rect.width;
			const h = rect.height;
			ctx.clearRect(0, 0, w, h);

			if (!analyser || !dataArray) return;
			analyser.getByteFrequencyData(dataArray);

			const cx = w / 2;
			const cy = h / 2;
			const baseRadius = orbSize / 2 + 12; // ring just outside orb
			const segments = 64;
			const isActive = phase === "speaking" || phase === "listening";

			ctx.beginPath();
			for (let i = 0; i <= segments; i++) {
				const angle = (i / segments) * Math.PI * 2 - Math.PI / 2;
				const dataIdx = Math.floor((i / segments) * dataArray.length);
				const value = dataArray[dataIdx] / 255;
				const amplitude = isActive ? value * 20 : value * 6;
				const r = baseRadius + amplitude;
				const x = cx + Math.cos(angle) * r;
				const y = cy + Math.sin(angle) * r;
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.closePath();
			ctx.strokeStyle = phase === "speaking"
				? "oklch(0.65 0.20 300 / 0.6)"
				: "oklch(0.55 0.18 270 / 0.4)";
			ctx.lineWidth = 2;
			ctx.stroke();
		};

		rafRef.current = requestAnimationFrame(draw);
		return () => {
			cancelAnimationFrame(rafRef.current);
			observer.disconnect();
		};
	}, [analyser, phase, orbSize]);

	// Canvas overlays the orb area, centered
	const canvasSize = orbSize + 80; // enough room for ring amplitude
	return (
		<canvas
			ref={canvasRef}
			className="pointer-events-none absolute"
			style={{ width: canvasSize, height: canvasSize }}
		/>
	);
}
```

**Step 2: Verify canvas renders ring**

Import OrbCanvas inside VoiceAgentOrb's children slot. Pass analyser from audioQueue.
Expected: A faint ring around the orb that reacts to audio.

**Step 3: Commit**

```bash
git add src/components/voice-agent/orb-canvas.tsx
git commit -m "feat(voice-agent): add canvas audio-reactive ring overlay for orb"
```

---

### Task 4: Build the BootSequence component

**Files:**
- Create: `src/components/voice-agent/boot-sequence.tsx`

Replaces the 3-card AgentModelLoader with a single "Power On" button and animated loading progress.

**Step 1: Create the boot sequence component**

```tsx
// src/components/voice-agent/boot-sequence.tsx
"use client";

import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ModelState } from "@/components/model-status";
import { formatBytes } from "@/lib/format";

interface BootSequenceProps {
	sttState: ModelState;
	llmState: ModelState;
	ttsState: ModelState;
	onPowerOn: () => void;
	allReady: boolean;
}

function modelLabel(state: ModelState, name: string): string {
	switch (state.status) {
		case "not_loaded": return name;
		case "downloading": return `${name} ${state.progress != null ? `${Math.round(state.progress * 100)}%` : "..."}`;
		case "initializing": return `${name} initializing...`;
		case "ready": return `${name} ready`;
		case "error": return `${name} failed`;
		default: return name;
	}
}

function isLoading(state: ModelState) {
	return state.status === "downloading" || state.status === "initializing";
}

export function BootSequence({ sttState, llmState, ttsState, onPowerOn, allReady }: BootSequenceProps) {
	const anyLoading = isLoading(sttState) || isLoading(llmState) || isLoading(ttsState);
	const anyError = sttState.status === "error" || llmState.status === "error" || ttsState.status === "error";

	if (allReady) return null;

	return (
		<div className="flex flex-col items-center gap-6">
			{/* Model info */}
			<div className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
				<span className="tabular-nums">{modelLabel(sttState, "Whisper")}</span>
				<span className="tabular-nums">{modelLabel(llmState, "LFM2.5")}</span>
				<span className="tabular-nums">{modelLabel(ttsState, "Kokoro")}</span>
			</div>

			{/* Power On / Retry */}
			{!anyLoading && (
				<Button
					size="lg"
					onClick={onPowerOn}
					className="gap-2 rounded-full px-8"
				>
					<Zap className="h-5 w-5" />
					{anyError ? "Retry" : "Power On"}
				</Button>
			)}

			{!anyLoading && !anyError && (
				<p className="text-xs text-muted-foreground">
					3 models &middot; ~850 MB total
				</p>
			)}
		</div>
	);
}
```

**Step 2: Commit**

```bash
git add src/components/voice-agent/boot-sequence.tsx
git commit -m "feat(voice-agent): add one-click boot sequence component"
```

---

### Task 5: Build the HUD metrics bar

**Files:**
- Create: `src/components/voice-agent/hud-metrics.tsx`

Small monospace metrics line displayed below the orb at low opacity.

**Step 1: Create the HUD component**

```tsx
// src/components/voice-agent/hud-metrics.tsx
"use client";

import type { AgentMetrics } from "@/lib/hooks/use-voice-agent";
import { formatMs } from "@/lib/format";

interface HudMetricsProps {
	metrics: AgentMetrics;
	visible: boolean;
}

export function HudMetrics({ metrics, visible }: HudMetricsProps) {
	const hasAny = metrics.sttMs !== null || metrics.llmTokensPerSec !== null || metrics.ttsRtf !== null;
	if (!hasAny || !visible) return null;

	return (
		<div className="flex items-center justify-center gap-3 font-mono text-xs tabular-nums text-muted-foreground/50 transition-opacity duration-500">
			{metrics.sttMs !== null && <span>STT {formatMs(metrics.sttMs)}</span>}
			{metrics.llmTokensPerSec !== null && <span>LLM {metrics.llmTokensPerSec} tok/s</span>}
			{metrics.ttsRtf !== null && <span>TTS {metrics.ttsRtf.toFixed(2)}x</span>}
		</div>
	);
}
```

**Step 2: Commit**

```bash
git add src/components/voice-agent/hud-metrics.tsx
git commit -m "feat(voice-agent): add HUD metrics overlay component"
```

---

### Task 6: Redesign ConversationLog to minimal fading style

**Files:**
- Modify: `src/components/voice-agent/conversation-log.tsx`

Replace the bordered scrollable chat with a minimal, last-3-turns transcript that fades older turns.

**Step 1: Rewrite the conversation log**

Replace the full contents of `conversation-log.tsx` with a version that:
- Shows only the last 3 turns (plus streaming)
- Older turns have lower opacity
- No border/background — just text on the dark background
- Prefix style ("You:" / "Agent:") instead of chat bubbles
- Streaming text gets a subtle cursor

Key changes:
- Remove the `h-64 overflow-y-auto rounded-lg border` container
- Slice `turns` to last 3
- Map opacity: oldest=0.3, middle=0.5, newest=1.0
- Remove per-turn metrics (moved to HUD)

**Step 2: Verify in browser**

Expected: Minimal text showing last few conversation turns, older ones dimmer.

**Step 3: Commit**

```bash
git add src/components/voice-agent/conversation-log.tsx
git commit -m "feat(voice-agent): redesign conversation log to minimal fading transcript"
```

---

### Task 7: Build settings drawer

**Files:**
- Create: `src/components/voice-agent/settings-drawer.tsx`

A slide-out panel (from right) containing voice selector, LLM model selector, and full transcript history. Triggered by a gear icon.

**Step 1: Create the settings drawer**

Uses existing `Dialog` component (Radix-based) styled as a right-side drawer. Contains:
- Voice `<Select>` (Kokoro voices)
- LLM `<Select>` (LLM_MODELS)
- Full conversation history (scrollable)
- Close button

**Step 2: Commit**

```bash
git add src/components/voice-agent/settings-drawer.tsx
git commit -m "feat(voice-agent): add settings drawer with voice/LLM selection"
```

---

### Task 8: Rewrite VoiceAgentDemo with new layout

**Files:**
- Modify: `src/components/voice-agent/voice-agent-demo.tsx`

This is the main composition task. Replace the current `space-y-6` layout with the full-viewport immersive layout using all new components.

**Step 1: Rewrite the demo component**

The new layout structure:
```
<div className="flex h-dvh flex-col">
  {/* Header: minimal, fades when active */}
  <header> TTSLab · Voice Agent  [⚙] [✕] </header>

  {/* Center: orb zone */}
  <div className="flex flex-1 flex-col items-center justify-center gap-4">
    <VoiceAgentOrb phase={phase}>
      <OrbCanvas analyser={audioQueue?.analyserNode} phase={phase} orbSize={192} />
    </VoiceAgentOrb>

    {/* State label */}
    <p>{phase label}</p>

    {/* Boot sequence (shown when not all ready) */}
    <BootSequence ... />

    {/* HUD metrics */}
    <HudMetrics metrics={metrics} visible={phase !== "idle"} />
  </div>

  {/* Bottom: transcript + mic button */}
  <div className="px-4 pb-6">
    <ConversationLog turns={conversation} streamingText={streamingText} isStreaming={isStreaming} />

    {/* Floating mic button */}
    <div className="flex justify-center pt-4">
      <button onClick={isActive ? onStop : onStart}>
        {isActive ? <Square /> : <Mic />}
      </button>
    </div>
  </div>

  {/* Settings drawer */}
  <SettingsDrawer ... />
</div>
```

Key changes from current:
- Remove `AgentModelLoader` (replaced by `BootSequence`)
- Remove `PipelineStatus` (replaced by orb state + label)
- Remove `AgentControls` (replaced by floating mic + settings drawer)
- Remove `StreamingVisualizer` (replaced by `OrbCanvas`)
- Header fades to `opacity-20` when `phase !== "idle"`
- Close button (✕) links back to `/` via `next/link`

**Step 2: Verify full flow in browser**

Navigate to `/voice-agent`. Expected:
- Full dark viewport with centered dormant orb
- "Power On" button below orb
- Click Power On → models load → orb transitions to Listening
- Speak → orb morphs through states → transcript appears at bottom
- Settings gear opens drawer

**Step 3: Commit**

```bash
git add src/components/voice-agent/voice-agent-demo.tsx
git commit -m "feat(voice-agent): rewrite demo with immersive orb-centered layout"
```

---

### Task 9: Polish and responsive adjustments

**Files:**
- Modify: `src/components/voice-agent/voice-agent-orb.tsx`
- Modify: `src/components/voice-agent/voice-agent-demo.tsx`
- Modify: `src/app/globals.css`

**Step 1: Mobile responsive**

- Orb: `h-32 w-32 sm:h-40 sm:w-40 md:h-48 md:w-48`
- Transcript: reduce to last 2 turns on mobile
- Mic button: larger touch target on mobile (`h-14 w-14`)

**Step 2: prefers-reduced-motion**

Add to globals.css:
```css
@media (prefers-reduced-motion: reduce) {
  .orb-breathe, .orb-think, .orb-speak {
    animation: none !important;
  }
}
```

**Step 3: Test on narrow viewport**

Resize browser to 375px width. Expected: Orb scales down, transcript compact, mic button usable.

**Step 4: Commit**

```bash
git add src/components/voice-agent/ src/app/globals.css
git commit -m "feat(voice-agent): add responsive sizing and reduced-motion support"
```

---

### Task 10: E2E browser test of the full flow

**Files:** None (testing only)

**Step 1: Start dev server**

```bash
pnpm dev
```

**Step 2: Run frontend-functional-tester**

Use the `frontend-functional-tester` sub-agent with this prompt:

```
Test the Voice Agent at http://localhost:3001/voice-agent.

Steps:
1. Navigate to the page. Verify: full-viewport dark background, centered orb (dormant/dark), "Power On" button visible.
2. Check there is NO footer, NO page heading, minimal header.
3. Click "Power On". Monitor console. Wait for all 3 models to load (may take 2-3 minutes).
4. Verify: orb transitions to "Listening" state (blue-purple glow, breathing animation).
5. Verify: microphone permission was requested.
6. Check settings gear icon opens a drawer with voice and LLM selectors.
7. Check HUD metrics appear after first interaction.
8. Report: visual state of orb, any console errors, layout issues, responsive behavior.
```

**Step 3: Run frontend-visual-reviewer**

Use the `frontend-visual-reviewer` sub-agent to check visual quality, spacing, a11y.

**Step 4: Fix any issues found**

**Step 5: Commit fixes**

```bash
git commit -m "fix(voice-agent): address review findings from E2E testing"
```

---

### Task 11: Clean up deprecated components

**Files:**
- Verify unused: `src/components/voice-agent/pipeline-status.tsx`
- Verify unused: `src/components/voice-agent/agent-model-loader.tsx`
- Verify unused: `src/components/voice-agent/agent-controls.tsx`

**Step 1: Verify no imports remain**

```bash
grep -r "PipelineStatus\|AgentModelLoader\|AgentControls" src/ --include="*.tsx" --include="*.ts"
```

If only the definition files show up, delete them.

**Step 2: Delete unused files**

```bash
rm src/components/voice-agent/pipeline-status.tsx
rm src/components/voice-agent/agent-model-loader.tsx
rm src/components/voice-agent/agent-controls.tsx
```

**Step 3: Commit**

```bash
git add -u src/components/voice-agent/
git commit -m "chore(voice-agent): remove deprecated pipeline-status, agent-model-loader, agent-controls"
```
