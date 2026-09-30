import { z } from "zod";

/** Sanitized view of a Codex `model/list` entry exposed to the browser. */
export const ModelOptionSchema = z.object({
	id: z.string().min(1),
	displayName: z.string(),
	description: z.string(),
	supportedReasoningEfforts: z.array(z.string()),
	defaultReasoningEffort: z.string().nullable(),
	isDefault: z.boolean()
});
export type ModelOption = z.infer<typeof ModelOptionSchema>;

export const ModelsResponseSchema = z.object({
	models: z.array(ModelOptionSchema),
	defaultModel: z.string().nullable()
});
export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;

/** Cheapest first. Unknown efforts sort after known ones, keeping catalog order. */
export const REASONING_EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

function effortRank(effort: string): number {
	const index = (REASONING_EFFORT_ORDER as readonly string[]).indexOf(effort);
	return index === -1 ? REASONING_EFFORT_ORDER.length : index;
}

/**
 * The app prioritizes latency: prefer `none`, otherwise the least expensive effort
 * the model supports, otherwise the model's own default.
 */
export function pickDefaultReasoningEffort(model: Pick<ModelOption, "supportedReasoningEfforts" | "defaultReasoningEffort">): string | null {
	const efforts = model.supportedReasoningEfforts;
	if (efforts.length === 0) return model.defaultReasoningEffort;
	let best = efforts[0] as string;
	for (const effort of efforts) {
		if (effortRank(effort) < effortRank(best)) best = effort;
	}
	return best;
}

export function pickDefaultModel(models: readonly ModelOption[]): ModelOption | null {
	return models.find(model => model.isDefault) ?? models[0] ?? null;
}

export type ModelSelection = { model: string; reasoningEffort: string | null };

export type ModelSelectionResult = { ok: true; selection: ModelSelection } | { ok: false; code: "INVALID_MODEL" | "INVALID_REASONING_EFFORT" };

/**
 * Validate a client-provided model / reasoning effort against the server-side catalog.
 * Missing values fall back to catalog defaults; unknown values are rejected.
 */
export function resolveModelSelection(models: readonly ModelOption[], requestedModel: string | undefined, requestedEffort: string | undefined): ModelSelectionResult {
	const model = requestedModel ? models.find(candidate => candidate.id === requestedModel) : pickDefaultModel(models);
	if (!model) return { ok: false, code: "INVALID_MODEL" };
	if (requestedEffort) {
		if (!model.supportedReasoningEfforts.includes(requestedEffort)) return { ok: false, code: "INVALID_REASONING_EFFORT" };
		return { ok: true, selection: { model: model.id, reasoningEffort: requestedEffort } };
	}
	return { ok: true, selection: { model: model.id, reasoningEffort: pickDefaultReasoningEffort(model) } };
}
