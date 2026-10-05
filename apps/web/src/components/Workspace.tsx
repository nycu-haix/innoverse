import type { AuthStatus } from "@innoverse/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCase, useCurrentCaseId } from "../hooks/useCase";
import { useLiveCapture, type CapturedUtterance } from "../hooks/useLiveCapture";
import { useModels } from "../hooks/useModels";
import { api } from "../lib/api";
import { ClientError, userMessage } from "../lib/errors";
import { BlocksView } from "./BlocksView";
import { FlowRail } from "./FlowRail";
import { RecordView } from "./RecordView";
import { TopBar, type Mode } from "./TopBar";
import { TranscriptPanel } from "./TranscriptPanel";

type Props = { account: AuthStatus["account"]; onLogout: () => void };

export function Workspace(props: Props) {
	const current = useCurrentCaseId();
	if (!current.caseId) {
		return <div className="ws">{current.error && <p className="notice">{current.error}</p>}</div>;
	}
	return <CaseWorkspace key={current.caseId} caseId={current.caseId} onOpenCase={current.open} onNewCase={() => void current.createNew()} {...props} />;
}

/** Uploads utterances one at a time so line numbers follow speaking order. */
function useUploadQueue(caseId: string, onUploaded: () => void, onError: (message: string) => void) {
	const [pending, setPending] = useState(0);
	const chain = useRef<Promise<void>>(Promise.resolve());
	const callbacks = useRef({ onUploaded, onError });
	useEffect(() => {
		callbacks.current = { onUploaded, onError };
	}, [onUploaded, onError]);

	const enqueue = useCallback(
		(utterance: CapturedUtterance) => {
			setPending(count => count + 1);
			chain.current = chain.current.then(async () => {
				try {
					await api.uploadUtterance(caseId, utterance.audio, utterance.startedAt, utterance.durationMs);
					callbacks.current.onUploaded();
				} catch (err) {
					// Silence and noise are expected; the ASR found nothing to transcribe.
					if (!(err instanceof ClientError && (err.code === "NO_SPEECH" || err.code === "EMPTY_RECORDING"))) callbacks.current.onError(userMessage(err));
				} finally {
					setPending(count => count - 1);
				}
			});
		},
		[caseId]
	);
	return { pending, enqueue };
}

function CaseWorkspace({ caseId, onOpenCase, onNewCase, account, onLogout }: Props & { caseId: string; onOpenCase: (id: string) => void; onNewCase: () => void }) {
	const kase = useCase(caseId, onNewCase);
	const models = useModels();
	const [mode, setMode] = useState<Mode>("ask");
	const [highlight, setHighlight] = useState<{ lines: string[]; scroll: boolean }>({ lines: [], scroll: false });
	const [active, setActive] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [maxUtteranceMs, setMaxUtteranceMs] = useState(30_000);
	const [editor, setEditor] = useState<HTMLElement | null>(null);

	useEffect(() => {
		api.config().then(
			config => setMaxUtteranceMs(config.maxUtteranceSeconds * 1000),
			() => undefined
		);
	}, []);

	const uploads = useUploadQueue(caseId, kase.reload, setNotice);
	const capture = useLiveCapture({ maxUtteranceMs, onUtterance: uploads.enqueue });

	const startCapture = useCallback(() => {
		setNotice(null);
		capture.start().catch(err => setNotice(userMessage(err)));
	}, [capture]);

	const onHighlight = useCallback((lines: string[], scroll: boolean) => setHighlight({ lines, scroll }), []);

	const goTo = useCallback(
		(anchorId: string) => {
			setMode("ask");
			setActive(anchorId);
			// The editor may only exist after switching back from the record view.
			window.requestAnimationFrame(() => document.getElementById(anchorId)?.scrollIntoView({ block: "start" }));
		},
		[setMode]
	);

	const detail = kase.detail;
	const analysis = detail?.analysis ?? null;
	const openMustGaps = analysis?.blocks.reduce((sum, block) => sum + block.gaps.filter(gap => gap.level === "must" && gap.state === "open").length, 0) ?? 0;
	const hasTranscript = (detail?.utterances.length ?? 0) > 0;

	const captureControls = {
		state: capture.state,
		elapsedMs: capture.elapsedMs,
		levels: capture.levels,
		start: startCapture,
		pause: () => void capture.pause(),
		resume: () => void capture.resume(),
		stop: capture.stop
	};

	return (
		<div className="ws">
			<TopBar
				caseId={caseId}
				fraudType={detail?.fraudType ?? null}
				victimName={detail?.victimName ?? null}
				startedAt={detail?.startedAt ?? null}
				capture={captureControls}
				mode={mode}
				onMode={setMode}
				openMustGaps={openMustGaps}
				onOpenCase={onOpenCase}
				onNewCase={onNewCase}
				settings={{
					models: models.models,
					model: models.model,
					reasoningEffort: models.reasoningEffort,
					hotwords: models.hotwords,
					onModelChange: models.selectModel,
					onEffortChange: models.selectEffort,
					onHotwordsSave: models.saveHotwords,
					account,
					onLogout
				}}
			/>
			<div className="main">
				<FlowRail analysis={analysis} active={active} onGo={goTo} />
				<section className="editor" ref={setEditor}>
					<div className="ed-inner">
						{(notice ?? kase.error) && (
							<p className="notice" role="alert">
								{notice ?? kase.error}
								<button
									type="button"
									className="btn quiet"
									onClick={() => {
										setNotice(null);
										kase.setError(null);
									}}
								>
									關閉
								</button>
							</p>
						)}
						{detail && mode === "record" && (
							<RecordView caseId={caseId} record={detail.record} status={detail.recordStatus} hasTranscript={hasTranscript} openMustGaps={openMustGaps} onChanged={() => void kase.reload()} />
						)}
						{detail && mode === "ask" && analysis && analysis.blocks.length + analysis.conflicts.length + analysis.actions.length > 0 && (
							<BlocksView
								analysis={analysis}
								utterances={detail.utterances}
								onGapState={kase.setGapState}
								onEditFact={kase.editFact}
								onHighlight={onHighlight}
								onActive={setActive}
								scrollRoot={editor}
							/>
						)}
						{detail && mode === "ask" && !analysis?.blocks.length && (
							<div className="empty">
								{capture.state === "idle" && !hasTranscript ? (
									<button type="button" className="rec-start" onClick={startCapture}>
										<span className="dot" />
										開始錄音
									</button>
								) : (
									<span>尚無案情資料</span>
								)}
							</div>
						)}
					</div>
				</section>
				<TranscriptPanel
					caseId={caseId}
					utterances={detail?.utterances ?? []}
					pending={uploads.pending}
					speaking={capture.state === "recording" && capture.speaking}
					highlight={highlight}
					analysisStatus={detail?.analysisStatus ?? { state: "idle", error: null }}
					onToggleSpeaker={kase.setSpeaker}
					onRetryAnalysis={() => void kase.analyze()}
				/>
			</div>
		</div>
	);
}
