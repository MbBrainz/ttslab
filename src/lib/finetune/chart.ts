/**
 * Pure SVG geometry for the Finetune Lab charts — no chart library, no DOM.
 * Every function here maps data arrays to path/bar descriptors that the
 * client components render as plain SVG, and all are unit-tested.
 */

export interface Point {
	x: number;
	y: number;
}

export interface Frame {
	/** plot area inside the outer svg box */
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/** Log10 y-scale loss polyline; empty history -> null. */
export function lossPolyline(
	history: number[],
	frame: Frame,
	yFloor = 1e-6,
): Point[] | null {
	if (history.length < 2) return null;
	const { left, right, top, bottom } = frame;
	const w = right - left;
	const h = bottom - top;
	const n = history.length;
	let min = Infinity;
	let max = -Infinity;
	for (const v of history) {
		const ly = Math.log10(Math.max(v, yFloor));
		if (ly < min) min = ly;
		if (ly > max) max = ly;
	}
	if (max - min < 1e-6) max = min + 1e-6;
	const pts: Point[] = [];
	for (let i = 0; i < n; i++) {
		const ly = Math.log10(Math.max(history[i], yFloor));
		pts.push({
			x: left + (i / (n - 1)) * w,
			y: bottom - ((ly - min) / (max - min)) * h,
		});
	}
	return pts;
}

/** SVG polyline points string ("x,y x,y …") from mapped points. */
export function pointsToPath(pts: Point[]): string {
	return pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

export interface CurvePaths {
	target: string;
	prediction: string | null;
}

/**
 * Target (dashed reference) + model prediction curves over x in [0, 1),
 * y clamped to [-yRange, yRange].
 */
export function curvePaths(
	xs: ArrayLike<number>,
	targets: ArrayLike<number>,
	preds: ArrayLike<number> | null,
	frame: Frame,
	yRange = 1.4,
): CurvePaths {
	const { left, right, top, bottom } = frame;
	const w = right - left;
	const h = bottom - top;
	const n = xs.length;
	const mapY = (v: number): number =>
		bottom -
		((Math.max(-yRange, Math.min(yRange, v)) + yRange) / (2 * yRange)) * h;
	const target = pointsToPath(
		Array.from({ length: n }, (_, i) => ({
			x: left + xs[i] * w,
			y: mapY(targets[i]),
		})),
	);
	let prediction: string | null = null;
	if (preds && preds.length === n) {
		prediction = pointsToPath(
			Array.from({ length: n }, (_, i) => ({
				x: left + xs[i] * w,
				y: mapY(preds[i]),
			})),
		);
	}
	return { target, prediction };
}

export interface HistBar {
	x: number;
	y: number;
	w: number;
	h: number;
	count: number;
}

/** 32-bin weight histogram -> normalized bar rects, tallest = full height. */
export function histogramBars(
	bins: ArrayLike<number>,
	frame: Frame,
	nBins = 32,
): HistBar[] {
	const { left, right, top, bottom } = frame;
	const h = bottom - top;
	let max = 0;
	for (let i = 0; i < nBins; i++) max = Math.max(max, bins[i] ?? 0);
	if (max === 0) return [];
	const bw = (right - left) / nBins;
	const bars: HistBar[] = [];
	for (let i = 0; i < nBins; i++) {
		const count = bins[i] ?? 0;
		const bh = (count / max) * h;
		bars.push({
			x: left + i * bw,
			y: bottom - bh,
			w: bw,
			h: bh,
			count,
		});
	}
	return bars;
}

/**
 * Weight-range window for the histogram: 2x the initial spread (clamped to a
 * sane band), fixed for the run so bin positions are comparable over time.
 */
export function histogramRange(
	paramMin: number,
	paramMax: number,
): {
	min: number;
	invSpan: number;
} {
	const spread = Math.max(Math.abs(paramMin), Math.abs(paramMax));
	const half = Math.min(2, Math.max(0.3, spread * 2));
	return { min: -half, invSpan: 32 / (2 * half) };
}
