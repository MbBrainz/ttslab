/**
 * Copies wllama WASM assets from node_modules to public/wllama/.
 *
 * wllama must fetch its .wasm same-origin (cross-origin worker fetches fail
 * with SecurityErrors, same as the ONNX runtime assets — see
 * scripts/copy-onnx-wasm.mjs). Also copies the @wllama/wllama-compat assets
 * (Asyncify build without JSPI/MEMORY64) so Safari users need no CDN at
 * runtime; the wllama transport points setCompat() at these files.
 *
 * Runs automatically via the "postinstall" npm script (chained after
 * copy-onnx-wasm.mjs).
 */

import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

const projectRoot = join(dirname(import.meta.url.replace("file://", "")), "..");

// --- Default build (JSPI + MEMORY64; Chromium/Firefox) ---
const wllamaPkgDir = dirname(require.resolve("@wllama/wllama/package.json"));
const wllamaWasmSrc = join(wllamaPkgDir, "esm", "wasm", "wllama.wasm");
const wllamaOutDir = join(projectRoot, "public", "wllama");

mkdirSync(wllamaOutDir, { recursive: true });
cpSync(wllamaWasmSrc, join(wllamaOutDir, "wllama.wasm"));
console.log("Copied wllama.wasm to public/wllama/");

// --- Compat build (Asyncify, no JSPI/MEMORY64; Safari fallback) ---
const compatPkgDir = dirname(
	require.resolve("@wllama/wllama-compat/package.json"),
);
const compatOutDir = join(wllamaOutDir, "compat");

mkdirSync(compatOutDir, { recursive: true });

const compatFiles = ["wllama.wasm", "wllama.js"];
for (const file of compatFiles) {
	cpSync(join(compatPkgDir, "wasm", file), join(compatOutDir, file));
}

console.log(
	`Copied ${compatFiles.length} wllama-compat assets to public/wllama/compat/`,
);
