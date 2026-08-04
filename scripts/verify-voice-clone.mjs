#!/usr/bin/env node
/**
 * Browser verification of the SpeechT5 voice-cloning UI (file-upload path).
 *
 * Answers, in order:
 *  1. Do cloned and stock renders of the SAME sentence actually differ?
 *  2. Does the stale-embedding fix hold end to end (clone -> switch back to a
 *     stock voice -> regenerate)?
 *  3. How large is the WavLM speaker-encoder download, really?
 *  4. Does a non-audio file produce a clean error rather than a crash or hang?
 *
 * Uses a PERSISTENT user-data-dir so the ~500MB SpeechT5 and the WavLM encoder
 * are cached across runs — a fresh puppeteer profile re-downloads everything.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME =
	process.env.CHROME_PATH ??
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const URL_BASE = process.env.QA_URL ?? "http://localhost:3011";
const PROFILE = process.env.QA_PROFILE ?? "/tmp/vc-verify-profile";
const OUT =
	process.env.QA_OUT ?? join(REPO_ROOT, "qa-artifacts", "voice-clone");

const SENTENCE =
	"The committee reviewed the sophisticated proposal at length before the end of the financial year.";
const REFERENCE_WAV = join(
	REPO_ROOT,
	"public",
	"audio-samples",
	"piper-lessac.wav",
);

const MODEL_LOAD_TIMEOUT = 40 * 60 * 1000;
const GENERATE_TIMEOUT = 8 * 60 * 1000;

const log = (...a) =>
	console.log(`[vc ${new Date().toISOString().slice(11, 19)}]`, ...a);

/** Blocking poll. Never returns control to the caller between polls. */
/** Dumped on timeout so a stuck wait explains itself instead of just expiring. */
const pageState = (page) =>
	page.evaluate(() => ({
		buttons: Array.from(document.querySelectorAll("button")).map((b) => ({
			text: (b.textContent ?? "").trim().slice(0, 40),
			disabled: b.disabled,
		})),
		textareaLength:
			document.querySelector("#tts-text-speecht5")?.value?.length ?? null,
		select: document.querySelector("select")?.value ?? null,
		bodyTail: document.body.innerText.slice(-400),
	}));

async function until(
	page,
	fn,
	{ timeout, label, interval = 2000, arg = null },
) {
	const start = Date.now();
	let lastNote = 0;
	for (;;) {
		const result = await page
			.evaluate(fn, arg)
			.catch((e) => ({ error: e.message }));
		if (result && result.done) return result;
		if (Date.now() - start > timeout) {
			const state = await pageState(page).catch(() => "unavailable");
			throw new Error(
				`timeout after ${Math.round((Date.now() - start) / 1000)}s waiting for ${label}: ${JSON.stringify(result)}\nPAGE STATE: ${JSON.stringify(state, null, 2)}`,
			);
		}
		if (Date.now() - lastNote > 20000) {
			lastNote = Date.now();
			log(`  … ${label}: ${JSON.stringify(result).slice(0, 160)}`);
		}
		await new Promise((r) => setTimeout(r, interval));
	}
}

const clickByText = (page, pattern) =>
	page.evaluate((p) => {
		const re = new RegExp(p, "i");
		const btn = Array.from(document.querySelectorAll("button")).find(
			(b) => re.test(b.textContent ?? "") && !b.disabled,
		);
		if (!btn) return false;
		btn.click();
		return true;
	}, pattern);

/** Pull the current generated audio out of the page as base64. */
const grabAudio = (page) =>
	page.evaluate(async () => {
		const link = document.querySelector("a[download]");
		if (!link?.href) return null;
		const buf = await (await fetch(link.href)).arrayBuffer();
		const bytes = new Uint8Array(buf);
		let bin = "";
		for (let i = 0; i < bytes.length; i += 0x8000) {
			bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		}
		return { href: link.href, base64: btoa(bin) };
	});

async function generate(page, label, previousHref) {
	log(`generating: ${label}`);
	const clicked = await clickByText(page, "Generate Speech|^Generate$");
	if (!clicked) throw new Error(`could not click Generate for ${label}`);

	await until(
		page,
		(prev) => {
			const link = document.querySelector("a[download]");
			const busy = Array.from(document.querySelectorAll("button")).some((b) =>
				/Generating/i.test(b.textContent ?? ""),
			);
			const href = link?.href ?? null;
			return { done: !busy && !!href && href !== prev, href, busy };
		},
		{ timeout: GENERATE_TIMEOUT, label: `render ${label}`, arg: previousHref },
	);

	const audio = await grabAudio(page);
	if (!audio) throw new Error(`no audio produced for ${label}`);
	const file = join(OUT, `${label}.wav`);
	writeFileSync(file, Buffer.from(audio.base64, "base64"));
	log(`  saved ${file} (${Buffer.from(audio.base64, "base64").length} bytes)`);
	return { ...audio, file };
}

