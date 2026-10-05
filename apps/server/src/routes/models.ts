import { pickDefaultModel, type ModelsResponse } from "@innoverse/shared";
import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../app";
import { AppError } from "../errors";

export function registerModelRoutes(app: FastifyInstance, deps: AppDependencies): void {
	app.get("/models", async () => {
		if (!deps.codex.isAuthenticated) throw new AppError("CODEX_UNAUTHENTICATED");
		const models = await deps.codex.listModels();
		const configured = models.find(model => model.id === deps.config.DEFAULT_MODEL);
		const body: ModelsResponse = { models, defaultModel: (configured ?? pickDefaultModel(models))?.id ?? null };
		return body;
	});
}
