const RECORDING_MIME_TYPES = [
	"audio/webm;codecs=opus",
	"audio/webm",
	"audio/mp4;codecs=mp4a.40.2",
	"audio/mp4",
];

/**
 * Pick the first MediaRecorder container this browser supports.
 * Safari rejects webm, so it falls through to mp4. Returns undefined
 * when the API is unavailable, letting the browser choose its default.
 */
export function pickRecordingMimeType(): string | undefined {
	if (typeof MediaRecorder === "undefined") return undefined;
	if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
	return RECORDING_MIME_TYPES.find((type) =>
		MediaRecorder.isTypeSupported(type),
	);
}
