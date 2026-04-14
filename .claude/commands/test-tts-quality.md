Run the TTS quality test suite. Uses the internal test page at /internal/tts-quality with the frontend-functional-tester agent to validate all (or specific) TTS models.

Usage: /test-tts-quality [model-slug]
- No args: test all supported TTS models
- With slug: test single model (e.g., /test-tts-quality kokoro-82m)

Steps:
1. Read the skill file at .claude/skills/tts-quality-test.md for full context
2. Ensure dev server is running (start in tmux if needed)
3. Launch frontend-functional-tester agent using the appropriate prompt template from the skill (Option A for all, Option B for single model)
4. Parse the JSON results
5. Report findings grouped by severity
6. If any model FAILs: investigate the loader code, propose fixes
