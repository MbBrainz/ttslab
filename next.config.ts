import { createRequire } from "node:module";
import path from "node:path";
import type { NextConfig } from "next";

// Dynamically resolve the correct onnxruntime-common version by walking the
// dependency chain: @huggingface/transformers → onnxruntime-web → onnxruntime-common.
// This avoids hardcoding pnpm store hashes and survives dependency updates.
const require_ = createRequire(import.meta.url);
const ortWebDir = path.dirname(
	require_.resolve("onnxruntime-web", {
		paths: [
			path.dirname(require_.resolve("@huggingface/transformers")),
		],
	}),
);
// Package root of onnxruntime-web (ortWebDir is …/dist, go one level up)
const ortWebPkgRoot = path.resolve(ortWebDir, "..");
const ortCommonPath = path.dirname(
	require_.resolve("onnxruntime-common", { paths: [ortWebDir] }),
);

const nextConfig: NextConfig = {
	// Prevent server-side bundling of ONNX packages
	serverExternalPackages: [
		"onnxruntime-node",
		"onnxruntime-web",
		"onnxruntime-common",
		"@huggingface/transformers",
		"kokoro-js",
		"sharp",
		"@huggingface/tokenizers",
	],

	// Allow HuggingFace CDN for model files
	async headers() {
		return [
			{
				source: "/(.*)",
				headers: [
					{
						key: "Cross-Origin-Embedder-Policy",
						value: "credentialless",
					},
					{
						key: "Cross-Origin-Opener-Policy",
						value: "same-origin",
					},
				],
			},
		];
	},

	// Turbopack equivalent of the webpack resolve alias below
	turbopack: {
		resolveAlias: {
			"onnxruntime-common": ortCommonPath,
			"onnxruntime-web": ortWebPkgRoot,
		},
	},

	webpack: (config, { isServer }) => {
		if (!isServer) {
			// Ensure WASM async compilation is enabled
			config.experiments = {
				...config.experiments,
				asyncWebAssembly: true,
			};
			// Ensure globalObject is 'self' for web workers
			config.output = {
				...config.output,
				globalObject: "self",
			};

			// CRITICAL: Force resolve onnxruntime-common to the correct version.
			// Multiple versions can exist; the alias ensures the v1.25.0-dev version
			// (with the `location` getter) is used everywhere, preventing
			// "invalid data location: undefined" errors at inference time.
			//
			// The "onnxruntime-web-use-extern-wasm" condition tells onnxruntime-web
			// to use the non-bundle entry (e.g. ort.webgpu.min.mjs instead of
			// ort.webgpu.bundle.min.mjs). The bundle variant embeds the WASM module
			// inline which breaks import.meta.url resolution inside webpack chunks.
			// The extern variant loads the WASM module dynamically via the wasmPaths
			// override we set in configureOnnxWasmPaths().
			config.resolve = {
				...config.resolve,
				alias: {
					...config.resolve?.alias,
					"onnxruntime-common": ortCommonPath,
					"onnxruntime-web$": ortWebPkgRoot,
				},
				conditionNames: [
					"onnxruntime-web-use-extern-wasm",
					...(config.resolve?.conditionNames ?? [
						"import",
						"module",
						"require",
						"default",
					]),
				],
			};

			// Suppress import.meta "Critical dependency" warnings from
			// @huggingface/transformers v4. The library uses import.meta.url for
			// WASM worker URLs — this works correctly at runtime, but webpack
			// emits noisy warnings. We use ignoreWarnings instead of
			// `parser.importMeta: false` because the latter breaks import.meta.url
			// resolution, causing ONNX Runtime to fall back to cross-origin CDN
			// URLs that trigger Worker SecurityErrors.
			config.ignoreWarnings = [
				...(config.ignoreWarnings ?? []),
				{ message: /Accessing import\.meta directly is unsupported/ },
				{ message: /Critical dependency: require function is used/ },
			];
		}
		return config;
	},
};

export default nextConfig;
