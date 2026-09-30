import type { Artifact, ArtifactMode, Workspace } from "@innoverse/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { ClientError } from "../lib/errors";

export type LocalArtifact = { content: string; revision: number; warnings: string[] };

type Artifacts = Record<ArtifactMode, LocalArtifact>;

const EMPTY: LocalArtifact = { content: "", revision: 0, warnings: [] };
const SAVE_DEBOUNCE_MS = 800;

function fromServer(artifact: Artifact | null): LocalArtifact {
	return artifact ? { content: artifact.content, revision: artifact.revision, warnings: artifact.warnings } : EMPTY;
}

/**
 * Independent artifact state for both modes. Manual edits update local state
 * immediately and are persisted with a debounce using optimistic concurrency.
 */
export function useWorkspaceArtifacts(workspaceId: string, options: { enabled: boolean; onConflict: () => void; onSaveError: (error: unknown) => void }) {
	const [artifacts, setArtifacts] = useState<Artifacts>({ presentation: EMPTY, document: EMPTY });
	const [hotwords, setHotwords] = useState<string[]>([]);
	const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
	const artifactsRef = useRef(artifacts);
	const dirty = useRef<Record<ArtifactMode, boolean>>({ presentation: false, document: false });
	const timers = useRef<Partial<Record<ArtifactMode, number>>>({});
	const saving = useRef<Promise<void>>(Promise.resolve());
	const optionsRef = useRef(options);

	useEffect(() => {
		optionsRef.current = options;
	}, [options]);

	const commit = useCallback((next: Artifacts) => {
		artifactsRef.current = next;
		setArtifacts(next);
	}, []);

	const applyWorkspace = useCallback(
		(workspace: Workspace) => {
			dirty.current = { presentation: false, document: false };
			commit({ presentation: fromServer(workspace.artifacts.presentation), document: fromServer(workspace.artifacts.document) });
			setHotwords(workspace.hotwords);
			setStatus("ready");
		},
		[commit]
	);

	const onLoadError = useCallback(() => setStatus(current => (current === "ready" ? current : "error")), []);

	const reload = useCallback(() => api.workspace(workspaceId).then(applyWorkspace, onLoadError), [applyWorkspace, onLoadError, workspaceId]);

	useEffect(() => {
		if (options.enabled) api.workspace(workspaceId).then(applyWorkspace, onLoadError);
	}, [applyWorkspace, onLoadError, options.enabled, workspaceId]);

	/** Serialized save of the latest local content for `mode`. */
	const save = useCallback(
		(mode: ArtifactMode): Promise<void> => {
			saving.current = saving.current.then(async () => {
				if (!dirty.current[mode]) return;
				const local = artifactsRef.current[mode];
				dirty.current[mode] = false;
				try {
					const result = await api.saveArtifact(workspaceId, mode, local.content, local.revision);
					if (result.ok) {
						const latest = artifactsRef.current[mode];
						// Keep newer keystrokes typed while the request was in flight.
						commit({ ...artifactsRef.current, [mode]: { ...latest, revision: result.artifact.revision } });
					} else {
						commit({ ...artifactsRef.current, [mode]: fromServer(result.current) });
						optionsRef.current.onConflict();
					}
				} catch (error) {
					dirty.current[mode] = true;
					optionsRef.current.onSaveError(error);
				}
			});
			return saving.current;
		},
		[commit, workspaceId]
	);

	const updateContent = useCallback(
		(mode: ArtifactMode, content: string) => {
			const current = artifactsRef.current[mode];
			if (current.content === content) return;
			commit({ ...artifactsRef.current, [mode]: { ...current, content } });
			dirty.current[mode] = true;
			window.clearTimeout(timers.current[mode]);
			timers.current[mode] = window.setTimeout(() => void save(mode), SAVE_DEBOUNCE_MS);
		},
		[commit, save]
	);

	/** Persist pending edits now and return the latest saved revision. */
	const flush = useCallback(
		async (mode: ArtifactMode): Promise<number> => {
			window.clearTimeout(timers.current[mode]);
			await save(mode);
			if (dirty.current[mode]) throw new ClientError("DATABASE_ERROR");
			return artifactsRef.current[mode].revision;
		},
		[save]
	);

	/** Replace an artifact with a completed generation result. */
	const applyGenerated = useCallback(
		(artifact: Artifact) => {
			dirty.current[artifact.mode] = false;
			commit({ ...artifactsRef.current, [artifact.mode]: fromServer(artifact) });
		},
		[commit]
	);

	// Flush pending edits when the page is hidden or closed.
	useEffect(() => {
		const onHide = () => {
			if (document.visibilityState === "hidden") {
				for (const mode of ["presentation", "document"] as const) if (dirty.current[mode]) void save(mode);
			}
		};
		document.addEventListener("visibilitychange", onHide);
		return () => document.removeEventListener("visibilitychange", onHide);
	}, [save]);

	useEffect(() => {
		const pending = timers.current;
		return () => {
			for (const timer of Object.values(pending)) window.clearTimeout(timer);
		};
	}, []);

	return { artifacts, hotwords, setHotwords, status, reload, updateContent, flush, applyGenerated };
}
