# TTSL-6: Voice Agent UX Overhaul: End-to-end testing, UI modernization, and dynamic interaction design

## Overview

The Voice Agent (/voice-agent) is TTSLab's flagship feature — a fully client-side conversational AI pipeline (Listen → Transcribe → Think → Speak) running Whisper-tiny.en (STT), LFM2.5 1.2B (LLM), and Kokoro-82M (TTS) entirely in the browser. This task covers two major workstreams:

### Workstream 1: End-to-End Voice Agent Testing

Perform comprehensive functional testing of the voice agent pipeline in a real browser environment to establish a quality baseline:

- **Model Loading**: Test download flow for all 3 models (STT/LLM/TTS), verify progress indicators, caching behavior, and error states
- **Pipeline Flow**: Validate the full Listen → Transcribe → Think → Speak loop with real microphone input
- **Latency & Responsiveness**: Measure time-to-first-audio, LLM tokens/sec, TTS RTF, and overall turn latency
- **Streaming Behavior**: Verify clause-level TTS extraction starts playback before LLM finishes generating
- **Barge-in**: Test interrupting the agent mid-speech and verify it stops cleanly
- **Edge Cases**: Empty speech, very long utterances, rapid sequential turns, model switching mid-conversation
- **Error Recovery**: What happens when a model fails to load, worker crashes, or audio context is blocked
- **Console Health**: Monitor for errors, warnings, memory leaks during extended conversations
- **Cross-voice Testing**: Test with different Kokoro voices (af_heart, af_bella, am_adam, am_michael)

### Workstream 2: UI/UX Modernization

The current voice agent UI is functional but utilitarian. Transform it into a visually compelling, dynamic experience that feels like talking to a living AI:

**Current State (to improve):**
- Static pipeline status indicator (text labels with colored dots)
- Basic conversation log (chat bubbles)
- Simple start/stop controls
- Model loader is a 3-column grid of cards
- StreamingVisualizer is a small 32-bar frequency chart
- Overall layout feels like a settings panel, not a conversational AI experience

**Desired Direction:**
- Immersive, full-viewport conversational experience
- Dynamic visual feedback that responds to voice/audio in real-time
- Smooth state transitions between pipeline phases (listening, thinking, speaking)
- Modern interaction patterns — think Apple Intelligence, ChatGPT Voice, or Gemini Live
- The UI should feel alive when the agent is active — ambient animations, audio-reactive elements
- Clean progressive disclosure: simple when idle, rich when active
- Mobile-first responsive design

**Specific UI Areas to Redesign:**
1. **Pipeline Status** — Replace text labels with an animated visual element (orb, waveform, particle system) that morphs between states
2. **Conversation Log** — More elegant message presentation, typing indicators, smooth scroll
3. **Audio Visualization** — Larger, more prominent, audio-reactive visualization during speaking
4. **Controls** — Floating/minimal controls that don't compete with the conversation
5. **Model Loading** — Streamlined onboarding flow rather than a technical model grid
6. **Overall Layout** — Full-height immersive layout, reduce chrome, maximize conversation space
7. **Micro-interactions** — Transitions between states, hover effects, loading animations

### Success Criteria

- Voice agent pipeline tested end-to-end with documented results
- Latency metrics captured for each pipeline stage
- All critical bugs or UX issues identified and cataloged
- New UI design proposed with mockups/descriptions approved by user
- Implementation plan ready for the approved design
- No regression in core functionality

## Implementation Plan

Full implementation plan: `docs/plans/2026-03-04-voice-agent-ui-redesign.md`

**Summary — 11 tasks:**

1. Create voice-agent layout (full-viewport, no footer)
2. Build VoiceAgentOrb component (CSS gradients + state transitions)
3. Build OrbCanvas audio-reactive ring (canvas, AnalyserNode)
4. Build BootSequence component (one-click Power On)
5. Build HUD metrics bar (monospace, low opacity)
6. Redesign ConversationLog (minimal fading, last 3 turns)
7. Build settings drawer (voice/LLM selection, transcript history)
8. Rewrite VoiceAgentDemo with new layout (compose all new components)
9. Polish: responsive sizing + reduced-motion
10. E2E browser test (functional + visual review)
11. Clean up deprecated components

**Approach:** CSS/SVG + canvas for orb (no WebGL). `useVoiceAgent` hook unchanged. All changes are UI-layer only.
