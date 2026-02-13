export async function getFingerprint(): Promise<string> {
	const canvas = document.createElement("canvas");
	const gl = canvas.getContext("webgl");
	const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info");
	const renderer =
		gl?.getParameter(debugInfo?.UNMASKED_RENDERER_WEBGL ?? 0) ?? "";
	const raw = `${navigator.userAgent}|${screen.width}x${screen.height}|${renderer}|${navigator.language}`;
	const hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(raw),
	);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
