# Vendored eSpeak NG phonemizer (wasm2js build)

`espeakng.worker.js` is copied from
[xenova/phonemizer.js](https://github.com/xenova/phonemizer.js) at commit
`6835144b7ee9043129222549c1ed2f6a27216278` (2025-01-16), file `src/espeakng.worker.js`.

- License: Apache-2.0 (upstream LICENSE: https://github.com/xenova/phonemizer.js/blob/main/LICENSE)
- Self-contained: the eSpeak NG engine is a wasm2js (pure JS) build and the
  `espeak-ng-data` corpus is embedded as a base64 gzip blob inside the file,
  so no companion `.wasm`/`.data` files are needed.
- Loaded at runtime by `src/lib/inference/loaders/kitten-tts.ts` via a
  `webpackIgnore`/`turbopackIgnore` dynamic import (kept out of the bundle so
  it is only fetched when the KittenTTS Nano model is loaded).

To update: download the new `src/espeakng.worker.js`, replace this file, and
update the pinned commit above. Run the kitten demo in a browser afterwards —
there is no automated test for the phonemizer output.
