import { z } from "zod";
import type { ArtifactMode } from "./artifacts";

/**
 * Structured output returned by Codex. These Zod schemas mirror the JSON Schemas
 * passed to `turn/start` as `outputSchema`; Codex output is validated again here
 * because structured output does not remove the need for runtime validation.
 */
export const PresentationOutputSchema = z
	.object({
		html: z.string().min(1).max(100_000),
		warnings: z.array(z.string().max(500)).max(10)
	})
	.strict();
export type PresentationOutput = z.infer<typeof PresentationOutputSchema>;

export const DocumentOutputSchema = z
	.object({
		markdown: z.string().min(1).max(400_000),
		warnings: z.array(z.string().max(500)).max(10)
	})
	.strict();
export type DocumentOutput = z.infer<typeof DocumentOutputSchema>;

const warningsJsonSchema = { type: "array", items: { type: "string" } } as const;

export const PRESENTATION_OUTPUT_JSON_SCHEMA = {
	type: "object",
	properties: {
		html: { type: "string" },
		warnings: warningsJsonSchema
	},
	required: ["html", "warnings"],
	additionalProperties: false
} as const;

export const DOCUMENT_OUTPUT_JSON_SCHEMA = {
	type: "object",
	properties: {
		markdown: { type: "string" },
		warnings: warningsJsonSchema
	},
	required: ["markdown", "warnings"],
	additionalProperties: false
} as const;

export function outputJsonSchemaFor(mode: ArtifactMode) {
	return mode === "presentation" ? PRESENTATION_OUTPUT_JSON_SCHEMA : DOCUMENT_OUTPUT_JSON_SCHEMA;
}
