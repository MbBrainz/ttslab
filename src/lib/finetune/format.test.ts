import { describe, expect, it } from "vitest";
import { fmtCount, fmtFloat, fmtLoss } from "./format";

describe("finetune format helpers", () => {
	it("loss switches between fixed and exponential per decade", () => {
		expect(fmtLoss(3.2345)).toBe("3.23");
		expect(fmtLoss(0.12345)).toBe("0.123");
		expect(fmtLoss(0.004321)).toBe("4.3e-3");
		expect(fmtLoss(0)).toBe("0");
		expect(fmtLoss(-1)).toBe("—");
		expect(fmtLoss(Number.NaN)).toBe("—");
		expect(fmtLoss(Infinity)).toBe("—");
	});

	it("floats respect digit counts and dash non-finite", () => {
		expect(fmtFloat(0.05, 4)).toBe("0.0500");
		expect(fmtFloat(1.42815, 3)).toBe("1.428");
		expect(fmtFloat(Number.NaN)).toBe("—");
	});

	it("counts are thousands-separated", () => {
		expect(fmtCount(5313)).toBe("5,313");
		expect(fmtCount(128)).toBe("128");
	});
});
