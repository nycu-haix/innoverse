import { AlertCircle, AlertTriangle, LoaderCircle, X } from "lucide-react";
import { STATUS_TEXT, type SessionState } from "../state/session";

type Props = { session: SessionState; notice: string | null; onDismiss: () => void };

/** Concise status above the toolbar. Never printed, never a blocking modal. */
export function StatusLine({ session, notice, onDismiss }: Props) {
	const progress = STATUS_TEXT[session.status];
	const error = session.status === "error" ? session.error : notice;
	const warnings = session.status === "success" ? session.warnings : [];

	return (
		<div className="no-print pointer-events-none fixed inset-x-0 bottom-24 z-10 flex justify-center px-3" aria-live="polite" role="status">
			{progress && (
				<div className="flex items-center gap-2 rounded-full border border-ctp-surface0 bg-ctp-base px-4 py-2 text-sm text-ctp-subtext1 shadow-sm">
					<LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin text-ctp-blue" />
					{progress}
				</div>
			)}
			{!progress && error && (
				<div className="pointer-events-auto flex max-w-xl items-center gap-2 rounded-full border border-ctp-red/30 bg-ctp-base py-1.5 pr-1.5 pl-4 text-sm text-ctp-red shadow-sm">
					<AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
					<span>{error}</span>
					<button type="button" onClick={onDismiss} aria-label="關閉訊息" className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-ctp-mantle">
						<X aria-hidden="true" className="h-4 w-4" />
					</button>
				</div>
			)}
			{!progress && !error && warnings.length > 0 && (
				<div className="pointer-events-auto flex max-w-xl items-start gap-2 rounded-2xl border border-ctp-yellow/40 bg-ctp-base py-2 pr-1.5 pl-4 text-sm text-ctp-text shadow-sm">
					<AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ctp-yellow" />
					<ul className="space-y-0.5">
						{warnings.map(warning => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
					<button type="button" onClick={onDismiss} aria-label="關閉提醒" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-ctp-mantle">
						<X aria-hidden="true" className="h-4 w-4" />
					</button>
				</div>
			)}
		</div>
	);
}
