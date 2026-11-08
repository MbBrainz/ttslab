/**
 * Small pure formatting helpers for the Finetune Lab UI (unit-tested).
 */

/** Loss values span decades — compact but honest formatting. */
export function fmtLoss(v: number): string {
	if (!Number.isFinite(v) || v < 0) return "—";
	if (v >= 1) return v.toFixed(2);
	if (v >= 0.01) return v.toFixed(3);
	if (v === 0) return "0";
	return v.toExponential(1);
}

/** Fixed-digit float with a dash fallback for non-finite values. */
export function fmtFloat(v: number, digits = 3): string {
	if (!Number.isFinite(v)) return "—";
	return v.toFixed(digits);
}

/** Thousands-separated integer. */
export function fmtCount(n: number): string {
	return n.toLocaleString("en-US");
}
