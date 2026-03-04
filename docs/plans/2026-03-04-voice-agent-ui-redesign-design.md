# Voice Agent UI Redesign — Design Document

**Date**: 2026-03-04
**Lattice Task**: TTSL-6
**Status**: Approved

## Overview

Transform the voice agent page from a utilitarian settings-panel layout into an immersive, ambient AI experience centered on an audio-reactive orb. The orb is the primary UI element — it communicates pipeline state, audio activity, and agent "aliveness" through gradients, animations, and canvas-rendered audio visualization.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary vibe | Ambient AI orb | Immersive, minimal chrome, sci-fi feel |
| Model onboarding | One-click "Power On" | Single CTA, cinematic boot sequence |
| Transcript prominence | Subtle & secondary | Orb dominates; last 2-3 turns shown faded |
| Metrics display | Discreet HUD | Small monospace at ~40% opacity, always visible |
| Rendering approach | CSS/SVG + canvas | No WebGL dep, lightweight, audio-reactive via canvas |

## Architecture

### Layout

Full-viewport height (`h-dvh`), dark background. Three zones stacked vertically:

1. **Header** (minimal) — App name, settings gear, close. Fades to low opacity when agent is active.
2. **Orb zone** (dominant, ~60% of viewport) — Centered orb with state label below it, metrics bar below that.
3. **Transcript zone** (bottom ~25%) — Last 2-3 conversation turns, faded style. Floating mic button at very bottom.

### The Orb

A CSS `radial-gradient` div with `backdrop-filter: blur` and layered `box-shadow` for glow. State transitions via CSS `transition` (~300ms ease-out). A `<canvas>` element overlays the orb for real-time audio-reactive ring visualization driven by `AnalyserNode` frequency data.

**States:**

| State | Gradient | Animation | Canvas Ring |
|-------|----------|-----------|-------------|
| Off/Dormant | Dark gray → charcoal | Slow breathing pulse (scale 0.98–1.0) | None |
| Booting | Gradually fills with color per model | Expanding rings on each model load | Loading arc |
| Listening | Blue-purple, soft glow | Gentle pulse (scale 1.0–1.02) | Mic volume ring |
| Transcribing | Brief bright shimmer | Quick ripple | Fading ring |
| Thinking | Rotating gradient (swirl) | Gradient animation, orbiting dots | Subtle pulse |
| Speaking | Warm vibrant (pink-orange) | Scale 1.0–1.05, shadow expansion | Audio waveform ring |

### Boot Sequence

Before models load:
- Dormant orb centered on dark background
- Below orb: "3 models / ~850MB" info text
- Single "Power On" button (prominent CTA)
- Optional voice/settings selector beneath

On "Power On":
1. Orb begins glowing, first ring expands (STT downloading)
2. Second ring appears (LLM downloading)
3. Third ring (TTS downloading)
4. All rings collapse into orb — it pulses to "Listening" state
5. Mic activates automatically

Progress shown as percentage near the orb, not as separate cards.

### Transcript

- Shows last 2-3 conversation turns only
- Older turns fade out (opacity transition)
- Minimal styling: no chat bubbles, just "You:" and "Agent:" prefixed text
- Current agent response streams in with a typing/fade effect
- Full history available in settings drawer

### Metrics HUD

- Single line: `STT 42ms · LLM 14 t/s · TTS 0.7x`
- Monospace font, `font-variant-numeric: tabular-nums`
- ~40% opacity, positioned below orb/above transcript
- Updates in-place (no layout shift)

### Controls

- **Mic button**: Large floating circle at bottom center. Toggles start/stop.
- **Settings gear**: Top-right, opens slide-out drawer with:
  - Voice selector (Kokoro voices)
  - LLM model selector
  - Metrics toggle
  - Full transcript history
- **Close/back**: Top-left or top-right, returns to TTSLab main nav

### State Transitions

All transitions use CSS with ~300ms ease-out:
- Gradient color shifts smoothly
- Scale changes (subtle, never jarring)
- Canvas ring intensity tracks audio amplitude
- State label crossfades
- Header opacity reduces when agent becomes active

## Components to Create/Modify

### New Components
- `VoiceAgentOrb` — The central orb with CSS states + canvas ring
- `OrbCanvas` — Canvas overlay for audio-reactive ring visualization
- `BootSequence` — One-click power-on flow with progress animation
- `VoiceAgentHUD` — Metrics display bar

### Modified Components
- `VoiceAgentDemo` — Rewrite layout to full-viewport immersive
- `ConversationLog` — Simplify to last 2-3 turns with fade
- `AgentControls` — Replace with floating mic button
- `PipelineStatus` — Replace with orb state (remove text-based status)
- `AgentModelLoader` — Replace with boot sequence (remove 3-card grid)

### Removed/Deprecated
- `PipelineStatus` (current text-label version)
- `AgentModelLoader` (current 3-card grid version)

## Technical Constraints

- No WebGL/Three.js — CSS + canvas only
- Must work alongside ONNX WASM inference (no GPU contention)
- Canvas updates via `requestAnimationFrame` at display refresh rate
- AnalyserNode data comes from existing AudioQueue's analyserNode
- Mobile responsive: orb scales down, transcript collapses further
- Dark theme only for this page (matches ambient feel)

## Out of Scope

- Voice agent logic changes (STT/LLM/TTS pipeline stays the same)
- New model integrations
- Settings persistence beyond current localStorage approach
- Accessibility for screen readers of the orb (keep existing ARIA on controls)
