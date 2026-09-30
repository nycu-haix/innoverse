import type { ArtifactMode, AuthStatus } from "@innoverse/shared";
import { lazy, Suspense, useCallback, useReducer, useRef, useState } from "react";
import { useClientConfig } from "../hooks/useClientConfig";
import { useModels } from "../hooks/useModels";
import { useRecorder } from "../hooks/useRecorder";
import { useWorkspaceArtifacts } from "../hooks/useWorkspaceArtifacts";
import { api, generateArtifact } from "../lib/api";
import { ClientError, userMessage } from "../lib/errors";
import { readPreference, writePreference } from "../lib/storage";
import { canStartRecording, initialSession, isProcessing, sessionReducer } from "../state/session";
import { SettingsPopover } from "./SettingsPopover";
import { SlideStage } from "./SlideStage";
import { StatusLine } from "./StatusLine";
import { Toolbar } from "./Toolbar";

// Milkdown is only needed in document mode; keep it out of the initial bundle.
const DocumentPage = lazy(() => import("./DocumentPage").then(module => ({ default: module.DocumentPage })));

type Props = {
	workspaceId: string;
	account: AuthStatus["account"];
	onLogout: () => void;
	onAuthLost: () => void;
};

/** One workspace, one floating toolbar. The artifact is the product. */
export function Workspace({ workspaceId, account, onLogout, onAuthLost }: Props) {
	const [mode, setMode] = useState<ArtifactMode>(() => (readPreference("mode") === "document" ? "document" : "presentation"));
	const [continueEnabled, setContinueEnabled] = useState(() => readPreference("continue") === "true");
	const [session, dispatch] = useReducer(sessionReducer, initialSession);
	const [notice, setNotice] = useState<string | null>(null);
	const recordingMode = useRef<ArtifactMode>(mode);
	/** Mode the current recording/generation belongs to (state, so render can read it). */
	const [activeMode, setActiveMode] = useState<ArtifactMode | null>(null);
	const submitting = useRef(false);

	const config = useClientConfig();
	const models = useModels(true);
	const workspace = useWorkspaceArtifacts(workspaceId, {
		enabled: true,
		onConflict: () => setNotice("內容已在其他地方更新，請再試一次。"),
		onSaveError: error => setNotice(userMessage(error))
	});

	const submit = useCallback(
		async (blob: Blob | null) => {
			if (submitting.current) return;
			submitting.current = true;
			const targetMode = recordingMode.current;
			dispatch({ type: "submit" });
			try {
				if (!blob || blob.size === 0) throw new ClientError("EMPTY_RECORDING");
				if (blob.size > config.maxAudioBytes) throw new ClientError("UPLOAD_TOO_LARGE");
				// Make sure the server has the latest manual edit before continuing from it.
				const artifactRevision = await workspace.flush(targetMode);
				const result = await generateArtifact(
					{ workspaceId, mode: targetMode, continue: continueEnabled, model: models.model?.id ?? null, reasoningEffort: models.reasoningEffort, artifactRevision, audio: blob },
					stage => dispatch({ type: "stage", stage })
				);
				// Only a completed, validated artifact replaces the current one.
				workspace.applyGenerated(result.artifact);
				dispatch({ type: "success", warnings: result.warnings });
			} catch (error) {
				dispatch({ type: "fail", error: userMessage(error) });
				if (error instanceof ClientError) {
					if (error.code === "STALE_REVISION") void workspace.reload();
					if (error.code === "CODEX_UNAUTHENTICATED") onAuthLost();
				}
			} finally {
				submitting.current = false;
			}
		},
		[config.maxAudioBytes, continueEnabled, models.model, models.reasoningEffort, onAuthLost, workspace, workspaceId]
	);

	const recorder = useRecorder({ maxDurationMs: config.maxRecordingSeconds * 1000, onAutoStop: blob => void submit(blob) });

	const onRecord = async () => {
		if (session.status === "recording") {
			const blob = await recorder.stop();
			await submit(blob);
			return;
		}
		if (!canStartRecording(session.status) || recorder.state !== "idle") return;
		setNotice(null);
		try {
			recordingMode.current = mode;
			setActiveMode(mode);
			await recorder.start();
			dispatch({ type: "record" });
		} catch (error) {
			dispatch({ type: "fail", error: userMessage(error) });
		}
	};

	const onCancel = () => {
		recorder.cancel();
		dispatch({ type: "cancel" });
	};

	const changeMode = (next: ArtifactMode) => {
		setMode(next);
		writePreference("mode", next);
	};

	const changeContinue = (value: boolean) => {
		setContinueEnabled(value);
		writePreference("continue", String(value));
	};

	const saveHotwords = (hotwords: string[]) => {
		api
			.saveHotwords(workspaceId, hotwords)
			.then(result => workspace.setHotwords(result.hotwords))
			.catch(error => setNotice(userMessage(error)));
	};

	const processing = isProcessing(session.status);
	const artifact = workspace.artifacts[mode];
	const documentLocked = processing && activeMode === "document";

	return (
		<div className="print-shell flex h-full flex-col bg-ctp-mantle">
			<main className="print-main min-h-0 flex-1" aria-label={mode === "presentation" ? "簡報" : "文件"}>
				{workspace.status === "error" ? (
					<div className="flex h-full items-center justify-center text-sm text-ctp-subtext0">無法載入內容，請重新整理頁面。</div>
				) : mode === "presentation" ? (
					<SlideStage html={artifact.content} />
				) : (
					<Suspense fallback={null}>
						<DocumentPage markdown={artifact.content} readOnly={documentLocked || workspace.status !== "ready"} onChange={content => workspace.updateContent("document", content)} />
					</Suspense>
				)}
			</main>
			<StatusLine
				session={session}
				notice={notice}
				onDismiss={() => {
					setNotice(null);
					dispatch({ type: "dismiss" });
				}}
			/>
			<Toolbar
				mode={mode}
				onModeChange={changeMode}
				status={session.status}
				recorderBusy={recorder.state === "requesting" || recorder.state === "stopping"}
				elapsedMs={recorder.elapsedMs}
				onRecord={() => void onRecord()}
				onCancel={onCancel}
				continueEnabled={continueEnabled}
				onContinueChange={changeContinue}
				onPrint={() => window.print()}
				settings={
					<SettingsPopover
						models={models.models}
						model={models.model}
						reasoningEffort={models.reasoningEffort}
						onModelChange={models.selectModel}
						onEffortChange={models.selectEffort}
						account={account}
						onLogout={onLogout}
						hotwords={workspace.hotwords}
						onHotwordsSave={saveHotwords}
						disabled={processing}
					/>
				}
			/>
		</div>
	);
}
