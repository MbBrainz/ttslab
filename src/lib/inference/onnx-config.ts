/**
 * Configures ONNX Runtime WASM to load from same-origin `/onnx/` paths
 * instead of the default CDN (cdn.jsdelivr.net).
 *
 * Must be called AFTER importing @huggingface/transformers (which sets CDN paths
 * at module evaluation time) and BEFORE calling pipeline() (which creates the
 * ONNX session).
 *
 * Without this, browsers block cross-origin Worker construction with:
 * "SecurityError: Failed to construct 'Worker': Script at 'https://cdn.jsdelivr.net/...'
 *  cannot be accessed from origin '...'"
 */

let configured = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function configureOnnxWasmPaths(env: { backends: { onnx: any } }) {
	if (configured) return;
	configured = true;

	// Override CDN wasmPaths with same-origin paths.
	// Files are served from public/onnx/ (copied from onnxruntime-web dist).
	if (env.backends.onnx?.wasm) {
		env.backends.onnx.wasm.wasmPaths = "/onnx/";
	}
}
