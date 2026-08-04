#!/usr/bin/env node
/**
 * Drives the TTS QA harness in a real browser and writes listenable artifacts.
 *
 *   node scripts/model-qa.mjs --models kokoro-82m --phrases 2
 *   node scripts/model-qa.mjs --embedding /audio-samples/kokoro-82m.wav --streaming
 *
 * Generation has to happen in a browser — the models are WASM/WebGPU and the
 * worker is a browser worker. So: generate in the browser, stream every buffer
 * out as a WAV, and score offline. A verdict then points at a file you can
 * play, and a threshold change can be re-scored without regenerating anything.
 *
 * Requires the app to be serving already (see --url). Build and start it with:
 *   ./node_modules/.bin/next build --webpack && ./node_modules/.bin/next start -p 3005
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Chrome, not the Playwright-bundled Chromium: the bundled build has no GPU
 * adapter, so WebGPU silently falls back to WASM and the run reports backend
 * coverage it never had.
 */
const DEFAULT_CHROME =
	process.env.CHROME_PATH ??
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const CHROME_ARGS = [
	"--headless=new",
	"--enable-unsafe-webgpu",
	"--enable-features=Vulkan",
	"--use-angle=metal",
	"--no-sandbox",
];

/**
 * Feeds a real WAV into a fake microphone device and auto-grants permission.
 * Used with --clone-mic, so the capture path (getUserMedia + AGC + noise
 * suppression) is genuinely exercised rather than bypassed by reading a file.
 */
function micArgs(wavPath) {
	return [
		"--use-fake-device-for-media-stream",
		"--use-fake-ui-for-media-stream",
		`--use-file-for-fake-audio-capture=${resolve(wavPath)}`,
	];
}

/**
 * >10 seconds of output, per the spec's repro conditions: the SpeechT5 cloning
 * instability is length-dependent and short clips under-trigger it. At ~2.5
 * words/sec this is ~14s.
 */
const LONG_PHRASE = {
	text:
		"The committee reviewed the sophisticated proposal at length, and after considerable discussion " +
		"about the department budget, the union representatives agreed that the computer systems would " +
		"need replacing before the end of the financial year.",
	category: "long-form",
};

// ── Args ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
	const args = {
		url: "http://localhost:3005/internal/tts-quality",
		models: [],
		phrases: 0,
		embedding: "",
		streaming: false,
		backend: "auto",
		cloneMicWav: "",
		cloneMicSeconds: 12,
		longPhrase: false,
		timeoutMs: 30 * 60 * 1000,
		outDir: join(REPO_ROOT, "qa-artifacts"),
	};

	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => argv[++i];
		if (arg === "--url") args.url = next();
		else if (arg === "--models")
			args.models = next()
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		else if (arg === "--phrases") args.phrases = Number(next());
		else if (arg === "--embedding") args.embedding = next();
		else if (arg === "--streaming") args.streaming = true;
		else if (arg === "--backend") args.backend = next();
		else if (arg === "--clone-mic") args.cloneMicWav = next();
		else if (arg === "--clone-mic-seconds")
			args.cloneMicSeconds = Number(next());
		else if (arg === "--long-phrase") args.longPhrase = true;
		else if (arg === "--timeout") args.timeoutMs = Number(next()) * 1000;
		else if (arg === "--out") args.outDir = resolve(next());
		else if (arg === "--help") {
			console.log(
				"Usage: node scripts/model-qa.mjs [--url U] [--models a,b] [--phrases N]",
			);
			console.log(
				"       [--embedding URL] [--streaming] [--backend auto|wasm|webgpu]",
			);
			console.log(
				"       [--clone-mic FIXTURE.wav] [--clone-mic-seconds N] [--long-phrase]",
			);
			console.log("       [--timeout SEC] [--out DIR]");
			process.exit(0);
		} else {
			console.error(`Unknown argument: ${arg}`);
			process.exit(2);
		}
	}
	return args;
}

