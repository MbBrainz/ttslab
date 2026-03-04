# ttslab

## Lattice

> **MANDATORY: This project has Lattice initialized (`.lattice/` exists). You MUST use Lattice to track all work. Creating tasks, updating statuses, and following the workflow below is not optional — it is a hard requirement. Failure to track work in Lattice is a coordination failure: other agents and humans cannot see, build on, or trust untracked work. If you are about to write code and no Lattice task exists for it, stop and create one first.**

Lattice is file-based, event-sourced task tracking built for minds that think in tokens and act in tool calls. The `.lattice/` directory is the coordination state — it lives alongside the code, not behind an API.

### Creating Tasks (Non-Negotiable)

Before you plan, implement, or touch a single file — the task must exist in Lattice. This is the first thing you do when work arrives.

```
lattice create "<title>" --actor agent:<your-id>
```

**Create a task for:** Any work that will produce commits — features, bugs, refactors, cleanup, pivots.

**Skip task creation only when:** The work is a sub-step of a task you're already tracking (lint fixes within your feature, test adjustments from your change), pure research with no deliverable, or work explicitly scoped under an existing task.

When in doubt, create the task. A small task costs nothing. Lost visibility costs everything.

**Recurring observations become tasks.** If you observe the same issue in 2+ consecutive sessions or advances (e.g., a failing test, a lint warning, a flaky behavior), create a task for it. Agents are disciplined about tracking assigned work but not discovered work — this convention closes that gap. Create discovered issues at `needs_human` if they need scoping, or `backlog` if they're well-understood.

### Descriptions Carry Context

Descriptions tell *what* and *why*. Plan files tell *how*.

- **Fully specified** (bug located, fix named, files identified): still go through `in_planning`, but the plan can be a single line (e.g., "Fix the typo on line 77"). Mark `complexity: low`.
- **Clear goal, open implementation**: go through `in_planning`. The agent figures out the approach and writes a substantive plan.
- **Decision context from conversations**: bake decisions and rationale into the description — without it, the next agent re-derives what was already decided.

### Status Transitions

Every transition is an immutable, attributed event. **The cardinal rule: update status BEFORE you start the work, not after.** If the board says `backlog` but you're actively working, the board is lying and every mind reading it makes decisions on false information.

```
lattice status <task> <status> --actor agent:<your-id>
```

```
backlog → in_planning → planned → in_progress → review → done
                                       ↕            ↕
                                    blocked      needs_human
```

**Transition discipline:**
- `in_planning` — before you open the first file to read. Then write the plan.
- `planned` — only after the plan file has real content.
- `in_progress` — before you write the first line of code.
- `review` — when implementation is complete, before review starts. Then actually review.
- `done` — only after a review has been performed and recorded.
- Spawning a sub-agent? Update status in the parent context first.

### Sub-Agent Execution Model

Each lifecycle stage gets its own sub-agent with fresh context. This is the default execution pattern — not a suggestion, not complexity-gated. Every task, every time.

**Why this matters:** When a planning agent writes a plan and a separate implementation agent reads it, the plan *must* be clear and complete — there's no shared context to fall back on. This forces better plans. When a review agent reads the diff cold, it catches things the implementer's context-polluted mind would miss. The plan file and git diff are the handoff artifacts.

**The three sub-agents:**

| Stage | Sub-agent does | Reads | Produces |
|-------|---------------|-------|----------|
| **Plan** | Explore codebase, write plan, move to `planned` | Task description | Plan file |
| **Implement** | Read plan, build it, test, commit, move to `review` | Plan file | Committed code |
| **Review** | Read diff cold, review against acceptance criteria, record findings | Git diff + plan | Review comment (`--role review`), move to `done` |

**The parent orchestrator** (the main agent session) manages the lifecycle:
1. Move the task to `in_planning` before spawning the planning sub-agent.
2. After the planner finishes, move to `in_progress` and spawn the implementation sub-agent.
3. After the implementer finishes, the review sub-agent runs independently.

Each sub-agent should use a distinct actor ID (e.g., `agent:claude-opus-4-planner`, `agent:claude-opus-4-impl`, `agent:claude-opus-4-reviewer`) so the event log shows who did what.

### The Planning Gate

The plan file lives at `.lattice/plans/<task_id>.md` — scaffolded on creation, empty until you fill it.

This is the **planning sub-agent's** job. Spawn a sub-agent whose sole purpose is to explore the codebase, understand the problem, and write the plan. It should:
1. Read the task description and any linked context.
2. Explore the relevant source files — understand existing patterns and constraints.
3. Write the plan to `.lattice/plans/<task_id>.md` — scope, approach, key files, acceptance criteria. For trivial tasks, a single sentence is fine. For substantial work, be thorough.
4. Move to `planned` only when the plan file reflects what it intends to build.

