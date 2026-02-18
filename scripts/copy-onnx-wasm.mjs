/**
 * Copies ONNX Runtime WASM files from node_modules to public/onnx/.
 * This allows serving them from the same origin, avoiding cross-origin
 * Worker SecurityErrors in the browser.
 *
 * Runs automatically via the "postinstall" npm script.
 */

import { createRequire } from "node:module";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

// Resolve the onnxruntime-web dist directory used by @huggingface/transformers.
// require.resolve returns the package entry point (e.g. .../dist/ort.min.js),
// so dirname gives us the dist directory directly.
const distDir = dirname(
	require.resolve("onnxruntime-web", {
		paths: [dirname(require.resolve("@huggingface/transformers"))],
	}),
);
const outDir = join(dirname(import.meta.url.replace("file://", "")), "..", "public", "onnx");

mkdirSync(outDir, { recursive: true });

const files = [
	"ort-wasm-simd-threaded.asyncify.mjs",
	"ort-wasm-simd-threaded.asyncify.wasm",
	"ort-wasm-simd-threaded.mjs",
	"ort-wasm-simd-threaded.wasm",
];

for (const file of files) {
	cpSync(join(distDir, file), join(outDir, file));
}

console.log(`Copied ${files.length} ONNX WASM files to public/onnx/`);
