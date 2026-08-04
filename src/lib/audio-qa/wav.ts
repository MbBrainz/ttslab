/**
 * Minimal WAV codec.
 *
 * Encoding runs in the browser so generated audio can be written to disk as a
 * listenable artifact; decoding runs in Node so a saved artifact can be
 * re-scored without regenerating it. That second direction is the point: a
 * threshold change must not cost a 500MB model download and a fresh run.
 */

export interface DecodedWav {
	pcm: Float32Array;
	sampleRate: number;
	channels: number;
}

const HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, text: string): void {
	for (let i = 0; i < text.length; i++)
		view.setUint8(offset + i, text.charCodeAt(i));
}

/** 16-bit PCM mono. */
export function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
	const buffer = new ArrayBuffer(HEADER_BYTES + pcm.length * 2);
	const view = new DataView(buffer);

	writeAscii(view, 0, "RIFF");
	view.setUint32(4, 36 + pcm.length * 2, true);
	writeAscii(view, 8, "WAVE");
	writeAscii(view, 12, "fmt ");
	view.setUint32(16, 16, true); // PCM chunk size
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // byte rate
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	writeAscii(view, 36, "data");
	view.setUint32(40, pcm.length * 2, true);

	for (let i = 0; i < pcm.length; i++) {
		// NaN would encode as 0 silently; clamp finite values only.
		const sample = Number.isFinite(pcm[i])
			? Math.max(-1, Math.min(1, pcm[i]))
			: 0;
		view.setInt16(HEADER_BYTES + i * 2, Math.round(sample * 32767), true);
	}

	return new Uint8Array(buffer);
}

function toMono(pcm: Float32Array, channels: number): Float32Array {
	if (channels <= 1) return pcm;
	const out = new Float32Array(Math.floor(pcm.length / channels));
	for (let i = 0; i < out.length; i++) out[i] = pcm[i * channels];
	return out;
}

/** Handles 16-bit int and 32-bit float payloads, and skips unknown chunks. */
export function decodeWav(bytes: Uint8Array): DecodedWav {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 12; // past "RIFF....WAVE"
	let sampleRate = 0;
	let bitsPerSample = 16;
	let format = 1;
	let channels = 1;
	let pcm = new Float32Array(0);

	while (offset < view.byteLength - 8) {
		const id = String.fromCharCode(
			view.getUint8(offset),
			view.getUint8(offset + 1),
			view.getUint8(offset + 2),
			view.getUint8(offset + 3),
		);
		const size = view.getUint32(offset + 4, true);
		const body = offset + 8;

		if (id === "fmt ") {
			format = view.getUint16(body, true);
			channels = view.getUint16(body + 2, true);
			sampleRate = view.getUint32(body + 4, true);
			bitsPerSample = view.getUint16(body + 14, true);
		} else if (id === "data") {
			if (format === 3 || bitsPerSample === 32) {
				const count = Math.floor(size / 4);
				pcm = new Float32Array(count);
				for (let i = 0; i < count; i++)
					pcm[i] = view.getFloat32(body + i * 4, true);
			} else {
				const count = Math.floor(size / 2);
				pcm = new Float32Array(count);
				for (let i = 0; i < count; i++)
					pcm[i] = view.getInt16(body + i * 2, true) / 32768;
			}
		}

		offset = body + size + (size % 2); // chunks are word-aligned
	}

	return { pcm: toMono(pcm, channels), sampleRate, channels };
}

/** Browser-side: WAV bytes as base64, for handing to a Node-side writer. */
export function encodeWavBase64(pcm: Float32Array, sampleRate: number): string {
	const bytes = encodeWav(pcm, sampleRate);
	let binary = "";
	const CHUNK = 0x8000; // avoid blowing the argument limit on long buffers
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}
