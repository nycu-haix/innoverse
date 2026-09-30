import { pickDefaultModel, pickDefaultReasoningEffort, type ModelOption } from "@innoverse/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { readPreference, writePreference } from "../lib/storage";

/** Model catalog from Codex (never hardcoded) plus the user's selection. */
export function useModels(enabled: boolean) {
	const [models, setModels] = useState<ModelOption[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [modelId, setModelId] = useState<string | null>(() => readPreference("model"));
	const [effort, setEffort] = useState<string | null>(() => readPreference("reasoningEffort"));

	useEffect(() => {
		if (!enabled) return;
		let active = true;
		api
			.models()
			.then(response => {
				if (!active) return;
				setModels(response.models);
				setLoaded(true);
			})
			.catch(() => {
				if (active) setLoaded(true);
			});
		return () => {
			active = false;
		};
	}, [enabled]);

	const model = useMemo(() => models.find(candidate => candidate.id === modelId) ?? pickDefaultModel(models), [modelId, models]);
	const reasoningEffort = useMemo(() => {
		if (!model) return null;
		if (effort && model.supportedReasoningEfforts.includes(effort)) return effort;
		return pickDefaultReasoningEffort(model);
	}, [effort, model]);

	const selectModel = useCallback((id: string) => {
		setModelId(id);
		writePreference("model", id);
		// Reset to the cheapest effort of the newly selected model.
		setEffort(null);
		writePreference("reasoningEffort", null);
	}, []);

	const selectEffort = useCallback((value: string) => {
		setEffort(value);
		writePreference("reasoningEffort", value);
	}, []);

	return { models, loaded, model, reasoningEffort, selectModel, selectEffort };
}
