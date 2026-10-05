import { describe, expect, it } from "vitest";
import { ANALYSIS_OUTPUT_JSON_SCHEMA, AnalysisDeltaSchema, AnalysisOutputSchema, KNOWLEDGE_BASE, normalizeHotwords, parseMarkup, stripMarkup } from "../src";

describe("inline markup", () => {
	it("splits typed values and keeps malformed markup as text", () => {
		expect(parseMarkup("{t|9 月 10 日}轉帳 {a|NT$50,000} 到 {x|y}")).toEqual([
			{ kind: "t", text: "9 月 10 日" },
			{ kind: null, text: "轉帳 " },
			{ kind: "a", text: "NT$50,000" },
			{ kind: null, text: " 到 {x|y}" }
		]);
		expect(stripMarkup("LINE ID：{i|invest_chen888}")).toBe("LINE ID：invest_chen888");
	});
});

describe("analysis schema", () => {
	it("requires every property in the JSON schema (strict structured output)", () => {
		const check = (schema: Record<string, unknown>) => {
			if (schema.type === "object") {
				const properties = schema.properties as Record<string, Record<string, unknown>>;
				expect(schema.required).toEqual(Object.keys(properties));
				expect(schema.additionalProperties).toBe(false);
				Object.values(properties).forEach(check);
			}
			if (schema.type === "array") check(schema.items as Record<string, unknown>);
		};
		check(ANALYSIS_OUTPUT_JSON_SCHEMA as unknown as Record<string, unknown>);
		const zodKeys = Object.keys(AnalysisDeltaSchema.shape);
		expect(Object.keys(ANALYSIS_OUTPUT_JSON_SCHEMA.properties)).toEqual(zodKeys);
	});

	it("rejects ids the client could not address", () => {
		const base = { fraudType: null, deliveryMethods: [], victimName: null, speakers: [], conflicts: [], actions: [] };
		const block = { id: "Payment 1", kind: "payment", title: "交付 #1", subtitle: null, status: "ok", facts: [], gaps: [] };
		expect(AnalysisOutputSchema.safeParse({ ...base, blocks: [block] }).success).toBe(false);
		expect(AnalysisOutputSchema.safeParse({ ...base, blocks: [{ ...block, id: "payment-1" }] }).success).toBe(true);
	});
});

describe("knowledge base", () => {
	it("uses unique item ids that are valid gap ids", () => {
		const ids = KNOWLEDGE_BASE.flatMap(scenario => scenario.items.map(item => item.id));
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
	});
});

describe("normalizeHotwords", () => {
	it("trims, deduplicates and strips delimiters", () => {
		expect(normalizeHotwords([" 竹北 ", "竹北", "", "[USDT]"])).toEqual(["竹北", "USDT"]);
	});
});
