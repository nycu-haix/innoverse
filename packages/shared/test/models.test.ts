import { describe, expect, it } from "vitest";
import { pickDefaultModel, pickDefaultReasoningEffort, resolveModelSelection, type ModelOption } from "../src";

const models: ModelOption[] = [
	{ id: "gpt-a", displayName: "A", description: "", supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium", isDefault: false },
	{ id: "gpt-b", displayName: "B", description: "", supportedReasoningEfforts: ["medium", "none", "high"], defaultReasoningEffort: "medium", isDefault: true },
	{ id: "gpt-c", displayName: "C", description: "", supportedReasoningEfforts: [], defaultReasoningEffort: "medium", isDefault: false }
];

describe("model defaults", () => {
	it("uses isDefault when available", () => {
		expect(pickDefaultModel(models)?.id).toBe("gpt-b");
		expect(pickDefaultModel([models[0]!])?.id).toBe("gpt-a");
		expect(pickDefaultModel([])).toBeNull();
	});

	it("prefers none, then the least expensive effort", () => {
		expect(pickDefaultReasoningEffort(models[1]!)).toBe("none");
		expect(pickDefaultReasoningEffort(models[0]!)).toBe("low");
		expect(pickDefaultReasoningEffort(models[2]!)).toBe("medium");
		expect(pickDefaultReasoningEffort({ supportedReasoningEfforts: ["turbo", "minimal"], defaultReasoningEffort: null })).toBe("minimal");
	});
});

describe("resolveModelSelection", () => {
	it("falls back to catalog defaults", () => {
		expect(resolveModelSelection(models, undefined, undefined)).toEqual({ ok: true, selection: { model: "gpt-b", reasoningEffort: "none" } });
	});

	it("accepts valid selections", () => {
		expect(resolveModelSelection(models, "gpt-a", "high")).toEqual({ ok: true, selection: { model: "gpt-a", reasoningEffort: "high" } });
	});

	it("rejects unknown models", () => {
		expect(resolveModelSelection(models, "gpt-unknown", undefined)).toEqual({ ok: false, code: "INVALID_MODEL" });
		expect(resolveModelSelection([], undefined, undefined)).toEqual({ ok: false, code: "INVALID_MODEL" });
	});

	it("rejects efforts the model does not support", () => {
		expect(resolveModelSelection(models, "gpt-a", "none")).toEqual({ ok: false, code: "INVALID_REASONING_EFFORT" });
		expect(resolveModelSelection(models, "gpt-b", "ultra")).toEqual({ ok: false, code: "INVALID_REASONING_EFFORT" });
	});
});