**The test:** If you moved to `planned` and the plan file is still empty scaffold, you didn't plan. Every task gets a plan — even trivial tasks get a one-line plan. The CLI enforces this: transitioning to `in_progress` is blocked when the plan is still scaffold.

### The Review Gate

Moving to `review` is a commitment to actually review the work.

This is the **review sub-agent's** job. Spawn a sub-agent with fresh context — it did NOT write the code and comes in cold. It should:
1. Read the plan file to understand what was supposed to be built.
2. Read the git diff to see what was actually built.
3. Run tests and linting to verify nothing is broken.
4. Compare the implementation against the plan's acceptance criteria.
5. Record findings with `lattice comment --role review` — what was reviewed, what was found, and whether it meets acceptance criteria.

**When moving to `done`:** If the completion policy blocks you for a missing review artifact, do the review. Do not `--force` past it. `--force --reason` is for genuinely exceptional cases, not a convenience shortcut.

**The test:** If the same agent that wrote the code also reviewed it without a fresh context boundary, the review gate is not doing its job. The whole point is independent verification.

### Review Rework Loop

When a review agent evaluates work, it produces one of three outcomes:

1. **Pass (with optional minor fix):** The review agent uses vibes-based judgment. If the only issues are trivial (obvious typos, missing semicolons, etc.), fix them inline, record what was changed in the review comment, and move to `done`. No strict line-count threshold — the review agent decides.

2. **Fail — implementation-level:** The plan was sound but the implementation has issues. The review agent explicitly states "implementation-level rework needed" in its comment. The orchestrator transitions the task `review -> in_progress`. Critical findings from the review are appended to the plan file under a new `## Review Cycle N Findings` section. A fresh sub-agent is encouraged (but not mandated) for the rework.

3. **Fail — plan-level:** The original plan was flawed — wrong approach, missing requirements, etc. The review agent explicitly states "plan-level rework needed" in its comment. The orchestrator transitions the task `review -> in_planning`. The plan gets reworked (not just amended), then back through the full lifecycle.

**Who decides what:**

| Decision | Who | How |
|----------|-----|-----|
| Fix inline vs send back | Review agent | Vibes-based judgment, recorded in review comment |
| Implementation-level vs plan-level | Review agent | Explicitly stated in review comment |
| Route to in_progress vs in_planning | Orchestrator | Follows review agent's recommendation |
| Whether to spawn fresh sub-agent | Orchestrator | Encouraged by convention, not enforced |

**3-cycle safety valve:** After 3 review-to-rework transitions (any combination of `review -> in_progress` and `review -> in_planning`), the CLI blocks the 4th attempt. The error message instructs the agent to move the task to `needs_human` with a comment explaining the situation. The limit is configurable via `review_cycle_limit` in the workflow config (default: 3). Override with `--force --reason` for genuinely exceptional cases.

**Allowed lifecycle paths:**

```
Normal:       in_progress -> review -> done
Minor fix:    in_progress -> review -> (fix inline) -> done
1 impl rework: in_progress -> review -> in_progress -> review -> done
1 plan rework: in_progress -> review -> in_planning -> planned -> in_progress -> review -> done
Max cycles:   3 review->rework transitions, then CLI blocks -> needs_human
```

### When You're Stuck

Use `needs_human` when you need human decision, approval, or input. This is distinct from `blocked` (generic external dependency) — it creates a scannable queue.

```
lattice status <task> needs_human --actor agent:<your-id>
lattice comment <task> "Need: <what you need, in one line>" --actor agent:<your-id>
```

Use for: design decisions requiring human judgment, missing access/credentials, ambiguous requirements, approval gates. The comment is mandatory — explain what you need in seconds, not minutes. The human's queue should be scannable.

### Actor Attribution

Every operation requires `--actor`. Attribution follows authorship of the *decision*, not the keystroke.

- Agent decided autonomously → `agent:<id>`
- Human typed it directly → `human:<id>`
- Human meaningfully shaped the outcome → `human:<id>` (agent was the instrument)

When in doubt, credit the human.

### Branch Linking

Link feature branches to tasks: `lattice branch-link <task> <branch-name> --actor agent:<your-id>`. Auto-detection works when the branch contains the short code (e.g., `feat/LAT-42-login`), but explicit linking is preferred.

### Leave Breadcrumbs

You are not the last mind that will touch this work. Use `lattice comment` for what you tried, chose, and left undone. Use `plans/<task_id>.md` for structured plans and `notes/<task_id>.md` for working notes and context dumps. The record you leave is the only bridge to the next agent's context.

### Shared Worktree Discipline

