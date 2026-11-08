import { describe, expect, it } from "vitest";
import { getClientIp, RateLimiter, tooManyRequests } from "./rate-limit";

describe("RateLimiter", () => {
	it("allows requests up to the limit, then blocks", () => {
		const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 });
		const t0 = 1_000_000;

		expect(limiter.check("k", t0).ok).toBe(true);
		expect(limiter.check("k", t0 + 1).ok).toBe(true);
		expect(limiter.check("k", t0 + 2).ok).toBe(true);

		const blocked = limiter.check("k", t0 + 4_000);
		expect(blocked.ok).toBe(false);
		// 60s window started at t0; at t0+4s exactly 56.000s remain.
		expect(blocked.retryAfterSeconds).toBe(56);
	});

	it("admits a new request once the window has fully elapsed", () => {
		const limiter = new RateLimiter({ limit: 2, windowMs: 60_000 });
		const t0 = 1_000_000;

		limiter.check("k", t0);
		limiter.check("k", t0 + 1);
		expect(limiter.check("k", t0 + 2).ok).toBe(false);

		// exactly at windowStart + windowMs the window rolls over
		const next = limiter.check("k", t0 + 60_000);
		expect(next.ok).toBe(true);
		expect(next.retryAfterSeconds).toBe(0);
	});

	it("counts keys independently", () => {
		const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
		const t0 = 1_000_000;

		expect(limiter.check("a", t0).ok).toBe(true);
		expect(limiter.check("b", t0).ok).toBe(true);
		expect(limiter.check("a", t0 + 1).ok).toBe(false);
		expect(limiter.check("b", t0 + 1).ok).toBe(false);
	});

	it("is a fixed window: mid-window hits do not extend the block", () => {
		const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
		const t0 = 1_000_000;

		limiter.check("k", t0);
		// hammering during the window never pushes the reset further out
		expect(limiter.check("k", t0 + 30_000).ok).toBe(false);
		expect(limiter.check("k", t0 + 45_000).retryAfterSeconds).toBe(15);
		expect(limiter.check("k", t0 + 59_999).ok).toBe(false);
		expect(limiter.check("k", t0 + 60_000).ok).toBe(true);
	});

	it("never returns a zero Retry-After while blocked", () => {
		const limiter = new RateLimiter({ limit: 1, windowMs: 1_000 });
		const t0 = 2_000_000;

		limiter.check("k", t0);
		const blocked = limiter.check("k", t0 + 999);
		expect(blocked.ok).toBe(false);
		expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
	});

	it("prune drops only elapsed windows", () => {
		const limiter = new RateLimiter({ limit: 1, windowMs: 10_000 });
		const t0 = 3_000_000;

		limiter.check("old", t0);
		limiter.check("live", t0 + 5_000);

		limiter.prune(t0 + 11_000); // "old" elapsed, "live" (started t0+5s) has not
		expect(limiter.check("old", t0 + 11_000).ok).toBe(true); // fresh window
		expect(limiter.check("live", t0 + 11_000).ok).toBe(false); // still counted
	});
});

describe("two-bucket composition (subscribe: 5/min + 3/hour)", () => {
	// Mirrors the route wiring: minute bucket first, then hour bucket.
	const checkBoth = (
		minute: RateLimiter,
		hour: RateLimiter,
		key: string,
		now: number,
	) => minute.check(key, now).ok && hour.check(key, now).ok;

	it("the hourly cap binds before the minute burst cap is ever reached", () => {
		const minute = new RateLimiter({ limit: 5, windowMs: 60_000 });
		const hour = new RateLimiter({ limit: 3, windowMs: 3_600_000 });
		const t0 = 5_000_000;

		expect(checkBoth(minute, hour, "ip", t0)).toBe(true);
		expect(checkBoth(minute, hour, "ip", t0 + 1_000)).toBe(true);
		expect(checkBoth(minute, hour, "ip", t0 + 2_000)).toBe(true);
		// 4th request inside the first minute: the minute bucket still has
		// room (3 < 5) but the hour bucket is full — it is the real cap.
		const blocked = hour.check("ip", t0 + 3_000);
		expect(blocked.ok).toBe(false);
		// ~59.9 minutes still left in the hour window.
		expect(blocked.retryAfterSeconds).toBe(3_597);
	});

	it("a fresh minute does not unlock an exhausted hour", () => {
		const minute = new RateLimiter({ limit: 5, windowMs: 60_000 });
		const hour = new RateLimiter({ limit: 3, windowMs: 3_600_000 });
		const t0 = 5_000_000;

		checkBoth(minute, hour, "ip", t0);
		checkBoth(minute, hour, "ip", t0 + 1_000);
		checkBoth(minute, hour, "ip", t0 + 2_000);
		// Two full minutes later the minute window has rolled over...
		expect(minute.check("ip", t0 + 121_000).ok).toBe(true);
		// ...but the hour bucket still rejects.
		expect(hour.check("ip", t0 + 121_000).ok).toBe(false);
	});
});

describe("getClientIp", () => {
	const req = (headers: Record<string, string>) =>
		new Request("https://ttslab.dev/api/upvote", { headers });

	it("takes the first entry of a multi-hop x-forwarded-for", () => {
		expect(
			getClientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })),
		).toBe("203.0.113.7");
	});

	it("falls back to x-real-ip, then to the shared unknown bucket", () => {
		expect(getClientIp(req({ "x-real-ip": "198.51.100.2" }))).toBe(
			"198.51.100.2",
		);
		expect(getClientIp(req({}))).toBe("unknown");
	});
});

describe("tooManyRequests", () => {
	it("returns 429 with a Retry-After header", () => {
		const res = tooManyRequests(42);
		expect(res.status).toBe(429);
		expect(res.headers.get("retry-after")).toBe("42");
	});
});
