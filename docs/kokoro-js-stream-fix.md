# Bug: `stream()` hangs on last sentence when called with a string

## Summary

`Kokoro.stream(text)` hangs indefinitely after yielding the second-to-last sentence. The internal `TextSplitterStream` is never closed, so the async iterator waits forever for more input.

## Reproduction

```js
const tts = await Kokoro.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX");

// This hangs after yielding all but the final sentence
for await (const chunk of tts.stream("Hello world. This is a test.")) {
  console.log(chunk.text);
}
// Never reaches here
```

## Root Cause

In `src/kokoro.js`, the `stream()` method creates a `TextSplitterStream` when receiving a string, but never calls `close()`:

```js
async *stream(text, { voice = "af_heart", speed = 1, split_pattern = null } = {}) {
  const language = this._validate_voice(voice);

  let splitter;
  if (text instanceof TextSplitterStream) {
    splitter = text;
  } else if (typeof text === "string") {
    splitter = new TextSplitterStream();
    const chunks = split_pattern
      ? text.split(split_pattern).map(c => c.trim()).filter(c => c.length > 0)
      : [text];
    splitter.push(...chunks);
    // BUG: splitter.close() is never called
  } else {
    throw new Error("Invalid input type. Expected string or TextSplitterStream.");
  }

  for await (const sentence of splitter) {
    // ...
  }
}
```

Without `close()`:

1. The async iterator yields all parsed sentences from `_sentences`
2. When the queue is empty, it checks `this._closed` -- still `false`
3. It enters `await new Promise(resolve => { this._resolver = resolve })` and waits forever
4. `close()` also calls `flush()`, which pushes any remaining buffer as the final sentence -- so the last text fragment is lost too

## Fix

Add `splitter.close()` after `splitter.push(...)`:

```diff
     splitter.push(...chunks);
+    splitter.close();
   } else {
```

This signals end-of-input, flushes the remaining buffer, and lets the async iterator terminate naturally. The `TextSplitterStream` branch is unaffected since callers manage their own `close()`.
