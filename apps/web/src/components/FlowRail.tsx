import { BLOCK_STATUS_LABELS, type Analysis, type BlockStatus } from "@innoverse/shared";
import { Check } from "lucide-react";

export const CONFLICTS_ANCHOR = "sum-conflicts";
export const ACTIONS_ANCHOR = "sum-actions";

export function StatusNode({ status, small = false }: { status: BlockStatus; small?: boolean }) {
	return (
		<span className={`node ${status}${small ? " small" : ""}`} aria-label={BLOCK_STATUS_LABELS[status]}>
			{status === "ok" && <Check size={small ? 8 : 10} strokeWidth={4} />}
			{status === "pending" && "!"}
		</span>
	);
}

type Props = {
	analysis: Analysis | null;
	active: string | null;
	onGo: (anchorId: string) => void;
};

/** Outline of the case blocks in chronological order, plus the cross-block summaries. */
export function FlowRail({ analysis, active, onGo }: Props) {
	const blocks = analysis?.blocks ?? [];
	const flow = blocks.filter(block => block.kind !== "summary");
	const summaries = blocks.filter(block => block.kind === "summary");
	const extras = [
		...(analysis?.conflicts.length ? [{ id: CONFLICTS_ANCHOR, title: "矛盾提示", status: "pending" as const, missing: analysis.conflicts.length }] : []),
		...(analysis?.actions.length ? [{ id: ACTIONS_ANCHOR, title: "應優先調閱", status: "ok" as const, missing: 0 }] : [])
	];

	const item = (id: string, title: string, subtitle: string | null, status: BlockStatus, open: number, label = "缺") => (
		<li key={id} className={active === id ? "active" : ""} onClick={() => onGo(id)}>
			<StatusNode status={status} />
			<span className="lbl">
				{title}
				{subtitle && <small>{subtitle}</small>}
				{open > 0 && (
					<span className="miss">
						{label} {open} 項
					</span>
				)}
			</span>
		</li>
	);

	return (
		<nav className="rail" aria-label="案情流程">
			<h4>案情流程</h4>
			<ul className="flow">{flow.map(block => item(block.id, block.title, block.subtitle, block.status, block.gaps.filter(gap => gap.state === "open").length))}</ul>
			{(summaries.length > 0 || extras.length > 0) && (
				<>
					<div className="sep" />
					<h4>彙整</h4>
					<ul className="flow">
						{summaries.map(block => item(block.id, block.title, block.subtitle, block.status, block.gaps.filter(gap => gap.state === "open").length))}
						{extras.map(extra => item(extra.id, extra.title, null, extra.status, extra.missing, "共"))}
					</ul>
				</>
			)}
			<div className="legend">
				{(["ok", "pending", "missing"] as const).map(status => (
					<div key={status}>
						<StatusNode status={status} small />
						{BLOCK_STATUS_LABELS[status]}
					</div>
				))}
			</div>
		</nav>
	);
}
