import { describe, expect, it } from "vitest";
import { GenerateMetadataSchema, GenerationEventSchema, GenerationResultSchema, normalizeHotwords, UpdateArtifactRequestSchema, WorkspaceSchema } from "../src";

const workspaceId = "3f2c1b8e-7a4d-4e6f-9b1a-2c3d4e5f6a7b";

describe("GenerateMetadataSchema", () => {
	it("parses multipart string fields", () => {
		const parsed = GenerateMetadataSchema.parse({ workspaceId, mode: "document", continue: "true", model: "gpt-b", reasoningEffort: "none", artifactRevision: "7" });
		expect(parsed).toEqual({ workspaceId, mode: "document", continue: true, model: "gpt-b", reasoningEffort: "none", artifactRevision: 7 });
	});

	it("treats empty model fields as absent", () => {
		const parsed = GenerateMetadataSchema.parse({ workspaceId, mode: "presentation", continue: "false", model: "", artifactRevision: "0" });
		expect(parsed.model).toBeUndefined();
		expect(parsed.continue).toBe(false);
	});

	it("rejects invalid metadata", () => {
		expect(GenerateMetadataSchema.safeParse({ workspaceId: "nope", mode: "document", continue: "false", artifactRevision: "0" }).success).toBe(false);
		expect(GenerateMetadataSchema.safeParse({ workspaceId, mode: "chat", continue: "false", artifactRevision: "0" }).success).toBe(false);
		expect(GenerateMetadataSchema.safeParse({ workspaceId, mode: "document", continue: "yes", artifactRevision: "0" }).success).toBe(false);
		expect(GenerateMetadataSchema.safeParse({ workspaceId, mode: "document", continue: "false", artifactRevision: "-1" }).success).toBe(false);
	});
});

describe("generation result", () => {
	const result = {
		generationId: "g1",
		artifact: { mode: "document", content: "# x", revision: 2, warnings: [], updatedAt: "2026-01-01T00:00:00.000Z" },
		warnings: [],
		timings: { audioDurationMs: 1000, asrDurationMs: 10, aiDurationMs: 20, totalDurationMs: 40 }
	};

	it("validates a complete result", () => {
		expect(GenerationResultSchema.parse(result).artifact.revision).toBe(2);
		expect(GenerationEventSchema.parse({ type: "result", result }).type).toBe("result");
	});

	it("rejects incomplete results and unknown events", () => {
		expect(GenerationResultSchema.safeParse({ ...result, artifact: { ...result.artifact, revision: -1 } }).success).toBe(false);
		expect(GenerationEventSchema.safeParse({ type: "partial", html: "<div>" }).success).toBe(false);
		expect(GenerationEventSchema.safeParse({ type: "error", error: { code: "NOPE", message: "x" } }).success).toBe(false);
	});
});

describe("workspace schemas", () => {
	it("validates workspace payloads", () => {
		expect(WorkspaceSchema.parse({ id: workspaceId, artifacts: { presentation: null, document: null }, hotwords: [] }).id).toBe(workspaceId);
		expect(WorkspaceSchema.safeParse({ id: workspaceId, artifacts: { presentation: null }, hotwords: [] }).success).toBe(false);
	});

	it("requires a base revision for updates", () => {
		expect(UpdateArtifactRequestSchema.safeParse({ content: "x" }).success).toBe(false);
		expect(UpdateArtifactRequestSchema.safeParse({ content: "x", baseRevision: 1.5 }).success).toBe(false);
		expect(UpdateArtifactRequestSchema.parse({ content: "x", baseRevision: 3 }).baseRevision).toBe(3);
	});
});

describe("normalizeHotwords", () => {
	it("trims, deduplicates and strips delimiter characters", () => {
		expect(normalizeHotwords([" 克拉黴素 ", "阿莫西林", "克拉黴素", "", "[Metformin]", "a\u0000b"])).toEqual(["克拉黴素", "阿莫西林", "Metformin", "ab"]);
	});
});
