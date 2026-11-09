import { NeonDbError } from "@neondatabase/serverless";

/**
 * Postgres SQLSTATEs meaning "server unavailable, may recover": 57P01
 * admin_shutdown, 57P03 cannot_connect_now, 53300 too_many_connections.
 * The 08xxx connection_exception class is matched by prefix. Anything else
 * carrying a SQLSTATE (23xxx unique violation, 42xxx syntax, ...) is a data
 * error and must surface instead of being retried.
 */
const RETRYABLE_SQLSTATES = new Set(["57P01", "57P03", "53300"]);

/**
 * undici fetch-failure codes (on the TypeError itself or its `cause`) that
 * are transient network conditions. Neon already covers these in its
 * "Error connecting to database" message; the explicit check keeps retries
 * working if a future @neondatabase/serverless bumps change that message.
 */
const RETRYABLE_SOURCE_CODES = new Set([
	"ETIMEDOUT",
	"ECONNRESET",
	"EAI_AGAIN",
	"ECONNREFUSED",
	"EPIPE",
]);

/** `error.code` or `error.cause.code` (undici nests ETIMEDOUT under cause). */
function sourceCodeOf(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const record = error as { code?: unknown; cause?: unknown };
	if (typeof record.code === "string") return record.code;
	if (typeof record.cause !== "object" || record.cause === null) {
		return undefined;
	}
	const causeCode = (record.cause as { code?: unknown }).code;
	return typeof causeCode === "string" ? causeCode : undefined;
}

/** Whether this exact NeonDbError is a transient connection-class failure. */
function isTransientNeonDbError(error: NeonDbError): boolean {
	// Client-side fetch failures: Neon wraps them as
	// "Error connecting to database: TypeError: fetch failed" — the exact
	// error killing ~half of Vercel prerender builds (ETIMEDOUT, ECONNRESET,
	// EAI_AGAIN all arrive this way).
	if (error.message.startsWith("Error connecting to database")) return true;
	// Neon proxy 5xx responses: "Server error (HTTP status 5xx): ...".
	if (/^Server error \(HTTP status 5\d\d\)/.test(error.message)) return true;
	// Postgres connection_exception class, plus restart/limit SQLSTATEs.
	if (error.code?.startsWith("08")) return true;
	if (error.code !== undefined && RETRYABLE_SQLSTATES.has(error.code)) {
		return true;
	}
	const sourceCode = sourceCodeOf(error.sourceError);
	return sourceCode !== undefined && RETRYABLE_SOURCE_CODES.has(sourceCode);
}

/**
 * True when a transient connection-class failure sits anywhere in the error
 * chain: drizzle 0.45 wraps every driver error in DrizzleQueryError with the
 * NeonDbError as `cause`, so app code and build logs see that outer shell.
 * Never true for data errors (unique violation, syntax, constraint) — they
 * carry non-connection SQLSTATEs and fail identically on every attempt.
 */
export function isTransientDbError(error: unknown): boolean {
	for (
		let node: unknown = error, depth = 0;
		node instanceof Error && depth < 5;
		node = node.cause, depth++
	) {
		if (node instanceof NeonDbError && isTransientNeonDbError(node)) {
			return true;
		}
	}
	return false;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 1500];

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retry a Neon query executor up to 3 attempts total (~500ms, then ~1500ms
 * backoff), only on transient connection-class failures. Exhausted attempts
 * rethrow the original error; data errors rethrow immediately. Reads (the
 * whole of build-time prerender) are safe to replay; a write whose response
 * was lost after the server committed is the one theoretical double-apply,
 * the same trade-off Neon's own retry guidance accepts.
 */
export function withRetry<Args extends unknown[], R>(
	fn: (...args: Args) => PromiseLike<R>,
): (...args: Args) => Promise<R> {
	return async (...args: Args) => {
		for (let attempt = 1; ; attempt++) {
			try {
				return await fn(...args);
			} catch (error) {
				if (!(error instanceof Error)) throw error;
				if (!isTransientDbError(error) || attempt >= MAX_ATTEMPTS) {
					throw error;
				}
				const delayMs = RETRY_DELAYS_MS[attempt - 1];
				console.warn(
					`[db] transient Neon connection failure (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${delayMs}ms: ${error.message}`,
				);
				await sleep(delayMs);
			}
		}
	};
}

/**
 * Wrap a neon() client so every execution path goes through withRetry:
 * drizzle's NeonHttpPreparedQuery runs all queries through
 * `client.query ?? client`, batch() through `client.transaction`, and direct
 * template calls hit `apply`. This is the single choke point for every
 * build-time prerender query; the returned client keeps neon()'s type.
 */
export function wrapNeonClient<T extends object>(client: T): T {
	return new Proxy(client, {
		get(target, prop) {
			const value = Reflect.get(target, prop, target);
			if (typeof value !== "function") return value;
			return (...args: unknown[]) => withRetry(value.bind(target))(...args);
		},
		apply(target, _thisArg, args) {
			const fn = target as unknown as (...fnArgs: unknown[]) => unknown;
			return withRetry(async (...fnArgs: unknown[]) => fn(...fnArgs))(...args);
		},
	});
}
