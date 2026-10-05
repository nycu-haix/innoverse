import type { AuthStatus, CaseSummary, ModelOption } from "@innoverse/shared";
import { FileText, FolderOpen, LogOut, MessageSquare, Plus, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { CaptureState } from "../hooks/useLiveCapture";
import { api } from "../lib/api";
import { effortLabel } from "../lib/labels";
import { dateTime, duration } from "../lib/time";
import { useDismiss } from "./useDismiss";

export type Mode = "ask" | "record";

type Capture = {
	state: CaptureState;
	elapsedMs: number;
	levels: number[];
	start: () => void;
	pause: () => void;
	resume: () => void;
	stop: () => void;
};

export function RecorderControl({ capture }: { capture: Capture }) {
	if (capture.state === "idle" || capture.state === "starting") {
		return (
			<button type="button" className="rec-start" onClick={capture.start} disabled={capture.state === "starting"}>
				<span className="dot" />
				{capture.state === "starting" ? "啟動中…" : "開始錄音"}
			</button>
		);
	}
	const paused = capture.state === "paused";
	return (
		<div className={`rec${paused ? " paused" : ""}`}>
			<span className="dot" />
			<span>{paused ? "已暫停" : "錄音中"}</span>
			<span className="time">{duration(capture.elapsedMs)}</span>
			<span className="meter" aria-hidden="true">
				{capture.levels.map((level, index) => (
					<i key={index} style={{ height: `${paused ? 2 : 3 + level * 11}px` }} />
				))}
			</span>
			<button type="button" className="rec-btn" onClick={paused ? capture.resume : capture.pause}>
				{paused ? "繼續" : "暫停"}
			</button>
			<button type="button" className="rec-btn" onClick={capture.stop}>
				結束
			</button>
		</div>
	);
}

function CaseMenu({ currentId, disabled, onOpen, onNew }: { currentId: string; disabled: boolean; onOpen: (id: string) => void; onNew: () => void }) {
	const [open, setOpen] = useState(false);
	const [cases, setCases] = useState<CaseSummary[]>([]);
	const anchor = useRef<HTMLDivElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useDismiss(open, [anchor], close);

	const toggle = () => {
		if (!open)
			api.listCases().then(
				response => setCases(response.cases),
				() => setCases([])
			);
		setOpen(value => !value);
	};

	return (
		<div className="menu-anchor" ref={anchor}>
			<button type="button" className="top-btn" onClick={toggle} disabled={disabled} aria-label="案件" title={disabled ? "錄音中無法切換案件" : "案件"} aria-expanded={open}>
				<FolderOpen size={16} />
			</button>
			{open && (
				<div className="menu" role="dialog" aria-label="案件">
					<button
						type="button"
						className="btn pri"
						onClick={() => {
							close();
							onNew();
						}}
					>
						<Plus size={14} />
						新案件
					</button>
					<h5 style={{ marginTop: 14 }}>最近的案件</h5>
					<ul className="case-list">
						{cases.map(item => (
							<li key={item.id}>
								<button
									type="button"
									className={item.id === currentId ? "on" : ""}
									onClick={() => {
										close();
										onOpen(item.id);
									}}
								>
									{[item.fraudType, item.victimName].filter(Boolean).join("・") || "未分類"}
									<small>
										{dateTime(item.startedAt ?? item.createdAt)}・{item.utteranceCount} 句
									</small>
								</button>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

type SettingsProps = {
	models: ModelOption[];
	model: ModelOption | null;
	reasoningEffort: string | null;
	hotwords: string[];
	onModelChange: (id: string) => void;
	onEffortChange: (effort: string) => void;
	onHotwordsSave: (hotwords: string[]) => void;
	account: AuthStatus["account"];
	onLogout: () => void;
};

function SettingsMenu(props: SettingsProps) {
	const [open, setOpen] = useState(false);
	const [hotwordText, setHotwordText] = useState("");
	const anchor = useRef<HTMLDivElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useDismiss(open, [anchor], close);

	const toggle = () => {
		if (!open) setHotwordText(props.hotwords.join("\n"));
		setOpen(value => !value);
	};

	const saveHotwords = () => {
		const next = hotwordText
			.split(/\r?\n/)
			.map(term => term.trim())
			.filter(Boolean);
		if (next.join("\n") !== props.hotwords.join("\n")) props.onHotwordsSave(next);
	};

	return (
		<div className="menu-anchor" ref={anchor}>
			<button type="button" className="top-btn" onClick={toggle} aria-label="設定" title="設定" aria-expanded={open}>
				<SlidersHorizontal size={16} />
			</button>
			{open && (
				<div className="menu" role="dialog" aria-label="設定">
					<label htmlFor="set-model">模型</label>
					<select id="set-model" value={props.model?.id ?? ""} disabled={props.models.length === 0} onChange={event => props.onModelChange(event.target.value)}>
						{props.models.length === 0 && <option value="">無可用模型</option>}
						{props.models.map(model => (
							<option key={model.id} value={model.id}>
								{model.displayName}
							</option>
						))}
					</select>
					<label htmlFor="set-effort">思考強度</label>
					<select
						id="set-effort"
						value={props.reasoningEffort ?? ""}
						disabled={!props.model || props.model.supportedReasoningEfforts.length === 0}
						onChange={event => props.onEffortChange(event.target.value)}
					>
						{(props.model?.supportedReasoningEfforts ?? []).map(effort => (
							<option key={effort} value={effort}>
								{effortLabel(effort)}
							</option>
						))}
					</select>
					<label htmlFor="set-hotwords">辨識詞彙（每行一個）</label>
					<textarea id="set-hotwords" rows={4} value={hotwordText} onChange={event => setHotwordText(event.target.value)} onBlur={saveHotwords} />
					<div className="menu-foot">
						<span>{props.account?.email ?? ""}</span>
						<button type="button" className="btn quiet" onClick={props.onLogout}>
							<LogOut size={13} />
							登出
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

type TopBarProps = {
	caseId: string;
	fraudType: string | null;
	victimName: string | null;
	startedAt: string | null;
	capture: Capture;
	mode: Mode;
	onMode: (mode: Mode) => void;
	openMustGaps: number;
	onOpenCase: (id: string) => void;
	onNewCase: () => void;
	settings: SettingsProps;
};

export function TopBar(props: TopBarProps) {
	const meta = [
		props.fraudType,
		props.victimName && (
			<>
				被害人 <b>{props.victimName}</b>
			</>
		),
		props.startedAt && (
			<>
				詢問開始 <b>{dateTime(props.startedAt)}</b>
			</>
		)
	].filter(Boolean);

	return (
		<header className="top">
			<div className="brand">
				<ShieldCheck size={20} color="#9fc4e6" />
				筆錄輔助
			</div>
			{meta.length > 0 && (
				<div className="case-meta">
					{meta.map((item, index) => (
						<span key={index}>
							{index > 0 && " ・ "}
							{item}
						</span>
					))}
				</div>
			)}
			<div className="spacer" />
			<RecorderControl capture={props.capture} />
			<div className="seg" role="tablist">
				<button type="button" role="tab" aria-selected={props.mode === "ask"} className={props.mode === "ask" ? "on" : ""} onClick={() => props.onMode("ask")}>
					<MessageSquare size={14} />
					詢問中
				</button>
				<button type="button" role="tab" aria-selected={props.mode === "record"} className={props.mode === "record" ? "on" : ""} onClick={() => props.onMode("record")}>
					<FileText size={14} />
					筆錄
					{props.openMustGaps > 0 && (
						<span className="n" title="尚未取得的必要資訊">
							{props.openMustGaps}
						</span>
					)}
				</button>
			</div>
			<CaseMenu currentId={props.caseId} disabled={props.capture.state !== "idle"} onOpen={props.onOpenCase} onNew={props.onNewCase} />
			<SettingsMenu {...props.settings} />
		</header>
	);
}
