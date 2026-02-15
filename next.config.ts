import { createRequire } from "node:module";
import path from "node:path";
import type { NextConfig } from "next";

// Dynamically resolve the correct onnxruntime-common version by walking the
// dependency chain: kokoro-js → @huggingface/transformers → onnxruntime-web → onnxruntime-common.
// This avoids hardcoding pnpm store hashes and survives dependency updates.
const require_ = createRequire(import.meta.url);
const ortWebDir = path.dirname(
	require_.resolve("onnxruntime-web", {
		paths: [
			path.dirname(
				require_.resolve("@huggingface/transformers", {
					paths: [path.dirname(require_.resolve("kokoro-js"))],
				}),
			),
		],
	}),
);
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
			// There are multiple versions installed (1.14.0, 1.21.0, 1.22.0-dev).
			// The 1.14.0 version (from @xenova/transformers) has a Tensor class
			// without the `location` getter, causing "invalid data location: undefined"
			// errors when used with onnxruntime-web@1.22.0-dev's session handler.
			config.resolve = {
				...config.resolve,
				alias: {
					...config.resolve?.alias,
					"onnxruntime-common": ortCommonPath,
				},
			};
		}
		return config;
	},
};

export default nextConfig;
