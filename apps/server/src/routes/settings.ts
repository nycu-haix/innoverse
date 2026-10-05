import { normalizeHotwords, SettingsSchema } from "@innoverse/shared";
import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../app";
import { AppError } from "../errors";
import { parseInput } from "./validate";

export function registerSettingsRoutes(app: FastifyInstance, deps: AppDependencies): void {
	app.get("/settings", async (_request, reply) => {
		reply.header("cache-control", "no-store");
		try {
			return deps.db.getSettings();
		} catch (error) {
			throw new AppError("DATABASE_ERROR", { cause: error });
		}
	});

	/** Model choice is validated against the live catalog when it is used, not here. */
	app.put("/settings", async request => {
		const body = parseInput(SettingsSchema, request.body);
		const settings = { ...body, hotwords: normalizeHotwords(body.hotwords) };
		try {
			deps.db.saveSettings(settings);
		} catch (error) {
			throw new AppError("DATABASE_ERROR", { cause: error });
		}
		return settings;
	});
}