async function main() {
	mkdirSync(OUT, { recursive: true });
	mkdirSync(PROFILE, { recursive: true });
	if (!existsSync(REFERENCE_WAV)) throw new Error(`missing ${REFERENCE_WAV}`);

	const findings = {
		url: URL_BASE,
		sentence: SENTENCE,
		reference: REFERENCE_WAV,
	};

	const browser = await puppeteer.launch({
		executablePath: CHROME,
		userDataDir: PROFILE,
		args: [
			"--headless=new",
			"--enable-unsafe-webgpu",
			"--enable-features=Vulkan",
			"--use-angle=metal",
			"--no-sandbox",
		],
		protocolTimeout: MODEL_LOAD_TIMEOUT,
	});

	try {
		const page = await browser.newPage();
		page.on("pageerror", (e) => log(`[page:error] ${e.message}`));
		page.on("console", (m) => {
			if (/error|warn/i.test(m.type()))
				log(`[page:${m.type()}] ${m.text().slice(0, 200)}`);
		});

		// ── Network accounting, for the WavLM download-size question ────────
		const bytesByHost = new Map();
		const wavlm = [];
		page.on("response", async (res) => {
			const url = res.url();
			const len = Number(res.headers()["content-length"] ?? 0);
			if (!len) return;
			try {
				const host = new URL(url).host;
				bytesByHost.set(host, (bytesByHost.get(host) ?? 0) + len);
			} catch {
				/* ignore */
			}
			if (/wavlm/i.test(url)) {
				wavlm.push({
					url: url.split("/").slice(-2).join("/"),
					bytes: len,
					status: res.status(),
				});
			}
		});

		log(`opening ${URL_BASE}/models/speecht5`);
		await page.goto(`${URL_BASE}/models/speecht5`, {
			waitUntil: "domcontentloaded",
			timeout: 60_000,
		});
		await page.waitForSelector("#tts-text-speecht5", { timeout: 60_000 });

		// Set the text BEFORE waiting on the Generate button. `text` starts as ""
		// and the button is disabled={!text.trim() || !canGenerate}, so waiting
		// for it to enable first deadlocks — it can never enable while empty.
		const fillText = (t) => {
			const ta = document.querySelector("#tts-text-speecht5");
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLTextAreaElement.prototype,
				"value",
			).set;
			setter.call(ta, t);
			ta.dispatchEvent(new Event("input", { bubbles: true }));
		};
		await page.evaluate(fillText, SENTENCE);
		log(`text set (${SENTENCE.length} chars)`);

		// ── Load the model (blocking; this is where prior attempts died) ────
		log("clicking Download (SpeechT5 ~560MB, cached in profile after run 1)");
		await clickByText(page, "Download");
		await until(
			page,
			() => {
				const gen = Array.from(document.querySelectorAll("button")).find((b) =>
					/Generate Speech|^Generate$/i.test(b.textContent ?? ""),
				);
				const body = document.body.innerText;
				const pct = body.match(/(\d+)\s*%/)?.[1] ?? null;
				return {
					done: !!gen && !gen.disabled,
					pct,
					ready: /Ready/i.test(body),
				};
			},
			{ timeout: MODEL_LOAD_TIMEOUT, label: "model ready", interval: 3000 },
		);
		log("model ready");

		// ── Determinism control ─────────────────────────────────────────────
		// Two stock renders back to back, NO cloning in between. Without this
		// baseline a "near but not bit-identical" stock-after result is
		// unreadable: it could be embedding leakage or it could be ordinary
		// nondeterminism, and there is no way to tell which. Run unconditionally
		// so the negative result is anchored too.
		if (process.env.QA_CONTROL_ONLY === "1") {
			// N renders, not 2: with a single pair the "band" is one observation
			// and cannot separate a 2x-band result from noise.
			const n = Number(process.env.QA_CONTROL_N ?? 5);
			const files = [];
			let prev = null;
			for (let i = 0; i < n; i++) {
				const r = await generate(page, `0-control-stock-${i}`, prev);
				prev = r.href;
				files.push(r.file);
			}
			findings.control = { files };
			writeFileSync(
				join(OUT, "findings-control.json"),
				`${JSON.stringify(findings, null, 2)}\n`,
			);
			log("determinism control done");
			return;
		}

		const voicesBefore = await page.evaluate(() => {
			const sel = document.querySelector("select");
			return sel
				? {
						value: sel.value,
						options: Array.from(sel.options).map((o) => o.value),
					}
				: null;
		});
		findings.voiceSelectBefore = voicesBefore;
		log(`voice select before clone: ${JSON.stringify(voicesBefore)}`);

		// ── 1. stock render ─────────────────────────────────────────────────
		const stockA = await generate(page, "1-stock-before-clone", null);

		// ── 2. upload a reference file and clone ────────────────────────────
		log(`uploading reference ${REFERENCE_WAV}`);
		const input = await page.$('input[type="file"]');
		if (!input) throw new Error("no file input found");
		await input.uploadFile(REFERENCE_WAV);

		await until(
			page,
			() => {
				const sel = document.querySelector("select");
				const body = document.body.innerText;
				return {
					done: sel?.value === "custom",
					voice: sel?.value ?? null,
					err: /error|failed/i.test(body) ? body.slice(0, 200) : null,
				};
			},
			{
				timeout: MODEL_LOAD_TIMEOUT,
				label: "embedding ready (WavLM download)",
				interval: 3000,
			},
		);
		log("embedding ready, voice switched to custom");

		const clonedRender = await generate(page, "2-cloned", stockA.href);

		// ── 3. switch back to a stock voice — the stale-embedding fix ───────
		const stockVoice = voicesBefore.options.find((v) => v !== "custom");
		log(`switching voice select back to "${stockVoice}"`);
		await page.evaluate((v) => {
			const sel = document.querySelector("select");
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLSelectElement.prototype,
				"value",
			).set;
			setter.call(sel, v);
			sel.dispatchEvent(new Event("change", { bubbles: true }));
		}, stockVoice);
		findings.voiceAfterSwitch = await page.evaluate(
			() => document.querySelector("select")?.value ?? null,
		);
		log(`voice select now: ${findings.voiceAfterSwitch}`);

		const stockB = await generate(
			page,
			"3-stock-after-clone",
			clonedRender.href,
		);

		// ── 4. non-audio upload ─────────────────────────────────────────────
		const junk = join(OUT, "not-really-audio.wav");
		writeFileSync(
			junk,
			"this is a text file wearing a .wav extension\n".repeat(20),
		);
		log("uploading a text file renamed .wav");
		const before = Date.now();
		const input2 = await page.$('input[type="file"]');
		await input2.uploadFile(junk);
		let junkOutcome;
		try {
			junkOutcome = await until(
				page,
				() => {
					const body = document.body.innerText;
					const stuck =
						/Decoding audio|Extracting|Downloading voice encoder/i.test(body);
					const lines = body
						.split("\n")
						.map((l) => l.trim())
						.filter(Boolean);
					const err =
						lines.find((l) =>
							/(fail|error|could not|unsupported|invalid|not supported)/i.test(
								l,
							),
						) ?? null;
					return { done: !!err || !stuck, err, stuck };
				},
				{ timeout: 90_000, label: "junk upload settles", interval: 1500 },
			);
		} catch (e) {
			junkOutcome = { hung: true, message: e.message };
		}
		findings.badUpload = {
			...junkOutcome,
			elapsedMs: Date.now() - before,
			pageAlive: await page.evaluate(
				() => !!document.querySelector("#tts-text-speecht5"),
			),
		};
		log(`bad upload outcome: ${JSON.stringify(findings.badUpload)}`);

		findings.wavlmRequests = wavlm;
		findings.wavlmTotalBytes = wavlm.reduce((s, r) => s + r.bytes, 0);
		findings.bytesByHost = Object.fromEntries(bytesByHost);
		findings.renders = {
			stockBefore: stockA.file,
			cloned: clonedRender.file,
			stockAfter: stockB.file,
		};
	} finally {
		await browser.close().catch(() => {});
	}

	writeFileSync(
		join(OUT, "findings.json"),
		`${JSON.stringify(findings, null, 2)}\n`,
	);
	log(`findings -> ${join(OUT, "findings.json")}`);
}

main().catch((e) => {
	console.error(`[vc] FATAL: ${e.stack ?? e}`);
	process.exit(1);
});
