#!/usr/bin/env node
/**
 * Speaker similarity with an INDEPENDENT verification model (spec Tier-2).
 *
 *   node scripts/speaker-similarity.mjs --anchors
 *   node scripts/speaker-similarity.mjs a.wav b.wav [c.wav ...]
 *
 * Judge: WeSpeaker voxceleb_resnet34_LM (ResNet34 CNN trained on VoxCeleb),
 * auto-downloaded (26.5MB) to /tmp on first use.
 *
 * DELIBERATELY NOT WavLM-base-plus-sv. That is the model that produces the
 * conditioning embedding for SpeechT5 cloning, so scoring with it would measure
 * whether SpeechT5 honored the vector it was handed — not whether a listener
 * would hear the same speaker. It would score high on output that sounds nothing
 * like the reference. WeSpeaker is a different architecture family and different
 * training, so it is genuine evidence.
 *
 * ALWAYS read --anchors output before trusting a score. WeSpeaker takes Kaldi
 * fbank features, which are reimplemented here; if that reimplementation were
 * wrong, same-speaker and different-speaker pairs would stop separating and
 * every number would be meaningless. The anchors are the check on this script,
 * not decoration.
 *
 * Calibrated on this repo (2026-08-04):
 *   self                        1.0000
 *   same speaker, diff audio    0.946 - 0.950
 *   different speaker           0.161 - 0.228
 *   unrelated                   0.006 - 0.036
 */

import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_PATH = "/tmp/wespeaker/voxceleb_resnet34_LM.onnx";
const MODEL_URL =
	"https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM/resolve/main/voxceleb_resnet34_LM.onnx";
const ORT_ENTRY = `${REPO}/node_modules/.pnpm/onnxruntime-node@1.21.0/node_modules/onnxruntime-node/dist/index.js`;

// ── Model fetch ──────────────────────────────────────────────────────
async function ensureModel() {
	if (existsSync(MODEL_PATH)) return;
	const { mkdirSync } = await import("node:fs");
	mkdirSync(dirname(MODEL_PATH), { recursive: true });
	console.error(`[sim] downloading WeSpeaker (26.5MB) -> ${MODEL_PATH}`);
	const res = await fetch(MODEL_URL);
	if (!res.ok) throw new Error(`model download failed: ${res.status}`);
	await pipeline(res.body, createWriteStream(MODEL_PATH));
}

// ── WAV decode ───────────────────────────────────────────────────────
function decodeWav(bytes) {
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let sampleRate = 0,
		bits = 16,
		format = 1,
		channels = 1,
		dataOff = -1,
		dataSize = 0;
	for (let o = 12; o < v.byteLength - 8; ) {
		const id = String.fromCharCode(
			v.getUint8(o),
			v.getUint8(o + 1),
			v.getUint8(o + 2),
			v.getUint8(o + 3),
		);
		const size = v.getUint32(o + 4, true);
		const body = o + 8;
		if (id === "fmt ") {
			format = v.getUint16(body, true);
			channels = v.getUint16(body + 2, true);
			sampleRate = v.getUint32(body + 4, true);
			bits = v.getUint16(body + 14, true);
		} else if (id === "data") {
			dataOff = body;
			dataSize = Math.min(size, v.byteLength - body);
		}
		o = body + size + (size % 2);
	}
	if (dataOff < 0) throw new Error("no data chunk");
	let pcm;
	if (format === 3 || bits === 32) {
		const n = Math.floor(dataSize / 4);
		pcm = new Float32Array(n);
		for (let i = 0; i < n; i++) pcm[i] = v.getFloat32(dataOff + i * 4, true);
	} else {
		const n = Math.floor(dataSize / 2);
		pcm = new Float32Array(n);
		for (let i = 0; i < n; i++)
			pcm[i] = v.getInt16(dataOff + i * 2, true) / 32768;
	}
	if (channels > 1) {
		const m = new Float32Array(Math.floor(pcm.length / channels));
		for (let i = 0; i < m.length; i++) m[i] = pcm[i * channels];
		pcm = m;
	}
	return { pcm, sampleRate };
}

