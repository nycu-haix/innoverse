import { describe, expect, it } from "vitest";
import { diffChars } from "../src/lib/diff";

describe("diffChars", () => {
	it("marks replaced characters", () => {
		expect(diffChars("灰色帽踢", "灰色連帽外套")).toEqual([
			{ op: "=", text: "灰色" },
			{ op: "+", text: "連" },
			{ op: "=", text: "帽" },
			{ op: "-", text: "踢" },
			{ op: "+", text: "外套" }
		]);
		expect(diffChars("", "新")).toEqual([{ op: "+", text: "新" }]);
	});
});
