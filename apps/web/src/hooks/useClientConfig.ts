import type { ClientConfig } from "@innoverse/shared";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

const FALLBACK: ClientConfig = { maxRecordingSeconds: 60 * 60, maxAudioBytes: 262_144_000 };

export function useClientConfig(): ClientConfig {
	const [config, setConfig] = useState<ClientConfig>(FALLBACK);
	useEffect(() => {
		api
			.config()
			.then(setConfig)
			.catch(() => undefined);
	}, []);
	return config;
}
