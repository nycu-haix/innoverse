import { describe, expect, it } from "vitest";
import { DOCUMENT_OUTPUT_JSON_SCHEMA, DocumentOutputSchema, PRESENTATION_OUTPUT_JSON_SCHEMA, PresentationOutputSchema } from "../src";

describe("PresentationOutputSchema", () => {
	it("accepts html with warnings", () => {
		const parsed = PresentationOutputSchema.parse({ html: '<div class="w-full h-full">💊</div>', warnings: [] });
		expect(parsed.html).toContain("💊");
	});

	it("rejects missing fields, empty html and extra properties", () => {
		expect(PresentationOutputSchema.safeParse({ html: "<div></div>" }).success).toBe(false);
		expect(PresentationOutputSchema.safeParse({ html: "", warnings: [] }).success).toBe(false);
		expect(PresentationOutputSchema.safeParse({ html: "<div></div>", warnings: [], script: "x" }).success).toBe(false);
		expect(PresentationOutputSchema.safeParse({ markdown: "# a", warnings: [] }).success).toBe(false);
	});

	it("matches the JSON schema sent to Codex", () => {
		expect(PRESENTATION_OUTPUT_JSON_SCHEMA.required).toEqual(["html", "warnings"]);
		expect(PRESENTATION_OUTPUT_JSON_SCHEMA.additionalProperties).toBe(false);
	});
});

describe("DocumentOutputSchema", () => {
	it("accepts markdown with warnings", () => {
		const parsed = DocumentOutputSchema.parse({ markdown: "# 會議紀錄\n\n- 決議", warnings: ["原始語音中的藥名可能辨識不清。"] });
		expect(parsed.warnings).toHaveLength(1);
	});

	it("rejects non-string markdown and non-array warnings", () => {
		expect(DocumentOutputSchema.safeParse({ markdown: 3, warnings: [] }).success).toBe(false);
		expect(DocumentOutputSchema.safeParse({ markdown: "a", warnings: "none" }).success).toBe(false);
		expect(DocumentOutputSchema.safeParse({ markdown: "a", warnings: [], html: "" }).success).toBe(false);
	});

	it("matches the JSON schema sent to Codex", () => {
		expect(Object.keys(DOCUMENT_OUTPUT_JSON_SCHEMA.properties)).toEqual(["markdown", "warnings"]);
		expect(DOCUMENT_OUTPUT_JSON_SCHEMA.additionalProperties).toBe(false);
	});
});
