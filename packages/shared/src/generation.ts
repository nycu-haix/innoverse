import { z } from "zod";
import { ArtifactModeSchema, ArtifactSchema, WorkspaceIdSchema } from "./artifacts";
import { ErrorCodeSchema } from "./errors";

/** Multipart form fields are strings; this parses them into typed metadata. */
const booleanField = z.enum(["true", "false"]).transform(value => value === "true");

const optionalNonEmpty = z
	.string()
	.max(128)
	.optional()
	.transform(value => (value ? value : undefined));

/**
 * Metadata fields sent with `POST /api/generate` (multipart/form-data).
 * The client must append these fields before the `audio` file part.
 */
export const GenerateMetadataSchema = z.object({
	workspaceId: WorkspaceIdSchema,
	mode: ArtifactModeSchema,
	continue: booleanField,
	model: optionalNonEmpty,
	reasoningEffort: optionalNonEmpty,
	artifactRevision: z.coerce.number().int().nonnegative()
});
export type GenerateMetadata = z.infer<typeof GenerateMetadataSchema>;

/** Field names in the order the client should append them. */
export const GENERATE_METADATA_FIELDS = ["workspaceId", "mode", "continue", "model", "reasoningEffort", "artifactRevision"] as const;

export const GenerationStageSchema = z.enum(["transcribing", "generating"]);
export type GenerationStage = z.infer<typeof GenerationStageSchema>;

export const GenerationTimingsSchema = z.object({
	audioDurationMs: z.number().nonnegative().nullable(),
	asrDurationMs: z.number().nonnegative(),
	aiDurationMs: z.number().nonnegative(),
	totalDurationMs: z.number().nonnegative()
});
export type GenerationTimings = z.infer<typeof GenerationTimingsSchema>;

export const GenerationResultSchema = z.object({
	generationId: z.string(),
	artifact: ArtifactSchema,
	warnings: z.array(z.string()),
	timings: GenerationTimingsSchema
});
export type GenerationResult = z.infer<typeof GenerationResultSchema>;

/**
 * `POST /api/generate` streams newline-delimited JSON events so the browser can show
 * stages without WebSockets. Only a completed, validated artifact is ever sent.
 */
export const GenerationEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("stage"), stage: GenerationStageSchema }),
	z.object({ type: z.literal("result"), result: GenerationResultSchema }),
	z.object({ type: z.literal("error"), error: z.object({ code: ErrorCodeSchema, message: z.string() }) })
]);
export type GenerationEvent = z.infer<typeof GenerationEventSchema>;