function to16k(pcm, sr) {
	if (sr === 16000) return pcm;
	const ratio = sr / 16000;
	const out = new Float32Array(Math.round(pcm.length / ratio));
	for (let i = 0; i < out.length; i++) {
		const s = i * ratio,
			lo = Math.floor(s),
			hi = Math.min(lo + 1, pcm.length - 1);
		out[i] = pcm[lo] * (1 - (s - lo)) + pcm[hi] * (s - lo);
	}
	return out;
}

// ── FFT ──────────────────────────────────────────────────────────────
function fft(re, im) {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const half = len >> 1,
			step = (-2 * Math.PI) / len;
		for (let s = 0; s < n; s += len) {
			for (let k = 0; k < half; k++) {
				const a = step * k,
					wr = Math.cos(a),
					wi = Math.sin(a);
				const i = s + k,
					jj = i + half;
				const vr = re[jj] * wr - im[jj] * wi,
					vi = re[jj] * wi + im[jj] * wr;
				re[jj] = re[i] - vr;
				im[jj] = im[i] - vi;
				re[i] += vr;
				im[i] += vi;
			}
		}
	}
}

// ── Kaldi fbank (80 mel, 25ms/10ms, hamming, preemph 0.97, CMN) ──────
const MEL_BINS = 80,
	FRAME_LEN = 400,
	FRAME_SHIFT = 160,
	NFFT = 512;
const EPS = 1.1920928955078125e-7;
const hz2mel = (f) => 1127.0 * Math.log(1 + f / 700);

const BANK = (() => {
	const nBins = NFFT / 2,
		mLow = hz2mel(20),
		mHigh = hz2mel(7600);
	const delta = (mHigh - mLow) / (MEL_BINS + 1);
	return Array.from({ length: MEL_BINS }, (_, m) => {
		const left = mLow + m * delta,
			center = left + delta,
			right = left + 2 * delta;
		const row = new Float32Array(nBins);
		for (let k = 0; k < nBins; k++) {
			const mel = hz2mel((k * 16000) / NFFT);
			if (mel > left && mel < right) {
				row[k] =
					mel <= center
						? (mel - left) / (center - left)
						: (right - mel) / (right - center);
			}
		}
		return row;
	});
})();
const HAMMING = Float32Array.from(
	{ length: FRAME_LEN },
	(_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_LEN - 1)),
);

function fbank(pcm) {
	const x = new Float32Array(pcm.length);
	for (let i = 0; i < pcm.length; i++) x[i] = pcm[i] * 32768; // Kaldi int16 scale
	const nFrames = 1 + Math.floor((x.length - FRAME_LEN) / FRAME_SHIFT);
	if (nFrames < 1) throw new Error("audio shorter than one 25ms frame");

	const feats = [];
	const re = new Float64Array(NFFT),
		im = new Float64Array(NFFT);
	for (let f = 0; f < nFrames; f++) {
		const off = f * FRAME_SHIFT;
		const frame = new Float64Array(FRAME_LEN);
		for (let i = 0; i < FRAME_LEN; i++) frame[i] = x[off + i];
		let mean = 0;
		for (let i = 0; i < FRAME_LEN; i++) mean += frame[i];
		mean /= FRAME_LEN;
		for (let i = 0; i < FRAME_LEN; i++) frame[i] -= mean;
		for (let i = FRAME_LEN - 1; i > 0; i--) frame[i] -= 0.97 * frame[i - 1];
		frame[0] -= 0.97 * frame[0];

		re.fill(0);
		im.fill(0);
		for (let i = 0; i < FRAME_LEN; i++) re[i] = frame[i] * HAMMING[i];
		fft(re, im);

		const row = new Float32Array(MEL_BINS);
		for (let m = 0; m < MEL_BINS; m++) {
			let e = 0;
			const w = BANK[m];
			for (let k = 0; k < NFFT / 2; k++)
				if (w[k]) e += w[k] * (re[k] * re[k] + im[k] * im[k]);
			row[m] = Math.log(Math.max(e, EPS));
		}
		feats.push(row);
	}
	const mu = new Float64Array(MEL_BINS);
	for (const r of feats) for (let m = 0; m < MEL_BINS; m++) mu[m] += r[m];
	for (let m = 0; m < MEL_BINS; m++) mu[m] /= feats.length;
	for (const r of feats) for (let m = 0; m < MEL_BINS; m++) r[m] -= mu[m];
	return feats;
}

