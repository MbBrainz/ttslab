import { describe, expect, it } from "vitest";
import {
	curvePaths,
	type Frame,
	histogramBars,
	histogramRange,
	lossPolyline,
	pointsToPath,
} from "./chart";

const FRAME: Frame = { left: 10, right: 110, top: 10, bottom: 110 };

describe("lossPolyline", () => {
	it("maps two losses to the corners on a log10 y-scale", () => {
		const pts = lossPolyline([1, 0.1], FRAME);
		expect(pts).not.toBeNull();
		if (!pts) return;
		expect(pts[0].x).toBeCloseTo(10);
		expect(pts[0].y).toBeCloseTo(10); // log10(1) is the max -> top
		expect(pts[1].x).toBeCloseTo(110);
		expect(pts[1].y).toBeCloseTo(110); // log10(0.1) is the min -> bottom
	});

	it("is null for fewer than two points", () => {
		expect(lossPolyline([], FRAME)).toBeNull();
		expect(lossPolyline([0.5], FRAME)).toBeNull();
	});

	it("floors losses at yFloor instead of producing -Infinity", () => {
		const pts = lossPolyline([1e-6, 1e-9, 1e-6], FRAME);
		expect(pts).not.toBeNull();
		for (const p of pts ?? []) {
			expect(Number.isFinite(p.y)).toBe(true);
		}
	});

	it("handles a flat history without dividing by zero", () => {
		const pts = lossPolyline([0.3, 0.3, 0.3], FRAME);
		expect(pts).toHaveLength(3);
		for (const p of pts ?? []) expect(Number.isFinite(p.y)).toBe(true);
	});
});

describe("pointsToPath", () => {
	it("formats x,y pairs", () => {
		expect(
			pointsToPath([
				{ x: 1, y: 2.25 },
				{ x: 3.5, y: 4 },
			]),
		).toBe("1.00,2.25 3.50,4.00");
	});
});

describe("curvePaths", () => {
	it("maps x in [0,1] to the frame width and clamps y to the range", () => {
		const xs = [0, 1];
		const { target, prediction } = curvePaths(xs, [1.4, -1.4], null, FRAME);
		// x=0 -> left, y clamped +yRange -> top; x=1 -> right, -yRange -> bottom
		expect(target.startsWith("10.00,10.00")).toBe(true);
		expect(target.endsWith("110.00,110.00")).toBe(true);
		expect(prediction).toBeNull();
	});

	it("maps y=0 to the vertical middle", () => {
		const { target } = curvePaths([0], [0], null, FRAME);
		expect(target).toBe("10.00,60.00");
	});

	it("emits a prediction path of the same length when preds match", () => {
		const xs = [0, 0.5, 1];
		const { prediction } = curvePaths(xs, [0, 0, 0], [0.2, 0, -0.2], FRAME);
		expect(prediction).not.toBeNull();
		expect((prediction ?? "").split(" ")).toHaveLength(3);
	});

	it("skips mismatched prediction lengths", () => {
		const { prediction } = curvePaths([0, 1], [0, 0], [0.1], FRAME);
		expect(prediction).toBeNull();
	});
});

describe("histogramBars", () => {
	it("normalizes bar heights by the tallest bin", () => {
		const bins = new Uint32Array(32);
		bins[0] = 10;
		bins[1] = 5;
		const bars = histogramBars(bins, FRAME);
		expect(bars).toHaveLength(32);
		expect(bars[0].h).toBeCloseTo(100); // full height
		expect(bars[0].y).toBeCloseTo(10);
		expect(bars[1].h).toBeCloseTo(50);
		expect(bars[2].h).toBe(0);
		expect(bars[0].count).toBe(10);
	});

	it("returns no bars for an all-zero histogram", () => {
		expect(histogramBars(new Uint32Array(32), FRAME)).toEqual([]);
	});
});

describe("histogramRange", () => {
	it("clamps small spreads to a 0.3 half-window", () => {
		const { min, invSpan } = histogramRange(-0.1, 0.1);
		expect(min).toBe(-0.3);
		expect(invSpan).toBeCloseTo(32 / 0.6);
	});

	it("caps large spreads at a 2.0 half-window", () => {
		const { min, invSpan } = histogramRange(-5, 5);
		expect(min).toBe(-2);
		expect(invSpan).toBeCloseTo(8);
	});
});
