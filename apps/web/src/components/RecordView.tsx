import type { RecordDocument, TaskStatus } from "@innoverse/shared";
import { FileText, Printer, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { userMessage } from "../lib/errors";
import { MarkdownEditor } from "./MarkdownEditor";

type Props = {
	caseId: string;
	record: RecordDocument;
	status: TaskStatus;
	hasTranscript: boolean;
	openMustGaps: number;
	onChanged: () => void;
};

const SAVE_DELAY_MS = 800;

/** The 筆錄 draft: generated from the interview, then edited in place (Markdown via Milkdown). */
export function RecordView({ caseId, record, status, hasTranscript, openMustGaps, onChanged }: Props) {
	const [content, setContent] = useState(record.content);
	const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">("saved");
	const [error, setError] = useState<string | null>(null);
	const [generating, setGenerating] = useState(false);
	const revision = useRef(record.revision);
	/** Rendered copy of `revision`; the ref is what async saves read. */
	const [savedRevision, setSavedRevision] = useState(record.revision);
	const setRevision = (value: number) => {
		revision.current = value;
		setSavedRevision(value);
	};
	const latest = useRef(record.content);
	const timer = useRef<number | undefined>(undefined);

	// Adopt server changes (a new draft, edits from another window) unless local edits are pending.
	useEffect(() => {
		if (record.revision > revision.current && saveState === "saved") {
			setRevision(record.revision);
			latest.current = record.content;
			setContent(record.content);
		}
	}, [record, saveState]);

	const flush = useCallback(async () => {
		window.clearTimeout(timer.current);
		const value = latest.current;
		setSaveState("saving");
		try {
			const result = await api.saveRecord(caseId, value, revision.current);
			if (result.ok) {
				setRevision(result.record.revision);
				setError(null);
			} else if (result.current) {
				setRevision(result.current.revision);
				latest.current = result.current.content;
				setContent(result.current.content);
				setError("筆錄已在其他地方更新，已載入最新版本。");
			}
		} catch (err) {
			setError(userMessage(err));
		}
		setSaveState(latest.current === value ? "saved" : "dirty");
	}, [caseId]);

	// Save before leaving the view.
	useEffect(
		() => () => {
			if (timer.current !== undefined) {
				window.clearTimeout(timer.current);
				void api.saveRecord(caseId, latest.current, revision.current).catch(() => undefined);
			}
		},
		[caseId]
	);

	const onChange = (markdown: string) => {
		latest.current = markdown;
		setContent(markdown);
		setSaveState("dirty");
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			timer.current = undefined;
			void flush();
		}, SAVE_DELAY_MS);
	};

	const generate = async () => {
		if (revision.current > 0 && !window.confirm("重新產生會取代目前的筆錄內容（包含手動修改）。要繼續嗎？")) return;
		if (timer.current !== undefined) await flush();
		setGenerating(true);
		setError(null);
		try {
			const next = await api.generateRecord(caseId);
			setRevision(next.revision);
			latest.current = next.content;
			setContent(next.content);
			setSaveState("saved");
			onChanged();
		} catch (err) {
			setError(userMessage(err));
		} finally {
			setGenerating(false);
		}
	};

	const busy = generating || status.state === "running";
	const empty = savedRevision === 0;

	return (
		<>
			<div className="record-bar">
				<span role="status">{busy ? "產生筆錄中…" : saveState === "saving" ? "儲存中…" : saveState === "dirty" ? "尚未儲存" : savedRevision > 0 ? "已儲存" : ""}</span>
				{openMustGaps > 0 && <span className="tag conf">尚有 {openMustGaps} 項必要資訊未取得</span>}
				{error && <span className="tag conf">{error}</span>}
				<span className="right">
					{!empty && (
						<>
							<button type="button" className="btn" onClick={() => void generate()} disabled={busy || !hasTranscript}>
								<RefreshCw size={13} />
								重新產生
							</button>
							<button type="button" className="btn" onClick={() => window.print()} disabled={busy}>
								<Printer size={13} />
								列印
							</button>
						</>
					)}
				</span>
			</div>
			<article className="record-page" aria-busy={busy}>
				{empty ? (
					<div className="empty">
						<button type="button" className="btn pri" style={{ padding: "8px 18px", fontSize: 14 }} onClick={() => void generate()} disabled={!hasTranscript || busy}>
							<FileText size={15} />
							{busy ? "產生筆錄中…" : "產生筆錄"}
						</button>
					</div>
				) : (
					<MarkdownEditor value={content} readOnly={busy} onChange={onChange} ariaLabel="筆錄內容" />
				)}
			</article>
		</>
	);
}