// ── Embed ────────────────────────────────────────────────────────────
await ensureModel();
const ort = (await import(ORT_ENTRY)).default ?? (await import(ORT_ENTRY));
const session = await ort.InferenceSession.create(MODEL_PATH);

export async function embed(path) {
	const { pcm, sampleRate } = decodeWav(new Uint8Array(readFileSync(path)));
	const feats = fbank(to16k(pcm, sampleRate));
	const flat = new Float32Array(feats.length * MEL_BINS);
	feats.forEach((r, i) => flat.set(r, i * MEL_BINS));
	const out = await session.run({
		feats: new ort.Tensor("float32", flat, [1, feats.length, MEL_BINS]),
	});
	const e = out.embs.data;
	let n = 0;
	for (let i = 0; i < e.length; i++) n += e[i] * e[i];
	n = Math.sqrt(n) || 1;
	return Float32Array.from(e, (v) => v / n);
}
const cos = (a, b) => {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
};

// ── CLI ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args[0] === "--anchors") {
	const S = `${REPO}/public/audio-samples`;
	const V = `${REPO}/qa-artifacts/voice-clone`;
	const set = {
		piper: `${S}/piper-lessac.wav`,
		af_heart: `${S}/hero-demo-1.wav`,
		af_bella: `${S}/hero-demo-2.wav`,
		am_adam: `${S}/hero-demo-3.wav`,
		ctl0: `${V}/0-control-stock-0.wav`,
		ctl1: `${V}/0-control-stock-1.wav`,
	};
	const E = {};
	for (const [k, p] of Object.entries(set)) {
		if (!existsSync(p)) {
			console.error(`[sim] missing ${k}: ${p}`);
			continue;
		}
		E[k] = await embed(p);
	}
	const line = (label, a, b, expect) =>
		E[a] &&
		E[b] &&
		console.log(
			`  ${label.padEnd(46)} ${cos(E[a], E[b]).toFixed(4)}   expect ${expect}`,
		);

	console.log(
		"ANCHORS — if these do not separate, the fbank is wrong and no score here means anything",
	);
	line("piper vs itself", "piper", "piper", "1.0");
	line(
		"stock ctl0 vs ctl1 (same voice, diff render)",
		"ctl0",
		"ctl1",
		"HIGH ~0.95",
	);
	line("af_bella vs am_adam (F vs M)", "af_bella", "am_adam", "LOW ~0.16");
	line("af_heart vs af_bella (F vs F)", "af_heart", "af_bella", "LOW ~0.21");
	line("piper vs am_adam", "piper", "am_adam", "LOW ~0.04");
	// No process.exit here: onnxruntime-node's teardown races an explicit exit
	// and throws "mutex lock failed" AFTER all output, which reads like a real
	// failure. Let the script end naturally instead.
} else if (args.length < 2) {
	console.error(
		"usage: speaker-similarity.mjs --anchors | <a.wav> <b.wav> [...]",
	);
	process.exitCode = 2;
} else {
	const E = [];
	for (const p of args) E.push({ p, e: await embed(p) });
	console.log(
		"pairwise cosine similarity (same speaker ~0.95, different ~0.16-0.23):",
	);
	for (let i = 0; i < E.length; i++) {
		for (let j = i + 1; j < E.length; j++) {
			const a = E[i].p.split("/").pop(),
				b = E[j].p.split("/").pop();
			console.log(`  ${a} ↔ ${b}: ${cos(E[i].e, E[j].e).toFixed(4)}`);
		}
	}
}