/** {stock, cloned} x {non-streaming, streaming} — the coverage matrix. */
function buildVariants({ embedding, streaming }) {
	const voices = [{ label: "stock" }];
	if (embedding)
		voices.push({ label: "cloned", speakerEmbeddingUrl: embedding });
	const modes = streaming ? [false, true] : [false];

	return voices.flatMap((voice) =>
		modes.map((isStreaming) => ({
			id: `${voice.label}/${isStreaming ? "streaming" : "non-streaming"}`,
			speakerEmbeddingUrl: voice.speakerEmbeddingUrl,
			streaming: isStreaming,
		})),
	);
}

// ── Reporting ────────────────────────────────────────────────────────

function artifactName(meta) {
	const variant = meta.variant.replace(/\//g, "-");
	return `${meta.slug}__${variant}__${String(meta.phraseIndex).padStart(2, "0")}.wav`;
}

function summarize(reports) {
	const failures = [];
	for (const report of reports) {
		report.tests.forEach((test, phraseIndex) => {
			for (const failure of test.failures) {
				if (failure.severity !== "fail") continue;
				failures.push({
					slug: report.slug,
					variant: report.variant,
					check: failure.check,
					value: failure.value,
					threshold: failure.threshold,
					phrase: test.phrase,
					artifact: `wav/${artifactName({ slug: report.slug, variant: report.variant, phraseIndex })}`,
				});
			}
		});
	}
	return failures;
}

function renderMarkdown(reports, failures, meta) {
	const lines = [
		"# Model QA report",
		"",
		`- Run: \`${meta.runId}\``,
		`- URL: ${meta.url}`,
		`- Artifacts: \`${meta.outDir}\``,
		"",
		...(meta.fatal
			? [
					"> **INCOMPLETE RUN** — the driver died before finishing. The verdicts",
					"> below cover only the cells that completed; anything absent was never",
					"> run, not passed.",
					">",
					`> \`${String(meta.fatal).split("\n")[0]}\``,
					"",
				]
			: []),
		"## Verdicts",
		"",
		"| model | variant | verdict | backend | WER med/max | max I/N | max cepstral | failed checks |",
		"|---|---|---|---|---|---|---|---|",
	];

	const pct = (n) => `${(n * 100).toFixed(1)}%`;
	const median = (values) => {
		if (values.length === 0) return 0;
		const sorted = [...values].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		return sorted.length % 2 === 0
			? (sorted[mid - 1] + sorted[mid]) / 2
			: sorted[mid];
	};

	for (const report of reports) {
		const wers = report.tests.map((t) => t.sttRoundTrip.wer);
		const insertions = report.tests.map((t) => t.sttRoundTrip.insertionRate);
		const cepstral = report.tests.map((t) => t.qa.cepstral.ratio);
		const checks = new Map();
		for (const test of report.tests) {
			for (const f of test.failures)
				checks.set(f.check, (checks.get(f.check) ?? 0) + 1);
		}
		lines.push(
			`| ${report.slug} | ${report.variant} | **${report.overall.toUpperCase()}** | ${report.backend} | ` +
				`${wers.length ? `${pct(median(wers))} / ${pct(Math.max(...wers))}` : "-"} | ` +
				`${insertions.length ? pct(Math.max(...insertions)) : "-"} | ` +
				`${cepstral.length ? Math.max(...cepstral).toFixed(0) : "-"} | ` +
				`${checks.size ? [...checks].map(([c, n]) => `${c} x${n}`).join(", ") : "-"} |`,
		);
	}

	if (failures.length > 0) {
		lines.push("", "## Failures — each points at a WAV you can play", "");
		for (const f of failures) {
			lines.push(
				`- **${f.check}** = ${f.value.toFixed(3)} (threshold ${f.threshold}) — ` +
					`${f.slug} \`${f.variant}\`\n  - phrase: "${f.phrase}"\n  - artifact: \`${f.artifact}\``,
			);
		}
	} else {
		lines.push("", "No failing checks.", "");
	}

	const errors = reports.filter((r) => r.errors.length > 0);
	if (errors.length > 0) {
		lines.push("", "## Errors", "");
		for (const report of errors) {
			lines.push(
				`- ${report.slug} \`${report.variant}\`: ${report.errors.join("; ")}`,
			);
		}
	}

	return `${lines.join("\n")}\n`;
}

/**
 * Writes report.json + report.md from whatever reports exist.
 *
 * Called on the success path AND from the failure path, because a run that
 * dies partway has already produced WAVs on disk for every completed cell —
 * losing the verdicts that say which of them failed makes those WAVs much
 * harder to act on.
 */
function writeReports({ outDir, runId, url, reports, audioCount, fatal }) {
	const failures = summarize(reports);
	const report = {
		runId,
		url,
		generatedAt: new Date().toISOString(),
		complete: !fatal,
		...(fatal ? { fatal: String(fatal?.stack ?? fatal) } : {}),
		verdict: fatal
			? "INCOMPLETE"
			: reports.some((r) => r.overall === "fail")
				? "FAIL"
				: reports.some((r) => r.overall === "warn")
					? "WARN"
					: "PASS",
		cellsCompleted: reports.length,
		wavsWritten: audioCount,
		failures,
		reports,
	};

	writeFileSync(
		join(outDir, "report.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	writeFileSync(
		join(outDir, "report.md"),
		renderMarkdown(reports, failures, { runId, url, outDir, fatal }),
	);
	return report;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
	const args = parseArgs(process.argv);
	// Date.now, not a random id: the run directory should sort chronologically.
	const runId = new Date().toISOString().replace(/[:.]/g, "-");
	const outDir = join(args.outDir, runId);
	const wavDir = join(outDir, "wav");
	mkdirSync(wavDir, { recursive: true });

	console.log(`[qa] chrome     ${DEFAULT_CHROME}`);
	console.log(`[qa] url        ${args.url}`);
	console.log(`[qa] artifacts  ${outDir}`);

	const reports = [];
	const artifactErrors = [];
	let audioCount = 0;
	let fatal = null;

	// Ctrl-C during a 30-minute matrix run.
	//
	// NOT about orphaned processes: puppeteer already closes the browser on
	// SIGINT/SIGTERM/SIGHUP by default. Verified — with no handler at all,
	// headless Chrome still goes 2 procs -> 0 on either signal.
	//
	// What it IS about: the signal kills the process before main() reaches
	// writeReports, so an interrupted run leaves an empty wav/ directory and NO
	// report, losing the verdicts for every cell that had already finished.
	// Verified against a real SIGINT before this fix.
	//
	// REGISTERED BEFORE launch() on purpose. @puppeteer/browsers subscribes its
	// dispatcher during launch and its SIGINT branch is `this.kill();
	// process.exit(130);` — synchronous. Node runs listeners in registration
	// order, so a handler added after launch() never executes. Registering here
	// puts this first; writeReports is synchronous and completes before
	// puppeteer's exit.
	let interrupted = false;
	const onSignal = (signal) => {
		if (interrupted) return;
		interrupted = true;
		console.error(
			`\n[qa] ${signal} — writing partial report for ${reports.length} completed cell(s)`,
		);
		try {
			writeReports({
				outDir,
				runId,
				url: args.url,
				reports,
				audioCount,
				fatal: `Interrupted by ${signal}`,
			});
			console.error(`[qa] partial report at ${join(outDir, "report.md")}`);
		} catch (err) {
			console.error(`[qa] could not write partial report: ${err.message}`);
		}
	};
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
		process.on(signal, onSignal);
	}

	const browser = await puppeteer.launch({
		executablePath: DEFAULT_CHROME,
		args: args.cloneMicWav
			? [...CHROME_ARGS, ...micArgs(args.cloneMicWav)]
			: CHROME_ARGS,
		protocolTimeout: args.timeoutMs,
	});

	try {
		const page = await browser.newPage();
		page.on("console", (msg) =>
			console.log(`[page:${msg.type()}] ${msg.text()}`),
		);
		page.on("pageerror", (err) => console.error(`[page:error] ${err.message}`));

		// Streams each buffer out as it is produced, so a run that dies halfway
		// still leaves artifacts for the cases that completed.
		await page.exposeFunction("__qaEmitAudio", (meta, wavBase64) => {
			// Throwing rejects INSIDE the page, which the harness now awaits and
			// turns into a phrase error — so a failed write lands in the verdict
			// instead of leaving report.md citing a file that is not there.
			try {
				writeFileSync(
					join(wavDir, artifactName(meta)),
					Buffer.from(wavBase64, "base64"),
				);
				audioCount++;
			} catch (err) {
				artifactErrors.push(`${artifactName(meta)}: ${err.message}`);
				throw err;
			}
		});

		// Each cell arrives as it finishes, so a later crash cannot erase it.
		await page.exposeFunction("__qaEmitReport", (report) => {
			reports.push(report);
			console.log(
				`[qa] cell done  ${report.slug} ${report.variant} -> ${report.overall.toUpperCase()}`,
			);
		});

		// domcontentloaded, not networkidle2: the page holds connections open
		// (inference worker, analytics retries), so networkidle2 times out even
		// though the harness is ready. The real readiness signal is __modelQA.
		await page.goto(args.url, {
			waitUntil: "domcontentloaded",
			timeout: 60_000,
		});
		await page.waitForFunction(() => window.__modelQA !== undefined, {
			timeout: 60_000,
		});

		const available = await page.evaluate(() => window.__modelQA.listModels());
		const models = args.models.length > 0 ? args.models : available;
		const unknown = models.filter((m) => !available.includes(m));
		if (unknown.length > 0) {
			console.warn(
				`[qa] WARNING: not in the harness's model list: ${unknown.join(", ")}`,
			);
		}
		console.log(`[qa] models     ${models.join(", ")}`);

		// A mic-captured embedding, not a file-loaded one: the defect is reported
		// as source-dependent, and cloning from a file tests a milder
		// configuration than the one it was reported under.
		let embedding = args.embedding;
		if (args.cloneMicWav) {
			console.log(
				`[qa] mic clone  capturing ${args.cloneMicSeconds}s from ${args.cloneMicWav}`,
			);
			embedding = await page.evaluate(
				async (seconds) => window.__modelQA.captureMicEmbedding(seconds),
				args.cloneMicSeconds,
			);
			console.log(
				`[qa] mic clone  embedding ready (${embedding.slice(0, 32)}...)`,
			);
		}

		const variants = buildVariants({ ...args, embedding });
		console.log(`[qa] variants   ${variants.map((v) => v.id).join(", ")}`);

		// The return value is ignored: reports already arrived via __qaEmitReport.
		// Awaiting it only tells us whether the run finished cleanly.
		await page.evaluate(async (config) => window.__modelQA.run(config), {
			models,
			variants,
			backend: args.backend,
			...(args.longPhrase ? { phrases: [LONG_PHRASE] } : {}),
			...(args.phrases > 0 ? { phraseLimit: args.phrases } : {}),
		});
	} catch (err) {
		// Deliberately NOT rethrown. The whole point is that a crash still
		// produces a report for the cells that already completed — their WAVs
		// are on disk, and losing the verdicts that say which ones failed makes
		// those WAVs much harder to act on.
		fatal = err;
		console.error(`[qa] RUN DIED: ${err?.message ?? err}`);
	} finally {
		await browser.close().catch(() => {});
	}

	const report = writeReports({
		outDir,
		runId,
		url: args.url,
		reports,
		audioCount,
		fatal,
	});

	if (artifactErrors.length > 0) {
		console.error(`[qa] artifact write failures: ${artifactErrors.join("; ")}`);
	}

	console.log(`\n[qa] verdict    ${report.verdict}`);
	console.log(`[qa] cells      ${reports.length} completed`);
	console.log(`[qa] wavs       ${audioCount}`);
	console.log(`[qa] report     ${join(outDir, "report.md")}`);
	for (const f of report.failures) {
		console.log(
			`[qa] FAIL ${f.slug} ${f.variant} ${f.check}=${f.value.toFixed(3)} -> ${f.artifact}`,
		);
	}

	// INCOMPLETE exits 2, distinct from a clean FAIL: "some cells never ran" is
	// a different thing for a caller to react to than "a cell failed".
	if (report.verdict === "INCOMPLETE") process.exit(2);
	process.exit(report.verdict === "FAIL" || artifactErrors.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error(`[qa] fatal: ${err?.stack ?? err}`);
	process.exit(2);
});
