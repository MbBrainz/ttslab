/**
 * Lightweight in-memory fixed-window rate limiting for API routes.
 *
 * LIMITATION (honest): state lives in a per-process Map, so on serverless
 * (Vercel) each instance counts independently — the effective ceiling is
 * `limit x active instances` and a cold start resets all windows. This is
 * a spam brake, not a hard quota; a durable limiter (e.g. Redis/Upstash)
 * would be needed for that. Good enough to stop a curl loop from one
 * client on one instance, which is the launch threat model.
 *
 * No dependencies. `now` is injectable for deterministic tests.
 */

interface WindowState {
	count: number;
	windowStart: number;
}

export interface RateLimitConfig {
	/** Max requests allowed per window. */
	limit: number;
	/** Window length in milliseconds. */
	windowMs: number;
}

export interface RateLimitResult {
	/** True when the request is allowed (and has consumed one slot). */
	ok: boolean;
	/** Seconds until the current window rolls over (0 when ok). */
	retryAfterSeconds: number;
}

export class RateLimiter {
	private readonly states = new Map<string, WindowState>();

	constructor(private readonly config: RateLimitConfig) {}

	check(key: string, now: number = Date.now()): RateLimitResult {
		const { limit, windowMs } = this.config;
		const existing = this.states.get(key);

		// No state or the previous window has fully elapsed -> fresh window.
		if (!existing || now - existing.windowStart >= windowMs) {
			this.states.set(key, { count: 1, windowStart: now });
			return { ok: true, retryAfterSeconds: 0 };
		}

		if (existing.count >= limit) {
			const retryAfterSeconds = Math.max(
				1,
				Math.ceil((existing.windowStart + windowMs - now) / 1000),
			);
			return { ok: false, retryAfterSeconds };
		}

		existing.count += 1;
		return { ok: true, retryAfterSeconds: 0 };
	}

	/** Drop windows that have fully elapsed; keeps the Map bounded. */
	prune(now: number = Date.now()): void {
		for (const [key, state] of this.states) {
			if (now - state.windowStart >= this.config.windowMs) {
				this.states.delete(key);
			}
		}
	}
}

/**
 * Best-effort client IP from proxy headers. On Vercel `x-forwarded-for`
 * is set by the edge; locally it may be absent, in which case every
 * request shares the "unknown" bucket (fine for a dev smoke test).
 */
export function getClientIp(request: Request): string {
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded) {
		const first = forwarded.split(",")[0]?.trim();
		if (first) return first;
	}
	return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** JSON 429 response with the Retry-After header a client should honor. */
export function tooManyRequests(retryAfterSeconds: number): Response {
	return Response.json(
		{ error: "Too many requests. Please retry later." },
		{ status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
	);
}

// ---- Per-route limiters (singletons; see the per-instance caveat above) ----

/** POST /api/upvote — per browser fingerprint. */
export const upvoteFingerprintLimiter = new RateLimiter({
	limit: 10,
	windowMs: 60_000,
});

/** POST /api/upvote — per client IP (covers fingerprint spoofing). */
export const upvoteIpLimiter = new RateLimiter({
	limit: 30,
	windowMs: 60_000,
});

/**
 * POST /api/subscribe — per client IP, burst window (gates the Resend email
 * send). Paired with `subscribeHourIpLimiter`: the hourly bucket is the true
 * anti-email-bomb cap (3/hour binds before 5/min ever can); this minute
 * bucket documents the burst intent and binds first if the hourly cap is
 * ever relaxed.
 */
export const subscribeIpLimiter = new RateLimiter({
	limit: 5,
	windowMs: 60_000,
});

/** POST /api/subscribe — per client IP, sustained window (the email-bomb cap). */
export const subscribeHourIpLimiter = new RateLimiter({
	limit: 3,
	windowMs: 3_600_000,
});

/**
 * GET /api/subscribe/verify — per client IP (gates token guessing). A 5/min
 * burst bucket is deliberately absent here: it can never bind while this
 * 3/hour bucket is also checked (5 in a minute implies >3 in the hour), so
 * it would be dead code.
 */
export const subscribeVerifyIpLimiter = new RateLimiter({
	limit: 3,
	windowMs: 3_600_000,
});
