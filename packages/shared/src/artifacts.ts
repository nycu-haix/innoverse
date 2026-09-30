import { z } from "zod";

export const ARTIFACT_MODES = ["presentation", "document"] as const;

export const ArtifactModeSchema = z.enum(ARTIFACT_MODES);
export type ArtifactMode = z.infer<typeof ArtifactModeSchema>;

/** Browser-generated workspace identifier (crypto.randomUUID()). Not authentication. */
export const WorkspaceIdSchema = z.uuid();

/** Upper bound for stored artifact content (sanitized slide HTML or Markdown). */
export const MAX_ARTIFACT_CONTENT_LENGTH = 500_000;

export const ArtifactSchema = z.object({
	mode: ArtifactModeSchema,
	content: z.string().max(MAX_ARTIFACT_CONTENT_LENGTH),
	/** Monotonic revision. 0 means "no artifact saved yet". */
	revision: z.int().nonnegative(),
	warnings: z.array(z.string()),
	updatedAt: z.string()
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const WorkspaceSchema = z.object({
	id: WorkspaceIdSchema,
	artifacts: z.object({
		presentation: ArtifactSchema.nullable(),
		document: ArtifactSchema.nullable()
	}),
	hotwords: z.array(z.string())
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceParamsSchema = z.object({
	workspaceId: WorkspaceIdSchema
});

export const ArtifactParamsSchema = z.object({
	workspaceId: WorkspaceIdSchema,
	mode: ArtifactModeSchema
});

/**
 * Manual artifact edit. `baseRevision` is the revision the client edited from;
 * the server only applies the update when it still matches (optimistic concurrency).
 */
export const UpdateArtifactRequestSchema = z.object({
	content: z.string().max(MAX_ARTIFACT_CONTENT_LENGTH),
	baseRevision: z.int().nonnegative()
});
export type UpdateArtifactRequest = z.infer<typeof UpdateArtifactRequestSchema>;

export const UpdateArtifactResponseSchema = z.object({
	artifact: ArtifactSchema
});
export type UpdateArtifactResponse = z.infer<typeof UpdateArtifactResponseSchema>;

export const MAX_HOTWORDS = 200;
export const MAX_HOTWORD_LENGTH = 64;

export const UpdateHotwordsRequestSchema = z.object({
	hotwords: z.array(z.string().max(MAX_HOTWORD_LENGTH)).max(MAX_HOTWORDS)
});
export type UpdateHotwordsRequest = z.infer<typeof UpdateHotwordsRequestSchema>;

export const UpdateHotwordsResponseSchema = z.object({
	hotwords: z.array(z.string())
});

/** Trim, drop empties and duplicates, and cap the list. Order is preserved. */
export function normalizeHotwords(input: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of input) {
		// Strip control characters and the delimiters the ASR prompt uses to separate terms.
		// eslint-disable-next-line no-control-regex
		const term = raw.replace(/[\u0000-\u001f\u007f[\]]/g, "").trim();
		if (!term || term.length > MAX_HOTWORD_LENGTH || seen.has(term)) continue;
		seen.add(term);
		result.push(term);
		if (result.length >= MAX_HOTWORDS) break;
	}
	return result;
}
