import { apiError, ArtifactParamsSchema, normalizeHotwords, UpdateArtifactRequestSchema, UpdateHotwordsRequestSchema, WorkspaceParamsSchema } from "@innoverse/shared";
import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../app";
import { toPublicArtifact } from "../db/database";
import { AppError } from "../errors";
import { sanitizeSlideHtml } from "../slide/sanitize";
import { parseInput } from "./validate";

export function registerWorkspaceRoutes(app: FastifyInstance, deps: AppDependencies): void {
	app.get("/workspaces/:workspaceId", async (request, reply) => {
		const { workspaceId } = parseInput(WorkspaceParamsSchema, request.params);
		reply.header("cache-control", "no-store");
		try {
			return deps.db.getWorkspace(workspaceId);
		} catch (error) {
			throw new AppError("DATABASE_ERROR", { cause: error });
		}
	});

	/** Manual edit with optimistic concurrency (baseRevision must match). */
	app.put("/workspaces/:workspaceId/artifacts/:mode", async (request, reply) => {
		const { workspaceId, mode } = parseInput(ArtifactParamsSchema, request.params);
		const body = parseInput(UpdateArtifactRequestSchema, request.body);

		let content = body.content;
		if (mode === "presentation") {
			const sanitized = sanitizeSlideHtml(content);
			if (!sanitized.ok) throw new AppError("INVALID_SLIDE");
			content = sanitized.html;
		}

		let result;
		try {
			const current = deps.db.getArtifact(workspaceId, mode);
			result = deps.db.saveArtifact({ workspaceId, mode, content, warnings: current?.warnings ?? [], baseRevision: body.baseRevision });
		} catch (error) {
			throw new AppError("DATABASE_ERROR", { cause: error });
		}
		if (!result.ok) {
			return reply.status(409).send({ ...apiError("STALE_REVISION"), current: result.current ? toPublicArtifact(result.current) : null });
		}
		return { artifact: toPublicArtifact(result.artifact) };
	});

	app.put("/workspaces/:workspaceId/hotwords", async request => {
		const { workspaceId } = parseInput(WorkspaceParamsSchema, request.params);
		const body = parseInput(UpdateHotwordsRequestSchema, request.body);
		const hotwords = normalizeHotwords(body.hotwords);
		try {
			deps.db.setHotwords(workspaceId, hotwords);
		} catch (error) {
			throw new AppError("DATABASE_ERROR", { cause: error });
		}
		return { hotwords };
	});
}
