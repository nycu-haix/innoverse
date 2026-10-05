import { pickDefaultModel, pickDefaultReasoningEffort, type ModelOption, type Settings } from "@innoverse/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

/**
 * Model catalog from Codex (never hardcoded) plus the server-side settings. Analysis
 * runs on the server without a request from the browser, so the choice lives there.
 */
export function useModels() {
	const [models, setModels] = useState<ModelOption[]>([]);
	const [defaultModel, setDefaultModel] = useState<string | null>(null);
	const [settings, setSettings] = useState<Settings>({ model: null, reasoningEffort: null, hotwords: [] });

	useEffect(() => {
		let active = true;
		api.models().then(
			response => {
				if (!active) return;
				setModels(response.models);
				setDefaultModel(response.defaultModel);
			},
			() => undefined
		);
		api.settings().then(
			response => active && setSettings(response),
			() => undefined
		);
		return () => {
			active = false;
		};
	}, []);

	const model = useMemo(() => models.find(candidate => candidate.id === (settings.model ?? defaultModel)) ?? pickDefaultModel(models), [models, settings.model, defaultModel]);
	const reasoningEffort = useMemo(() => {
		if (!model) return null;
		if (settings.reasoningEffort && model.supportedReasoningEfforts.includes(settings.reasoningEffort)) return settings.reasoningEffort;
		return pickDefaultReasoningEffort(model);
	}, [model, settings.reasoningEffort]);

	const save = useCallback((next: Settings) => {
		setSettings(next);
		api.saveSettings(next).then(setSettings, () => undefined);
	}, []);

	return {
		models,
		model,
		reasoningEffort,
		hotwords: settings.hotwords,
		// Changing the model resets the effort to that model's cheapest option.
		selectModel: (id: string) => save({ ...settings, model: id, reasoningEffort: null }),
		selectEffort: (effort: string) => save({ ...settings, reasoningEffort: effort }),
		saveHotwords: (hotwords: string[]) => save({ ...settings, hotwords })
	};
}
