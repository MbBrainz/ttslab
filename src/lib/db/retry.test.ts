import { NeonDbError } from "@neondatabase/serverless";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTransientDbError, withRetry, wrapNeonClient } from "./retry";

/** The exact build-log failure: Neon wrapping an undici fetch timeout. */
function fetchFailedError(code = "ETIMEDOUT"): NeonDbError {
	const error = new NeonDbError(
		"Error connecting to database: TypeError: fetch failed",
	);
	error.sourceError = Object.assign(new TypeError("fetch failed"), {
		cause: { code },
	}) as TypeError;
	return error;
}

function uniqueViolationError(): NeonDbError {
	const error = new NeonDbError(
		'duplicate key value violates unique constraint "models_slug_key"',
	);
	error.code = "23505";
	return error;
}

/** Drizzle 0.45 wraps every driver error like this before it escapes. */
function drizzleShell(cause: Error): Error {
	return new Error("Failed query: SELECT * FROM models\nparams: []", {
		cause,
	});
}

const rows = [{ id: 7 }];

describe("withRetry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("succeeds first try without retrying", async () => {
		const executor = vi.fn().mockResolvedValue(rows);
		const wrapped = withRetry(executor);

		expect(await wrapped()).toEqual(rows);
		expect(executor).toHaveBeenCalledTimes(1);
		expect(console.warn).not.toHaveBeenCalled();
	});

	it("retries an ETIMEDOUT-class failure and succeeds on attempt 2", async () => {
		const executor = vi
			.fn()
			.mockRejectedValueOnce(fetchFailedError())
			.mockResolvedValue(rows);
		const wrapped = withRetry(executor);
		const pending = wrapped();

		await vi.advanceTimersByTimeAsync(500);

		expect(await pending).toEqual(rows);
		expect(executor).toHaveBeenCalledTimes(2);
		expect(console.warn).toHaveBeenCalledOnce();
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringMatching(/attempt 1\/3/),
		);
	});

	it("backs off ~500ms then ~1500ms between attempts", async () => {
		const executor = vi
			.fn()
			.mockRejectedValueOnce(fetchFailedError("ECONNRESET"))
			.mockRejectedValueOnce(fetchFailedError("EAI_AGAIN"))
			.mockResolvedValue(rows);
		const wrapped = withRetry(executor);
		const pending = wrapped();

		await vi.advanceTimersByTimeAsync(499);
		expect(executor).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(executor).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(1499);
		expect(executor).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(executor).toHaveBeenCalledTimes(3);

		expect(await pending).toEqual(rows);
	});

	it("exhausts 3 attempts and rethrows the original error", async () => {
		const failure = fetchFailedError();
		const executor = vi.fn().mockRejectedValue(failure);
		const wrapped = withRetry(executor);
		const pending = wrapped();
		// Attach before the final rejection fires so it never surfaces as an
		// unhandled rejection between timer advances.
		const assertion = expect(pending).rejects.toBe(failure);

		await vi.advanceTimersByTimeAsync(500);
		await vi.advanceTimersByTimeAsync(1500);

		await assertion;
		expect(executor).toHaveBeenCalledTimes(3);
		expect(console.warn).toHaveBeenCalledTimes(2);
	});

	it("retries transient failures wrapped in a DrizzleQueryError-style shell", async () => {
		const executor = vi
			.fn()
			.mockRejectedValueOnce(drizzleShell(fetchFailedError()))
			.mockResolvedValue(rows);
		const wrapped = withRetry(executor);
		const pending = wrapped();

		await vi.advanceTimersByTimeAsync(500);

		expect(await pending).toEqual(rows);
		expect(executor).toHaveBeenCalledTimes(2);
	});

	it("does not retry data errors like unique violations", async () => {
		const failure = uniqueViolationError();
		const executor = vi.fn().mockRejectedValue(failure);
		const wrapped = withRetry(executor);
		const pending = wrapped();

		await expect(pending).rejects.toBe(failure);
		expect(executor).toHaveBeenCalledTimes(1);
		expect(console.warn).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("does not retry data errors wrapped in a DrizzleQueryError-style shell", async () => {
		const failure = uniqueViolationError();
		const executor = vi.fn().mockRejectedValue(drizzleShell(failure));
		const wrapped = withRetry(executor);
		const pending = wrapped();

		await expect(pending).rejects.toThrow(/Failed query/);
		expect(executor).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("does not retry errors that are not NeonDbErrors", async () => {
		const executor = vi.fn().mockRejectedValue(new TypeError("boom"));
		const wrapped = withRetry(executor);
		const pending = wrapped();

		await expect(pending).rejects.toThrow("boom");
		expect(executor).toHaveBeenCalledTimes(1);
	});
});

describe("isTransientDbError", () => {
	it("classifies connection-class failures as transient", () => {
		expect(isTransientDbError(fetchFailedError("ETIMEDOUT"))).toBe(true);
		expect(isTransientDbError(fetchFailedError("ECONNRESET"))).toBe(true);
		expect(isTransientDbError(fetchFailedError("EAI_AGAIN"))).toBe(true);

		const proxy5xx = new NeonDbError(
			"Server error (HTTP status 502): upstream unavailable",
		);
		expect(isTransientDbError(proxy5xx)).toBe(true);

		for (const code of ["08006", "57P01", "57P03", "53300"]) {
			const error = new NeonDbError("boom");
			error.code = code;
			expect(isTransientDbError(error)).toBe(true);
		}
	});

	it("classifies data errors as non-transient", () => {
		expect(isTransientDbError(uniqueViolationError())).toBe(false);

		const syntax = new NeonDbError('syntax error at or near "SELEC"');
		syntax.code = "42601";
		expect(isTransientDbError(syntax)).toBe(false);

		const http400 = new NeonDbError('relation "models" does not exist');
		expect(isTransientDbError(http400)).toBe(false);

		expect(isTransientDbError(new TypeError("boom"))).toBe(false);
		expect(isTransientDbError(new Error("DATABASE_URL is not set"))).toBe(
			false,
		);
	});

	it("sees through the DrizzleQueryError cause chain both ways", () => {
		expect(isTransientDbError(drizzleShell(fetchFailedError()))).toBe(true);
		expect(isTransientDbError(drizzleShell(uniqueViolationError()))).toBe(
			false,
		);
	});
});

describe("wrapNeonClient", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("routes .query calls (drizzle's execution path) through retry", async () => {
		const query = vi
			.fn()
			.mockRejectedValueOnce(fetchFailedError())
			.mockResolvedValue({ rows });
		const client = wrapNeonClient({ query });
		const pending = client.query("SELECT * FROM models", []);

		await vi.advanceTimersByTimeAsync(500);

		expect(await pending).toEqual({ rows });
		expect(query).toHaveBeenCalledTimes(2);
	});

	it("routes the bare callable (template tag path) through retry", async () => {
		const callable = vi
			.fn()
			.mockRejectedValueOnce(fetchFailedError())
			.mockResolvedValue(rows);
		const client = wrapNeonClient(callable);
		const pending = client();

		await vi.advanceTimersByTimeAsync(500);

		expect(await pending).toEqual(rows);
		expect(callable).toHaveBeenCalledTimes(2);
	});
});