Multiple agents may work in the same repository concurrently on different tasks. The `git status` snapshot from your session start goes stale the moment another agent commits.

**When you encounter unfamiliar changes** (unexpected files, diffs you didn't make, new commits on HEAD):
1. **Investigate first.** Check `git log` and `lattice list` to see if another task/agent is responsible.
2. **Ask "who made this?" before "this shouldn't be here."** The change is almost certainly another agent's legitimate work.
3. **Never revert, reset, or delete changes you can't attribute.** If you're unsure, leave them alone and ask the human.

This applies to uncommitted changes in the working tree, unexpected commits on the branch, and new files that weren't there when your session started. The instinct to "clean up" unfamiliar state is exactly wrong in a multi-agent worktree — it destroys a sibling agent's work.

### Where Learnings Go

When you discover something important about how this project works — a pattern, a gotcha, a convention — **do not save it to auto-memory**. Memory is per-session and per-user; future Lattice agents in other installations will never see it. Instead, add it to this project's `CLAUDE.md` (for project-specific conventions) or propose updating the Lattice template (for universal patterns that should ship with every `lattice init`). The goal: every future agent, in every future installation, benefits from what you learned.

### Quick Reference

```
lattice create "<title>" --actor agent:<id>
lattice status <task> <status> --actor agent:<id>
lattice assign <task> <actor> --actor agent:<id>
lattice comment <task> "<text>" --actor agent:<id>
lattice link <task> <type> <target> --actor agent:<id>
lattice branch-link <task> <branch> --actor agent:<id>
lattice next [--actor agent:<id>] [--claim]
lattice show <task>
lattice list
```

**Useful flags:**
- `--quiet` — prints only the task ID (scripting: `TASK=$(lattice create "..." --quiet)`)
- `--json` — structured output: `{"ok": true, "data": ...}` or `{"ok": false, "error": ...}`
- `lattice list --status in_progress` / `--assigned agent:<id>` / `--tag <tag>` — filters
- `lattice link <task> subtask_of|depends_on|blocks <target>` — task relationships

For the full CLI reference, see the `/lattice` skill.

## E2E TTS Model Testing

### Why This Matters

Previous agents claimed models worked when they only verified code compiled — they never tested the actual browser flow. **Every model integration must be validated end-to-end in the browser** before being considered done.

### Automated Test via `frontend-functional-tester`

Use the `frontend-functional-tester` sub-agent to verify a TTS model loads, generates, and produces real audio. The dev server must be running first (`pnpm dev`).

**Prompt template** (customize `MODEL_SLUG` and `MODEL_NAME`):

```
You are testing the TTS Lab web app at http://localhost:3001. Perform an end-to-end functional test of a TTS model.

**Test target:** http://localhost:3001/models/{MODEL_SLUG}

**Steps:**
1. Navigate to the model page. Verify "{MODEL_NAME}" heading and demo section are visible.
2. Open browser console and monitor ALL output throughout.
3. Click "Download" to load the model. Wait for status to show "Ready" (check every 15s).
4. Enter text in the textarea (id: tts-text-{MODEL_SLUG}): "Hello, this is a test."
5. Click "Generate Speech" and wait for completion (up to 120s).
6. Verify: WaveformPlayer shows non-flat waveform, metrics are displayed, Download audio link exists.

**Report:** Step results (pass/fail), ALL console errors/warnings, time for download and generation, waveform assessment (flat vs real audio shapes).
```

### Known Limitations

- **WebGPU cannot be tested in headless Playwright** — the browser has no GPU adapter, so `selectBackend()` always falls back to WASM. WebGPU testing requires a real browser with GPU access.
- **Backend is auto-selected** — `tts-demo.tsx` hardcodes `backend: "auto"`. There is no UI for users to force WebGPU.
- **Large models take minutes** — Chatterbox Turbo (~720MB) takes ~3 minutes to download on broadband.

### Verified Model Behavior (2026-03-04)

| Model | WASM | WebGPU | Notes |
|-------|------|--------|-------|
| Kokoro 82M | PASS (249s load, 2.4s gen) | Not tested | Baseline reference |
| Chatterbox Turbo | PASS (181s load, 6.3s gen) | BLOCKED — WASM-only | Browser JSEP WebGPU EP has no INT64 Cast kernel; ONNX spec requires INT64 for Shape/Unsqueeze. Unsolvable by model patching. |

### WebGPU-Specific Debugging

When a model fails on WebGPU:
1. Check if `navigator.gpu.requestAdapter()` returns an adapter (not null)
2. Check console for INT64-related ONNX errors
3. Check console for "unsupported operator" or "execution provider" errors
4. Verify the model repo has WebGPU-compatible ONNX files (no INT64 ops)
5. Test on WASM first to isolate whether the issue is WebGPU-specific
