import { describe, expect, it } from "vitest";
import { filterSlideClasses, isAllowedSlideClass, isAllowedSlideTag, isForbiddenSlideTag, SLIDE_ALLOWED_CLASSES } from "../src";

describe("slide class allowlist", () => {
	it("allows design-system classes", () => {
		for (const token of ["w-full", "h-full", "grid-cols-3", "text-7xl", "bg-ctp-blue", "text-ctp-red", "border-ctp-surface1", "bg-ctp-green/15"]) {
			expect(isAllowedSlideClass(token)).toBe(true);
		}
	});

	it("rejects arbitrary values and unknown classes", () => {
		for (const token of [
			"text-[73px]",
			"w-[123px]",
			"bg-[#abcdef]",
			"bg-[url(https://x)]",
			"content-['x']",
			"absolute",
			"fixed",
			"-top-4",
			"z-50",
			"hidden",
			"bg-red-500",
			"[&>*]:hidden",
			"hover:bg-ctp-blue"
		]) {
			expect(isAllowedSlideClass(token)).toBe(false);
		}
	});

	it("filters a class attribute into kept and rejected tokens", () => {
		const result = filterSlideClasses("  flex  text-[73px] flex gap-4 fixed ");
		expect(result.kept).toEqual(["flex", "gap-4"]);
		expect(result.rejected).toEqual(["text-[73px]", "fixed"]);
	});

	it("is finite and contains no arbitrary-value syntax", () => {
		expect(SLIDE_ALLOWED_CLASSES.length).toBeLessThan(250);
		for (const token of SLIDE_ALLOWED_CLASSES) {
			expect(token).toMatch(/^[a-z0-9-]+(\/\d+)?$/);
		}
	});
});

describe("slide tag policy", () => {
	it("allows only structural text tags", () => {
		expect(isAllowedSlideTag("div")).toBe(true);
		expect(isAllowedSlideTag("LI")).toBe(true);
		expect(isAllowedSlideTag("a")).toBe(false);
		expect(isAllowedSlideTag("img")).toBe(false);
	});

	it("marks dangerous tags as forbidden", () => {
		for (const tag of ["script", "style", "iframe", "svg", "img", "form", "link", "object"]) {
			expect(isForbiddenSlideTag(tag)).toBe(true);
		}
	});
});
