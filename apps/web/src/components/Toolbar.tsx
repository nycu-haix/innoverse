import type { ArtifactMode } from "@innoverse/shared";
import { FileText, Link2, Mic, Presentation, Printer, Square, X } from "lucide-react";
import type { ReactNode } from "react";
import type { SessionStatus } from "../state/session";

type Props = {
	mode: ArtifactMode;
	onModeChange: (mode: ArtifactMode) => void;
	status: SessionStatus;
	recorderBusy: boolean;
	elapsedMs: number;
	onRecord: () => void;
	onCancel: () => void;
	continueEnabled: boolean;
	onContinueChange: (value: boolean) => void;
	onPrint: () => void;
	settings: ReactNode;
};

function formatElapsed(ms: number): string {
	const total = Math.floor(ms / 1000);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const mm = String(minutes).padStart(hours ? 2 : 1, "0");
	const ss = String(seconds).padStart(2, "0");
	return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

const iconButton =
	"inline-flex h-10 w-10 items-center justify-center rounded-full text-ctp-subtext1 transition-colors hover:bg-ctp-mantle hover:text-ctp-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

const MODES: Array<{ value: ArtifactMode; label: string; Icon: typeof Presentation }> = [
	{ value: "presentation", label: "簡報", Icon: Presentation },
	{ value: "document", label: "文件", Icon: FileText }
];

/** The single floating toolbar. Record is the dominant control. */
export function Toolbar(props: Props) {
	const recording = props.status === "recording";
	const processing = props.status === "uploading" || props.status === "transcribing" || props.status === "generating";

	return (
		<div className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
			<div role="toolbar" aria-label="工具列" className="pointer-events-auto flex items-center gap-1 rounded-full border border-ctp-surface0 bg-ctp-base p-1.5 shadow-[var(--shadow-float)] sm:gap-2">
				<div role="radiogroup" aria-label="模式" className="flex items-center rounded-full bg-ctp-mantle p-1">
					{MODES.map(({ value, label, Icon }) => {
						const active = props.mode === value;
						return (
							<button
								key={value}
								type="button"
								role="radio"
								aria-checked={active}
								aria-label={label}
								title={label}
								onClick={() => props.onModeChange(value)}
								className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${active ? "bg-ctp-base text-ctp-text shadow-sm" : "text-ctp-subtext0 hover:text-ctp-text"}`}
							>
								<Icon aria-hidden="true" className="h-4 w-4" />
								<span className="hidden sm:inline">{label}</span>
							</button>
						);
					})}
				</div>

				<div className="flex items-center gap-1 px-1">
					<button
						type="button"
						onClick={props.onRecord}
						disabled={processing || props.recorderBusy}
						aria-label={recording ? "停止錄音並產生" : "開始錄音"}
						aria-pressed={recording}
						title={recording ? "停止錄音並產生" : "開始錄音"}
						className={`relative inline-flex h-14 w-14 items-center justify-center rounded-full text-ctp-base shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${recording ? "bg-ctp-red hover:bg-ctp-maroon" : "bg-ctp-text hover:bg-ctp-subtext1"}`}
					>
						{recording && <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-ctp-red opacity-20" />}
						{recording ? <Square aria-hidden="true" className="relative h-5 w-5 fill-current" /> : <Mic aria-hidden="true" className="h-6 w-6" />}
					</button>
					{recording && (
						<>
							<span className="flex min-w-14 items-center gap-1.5 px-1 font-mono text-sm text-ctp-red tabular-nums" aria-live="off">
								<span aria-hidden="true" className="h-2 w-2 rounded-full bg-ctp-red" />
								<span aria-label="錄音時間">{formatElapsed(props.elapsedMs)}</span>
							</span>
							<button type="button" onClick={props.onCancel} aria-label="取消錄音" title="取消錄音" className={iconButton}>
								<X aria-hidden="true" className="h-5 w-5" />
							</button>
						</>
					)}
				</div>

				<button
					type="button"
					role="switch"
					aria-checked={props.continueEnabled}
					aria-label="接續編輯目前內容"
					title={props.continueEnabled ? "接續：下一段錄音會修改目前內容" : "接續關閉：下一段錄音會建立新內容"}
					onClick={() => props.onContinueChange(!props.continueEnabled)}
					disabled={processing}
					className={`inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors disabled:opacity-40 ${props.continueEnabled ? "bg-ctp-blue/15 text-ctp-blue" : "text-ctp-subtext0 hover:bg-ctp-mantle hover:text-ctp-text"}`}
				>
					<Link2 aria-hidden="true" className="h-4 w-4" />
					<span className="hidden sm:inline">接續</span>
				</button>

				<div aria-hidden="true" className="mx-0.5 hidden h-6 w-px bg-ctp-surface0 sm:block" />

				{props.settings}

				<button type="button" onClick={props.onPrint} aria-label="列印" title="列印" className={iconButton}>
					<Printer aria-hidden="true" className="h-5 w-5" />
				</button>
			</div>
		</div>
	);
}
