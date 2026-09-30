import { describe, expect, it } from "vitest";
import { computeCanvasScale, computeContentFit, MAX_CONTENT_SCALE } from "../src/lib/slide-fit";

const slide = { width: 1600, height: 900 };

describe("canvas scale", () => {
	it("scales uniformly to the limiting dimension", () => {
		expect(computeCanvasScale({ width: 800, height: 900 }, slide)).toBe(0.5);
		expect(computeCanvasScale({ width: 3200, height: 450 }, slide)).toBe(0.5);
		expect(computeCanvasScale({ width: 0, height: 100 }, slide)).toBe(0);
	});
});

describe("content fit", () => {
	it("enlarges sparse content, capped at the maximum", () => {
		const fit = computeContentFit({ x: 700, y: 400, width: 200, height: 100 }, slide);
		expect(fit.scale).toBe(MAX_CONTENT_SCALE);
		// The bounding box ends up centered.
		expect(fit.translateX + 700 * fit.scale + (200 * fit.scale) / 2).toBeCloseTo(800);
		expect(fit.translateY + 400 * fit.scale + (100 * fit.scale) / 2).toBeCloseTo(450);
	});

	it("leaves well-filled content alone", () => {
		expect(computeContentFit({ x: 100, y: 60, width: 1400, height: 780 }, slide)).toEqual({ scale: 1, translateX: 0, translateY: 0 });
	});

	it("shrinks overflowing content to fit", () => {
		const fit = computeContentFit({ x: 0, y: 0, width: 1600, height: 1400 }, slide);
		expect(fit.scale).toBeLessThan(1);
		expect(1400 * fit.scale).toBeLessThanOrEqual(900);
	});

	it("ignores missing bounds", () => {
		expect(computeContentFit(null, slide).scale).toBe(1);
	});
});
