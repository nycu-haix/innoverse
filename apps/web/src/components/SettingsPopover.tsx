import type { AuthStatus, ModelOption } from "@innoverse/shared";
import { LogOut, SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { effortLabel } from "../lib/labels";

type Props = {
	models: ModelOption[];
	model: ModelOption | null;
	reasoningEffort: string | null;
	onModelChange: (id: string) => void;
	onEffortChange: (effort: string) => void;
	account: AuthStatus["account"];
	onLogout: () => void;
	hotwords: string[];
	onHotwordsSave: (hotwords: string[]) => void;
	disabled: boolean;
};

const selectClass = "w-full rounded-lg border border-ctp-surface0 bg-ctp-base px-3 py-2 text-sm text-ctp-text focus:border-ctp-blue disabled:opacity-50";

/** Subtle model / thinking / account surface. Account management stays out of the way. */
export function SettingsPopover(props: Props) {
	const [open, setOpen] = useState(false);
	const panelRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const [hotwordText, setHotwordText] = useState(props.hotwords.join("\n"));
	const ids = { panel: useId(), model: useId(), effort: useId(), hotwords: useId() };

	useEffect(() => {
		if (!open) return;
		const onPointer = (event: PointerEvent) => {
			const target = event.target as Node;
			if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpen(false);
				buttonRef.current?.focus();
			}
		};
		document.addEventListener("pointerdown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

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
		<div className="relative">
			<button
				ref={buttonRef}
				type="button"
				onClick={toggle}
				aria-label="模型與設定"
				title={props.model ? `${props.model.displayName}${props.reasoningEffort ? ` · ${effortLabel(props.reasoningEffort)}` : ""}` : "模型與設定"}
				aria-expanded={open}
				aria-controls={ids.panel}
				className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ctp-subtext1 transition-colors hover:bg-ctp-mantle hover:text-ctp-text"
			>
				<SlidersHorizontal aria-hidden="true" className="h-5 w-5" />
			</button>
			{open && (
				<div
					ref={panelRef}
					id={ids.panel}
					role="dialog"
					aria-label="模型與設定"
					className="absolute right-0 bottom-16 w-[min(20rem,calc(100vw-1.5rem))] space-y-4 rounded-2xl border border-ctp-surface0 bg-ctp-base p-4 text-sm shadow-[var(--shadow-float)] max-sm:right-[-4.5rem]"
				>
					<div className="space-y-1.5">
						<label htmlFor={ids.model} className="block text-xs font-medium text-ctp-subtext0">
							模型
						</label>
						<select
							id={ids.model}
							className={selectClass}
							value={props.model?.id ?? ""}
							disabled={props.disabled || props.models.length === 0}
							onChange={event => props.onModelChange(event.target.value)}
						>
							{props.models.length === 0 && <option value="">無可用模型</option>}
							{props.models.map(model => (
								<option key={model.id} value={model.id}>
									{model.displayName}
								</option>
							))}
						</select>
					</div>
					<div className="space-y-1.5">
						<label htmlFor={ids.effort} className="block text-xs font-medium text-ctp-subtext0">
							思考強度
						</label>
						<select
							id={ids.effort}
							className={selectClass}
							value={props.reasoningEffort ?? ""}
							disabled={props.disabled || !props.model || props.model.supportedReasoningEfforts.length === 0}
							onChange={event => props.onEffortChange(event.target.value)}
						>
							{(props.model?.supportedReasoningEfforts ?? []).map(effort => (
								<option key={effort} value={effort}>
									{effortLabel(effort)}
								</option>
							))}
						</select>
					</div>
					<div className="space-y-1.5">
						<label htmlFor={ids.hotwords} className="block text-xs font-medium text-ctp-subtext0">
							辨識詞彙（每行一個）
						</label>
						<textarea
							id={ids.hotwords}
							rows={3}
							value={hotwordText}
							onChange={event => setHotwordText(event.target.value)}
							onBlur={saveHotwords}
							placeholder={"例如：藥名、人名、地名"}
							className={`${selectClass} resize-y leading-relaxed`}
						/>
					</div>
					<p className="text-xs leading-relaxed text-ctp-subtext0">
						語音辨識在本機伺服器執行。
						<br />
						辨識後的文字會傳送至設定的 AI 服務產生內容。
					</p>
					<div className="flex items-center justify-between gap-2 border-t border-ctp-surface0 pt-3">
						<span className="truncate text-xs text-ctp-subtext0">{props.account?.email ?? (props.account ? "已登入" : "")}</span>
						<button
							type="button"
							onClick={props.onLogout}
							className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-ctp-subtext1 hover:bg-ctp-mantle hover:text-ctp-red"
						>
							<LogOut aria-hidden="true" className="h-3.5 w-3.5" />
							登出
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
